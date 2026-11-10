// The Form C archive (backlog 61, E3): the SEC's crowdfunding data sets, kept in
// the LOCAL formd.db beside Form D (formdarchive.js opens the file and owns the
// shared `requests` log). Never Turso, never served. Notes: docs/context/form-c.md.
//
// WHAT IS KEPT: every table in each quarter's ZIP as published (every column, as
// text, under the file's own header names, plus the quarter), in fc_<table>;
// every quarter loaded (`fc_loads`); and once built, one summary row a filing
// (`formc`, formc.js summarise). A quarter loads in one transaction and is never
// loaded twice, so history only grows.
//
//   const C = require('./formcarchive.js').open(db);   // db: formdarchive's
//   C.loaded()                                         // Set of quarters done
//   C.loadQuarter(quarter, url, tables, bytes)         // tables: { DISCLOSURE: {header, rows, bad}, ... }
'use strict';
const FC = require('./formc.js');

const ident = (s) => '"' + String(s).replace(/[^A-Za-z0-9_]/g, '_') + '"';
const colOf = (h) => String(h).replace(/[^A-Za-z0-9_]/g, '_');
const tableName = (name) => 'fc_' + String(name).toLowerCase().replace(/[^a-z0-9_]/g, '_');

function ensureSchema(db) {
  db.exec(`create table if not exists fc_loads (
      quarter text primary key, url text not null, bytes integer, filings integer, rows integer, bad integer, tables text, loaded_at integer not null
    );`);
}

function open(db) {
  ensureSchema(db);
  const known = new Map();
  function ensureRaw(name, header) {
    const t = tableName(name);
    let cols = known.get(t);
    if (!cols) {
      db.exec(`create table if not exists ${ident(t)} (quarter text not null)`);
      cols = new Set(db.prepare(`pragma table_info(${ident(t)})`).all().map((c) => c.name));
      known.set(t, cols);
    }
    for (const h of header) {
      const c = colOf(h);
      if (!c || cols.has(c)) continue;
      db.exec(`alter table ${ident(t)} add column ${ident(c)} text`);
      cols.add(c);
    }
    const a = FC.accnCol(header);
    if (a) db.exec(`create index if not exists ${ident('idx_' + t + '_accn')} on ${ident(t)} (${ident(colOf(a))})`);
    return t;
  }

  const loaded = () => new Set(db.prepare('select quarter from fc_loads').all().map((r) => r.quarter));

  // One quarter, all or nothing. Returns the counts written.
  function loadQuarter(quarter, url, tables, bytes) {
    if (loaded().has(quarter)) return { skipped: true };
    const counts = { filings: 0, rows: 0, bad: 0 };
    const accns = new Set();
    db.exec('begin');
    try {
      for (const [name, t] of Object.entries(tables)) {
        if (!t.header || !t.header.length) continue;
        const tn = ensureRaw(name, t.header);
        const cols = t.header.map(colOf);
        const ins = db.prepare(`insert into ${ident(tn)} (quarter, ${cols.map(ident).join(', ')}) values (?, ${cols.map(() => '?').join(', ')})`);
        const a = FC.accnCol(t.header);
        for (const r of t.rows) {
          ins.run(quarter, ...t.header.map((h) => r[h]));
          counts.rows++;
          if (a && r[a]) accns.add(r[a]);
        }
        counts.bad += t.bad || 0;
      }
      counts.filings = accns.size;
      db.prepare('insert into fc_loads (quarter, url, bytes, filings, rows, bad, tables, loaded_at) values (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(quarter, url, bytes || null, counts.filings, counts.rows, counts.bad, Object.keys(tables).join(','), Date.now());
      db.exec('commit');
    } catch (e) {
      try { db.exec('rollback'); } catch (_) { /* already rolled back */ }
      known.clear();   // the rollback undid any table or column made inside it
      throw e;
    }
    return counts;
  }

  const stats = () => ({
    quarters: db.prepare('select count(*) n, min(quarter) a, max(quarter) b, sum(filings) filings, sum(rows) rows, sum(bad) bad from fc_loads').get(),
  });

  return { loaded, loadQuarter, stats, tableName };
}

module.exports = { open, ensureSchema, tableName };
