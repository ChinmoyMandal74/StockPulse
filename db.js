// Turso (libSQL) persistence layer.
//
// Replaces the flat JSON files the app used to read and write. That mattered
// once the app moved to Vercel: serverless filesystems are ephemeral, so every
// fs.writeFileSync was silently discarded — portfolio edits reverted, the
// snapshot never cached, and the profile cache never stuck (which quietly
// re-spent Twelve Data credits on every cold start).
//
// The accessors below keep the exact shapes the old file helpers returned, so
// callers only had to gain an `await`:
//   readPortfolios() -> { name: [SYMBOL, ...] }   (insertion order preserved)
//   readNames()      -> { SYMBOL: 'Company' }
//   readProfiles()   -> { SYMBOL: { ...profile, fetchedAt } }
//   readSnapshot()   -> the stored payload object, or null
//
// Writes are whole-collection replaces, mirroring the old "rewrite the file"
// semantics — at this scale (tens of rows) a delete-and-reinsert inside one
// batch is simpler and safer than diffing, and it keeps writeProfiles({})
// working as the cache-clear that /api/refresh-all relies on.

const { createClient } = require('@tursodatabase/serverless/compat');

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  throw new Error(
    'TURSO_DATABASE_URL is not set. Add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to .env ' +
    '(and to the Vercel project environment variables before deploying).'
  );
}

const db = createClient({ url, authToken });

// ---- schema ---------------------------------------------------------------
// Idempotent. Called once at boot; cheap enough to be safe on a warm start too.

const SCHEMA = [
  // Portfolio order drives the UI's tab order and its colour assignment, so it
  // has to survive a round trip — hence an explicit position rather than
  // relying on insertion order.
  `create table if not exists portfolios (
     name     text primary key,
     position integer not null
   )`,
  `create table if not exists portfolio_tickers (
     portfolio text    not null,
     symbol    text    not null,
     position  integer not null,
     primary key (portfolio, symbol)
   )`,
  `create table if not exists names (
     symbol text primary key,
     name   text
   )`,
  // The profile payload stays a JSON blob: it is a cache of a third-party
  // response whose shape we do not control, and nothing queries inside it.
  // fetched_at is lifted out as a column because the 24h TTL check runs against
  // it on every refresh.
  `create table if not exists profiles (
     symbol     text primary key,
     data       text not null,
     fetched_at integer
   )`,
  `create index if not exists idx_profiles_fetched_at on profiles (fetched_at)`,
  // Exactly one row, enforced by the check constraint.
  `create table if not exists snapshot (
     id         integer primary key check (id = 1),
     payload    text not null,
     updated_at text
   )`,
  `create table if not exists visitors (
     id  integer primary key autoincrement,
     ts  text not null,
     ip  text,
     ua  text,
     ref text
   )`,
  `create index if not exists idx_visitors_ts on visitors (ts)`,
];

let ready = null;
async function init() {
  if (!ready) {
    ready = (async () => {
      for (const stmt of SCHEMA) await db.execute(stmt);
    })();
  }
  return ready;
}

// ---- portfolios -----------------------------------------------------------

function normalize(obj) {
  const out = {};
  for (const [name, arr] of Object.entries(obj || {})) {
    const nm = String(name).trim();
    if (!nm) continue;
    const seen = new Set();
    const syms = [];
    for (const s of Array.isArray(arr) ? arr : []) {
      const sym = String(s).trim().toUpperCase();
      if (sym && !seen.has(sym)) {
        seen.add(sym);
        syms.push(sym);
      }
    }
    out[nm] = syms;
  }
  return out;
}

async function readPortfolios() {
  await init();
  const [pf, tk] = await Promise.all([
    db.execute('select name from portfolios order by position, name'),
    db.execute('select portfolio, symbol from portfolio_tickers order by portfolio, position'),
  ]);
  const out = {};
  for (const r of pf.rows) out[r.name] = [];
  for (const r of tk.rows) if (out[r.portfolio]) out[r.portfolio].push(r.symbol);
  return out;
}

