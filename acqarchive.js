// The acquisitions archive: private businesses bought by SEC filers, and the
// audited accounts the buyer had to file for them (backlog 61, phase 2;
// docs/context/acquired-companies.md). The sibling of formdarchive.js.
//
// LOCAL ONLY. A SQLite file beside formd.db (gitignored), written by
// acq-load.js and read by research scripts. Never in Turso, never served.
//
// WHAT IS KEPT
//   filers     every SEC filer in the bulk submissions file that ever filed an
//              8-K with item 2.01 (cik, name, tickers, in_universe)
//   filings    every candidate 8-K: the closing (2.01) and each amendment
//              (8-K/A with 9.01) filed after it, with the closing it follows
//   docs       a filing's documents from its index (type, file, description)
//   texts      the text of each exhibit read, so a reader fix costs no SEC
//              request (as releases-archive.db)
//   reads      one row an exhibit read by the model: what it is, the business,
//              auditor, opinion, the problems found, tokens and dollars
//   periods    one row a period of the business's statements (revenue, net
//              income, assets ...), each figure checked against the text
//   requests   every request to sec.gov, with its status
//   runs       every run and what it did
//
//   const A = require('./acqarchive.js').open();     // ACQ_DB or ./acq.db
'use strict';
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, 'acq.db');

const PERIOD_COLS = ['accn', 'file', 'seq', 'label', 'period_end', 'months', 'audited', 'currency', 'unit',
  'revenue', 'gross_profit', 'operating_income', 'net_income', 'total_assets', 'total_liabilities', 'total_equity',
  'cash', 'operating_cash_flow', 'printed'];

