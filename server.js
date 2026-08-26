// Stock Momentum Screener — POC backend
// No database: portfolios (name -> [symbols]) live in a flat JSON file
// (portfolios.json). A stock can belong to multiple portfolios (many-to-many).
// The "universe" fetched from Twelve Data is the deduped union of all portfolios.

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TWELVE_DATA_API_KEY;
const TD_BASE = 'https://api.twelvedata.com';
const TICKERS_FILE = path.join(__dirname, 'tickers.json'); // legacy, for one-time migration
const PORTFOLIOS_FILE = path.join(__dirname, 'portfolios.json');
const NAMES_FILE = path.join(__dirname, 'names.json');
const PROFILES_FILE = path.join(__dirname, 'profiles.json');
const SNAPSHOT_FILE = path.join(__dirname, 'snapshot.json'); // last computed data served to the public (read-only)
const VISITORS_FILE = path.join(__dirname, 'visitors.log');
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

app.set('trust proxy', 1); // so req.secure reflects an HTTPS reverse proxy when published
app.use(express.json());

// Log every public page load before static files are served.
app.get(['/', '/index.html'], (req, res, next) => {
  const entry = {
    ts: new Date().toISOString(),
    ip: req.ip || null,
    ua: req.headers['user-agent'] || null,
    ref: req.headers['referer'] || req.headers['referrer'] || null,
  };
  try { fs.appendFileSync(VISITORS_FILE, JSON.stringify(entry) + '\n'); } catch { /* ignore */ }
  next();
});

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

function isAdmin(req) {
  if (!AUTH_REQUIRED) return true; // no password configured → open
  const tok = parseCookies(req)[ADMIN_COOKIE];
  return !!tok && safeEqual(tok, adminToken());
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(403).json({ error: 'Admin only — log in to make changes.' });
}

app.get('/api/me', (req, res) => {
  res.json({ admin: isAdmin(req), authRequired: AUTH_REQUIRED });
});

