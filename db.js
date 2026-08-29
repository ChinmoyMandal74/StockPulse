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

const crypto = require('crypto');
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
     id         integer primary key autoincrement,
     ts         text not null,
     ip         text,
     ua         text,
     ref        text,
     user_email text
   )`,
  `create index if not exists idx_visitors_ts on visitors (ts)`,
  // Accounts. The screener itself is shared — every signed-in user sees the same
  // data — so these exist purely to control who gets through the door.
  // role: 'owner' can edit tickers / refresh / backtest; 'member' is read-only.
  // failed_count + locked_until throttle password guessing against a known email.
  `create table if not exists users (
     id            integer primary key autoincrement,
     email         text not null unique,
     password_hash text not null,
     salt          text not null,
     role          text not null default 'member',
     created_at    text not null,
     failed_count  integer not null default 0,
     locked_until  integer
   )`,
  // Random per-login tokens rather than a deterministic cookie, so a single
  // session can be revoked and expiry is just a column.
  `create table if not exists sessions (
     token      text primary key,
     user_id    integer not null,
     created_at text not null,
     expires_at integer not null
   )`,
  `create index if not exists idx_sessions_user on sessions (user_id)`,
  // One row per symbol per trading day. The daily bars are already fetched on
  // every refresh and then thrown away, so keeping them costs no API credits and
  // turns a rolling 14-month window into an archive that only grows.
  //
  // The (symbol, d) key is what makes the write cheap and self-correcting: a
  // refresh upserts a small recent window, so a provisional close stored while
  // the market was open is replaced by the settled one, and a split that
  // re-adjusts old prices is repaired by rewriting the symbol rather than
  // leaving a phantom cliff in the chart.
  //
  // open/high/low/volume are stored alongside close because computeStocks()
  // reads them — high/low for the 52-week range, volume for the volume trend.
  // Without them the archive could draw a chart but could not reproduce the
  // screener, which is the whole point of keeping it.
  `create table if not exists bars (
     symbol text not null,
     d      text not null,
     open   real,
     high   real,
     low    real,
     close  real not null,
     volume real,
     primary key (symbol, d)
   )`,
  // One row per user per UTC day. A counter in memory is useless on serverless —
  // consecutive requests need not share a process — so the quota lives here.
  `create table if not exists chat_usage (
     user_key text not null,
     day      text not null,
     count    integer not null default 0,
     primary key (user_key, day)
   )`,
  // A refresh runs for ten-odd minutes and every instance needs to know, so the
  // flag lives here rather than in a process variable — serverless instances
  // share nothing else. At most one row; its absence means "not refreshing".
  `create table if not exists refresh_state (
     id         integer primary key check (id = 1),
     started_at integer not null,
     updated_at integer not null,
     loaded     integer,
     total      integer,
     actor      text
   )`,
];

// Columns added after a table shipped. SQLite has no "add column if not
// exists", so each is attempted and a duplicate-column error is ignored.
const ADDED_COLUMNS = [
  'alter table visitors add column user_email text',
];

let ready = null;
async function init() {
  if (!ready) {
    ready = (async () => {
      for (const stmt of SCHEMA) await db.execute(stmt);
      for (const stmt of ADDED_COLUMNS) {
        try {
          await db.execute(stmt);
        } catch (err) {
          if (!/duplicate column/i.test(err.message || '')) throw err;
        }
      }
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
      // fetched_at is authoritative — the column is what the TTL check reads,
      // and it also overrides the copy inside the blob. 0 is the sentinel
      // expireProfiles() writes: keep the cached values so they stay on screen,
      // but drop the timestamp so the next refresh re-pulls the symbol.
      if (row.fetched_at != null) {
        const t = Number(row.fetched_at);
        if (t > 0) obj.fetchedAt = t;
        else delete obj.fetchedAt;
      }
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

// Mark every cached profile stale without discarding it.
//
// /api/refresh-all used to delete these rows outright. Because the re-pull is
// capped at a handful of symbols per call, that left the shared snapshot — and
// so every other viewer — with no sector, market cap or fundamentals for the
// ten-odd minutes the backfill takes. Keeping the values and clearing only the
// timestamp means each one is replaced in place as its fresh copy lands, so the
// snapshot never regresses.
async function expireProfiles() {
  await init();
  const r = await db.execute('update profiles set fetched_at = 0');
  return r.rowsAffected ?? 0;
}

// ---- refresh state --------------------------------------------------------

// A refresh whose last progress report is older than this is treated as over.
// Rounds are ~62s apart, so this tolerates a missed one; it is what stops an
// admin closing the tab mid-backfill from pinning the banner up forever.
const REFRESH_STALE_MS = 4 * 60 * 1000;

async function beginRefresh(actor, total) {
  await init();
  const now = Date.now();
  await db.execute({
    sql: `insert into refresh_state (id, started_at, updated_at, loaded, total, actor)
          values (1, ?, ?, 0, ?, ?)
          on conflict(id) do update set
            started_at = excluded.started_at, updated_at = excluded.updated_at,
            loaded = 0, total = excluded.total, actor = excluded.actor`,
    args: [now, now, total ?? null, actor || null],
  });
}

// Only ever updates a refresh that is already running: a plain price Refresh
// takes seconds and has no business raising the banner.
async function noteRefreshProgress(loaded, total) {
  await init();
  const r = await db.execute({
    sql: 'update refresh_state set updated_at = ?, loaded = ?, total = ? where id = 1',
    args: [Date.now(), loaded ?? null, total ?? null],
  });
  return (r.rowsAffected ?? 0) > 0;
}

async function endRefresh() {
  await init();
  await db.execute('delete from refresh_state where id = 1');
}

// null when nothing is running, so callers can spread it straight into a payload.
async function readRefreshState() {
  await init();
  const r = await db.execute('select started_at, updated_at, loaded, total, actor from refresh_state where id = 1');
  if (!r.rows.length) return null;
  const row = r.rows[0];
  if (Date.now() - Number(row.updated_at) > REFRESH_STALE_MS) return null;
  return {
    startedAt: Number(row.started_at),
    loaded: row.loaded == null ? null : Number(row.loaded),
    total: row.total == null ? null : Number(row.total),
    actor: row.actor || null,
  };
}

// ---- daily bars -----------------------------------------------------------

// libSQL takes a whole batch in one round trip, but a 20,000-statement batch is
// not a round trip anyone enjoys. Everything here chunks.
const BAR_CHUNK = 500;

async function writeBarChunks(stmts) {
  for (let i = 0; i < stmts.length; i += BAR_CHUNK) {
    await db.batch(stmts.slice(i, i + BAR_CHUNK), 'write');
  }
}

const barInsert = (r) => ({
  sql: `insert into bars (symbol, d, open, high, low, close, volume)
        values (?, ?, ?, ?, ?, ?, ?)
        on conflict(symbol, d) do update set
          open = excluded.open, high = excluded.high, low = excluded.low,
          close = excluded.close, volume = excluded.volume`,
  args: [r.symbol, r.d, r.open ?? null, r.high ?? null, r.low ?? null, r.close, r.volume ?? null],
});

// Newest stored date per symbol, in one query — the refresh path needs it for
// every symbol at once and must not make 69 round trips to find out.
async function barsMaxDates() {
  await init();
  const r = await db.execute('select symbol, max(d) as maxd, count(*) as n from bars group by symbol');
  const out = new Map();
  for (const row of r.rows) out.set(row.symbol, { maxDate: row.maxd, count: Number(row.n) });
  return out;
}

// Stored closes on a handful of dates, for the split probe. One query for the
// whole universe: US symbols share trading days, so the date set is tiny.
async function barsOn(dates) {
  await init();
  const list = [...new Set(dates.filter(Boolean))];
  if (!list.length) return new Map();
  const r = await db.execute({
    sql: `select symbol, d, close from bars where d in (${list.map(() => '?').join(',')})`,
    args: list,
  });
  const out = new Map();
  for (const row of r.rows) out.set(row.symbol + '|' + row.d, Number(row.close));
  return out;
}

async function upsertBars(rows) {
  await init();
  if (!rows || !rows.length) return 0;
  await writeBarChunks(rows.map(barInsert));
  return rows.length;
}

// Used when a split has re-adjusted history, and by the backfill script. The
// delete and the first inserts share a batch so the symbol is never empty for
// longer than one round trip.
async function replaceBarsFor(symbol, rows) {
  await init();
  const stmts = [{ sql: 'delete from bars where symbol = ?', args: [symbol] },
                 ...rows.map(barInsert)];
  await writeBarChunks(stmts);
  return rows.length;
}

// Newest-first, matching the shape computeStocks() already works in.
async function readBars(symbol, limit = 400) {
  await init();
  const r = await db.execute({
    sql: 'select d, open, high, low, close, volume from bars where symbol = ? order by d desc limit ?',
    args: [symbol, limit],
  });
  return r.rows.map((x) => ({
    datetime: x.d,
    open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume,
  }));
}

// Closes only, for sparklines across the whole table. One query, oldest-first
// per symbol so the caller can draw straight through it.
async function readCloses(symbols, since) {
  await init();
  if (!symbols || !symbols.length) return {};
  const r = await db.execute({
    sql: `select symbol, d, close from bars
          where symbol in (${symbols.map(() => '?').join(',')}) and d >= ?
          order by symbol, d`,
    args: [...symbols, since],
  });
  const out = {};
  for (const row of r.rows) (out[row.symbol] ||= []).push(Number(row.close));
  return out;
}

async function barsStats() {
  await init();
  const r = await db.execute('select count(*) as n, count(distinct symbol) as syms, min(d) as mind, max(d) as maxd from bars');
  const x = r.rows[0] || {};
  return { rows: Number(x.n || 0), symbols: Number(x.syms || 0), from: x.mind || null, to: x.maxd || null };
}

// ---- chat quota -----------------------------------------------------------

// Counts one question against today's quota and reports what remains. Returns
// { allowed, used, limit }. The insert and the read are one statement so two
// requests landing together cannot both see the old count.
async function noteChatUse(userKey, limit) {
  await init();
  const day = new Date().toISOString().slice(0, 10);
  await db.execute({
    sql: `insert into chat_usage (user_key, day, count) values (?, ?, 1)
          on conflict(user_key, day) do update set count = count + 1`,
    args: [String(userKey), day],
  });
  const r = await db.execute({
    sql: 'select count from chat_usage where user_key = ? and day = ?',
    args: [String(userKey), day],
  });
  const used = r.rows.length ? Number(r.rows[0].count) : 1;
  return { allowed: used <= limit, used, limit };
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
    sql: 'insert into visitors (ts, ip, ua, ref, user_email) values (?, ?, ?, ?, ?)',
    args: [entry.ts, entry.ip ?? null, entry.ua ?? null, entry.ref ?? null, entry.userEmail ?? null],
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
                   count(distinct ip) as unique_ips,
                   count(distinct user_email) as unique_users
            from visitors`,
      args: [today + '%'],
    }),
    db.execute({ sql: 'select ts, ip, ua, ref, user_email from visitors order by id desc limit ?', args: [limit] }),
  ]);
  const a = agg.rows[0] || {};
  return {
    total: Number(a.total || 0),
    todayCount: Number(a.today_count || 0),
    uniqueIps: Number(a.unique_ips || 0),
    uniqueUsers: Number(a.unique_users || 0),
    entries: recent.rows.map((r) => ({ ts: r.ts, ip: r.ip, ua: r.ua, ref: r.ref, user: r.user_email })),
  };
}