function open(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file || process.env.ACQ_DB || DEFAULT_PATH);
  db.exec('pragma busy_timeout = 10000; pragma journal_mode = wal;');
  db.exec(`
    create table if not exists filers (
      cik text primary key, name text, tickers text, sic text, in_universe integer not null default 0, symbol text
    );
    create table if not exists filings (
      accn text primary key, cik text not null, form text not null, filed text not null, report_date text,
      items text, doc text, role text not null, closing_accn text, list_file text not null
    );
    create index if not exists idx_acq_filings_cik on filings (cik, filed);
    create index if not exists idx_acq_filings_role on filings (role, filed);
    create table if not exists docs (
      accn text not null, seq integer, type text, file text not null, description text, primary key (accn, file)
    );
    create table if not exists indexed (accn text primary key, at integer not null, status integer, docs integer);
    create table if not exists texts (
      accn text not null, file text not null, chars integer, text text, fetched_at integer not null, primary key (accn, file)
    );
    create table if not exists reads (
      accn text not null, file text not null, model text, is_business integer, business text, kind text,
      currency text, basis text, auditor text, opinion text, what_it_does text, periods integer, problems text,
      in_tok integer, out_tok integer, usd real, read_at integer not null, answer text, primary key (accn, file)
    );
    create table if not exists periods (
      accn text not null, file text not null, seq integer not null, label text, period_end text, months integer,
      audited integer, currency text, unit text, revenue real, gross_profit real, operating_income real, net_income real,
      total_assets real, total_liabilities real, total_equity real, cash real, operating_cash_flow real, printed text,
      primary key (accn, file, seq)
    );
    create table if not exists requests (at integer not null, url text not null, status integer, bytes integer, ms integer);
    create index if not exists idx_acq_requests_at on requests (at);
    create table if not exists runs (started_at integer primary key, args text, summary text, finished_at integer);
  `);

  // Columns added after the first build.
  const readCols = new Set(db.prepare('pragma table_info(reads)').all().map((c) => c.name));
  if (!readCols.has('answer')) db.exec('alter table reads add column answer text');

  function noteRequest(url, status, bytes, ms) {
    try { db.prepare('insert into requests (at, url, status, bytes, ms) values (?, ?, ?, ?, ?)').run(Date.now(), url, status, bytes, ms); } catch (_) { /* bookkeeping */ }
  }
  const requestsSince = (ms) => db.prepare('select count(*) n from requests where at >= ?').get(ms).n;

  // The candidate list, replaced as one list file is read: a newer bulk file
  // knows every filing an older one did, so rows are upserted, never dropped.
  function writeList(filers, filings, listFile) {
    db.exec('begin');
    try {
      const f = db.prepare('insert into filers (cik, name, tickers, sic, in_universe, symbol) values (?, ?, ?, ?, ?, ?) on conflict(cik) do update set name = excluded.name, tickers = excluded.tickers, sic = excluded.sic, in_universe = excluded.in_universe, symbol = excluded.symbol');
      for (const r of filers) f.run(r.cik, r.name ?? null, r.tickers ?? null, r.sic ?? null, r.in_universe ? 1 : 0, r.symbol || null);
      const g = db.prepare('insert into filings (accn, cik, form, filed, report_date, items, doc, role, closing_accn, list_file) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(accn) do update set role = excluded.role, closing_accn = excluded.closing_accn, items = excluded.items, list_file = excluded.list_file');
      for (const r of filings) g.run(r.accn, r.cik, r.form, r.filed, r.reportDate || null, r.items || null, r.doc || null, r.role, r.closingAccn || null, listFile);
      db.exec('commit');
    } catch (e) { try { db.exec('rollback'); } catch (_) { /* already */ } throw e; }
  }

  function writeIndex(accn, status, docs) {
    db.exec('begin');
    try {
      const ins = db.prepare('insert or replace into docs (accn, seq, type, file, description) values (?, ?, ?, ?, ?)');
      for (const d of docs || []) ins.run(accn, d.seq == null ? null : d.seq, d.type || null, d.file, d.description || null);
      db.prepare('insert or replace into indexed (accn, at, status, docs) values (?, ?, ?, ?)').run(accn, Date.now(), status, (docs || []).length);
      db.exec('commit');
    } catch (e) { try { db.exec('rollback'); } catch (_) { /* already */ } throw e; }
  }
  const docsOf = (accn) => db.prepare('select * from docs where accn = ? order by seq, file').all(accn);
  const isIndexed = (accn) => !!db.prepare('select 1 from indexed where accn = ?').get(accn);

  const textOf = (accn, file) => { const r = db.prepare('select text from texts where accn = ? and file = ?').get(accn, file); return r ? r.text : null; };
  const writeText = (accn, file, text) => db.prepare('insert or replace into texts (accn, file, chars, text, fetched_at) values (?, ?, ?, ?, ?)').run(accn, file, String(text).length, text, Date.now());

  // One exhibit's reading, all or nothing; a second reading (after a reader
  // fix, with --force) replaces the first.
  function writeRead(accn, file, read, periods) {
    db.exec('begin');
    try {
      db.prepare('delete from periods where accn = ? and file = ?').run(accn, file);
      db.prepare(`insert or replace into reads (accn, file, model, is_business, business, kind, currency, basis, auditor, opinion, what_it_does, periods, problems, in_tok, out_tok, usd, read_at, answer)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(accn, file, read.model || null, read.is_business == null ? null : read.is_business ? 1 : 0,
        read.business || null, read.kind || null, read.currency || null, read.basis || null, read.auditor || null, read.opinion || null,
        read.what_it_does || null, (periods || []).length, (read.problems || []).length ? JSON.stringify(read.problems) : null,
        read.in_tok || 0, read.out_tok || 0, read.usd || 0, Date.now(), read.answer == null ? null : JSON.stringify(read.answer));
      const ins = db.prepare(`insert into periods (${PERIOD_COLS.join(', ')}) values (${PERIOD_COLS.map(() => '?').join(', ')})`);
      (periods || []).forEach((p, i) => ins.run(...PERIOD_COLS.map((c) => (c === 'accn' ? accn : c === 'file' ? file : c === 'seq' ? i : c === 'audited' ? (p.audited == null ? null : p.audited ? 1 : 0) : p[c] == null ? null : p[c]))));
      db.exec('commit');
    } catch (e) { try { db.exec('rollback'); } catch (_) { /* already */ } throw e; }
  }
  const isRead = (accn, file) => !!db.prepare('select 1 from reads where accn = ? and file = ?').get(accn, file);

  const startRun = (args) => { const t = Date.now(); db.prepare('insert into runs (started_at, args) values (?, ?)').run(t, args); return t; };
  const endRun = (t, summary) => { try { db.prepare('update runs set summary = ?, finished_at = ? where started_at = ?').run(JSON.stringify(summary), Date.now(), t); } catch (_) { /* bookkeeping */ } };

  const stats = () => ({
    filers: db.prepare('select count(*) n, sum(in_universe) u from filers').get(),
    filings: db.prepare('select role, count(*) n from filings group by role').all(),
    indexed: db.prepare('select count(*) n from indexed').get().n,
    texts: db.prepare('select count(*) n from texts').get().n,
    reads: db.prepare('select count(*) n, sum(is_business) b, sum(usd) usd from reads').get(),
    periods: db.prepare('select count(*) n from periods').get().n,
  });

  return { db, noteRequest, requestsSince, writeList, writeIndex, docsOf, isIndexed, textOf, writeText, writeRead, isRead, startRun, endRun, stats, close: () => db.close() };
}

module.exports = { open, DEFAULT_PATH, PERIOD_COLS };
