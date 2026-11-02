// The earnings release text archive: the text of each results press release
// (the 8-K's Exhibit 99.1) the releases loader reads, kept on the owner's
// machine for research (2026-11-01, the owner: "if the earning results that
// you fetch can also be stored locally so in future AI can be applied for
// example what did the companies says about data center buildout or
// inflation"). The sibling of newsarchive.js.
//
// LOCAL ONLY. A SQLite file beside analysis.db (gitignored), written by
// release-load.js on --commit and by release-archive-load.js (the history
// since 2017), and read by research scripts. Never in Turso, never deployed,
// never served. One copy on one machine. Unlike the news archive it can be
// rebuilt: a filing stays on sec.gov for good, and earnings_releases keeps
// every exhibit's address.
//
// WHAT IS KEPT: the release as text (releases.js toText, the same text the
// model is given; tables kept as " | " rows), gzipped, with the filing's
// accession number, company, filing day, the quarter as read, and whether the
// reading judged it a results release. One row a filing; nothing is ever
// replaced or deleted (the first text kept is the one kept). An exhibit the
// SEC would not give (a 404) is noted in `misses` so a fill does not ask again.
//
//   const R = require('./releasearchive.js').open();   // RELEASE_ARCHIVE_DB or ./releases-archive.db
//   R.put({ accn, symbol, filed, text, url, exhibit, period_end, period_label, is_results });
//   R.get(accn)                                         // { accn, text, ... } or null
//   R.forSymbol('NVDA', '2022-01-01', '2026-12-31')    // [{ accn, filed, period_label, chars }]
//   for (const r of R.each({ from: '2024-01-01' })) ... // every release with its text, oldest first
'use strict';
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const DEFAULT_PATH = path.join(__dirname, 'releases-archive.db');

function open(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file || process.env.RELEASE_ARCHIVE_DB || DEFAULT_PATH);
  // WAL and a wait, as the news archive: the history fill and a scheduled
  // releases run may write at the same time.
  db.exec('pragma busy_timeout = 10000; pragma journal_mode = wal;');
  db.exec(`
    create table if not exists releases (
      accn         text primary key,
      symbol       text not null,
      filed        text not null,
      period_end   text,
      period_label text,
      is_results   integer,
      url          text,
      exhibit      text,
      fetched_at   integer not null,
      chars        integer not null,
      sha          text not null,
      body         blob not null
    );
    create table if not exists misses (
      accn   text primary key,
      status integer,
      at     integer not null
    );
    create index if not exists idx_releases_symbol on releases (symbol, filed);
    create index if not exists idx_releases_filed on releases (filed);
  `);
  const ins = db.prepare(`insert or ignore into releases (accn, symbol, filed, period_end, period_label, is_results, url, exhibit, fetched_at, chars, sha, body)
                          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insMiss = db.prepare('insert or replace into misses (accn, status, at) values (?, ?, ?)');
  const getOne = db.prepare('select * from releases where accn = ?');
  const hasOne = db.prepare('select 1 from releases where accn = ?');
  const bySym = db.prepare('select accn, filed, period_end, period_label, is_results, chars from releases where symbol = ? and filed >= ? and filed <= ? order by filed');
  const unzip = (b) => zlib.gunzipSync(Buffer.from(b)).toString('utf8');
  const row = (r) => ({ accn: r.accn, symbol: r.symbol, filed: r.filed, period_end: r.period_end, period_label: r.period_label,
    is_results: r.is_results == null ? null : Number(r.is_results) === 1, url: r.url, exhibit: r.exhibit,
    fetched_at: Number(r.fetched_at), chars: Number(r.chars), text: unzip(r.body) });

  // { added: true } when the filing is new to the archive.
  function put(o) {
    const text = String((o && o.text) || '');
    if (!o || !o.accn || !o.symbol || !o.filed || !text) throw new Error('releasearchive.put needs accn, symbol, filed and text');
    const sha = crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
    const r = ins.run(String(o.accn), String(o.symbol).toUpperCase(), String(o.filed), o.period_end || null, o.period_label || null,
      o.is_results == null ? null : (o.is_results ? 1 : 0), o.url || null, o.exhibit || null, Date.now(), text.length, sha,
      zlib.gzipSync(Buffer.from(text, 'utf8')));
    return { added: Number(r.changes) > 0 };
  }
  const has = (accn) => !!hasOne.get(String(accn));
  const miss = (accn, status) => { insMiss.run(String(accn), status == null ? null : Number(status), Date.now()); };
  const missed = () => new Set(db.prepare('select accn from misses').all().map((r) => r.accn));
  const accns = () => new Set(db.prepare('select accn from releases').all().map((r) => r.accn));
  const get = (accn) => { const r = getOne.get(String(accn)); return r ? row(r) : null; };
  const forSymbol = (symbol, from, to) => bySym.all(String(symbol).toUpperCase(), String(from || ''), String(to || '9999'))
    .map((r) => ({ accn: r.accn, filed: r.filed, period_end: r.period_end, period_label: r.period_label, is_results: r.is_results == null ? null : Number(r.is_results) === 1, chars: Number(r.chars) }));
  // Every release in the window with its text, oldest first, one at a time
  // (the whole archive unzipped would not fit in memory comfortably).
  function* each(o) {
    const q = o || {};
    const it = db.prepare(`select * from releases where filed >= ? and filed <= ?${q.symbol ? ' and symbol = ?' : ''}${q.resultsOnly ? ' and is_results = 1' : ''} order by filed, accn`)
      .iterate(...[String(q.from || ''), String(q.to || '9999')].concat(q.symbol ? [String(q.symbol).toUpperCase()] : []));
    for (const r of it) yield row(r);
  }
  const count = () => Number(db.prepare('select count(*) n from releases').get().n);
  return { put, has, miss, missed, accns, get, forSymbol, each, count, close: () => db.close(), db };
}

module.exports = { open, DEFAULT_PATH };
