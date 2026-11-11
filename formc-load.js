// Form C and Regulation A: load the SEC's quarterly Crowdfunding Offerings data
// sets (E3) or Regulation A data sets (E4, --set rega) into the local archive
// (formd.db, formcarchive.js). Backlog 61; docs/context/form-c.md, reg-a.md.
//
// LOCAL, BY HAND, AND SLOW ON PURPOSE, with Form D's care (formd-load.js):
//   - bulk files only: one ZIP a quarter since 2016 Q2; never a request a filing;
//   - one request at a time, --gap seconds apart (60 by default, never under 15);
//   - every answer but a 200 stops the run, with nothing retried;
//   - every file is kept in the project's downloads folder (gitignored) and never fetched twice; the
//     data-set page is kept for a week;
//   - at most 100 requests to sec.gov in any 24 hours, counted TOGETHER with
//     Form D's log (formd.db) and the acquired-companies loader's (acq.db);
//   - one run at a time (a lock file); nothing schedules it.
//
//   node --use-system-ca formc-load.js                    # what it would do; no requests unless the page is not cached
//   node --use-system-ca formc-load.js --commit           # up to 4 quarters, newest first
//   node --use-system-ca formc-load.js --commit --max all --gap 60
//   node --use-system-ca formc-load.js --commit --only 2026Q2
//   node --use-system-ca formc-load.js --stats
//   node --use-system-ca formc-load.js --summarise [--commit]   # the formc summary from the stored tables; no requests
//   node --use-system-ca formc-load.js --set rega [...]         # the Regulation A data sets, the same way
'use strict';
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const Zip = require('./zipread.js');
const FC = require('./formc.js');
const { makeGetter } = require('./formd-load.js');

const PAGE_URL = FC.SETS.formc.page;
const DIR = path.join(__dirname, 'downloads', 'sec');
// One run at a time across both data sets: the same address, the same pauses.
const LOCK = path.join(DIR, 'formc-load.lock');
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
    gapS: Math.max(MIN_GAP_S, Number(arg('--gap')) || 60),
    only: arg('--only') ? String(arg('--only')).toUpperCase().split(',').filter(Boolean) : null,
    stats: argv.includes('--stats'),
    summarise: argv.includes('--summarise'),
    set: FC.SETS[arg('--set') || 'formc'] || (() => { throw new Error('--set is formc or rega'); })(),
  };
}

// Every table in one quarter's ZIP. At least one must carry accession numbers.
function readZip(buf) {
  const tables = {};
  for (const e of Zip.entries(buf)) {
    const name = FC.tableOf(e.name);
    if (name) tables[name] = FC.parseTsv(Zip.read(buf, e).toString('utf8'));
  }
  if (!Object.values(tables).some((t) => FC.accnCol(t.header))) throw new Error('the ZIP holds no table with accession numbers; its layout may have changed. Nothing loaded.');
  return tables;
}

async function run(opts, deps) {
  const log = deps.log || console.log;
  const C = deps.formc;
  if (opts.stats) { log(JSON.stringify(C.stats())); return { ok: true }; }
  if (opts.summarise) return deps.summarise(opts, deps);
  if (!/\(.+@.+\)|@/.test(UA)) throw new Error('no contact address for the SEC User-Agent: set SEC_UA or REPORT_TO in .env');

  const used = deps.secRequestsSince(deps.now() - 86400e3);
  const cap = Math.max(0, DAY_CAP - used);
  log(`sec.gov requests in the last 24 hours (Form D, Form C, Reg A and acquired companies together): ${used} of ${DAY_CAP}`);
  const get = makeGetter(deps.archive, deps);
  const gapMs = opts.gapS * 1000;

  const SET = opts.set || FC.SETS.formc;
  const pageFile = path.join(DIR, SET.pageFile);
  let html = deps.readCache(pageFile, PAGE_MAX_AGE);
  if (!html) {
    if (cap < 1) throw new Error('the 24-hour request cap is used up; run again tomorrow');
    html = (await get(SET.page, gapMs, cap)).toString('utf8');
    deps.writeCache(pageFile, html);
  }
  let sets = FC.zipLinks(html, SET);
  if (!sets.length) throw new Error(`found no ${SET.name} data sets on the SEC page; its layout may have changed. Nothing downloaded.`);
  const done = C.loaded();
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
      const c = C.loadQuarter(s.quarter, s.url, tables, buf.length);
      loadedN++;
      log(`${s.quarter}: ${c.filings} filings, ${c.rows} rows in ${Object.keys(tables).length} tables${c.bad ? `, ${c.bad} unreadable rows skipped` : ''}${fresh ? '' : ' (from disk)'}`);
    } catch (e) {
      log(`${s.quarter}: ${e.message}`);
      return { ok: false, loaded: loadedN, [e.stop ? 'stopped' : 'error']: e.message };
    }
  }
  log(`done: ${loadedN} quarter(s) loaded; ${todo.length - loadedN} still to go.`);
  if (loadedN && deps.summarise) deps.summarise({ commit: true }, deps);   // the formc summary, from what is stored; no requests
  return { ok: true, loaded: loadedN, left: todo.length - loadedN };
}

function fileDeps(archive) {
  fs.mkdirSync(DIR, { recursive: true });
  const cachePath = (url) => path.join(DIR, url.split('/').pop());
  const acqFile = path.join(__dirname, 'acq.db');
  return {
    fetch: (...a) => fetch(...a),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    cachePath,
    cached: (url) => { const f = cachePath(url); return fs.existsSync(f) && fs.statSync(f).size > 1000 ? fs.readFileSync(f) : null; },
    readCache: (file, maxAge) => (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < maxAge ? fs.readFileSync(file, 'utf8') : null),
    writeCache: (file, data) => fs.writeFileSync(file, data),
    // The one SEC address, so one count: Form D and Form C share formd.db's log; acq.db keeps its own.
    secRequestsSince: (ms) => {
      let n = archive.requestsSince(ms);
      if (fs.existsSync(acqFile)) {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(acqFile, { readOnly: true });
        try { n += db.prepare('select count(*) n from requests where at >= ?').get(ms).n; } finally { db.close(); }
      }
      return n;
    },
  };
}

function lock() {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(LOCK)) {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch (_) { /* not running */ }
    if (alive) throw new Error(`another formc-load run (pid ${pid}) is going; one at a time`);
  }
  fs.writeFileSync(LOCK, String(process.pid));
  return () => { try { fs.unlinkSync(LOCK); } catch (_) { /* gone */ } };
}

if (require.main === module) {
  const opts = options(process.argv);
  let unlock = () => {};
  (async () => {
    if (opts.commit) unlock = lock();
    const archive = require('./formdarchive.js').open();
    const formc = require('./formcarchive.js').open(archive.db, opts.set);
    // Each data set's own summary: formc's in formcarchive.js, Reg A's in rega.js.
    const summarise = opts.set.key === 'rega' ? (o, d) => require('./rega.js').summarise(archive.db, o, d) : (o, d) => require('./formcarchive.js').summarise(archive.db, o, d);
    try {
      const r = await run(opts, { ...fileDeps(archive), archive, formc, summarise });
      if (!r.ok) process.exitCode = 1;
    } finally { archive.close(); unlock(); }
  })().catch((e) => { console.error(e.message); unlock(); process.exit(1); });
}

module.exports = { run, options, readZip, DAY_CAP, MIN_GAP_S, PAGE_URL };