app.post('/api/login', (req, res) => {
  if (!AUTH_REQUIRED) return res.json({ ok: true, admin: true });
  if (!safeEqual(String(req.body?.password || ''), ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  res.cookie(ADMIN_COOKIE, adminToken(), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: req.secure, // set only over HTTPS (true behind an HTTPS proxy)
  });
  res.json({ ok: true, admin: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(ADMIN_COOKIE);
  res.json({ ok: true });
});

// ---- Portfolio persistence (flat file, no DB) ------------------------------

function normalizePortfolios(obj) {
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

function readPortfolios() {
  try {
    const obj = JSON.parse(fs.readFileSync(PORTFOLIOS_FILE, 'utf8'));
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return normalizePortfolios(obj);
  } catch {
    /* fall through to migration */
  }
  // One-time migration from a legacy flat tickers.json, else start empty.
  let legacy = [];
  try {
    const t = JSON.parse(fs.readFileSync(TICKERS_FILE, 'utf8'));
    if (Array.isArray(t)) legacy = t;
  } catch {
    /* no legacy file */
  }
  const migrated = legacy.length ? { Watchlist: legacy } : {};
  writePortfolios(migrated);
  return normalizePortfolios(migrated);
}

function writePortfolios(obj) {
  fs.writeFileSync(PORTFOLIOS_FILE, JSON.stringify(normalizePortfolios(obj), null, 2));
}

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

// ---- Company name cache (flat file) ----------------------------------------
// Names never change, so we fetch them once (on add) and reuse them. This keeps
// every refresh at just 1 API credit per ticker (time_series only).

function readNames() {
  try {
    return JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeNames(map) {
  fs.writeFileSync(NAMES_FILE, JSON.stringify(map, null, 2));
}

// ---- Profile cache: sector + fundamentals (premium endpoints) --------------
// Sector is static; fundamentals move slowly. We cache per symbol and refresh at
// most once a day, so a normal refresh stays a single time_series call.

function readProfiles() {
  try {
    return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeProfiles(map) {
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(map, null, 2));
}

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
    profitMargin: null,
    roe: null,
    // absolute size, all TTM except the balance-sheet pair (most recent quarter)
    revenueTtm: null,
    grossProfitTtm: null,
    netIncomeTtm: null,
    fcfTtm: null,
    netCash: null,
    // derived from the absolutes above, not from the API's own margin fields —
    // those are computed on a different basis and don't equal grossProfit / revenue
    grossMargin: null,
    fcfMargin: null,
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
      if (fin && fin.profit_margin != null) out.profitMargin = fin.profit_margin * 100;
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
      if (out.revenueTtm) {
        if (out.grossProfitTtm != null) out.grossMargin = (out.grossProfitTtm / out.revenueTtm) * 100;
        if (out.fcfTtm != null) out.fcfMargin = (out.fcfTtm / out.revenueTtm) * 100;
      }
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
  const profiles = readProfiles();
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
    if (results.length) writeProfiles(profiles);
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

// "Higher is better": lo → 0, hi → 1.
function lin(v, lo, hi) {
  if (v == null || !isFinite(v)) return null;
  return clamp01((v - lo) / (hi - lo));
}

// PEG: ≤1 great, ≥3 poor; ≤0 (negative earnings) = weak.
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

// 50/200 cross as a 0–1 sub-score: golden regime good (fresh = best), death bad.
function maCrossSub(m) {
  if (m.maBullish == null) return null;
  const fresh = m.maCrossDays != null && m.maCrossDays <= 20;
  if (m.maBullish) return fresh ? 1.0 : 0.7;
  return fresh ? 0.0 : 0.3;
}
// MACD histogram sign as a 0–1 confirmation sub-score.
function macdSub(m) {
  if (m.macdHist == null || !isFinite(m.macdHist)) return null;
  return m.macdHist >= 0 ? 0.8 : 0.2;
}

// Weighted, renormalized composite of factors → { score01, score, rating, breakdown, coverage }.
function scoreFactors(comps) {
  let w = 0;
  let acc = 0;
  for (const c of comps) if (c.sub != null) { w += c.weight; acc += c.weight * c.sub; }
  if (w === 0) return null;
  const totalW = comps.reduce((a, c) => a + c.weight, 0);
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
function computeScores(m) {
  const momComps = [
    { label: '6M return', weight: 15, sub: lin(m.sixMonthPct, -15, 40) },
    { label: '3M return', weight: 12, sub: lin(m.threeMonthPct, -10, 25) },
    { label: '1Y return', weight: 10, sub: lin(m.oneYearPct, -20, 80) },
    { label: 'RS vs S&P', weight: 14, sub: lin(m.relStrength, -10, 20) },
    { label: 'vs 200D MA', weight: 8, sub: lin(m.vs200ma, -10, 20) },
    { label: 'vs 50D MA', weight: 6, sub: lin(m.vs50ma, -10, 15) },
    { label: '% from 52W high', weight: 8, sub: lin(m.pctFromHigh, -40, 0) },
    { label: 'MA cross', weight: 8, sub: maCrossSub(m) },
    { label: 'MACD', weight: 6, sub: macdSub(m) },
    { label: 'Vol trend', weight: 5, sub: lin(m.volTrend, -30, 60) },
    { label: 'RSI timing', weight: 8, sub: rsiScore(m.rsi) },
    { label: 'Short squeeze', weight: 5, sub: lin(m.shortPctFloat, 0, 20) }, // high short % of float = squeeze fuel
  ];
  const qualComps = [
    { label: 'Earnings growth', weight: 25, sub: lin(m.earningsGrowthYoY, 0, 30) },
    { label: 'Revenue growth', weight: 20, sub: lin(m.revenueGrowthYoY, 0, 20) },
    { label: 'PEG', weight: 20, sub: pegScore(m.peg) },
    { label: 'Forward P/E', weight: 10, sub: peScore(m.forwardPe) },
    { label: 'Profit margin', weight: 15, sub: lin(m.profitMargin, 0, 25) },
    { label: 'ROE', weight: 10, sub: lin(m.roe, 0, 30) },
  ];

  // Momentum needs ~3 months of history to be meaningful.
  const momentum = m.threeMonthPct == null ? null : scoreFactors(momComps);
  const quality = scoreFactors(qualComps);

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

app.get('/api/portfolios', (req, res) => {
  res.json({ portfolios: readPortfolios() });
});

// Create an empty portfolio.
app.post('/api/portfolios', requireAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Portfolio name is required.' });
  if (name.length > 40) return res.status(400).json({ error: 'Name too long (max 40 chars).' });
  const p = readPortfolios();
  if (Object.keys(p).some((n) => n.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: `Portfolio "${name}" already exists.` });
  }
  p[name] = [];
  writePortfolios(p);
  res.json({ portfolios: p });
});

// Rename a portfolio (preserves order + membership).
app.put('/api/portfolios/:name', requireAdmin, (req, res) => {
  const oldName = decodeURIComponent(req.params.name);
  const newName = String(req.body?.newName || '').trim();
  if (!newName) return res.status(400).json({ error: 'New name is required.' });
  if (newName.length > 40) return res.status(400).json({ error: 'Name too long (max 40 chars).' });
  const p = readPortfolios();
  if (!(oldName in p)) return res.status(404).json({ error: 'Portfolio not found.' });
  if (
    newName.toLowerCase() !== oldName.toLowerCase() &&
    Object.keys(p).some((n) => n.toLowerCase() === newName.toLowerCase())
  ) {
    return res.status(409).json({ error: `Portfolio "${newName}" already exists.` });
  }
  const rebuilt = {};
  for (const [k, v] of Object.entries(p)) rebuilt[k === oldName ? newName : k] = v;
  writePortfolios(rebuilt);
  res.json({ portfolios: rebuilt });
});

// Delete a portfolio (its stocks remain in any other portfolios).
app.delete('/api/portfolios/:name', requireAdmin, (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const p = readPortfolios();
  if (!(name in p)) return res.status(404).json({ error: 'Portfolio not found.' });
  delete p[name];
  writePortfolios(p);
  res.json({ portfolios: p });
});

// Add a ticker to a portfolio.
app.post('/api/portfolios/:name/tickers', requireAdmin, async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const symbol = String(req.body?.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'Symbol is required.' });
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol format.' });
  const p = readPortfolios();
  if (!(name in p)) return res.status(404).json({ error: 'Portfolio not found.' });
  if (p[name].includes(symbol)) {
    return res.status(409).json({ error: `${symbol} is already in "${name}".` });
  }
  p[name].push(symbol);
  writePortfolios(p);

  // Cache the company name once (1 credit) so refreshes stay history-only.
  if (API_KEY && !readNames()[symbol]) {
    const nm = await fetchName(symbol);
    if (nm) {
      const names = readNames();
      names[symbol] = nm;
      writeNames(names);
    }
  }

  res.json({ portfolios: p });
});

// Remove a ticker from one portfolio.
app.delete('/api/portfolios/:name/tickers/:symbol', requireAdmin, (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  const p = readPortfolios();
  if (!(name in p)) return res.status(404).json({ error: 'Portfolio not found.' });
  p[name] = p[name].filter((s) => s !== symbol);
  writePortfolios(p);
  res.json({ portfolios: p });
});

// Remove a ticker from every portfolio (used by the "All" view).
app.delete('/api/tickers/:symbol', requireAdmin, (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  const p = readPortfolios();
  for (const name of Object.keys(p)) p[name] = p[name].filter((s) => s !== symbol);
  writePortfolios(p);
  res.json({ portfolios: p });
});

// Clear the per-symbol profile cache (sector / fundamentals / analyst) so the next
// refresh re-pulls it fresh from the API. Company names are static, so they're kept.
app.post('/api/refresh-all', requireAdmin, (req, res) => {
  try {
    writeProfiles({});
  } catch {
    /* ignore */
  }
  res.json({ ok: true });
});

// ---- API: stocks (the screener data) ---------------------------------------

// Compute the full screener payload live from the API. Backtest mode (asOf set)
// recomputes momentum as it looked on that date (plus forward returns); fundamentals
// are skipped — they aren't point-in-time. Returns {ok, payload} or {ok:false, status, error}.
async function computeStocks(asOf) {
  if (!API_KEY) {
    return { ok: false, status: 500, error: 'TWELVE_DATA_API_KEY is not set. Copy .env.example to .env and add your key.' };
  }

  const portfolios = readPortfolios();
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
  const names = readNames();
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
        profitMargin: prof.profitMargin ?? null,
        roe: prof.roe ?? null,
        revenueTtm: prof.revenueTtm ?? null,
        grossProfitTtm: prof.grossProfitTtm ?? null,
        netIncomeTtm: prof.netIncomeTtm ?? null,
        fcfTtm: prof.fcfTtm ?? null,
        netCash: prof.netCash ?? null,
        grossMargin: prof.grossMargin ?? null,
        fcfMargin: prof.fcfMargin ?? null,
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
        fwd1M,
        fwd3M,
        fwd6M,
        fwdSince,
        error: ok ? null : (s.message || 'No data returned for this symbol.'),
      };

      const sc = computeScores(row);
      row.momentumScore = sc.momentum ? sc.momentum.score : null;
      row.momentumRating = sc.momentum ? sc.momentum.rating : null;
      row.momentumBreakdown = sc.momentum ? sc.momentum.breakdown : null;
      row.qualityScore = sc.quality ? sc.quality.score : null;
      row.qualityRating = sc.quality ? sc.quality.rating : null;
      row.qualityBreakdown = sc.quality ? sc.quality.breakdown : null;
      row.overallScore = sc.overall ? sc.overall.score : null;
      row.overallRating = sc.overall ? sc.overall.rating : null;
      return row;
    });

    return { ok: true, payload: { stocks, portfolios: portfolioNames, asOf, updatedAt: new Date().toISOString() } };
  } catch (err) {
    return { ok: false, status: 502, error: `Failed to reach Twelve Data: ${err.message}` };
  }
}

// Snapshot: the public sees the last computed data (no live API calls). Admin
// refreshes recompute live and overwrite it.
function readSnapshot() {
  try { return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')); } catch { return null; }
}
function writeSnapshot(payload) {
  try { fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(payload)); } catch { /* ignore */ }
}

app.get('/api/stocks', async (req, res) => {
  res.set('Cache-Control', 'no-store'); // never let the browser serve a stale copy

  // Backtest mode: ?asOf=YYYY-MM-DD recomputes momentum as it looked on that date.
  const asOfRaw = String(req.query.asOf || '').trim();
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) ? asOfRaw : null;
  // A live pull (recompute from the API) happens for a backtest or an explicit
  // ?refresh=1 (the admin Refresh / Refresh All). Everything else serves the snapshot.
  const wantLive = !!asOf || req.query.refresh === '1';

  if (wantLive) {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin only — log in to refresh or run a backtest.' });
    }
    const r = await computeStocks(asOf);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    if (!asOf) writeSnapshot({ ...r.payload, snapshotAt: r.payload.updatedAt }); // cache live (non-backtest) pulls
    return res.json(r.payload);
  }

  // Public read: serve the saved snapshot — no API calls, no credits burned.
  const snap = readSnapshot();
  if (snap) return res.json({ ...snap, fromSnapshot: true });

  // No snapshot yet: an admin (or open/local mode) computes and seeds the first one.
  if (isAdmin(req)) {
    const r = await computeStocks(null);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    writeSnapshot({ ...r.payload, snapshotAt: r.payload.updatedAt });
    return res.json(r.payload);
  }
  return res.json({ stocks: [], portfolios: Object.keys(readPortfolios()), asOf: null, updatedAt: null, fromSnapshot: true, empty: true });
});

app.get('/api/visitors', requireAdmin, (req, res) => {
  let entries = [];
  try {
    const raw = fs.readFileSync(VISITORS_FILE, 'utf8');
    entries = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { /* no log yet */ }
  const today = new Date().toISOString().slice(0, 10);
  const total = entries.length;
  const todayCount = entries.filter((e) => e.ts.startsWith(today)).length;
  const uniqueIps = new Set(entries.map((e) => e.ip)).size;
  res.json({ total, todayCount, uniqueIps, entries: entries.slice(-500).reverse() });
});

app.listen(PORT, () => {
  console.log(`Stock screener POC running at http://localhost:${PORT}`);
  if (!API_KEY) {
    console.warn('WARNING: TWELVE_DATA_API_KEY is not set — /api/stocks will return an error until you add it to .env');
  }
});