async function writePortfolios(obj) {
  await init();
  const clean = normalize(obj);
  const stmts = [
    { sql: 'delete from portfolio_tickers', args: [] },
    { sql: 'delete from portfolios', args: [] },
  ];
  let pi = 0;
  for (const [name, syms] of Object.entries(clean)) {
    stmts.push({ sql: 'insert into portfolios (name, position) values (?, ?)', args: [name, pi++] });
    syms.forEach((sym, si) => {
      stmts.push({
        sql: 'insert into portfolio_tickers (portfolio, symbol, position) values (?, ?, ?)',
        args: [name, sym, si],
      });
    });
  }
  await db.batch(stmts, 'write');
}

// ---- company names --------------------------------------------------------

async function readNames() {
  await init();
  const r = await db.execute('select symbol, name from names');
  const out = {};
  for (const row of r.rows) out[row.symbol] = row.name;
  return out;
}

async function writeNames(map) {
  await init();
  const stmts = Object.entries(map || {}).map(([symbol, name]) => ({
    sql: 'insert into names (symbol, name) values (?, ?) on conflict(symbol) do update set name = excluded.name',
    args: [symbol, name ?? null],
  }));
  if (stmts.length) await db.batch(stmts, 'write');
}

// ---- profile cache --------------------------------------------------------

async function readProfiles() {
  await init();
  const r = await db.execute('select symbol, data, fetched_at from profiles');
  const out = {};
  for (const row of r.rows) {
    try {
      const obj = JSON.parse(row.data);
      // fetched_at is authoritative — the column is what the TTL check reads.
      if (row.fetched_at != null) obj.fetchedAt = Number(row.fetched_at);
      out[row.symbol] = obj;
    } catch {
      /* skip a corrupt row rather than failing the whole refresh */
    }
  }
  return out;
}

async function writeProfiles(map) {
  await init();
  const entries = Object.entries(map || {});
  // An empty map is the cache-clear used by /api/refresh-all.
  const stmts = [{ sql: 'delete from profiles', args: [] }];
  for (const [symbol, prof] of entries) {
    stmts.push({
      sql: 'insert into profiles (symbol, data, fetched_at) values (?, ?, ?)',
      args: [symbol, JSON.stringify(prof ?? {}), prof && prof.fetchedAt != null ? prof.fetchedAt : null],
    });
  }
  await db.batch(stmts, 'write');
}

// ---- snapshot -------------------------------------------------------------

async function readSnapshot() {
  await init();
  const r = await db.execute('select payload from snapshot where id = 1');
  if (!r.rows.length) return null;
  try {
    return JSON.parse(r.rows[0].payload);
  } catch {
    return null;
  }
}

async function writeSnapshot(payload) {
  await init();
  await db.execute({
    sql: `insert into snapshot (id, payload, updated_at) values (1, ?, ?)
          on conflict(id) do update set payload = excluded.payload, updated_at = excluded.updated_at`,
    args: [JSON.stringify(payload), payload?.updatedAt ?? null],
  });
}

// ---- visitors -------------------------------------------------------------

async function logVisit(entry) {
  await init();
  await db.execute({
    sql: 'insert into visitors (ts, ip, ua, ref) values (?, ?, ?, ?)',
    args: [entry.ts, entry.ip ?? null, entry.ua ?? null, entry.ref ?? null],
  });
}

// Aggregates in SQL instead of reading the whole log into memory — the old
// version parsed every line on each request just to count and slice the tail.
async function readVisitorStats(limit = 500) {
  await init();
  const today = new Date().toISOString().slice(0, 10);
  const [agg, recent] = await Promise.all([
    db.execute({
      sql: `select count(*) as total,
                   sum(case when ts like ? then 1 else 0 end) as today_count,
                   count(distinct ip) as unique_ips
            from visitors`,
      args: [today + '%'],
    }),
    db.execute({ sql: 'select ts, ip, ua, ref from visitors order by id desc limit ?', args: [limit] }),
  ]);
  const a = agg.rows[0] || {};
  return {
    total: Number(a.total || 0),
    todayCount: Number(a.today_count || 0),
    uniqueIps: Number(a.unique_ips || 0),
    entries: recent.rows.map((r) => ({ ts: r.ts, ip: r.ip, ua: r.ua, ref: r.ref })),
  };
}

module.exports = {
  db,
  init,
  readPortfolios,
  writePortfolios,
  readNames,
  writeNames,
  readProfiles,
  writeProfiles,
  readSnapshot,
  writeSnapshot,
  logVisit,
  readVisitorStats,
};
