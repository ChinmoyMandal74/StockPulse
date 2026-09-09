// A local SQLite copy of the archive, for analysis.
//
//   node --use-system-ca analysis-db.js              # sync new rows (fast)
//   node --use-system-ca analysis-db.js --full       # rebuild from scratch
//   node --use-system-ca analysis-db.js --path X.db  # somewhere else
//   node --use-system-ca analysis-db.js --stats      # what is in the copy
//
// Why this exists: every factor test so far has pulled the whole archive over
// the network, which takes ~41s when it works and fails outright when it does
// not — a single Turso response dies somewhere between 158s and 216s, and two
// large queries in parallel cross that sooner. Iterating on a hypothesis a
// dozen times means a dozen of those. Against a local file the same queries run
// in milliseconds, cost no rows against the Turso account, and cannot time out.
//
// `node:sqlite` is built into Node 22.5+, so this adds no dependency — the same
// reasoning that sends mail over plain fetch and writes xlsx by hand. It prints
// an ExperimentalWarning; `--no-warnings` silences it.
//
// THE COPY IS DERIVED DATA AND DISPOSABLE. Nothing writes back to Turso from
// here, the file is gitignored, and `--full` rebuilds it in a couple of minutes.
// Never point analysis at Turso when this exists, and never treat this as a
// backup: it deliberately omits the tables that matter for that.

require('dotenv').config();
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { createClient } = require('@tursodatabase/serverless/compat');

const FULL = process.argv.includes('--full');
const STATS = process.argv.includes('--stats');
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const DB_PATH = path.resolve(argOf('--path', 'analysis.db'));

// Only what analysis reads. `users`, `sessions` and `password_resets` are
// deliberately absent: they hold password hashes and live session tokens, and
// an unencrypted file on a laptop is no place for them. `visitors`, `prefs` and
// `chat_usage` are personal and answer no question worth asking here.
const TABLES = [
  { name: 'bars', dated: true, bySymbol: true },
  { name: 'momentum_history', dated: true, bySymbol: true },
  { name: 'fundamentals_history', dated: true, bySymbol: true },
  { name: 'names', dated: false, bySymbol: false },
  { name: 'portfolios', dated: false, bySymbol: false },
  { name: 'portfolio_tickers', dated: false, bySymbol: false },
];

// Re-pull this many days on top of what is already local. The archive rewrites
// recent bars — Twelve Data returns a provisional close for a session still in
// progress — so the newest rows are not final and copying them once is wrong.
const OVERLAP_DAYS = 10;

const SYMBOL_CHUNK = 8;          // what fits comfortably inside the response wall
const INSERT_CHUNK = 500;        // rows per local transaction batch
const n = (v) => Number(v || 0).toLocaleString();

function open() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('pragma journal_mode = WAL');
  // Durability is worthless for a file that is rebuilt on demand, and turning
  // it off makes the bulk insert several times faster.
  db.exec('pragma synchronous = OFF');
  return db;
}

