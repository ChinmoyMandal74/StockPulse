// The article text archive: the text the tone loader read for each article,
// kept on the owner's machine for research (2026-11-01, the owner: "Let's go
// ahead with both", a local archive and the extra facts in newstone.js).
//
// LOCAL ONLY. A SQLite file beside analysis.db (gitignored), written by
// news-tone-load.js on --commit and read by research scripts. Never in Turso,
// never deployed, never served to anyone: the text is the publishers', and
// newstone.js keeps only a description of it in the database. One copy on
// one machine, so it is lost with the machine unless it is backed up.
//
// WHAT IS KEPT: the extracted article text (newstone.js articleText, the same
// text the model was given, whole rather than cut at MAX_CHARS), gzipped;
// the headline, publisher, host and publication time; and which stocks' feeds
// carried it. One row an article address, however many feeds carried it.
// Nothing is ever replaced or deleted: the first text kept for an address is
// the one kept.
//
//   const A = require('./newsarchive.js').open();      // NEWS_ARCHIVE_DB or ./news-archive.db
//   A.put({ url, symbol, text, headline, source, host, published_at });
//   A.get(url)                                          // { url, text, ... } or null
//   A.forSymbol('NOW', '2026-10-23', '2026-11-01')      // [{ url, headline, published_at, chars }]
'use strict';
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const DEFAULT_PATH = path.join(__dirname, 'news-archive.db');

function open(file) {
  // Required here rather than at the top, so a host without node:sqlite (or a
  // test that never opens the file) can still load the module.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file || process.env.NEWS_ARCHIVE_DB || DEFAULT_PATH);
  // WAL, so a research script can read while the hourly run writes, and a
  // wait rather than an error when two writers meet (a catch-up run beside a
  // scheduled one).
  db.exec('pragma busy_timeout = 10000; pragma journal_mode = wal;');
  db.exec(`
    create table if not exists articles (
      url          text primary key,
      host         text,
      source       text,
      headline     text,
      published_at text,
      fetched_at   integer not null,
      chars        integer not null,
      sha          text not null,
      body         blob not null
    );
    create table if not exists carried (
      url     text not null,
      symbol  text not null,
      seen_at integer not null,
      primary key (url, symbol)
    );
    create index if not exists idx_carried_symbol on carried (symbol, url);
    create index if not exists idx_articles_published on articles (published_at);
  `);
  const insArt = db.prepare(`insert or ignore into articles (url, host, source, headline, published_at, fetched_at, chars, sha, body)
                             values (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insCar = db.prepare('insert or ignore into carried (url, symbol, seen_at) values (?, ?, ?)');
  const getArt = db.prepare('select * from articles where url = ?');
  const hasArt = db.prepare('select 1 from articles where url = ?');
  const bySym = db.prepare(`select a.url, a.headline, a.source, a.published_at, a.chars from carried c join articles a on a.url = c.url
                             where c.symbol = ? and a.published_at >= ? and a.published_at < ? order by a.published_at`);

  // { added: true } when the text is new, { added: false } when the address
  // was already kept (its stock is still recorded as carrying it).
  function put(o) {
    const text = String((o && o.text) || '');
    if (!o || !o.url || !text) throw new Error('newsarchive.put needs a url and text');
    const now = Date.now();
    const sha = crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
    const r = insArt.run(String(o.url), o.host || null, o.source || null, o.headline || null, o.published_at || null,
      now, text.length, sha, zlib.gzipSync(Buffer.from(text, 'utf8')));
    if (o.symbol) insCar.run(String(o.url), String(o.symbol).toUpperCase(), now);
    return { added: Number(r.changes) > 0 };
  }
  const has = (url) => !!hasArt.get(String(url));
  // Record that a stock's feed carried an article already kept.
  const carry = (url, symbol) => { insCar.run(String(url), String(symbol).toUpperCase(), Date.now()); };
  function get(url) {
    const r = getArt.get(String(url));
    if (!r) return null;
    return { url: r.url, host: r.host, source: r.source, headline: r.headline, published_at: r.published_at,
      fetched_at: Number(r.fetched_at), chars: Number(r.chars), text: zlib.gunzipSync(Buffer.from(r.body)).toString('utf8') };
  }
  const forSymbol = (symbol, fromIso, toIso) => bySym.all(String(symbol).toUpperCase(), String(fromIso || ''), String(toIso || '9999'))
    .map((r) => ({ url: r.url, headline: r.headline, source: r.source, published_at: r.published_at, chars: Number(r.chars) }));
  const count = () => Number(db.prepare('select count(*) n from articles').get().n);
  return { put, has, carry, get, forSymbol, count, close: () => db.close(), db };
}

module.exports = { open, DEFAULT_PATH };
