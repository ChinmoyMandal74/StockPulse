// Back up the LOCAL databases (formd.db, the news, release and web archives,
// acq.db, health-history.db, analysis.db) into one zip to keep elsewhere, such as
// Google Drive. The owner, 2026-11-10, before travelling with the laptop.
//
// Each database is copied with SQLite's own VACUUM INTO, so the copy is whole and
// consistent even while a loader is writing, and takes in what still sits in the
// -wal file (a plain file copy can miss it). Each copy is then opened and its rows
// counted against the original, the copies are zipped (Windows' own tar.exe, zip64),
// the zip's listing is checked, and the unzipped copies are removed. Zips are
// never removed: every run adds one to backups/ (gitignored).
//
// Nothing leaves the machine. downloads/ (16 GB) is not included: every file in it
// can be fetched again; the databases are what took the work.
//
//   node --disable-warning=ExperimentalWarning backup-db.js            # every *.db in the project
//   node --disable-warning=ExperimentalWarning backup-db.js --only news-archive.db
//   node --disable-warning=ExperimentalWarning backup-db.js --keep-folder   # also keep the unzipped copies
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'backups');
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

const mb = (n) => (n / 1048576).toFixed(0) + ' MB';
const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

// Rows in every table of one database, by name.
function rowCounts(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const out = {};
    for (const { name } of db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all()) {
      out[name] = db.prepare(`select count(*) n from "${name.replace(/"/g, '""')}"`).get().n;
    }
    return out;
  } finally { db.close(); }
}

// One database into dest. The counts are taken from the original first, then the
// copy is made: a loader writing in between can only make the original larger.
function copyOne(src, dest) {
  const before = rowCounts(src);
  const db = new DatabaseSync(src, { readOnly: true });
  try { db.exec(`vacuum into '${dest.replace(/'/g, "''")}'`); } finally { db.close(); }
  const after = rowCounts(dest);
  return { tables: Object.keys(after).length, rows: Object.values(after).reduce((a, b) => a + b, 0), problems: compare(before, after) };
}

// What the copy lacks: a table, or rows the original had before the copy began.
function compare(before, after) {
  const problems = [];
  for (const [t, n] of Object.entries(before)) {
    if (!(t in after)) problems.push(`table ${t} missing from the copy`);
    else if (after[t] < n) problems.push(`table ${t}: ${after[t]} rows in the copy, ${n} in the original`);
  }
  return problems;
}

function zipFolder(dir, zip) {
  const r = spawnSync(TAR, ['-a', '-c', '-f', zip, '-C', path.dirname(dir), path.basename(dir)], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error('zip failed: ' + String(r.stderr || r.error || '').trim());
  const list = spawnSync(TAR, ['-t', '-f', zip], { encoding: 'utf8', maxBuffer: 1 << 20 });
  if (list.status !== 0) throw new Error('the zip could not be read back: ' + String(list.stderr || '').trim());
  return list.stdout.split(/\r?\n/).filter((l) => /\.db$/.test(l)).map((l) => path.basename(l));
}

function run(argv, opts = {}) {
  const log = opts.log || console.log;
  const root = opts.root || ROOT;
  const out = opts.out || OUT;
  const i = argv.indexOf('--only');
  const only = i >= 0 ? String(argv[i + 1] || '').split(',').filter(Boolean) : null;
  let files = fs.readdirSync(root).filter((f) => /\.db$/.test(f) && fs.statSync(path.join(root, f)).size > 0);
  if (only) files = files.filter((f) => only.includes(f));
  if (!files.length) throw new Error('no databases to back up');

  const name = 'tickrlab-db-' + (opts.stamp || stamp());
  const dir = path.join(out, name);
  fs.mkdirSync(dir, { recursive: true });
  let failed = false;
  for (const f of files) {
    const t0 = Date.now();
    const r = copyOne(path.join(root, f), path.join(dir, f));
    const size = fs.statSync(path.join(dir, f)).size;
    log(`${f}: ${r.tables} tables, ${r.rows.toLocaleString()} rows, ${mb(size)}, ${((Date.now() - t0) / 1000).toFixed(0)}s${r.problems.length ? '  PROBLEM: ' + r.problems.join('; ') : ''}`);
    if (r.problems.length) failed = true;
  }
  if (failed) { log(`Not zipped: a copy did not match. The copies are in ${dir}.`); return { ok: false, dir }; }

  const zip = dir + '.zip';
  const inZip = zipFolder(dir, zip);
  const missing = files.filter((f) => !inZip.includes(f));
  if (missing.length) { log(`The zip lacks ${missing.join(', ')}; the copies are kept in ${dir}.`); return { ok: false, dir, zip }; }
  if (!argv.includes('--keep-folder')) fs.rmSync(dir, { recursive: true, force: true });
  log(`Backup: ${zip} (${mb(fs.statSync(zip).size)}, ${files.length} databases). Upload it to Google Drive; it is not sent anywhere from here.`);
  return { ok: true, zip, files };
}

if (require.main === module) {
  try { if (!run(process.argv).ok) process.exitCode = 1; } catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = { run, copyOne, compare, rowCounts, zipFolder };
