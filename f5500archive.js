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
    -- Every employer with its own plan (2026-11-09; not only the Form D
    -- issuers): one row an EIN a plan year, its largest plan's headcount and
    -- the plan filings counted. Built from the yearly files on disk
    -- (f5500-load.js --employers); a later file only raises a count or adds a year.
    create table if not exists f5500_employers (
      ein text not null, year integer not null, name text, dba text, city text, state text, business_code text,
      staff real, participants real, active real, net_assets real, filings integer not null default 1,
      primary key (ein, year)
    );
    -- The newest year of each employer, with its first year for growth:
    -- what the viewer lists. Derived from f5500_employers; rebuilt whole.
    create table if not exists f5500_latest (
      ein text primary key, year integer, name text, dba text, city text, state text, business_code text, staff real,
      first_year integer, first_staff real, y2019 real, years integer
    );
    create index if not exists idx_f5500_latest_name on f5500_latest (name collate nocase);
    create index if not exists idx_f5500_latest_staff on f5500_latest (staff);
    create index if not exists idx_f5500_latest_code on f5500_latest (business_code);
    -- Every name each employer has filed under (and traded as), so a search
    -- finds a company by an old name: Continental Electrical Construction is
    -- FourGen Holdings from 2019. Derived; rebuilt with f5500_latest.
    create table if not exists f5500_names (ein text not null, name text not null, primary key (ein, name));
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

  // One file's employers (rows keyed ein|year, already reduced to the
  // largest plan), merged in: a year already on file keeps the larger count
  // and adds the filings. All or nothing.
  function mergeEmployers(rows) {
    db.exec('begin');
    try {
      const up = db.prepare(`insert into f5500_employers (ein, year, name, dba, city, state, business_code, staff, participants, active, net_assets, filings)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(ein, year) do update set
          filings = filings + excluded.filings,
          name = case when coalesce(excluded.staff, -1) > coalesce(staff, -1) then excluded.name else name end,
          dba = case when coalesce(excluded.staff, -1) > coalesce(staff, -1) then excluded.dba else dba end,
          city = case when coalesce(excluded.staff, -1) > coalesce(staff, -1) then excluded.city else city end,
          state = case when coalesce(excluded.staff, -1) > coalesce(staff, -1) then excluded.state else state end,
          business_code = coalesce(case when coalesce(excluded.staff, -1) > coalesce(staff, -1) then excluded.business_code end, business_code, excluded.business_code),
          participants = case when coalesce(excluded.staff, -1) > coalesce(staff, -1) then excluded.participants else participants end,
          active = case when coalesce(excluded.staff, -1) > coalesce(staff, -1) then excluded.active else active end,
          net_assets = case when coalesce(excluded.staff, -1) > coalesce(staff, -1) then coalesce(excluded.net_assets, net_assets) else coalesce(net_assets, excluded.net_assets) end,
          staff = nullif(max(coalesce(staff, -1), coalesce(excluded.staff, -1)), -1)`);
      for (const r of rows) up.run(r.ein, r.year, r.name ?? null, r.dba ?? null, r.city ?? null, r.state ?? null, r.business_code ?? null, r.staff ?? null, r.participants ?? null, r.active ?? null, r.net_assets ?? null, r.filings || 1);
      db.exec('commit');
    } catch (e) { try { db.exec('rollback'); } catch (_) { /* already */ } throw e; }
    return rows.length;
  }

  // The newest year of each employer, rebuilt from f5500_employers (derived,
  // so replaced whole; the yearly rows it comes from are never touched).
  function rebuildLatest() {
    db.exec('begin');
    try {
      db.exec('delete from f5500_latest');
      db.exec(`insert into f5500_latest (ein, year, name, dba, city, state, business_code, staff, first_year, first_staff, y2019, years)
        select e.ein, e.year, e.name, e.dba, e.city, e.state, e.business_code, e.staff,
          f.first_year, (select staff from f5500_employers x where x.ein = e.ein and x.year = f.first_year),
          (select staff from f5500_employers x where x.ein = e.ein and x.year = 2019), f.years
        from f5500_employers e
        join (select ein, max(year) last_year, min(year) first_year, count(*) years from f5500_employers group by ein) f
          on f.ein = e.ein and f.last_year = e.year`);
      db.exec('delete from f5500_names');
      db.exec(`insert or ignore into f5500_names (ein, name)
        select ein, name from f5500_employers where name is not null
        union select ein, dba from f5500_employers where dba is not null`);
      db.exec('commit');
    } catch (e) { try { db.exec('rollback'); } catch (_) { /* already */ } throw e; }
    return db.prepare('select count(*) n from f5500_latest').get().n;
  }

  function noteRequest(url, status, bytes, ms) {
    try { db.prepare('insert into dol_requests (at, url, status, bytes, ms) values (?, ?, ?, ?, ?)').run(Date.now(), url, status, bytes, ms); } catch (_) { /* bookkeeping */ }
  }
  const requestsSince = (ms) => db.prepare('select count(*) n from dol_requests where at >= ?').get(ms).n;

  const stats = () => ({
    files: db.prepare('select count(*) n, sum(rows_read) read, sum(rows_kept) kept from f5500_loads').get(),
    plans: db.prepare('select count(*) n, count(distinct ein) eins from f5500_plans').get(),
  });

  return { db, issuerEins, loadFile, loaded, mergeEmployers, rebuildLatest, noteRequest, requestsSince, stats, close: () => db.close() };
}

module.exports = { open, ensureSchema, DEFAULT_PATH, COLS };
