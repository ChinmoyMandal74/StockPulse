// Form 5500: load the Labor Department's yearly data sets, keeping the plans of
// the Form D issuers (matched by EIN) in the local formd.db. Backlog 61, E2;
// docs/context/form-5500.md.
//
// LOCAL, BY HAND, AND SLOW ON PURPOSE, as the SEC loaders, though this is
// another agency (askebsa.dol.gov):
//   - bulk files only: two ZIPs a year (the full form and the short form,
//     30 to 140MB each), never a request per company;
//   - one request at a time, --gap seconds apart (60 by default, never under 30);
//   - every answer but a 200 stops the run, nothing retried;
//   - every ZIP is kept in the system temp folder and never fetched twice;
//   - at most 40 requests to the Labor Department in any 24 hours, counted
//     in the archive's own request log;
//   - one run at a time (a lock file); nothing schedules it.
// --rematch reads the ZIPs already on disk again, no request: after the
// Form D profiles change (new EINs), it finds their plans.
//
//   node --use-system-ca f5500-load.js                          # what it would do; no request
//   node --use-system-ca f5500-load.js --commit                 # up to 2 files, newest year first
//   node --use-system-ca f5500-load.js --commit --max all --gap 90
//   node --use-system-ca f5500-load.js --commit --years 2024,2023
//   node --use-system-ca f5500-load.js --rematch --commit       # the files on disk again
//   node --use-system-ca f5500-load.js --employers --commit      # every employer, from the files on disk; no request
//   node --use-system-ca f5500-load.js --stats
'use strict';
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const Zip = require('./zipread.js');
const P = require('./f5500.js');

const DIR = path.join(os.tmpdir(), 'tickrlab-dol');
const LOCK = path.join(DIR, 'f5500-load.lock');
const MIN_GAP_S = 30;
const DAY_CAP = 40;
const FIRST_YEAR = 2009;   // the first form year of the electronic filings
const UA = String(process.env.DOL_UA || `Tickr Lab research (${process.env.REPORT_TO || process.env.MAIL_FROM || ''})`).trim();

function options(argv, now = new Date()) {
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const max = arg('--max');
  const last = now.getFullYear() - 1;   // the newest year with a full file
  const years = arg('--years')
    ? String(arg('--years')).split(',').map(Number).filter((y) => y >= FIRST_YEAR && y <= now.getFullYear())
    : Array.from({ length: last - FIRST_YEAR + 1 }, (_, i) => last - i);
  return {
    commit: argv.includes('--commit'),
    max: max === 'all' ? Infinity : Math.max(1, Number(max) || 2),
    gapS: Math.max(MIN_GAP_S, Number(arg('--gap')) || 60),
    years,
    rematch: argv.includes('--rematch'),
    employers: argv.includes('--employers'),
    stats: argv.includes('--stats'),
  };
}

// The careful download: streamed to a part file, renamed when whole.
function makeGetter(A, deps) {
  let last = 0, made = 0;
  return async function get(url, dest, gapMs, cap) {
    if (made >= cap) { const e = new Error(`reached the ${DAY_CAP}-a-day cap; run again tomorrow`); e.stop = true; throw e; }
    const wait = last ? last + gapMs - deps.now() : 0;
    if (wait > 0) await deps.sleep(wait);
    const t0 = deps.now();
    let r;
    try { r = await deps.fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(1800000) }); }
    catch (e) {
      last = deps.now(); made++; A.noteRequest(url, 0, 0, deps.now() - t0);
      const err = new Error(`could not reach askebsa.dol.gov (${e.message}). Stopped; nothing retried.`); err.stop = true; throw err;
    }
    if (r.status !== 200) {
      try { await r.body?.cancel(); } catch (_) { /* nothing to drain */ }
      last = deps.now(); made++; A.noteRequest(url, r.status, 0, deps.now() - t0);
      const e = new Error(P.verdict(r.status).why); e.stop = true; throw e;
    }
    const bytes = await deps.save(r, dest);
    last = deps.now(); made++;
    A.noteRequest(url, 200, bytes, deps.now() - t0);
    return bytes;
  };
}

