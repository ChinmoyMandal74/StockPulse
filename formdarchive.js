// The Form D archive: every Form D filing from the SEC's quarterly data sets,
// kept on the owner's machine (backlog 61, phase 1; docs/context/form-d.md).
// The sibling of releasearchive.js and newsarchive.js.
//
// LOCAL ONLY. A SQLite file beside analysis.db (gitignored), written by
// formd-load.js and read by research scripts. Never in Turso, never deployed,
// never served. It holds people's names and addresses (Form D's related
// persons), which is a reason on its own to keep it here until the owner
// decides otherwise.
//
// WHAT IS KEPT: the six tables as the SEC publishes them (every column, as
// text, under the file's own header names, plus the quarter), one summary row
// a filing (`formd`, from formd.js summarise), every quarter loaded
// (`loads`) and every request made to sec.gov (`requests`). A quarter loads in
// one transaction; rows are inserted, never replaced, so history only grows.
//
//   const A = require('./formdarchive.js').open();   // FORMD_DB or ./formd.db
//   A.loaded()                                       // Set of quarters done
//   A.loadQuarter(quarter, url, tables, bytes)       // tables: { OFFERING: {header, rows}, ... }
//   A.noteRequest(url, status, bytes, ms)
//   A.search('acme')                                 // summary rows by issuer name
'use strict';
const path = require('path');
const F = require('./formd.js');

const DEFAULT_PATH = path.join(__dirname, 'formd.db');
const ident = (s) => '"' + String(s).replace(/[^A-Za-z0-9_]/g, '_') + '"';

const SUMMARY_COLS = ['accn', 'quarter', 'filed', 'form', 'cik', 'name', 'city', 'state', 'entity_type', 'year_inc', 'issuers',
  'industry', 'fund_type', 'revenue_range', 'nav_range', 'exemptions', 'amendment', 'previous_accn', 'first_sale', 'yet_to_occur',
  'offered', 'offered_indefinite', 'sold', 'remaining', 'investors', 'min_investment', 'business_combination', 'equity', 'debt', 'pooled'];

function open(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file || process.env.FORMD_DB || DEFAULT_PATH);
  db.exec('pragma busy_timeout = 10000; pragma journal_mode = wal;');
  db.exec(`
    create table if not exists formd (
      accn text primary key, quarter text not null, filed text, form text, cik text, name text, city text, state text,
      entity_type text, year_inc integer, issuers integer, industry text, fund_type text, revenue_range text, nav_range text,
      exemptions text, amendment integer, previous_accn text, first_sale text, yet_to_occur integer,
      offered real, offered_indefinite integer, sold real, remaining real, investors real, min_investment real,
      business_combination integer, equity integer, debt integer, pooled integer
    );
    create index if not exists idx_formd_cik on formd (cik, filed);
    create index if not exists idx_formd_name on formd (name collate nocase);
    create index if not exists idx_formd_filed on formd (filed);
    create table if not exists loads (
      quarter text primary key, url text not null, bytes integer, filings integer, rows integer, bad integer, loaded_at integer not null
    );
    create table if not exists requests (
      at integer not null, url text not null, status integer, bytes integer, ms integer
    );
  `);

  // A raw table under the file's own column names; a column an older (or
  // newer) quarter adds is added, never dropped.
  const known = new Map();
  function ensureRaw(name, header) {
    const spec = F.TABLES[name];
    let cols = known.get(spec.table);
    if (!cols) {
      const pk = spec.key.map(ident).join(', ');
      db.exec(`create table if not exists ${ident(spec.table)} (quarter text not null, ${spec.key.map((k) => ident(k) + ' text not null').join(', ')}, primary key (${pk}))`);
      cols = new Set(db.prepare(`pragma table_info(${ident(spec.table)})`).all().map((c) => c.name));
      known.set(spec.table, cols);
    }
    for (const h of header) {
      const c = String(h).replace(/[^A-Za-z0-9_]/g, '_');
      if (!c || cols.has(c)) continue;
      db.exec(`alter table ${ident(spec.table)} add column ${ident(c)} text`);
      cols.add(c);
    }
  }

  const loaded = () => new Set(db.prepare('select quarter from loads').all().map((r) => r.quarter));

  // One quarter, all or nothing. Returns the counts written.
  function loadQuarter(quarter, url, tables, bytes) {
    if (loaded().has(quarter)) return { skipped: true };
    const counts = { filings: 0, rows: 0, bad: 0 };
    db.exec('begin');
    try {
      for (const [name, t] of Object.entries(tables)) {
        if (!t.header || !t.header.length || !F.TABLES[name]) continue;
        ensureRaw(name, t.header);
        const spec = F.TABLES[name];
        const cols = t.header.map((h) => String(h).replace(/[^A-Za-z0-9_]/g, '_'));
        const ins = db.prepare(`insert or ignore into ${ident(spec.table)} (quarter, ${cols.map(ident).join(', ')}) values (?, ${cols.map(() => '?').join(', ')})`);
        for (const r of t.rows) {
          if (spec.key.some((k) => r[k] == null)) { counts.bad++; continue; }
          ins.run(quarter, ...t.header.map((h) => r[h]));
          counts.rows++;
        }
        counts.bad += t.bad || 0;
      }
      // The summary: one row a filing.
      const byAccn = (name) => {
        const m = new Map();
        for (const r of (tables[name] || { rows: [] }).rows) {
          if (!r.ACCESSIONNUMBER) continue;
          if (!m.has(r.ACCESSIONNUMBER)) m.set(r.ACCESSIONNUMBER, []);
          m.get(r.ACCESSIONNUMBER).push(r);
        }
        return m;
      };
      const iss = byAccn('ISSUERS'), off = byAccn('OFFERING');
      const ins = db.prepare(`insert or ignore into formd (${SUMMARY_COLS.join(', ')}) values (${SUMMARY_COLS.map(() => '?').join(', ')})`);
      for (const sub of (tables.FORMDSUBMISSION || { rows: [] }).rows) {
        const s = F.summarise(sub, iss.get(sub.ACCESSIONNUMBER), (off.get(sub.ACCESSIONNUMBER) || [])[0], quarter);
        if (!s) continue;
        ins.run(...SUMMARY_COLS.map((c) => s[c]));
        counts.filings++;
      }
      db.prepare('insert into loads (quarter, url, bytes, filings, rows, bad, loaded_at) values (?, ?, ?, ?, ?, ?, ?)')
        .run(quarter, url, bytes || null, counts.filings, counts.rows, counts.bad, Date.now());
      db.exec('commit');
    } catch (e) {
      try { db.exec('rollback'); } catch (_) { /* already rolled back */ }
      known.clear();   // the rollback undid any table or column made inside it
      throw e;
    }
    return counts;
  }

  // Bookkeeping never fails the run.
  function noteRequest(url, status, bytes, ms) {
    try { db.prepare('insert into requests (at, url, status, bytes, ms) values (?, ?, ?, ?, ?)').run(Date.now(), url, status, bytes, ms); } catch (_) { /* bookkeeping */ }
  }
  const requestsSince = (ms) => db.prepare('select count(*) n from requests where at >= ?').get(ms).n;

  const search = (q, limit = 50) => db.prepare('select * from formd where name like ? collate nocase order by filed desc limit ?').all('%' + q + '%', limit);
  const stats = () => ({
    quarters: db.prepare('select count(*) n, min(quarter) a, max(quarter) b from loads').get(),
    filings: db.prepare('select count(*) n from formd').get().n,
  });

  return { db, loaded, loadQuarter, noteRequest, requestsSince, search, stats, close: () => db.close() };
}

module.exports = { open, DEFAULT_PATH };
