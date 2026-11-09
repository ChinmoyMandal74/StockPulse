// Form D: load the SEC's quarterly Form D data sets into the local archive
// (formd.db, formdarchive.js). Backlog 61, phase 1; docs/context/form-d.md.
//
// LOCAL, BY HAND, AND SLOW ON PURPOSE. The SEC has already answered this
// address with a 429 and then a 403 (docs/context/sec-edgar.md), and the
// owner asked for this to be careful above all. So:
//   - bulk files only: one ZIP a quarter (75 since 2008, 1 to 4MB each); never
//     a request per filing;
//   - one request at a time, with a pause between requests (--gap, 30s by
//     default, never under 15s);
//   - every answer but a 200 stops the run, with nothing retried;
//   - every file is kept in the system temp folder and never fetched twice;
//     the data-set page is kept for a week;
//   - at most 100 requests to sec.gov in any 24 hours, counted in the
//     archive's own request log; a run that would pass it stops first;
//   - one run at a time (a lock file);
//   - nothing schedules it.
// The declared User-Agent is the one the other SEC loaders send (SEC_UA, else
// "Tickr Lab (REPORT_TO)").
//
//   node --use-system-ca formd-load.js                     # what it would do; no requests unless the page is not cached
//   node --use-system-ca formd-load.js --commit            # load up to 4 quarters, newest first
//   node --use-system-ca formd-load.js --commit --max 20 --gap 45
//   node --use-system-ca formd-load.js --commit --only 2026Q3,2026Q2
//   node --use-system-ca formd-load.js --search "acme"     # read the archive; no requests
//   node --use-system-ca formd-load.js --stats
'use strict';
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const Zip = require('./zipread.js');
const F = require('./formd.js');

const PAGE_URL = 'https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets';
const DIR = path.join(os.tmpdir(), 'tickrlab-sec');
const PAGE_FILE = path.join(DIR, 'formd-data-sets.html');
const LOCK = path.join(DIR, 'formd-load.lock');
const PAGE_MAX_AGE = 7 * 86400e3;
const MIN_GAP_S = 15;
const DAY_CAP = 100;

const UA = String(process.env.SEC_UA || `Tickr Lab (${process.env.REPORT_TO || process.env.MAIL_FROM || ''})`).trim();

function options(argv) {
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const max = arg('--max');
  return {
    commit: argv.includes('--commit'),
    max: max === 'all' ? Infinity : Math.max(1, Number(max) || 4),
    gapS: Math.max(MIN_GAP_S, Number(arg('--gap')) || 30),
    only: arg('--only') ? String(arg('--only')).toUpperCase().split(',').filter(Boolean) : null,
    search: arg('--search'),
    stats: argv.includes('--stats'),
  };
}

// The careful fetcher: one request, logged, judged. Returns a Buffer or
// throws an Error with .stop = true (never retried by anyone).
function makeGetter(archive, deps) {
  let last = 0;
  let made = 0;
  return async function get(url, gapMs, cap) {
    if (made >= cap) { const e = new Error(`reached this run's share of the ${DAY_CAP}-a-day cap; run again tomorrow`); e.stop = true; throw e; }
    const wait = last ? last + gapMs - deps.now() : 0;
    if (wait > 0) await deps.sleep(wait);
    const t0 = deps.now();
    let r;
    try {
      r = await deps.fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300000) });
    } catch (e) {
      last = deps.now(); made++;
      archive.noteRequest(url, 0, 0, deps.now() - t0);
      const err = new Error(`could not reach sec.gov (${e.message}). Stopped; nothing retried.`); err.stop = true; throw err;
    }
    const buf = r.status === 200 ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0);
    if (r.status !== 200) { try { await r.body?.cancel(); } catch (_) { /* nothing to drain */ } }
    last = deps.now(); made++;
    archive.noteRequest(url, r.status, buf.length, deps.now() - t0);
    const v = F.verdict(r.status);
    if (!v.go) { const e = new Error(v.why); e.stop = true; throw e; }
    return buf;
  };
}

// Read the six tables out of one quarter's ZIP.
function readZip(buf) {
  const tables = {};
  for (const e of Zip.entries(buf)) {
    const name = F.tableOf(e.name);
    if (name) tables[name] = F.parseTsv(Zip.read(buf, e).toString('utf8'));
  }
  if (!tables.FORMDSUBMISSION || !tables.OFFERING || !tables.ISSUERS) throw new Error('the ZIP lacks the submission, issuer or offering table');
  return tables;
}