// Read one yearly ZIP on disk: the plans whose sponsor EIN is wanted.
async function readFile(file, kind, eins) {
  const csv = Zip.entriesOfFile(file).find((e) => /\.csv$/i.test(e.name));
  if (!csv) throw new Error(path.basename(file) + ' holds no CSV');
  let header = null, row = null, pending = '', read = 0, bad = 0, failed = null;
  const kept = [];
  // An error inside the line callback would escape the stream; it is caught
  // here, the reading stopped, and thrown once the stream has closed.
  await Zip.streamLines(file, csv, (line) => {
    try {
      const text = pending ? pending + '\n' + line : line;
      const f = P.splitCsv(text);
      if (!f) { pending = text; return undefined; }   // a quoted field runs on
      pending = '';
      if (!header) { header = f; row = P.reader(header, kind); return undefined; }
      read++;
      if (f.length !== header.length) { bad++; return undefined; }
      const r = row(f);
      if (r.ein && r.ack_id && eins.has(r.ein)) kept.push(r);
      return undefined;
    } catch (e) { failed = e; return false; }
  });
  if (failed) throw new Error(path.basename(file) + ': ' + failed.message);
  if (!header) throw new Error(path.basename(file) + ' is empty');
  return { rows: kept, read, bad };
}

// --employers: every employer with its own plan, from the files on disk (no
// request): per file, each EIN's plans in a plan year reduced to the largest
// (its headcount proxy, plan assets summed over its plans), then merged.
// A file merged once is recorded and not merged again.
async function employers(opts, deps) {
  const log = deps.log || console.log;
  const A = deps.archive;
  A.db.exec('create table if not exists f5500_emp_files (file text primary key, rows integer, at integer not null)');
  const done = new Set(A.db.prepare('select file from f5500_emp_files').all().map((r) => r.file));
  const files = opts.years.flatMap((y) => ['sf', 'full'].map((kind) => ({ year: y, kind, name: P.fileName(y, kind) })))
    .filter((f) => deps.onDisk(f.name) && !done.has(f.name));
  log(`${files.length} file(s) on disk not yet merged into the employer list${opts.commit ? '' : ' (DRY RUN: add --commit)'}`);
  if (!opts.commit) return { ok: true, todo: files.length };
  for (const f of files) {
    const t0 = deps.now();
    const csv = Zip.entriesOfFile(deps.pathOf(f.name)).find((e) => /\.csv$/i.test(e.name));
    let header = null, row = null, pending = '', read = 0, failed = null;
    const by = new Map();
    await Zip.streamLines(deps.pathOf(f.name), csv, (line) => {
      try {
        const t = pending ? pending + '\n' + line : line;
        const fl = P.splitCsv(t);
        if (!fl) { pending = t; return undefined; }
        pending = '';
        if (!header) { header = fl; row = P.reader(header, f.kind); return undefined; }
        if (fl.length !== header.length) return undefined;
        read++;
        const r = row(fl);
        if (!r.ein || !r.plan_year || !P.ownPlan(r)) return undefined;
        const year = Number(r.plan_year.slice(0, 4));
        const k = r.ein + '|' + year;
        const staff = P.headcount(r);
        const o = by.get(k);
        if (!o) { by.set(k, { ein: r.ein, year, name: r.sponsor, dba: r.dba, city: r.city, state: r.state, business_code: r.business_code, staff, participants: r.participants, active: r.active, net_assets: r.net_assets, filings: 1 }); return undefined; }
        o.filings++;
        if (r.net_assets != null) o.net_assets = (o.net_assets || 0) + r.net_assets;
        if ((staff ?? -1) > (o.staff ?? -1)) Object.assign(o, { name: r.sponsor, dba: r.dba, city: r.city, state: r.state, business_code: r.business_code || o.business_code, staff, participants: r.participants, active: r.active });
        return undefined;
      } catch (e) { failed = e; return false; }
    });
    if (failed) { log(`${f.name}: ${failed.message}`); return { ok: false, stopped: failed.message }; }
    A.mergeEmployers([...by.values()]);
    A.db.prepare('insert into f5500_emp_files (file, rows, at) values (?, ?, ?)').run(f.name, by.size, deps.now());
    log(`${f.name}: ${read.toLocaleString('en-US')} filings, ${by.size.toLocaleString('en-US')} employer-years merged, ${((deps.now() - t0) / 1000).toFixed(0)}s`);
  }
  const n = A.rebuildLatest();
  log(`the employer list: ${n.toLocaleString('en-US')} employers, newest year each.`);
  return { ok: true, employers: n };
}

