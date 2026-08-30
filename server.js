// Stock Momentum Screener — POC backend
// State lives in Turso (hosted libSQL); every read and write goes through db.js.
// Portfolios map a name -> [symbols], and a stock can belong to several
// (many-to-many). The "universe" fetched from Twelve Data is the deduped union
// of all portfolios.

require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TWELVE_DATA_API_KEY;
const TD_BASE = 'https://api.twelvedata.com';
// Persistence lives in Turso (libSQL). The accessors below keep the shapes the
// old flat-file helpers returned, so this file only had to gain `await`s.
// See db.js and migrate-to-turso.js.
const store = require('./db');
const {
  readPortfolios, writePortfolios,
  readNames, writeNames,
  readProfiles, writeProfiles, expireProfiles,
  readSnapshot, writeSnapshot,
  beginRefresh, noteRefreshProgress, endRefresh, readRefreshState,
} = store;
const PROFILE_TTL_MS = 24 * 60 * 60 * 1000; // refresh sector/market cap once a day
// Publishing: set ADMIN_PASSWORD in .env to make the app read-only for the public.
// The public sees a cached snapshot; only an admin (logged in with this password)
// can add/remove tickers, refresh, Refresh All, and run backtests. When it's NOT
// set, the app is fully open (local dev) — every action is available with no login.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const AUTH_REQUIRED = !!ADMIN_PASSWORD;
const ADMIN_COOKIE = 'st_admin';
// /statistics (market cap, forward P/E, PEG, earnings growth) needs a Twelve Data
// Pro+ plan. On lower tiers it 403s for real tickers (only the AAPL demo symbol is
// allowed) and still costs credits, so it's OFF by default. Set ENABLE_FUNDAMENTALS
// =true in .env once you're on a Pro+ plan to populate those columns.
const FUNDAMENTALS_ENABLED = process.env.ENABLE_FUNDAMENTALS === 'true';
// Analyst consensus + price targets (/recommendations, /price_target) require a
// Twelve Data ULTRA+ plan. On Pro they 403 for real tickers (only the AAPL demo
// works) and still cost credits, so they're OFF by default. Set ENABLE_ANALYST=true
// in .env once you're on Ultra+ to populate the Analyst columns.
const ANALYST_ENABLED = process.env.ENABLE_ANALYST === 'true';
// A cold profile fetch hits several endpoints — /profile, /statistics, /earnings,
// and — when analyst is on — /recommendations + /price_target. Measured Aug 2026:
// each costs 1 credit per symbol, as does each symbol in a batched time_series
// call, against a 610 credits/minute Pro limit. Credits are therefore not the
// binding constraint; the cap below exists to keep a cold start from bursting,
// and the rest fill in on later refreshes, then cache for a day.
// The real ceilings are elsewhere: Twelve Data rejects a batched time_series of
// more than 120 symbols (HTTP 414), and SPY is appended as the benchmark, so the
// universe cannot exceed 119 tickers without chunking that call.
const MAX_PROFILE_FETCHES_PER_CALL = ANALYST_ENABLED ? 4 : 6;
const SYMBOL_RE = /^[A-Z0-9.\-]{1,12}$/;

// Registration gate. When SIGNUP_CODE is set, a new account must supply it —
// that is what makes this a door rather than an open sign-up sheet. Unset (the
// default) leaves registration open, which is fine locally but not in public.
const SIGNUP_CODE = process.env.SIGNUP_CODE || '';
const SESSION_COOKIE = 'sp_session';
const SESSION_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;
// Lock an account briefly after repeated wrong passwords. Tracked per user row
// rather than per IP, because an in-memory counter is useless on serverless
// where every request may hit a fresh instance.
const MAX_FAILED = 8;
const LOCK_MS = 15 * 60 * 1000;

app.set('trust proxy', 1); // so req.secure reflects an HTTPS reverse proxy when published
app.use(express.json());

// Express 4 does not catch rejected promises from async handlers — an unhandled
// rejection would hang the request and can take the process down. Every async
// route below is wrapped so a database error becomes a normal 500 instead.
const route = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error(`${req.method} ${req.originalUrl} failed:`, err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error. Please try again.' });
  });

// Log every public page load before static files are served.
app.get(['/', '/index.html'], route(async (req, res, next) => {
  // The door: the screener is only served to signed-in users.
  if (!(await isSignedIn(req))) return res.redirect('/login');
  // isSignedIn() above already resolved and cached the user on req, so this
  // costs nothing extra. Null means either a pre-accounts row or someone signed
  // in with ADMIN_PASSWORD, which has no account behind it.
  const who = await currentUser(req);
  const entry = {
    ts: new Date().toISOString(),
    ip: req.ip || null,
    ua: req.headers['user-agent'] || null,
    ref: req.headers['referer'] || req.headers['referrer'] || null,
    userEmail: who ? who.email : (AUTH_REQUIRED ? 'admin (legacy login)' : null),
  };
  // Fire and forget: a logging failure must never block the page load.
  store.logVisit(entry).catch(() => { /* ignore */ });
  next();
}));

app.get('/analysis', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'analysis.html'));
}));

// One stock, in full. The symbol is read client-side from the path, so every
// ticker serves the same file.
app.get('/stock/:symbol', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'stock.html'));
}));

app.get('/chat', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
}));

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// public/ is served wholesale, which would otherwise hand out the gated pages
// at their raw .html path and bypass the checks above. Bounce those to the
// routed path, where the guard runs.
const GATED_PAGES = { '/chat.html': '/chat', '/analysis.html': '/analysis', '/visitors.html': '/visitors',
                      // no symbol in that path, so there is nothing to show
                      '/stock.html': '/' };
app.get(Object.keys(GATED_PAGES), (req, res) => res.redirect(GATED_PAGES[req.path]));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/visitors', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'visitors.html'));
});

// ---- Admin auth (cookie-based, no DB) --------------------------------------
// A deterministic token derived from the password (HMAC) is stored in an httpOnly
// cookie; there's no separate secret to manage. When ADMIN_PASSWORD is unset the
// app is fully open and everyone is treated as admin (local dev).