async function run(opts, deps) {
  const log = deps.log || console.log;
  const A = deps.archive;
  if (opts.stats) { log(JSON.stringify(A.stats())); return { ok: true }; }
  if (opts.search) {
    for (const r of A.search(opts.search)) log([r.filed, r.form, r.name, r.city + ', ' + r.state, r.industry, 'sold ' + (r.sold == null ? '—' : '$' + r.sold.toLocaleString('en-US')), r.offered_indefinite ? 'offered indefinite' : 'offered ' + (r.offered == null ? '—' : '$' + r.offered.toLocaleString('en-US')), r.revenue_range || '—'].join(' | '));
    return { ok: true };
  }
  if (!/\(.+@.+\)|@/.test(UA)) throw new Error('no contact address for the SEC User-Agent: set SEC_UA or REPORT_TO in .env');

  const used = A.requestsSince(deps.now() - 86400e3);
  const cap = Math.max(0, DAY_CAP - used);
  log(`sec.gov requests in the last 24 hours: ${used} of ${DAY_CAP}`);
  const get = makeGetter(A, deps);
  const gapMs = opts.gapS * 1000;

  // The list of quarters: the page, from the week-old copy when there is one.
  let html = deps.readCache(PAGE_FILE, PAGE_MAX_AGE);
  if (!html) {
    if (cap < 1) throw new Error('the 24-hour request cap is used up; run again tomorrow');
    html = (await get(PAGE_URL, gapMs, cap)).toString('utf8');
    deps.writeCache(PAGE_FILE, html);
  }
  let sets = F.zipLinks(html);
  if (!sets.length) throw new Error('found no Form D data sets on the SEC page; its layout may have changed. Nothing downloaded.');
  const done = A.loaded();
  if (opts.only) sets = sets.filter((s) => opts.only.includes(s.quarter));
  const todo = sets.filter((s) => !done.has(s.quarter));
  log(`${sets.length} quarters listed (${sets[sets.length - 1].quarter} to ${sets[0].quarter}); ${sets.length - todo.length} already loaded; ${todo.length} to go`);
  if (!opts.commit) {
    const cached = todo.filter((s) => deps.cached(s.url)).length;
    log(`DRY RUN: would load up to ${Math.min(opts.max, todo.length)} (newest first), ${cached} of them already on disk, pausing ${opts.gapS}s between requests. Add --commit.`);
    return { ok: true, todo: todo.length };
  }

  let loadedN = 0;
  for (const s of todo.slice(0, opts.max)) {
    let buf = deps.cached(s.url);
    const fresh = !buf;
    try {
      if (fresh) buf = await get(s.url, gapMs, cap);
      const tables = readZip(buf);
      if (fresh) deps.writeCache(deps.cachePath(s.url), buf);
      const c = A.loadQuarter(s.quarter, s.url, tables, buf.length);
      loadedN++;
      log(`${s.quarter}: ${c.filings} filings, ${c.rows} rows${c.bad ? `, ${c.bad} unreadable rows skipped` : ''}${fresh ? '' : ' (from disk)'}`);
    } catch (e) {
      log(`${s.quarter}: ${e.message}`);
      if (e.stop) return { ok: false, loaded: loadedN, stopped: e.message };
      return { ok: false, loaded: loadedN, error: e.message };
    }
  }
  log(`done: ${loadedN} quarter(s) loaded; ${todo.length - loadedN} still to go.`);
  return { ok: true, loaded: loadedN, left: todo.length - loadedN };
}

function fileDeps() {
  fs.mkdirSync(DIR, { recursive: true });
  const cachePath = (url) => path.join(DIR, url.split('/').pop());
  return {
    fetch: (...a) => fetch(...a),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    cachePath,
    cached: (url) => { const f = cachePath(url); return fs.existsSync(f) && fs.statSync(f).size > 1000 ? fs.readFileSync(f) : null; },
    readCache: (file, maxAge) => (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < maxAge ? fs.readFileSync(file, 'utf8') : null),
    writeCache: (file, data) => fs.writeFileSync(file, data),
  };
}

// One run at a time: a lock file naming the process; a stale one is cleared.
function lock() {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(LOCK)) {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch (_) { /* not running */ }
    if (alive) throw new Error(`another formd-load run (pid ${pid}) is going; one at a time`);
  }
  fs.writeFileSync(LOCK, String(process.pid));
  return () => { try { fs.unlinkSync(LOCK); } catch (_) { /* gone */ } };
}

if (require.main === module) {
  const opts = options(process.argv);
  let unlock = () => {};
  (async () => {
    const network = opts.commit || !(opts.search || opts.stats);
    if (network) unlock = lock();
    const archive = require('./formdarchive.js').open();
    try {
      const r = await run(opts, { ...fileDeps(), archive });
      if (!r.ok) process.exitCode = 1;
    } finally { archive.close(); unlock(); }
  })().catch((e) => { console.error(e.message); unlock(); process.exit(1); });
}

module.exports = { run, options, makeGetter, readZip, DAY_CAP, MIN_GAP_S };