async function run(opts, deps) {
  const log = deps.log || console.log;
  const A = deps.archive;
  if (opts.stats) { log(JSON.stringify(A.stats())); return { ok: true }; }
  if (opts.employers) return employers(opts, deps);
  const eins = A.issuerEins();
  if (!eins.size) throw new Error('no EINs to look for: run  formd-load.js --profiles --commit  first');
  const done = A.loaded();
  const files = [];
  for (const y of opts.years) for (const kind of ['sf', 'full']) files.push({ year: y, kind, name: P.fileName(y, kind), url: P.fileUrl(y, kind) });
  const todo = files.filter((f) => opts.rematch ? deps.onDisk(f.name) : !done.has(f.name));
  log(`${eins.size} issuer EINs to look for; ${files.length} files in range (${opts.years[opts.years.length - 1]} to ${opts.years[0]}); ${opts.rematch ? todo.length + ' on disk to read again' : done.size + ' loaded, ' + todo.length + ' to go'}`);
  if (!opts.rematch && !/@/.test(UA)) throw new Error('no contact address for the User-Agent: set DOL_UA or REPORT_TO in .env');
  if (!opts.commit) {
    const onDisk = todo.filter((f) => deps.onDisk(f.name)).length;
    log(`DRY RUN: would read up to ${Math.min(opts.max, todo.length)} file(s), newest first, ${onDisk} already on disk, ${opts.gapS}s between requests. Add --commit.`);
    return { ok: true, todo: todo.length };
  }
  const used = A.requestsSince(deps.now() - 86400e3);
  const cap = Math.max(0, DAY_CAP - used);
  if (!opts.rematch) log(`Labor Department requests in the last 24 hours: ${used} of ${DAY_CAP}`);
  const get = makeGetter(A, deps);
  let n = 0;
  for (const f of todo.slice(0, opts.rematch ? Infinity : opts.max)) {
    const dest = deps.pathOf(f.name);
    try {
      let bytes;
      if (deps.onDisk(f.name)) bytes = deps.sizeOf(f.name);
      else if (opts.rematch) continue;
      else bytes = await get(f.url, dest, opts.gapS * 1000, cap);
      const t0 = deps.now();
      const r = await readFile(dest, f.kind, eins);
      const added = A.loadFile({ file: f.name, year: f.year, kind: f.kind, bytes, read: r.read, bad: r.bad, eins: new Set(r.rows.map((x) => x.ein)).size }, r.rows);
      n++;
      log(`${f.name}: ${r.read.toLocaleString('en-US')} plan filings read, ${r.rows.length.toLocaleString('en-US')} of Form D issuers (${added} new)${r.bad ? `, ${r.bad} unreadable` : ''}, ${((deps.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) {
      log(`${f.name}: ${e.message}`);
      return { ok: false, read: n, stopped: e.message };
    }
  }
  log(`done: ${n} file(s) read.`);
  return { ok: true, read: n };
}

function fileDeps() {
  fs.mkdirSync(DIR, { recursive: true });
  const pathOf = (name) => path.join(DIR, name);
  return {
    fetch: (...a) => fetch(...a),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    pathOf,
    onDisk: (name) => fs.existsSync(pathOf(name)) && fs.statSync(pathOf(name)).size > 1e6,
    sizeOf: (name) => fs.statSync(pathOf(name)).size,
    // Streamed to NAME.part, renamed once whole, so a broken download never
    // passes for a file on disk.
    save: async (res, dest) => {
      const { Readable } = require('stream');
      const { pipeline } = require('stream/promises');
      const part = dest + '.part';
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part));
      const head = Buffer.alloc(4);
      const fd = fs.openSync(part, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
      if (head.readUInt32LE(0) !== 0x04034b50) { fs.unlinkSync(part); throw Object.assign(new Error('the download is not a ZIP. Stopped; nothing retried.'), { stop: true }); }
      fs.renameSync(part, dest);
      return fs.statSync(dest).size;
    },
  };
}

function lock() {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(LOCK)) {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch (_) { /* not running */ }
    if (alive) throw new Error(`another f5500-load run (pid ${pid}) is going; one at a time`);
  }
  fs.writeFileSync(LOCK, String(process.pid));
  return () => { try { fs.unlinkSync(LOCK); } catch (_) { /* gone */ } };
}

if (require.main === module) {
  const opts = options(process.argv);
  let unlock = () => {};
  (async () => {
    if (opts.commit) unlock = lock();
    const archive = require('./f5500archive.js').open();
    try {
      const r = await run(opts, { ...fileDeps(), archive });
      if (!r.ok) process.exitCode = 1;
    } finally { archive.close(); unlock(); }
  })().catch((e) => { console.error(e.message); unlock(); process.exit(1); });
}

module.exports = { run, employers, options, makeGetter, readFile, DAY_CAP, MIN_GAP_S, FIRST_YEAR };