function adminToken() {
  return crypto.createHmac('sha256', ADMIN_PASSWORD).update('stock-tracker-admin-v1').digest('hex');
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ---- accounts: sessions and gates ------------------------------------------
// Password hashing lives in db.js beside the users table, so this file and the
// local set-password script can't drift apart on scrypt parameters.
const { hashPassword, newSalt, verifyPassword } = store;

// Resolves the signed-in user for a request, or null. Cached on req so a single
// request never queries the sessions table twice.
async function currentUser(req) {
  if (req._user !== undefined) return req._user;
  const token = parseCookies(req)[SESSION_COOKIE];
  req._user = token ? await store.getSessionUser(token) : null;
  return req._user;
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

// Admin = the legacy ADMIN_PASSWORD cookie (kept so you can never lock yourself
// out of your own instance) or a signed-in user whose role is 'owner'.
async function isAdmin(req) {
  if (!AUTH_REQUIRED) return true; // no password configured → open (local dev)
  const tok = parseCookies(req)[ADMIN_COOKIE];
  if (tok && safeEqual(tok, adminToken())) return true;
  const u = await currentUser(req);
  return !!u && u.role === 'owner';
}

// The door: any signed-in user, or an admin by either route.
async function isSignedIn(req) {
  if (!AUTH_REQUIRED) return true;
  if (await isAdmin(req)) return true;
  return !!(await currentUser(req));
}

const requireAdmin = route(async (req, res, next) => {
  if (await isAdmin(req)) return next();
  res.status(403).json({ error: 'Admin only — log in to make changes.' });
});

const requireAuth = route(async (req, res, next) => {
  if (await isSignedIn(req)) return next();
  res.status(401).json({ error: 'Please sign in.' });
});

app.get('/api/me', route(async (req, res) => {
  const u = await currentUser(req);
  const admin = await isAdmin(req);
  res.json({
    admin,
    authRequired: AUTH_REQUIRED,
    signedIn: await isSignedIn(req),
    user: u ? { email: u.email, role: u.role } : (admin && AUTH_REQUIRED ? { email: null, role: 'owner' } : null),
    signupCodeRequired: !!SIGNUP_CODE,
  });
}));

// Create an account. The first account created becomes the owner, so a fresh
// install can bootstrap itself; everyone after that is a read-only member.
app.post('/api/register', route(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const code = String(req.body?.code || '');

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
  }
  if (SIGNUP_CODE && !safeEqual(code, SIGNUP_CODE)) {
    return res.status(403).json({ error: 'That invite code is not valid.' });
  }
  if (await store.findUserByEmail(email)) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const salt = newSalt();
  const passwordHash = await hashPassword(password, salt);
  const role = (await store.countUsers()) === 0 ? 'owner' : 'member';
  const user = await store.createUser({ email, passwordHash, salt, role });

  const token = crypto.randomBytes(32).toString('hex');
  await store.createSession(token, Number(user.id), Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  setSessionCookie(res, token);
  res.json({ ok: true, user: { email, role } });
}));

// Sign in with an account. Passing only a password (no email) still works and
// checks it against ADMIN_PASSWORD — that is the escape hatch that stops a
// broken accounts table from locking you out of your own instance.
app.post('/api/login', route(async (req, res) => {
  if (!AUTH_REQUIRED) return res.json({ ok: true, admin: true });

  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email) {
    if (!safeEqual(password, ADMIN_PASSWORD)) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    res.cookie(ADMIN_COOKIE, adminToken(), {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      secure: req.secure, // set only over HTTPS (true behind an HTTPS proxy)
    });
    return res.json({ ok: true, admin: true });
  }

  const user = await store.findUserByEmail(email);
  // Same response whether the email is unknown or the password is wrong, so the
  // endpoint can't be used to enumerate who has an account.
  const reject = () => res.status(401).json({ error: 'Incorrect email or password.' });
  if (!user) return reject();

  if (user.locked_until && Number(user.locked_until) > Date.now()) {
    const mins = Math.ceil((Number(user.locked_until) - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many attempts. Try again in ${mins} minute(s).` });
  }

  if (!(await verifyPassword(password, user.salt, user.password_hash))) {
    const failed = Number(user.failed_count || 0) + 1;
    await store.noteLoginFailure(Number(user.id), failed >= MAX_FAILED ? Date.now() + LOCK_MS : null);
    return reject();
  }

  await store.clearLoginFailures(Number(user.id));
  const token = crypto.randomBytes(32).toString('hex');
  await store.createSession(token, Number(user.id), Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  setSessionCookie(res, token);
  res.json({ ok: true, admin: user.role === 'owner', user: { email: user.email, role: user.role } });
}));

app.post('/api/logout', route(async (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await store.deleteSession(token);
  res.clearCookie(SESSION_COOKIE);
  res.clearCookie(ADMIN_COOKIE);
  res.json({ ok: true });
}));

// Change your own password. Requires the current one, and every other session
// for that account is dropped, so a change signs out other devices.
app.post('/api/password', requireAuth, route(async (req, res) => {
  const me = await currentUser(req);
  if (!me) {
    return res.status(400).json({ error: 'Password changes need an account — you are signed in with ADMIN_PASSWORD.' });
  }
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (next.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
  }
  const user = await store.findUserByEmail(me.email);
  if (!user || !(await verifyPassword(current, user.salt, user.password_hash))) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  await store.setPassword(Number(user.id), next);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
}));

// Owner-only: see who has an account, and revoke one.
app.get('/api/users', requireAdmin, route(async (req, res) => {
  res.json({ users: await store.listUsers() });
}));

app.delete('/api/users/:id', requireAdmin, route(async (req, res) => {
  const id = Number(req.params.id);
  const users = await store.listUsers();
  const target = users.find((u) => u.id === id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.role === 'owner' && users.filter((u) => u.role === 'owner').length === 1) {
    return res.status(409).json({ error: 'Cannot remove the only owner.' });
  }
  await store.deleteUser(id);
  res.json({ ok: true });
}));

// ---- Portfolio helpers (persistence lives in db.js) ------------------------

// Deduped union of every portfolio's symbols.
function getUniverse(portfolios) {
  const seen = new Set();
  const list = [];
  for (const syms of Object.values(portfolios)) {
    for (const s of syms) {
      if (!seen.has(s)) {
        seen.add(s);
        list.push(s);
      }
    }
  }
  return list;
}

// Which portfolios contain a given symbol.
function membershipOf(symbol, portfolios) {
  return Object.keys(portfolios).filter((name) => portfolios[name].includes(symbol));
}

// ---- Company name cache ----------------------------------------------------
// Names never change, so we fetch them once (on add) and reuse them. This keeps
// every refresh at just 1 API credit per ticker (time_series only).

// ---- Profile cache: sector + fundamentals (premium endpoints) --------------
// Sector is static; fundamentals move slowly. We cache per symbol and refresh at
// most once a day, so a normal refresh stays a single time_series call.

// Consensus label + 1–5 score from analyst buy/hold/sell counts.
function analystConsensus(c) {
  const total = c.strongBuy + c.buy + c.hold + c.sell + c.strongSell;
  if (total === 0) return { label: null, score: null, total: 0 };
  const score = (c.strongBuy * 5 + c.buy * 4 + c.hold * 3 + c.sell * 2 + c.strongSell * 1) / total;
  let label = 'Hold';
  if (score >= 4.5) label = 'Strong Buy';
  else if (score >= 3.5) label = 'Buy';
  else if (score >= 2.5) label = 'Hold';
  else if (score >= 1.5) label = 'Sell';
  else label = 'Strong Sell';
  return { label, score, total };
}

// Fetch sector (/profile), fundamentals (/statistics), and analyst data
// (/recommendations, /price_target) for one symbol. Best-effort: any field stays
// null if the endpoint errors or omits it. The analyst/fundamentals endpoints
// require a Twelve Data Pro+ plan, so they're gated behind FUNDAMENTALS_ENABLED.
async function fetchProfile(symbol) {
  const enc = encodeURIComponent(symbol);
  const out = {
    sector: null,
    marketCap: null,
    forwardPe: null,
    peg: null,
    earningsGrowthYoY: null,
    revenueGrowthYoY: null,
    roe: null,
    // absolute size, all TTM except the balance-sheet pair (most recent quarter)
    revenueTtm: null,
    grossProfitTtm: null,
    netIncomeTtm: null,
    fcfTtm: null,
    netCash: null,
    shortPctFloat: null,
    lastEarningsDate: null,
    lastSurprise: null,
    nextEarningsDate: null,
    nextEarningsEstimated: false,
    analystScore: null,
    analystLabel: null,
    analystTotal: null,
    analystCounts: null,
    targetMean: null,
    targetHigh: null,
    targetLow: null,
  };
  try {
    const p = await fetchJson(`${TD_BASE}/profile?symbol=${enc}&apikey=${API_KEY}`);
    if (p && p.sector) out.sector = p.sector;
  } catch {
    /* leave sector null */
  }
  if (FUNDAMENTALS_ENABLED) {
    try {
      const st = await fetchJson(`${TD_BASE}/statistics?symbol=${enc}&apikey=${API_KEY}`);
      const vm = st?.statistics?.valuations_metrics;
      const fin = st?.statistics?.financials;
      const inc = fin?.income_statement;
      if (vm) {
        out.marketCap = vm.market_capitalization ?? null;
        out.forwardPe = vm.forward_pe ?? null;
        out.peg = vm.peg_ratio ?? null;
      }
      if (inc && inc.quarterly_earnings_growth_yoy != null) {
        out.earningsGrowthYoY = inc.quarterly_earnings_growth_yoy * 100; // fraction -> %
      }
      if (inc && inc.quarterly_revenue_growth != null) {
        out.revenueGrowthYoY = inc.quarterly_revenue_growth * 100;
      }
      if (fin && fin.return_on_equity_ttm != null) out.roe = fin.return_on_equity_ttm * 100;

      // Absolute size — how big the business actually is, in its reporting currency.
      const bs = fin?.balance_sheet;
      const cf = fin?.cash_flow;
      if (inc) {
        out.revenueTtm = inc.revenue_ttm ?? null;
        out.grossProfitTtm = inc.gross_profit_ttm ?? null;
        out.netIncomeTtm = inc.net_income_to_common_ttm ?? null;
      }
      if (cf) out.fcfTtm = cf.levered_free_cash_flow_ttm ?? null;
      if (bs && bs.total_cash_mrq != null && bs.total_debt_mrq != null) {
        out.netCash = bs.total_cash_mrq - bs.total_debt_mrq; // negative = net debt
      }
      // Margins derived from the two columns shown beside them, so the table is
      // internally consistent (fin.gross_margin uses a different basis and differs
      // by up to ~4 points).
      // Margins are not stored: they are derived from the absolutes when the
      // row is assembled (see below), so a cached profile can never carry a
      // stale or wrong one.
      const ss = st?.statistics?.stock_statistics;
      if (ss && ss.shares_short != null && ss.float_shares) {
        out.shortPctFloat = (ss.shares_short / ss.float_shares) * 100; // short interest as % of float
      }
    } catch {
      /* leave fundamentals null */
    }
    // Earnings: last reported date + surprise, and the next date (confirmed if the
    // feed lists a future date, else estimated ~91 days after the last report).
    try {
      const e = await fetchJson(`${TD_BASE}/earnings?symbol=${enc}&outputsize=8&apikey=${API_KEY}`);
      const arr = Array.isArray(e?.earnings) ? e.earnings : [];
      const today = new Date().toISOString().slice(0, 10);
      const reported = arr.find((x) => x.eps_actual != null && x.date <= today) || arr.find((x) => x.eps_actual != null);
      const upcoming = arr.filter((x) => x.date > today).sort((a, b) => a.date.localeCompare(b.date))[0];
      if (reported) {
        out.lastEarningsDate = reported.date;
        out.lastSurprise = reported.surprise_prc ?? null;
      }
      if (upcoming) {
        out.nextEarningsDate = upcoming.date;
        out.nextEarningsEstimated = false;
      } else if (reported) {
        const d = new Date(reported.date);
        d.setDate(d.getDate() + 91);
        out.nextEarningsDate = d.toISOString().slice(0, 10);
        out.nextEarningsEstimated = true;
      }
    } catch {
      /* leave earnings null */
    }
  }
  if (ANALYST_ENABLED) {
    try {
      const rec = await fetchJson(`${TD_BASE}/recommendations?symbol=${enc}&apikey=${API_KEY}`);
      const t = rec?.trends?.current_month;
      if (t) {
        const counts = {
          strongBuy: t.strong_buy || 0,
          buy: t.buy || 0,
          hold: t.hold || 0,
          sell: t.sell || 0,
          strongSell: t.strong_sell || 0,
        };
        const cons = analystConsensus(counts);
        if (cons.total > 0) {
          out.analystCounts = counts;
          out.analystTotal = cons.total;
          out.analystScore = cons.score;
          out.analystLabel = cons.label;
        }
      }
    } catch {
      /* leave analyst consensus null */
    }
    try {
      const pt = await fetchJson(`${TD_BASE}/price_target?symbol=${enc}&apikey=${API_KEY}`);
      const p = pt?.price_target;
      if (p) {
        out.targetMean = p.average ?? null;
        out.targetHigh = p.high ?? null;
        out.targetLow = p.low ?? null;
      }
    } catch {
      /* leave price target null */
    }
  }
  return out;
}

// Ensure sector/fundamentals are cached and fresh for the given symbols.
async function ensureProfiles(symbols) {
  const profiles = await readProfiles();
  const now = Date.now();
  const stale = symbols.filter((s) => {
    const p = profiles[s];
    if (!p || !p.fetchedAt) return true; // never fetched
    return now - p.fetchedAt > PROFILE_TTL_MS; // otherwise refresh once a day
  });
  const batch = stale.slice(0, MAX_PROFILE_FETCHES_PER_CALL);
  if (batch.length && API_KEY) {
    const results = await Promise.all(
      batch.map((s) => fetchProfile(s).then((r) => ({ s, r })))
    );
    for (const { s, r } of results) profiles[s] = { ...r, fetchedAt: now };
    if (results.length) await writeProfiles(profiles);
  }
  return profiles;
}

// ---- Twelve Data helpers ---------------------------------------------------

// Twelve Data returns a bare object for a single symbol, but a symbol-keyed
// object for multiple symbols. Normalize both into { SYMBOL: payload }.
function normalizeBySymbol(data, symbols) {
  if (symbols.length === 1) {
    return { [symbols[0]]: data };
  }
  return data || {};
}

async function fetchJson(url) {
  const res = await fetch(url);
  return res.json();
}

// Fetch a company name for one symbol (1 credit). Best-effort; returns null on failure.
async function fetchName(symbol) {
  try {
    const q = await fetchJson(
      `${TD_BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${API_KEY}`
    );
    return q && q.name ? q.name : null;
  } catch {
    return null;
  }
}

// Percent change between the latest close and the close `daysAgo` trading days back.
function pctChange(values, daysAgo) {
  // values are newest-first: values[0] = latest close.
  if (!Array.isArray(values) || values.length <= daysAgo) return null;
  const latest = parseFloat(values[0].close);
  const past = parseFloat(values[daysAgo].close);
  if (!isFinite(latest) || !isFinite(past) || past === 0) return null;
  return ((latest - past) / past) * 100;
}

// Single-day return for the day at `endIndex` (0 = today, 1 = yesterday, …):
// close[endIndex] vs close[endIndex+1].
function singleDayChange(values, endIndex) {
  if (!Array.isArray(values) || values.length <= endIndex + 1) return null;
  const a = parseFloat(values[endIndex].close);
  const b = parseFloat(values[endIndex + 1].close);
  if (!isFinite(a) || !isFinite(b) || b === 0) return null;
  return ((a - b) / b) * 100;
}

// Simple moving average of close over the most recent `period` days.
function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += parseFloat(values[i].close);
  return sum / period;
}

// Latest close vs the 52-week high, as a percentage (0 = at the high, negative = below).
function pctFromHigh(values, lookback = 252) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const latest = parseFloat(values[0].close);
  let high = -Infinity;
  const n = Math.min(values.length, lookback);
  for (let i = 0; i < n; i++) {
    const h = parseFloat(values[i].high);
    if (isFinite(h) && h > high) high = h;
  }
  if (!isFinite(latest) || !isFinite(high) || high === 0) return null;
  return ((latest - high) / high) * 100;
}

// Latest close vs its `period`-day moving average, as a percentage.
function pctVsMA(values, period) {
  const avg = sma(values, period);
  if (avg == null || avg === 0) return null;
  const latest = parseFloat(values[0].close);
  if (!isFinite(latest)) return null;
  return ((latest - avg) / avg) * 100;
}

// Wilder's RSI over `period` days (default 14). Needs period+1 closes.
function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length < period + 1) return null;
  // Work oldest-first over the most recent (period+1)+ closes.
  const closes = values.map((v) => parseFloat(v.close)).reverse();
  let gains = 0;
  let losses = 0;
  // Seed with the first `period` changes.
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  // Smooth across the remaining changes.
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Simple moving average of close at `offset` trading days back (0 = latest).
function smaAt(values, period, offset = 0) {
  if (!Array.isArray(values) || values.length < offset + period) return null;
  let sum = 0;
  for (let i = offset; i < offset + period; i++) sum += parseFloat(values[i].close);
  return sum / period;
}

// Average daily volume over `period` days from `offset`.
function avgVolume(values, period, offset = 0) {
  if (!Array.isArray(values) || values.length < offset + period) return null;
  let sum = 0;
  for (let i = offset; i < offset + period; i++) {
    const v = parseFloat(values[i].volume);
    if (!isFinite(v)) return null;
    sum += v;
  }
  return sum / period;
}

// Volume trend: 5-day average volume vs its 20-day average, as a % (rising = positive).
function volumeTrendPct(values) {
  const a5 = avgVolume(values, 5);
  const a20 = avgVolume(values, 20);
  if (a5 == null || a20 == null || a20 === 0) return null;
  return (a5 / a20 - 1) * 100;
}

// Exponential moving average over an oldest-first array; returns aligned array.
function emaArray(arr, period) {
  const out = new Array(arr.length).fill(null);
  if (arr.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += arr[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < arr.length; i++) {
    prev = arr[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// MACD(12,26,9): returns { hist, line, signal } or null. hist = MACD line − signal.
function macdCalc(values, fast = 12, slow = 26, sig = 9) {
  if (!Array.isArray(values) || values.length < slow + sig) return null;
  const closes = values.map((v) => parseFloat(v.close)).reverse(); // oldest-first
  const emaFast = emaArray(closes, fast);
  const emaSlow = emaArray(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );
  const defined = macdLine.filter((x) => x != null);
  if (defined.length < sig) return null;
  const sigArr = emaArray(defined, sig);
  const signal = sigArr[sigArr.length - 1];
  const line = defined[defined.length - 1];
  if (line == null || signal == null) return null;
  return { hist: line - signal, line, signal };
}

// Newest-first index of the last bar on or before `dateStr` (YYYY-MM-DD); -1 if none.
function indexAsOf(values, dateStr) {
  if (!Array.isArray(values)) return -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i].datetime <= dateStr) return i;
  }
  return -1;
}

// 50/200-day MA cross: current regime + trading days since the last cross.
// Returns { bullish, daysSince, ma50, ma200 } or null (needs 200+ bars).
function maCross(values, shortP = 50, longP = 200) {
  if (!Array.isArray(values) || values.length < longP + 1) return null;
  const ma50 = smaAt(values, shortP, 0);
  const ma200 = smaAt(values, longP, 0);
  if (ma50 == null || ma200 == null) return null;
  const bullish = ma50 - ma200 >= 0;
  let daysSince = null;
  const maxOffset = values.length - longP;
  for (let d = 1; d <= maxOffset; d++) {
    const s = smaAt(values, shortP, d);
    const l = smaAt(values, longP, d);
    if (s == null || l == null) break;
    if ((s - l >= 0) !== bullish) {
      daysSince = d; // the sign flipped between d-1 and d → cross ~d days ago
      break;
    }
  }
  return { bullish, daysSince, ma50, ma200 };
}

// ---- Buy Rating (1–10) -----------------------------------------------------
// A transparent momentum-led composite: ~60% momentum/trend, ~25% fundamentals,
// ~15% timing (RSI). Each metric maps to a 0–1 sub-score via fixed thresholds;
// missing metrics drop out and the remaining weights are renormalized.

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// A margin as a percentage of revenue, or null when either side is missing.
const margin = (part, revenue) =>
  (part != null && isFinite(part) && revenue) ? (part / revenue) * 100 : null;

// "Higher is better": lo → 0, hi → 1.
function lin(v, lo, hi) {
  if (v == null || !isFinite(v)) return null;
  return clamp01((v - lo) / (hi - lo));
}

// PEG: ≤1 great, ≥3 poor; ≤0 (negative earnings) = weak.
// Latest close vs the 52-week low, as a percentage (0 = at the low, positive =
// above it). The mirror of pctFromHigh.
function pctFromLow(values, lookback = 252) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const latest = parseFloat(values[0].close);
  let low = Infinity;
  const n = Math.min(values.length, lookback);
  for (let i = 0; i < n; i++) {
    const l = parseFloat(values[i].low);
    if (isFinite(l) && l > 0 && l < low) low = l;
  }
  if (!isFinite(latest) || !isFinite(low) || low === 0) return null;
  return ((latest - low) / low) * 100;
}

// Where the price sits in its 52-week range: 0 = on the low, 100 = on the high.
// One number that answers "how far into its own range is this?", which distance
// from the high alone cannot — a stock 30% off its high might be sitting on the
// floor of a tight range or halfway up a wide one.
function range52Pos(values, lookback = 252) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const latest = parseFloat(values[0].close);
  let high = -Infinity;
  let low = Infinity;
  const n = Math.min(values.length, lookback);
  for (let i = 0; i < n; i++) {
    const h = parseFloat(values[i].high);
    const l = parseFloat(values[i].low);
    if (isFinite(h) && h > high) high = h;
    if (isFinite(l) && l > 0 && l < low) low = l;
  }
  if (!isFinite(latest) || !isFinite(high) || !isFinite(low) || high <= low) return null;
  return ((latest - low) / (high - low)) * 100;
}

// Return between two points, both measured back from the latest bar.
// windowReturn(values, 252, 21) is the classic 12-1 momentum: a year of return
// that stops a month short of today. The skip is deliberate — the most recent
// month tends to reverse rather than continue, which is why the standard
// momentum construction leaves it out.
function windowReturn(values, fromDaysAgo, toDaysAgo = 0) {
  if (!Array.isArray(values) || values.length <= fromDaysAgo) return null;
  const a = parseFloat(values[toDaysAgo].close);
  const b = parseFloat(values[fromDaysAgo].close);
  if (!isFinite(a) || !isFinite(b) || b === 0) return null;
  return ((a - b) / b) * 100;
}

// Annualised realised volatility (%), from daily log returns. Momentum is
// divided by this so a 40% move in a quiet name outranks the same move in one
// that swings 40% routinely.
function realisedVol(values, lookback = 126) {
  if (!Array.isArray(values)) return null;
  const n = Math.min(values.length - 1, lookback);
  if (n < 20) return null;
  const r = [];
  for (let i = 0; i < n; i++) {
    const a = parseFloat(values[i].close);
    const b = parseFloat(values[i + 1].close);
    if (isFinite(a) && isFinite(b) && b > 0 && a > 0) r.push(Math.log(a / b));
  }
  if (r.length < 20) return null;
  const mean = r.reduce((t, x) => t + x, 0) / r.length;
  const varc = r.reduce((t, x) => t + (x - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(varc * 252) * 100;
}

// Share (%) of the last `months` 21-day blocks that closed higher than they
// started — it separates a steady climber from one that gapped once on news
// and has drifted ever since.
function positiveMonths(values, months = 12, span = 21) {
  if (!Array.isArray(values) || values.length < months * span + 1) return null;
  let up = 0;
  for (let k = 0; k < months; k++) {
    const a = parseFloat(values[k * span].close);
    const b = parseFloat(values[(k + 1) * span].close);
    if (!isFinite(a) || !isFinite(b) || b === 0) return null;
    if (a > b) up++;
  }
  return (up / months) * 100;
}

// A ratio of two absolutes, as a percentage. Derived server-side so the value
// on screen, in the export and in the chatbot's context is one number computed
// once — the same reason the margins are derived rather than taken from the feed.
function yieldPct(part, whole) {
  if (part == null || whole == null || !isFinite(part) || !isFinite(whole) || whole <= 0) return null;
  return (part / whole) * 100;
}

// Return per unit of risk taken.
function riskAdj(ret, vol) {
  if (ret == null || vol == null || !isFinite(ret) || !isFinite(vol) || vol <= 0) return null;
  return ret / vol;
}

// Percentile rank of each value within the universe (0–1, ties share the mean
// rank); null stays null.
//
// This replaces the absolute lin() thresholds for the return factors. A
// screener ranks a universe, and fixed cut-offs left a third to a half of it
// pinned at a floor or ceiling — a factor that is a constant across half the
// list cannot rank anything. Percentiles also hold up across regimes: in a bad
// quarter the best names still score well relatively, instead of everything
// collapsing to zero together.
function percentileRanks(vals) {
  const out = new Array(vals.length).fill(null);
  const idx = vals.map((v, i) => [v, i]).filter(([v]) => v != null && isFinite(v));
  if (idx.length === 0) return out;
  if (idx.length === 1) { out[idx[0][1]] = 0.5; return out; }
  idx.sort((a, b) => a[0] - b[0]);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const p = ((i + j) / 2) / (idx.length - 1);
    for (let k = i; k <= j; k++) out[idx[k][1]] = p;
    i = j + 1;
  }
  return out;
}

// Trend regime: above the 200-day line is the filter, a fresh cross the
// strongest (and, inverted, weakest) case. Categorical, so it is not ranked.
function trendRegimeSub(m) {
  const above = m.vs200ma == null || !isFinite(m.vs200ma) ? null : m.vs200ma > 0;
  const bull = above == null ? m.maBullish : above;
  if (bull == null) return null;
  const fresh = m.maCrossDays != null && m.maCrossDays <= 20;
  if (bull) return fresh ? 1.0 : 0.75;
  return fresh ? 0.0 : 0.25;
}

function pegScore(v) {
  if (v == null || !isFinite(v)) return null;
  if (v <= 0) return 0.2;
  return clamp01((3 - v) / (3 - 1));
}

// Forward P/E: ≤15 cheap, ≥45 rich; ≤0 (losses) = weak.
function peScore(v) {
  if (v == null || !isFinite(v)) return null;
  if (v <= 0) return 0.2;
  return clamp01((45 - v) / (45 - 15));
}

// RSI: rewards healthy uptrend (~55–70), penalizes overbought (>75) and weak (<30).
function rsiScore(r) {
  if (r == null || !isFinite(r)) return null;
  if (r < 30) return 0.15;
  if (r < 50) return 0.15 + ((r - 30) / 20) * (0.55 - 0.15);
  if (r < 70) return 0.55 + ((r - 50) / 20) * (1.0 - 0.55);
  if (r <= 75) return 1.0;
  if (r < 85) return 1.0 - ((r - 75) / 10) * (1.0 - 0.5);
  return 0.4;
}


// Weighted, renormalized composite of factors → { score01, score, rating, breakdown, coverage }.
// Share of the quality factor weight that must have usable data before a
// quality score is reported at all.
const QUALITY_MIN_WEIGHT = 0.4;

function scoreFactors(comps, minWeightFrac = 0) {
  let w = 0;
  let acc = 0;
  for (const c of comps) if (c.sub != null) { w += c.weight; acc += c.weight * c.sub; }
  if (w === 0) return null;
  const totalW = comps.reduce((a, c) => a + c.weight, 0);
  if (w / totalW < minWeightFrac) return null;
  const score01 = acc / w;
  return {
    score01,
    score: Math.round(score01 * 1000) / 10, // 0–100
    rating: Math.max(1, Math.min(10, Math.round(score01 * 9 + 1))),
    breakdown: comps.map((c) => ({
      label: c.label,
      weight: c.weight,
      sub: c.sub == null ? null : Math.round(c.sub * 100) / 100,
    })),
    coverage: Math.round((w / totalW) * 100),
  };
}

// Momentum (price/trend/volume), Quality (company data), and a blended Overall — each 1–10.
// Ranks the universe on each return factor, then scores every row.
//
// Momentum is comparative — the question a screener answers is "which of these
// is strongest", not "does this clear some absolute bar" — so each return
// factor becomes the stock's percentile among its peers. Quality stays
// absolute: a 25% margin is a 25% margin regardless of the company it keeps.
function applyScores(rows) {
  const at = (f) => percentileRanks(rows.map(f));

  const mom121 = at((r) => riskAdj(r.mom12_1, r.realisedVol));
  const ret6m = at((r) => riskAdj(r.sixMonthPct, r.realisedVol));
  const ret3m = at((r) => riskAdj(r.threeMonthPct, r.realisedVol));
  const fromHigh = at((r) => r.pctFromHigh);
  const consistency = at((r) => r.posMonths);
  const oneMonth = at((r) => r.oneMonthPct);

  rows.forEach((row, i) => {
    const sc = computeScores(row, {
      mom121: mom121[i],
      ret6m: ret6m[i],
      ret3m: ret3m[i],
      fromHigh: fromHigh[i],
      consistency: consistency[i],
      // Inverted: at a one-month horizon the strongest recent movers are the
      // likeliest to give some back, so leading this list is a caution.
      revers1m: oneMonth[i] == null ? null : 1 - oneMonth[i],
    });
    row.momentumScore = sc.momentum ? sc.momentum.score : null;
    row.momentumRating = sc.momentum ? sc.momentum.rating : null;
    row.momentumBreakdown = sc.momentum ? sc.momentum.breakdown : null;
    row.qualityScore = sc.quality ? sc.quality.score : null;
    row.qualityRating = sc.quality ? sc.quality.rating : null;
    row.qualityBreakdown = sc.quality ? sc.quality.breakdown : null;
    row.overallScore = sc.overall ? sc.overall.score : null;
    row.overallRating = sc.overall ? sc.overall.rating : null;
  });
}

// `x` carries this row's cross-sectional percentiles, computed across the whole
// universe by rankUniverse(). Momentum is a ranking question — "is this one of
// the stronger names on the list" — so the return factors are scored by where
// they sit among their peers rather than against fixed thresholds.
//
// What changed, and why (the previous set was measured against the live
// universe before being replaced):
//   - `RS vs S&P` was `3M return` minus a constant that is identical for every
//     stock, so it correlated 1.000 with 3M and could not reorder anything. It
//     spent a quarter of the weight restating one horizon. Ranking within the
//     universe is already relative, so no benchmark term is needed.
//   - `MACD` was binary 0.8/0.2 and correlated 0.022 with the composite;
//     `Vol trend` was unsigned, so a crash on heavy volume scored as well as a
//     breakout, and 51% of the universe sat at its floor. Both are dropped.
//   - `Short squeeze` correlated -0.223 with the composite and rewarded heavy
//     short interest, which predicts weaker returns, not stronger. Dropped: it
//     is not a momentum factor.
//   - The short horizons enter as `1M reversal`, inverted. At one month the
//     evidence is reversal, not continuation — the same reason the 12-1 factor
//     skips its final month.
function computeScores(m, x = {}) {
  const momComps = [
    { label: '12-1 momentum', weight: 20, sub: x.mom121 },
    { label: '6M return (risk-adj.)', weight: 18, sub: x.ret6m },
    { label: '3M return (risk-adj.)', weight: 17, sub: x.ret3m },
    { label: '% from 52W high', weight: 10, sub: x.fromHigh },
    { label: 'Trend regime', weight: 10, sub: trendRegimeSub(m) },
    { label: 'Consistency', weight: 10, sub: x.consistency },
    { label: '1M reversal', weight: 8, sub: x.revers1m },
    { label: 'RSI timing', weight: 7, sub: rsiScore(m.rsi) },
  ];
  // Earnings growth, PEG and forward P/E all describe earnings, so none of them
  // says anything useful about a company that does not have any. The feed still
  // supplies values — a positive-looking PEG of 0.16 on an $878M loss — and
  // pegScore/peScore only guard against a ratio <= 0, so they sail through.
  // Excluded rather than penalised: scoreFactors() renormalises over whatever
  // remains, so the surviving factors simply carry the score.
  const lossMaking = m.netIncomeTtm != null && m.netIncomeTtm < 0;
  const qualComps = [
    { label: 'Earnings growth', weight: 25, sub: lossMaking ? null : lin(m.earningsGrowthYoY, 0, 30) },
    { label: 'Revenue growth', weight: 20, sub: lin(m.revenueGrowthYoY, 0, 20) },
    { label: 'PEG', weight: 20, sub: lossMaking ? null : pegScore(m.peg) },
    { label: 'Forward P/E', weight: 10, sub: lossMaking ? null : peScore(m.forwardPe) },
    { label: 'Profit margin', weight: 15, sub: lin(m.profitMargin, 0, 25) },
    { label: 'ROE', weight: 10, sub: lin(m.roe, 0, 30) },
  ];

  // Momentum needs ~3 months of history to be meaningful.
  const momentum = m.threeMonthPct == null ? null : scoreFactors(momComps);
  // A quality score resting on a sliver of the factor weight is not a quality
  // score — below this share of available weight, report none at all and let
  // Overall fall back to momentum.
  const quality = scoreFactors(qualComps, QUALITY_MIN_WEIGHT);

  let overall = null;
  let o01 = null;
  if (momentum && quality) o01 = 0.65 * momentum.score01 + 0.35 * quality.score01;
  else if (momentum) o01 = momentum.score01;
  else if (quality) o01 = quality.score01;
  if (o01 != null) {
    overall = {
      score: Math.round(o01 * 1000) / 10,
      rating: Math.max(1, Math.min(10, Math.round(o01 * 9 + 1))),
    };
  }
  return { momentum, quality, overall };
}

// ---- API: portfolios (management) ------------------------------------------

app.get('/api/portfolios', requireAuth, route(async (req, res) => {
  res.json({ portfolios: await readPortfolios() });
}));

// Create an empty portfolio.
app.post('/api/portfolios', requireAdmin, route(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Portfolio name is required.' });
  if (name.length > 40) return res.status(400).json({ error: 'Name too long (max 40 chars).' });
  const p = await readPortfolios();
  if (Object.keys(p).some((n) => n.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: `Portfolio "${name}" already exists.` });
  }
  p[name] = [];
  await writePortfolios(p);
  res.json({ portfolios: p });
}));

// Rename a portfolio (preserves order + membership).
app.put('/api/portfolios/:name', requireAdmin, route(async (req, res) => {
  const oldName = decodeURIComponent(req.params.name);
  const newName = String(req.body?.newName || '').trim();
  if (!newName) return res.status(400).json({ error: 'New name is required.' });
  if (newName.length > 40) return res.status(400).json({ error: 'Name too long (max 40 chars).' });
  const p = await readPortfolios();
  if (!(oldName in p)) return res.status(404).json({ error: 'Portfolio not found.' });
  if (
    newName.toLowerCase() !== oldName.toLowerCase() &&
    Object.keys(p).some((n) => n.toLowerCase() === newName.toLowerCase())
  ) {
    return res.status(409).json({ error: `Portfolio "${newName}" already exists.` });
  }
  const rebuilt = {};
  for (const [k, v] of Object.entries(p)) rebuilt[k === oldName ? newName : k] = v;
  await writePortfolios(rebuilt);
  res.json({ portfolios: rebuilt });
}));

// Delete a portfolio (its stocks remain in any other portfolios).
app.delete('/api/portfolios/:name', requireAdmin, route(async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const p = await readPortfolios();
  if (!(name in p)) return res.status(404).json({ error: 'Portfolio not found.' });
  delete p[name];
  await writePortfolios(p);
  res.json({ portfolios: p });
}));

// Add a ticker to a portfolio.
app.post('/api/portfolios/:name/tickers', requireAdmin, route(async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const symbol = String(req.body?.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'Symbol is required.' });
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol format.' });
  const p = await readPortfolios();
  if (!(name in p)) return res.status(404).json({ error: 'Portfolio not found.' });
  if (p[name].includes(symbol)) {
    return res.status(409).json({ error: `${symbol} is already in "${name}".` });
  }
  p[name].push(symbol);
  await writePortfolios(p);

  // Cache the company name once (1 credit) so refreshes stay history-only.
  if (API_KEY && !(await readNames())[symbol]) {
    const nm = await fetchName(symbol);
    if (nm) await writeNames({ [symbol]: nm });
  }

  res.json({ portfolios: p });
}));

// Remove a ticker from one portfolio.
app.delete('/api/portfolios/:name/tickers/:symbol', requireAdmin, route(async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  const p = await readPortfolios();
  if (!(name in p)) return res.status(404).json({ error: 'Portfolio not found.' });
  p[name] = p[name].filter((s) => s !== symbol);
  await writePortfolios(p);
  res.json({ portfolios: p });
}));

// Remove a ticker from every portfolio (used by the "All" view).
app.delete('/api/tickers/:symbol', requireAdmin, route(async (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  const p = await readPortfolios();
  for (const name of Object.keys(p)) p[name] = p[name].filter((s) => s !== symbol);
  await writePortfolios(p);
  res.json({ portfolios: p });
}));

// Expire the per-symbol profile cache (sector / fundamentals / analyst) so the
// next refresh re-pulls it. Company names are static, so they're kept.
//
// Expire rather than delete: the backfill only manages a few symbols per call,
// so deleting the rows stripped sector, market cap and fundamentals out of the
// shared snapshot for the ten-odd minutes it ran, and every other viewer saw
// the holes. The old values stay visible and are replaced one by one.
app.post('/api/refresh-all', requireAdmin, route(async (req, res) => {
  const expired = await expireProfiles();
  const total = getUniverse(await readPortfolios()).length;
  const who = await currentUser(req);
  await beginRefresh(who ? who.email : null, total);
  res.json({ ok: true, expired, total });
}));

// The client calls this when its backfill loop finishes or gives up, so the
// notice clears promptly. readRefreshState() ages the flag out on its own if
// this never arrives — an admin can always just close the tab.
app.delete('/api/refresh-all', requireAdmin, route(async (req, res) => {
  await endRefresh();
  res.json({ ok: true });
}));

// Cheap poll for viewers: is a refresh running? Deliberately not the whole
// snapshot, since every open page hits this while one is in progress.
app.get('/api/status', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ refreshing: await readRefreshState() });
}));

// ---- API: stocks (the screener data) ---------------------------------------

// Compute the full screener payload live from the API. Backtest mode (asOf set)
// recomputes momentum as it looked on that date (plus forward returns); fundamentals
// are skipped — they aren't point-in-time. Returns {ok, payload} or {ok:false, status, error}.
async function computeStocks(asOf) {
  if (!API_KEY) {
    return { ok: false, status: 500, error: 'TWELVE_DATA_API_KEY is not set. Copy .env.example to .env and add your key.' };
  }

  const portfolios = await readPortfolios();
  const portfolioNames = Object.keys(portfolios);
  const symbols = getUniverse(portfolios);
  if (symbols.length === 0) {
    return { ok: true, payload: { stocks: [], portfolios: portfolioNames, asOf, updatedAt: new Date().toISOString() } };
  }

  // Fetch the S&P 500 (SPY) alongside the universe so we can compute relative
  // strength, without adding it to any portfolio or the output rows.
  const BENCHMARK = 'SPY';
  const fetchSymbols = symbols.includes(BENCHMARK) ? symbols : [...symbols, BENCHMARK];
  const symbolParam = encodeURIComponent(fetchSymbols.join(','));
  const names = await readNames();
  const profiles = asOf ? {} : await ensureProfiles(symbols); // no point-in-time fundamentals

  try {
    // Price and all the % / trend metrics come from one batched daily-close call.
    // Live: last ~300 bars. Backtest: from ~430 days before asOf through today, so we
    // have a full year of history before the date AND the bars after it (forward returns).
    let rangeParam = '&outputsize=300';
    if (asOf) {
      const start = new Date(asOf);
      start.setDate(start.getDate() - 430); // ~1 year of history before the as-of date
      const daysBack = Math.round((Date.now() - start.getTime()) / 86400000);
      const needed = Math.ceil(daysBack * 0.72) + 60; // approx trading days in range + buffer
      // Twelve Data batch limit: symbols × outputsize ≤ 100000.
      const maxPerSymbol = Math.floor(90000 / fetchSymbols.length);
      const outSize = Math.min(Math.max(needed, 300), maxPerSymbol, 5000);
      rangeParam = `&start_date=${start.toISOString().slice(0, 10)}&outputsize=${outSize}`;
    }
    const seriesRaw = await fetchJson(
      `${TD_BASE}/time_series?symbol=${symbolParam}&interval=1day${rangeParam}&apikey=${API_KEY}`
    );

    // A top-level error (bad key, rate limit) comes back as {status:"error"}.
    if (seriesRaw && seriesRaw.status === 'error') {
      const code = seriesRaw.code === 429 ? 429 : 502;
      return { ok: false, status: code, error: `Twelve Data: ${seriesRaw.message}` };
    }

    const series = normalizeBySymbol(seriesRaw, fetchSymbols);

    // Trading-day approximations: ~5 ≈ 1W, ~10 ≈ 2W, ~21 ≈ 1M, ~63 ≈ 3M, ~126 ≈ 6M, ~252 ≈ 1Y.
    const TODAY = 1;
    const ONE_WEEK = 5;
    const TWO_WEEK = 10;
    const ONE_MONTH = 21;
    const THREE_MONTH = 63;
    const SIX_MONTH = 126;
    const ONE_YEAR = 252;

    // Benchmark 3-month return (as of the chosen date, if backtesting).
    const spyFull = series[BENCHMARK]?.values;
    let spyThreeMonthPct;
    if (asOf && Array.isArray(spyFull)) {
      const sk = indexAsOf(spyFull, asOf);
      spyThreeMonthPct = sk >= 0 ? pctChange(spyFull.slice(sk), THREE_MONTH) : null;
    } else {
      spyThreeMonthPct = pctChange(spyFull, THREE_MONTH);
    }

    const stocks = symbols.map((sym) => {
      const s = series[sym] || {};
      const full = s.values;

      // In backtest mode, slice the series to the as-of date and compute forward returns.
      let values = full;
      let fwd1M = null, fwd3M = null, fwd6M = null, fwdSince = null;
      if (asOf) {
        const k = Array.isArray(full) ? indexAsOf(full, asOf) : -1;
        if (k >= 0) {
          values = full.slice(k); // index 0 = the as-of bar
          const base = parseFloat(full[k].close);
          const fret = (idx) =>
            idx >= 0 && idx < full.length && isFinite(base) && base > 0
              ? ((parseFloat(full[idx].close) - base) / base) * 100
              : null;
          fwd1M = fret(k - 21); // ~1 month after as-of
          fwd3M = fret(k - 63);
          fwd6M = fret(k - 126);
          fwdSince = fret(0); // as-of → latest
        } else {
          values = null; // as-of predates available history
        }
      }

      const ok = Array.isArray(values) && values.length > 0;
      const prof = profiles[sym] || {};
      const rvol = realisedVol(values); // one pass, reused by every risk-adjusted factor

      const threeMonthPct = pctChange(values, THREE_MONTH);
      const relStrength =
        threeMonthPct != null && spyThreeMonthPct != null
          ? threeMonthPct - spyThreeMonthPct
          : null;

      const price = ok ? parseFloat(values[0].close) : null;
      const targetUpside =
        price != null && price > 0 && prof.targetMean != null
          ? ((prof.targetMean - price) / price) * 100
          : null;

      const mc = maCross(values); // 50/200 regime + days since cross
      const mac = macdCalc(values); // MACD histogram + line + signal
      // Sort key so "most bullish" sorts to the top: fresh golden high, fresh death low.
      let maCrossRank = null;
      if (mc) {
        maCrossRank = mc.bullish
          ? (mc.daysSince == null ? 100 : 1000 - mc.daysSince)
          : (mc.daysSince == null ? -100 : -1000 + mc.daysSince);
      }

      const row = {
        symbol: sym,
        name: names[sym] || null,
        portfolios: membershipOf(sym, portfolios),
        sector: prof.sector || null,
        marketCap: prof.marketCap || null,
        forwardPe: prof.forwardPe ?? null,
        peg: prof.peg ?? null,
        earningsGrowthYoY: prof.earningsGrowthYoY ?? null,
        revenueGrowthYoY: prof.revenueGrowthYoY ?? null,
        profitMargin: margin(prof.netIncomeTtm, prof.revenueTtm),
        roe: prof.roe ?? null,
        revenueTtm: prof.revenueTtm ?? null,
        grossProfitTtm: prof.grossProfitTtm ?? null,
        netIncomeTtm: prof.netIncomeTtm ?? null,
        fcfTtm: prof.fcfTtm ?? null,
        netCash: prof.netCash ?? null,
        // Derived here rather than read from the feed. financials.profit_margin
        // is wrong for loss-makers with small revenue (+45% for a company
        // losing $878M), and gross_margin uses a different basis than
        // gross_profit / revenue. Deriving keeps the percentage equal to the
        // two absolute columns shown beside it, and works off whatever is in
        // the profile cache rather than needing a re-fetch.
        grossMargin: margin(prof.grossProfitTtm, prof.revenueTtm),
        fcfMargin: margin(prof.fcfTtm, prof.revenueTtm),
        shortPctFloat: prof.shortPctFloat ?? null,
        lastEarningsDate: prof.lastEarningsDate ?? null,
        lastSurprise: prof.lastSurprise ?? null,
        nextEarningsDate: prof.nextEarningsDate ?? null,
        nextEarningsEstimated: prof.nextEarningsEstimated ?? false,
        analystConsensus: prof.analystLabel ?? null,
        analystScore: prof.analystScore ?? null,
        analystTotal: prof.analystTotal ?? null,
        analystCounts: prof.analystCounts ?? null,
        targetMean: prof.targetMean ?? null,
        targetUpside,
        price,
        currency: s.meta?.currency || null,
        exchange: s.meta?.exchange || null,
        micCode: s.meta?.mic_code || null,
        historyDays: ok ? values.length : 0,
        latestDate: ok ? values[0].datetime : null,
        profileFetchedAt: prof.fetchedAt ?? null, // when sector/fundamentals/analyst were cached
        todayPct: pctChange(values, TODAY),
        yesterdayPct: singleDayChange(values, 1),
        oneWeekPct: pctChange(values, ONE_WEEK),
        twoWeekPct: pctChange(values, TWO_WEEK),
        oneMonthPct: pctChange(values, ONE_MONTH),
        threeMonthPct,
        sixMonthPct: pctChange(values, SIX_MONTH),
        oneYearPct: pctChange(values, ONE_YEAR),
        relStrength,
        pctFromHigh: pctFromHigh(values, 252),
        vs50ma: pctVsMA(values, 50),
        vs200ma: pctVsMA(values, 200),
        rsi: rsi(values, 14),
        maBullish: mc ? mc.bullish : null,
        maCrossDays: mc ? mc.daysSince : null,
        ma50: mc ? mc.ma50 : null,
        ma200: mc ? mc.ma200 : null,
        maCrossRank,
        macdHist: mac ? mac.hist : null,
        macdLine: mac ? mac.line : null,
        macdSignal: mac ? mac.signal : null,
        volTrend: volumeTrendPct(values),
        // Momentum inputs. All derived from the same daily bars, so they cost
        // no additional API credits.
        mom12_1: windowReturn(values, ONE_YEAR, ONE_MONTH), // 12 months, skipping the last
        pctFromLow: pctFromLow(values),
        fcfYield: yieldPct(prof.fcfTtm, prof.marketCap),      // FCF / market cap
        netCashPct: yieldPct(prof.netCash, prof.marketCap),   // net cash as % of market cap
        range52Pos: range52Pos(values),   // 0 = on the 52w low, 100 = on the high
        realisedVol: rvol,
        posMonths: positiveMonths(values),
        fwd1M,
        fwd3M,
        fwd6M,
        fwdSince,
        error: ok ? null : (s.message || 'No data returned for this symbol.'),
      };

      return row;
    });

    // Momentum is scored against the universe, so it can only be worked out
    // once every row exists — hence the second pass.
    applyScores(stocks);

    // Archive the bars we just fetched. Live pulls only — a backtest's range is
    // truncated and would corrupt the history. Awaited rather than fired and
    // forgotten, because a serverless instance is free to stop the moment the
    // response is sent, but never allowed to fail the refresh: the archive is a
    // by-product, and the screener must still work if it breaks.
    if (!asOf) {
      try {
        const b = await persistBars(symbols, series);
        if (b.inserted) {
          console.log(`bars: +${b.inserted} rows across ${b.symbols} symbols` +
                      (b.rewritten ? `, ${b.rewritten} rewritten in full` : ''));
        }
      } catch (err) {
        console.warn('bars: archive write failed (screener unaffected):', err.message);
      }
    }

    return { ok: true, payload: { stocks, portfolios: portfolioNames, asOf, updatedAt: new Date().toISOString() } };
  } catch (err) {
    return { ok: false, status: 502, error: `Failed to reach Twelve Data: ${err.message}` };
  }
}

// ============================================================================
// Bar archive
// ============================================================================
// Every refresh already fetches ~300 daily bars per symbol and throws them away.
// Keeping them costs no API credits and turns a rolling window into an archive.

// How many bars back to compare stored against freshly fetched. A split
// re-adjusts the entire history, so any old date reveals it.
const SPLIT_PROBE_BARS = 60;
const SPLIT_TOLERANCE = 0.005;   // 0.5% — past rounding, well short of any split
// Re-write this many already-stored bars each refresh. It is what upgrades a
// provisional close, captured while the market was open, to the settled one.
const BAR_OVERLAP = 5;

const barRow = (symbol, b) => {
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const close = num(b.close);
  if (close == null || !b.datetime) return null;
  return { symbol, d: String(b.datetime).slice(0, 10),
           open: num(b.open), high: num(b.high), low: num(b.low), close, volume: num(b.volume) };
};

// Only ever called for a live pull. A backtest fetches a different, truncated
// range, and persisting from that path would poison the archive.
async function persistBars(symbols, series) {
  const meta = await store.barsMaxDates();

  const probes = [];
  const have = [];
  for (const sym of symbols) {
    const v = series[sym] && series[sym].values;
    if (!Array.isArray(v) || !v.length) continue;
    have.push([sym, v]);
    const p = v[Math.min(SPLIT_PROBE_BARS, v.length - 1)];
    if (p && p.datetime) probes.push({ sym, d: String(p.datetime).slice(0, 10), close: parseFloat(p.close) });
  }
  const stored = await store.barsOn(probes.map((x) => x.d));
  const probeBySym = new Map(probes.map((x) => [x.sym, x]));

  let inserted = 0, rewritten = 0;
  for (const [sym, v] of have) {
    const rows = v.map((b) => barRow(sym, b)).filter(Boolean);
    if (!rows.length) continue;
    const m = meta.get(sym);

    // Nothing stored yet, or the fetched window does not reach back to what we
    // hold (a gap we cannot bridge) — take the whole window as the truth.
    let full = !m || !m.maxDate;
    if (!full) {
      const probe = probeBySym.get(sym);
      const was = probe ? stored.get(sym + '|' + probe.d) : undefined;
      // A split re-prices all of history; the archive has to be rebuilt.
      if (was != null && isFinite(probe.close) && probe.close > 0 &&
          Math.abs(was - probe.close) / probe.close > SPLIT_TOLERANCE) {
        full = true;
      } else if (!rows.some((r) => r.d === m.maxDate)) {
        full = true;   // no overlap with what we hold
      }
    }

    if (full) {
      await store.replaceBarsFor(sym, rows);
      rewritten++;
      inserted += rows.length;
      continue;
    }

    // Steady state: everything newer than what we hold, plus a short overlap so
    // a provisional close gets corrected.
    const at = rows.findIndex((r) => r.d === m.maxDate);
    const slice = rows.slice(0, Math.min(rows.length, at + 1 + BAR_OVERLAP));
    inserted += await store.upsertBars(slice);
  }
  return { inserted, rewritten, symbols: have.length };
}

// ============================================================================
// Chatbot
// ============================================================================
// The entire universe is ~110 tokens per stock, so the whole snapshot goes into
// the system prompt and there is no retrieval layer at all. Embeddings would be
// the wrong tool twice over: the data is a numeric table where "margin above
// 15%" is an exact filter rather than a similarity, and retrieval could only
// drop rows the answer needs. It stays viable to roughly 1,800 stocks, well past
// the 119-ticker ceiling the price API imposes.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const CHAT_MODEL = process.env.CHAT_MODEL || 'claude-sonnet-5';
// Two ceilings. The owner pays for the key and does the tuning, so they get
// room to work; everyone else gets enough to be useful without turning a shared
// login into an open tab on someone else's account.
const CHAT_DAILY_LIMIT = Number(process.env.CHAT_DAILY_LIMIT || 60);
const CHAT_DAILY_LIMIT_MEMBER = Number(process.env.CHAT_DAILY_LIMIT_MEMBER || 3);
// Generous on purpose. The model reasons before answering, and that reasoning
// is billed against max_tokens: at 1200 a ranking question spent the entire
// budget thinking and returned a "thinking" block with no text at all. The
// reasoning is worth keeping — working through 69 rows is exactly where a model
// miscounts — so the budget has to cover it plus the answer.
const CHAT_MAX_TOKENS = 6000;
const CHAT_MAX_TURNS = 12;      // trailing turns kept from the client's history
const CHAT_MAX_CHARS = 2000;    // per message

// The columns the model sees, and what each one means. Cryptic names invite
// confident misreadings, so every field is spelled out.
const CHAT_FIELDS = [
  ['symbol', 'ticker'],
  ['name', 'company name'],
  ['sector', 'sector'],
  ['portfolios', 'which of the user\'s watchlists it belongs to'],
  ['price', 'last close, in the currency column'],
  ['currency', 'reporting and price currency — money columns are NOT converted to USD'],
  ['marketCap', 'market capitalisation'],
  ['overallRating', 'composite 1-10: 65% momentum, 35% quality'],
  ['momentumRating', 'momentum 1-10, ranked against this universe'],
  ['qualityRating', 'quality 1-10 from fundamentals; blank when too few inputs are usable'],
  ['todayPct', 'return today, %'],
  ['oneWeekPct', 'return over 1 week, %'],
  ['twoWeekPct', 'return over 2 weeks, %'],
  ['oneMonthPct', 'return over 1 month, %'],
  ['threeMonthPct', 'return over 3 months, %'],
  ['sixMonthPct', 'return over 6 months, %'],
  ['oneYearPct', 'return over 1 year, %'],
  ['mom12_1', '12-month return excluding the most recent month, %'],
  ['pctFromHigh', 'distance below the 52-week high, % (negative)'],
  ['pctFromLow', 'distance above the 52-week low, % (positive)'],
  ['range52Pos', 'position in the 52-week range: 0 = on the low, 100 = on the high'],
  ['relStrength', '3-month return minus the S&P 500\'s'],
  ['rsi', 'RSI(14). Above 70 overbought, below 30 oversold'],
  ['vs50ma', 'price vs the 50-day average, %'],
  ['vs200ma', 'price vs the 200-day average, %'],
  ['maBullish', 'true when the 50-day sits above the 200-day'],
  ['maCrossDays', 'trading days since that crossover'],
  ['macdHist', 'MACD histogram'],
  ['volTrend', '5-day average volume vs 20-day, %'],
  ['realisedVol', 'annualised volatility, %'],
  ['posMonths', 'share of the last 12 months that closed up, %'],
  ['revenueTtm', 'revenue, trailing twelve months'],
  ['revenueGrowthYoY', 'quarterly revenue growth year on year, %'],
  ['grossProfitTtm', 'gross profit TTM'],
  ['grossMargin', 'gross profit / revenue, %'],
  ['netIncomeTtm', 'net income TTM — negative means loss-making'],
  ['profitMargin', 'net income / revenue, %'],
  ['earningsGrowthYoY', 'quarterly earnings growth year on year, %'],
  ['fcfTtm', 'free cash flow TTM'],
  ['fcfMargin', 'FCF / revenue, %'],
  ['fcfYield', 'FCF / market cap, % — the cleanest cheapness measure here'],
  ['netCash', 'cash minus debt; negative means net debt'],
  ['netCashPct', 'net cash as % of market cap. Meaningless for banks'],
  ['roe', 'return on equity, %'],
  ['forwardPe', 'forward price/earnings'],
  ['peg', 'PEG ratio — unreliable on this feed, treat with suspicion'],
  ['shortPctFloat', 'short interest as % of float'],
  ['nextEarningsDate', 'next earnings date'],
  ['nextEarningsEstimated', 'true when that date is an estimate, not confirmed'],
  ['lastEarningsDate', 'date of the last report'],
  ['lastSurprise', 'how far the last quarter beat/missed consensus, %'],
  ['latestDate', 'date of the most recent price bar'],
  ['historyDays', 'trading days of history available'],
];

function chatCsv(stocks) {
  const keys = CHAT_FIELDS.map(([k]) => k);
  const cell = (v) => {
    if (v == null) return '';
    if (Array.isArray(v)) return v.join(' ');
    if (typeof v === 'number') return String(Math.round(v * 100) / 100);
    const t = String(v);
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  return keys.join(',') + '\n' +
    stocks.filter((s) => !s.error).map((s) => keys.map((k) => cell(s[k])).join(',')).join('\n');
}

// The rules half of the prompt. Kept separate from the data so the data block
// alone carries the cache marker and survives between questions.
function chatRules(asOf, count) {
  return [
    'You are the analyst built into Ticker Lab, a stock screener. You answer questions about one',
    'fixed table of ' + count + ' stocks, supplied below. Prices and fundamentals are a snapshot taken',
    (asOf ? 'at ' + asOf + '.' : 'at an unknown time.'),
    '',
    'WHAT YOU DO NOT HAVE. Say so plainly rather than reaching for something plausible:',
    '  - no news, filings, transcripts, or any account of WHY a price moved',
    '  - no analyst ratings or price targets (the plan does not return them)',
    '  - no intraday prices, no data after the snapshot date, no live quotes',
    '  - no history beyond roughly 14 months, so no multi-year or all-time figures',
    '  - nothing about the user\'s holdings, position sizes, cost basis or tax position',
    '  - no stock outside the table below',
    '',
    'WHEN A QUESTION FALLS OUTSIDE THAT DATA:',
    '  Name the specific gap, then give what the table DOES show on the subject. "I have no news,',
    '  so I cannot tell you why it fell. What I can see: down 20% over three months, sitting at 25%',
    '  of its 52-week range, revenue still growing 25%." Never a bare refusal, and never a guess',
    '  dressed as an answer.',
    '',
    'GENERAL KNOWLEDGE is fine and welcome — what a company does, what PEG means, how RSI is built.',
    '  Answer those, and make clear it is background rather than something read off this table.',
    '',
    'YOU DO NOT GIVE BUY, SELL OR HOLD VERDICTS. Asked whether to buy something, set out what the',
    '  data supports on both sides and stop there. This is not a disclaimer, it is the same rule as',
    '  above: a verdict would need news, a valuation model, and the person\'s horizon and risk',
    '  tolerance, none of which you have. Do not append a standing disclaimer to every reply.',
    '',
    'PREDICTIONS. "Will it go up?" is not a missing-data problem, it is unknowable. Say so briefly,',
    '  then describe where the stock actually stands.',
    '',
    'BEING ACCURATE WITH NUMBERS:',
    '  - Quote figures from the table exactly. Do not re-derive one that is already a column.',
    '  - Ratios you might reach for are already computed: fcfYield, netCashPct, all three margins,',
    '    range52Pos. Use them rather than dividing.',
    '  - When ranking or counting, work through the rows deliberately and state how many matched.',
    '  - Blank means the field is missing for that stock, not zero. Say when it is missing.',
    '  - Money columns are in each company\'s own currency (see the currency column). Never compare',
    '    or total them across currencies; a KRW reporter dwarfs any USD one for no real reason.',
    '  - netIncomeTtm below zero means loss-making, which makes P/E, PEG and earnings growth',
    '    meaningless for that row.',
    '',
    'STYLE: brief and concrete. Lead with the answer. Small markdown tables when comparing several',
    'stocks. Always give the snapshot date when quoting prices or returns.',
  ].join('\n');
}

app.post('/api/chat', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!ANTHROPIC_KEY) {
    return res.status(503).json({ error: 'The assistant is not configured: ANTHROPIC_API_KEY is unset.' });
  }

  const incoming = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  const messages = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-CHAT_MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, CHAT_MAX_CHARS) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Ask a question first.' });
  }

  const who = await currentUser(req);
  const owner = await isAdmin(req);
  const limit = owner ? CHAT_DAILY_LIMIT : CHAT_DAILY_LIMIT_MEMBER;
  // Keyed on the account, so sharing a login shares the allowance rather than
  // multiplying it. Falls back for the legacy admin cookie, which has no user row.
  const quota = await store.noteChatUse(who ? who.email : 'admin', limit);
  if (!quota.allowed) {
    return res.status(429).json({
      error: `You have used your ${quota.limit} questions for today. The allowance resets at midnight UTC.`,
    });
  }

  const snap = await readSnapshot();
  const stocks = (snap && snap.stocks) || [];
  if (!stocks.length) {
    return res.status(503).json({ error: 'No screener data yet — refresh the screener first.' });
  }
  const asOf = snap.updatedAt || null;

  let data;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        max_tokens: CHAT_MAX_TOKENS,
        system: [
          { type: 'text', text: chatRules(asOf, stocks.filter((s) => !s.error).length) },
          // The table changes only when the screener is refreshed, so it is
          // worth caching: every question after the first re-reads it cheaply.
          {
            type: 'text',
            text: 'COLUMNS\n' + CHAT_FIELDS.map(([k, d]) => `  ${k}: ${d}`).join('\n') +
                  '\n\nDATA (CSV, one row per stock)\n' + chatCsv(stocks),
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
      }),
    });
    data = await r.json();
    if (!r.ok) {
      // Never surface the upstream body: it can echo the request, and the key
      // lives in the same headers.
      console.error('anthropic error', r.status, data && data.error && data.error.type);
      return res.status(502).json({ error: 'The assistant is unavailable right now. Try again shortly.' });
    }
  } catch (err) {
    console.error('anthropic call failed', err.message);
    return res.status(502).json({ error: 'Could not reach the assistant.' });
  }

  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  // Distinguish "ran out of room" from "said nothing": the first is actionable.
  const ranOut = data.stop_reason === 'max_tokens';
  res.json({
    reply: text || (ranOut
      ? 'That needed more room than I have. Try a narrower question — fewer stocks, or one thing at a time.'
      : 'No answer came back — try rephrasing.'),
    asOf,
    used: quota.used,
    limit: quota.limit,
  });
}));

// One row out of the snapshot. The stock page needs a single stock, and
// /api/stocks is 172 KB — most of it about the other 68.
app.get('/api/stock', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  const snap = await readSnapshot();
  const stocks = (snap && snap.stocks) || [];
  const stock = stocks.find((x) => String(x.symbol).toUpperCase() === symbol);
  if (!stock) return res.status(404).json({ error: 'Not in the screener.' });
  // Rank across the universe, so the page agrees with the table's Rank column.
  const ranked = stocks.filter((x) => x.overallScore != null)
    .slice().sort((a, b) => b.overallScore - a.overallScore);
  const rank = ranked.findIndex((x) => x.symbol === stock.symbol);
  res.json({
    stock,
    rank: rank >= 0 ? rank + 1 : null,
    rankTotal: ranked.length,
    updatedAt: snap.updatedAt || null,
  });
}));

// Per-account UI preferences. Keyed on the signed-in email, falling back to
// 'admin' for the legacy cookie and for open mode, where there is no user row —
// the same key convention chat_usage uses.
async function prefsKey(req) {
  const who = await currentUser(req);
  return who ? who.email : 'admin';
}

app.get('/api/prefs', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ prefs: await store.readPrefs(await prefsKey(req)) });
}));

app.put('/api/prefs', requireAuth, route(async (req, res) => {
  const incoming = req.body && req.body.prefs;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: 'Expected a prefs object.' });
  }
  // Only what the app actually understands is stored, so a client cannot use
  // this as free per-user storage, and a future field cannot arrive by accident.
  const collapsed = {};
  const src = incoming.collapsed && typeof incoming.collapsed === 'object' ? incoming.collapsed : {};
  for (const k of Object.keys(src).slice(0, 40)) {
    if (/^[a-z]{1,16}$/.test(k)) collapsed[k] = !!src[k];
  }
  await store.writePrefs(await prefsKey(req), { collapsed });
  res.json({ ok: true });
}));

// Closes for the whole universe, for the table's sparklines. One query rather
// than 69, and loaded after the table paints — a decoration must not make the
// data wait on it.
app.get('/api/sparklines', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const days = Math.min(400, Math.max(20, Number(req.query.days) || 90));
  const snap = await readSnapshot();
  const symbols = ((snap && snap.stocks) || []).filter((x) => !x.error).map((x) => x.symbol);
  if (!symbols.length) return res.json({ closes: {}, days });
  // A calendar cutoff rather than a row limit: one query for every symbol, and
  // US tickers share trading days so they come back the same length.
  const since = new Date(Date.now() - Math.round(days * 1.45) * 86400000)
    .toISOString().slice(0, 10);
  const closes = await store.readCloses(symbols, since);
  for (const k of Object.keys(closes)) {
    closes[k] = closes[k].slice(-days).map((v) => Math.round(v * 100) / 100);
  }
  res.json({ closes, days });
}));

// Closes for one symbol, oldest-first, for the hover card's chart. Reads the
// archive only — no API call, so it costs nothing and works for every signed-in
// user. Fetched per symbol on hover and cached in the browser rather than
// shipping all 69 series with the table, most of which are never looked at.
app.get('/api/history', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,15}$/.test(symbol)) return res.status(400).json({ error: 'Bad symbol.' });
  // Floor of 2, not 20: the shortest range on the stock page is a trading
  // week. Ceiling is the archive's depth, about 20 years.
  const days = Math.min(5200, Math.max(2, Number(req.query.days) || 260));

  const bars = await store.readBars(symbol, days);   // newest-first
  if (!bars.length) return res.json({ symbol, dates: [], closes: [], volumes: [], from: null, to: null });
  const asc = bars.slice().reverse();
  res.json({
    symbol,
    from: asc[0].datetime,
    to: asc[asc.length - 1].datetime,
    dates: asc.map((b) => b.datetime),
    // 2dp keeps the payload small; a chart 600px wide cannot show more.
    closes: asc.map((b) => Math.round(b.close * 100) / 100),
    // Volume is split-adjusted the same way price is, so it is comparable
    // across the series but is not the literal share count for a past day.
    volumes: asc.map((b) => (b.volume == null ? 0 : Math.round(b.volume))),
  });
}));

// Snapshot: the public sees the last computed data (no live API calls). Admin
// refreshes recompute live and overwrite it.
app.get('/api/stocks', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store'); // never let the browser serve a stale copy

  // Backtest mode: ?asOf=YYYY-MM-DD recomputes momentum as it looked on that date.
  const asOfRaw = String(req.query.asOf || '').trim();
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) ? asOfRaw : null;
  // A live pull (recompute from the API) happens for a backtest or an explicit
  // ?refresh=1 (the admin Refresh / Refresh All). Everything else serves the snapshot.
  const wantLive = !!asOf || req.query.refresh === '1';

  if (wantLive) {
    if (!(await isAdmin(req))) {
      return res.status(403).json({ error: 'Admin only — log in to refresh or run a backtest.' });
    }
    const r = await computeStocks(asOf);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    if (!asOf) {
      await writeSnapshot({ ...r.payload, snapshotAt: r.payload.updatedAt }); // cache live (non-backtest) pulls
      // Keep the shared flag in step. noteRefreshProgress only touches a refresh
      // that is already running, so an ordinary price Refresh — seconds long —
      // never raises the banner.
      const rows = r.payload.stocks || [];
      const loaded = rows.filter((x) => x.profileFetchedAt != null).length;

      // Snapshot today's fundamentals — but only during a Refresh all, which is
      // when the profile cache has actually been re-pulled. An ordinary price
      // Refresh reuses day-old cached profiles, so writing then would record
      // the same numbers under a new date and invent movement that never
      // happened. readRefreshState() is non-null only while a Refresh all runs.
      if (await readRefreshState()) {
        try {
          // Rows whose profile has not come back yet are skipped rather than
          // stored empty; a later round in the same run upserts over them.
          const withProfile = rows.filter((x) => !x.error && x.profileFetchedAt != null);
          const n = await store.writeFundamentals(new Date().toISOString().slice(0, 10), withProfile);
          if (n) console.log(`fundamentals: ${n} symbols recorded for today`);
        } catch (err) {
          // A history write must never fail a refresh — same rule as the bars.
          console.warn('fundamentals: history write failed (screener unaffected):', err.message);
        }
      }

      if (rows.length && loaded >= rows.length) await endRefresh();
      else await noteRefreshProgress(loaded, rows.length);
    }
    return res.json({ ...r.payload, refreshing: await readRefreshState() });
  }

  // Public read: serve the saved snapshot — no API calls, no credits burned.
  const snap = await readSnapshot();
  if (snap) return res.json({ ...snap, fromSnapshot: true, refreshing: await readRefreshState() });

  // No snapshot yet: an admin (or open/local mode) computes and seeds the first one.
  if (await isAdmin(req)) {
    const r = await computeStocks(null);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    await writeSnapshot({ ...r.payload, snapshotAt: r.payload.updatedAt });
    return res.json(r.payload);
  }
  return res.json({ stocks: [], portfolios: Object.keys(await readPortfolios()), asOf: null, updatedAt: null, fromSnapshot: true, empty: true });
}));

// Wipe the log. Irreversible — the client confirms before calling this.
app.delete('/api/visitors', requireAdmin, route(async (req, res) => {
  const removed = await store.clearVisitors();
  res.json({ ok: true, removed });
}));

app.get('/api/visitors', requireAdmin, route(async (req, res) => {
  // Counted and sliced in SQL — the old version parsed the entire log on every
  // request just to produce three totals and the last 500 rows.
  res.json(await store.readVisitorStats(500));
}));

store.init().then(
  () => console.log('Turso: schema ready'),
  (err) => console.error('Turso: schema init failed —', err.message)
);

app.listen(PORT, () => {
  console.log(`Stock screener POC running at http://localhost:${PORT}`);
  if (!API_KEY) {
    console.warn('WARNING: TWELVE_DATA_API_KEY is not set — /api/stocks will return an error until you add it to .env');
  }
});
