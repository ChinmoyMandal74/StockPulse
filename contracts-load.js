// Federal contracts: who sells to the US government and how much, from
// USAspending.gov's Award Data Archive (backlog 61, E7;
// docs/context/federal-contracts.md). One ZIP a fiscal year of every contract
// action (1 to 2GB each); read into one row a recipient a fiscal year in the
// LOCAL formd.db, matched to the companies held by name and state.
//
// LOCAL, BY HAND, AND SLOW ON PURPOSE, as the other loaders:
//   - bulk files only, one a fiscal year, never a request per company;
//   - one request at a time, --gap seconds apart (60 by default, never under 30);
//   - any answer but a 200 stops the run, nothing retried;
//   - every file kept in the system temp folder and never fetched twice
//     (streamed to .part, kept only once whole and a ZIP);
//   - at most 30 requests in any 24 hours; one run at a time; nothing schedules it.
// The file names carry the archive's refresh date; the listing service
// (api.usaspending.gov list_monthly_files, one request a year) gives them.
//
//   node --use-system-ca contracts-load.js                         # what it would do
//   node --use-system-ca contracts-load.js --download --commit     # FY2016 to FY2026, a minute apart
//   node --use-system-ca contracts-load.js --load --commit         # the files on disk into formd.db; no request
'use strict';
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.tmpdir(), 'tickrlab-usaspending');
const LOCK = path.join(DIR, 'contracts-load.lock');
const LIST = 'https://api.usaspending.gov/api/v2/bulk_download/list_monthly_files/';
const MIN_GAP_S = 30;
const DAY_CAP = 30;
const FIRST_FY = 2016;
const UA = String(process.env.USASPENDING_UA || `Tickr Lab research (${process.env.REPORT_TO || process.env.MAIL_FROM || ''})`).trim();

function options(argv, now = new Date()) {
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const lastFy = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();   // the fiscal year starts on October 1
  const years = arg('--years') ? String(arg('--years')).split(',').map(Number).filter((y) => y >= 2008 && y <= lastFy)
    : Array.from({ length: lastFy - FIRST_FY + 1 }, (_, i) => lastFy - i);
  return { commit: argv.includes('--commit'), download: argv.includes('--download'), load: argv.includes('--load'),
    gapS: Math.max(MIN_GAP_S, Number(arg('--gap')) || 60), years };
}