// ---- accounts -------------------------------------------------------------
// scrypt ships with Node, so accounts need no dependency. Defined here rather
// than in server.js so set-password.js hashes identically — two copies of a
// security primitive is how they quietly diverge.

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, 64, (err, dk) => (err ? reject(err) : resolve(dk.toString('hex'))));
  });
}

function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

async function verifyPassword(password, salt, expectedHex) {
  const got = Buffer.from(await hashPassword(password, salt));
  const want = Buffer.from(String(expectedHex));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// Sets a new password and drops every existing session for that user, so a
// password change actually signs other devices out.
async function setPassword(userId, password) {
  await init();
  const salt = newSalt();
  const passwordHash = await hashPassword(password, salt);
  await db.batch([
    { sql: 'update users set password_hash = ?, salt = ?, failed_count = 0, locked_until = null where id = ?',
      args: [passwordHash, salt, userId] },
    { sql: 'delete from sessions where user_id = ?', args: [userId] },
  ], 'write');
}

async function setRole(userId, role) {
  await init();
  await db.execute({ sql: 'update users set role = ? where id = ?', args: [role, userId] });
}

async function countUsers() {
  await init();
  const r = await db.execute('select count(*) as c from users');
  return Number(r.rows[0].c || 0);
}

async function findUserByEmail(email) {
  await init();
  const r = await db.execute({
    sql: 'select * from users where email = ?',
    args: [String(email || '').trim().toLowerCase()],
  });
  return r.rows[0] || null;
}

async function createUser({ email, passwordHash, salt, role }) {
  await init();
  await db.execute({
    sql: `insert into users (email, password_hash, salt, role, created_at)
          values (?, ?, ?, ?, ?)`,
    args: [String(email).trim().toLowerCase(), passwordHash, salt, role, new Date().toISOString()],
  });
  return findUserByEmail(email);
}

async function listUsers() {
  await init();
  const r = await db.execute(
    'select id, email, role, created_at from users order by created_at'
  );
  return r.rows.map((u) => ({ id: Number(u.id), email: u.email, role: u.role, createdAt: u.created_at }));
}

async function deleteUser(id) {
  await init();
  await db.batch([
    { sql: 'delete from sessions where user_id = ?', args: [id] },
    { sql: 'delete from users where id = ?', args: [id] },
  ], 'write');
}

// Failed-login throttling, recorded against the account being targeted.
async function noteLoginFailure(userId, lockedUntil) {
  await init();
  await db.execute({
    sql: 'update users set failed_count = failed_count + 1, locked_until = ? where id = ?',
    args: [lockedUntil ?? null, userId],
  });
}

async function clearLoginFailures(userId) {
  await init();
  await db.execute({
    sql: 'update users set failed_count = 0, locked_until = null where id = ?',
    args: [userId],
  });
}

// ---- sessions -------------------------------------------------------------

async function createSession(token, userId, expiresAt) {
  await init();
  await db.execute({
    sql: 'insert into sessions (token, user_id, created_at, expires_at) values (?, ?, ?, ?)',
    args: [token, userId, new Date().toISOString(), expiresAt],
  });
}

// Returns the user for a live session, or null. Expired rows are swept lazily.
async function getSessionUser(token) {
  if (!token) return null;
  await init();
  const r = await db.execute({
    sql: `select u.id, u.email, u.role, s.expires_at
          from sessions s join users u on u.id = s.user_id
          where s.token = ?`,
    args: [token],
  });
  const row = r.rows[0];
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) {
    await deleteSession(token);
    return null;
  }
  return { id: Number(row.id), email: row.email, role: row.role };
}