function showStats(local) {
  console.log(`local copy: ${DB_PATH}`);
  const tabs = local.prepare(
    "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all();
  if (!tabs.length) { console.log('  (empty — run without --stats to build it)'); return; }
  for (const t of tabs) {
    const c = local.prepare(`select count(*) c from "${t.name}"`).get().c;
    const dated = TABLES.find((x) => x.name === t.name && x.dated);
    let span = '';
    if (dated && c) {
      const r = local.prepare(`select min(d) a, max(d) z from "${t.name}"`).get();
      span = `  ${r.a} → ${r.z}`;
    }
    console.log(`  ${t.name.padEnd(22)} ${n(c).padStart(10)}${span}`);
  }
}

(async () => {
  const local = open();
  if (STATS) { showStats(local); process.exit(0); }

  const remote = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const t0 = Date.now();
  console.log(`local copy : ${DB_PATH}`);
  console.log(`mode       : ${FULL ? 'FULL — rebuilding every table' : 'incremental'}\n`);

  // The schema is copied from the source rather than restated, so a column added
  // upstream arrives here without this file needing to know about it.
  const schema = await remote.execute(
    "select name, sql from sqlite_master where type in ('table','index') and sql is not null");
  const sqlFor = new Map(schema.rows.map((r) => [r.name, r.sql]));

  let grand = 0;
  for (const t of TABLES) {
    const ddl = sqlFor.get(t.name);
    if (!ddl) { console.log(`  ${t.name.padEnd(22)} not present upstream, skipped`); continue; }
    if (FULL) local.exec(`drop table if exists "${t.name}"`);
    // The DDL comes from sqlite_master verbatim, so it has no IF NOT EXISTS and
    // throws on the second run. Create it only when it is actually absent.
    const present = local.prepare(
      "select 1 x from sqlite_master where type = 'table' and name = ?").get(t.name);
    if (!present) local.exec(ddl);

    // Where to resume from. A dated table only needs rows at or after its local
    // maximum, less the overlap; anything else is small enough to replace.
    let since = null;
    if (t.dated && !FULL) {
      const row = local.prepare(`select max(d) z from "${t.name}"`).get();
      if (row && row.z) {
        const d = new Date(row.z + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - OVERLAP_DAYS);
        since = d.toISOString().slice(0, 10);
      }
    }
    if (!t.dated) local.exec(`delete from "${t.name}"`);

    // Column list from the local table, so the insert cannot drift from the DDL.
    const cols = local.prepare(`pragma table_info("${t.name}")`).all().map((c) => c.name);
    const insert = local.prepare(
      `insert or replace into "${t.name}" (${cols.map((c) => `"${c}"`).join(', ')}) ` +
      `values (${cols.map(() => '?').join(', ')})`);

    // Chunked by symbol: one query for a 440k-row table dies against the
    // response wall, and by-symbol keeps every request small and restartable.
    let groups = [[null]];
    if (t.bySymbol) {
      const syms = (await remote.execute(`select distinct symbol from "${t.name}"`)).rows.map((r) => r.symbol);
      groups = [];
      for (let i = 0; i < syms.length; i += SYMBOL_CHUNK) groups.push(syms.slice(i, i + SYMBOL_CHUNK));
    }

    let got = 0;
    for (const g of groups) {
      const where = [], args = [];
      if (g[0] !== null) { where.push(`symbol in (${g.map(() => '?').join(',')})`); args.push(...g); }
      if (since) { where.push('d >= ?'); args.push(since); }
      const r = await remote.execute({
        sql: `select ${cols.map((c) => `"${c}"`).join(', ')} from "${t.name}"` +
          (where.length ? ` where ${where.join(' and ')}` : ''),
        args,
      });
      for (let i = 0; i < r.rows.length; i += INSERT_CHUNK) {
        local.exec('begin');
        for (const row of r.rows.slice(i, i + INSERT_CHUNK)) {
          // libSQL hands back BigInt for integers and node:sqlite will not bind
          // an arbitrary object, so everything is normalised on the way in.
          insert.run(...cols.map((c) => {
            const v = row[c];
            if (v == null) return null;
            if (typeof v === 'bigint') return Number(v);
            if (typeof v === 'number' || typeof v === 'string') return v;
            return String(v);
          }));
        }
        local.exec('commit');
      }
      got += r.rows.length;
      process.stdout.write(`\r  ${t.name.padEnd(22)} ${n(got).padStart(10)} rows`);
    }
    grand += got;
    console.log(`\r  ${t.name.padEnd(22)} ${n(got).padStart(10)} rows${since ? `  (since ${since})` : ''}          `);
  }

  // Indexes analysis wants, which the app's schema does not have: every
  // cross-sectional question groups by date first.
  local.exec('create index if not exists ix_bars_d on bars (d)');
  local.exec('create index if not exists ix_mom_d on momentum_history (d)');
  local.exec('create index if not exists ix_mom_model_d on momentum_history (model, d)');

  // The same view the server defines, so a query written against one runs
  // against the other unchanged.
  local.exec('drop view if exists momentum_deltas');
  local.exec(`create view momentum_deltas as
    select symbol, d, model, score, close,
      lag(score, 5) over w as past_1w, lag(score, 10) over w as past_2w,
      lag(score, 21) over w as past_1m, lag(score, 63) over w as past_3m,
      lag(score, 126) over w as past_6m,
      score - lag(score, 5) over w as delta_1w, score - lag(score, 10) over w as delta_2w,
      score - lag(score, 21) over w as delta_1m, score - lag(score, 63) over w as delta_3m,
      score - lag(score, 126) over w as delta_6m,
      (close - lag(close, 10) over w) / lag(close, 10) over w * 100 as ret_2w,
      (lead(close, 10) over w - close) / close * 100 as fwd_ret_2w,
      (lead(close, 21) over w - close) / close * 100 as fwd_ret_1m,
      (lead(close, 63) over w - close) / close * 100 as fwd_ret_3m
    from (select h.symbol, h.d, h.model, h.score, b.close
          from momentum_history h join bars b on b.symbol = h.symbol and b.d = h.d)
    window w as (partition by symbol, model order by d)`);
  local.exec('analyze');

  console.log(`\n${n(grand)} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  showStats(local);
  process.exit(0);
})();