const LOG = path.join(DIR, 'requests.json');
const readLog = () => { try { return JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch (_) { return []; } };
const noteRequest = (url, status, bytes, ms) => { try { const l = readLog(); l.push({ at: Date.now(), url, status, bytes, ms }); fs.writeFileSync(LOG, JSON.stringify(l)); } catch (_) { /* bookkeeping */ } };

async function download(opts, deps) {
  const log = deps.log || console.log;
  const have = (fy) => deps.onDisk().find((n) => n.startsWith(`FY${fy}_All_Contracts_Full_`));
  const todo = opts.years.filter((fy) => !have(fy));
  const used = deps.readLog().filter((r) => r.at >= deps.now() - 86400e3).length;
  log(`${opts.years.length - todo.length} of ${opts.years.length} fiscal years on disk; ${todo.length} to fetch (two requests each: the listing, the file); requests in the last 24 hours: ${used} of ${DAY_CAP}`);
  if (!opts.commit) { log(`DRY RUN: would fetch ${todo.length} year(s), ${opts.gapS}s between requests. Add --commit.`); return { ok: true, todo: todo.length }; }
  if (!/@/.test(UA)) throw new Error('no contact address for the User-Agent: set USASPENDING_UA or REPORT_TO in .env');
  let made = 0, last = 0;
  const request = async (url, init) => {
    if (used + made >= DAY_CAP) { const e = new Error(`reached the ${DAY_CAP}-a-day cap; run again tomorrow`); e.stop = true; throw e; }
    const wait = last ? last + opts.gapS * 1000 - deps.now() : 0;
    if (wait > 0) await deps.sleep(wait);
    const t0 = deps.now();
    let r;
    try { r = await deps.fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init && init.headers) }, signal: AbortSignal.timeout(7200e3) }); }
    catch (e) { made++; last = deps.now(); deps.noteRequest(url, 0, 0, deps.now() - t0); const err = new Error(`could not reach usaspending.gov (${e.message}). Stopped; nothing retried.`); err.stop = true; throw err; }
    made++;
    if (r.status !== 200) {
      try { await r.body?.cancel(); } catch (_) { /* nothing to drain */ }
      last = deps.now(); deps.noteRequest(url, r.status, 0, deps.now() - t0);
      const e = new Error(`usaspending.gov answered ${r.status}. Stopped; nothing retried.`); e.stop = true; throw e;
    }
    return { r, t0, done: (bytes) => { last = deps.now(); deps.noteRequest(url, 200, bytes, deps.now() - t0); } };
  };
  for (const fy of todo) {
    try {
      const L = await request(LIST, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agency: 'all', fiscal_year: fy, type: 'contracts' }) });
      const j = await L.r.json(); L.done(0);
      const file = (j.monthly_files || []).find((x) => x.fiscal_year === fy && /_All_Contracts_Full_\d{8}\.zip$/.test(x.file_name));
      if (!file || !/^https:\/\/files\.usaspending\.gov\/award_data_archive\//.test(file.url)) { log(`FY${fy}: the listing names no full contracts file. Stopped.`); return { ok: false, stopped: 'no file' }; }
      const F = await request(file.url);
      const bytes = await deps.save(F.r, file.file_name);
      F.done(bytes);
      log(`FY${fy}: ${file.file_name}, ${(bytes / 1e9).toFixed(2)}GB in ${((deps.now() - F.t0) / 1000).toFixed(0)}s`);
    } catch (e) { log(`FY${fy}: ${e.message}`); return { ok: false, stopped: e.message }; }
  }
  log('all years on disk.');
  return { ok: true, fetched: made };
}

function fileDeps() {
  fs.mkdirSync(DIR, { recursive: true });
  const pathOf = (f) => path.join(DIR, f);
  return {
    fetch: (...a) => fetch(...a), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(),
    pathOf, readLog, noteRequest,
    onDisk: () => fs.readdirSync(DIR).filter((n) => /^FY\d{4}_All_Contracts_Full_\d{8}\.zip$/.test(n) && fs.statSync(pathOf(n)).size > 1e6),
    save: async (res, f) => {
      const { Readable } = require('stream');
      const { pipeline } = require('stream/promises');
      const part = pathOf(f) + '.part';
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part));
      const head = Buffer.alloc(4); const fd = fs.openSync(part, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
      if (head.readUInt32LE(0) !== 0x04034b50) { fs.unlinkSync(part); throw Object.assign(new Error('the download is not a ZIP'), { stop: true }); }
      fs.renameSync(part, pathOf(f));
      return fs.statSync(pathOf(f)).size;
    },
  };
}

function lock() {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(LOCK)) {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch (_) { /* not running */ }
    if (alive) throw new Error(`another contracts-load run (pid ${pid}) is going; one at a time`);
  }
  fs.writeFileSync(LOCK, String(process.pid));
  return () => { try { fs.unlinkSync(LOCK); } catch (_) { /* gone */ } };
}

if (require.main === module) {
  const opts = options(process.argv);
  let unlock = () => {};
  (async () => {
    if (opts.commit) unlock = lock();
    const deps = fileDeps();
    let r = { ok: true };
    if (opts.download || !opts.load) r = await download(opts, deps);
    if (opts.load && r.ok) r = await require('./contracts-read.js').load(opts, deps);
    if (!r.ok) process.exitCode = 1;
    unlock();
  })().catch((e) => { console.error(e.message); unlock(); process.exit(1); });
}

module.exports = { options, download, DAY_CAP, MIN_GAP_S, FIRST_FY, DIR };