async function deleteSession(token) {
  await init();
  await db.execute({ sql: 'delete from sessions where token = ?', args: [token] });
}

// Wipes the log. The autoincrement is reset too, so ids start from 1 again
// rather than carrying on from the deleted rows.
async function clearVisitors() {
  await init();
  const before = await db.execute('select count(*) as c from visitors');
  await db.batch([
    { sql: 'delete from visitors', args: [] },
    { sql: "delete from sqlite_sequence where name = 'visitors'", args: [] },
  ], 'write');
  return Number(before.rows[0].c || 0);
}

module.exports = {
  db,
  init,
  clearVisitors,
  hashPassword,
  newSalt,
  verifyPassword,
  setPassword,
  setRole,
  countUsers,
  findUserByEmail,
  createUser,
  listUsers,
  deleteUser,
  noteLoginFailure,
  clearLoginFailures,
  createSession,
  getSessionUser,
  deleteSession,
  readPortfolios,
  writePortfolios,
  readNames,
  writeNames,
  readProfiles,
  writeProfiles,
  expireProfiles,
  beginRefresh,
  noteRefreshProgress,
  endRefresh,
  readRefreshState,
  readSnapshot,
  writeSnapshot,
  noteChatUse,
  barsMaxDates,
  barsOn,
  upsertBars,
  replaceBarsFor,
  readBars,
  readCloses,
  barsStats,
  logVisit,
  readVisitorStats,
};
