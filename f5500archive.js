// The Form 5500 archive (backlog 61, E2; docs/context/form-5500.md): the plans
// of the Form D issuers, matched by EIN, in their own tables inside the LOCAL
// formd.db, so the viewer joins them to the issuers directly. Never Turso,
// never served.
//
// WHAT IS KEPT
//   f5500_plans   one row a plan filing (its ACK_ID) whose sponsor EIN is a Form
//                 D issuer's: sponsor, plan, business code, participants, the
//                 short form's net assets, plan types, the sponsor's city and
//                 state. No street, telephone or signer (f5500.js)
//   f5500_loads   each yearly file read: when, how many rows, how many kept
//   dol_requests  every request to askebsa.dol.gov, with its status
// Rows are inserted, never replaced: an amended filing is a new ACK_ID, so a
// later copy of the same file only adds.
//
//   const A = require('./f5500archive.js').open();   // FORMD_DB or ./formd.db
'use strict';
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, 'formd.db');
const COLS = ['ack_id', 'form', 'form_year', 'ein', 'sponsor', 'dba', 'plan', 'plan_num', 'plan_year', 'business_code',
  'participants', 'active', 'active_boy', 'net_assets', 'pension', 'welfare', 'city', 'state', 'file'];

// The tables, made by this module and by formdarchive.js (they share formd.db).
function ensureSchema(db) {
  db.exec(`
    create table if not exists f5500_plans (
      ack_id text primary key, form text not null, form_year integer not null, ein text not null, sponsor text, dba text, plan text,
      plan_num text, plan_year text, business_code text, participants real, active real, active_boy real, net_assets real,
      pension text, welfare text, city text, state text, file text not null
    );
    create index if not exists idx_f5500_ein on f5500_plans (ein, plan_year);
    create table if not exists f5500_loads (
      file text primary key, year integer not null, kind text not null, bytes integer, rows_read integer, rows_kept integer,
      bad integer, eins integer, loaded_at integer not null
    );
    create table if not exists dol_requests (at integer not null, url text not null, status integer, bytes integer, ms integer);
  `);
}

function open(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file || process.env.FORMD_DB || DEFAULT_PATH);
  db.exec('pragma busy_timeout = 10000; pragma journal_mode = wal;');
  ensureSchema(db);

  // The EINs to look for: every Form D issuer's, from its newest SEC profile.
  function issuerEins() {
    const t = db.prepare("select count(*) n from sqlite_master where name = 'fd_profiles'").get().n;
    if (!t) return new Set();
    return new Set(db.prepare('select distinct ein from fd_profiles where ein is not null').all().map((r) => r.ein));
  }

  // One yearly file, all or nothing.
  function loadFile(meta, rows) {
    db.exec('begin');
    try {
      const ins = db.prepare(`insert or ignore into f5500_plans (${COLS.join(', ')}) values (${COLS.map(() => '?').join(', ')})`);
      let added = 0;
      for (const r of rows) added += Number(ins.run(...COLS.map((c) => (c === 'form_year' ? meta.year : c === 'file' ? meta.file : r[c] ?? null))).changes);
      db.prepare('insert or replace into f5500_loads (file, year, kind, bytes, rows_read, rows_kept, bad, eins, loaded_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(meta.file, meta.year, meta.kind, meta.bytes || null, meta.read, rows.length, meta.bad, meta.eins, Date.now());
      db.exec('commit');
      return added;
    } catch (e) { try { db.exec('rollback'); } catch (_) { /* already */ } throw e; }
  }
  const loaded = () => new Map(db.prepare('select * from f5500_loads').all().map((r) => [r.file, r]));

  function noteRequest(url, status, bytes, ms) {
    try { db.prepare('insert into dol_requests (at, url, status, bytes, ms) values (?, ?, ?, ?, ?)').run(Date.now(), url, status, bytes, ms); } catch (_) { /* bookkeeping */ }
  }
  const requestsSince = (ms) => db.prepare('select count(*) n from dol_requests where at >= ?').get(ms).n;

  const stats = () => ({
    files: db.prepare('select count(*) n, sum(rows_read) read, sum(rows_kept) kept from f5500_loads').get(),
    plans: db.prepare('select count(*) n, count(distinct ein) eins from f5500_plans').get(),
  });

  return { db, issuerEins, loadFile, loaded, noteRequest, requestsSince, stats, close: () => db.close() };
}

module.exports = { open, ensureSchema, DEFAULT_PATH, COLS };
