// PPP loans: the Small Business Administration's loan-level files for the
// 2020-21 Paycheck Protection Program (backlog 61, E6;
// docs/context/ppp-loans.md). About 11 million loans to small businesses:
// jobs reported, industry code (NAICS), loan size, city and state. A second
// headcount for small private firms, matched to the Form D issuers and the
// plan sponsors by name and place (no EIN in these files, so inexact).
//
// LOCAL, BY HAND, AND SLOW ON PURPOSE, as the other loaders:
//   - thirteen bulk CSVs, about 420MB each, never a request per business;
//   - one request at a time, --gap seconds apart (60 by default, never under 30);
//   - any answer but a 200 stops the run, nothing retried;
//   - every file kept in the system temp folder and never fetched twice
//     (streamed to .part, kept only once whole);
//   - at most 20 requests in any 24 hours, counted in the archive's own log;
//   - one run at a time (a lock file); nothing schedules it.
//
//   node --use-system-ca ppp-load.js                      # what it would do; no request
//   node --use-system-ca ppp-load.js --download --commit  # fetch what is missing, a minute apart
//   node --use-system-ca ppp-load.js --load --commit      # read the files on disk into formd.db; no request
'use strict';
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = 'https://data.sba.gov/sites/default/files/distribution/SBA-OCA-2022-07-001/';
const FILES = ['public_150k_plus_240930.csv', ...Array.from({ length: 12 }, (_, i) => `public_up_to_150k_${i + 1}_240930.csv`)];
const DIR = path.join(os.tmpdir(), 'tickrlab-sba');
const LOCK = path.join(DIR, 'ppp-load.lock');
const MIN_GAP_S = 30;
const DAY_CAP = 20;
const UA = String(process.env.SBA_UA || `Tickr Lab research (${process.env.REPORT_TO || process.env.MAIL_FROM || ''})`).trim();

function options(argv) {
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  return {
    commit: argv.includes('--commit'),
    download: argv.includes('--download'),
    load: argv.includes('--load'),
    gapS: Math.max(MIN_GAP_S, Number(arg('--gap')) || 60),
  };
}

// The request log: a small JSON file beside the downloads (the archive tables
// come with --load).
const LOG = path.join(DIR, 'requests.json');
const readLog = () => { try { return JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch (_) { return []; } };
const noteRequest = (url, status, bytes, ms) => { try { const l = readLog(); l.push({ at: Date.now(), url, status, bytes, ms }); fs.writeFileSync(LOG, JSON.stringify(l)); } catch (_) { /* bookkeeping */ } };

async function download(opts, deps) {
  const log = deps.log || console.log;
  const todo = FILES.filter((f) => !deps.onDisk(f));
  const used = deps.readLog().filter((r) => r.at >= deps.now() - 86400e3).length;
  log(`${FILES.length - todo.length} of ${FILES.length} files on disk; ${todo.length} to fetch; requests in the last 24 hours: ${used} of ${DAY_CAP}`);
  if (!opts.commit) { log(`DRY RUN: would fetch ${todo.length} file(s), ${opts.gapS}s apart. Add --commit.`); return { ok: true, todo: todo.length }; }
  if (!/@/.test(UA)) throw new Error('no contact address for the User-Agent: set SBA_UA or REPORT_TO in .env');
  let made = 0, last = 0;
  for (const f of todo) {
    if (used + made >= DAY_CAP) { log(`reached the ${DAY_CAP}-a-day cap; run again tomorrow`); return { ok: false, stopped: 'cap' }; }
    const wait = last ? last + opts.gapS * 1000 - deps.now() : 0;
    if (wait > 0) await deps.sleep(wait);
    const url = BASE + f, t0 = deps.now();
    let r;
    try { r = await deps.fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(3600e3) }); }
    catch (e) { made++; last = deps.now(); deps.noteRequest(url, 0, 0, deps.now() - t0); log(`${f}: could not reach data.sba.gov (${e.message}). Stopped; nothing retried.`); return { ok: false, stopped: e.message }; }
    made++;
    if (r.status !== 200) {
      try { await r.body?.cancel(); } catch (_) { /* nothing to drain */ }
      last = deps.now(); deps.noteRequest(url, r.status, 0, deps.now() - t0);
      log(`${f}: data.sba.gov answered ${r.status}. Stopped; nothing retried.`);
      return { ok: false, stopped: String(r.status) };
    }
    const bytes = await deps.save(r, f);
    last = deps.now();
    deps.noteRequest(url, 200, bytes, deps.now() - t0);
    log(`${f}: ${(bytes / 1e6).toFixed(0)}MB in ${((deps.now() - t0) / 1000).toFixed(0)}s`);
  }
  log('all files on disk.');
  return { ok: true, fetched: made };
}

function fileDeps() {
  fs.mkdirSync(DIR, { recursive: true });
  const pathOf = (f) => path.join(DIR, f);
  return {
    fetch: (...a) => fetch(...a),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    pathOf,
    readLog, noteRequest,
    onDisk: (f) => fs.existsSync(pathOf(f)) && fs.statSync(pathOf(f)).size > 1e6,
    // Streamed to NAME.part and renamed once whole; a CSV must start with its header.
    save: async (res, f) => {
      const { Readable } = require('stream');
      const { pipeline } = require('stream/promises');
      const part = pathOf(f) + '.part';
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part));
      const head = Buffer.alloc(200); const fd = fs.openSync(part, 'r'); fs.readSync(fd, head, 0, 200, 0); fs.closeSync(fd);
      if (!/LoanNumber/i.test(head.toString('utf8'))) { fs.unlinkSync(part); throw Object.assign(new Error('the download is not the expected CSV'), { stop: true }); }
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
    if (alive) throw new Error(`another ppp-load run (pid ${pid}) is going; one at a time`);
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
    if (opts.load) r = await require('./pppload-read.js').load(opts, deps);
    if (!r.ok) process.exitCode = 1;
    unlock();
  })().catch((e) => { console.error(e.message); unlock(); process.exit(1); });
}

module.exports = { options, download, FILES, BASE, DAY_CAP, MIN_GAP_S, DIR };
