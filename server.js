// Stock Momentum Screener — POC backend
// State lives in Turso (hosted libSQL); every read and write goes through db.js.
// Portfolios map a name -> [symbols], and a stock can belong to several
// (many-to-many). The "universe" fetched from Twelve Data is the deduped union
// of all portfolios.

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TWELVE_DATA_API_KEY;
const TD_BASE = 'https://api.twelvedata.com';
// Persistence lives in Turso (libSQL). The accessors below keep the shapes the
// old flat-file helpers returned, so this file only had to gain `await`s.
// See db.js and migrate-to-turso.js.
const store = require('./db');
// The analysis screens, shared with public/analysis.html so the nightly report
// and the page can never disagree about what "bouncing off the lows" means.
const Screens = require('./private/screens.js');
// The Excel model of the momentum calculation, shared with the CLI in the same
// file so the workbook served here and the one written locally are one thing.
const { buildModel, MODEL_ROWS, MODEL_MIN_BARS } = require('./momentum-model.js');
// Momentum scored from bars alone, shared with the backfill so the stored
// history and the live score can never drift into two different models.
const Momentum = require('./momentum.js');
// Tunable indicators, shared with /lab and the offline grid.
const Indicators = require('./private/indicators.js');
// The Action rules — what to do with each stock. Shared with the browser so a
// later personal profile can re-score locally without a second implementation.
const Action = require('./private/action.js');
const News = require('./news.js');
const {
  readPortfolios, writePortfolios,
  readNames, writeNames,
  readProfiles, writeProfiles, expireProfiles,
  readSnapshot, writeSnapshot,
  beginRefresh, noteRefreshProgress, endRefresh, readRefreshState,
} = store;
// How long a cached profile stays fresh — and therefore how often a symbol's
// fundamentals are re-pulled. It was 24 hours, which meant every profile in the
// universe was stale every night: at 80 credits a symbol that is 80,000 credits
// and two and a half hours at 1,000 symbols, spent on twelve fields that move
// on 1-5% of nights and move as a STEP when they do (AVGO's revenue sat at
// 75.46B for five recorded days, went to 89.10B, and stayed). A week spreads
// the same work over seven nights for a seventh of the nightly bill. Set
// FUND_ROTATION_DAYS=1 to go back to re-pulling everything every night.
const FUND_ROTATION_DAYS = Math.max(1, Number(process.env.FUND_ROTATION_DAYS) || 7);
const PROFILE_TTL_MS = FUND_ROTATION_DAYS * 24 * 60 * 60 * 1000;
// Publishing: set ADMIN_PASSWORD in .env to make the app read-only for the public.
// The public sees a cached snapshot; only an admin (logged in with this password)
// can add/remove tickers, refresh, Refresh All, and rewind the table. When it's NOT
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
// and — when analyst is on — /recommendations + /price_target. Costs are not
// uniform: a symbol in a batched time_series call is 1 credit, but /statistics
// is 50, measured off the Api-Credits-Used header in Sep 2026. Against a 610
// credits/minute Pro limit that makes six cold profiles about 300 credits, so
// credits are the binding constraint after all — two refresh rounds inside one
// minute are refused. The cap below keeps a single round inside the budget, and
// the rest fill in on later refreshes, then cache for a day.
// The price fetch is CHUNKED (<=120 symbols a call — the API's hard batch
// cap), so the universe is no longer bound by it. What binds now, measured
// 2026-09-13 off Api-Credits-Request: 610 credits/minute, a cold profile is
// 80 (statistics 50 + profile 10 + earnings 20) and prices are 1/symbol —
// so an archive-priced round affords 7 profiles, and a round that also
// pulls prices sizes its profile batch down to fit (see liveRefreshOpts).
const MAX_PROFILE_FETCHES_PER_CALL = ANALYST_ENABLED ? 4 : 6;
const PROFILE_CAP_ARCHIVE_ROUND = ANALYST_ENABLED ? 4 : 7;   // 7 x 80 = 560 <= 610
const CREDITS_PER_MINUTE = 610;
const CREDITS_PER_PROFILE = 80;
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
  logAct(req, 'page', 'screener');
  next();
}));

app.get('/analysis', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  if (await isGuest(req)) return res.redirect('/');
  logAct(req, 'page', 'analysis');
  res.sendFile(path.join(__dirname, 'private', 'analysis.html'));
}));

// One stock, in full. The symbol is read client-side from the path, so every
// ticker serves the same file.
app.get('/stock/:symbol', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  if ((await isGuest(req)) && !guestSet.has(String(req.params.symbol || '').toUpperCase())) {
    return res.redirect('/');
  }
  logAct(req, 'page', 'stock:' + String(req.params.symbol || '').toUpperCase().slice(0, 12));
  res.sendFile(path.join(__dirname, 'private', 'stock.html'));
}));

// Open to any signed-in user, like /analysis and /chat — it explains the app to
// whoever is using it, so gating it behind admin would defeat the point.
// A real backtest: a rule, positions, and an equity curve. The runs are
// precomputed offline (strategy-runs.js) because simulating 116 symbols across
// 4,700 sessions is neither a browser nor a serverless job; this route only
// serves the page, and the page reads the static results.
app.get('/strategy', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  if (await isGuest(req)) return res.redirect('/');
  logAct(req, 'page', 'strategy');
  res.sendFile(path.join(__dirname, 'private', 'strategy.html'));
}));

// The same rule on one stock at a time: when to own it, when to hold cash.
// Unlike /strategy nothing is precomputed — the page ships every symbol's closes
// and simulates in the browser, because the position cap is a nonlinearity and
// cannot be applied by scaling a stored run after the fact.
app.get('/single', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  if (await isGuest(req)) return res.redirect('/');
  logAct(req, 'page', 'single');
  res.sendFile(path.join(__dirname, 'private', 'single.html'));
}));

// Build an indicator and watch what it does. The page computes everything
// itself from the bars this ships, so a slider drag redraws without a request.
app.get('/lab/:symbol', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  if (await isGuest(req)) return res.redirect('/');
  logAct(req, 'page', 'lab:' + String(req.params.symbol || '').toUpperCase().slice(0, 12));
  res.sendFile(path.join(__dirname, 'private', 'lab.html'));
}));

// One portfolio, aggregated — the basket page. Works for shared portfolios
// and a member's own lists ('my:' prefix); a screener view, deliberately not
// a tracker: there are no positions anywhere in this product.
app.get('/portfolio/:name', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  if (await isGuest(req)) return res.redirect('/');
  logAct(req, 'page', 'basket:' + String(req.params.name || '').slice(0, 30));
  res.sendFile(path.join(__dirname, 'private', 'basket.html'));
}));

// The member room for the shared card builders — three of them, one shape.
// The promo studio at /promo stays the owner's superset: the explainers and
// the announcement card are the brand's own voice.
app.get('/cards', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  if (await isGuest(req)) return res.redirect('/');
  logAct(req, 'page', 'cards');
  res.sendFile(path.join(__dirname, 'private', 'cards.html'));
}));

app.get('/help', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  logAct(req, 'page', 'help');
  res.sendFile(path.join(__dirname, 'private', 'help.html'));
}));

app.get('/contact', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  if (await isGuest(req)) return res.redirect('/');
  logAct(req, 'page', 'contact');
  res.sendFile(path.join(__dirname, 'private', 'contact.html'));
}));

app.get('/reset', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset.html'));
});

app.get('/users', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'private', 'users.html'));
}));

app.get('/chat', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  if (await isGuest(req)) return res.redirect('/');
  logAct(req, 'page', 'chat');
  res.sendFile(path.join(__dirname, 'private', 'chat.html'));
}));

// Deliberately open, and it reveals only a count. private/ is not a Vercel
// static directory, so if the platform ever stopped bundling it with the
// function every gated page would 404 and it would look like a routing bug.
// This says which it is. Counted at boot; the directory does not change while
// the process runs.
const PRIVATE_DIR = path.join(__dirname, 'private');
// The exact filenames private/ holds, read once. This is what the guard below
// matches against, so it can tell "a gated asset" from "a route defined further
// down this file" without a syscall per request. private/ is flat and does not
// change while the process runs.
let PRIVATE_FILES = new Set();
try { PRIVATE_FILES = new Set(fs.readdirSync(PRIVATE_DIR)); } catch { PRIVATE_FILES = new Set(); }
const PRIVATE_ASSETS = PRIVATE_FILES.size;
if (!PRIVATE_ASSETS) console.error('[assets] private/ is EMPTY or unreadable — every gated page will 404');

app.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: PRIVATE_ASSETS > 0, assets: PRIVATE_ASSETS });
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Bounce a gated page's raw .html path to its routed path, where the guard
// runs, so each page has one canonical URL. This also covers the admin-only
// pages: /users.html lands on /users, which checks isAdmin.
//
// NOTE THIS ONLY WORKS BECAUSE THE FILES LEFT public/. Vercel serves anything in
// public/ straight from its CDN and never invokes the function, so while these
// pages lived there this redirect had never once run in production — every
// gated .html answered 200 to anyone with the URL, as did every research JSON
// file. Locally it worked, which is exactly why it went unnoticed.
const GATED_PAGES = { '/chat.html': '/chat', '/analysis.html': '/analysis', '/visitors.html': '/visitors',
                      '/activity.html': '/activity', '/promo.html': '/promo',
                      '/admin.html': '/admin', '/refreshes.html': '/refreshes', '/database.html': '/database',
                      '/news-runs.html': '/news-runs',
                      '/nasdaq.html': '/nasdaq',
                      '/cards.html': '/cards',
                      '/users.html': '/users', '/reset.html': '/reset',
                      '/contact.html': '/contact', '/help.html': '/help',
                      // no symbol in that path, so there is nothing to show
                      '/stock.html': '/',
                      // no symbol in that path either
                      '/lab.html': '/', '/strategy.html': '/strategy',
                      '/single.html': '/single' };
app.get(Object.keys(GATED_PAGES), (req, res) => res.redirect(GATED_PAGES[req.path]));

// Open assets: the login and reset pages and what they need to render. Vercel
// serves these from its CDN, which is fine — they are meant to be reachable
// without a session. NOTHING ELSE BELONGS HERE.
app.use(express.static(path.join(__dirname, 'public')));

// Everything else. private/ is not a Vercel static directory, so these requests
// fall through to this function and this guard decides.
//
// A document request redirects to the sign-in page; anything else answers 401,
// because the pages fetch their data with fetch() and already know to send you
// to /login on a 401. Redirecting an XHR to an HTML page instead would hand the
// caller a login form where it expected JSON.
const gateAssets = route(async (req, res, next) => {
  // GUARD ONLY WHAT private/ ACTUALLY HOLDS, and let everything else past.
  // app.use() sees every request that reaches it, and every API route in this
  // file is registered BELOW this line — so a version of this that refused
  // outright swallowed POST /api/login and made signing in impossible. The
  // whole site, not just the gated part. Matching against the real file list
  // makes this middleware a no-op for anything that is a route.
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const rel = req.path === '/' ? 'index.html' : req.path.replace(/^\/+/, '');
  if (!PRIVATE_FILES.has(rel)) return next();
  if (await isSignedIn(req)) {
    if (GUEST_BLOCKED_ASSET.test(rel) && (await isGuest(req))) {
      return res.status(403).json({ error: 'Not on the guest preview.' });
    }
    return next();
  }
  // Content negotiation cannot make this call: a browser's fetch() sends
  // `Accept: */*`, exactly like a navigation, so req.accepts() answers "html"
  // for both and every data file got a redirect. fetch follows redirects, so
  // the page received 200 and a login form where it expected JSON, and reported
  // "no price file yet" instead of sending anyone to sign in. Sec-Fetch-Dest is
  // set by the browser and says what the request is FOR; the extension is the
  // fallback for anything that does not send it.
  const ext = path.extname(req.path).toLowerCase();
  const dest = String(req.get('sec-fetch-dest') || '').toLowerCase();
  const isPage = dest ? dest === 'document' : (ext === '' || ext === '.html');
  if (isPage) return res.redirect('/login');
  res.status(401).json({ error: 'Sign in required' });
});
app.use(gateAssets, express.static(path.join(__dirname, 'private')));

// The NASDAQ reference list. Admin only, and deliberately a page of its own:
// it is a different vendor's view of a different universe, and the whole point
// is that it never touches the screener.
app.get('/nasdaq', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  logAct(req, 'page', 'nasdaq');
  res.sendFile(path.join(__dirname, 'private', 'nasdaq.html'));
}));

// The admin console: one door in the screener's bar instead of a dozen, and
// the home of everything that is not a description of the table in front of
// you. Admin only — the screener keeps the research menu for members, who
// cannot come here.
app.get('/admin', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  logAct(req, 'page', 'admin');
  res.sendFile(path.join(__dirname, 'private', 'admin.html'));
}));

// Admin only, like /users. The data behind it (GET /api/visitors) has always
// been guarded, so this only ever served an empty shell — but it was the one
// page route that did not check, and GATED_PAGES funnels /visitors.html here.
app.get('/visitors', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'private', 'visitors.html'));
}));

// Admin only: the news job's log — every batch of headline fetches.
app.get('/news-runs', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  logAct(req, 'page', 'news-runs');
  res.sendFile(path.join(__dirname, 'private', 'news-runs.html'));
}));

// Admin only: every table in the database, with its row and column count.
app.get('/database', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  logAct(req, 'page', 'database');
  res.sendFile(path.join(__dirname, 'private', 'database.html'));
}));

// Admin only: every refresh run, manual or scheduled, with its rounds.
app.get('/refreshes', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  logAct(req, 'page', 'refreshes');
  res.sendFile(path.join(__dirname, 'private', 'refreshes.html'));
}));

// Admin only, like /visitors — what every user is doing, fact by fact.
app.get('/activity', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'private', 'activity.html'));
}));

// The promo studio: fixed marketing-card templates rendered from tonight's
// data in the site's own theme. Open to every signed-in member since
// 2026-09-15; the Announcement template stays the owner's (hidden in the
// page — it is free text, so there is nothing server-side to guard). Guests
// are sent back: /api/basket, which the chart cards read, is member-only.
app.get('/promo', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  if (await isGuest(req)) return res.redirect('/');
  logAct(req, 'page', 'promo');
  res.sendFile(path.join(__dirname, 'private', 'promo.html'));
}));

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

// The nightly job's credential. Deliberately not admin: it satisfies exactly
// one route, /api/cron/refresh, so a leak cannot delete a portfolio. Unset means
// the route is closed entirely rather than open.
const CRON_SECRET = process.env.CRON_SECRET || '';

function isCron(req) {
  if (!CRON_SECRET) return false;
  const h = String(req.get('authorization') || '');
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  return !!tok && safeEqual(tok, CRON_SECRET);
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
  if (await currentUser(req)) return true;
  // The guest cookie opens the door too; what a guest may SEE is decided
  // per route, never here.
  const tok = parseCookies(req)[GUEST_COOKIE];
  return !!tok && safeEqual(tok, guestToken());
}

// ---- guest access -----------------------------------------------------
// "Try as guest" on the login page: a deterministic HMAC cookie, no account,
// no sessions row, 24 hours. Guests see GUEST_SYMBOLS and nothing else, and
// every limit is enforced HERE, on the server — a limit enforced in the
// browser is not a limit (the CDN incident's lesson). The token is shared by
// design; it grants only this filtered read-only view, and rotating
// ADMIN_PASSWORD revokes every outstanding guest cookie at once.
const GUEST_COOKIE = 'st_guest';
const GUEST_HOURS = 24;
const GUEST_SYMBOLS = String(process.env.GUEST_SYMBOLS || 'NVDA,JPM,PTON,JOBY,DELL')
  .split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const guestSet = new Set(GUEST_SYMBOLS);
const guestToken = () =>
  crypto.createHmac('sha256', ADMIN_PASSWORD || 'open').update('guest-access-v1').digest('hex');
async function isGuest(req) {
  if (!AUTH_REQUIRED) return false;               // open mode is already open
  const tok = parseCookies(req)[GUEST_COOKIE];
  if (!tok || !safeEqual(tok, guestToken())) return false;
  if (await isAdmin(req)) return false;
  return !(await currentUser(req));               // a real login outranks the guest cookie
}
// The research data — every close, every stored run — is exactly what the
// guest view exists to not hand out, and so are the pages built on it.
const GUEST_BLOCKED_ASSET =
  /^(strategy-.*\.json|single-closes\.json|lab-grid\.json|chat\.html|analysis\.html|signal\.html|lab\.html|strategy\.html|single\.html|contact\.html)$/;

// Signed in with a real account — the guest preview stops here.
const requireMember = route(async (req, res, next) => {
  if (!(await isSignedIn(req))) return res.status(401).json({ error: 'Please sign in.' });
  if (await isGuest(req)) {
    return res.status(403).json({ error: 'Not on the guest preview — create an account for the full screener.' });
  }
  next();
});

const requireAdmin = route(async (req, res, next) => {
  if (await isAdmin(req)) return next();
  res.status(403).json({ error: 'Admin only — log in to make changes.' });
});

const requireAuth = route(async (req, res, next) => {
  if (await isSignedIn(req)) return next();
  res.status(401).json({ error: 'Please sign in.' });
});

// ---- activity log -----------------------------------------------------
// Who did what, fact-only. Fire-and-forget like the visitor log: a logging
// failure must never block or slow the action it describes. The key is the
// account email; 'admin' for the legacy password cookie; a guest is
// 'guest-<id>' from the st_gid cookie (set by the guest door below) so one
// guest's walk can be followed — the shared st_guest token cannot tell two
// guests apart.
const ACTIVITY_KEEP_DAYS = 60;
const GUEST_ID_COOKIE = 'st_gid';
async function actKey(req) {
  const who = await currentUser(req);
  if (who) return who.email;
  if (await isAdmin(req)) return AUTH_REQUIRED ? 'admin' : 'open';
  if (await isGuest(req)) {
    const gid = String(parseCookies(req)[GUEST_ID_COOKIE] || '').replace(/[^a-f0-9]/gi, '').slice(0, 12);
    return 'guest-' + (gid || 'anon');
  }
  return null;
}
function logAct(req, kind, detail, userKey) {
  Promise.resolve(userKey !== undefined ? userKey : actKey(req))
    .then((user) => store.logActivity([{
      ts: new Date().toISOString(),
      user,
      kind: String(kind).slice(0, 16),
      detail: detail == null ? null : String(detail).slice(0, 80),
      ip: req.ip || null,
    }]))
    .catch(() => { /* never blocks the action */ });
}

app.get('/api/me', route(async (req, res) => {
  const u = await currentUser(req);
  const admin = await isAdmin(req);
  res.json({
    guest: await isGuest(req),
    admin,
    authRequired: AUTH_REQUIRED,
    signedIn: await isSignedIn(req),
    user: u ? { email: u.email, role: u.role } : (admin && AUTH_REQUIRED ? { email: null, role: 'owner' } : null),
    signupCodeRequired: !!SIGNUP_CODE,
  });
}));

// Create an account. The first account created becomes the owner, so a fresh
// install can bootstrap itself; everyone after that is a read-only member.
// Registration is open, so the owner is told each time somebody takes the link
// up on it — both as a welcome and as the moderation prompt, since removing an
// account is the only lever there is.
//
// Never sent for the very first account: that one becomes the owner, so the
// note would be an email telling you that you had joined your own site.
async function sendSignupNotice(email, role) {
  if (!MAIL_READY || role === 'owner') return false;
  try {
    const to = await operatorEmail();
    if (!to || to.toLowerCase() === email.toLowerCase()) return false;

    const total = await store.countUsers();
    const rows = [
      ['Email', email],
      ['Role', role],
      ['Joined', fmtClock(Date.now())],
      ['Accounts now', String(total)],
    ].map(([k, v]) =>
      `<tr><td style="padding:3px 14px 3px 0;font-size:14px;color:${MC.mute};white-space:nowrap">${mailEsc(k)}</td>` +
      `<td style="padding:3px 0;font-size:14px;color:${MC.ink}">${mailEsc(v)}</td></tr>`).join('');

    const note = 'New accounts cannot sign in until you approve them on the accounts page. ' +
      'Replying to this email answers the applicant directly.';

    return await sendMail({
      to,
      // The address came from the form, but it has just been used to create an
      // account, so a reply reaches the person who typed it.
      replyTo: email,
      subject: `Approval needed: ${email}`,
      text: textShell({
        heading: 'New sign-up awaiting approval',
        intro: `${email} registered and is waiting to be let in.`,
        lines: [`Role: ${role}`, `Joined: ${fmtClock(Date.now())}`, `Accounts now: ${total}`]
          .concat(APP_URL ? ['', `Approve or remove: ${APP_URL}/users`] : []),
        note,
      }),
      html: emailShell({
        heading: 'New sign-up awaiting approval',
        intro: `${email} registered and is waiting to be let in.`,
        body: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
          `style="margin-top:18px">${rows}</table>` +
          (APP_URL ? mailButton(`${APP_URL}/users`, 'Review & approve') : ''),
        note,
      }),
    });
  } catch (err) {
    console.warn('signup notice: could not send (registration unaffected):', err.message);
    return false;
  }
}

// A new account gets one note: what this is, and the one thing worth doing
// first. Never allowed to fail the registration that triggered it — an account
// that exists but could not be greeted is still a working account.
async function sendWelcome(email, role) {
  if (!MAIL_READY) return false;
  try {
    const owner = role === 'owner';
    const intro = owner
      ? `Your ${BRAND} instance is live, and this first account owns it.`
      : `You now have access to ${BRAND} — a momentum screener for a watchlist of stocks, ` +
        'refreshed after every close.';
    const bullets = [
      ['The screener', 'Every ticker scored on momentum and quality, with 48 columns you can ' +
        'collapse into groups and sort however you like.'],
      ['Signal screens', 'Seven views the sorted table cannot give you — bases turning up, ' +
        'names that have just started moving, earnings drift, and what is stretched.'],
      ['Ask', 'Put a question to the data in plain English rather than reading down a column.'],
    ];
    if (owner) {
      bullets.push(['Refresh all', 'Re-pulls every company profile and emails you a report ' +
        'when it finishes. It also runs on its own each evening.']);
    }
    const rows = bullets.map(([h, d]) =>
      `<tr><td style="padding:0 0 14px"><strong style="color:${MC.ink}">${h}</strong><br>` +
      `<span style="color:${MC.mute};font-size:14px">${d}</span></td></tr>`).join('');

    return await sendMail({
      to: email,
      replyTo: process.env.MAIL_REPLY_TO || undefined,
      subject: `Welcome to ${BRAND}`,
      text: textShell({
        heading: `Welcome to ${BRAND}`,
        intro,
        lines: bullets.map(([h, d]) => `${h} — ${d}`).concat(APP_URL ? ['', APP_URL] : []),
        note: 'You are receiving this because an account was created with this address.',
      }),
      html: emailShell({
        heading: `Welcome to ${BRAND}`,
        intro,
        body: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
          `style="width:100%;margin-top:20px">${rows}</table>` +
          (APP_URL ? mailButton(APP_URL, 'Open the screener') : ''),
        note: 'You are receiving this because an account was created with this address.',
      }),
    });
  } catch (err) {
    console.warn('welcome: could not send (registration unaffected):', err.message);
    return false;
  }
}

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
  // Every member starts PENDING and cannot sign in until the owner approves
  // (the first account bootstraps the instance, so it alone skips the gate).
  // No session is created for a pending account, and getSessionUser refuses
  // pending rows besides — approval is enforced, not decoration.
  const status = role === 'owner' ? 'active' : 'pending';
  const user = await store.createUser({ email, passwordHash, salt, role, status });
  logAct(req, 'login', 'signup', email);

  if (status === 'pending') {
    res.json({ ok: true, pending: true });
    // The sign-up notice to the operator is the approval request; the welcome
    // waits until approval, when it is true.
    sendSignupNotice(email, role).catch(() => {});
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  await store.createSession(token, Number(user.id), Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  setSessionCookie(res, token);
  res.json({ ok: true, user: { email, role } });

  // After the response: the account is made and the session is set, so a slow
  // or failing mail provider must not hold up the sign-up or fail it.
  sendWelcome(email, role).catch(() => {});
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
    logAct(req, 'login', 'password', AUTH_REQUIRED ? 'admin' : 'open');
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
  if ((user.status || 'active') === 'pending') {
    return res.status(403).json({
      error: 'Your account is awaiting approval by the owner — you will get an email when it is ready.',
    });
  }
  const token = crypto.randomBytes(32).toString('hex');
  await store.createSession(token, Number(user.id), Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  setSessionCookie(res, token);
  logAct(req, 'login', 'account', user.email);
  res.json({ ok: true, admin: user.role === 'owner', user: { email: user.email, role: user.role } });
}));

app.post('/api/logout', route(async (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  logAct(req, 'account', 'logout');
  if (token) await store.deleteSession(token);
  res.clearCookie(SESSION_COOKIE);
  res.clearCookie(ADMIN_COOKIE);
  res.clearCookie(GUEST_COOKIE);
  res.json({ ok: true });
}));

// The guest door. No body, no password: the button on the login page is the
// whole ceremony. 24 hours, then the cookie lapses on its own.
app.post('/api/guest', route(async (req, res) => {
  if (!AUTH_REQUIRED) return res.json({ ok: true });
  res.cookie(GUEST_COOKIE, guestToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: GUEST_HOURS * 60 * 60 * 1000,
  });
  // The st_guest token is shared by every guest on purpose; this second
  // cookie is a random id used ONLY as the activity-log key, so one guest's
  // walk is one trail. Kept if it already exists — a returning guest stays
  // the same trail.
  let gid = String(parseCookies(req)['st_gid'] || '').replace(/[^a-f0-9]/gi, '').slice(0, 12);
  if (!gid) {
    gid = crypto.randomBytes(6).toString('hex');
    res.cookie('st_gid', gid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: GUEST_HOURS * 60 * 60 * 1000,
    });
  }
  logAct(req, 'login', 'guest', 'guest-' + gid);
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
  logAct(req, 'account', 'password-changed', me.email);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
}));

// ============================================================================
// Email
// ============================================================================
// Resend over plain fetch — a REST call does not justify a fourth dependency
// alongside express, dotenv and the Turso client.
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || '';
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
const MAIL_READY = !!(RESEND_KEY && MAIL_FROM && APP_URL);

// MAIL_FROM may be a bare address or a "Name <addr>" pair. Either way the name
// shown to a reader is the app's own.
function fromHeader() {
  const m = /<([^>]+)>/.exec(MAIL_FROM);
  const addr = (m ? m[1] : MAIL_FROM).trim();
  return `${BRAND} <${addr}>`;
}

// Resolves true when accepted. Never throws: a failed send must not decide
// what the caller tells the user, because the reply is deliberately the same
// either way.
// ---- the look of an email ---------------------------------------------------
// Every message the app sends goes through emailShell(), so a reader sees one
// sender rather than four different-looking notes. Only the middle changes.
//
// Written as tables with inline styles because that is what mail clients
// support: Outlook renders through Word, most clients strip <style> blocks, and
// flexbox and grid are not available. The wordmark is text, not an image —
// images are blocked by default in most clients, so a logo would leave a broken
// box where the brand should be.

const BRAND = 'Tickr Lab';
const BRAND_TAG = 'Momentum screening, one page.';

// Colours picked for a light background rather than lifted from the app: mail
// clients invert or ignore dark themes unpredictably, and a screenshot-black
// email tends to arrive unreadable somewhere.
const MC = {
  ink: '#12151c', body: '#3d4450', mute: '#6b7382', faint: '#98a0ae',
  line: '#e4e7ec', panel: '#f6f7f9', head: '#0c0f16', accent: '#0f9d58', bad: '#c5221f',
};

const mailEsc = (t) => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A pill button that survives Outlook, which ignores border-radius on <a>.
function mailButton(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0">` +
    `<tr><td style="border-radius:999px;background:${MC.head}">` +
    `<a href="${href}" style="display:inline-block;padding:13px 26px;font-family:` +
    `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
    `font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">` +
    `${mailEsc(label)}</a></td></tr></table>`;
}

// `note` is the one line that says why this particular message arrived — the
// question a reader asks first about mail they did not expect.
function emailShell({ heading, intro, body = '', note = '' }) {
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const site = APP_URL || '';
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"></head>` +
    `<body style="margin:0;padding:0;background:${MC.panel}">` +
    // Preheader: the grey line clients show beside the subject. Left to the
    // intro rather than invented, and hidden in the body itself.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${mailEsc(intro)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="background:${MC.panel};padding:28px 12px">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ` +
    `style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${MC.line};border-radius:14px;overflow:hidden">` +

    // Header. The mark is an image and the wordmark is text, on purpose: most
    // clients block images by default for a sender you have not written to
    // before, and someone opening their first password reset would otherwise
    // see an empty box where the brand should be. Blocked, this degrades to
    // exactly the header it had before the logo existed.
    //
    // A PNG rather than the SVG in public/ — Gmail strips <img> pointing at SVG
    // and Outlook will not render one. Shipped at 128px and displayed at 30 so
    // it stays sharp on a retina screen, with width and height set so the
    // layout does not jump while it loads, and the cell painted the header
    // colour so a transparent or blocked image is invisible rather than a pale
    // rectangle — which also survives Gmail's dark-mode repainting.
    `<tr><td style="background:${MC.head};padding:18px 28px">` +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
    (site
      ? `<td style="padding-right:10px;line-height:0;background:${MC.head}">` +
        `<img src="${site}/logo.png" width="30" height="30" alt="Tickr Lab" ` +
        `style="display:block;width:30px;height:30px;border:0;outline:none;text-decoration:none;` +
        `color:#8b93a3;font-family:${sans};font-size:13px;font-weight:700"></td>`
      : '') +
    `<td style="background:${MC.head}">` +
    `<span style="font-family:${sans};font-size:17px;font-weight:700;letter-spacing:-0.4px;color:#ffffff">Tickr</span>` +
    `<span style="font-family:${sans};font-size:17px;font-weight:700;letter-spacing:-0.4px;color:#8b93a3"> Lab</span>` +
    '</td></tr></table></td></tr>' +

    // content
    `<tr><td style="padding:30px 28px 8px">` +
    `<h1 style="margin:0 0 12px;font-family:${sans};font-size:21px;line-height:1.3;` +
    `font-weight:700;letter-spacing:-0.4px;color:${MC.ink}">${mailEsc(heading)}</h1>` +
    `<p style="margin:0;font-family:${sans};font-size:15px;line-height:1.62;color:${MC.body}">${mailEsc(intro)}</p>` +
    `</td></tr>` +
    `<tr><td style="padding:0 28px 26px;font-family:${sans};font-size:15px;line-height:1.62;color:${MC.body}">` +
    `${body}</td></tr>` +

    // footer
    `<tr><td style="padding:18px 28px 22px;border-top:1px solid ${MC.line};background:#fbfcfd">` +
    (note ? `<p style="margin:0 0 10px;font-family:${sans};font-size:12.5px;line-height:1.6;color:${MC.mute}">${note}</p>` : '') +
    `<p style="margin:0;font-family:${sans};font-size:12.5px;line-height:1.6;color:${MC.faint}">` +
    `<strong style="color:${MC.mute}">${BRAND}</strong> — ${BRAND_TAG}` +
    (site ? `<br><a href="${site}" style="color:${MC.mute};text-decoration:underline">${site.replace(/^https?:\/\//, '')}</a>` : '') +
    `</p></td></tr>` +

    `</table></td></tr></table></body></html>`;
}

// The plain-text half gets the same treatment, or the two halves read as if they
// came from different products.
function textShell({ heading, intro, lines = [], note = '' }) {
  const out = [BRAND.toUpperCase(), '='.repeat(BRAND.length), '', heading, '', intro];
  if (lines.length) out.push('', ...lines);
  out.push('', '—'.repeat(28));
  if (note) out.push(note);
  out.push(`${BRAND} — ${BRAND_TAG}`);
  if (APP_URL) out.push(APP_URL);
  return out.join('\n');
}

async function sendMail({ to, subject, text, html, replyTo }) {
  if (!MAIL_READY) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        // The address is configuration; the display name is the product's, so a
        // rename cannot leave a stale name sitting in everyone's inbox.
        from: fromHeader(),
        to: [to],
        subject,
        text,
        html,
        // Nothing receives mail at the sending subdomain, so replies would
        // vanish. Point them somewhere a person reads.
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    if (!r.ok) {
      // The body can echo the request, and the key travels in the same headers.
      const body = await r.json().catch(() => ({}));
      console.error('resend error', r.status, body && body.name);
      return false;
    }
    return true;
  } catch (err) {
    console.error('resend call failed', err.message);
    return false;
  }
}

// ---- Contact ---------------------------------------------------------------

const CONTACT_MAX_SUBJECT = 120;
const CONTACT_MAX_BODY = 4000;
const CONTACT_DAILY_LIMIT = Number(process.env.CONTACT_DAILY_LIMIT || 10);

// Where mail to the operator lands. Falls back to the owner's own account, so
// both the contact form and the nightly report work before any env var is set.
async function ownerEmail() {
  const owner = (await store.listUsers()).find((u) => u.role === 'owner');
  return owner ? owner.email : null;
}

async function contactDestination() {
  return process.env.CONTACT_TO || (await ownerEmail());
}

// Where operational mail goes — the refresh report and the sign-up notice.
async function operatorEmail() {
  return process.env.REPORT_TO || (await ownerEmail());
}

// Signed-in only, so every sender is a known account and there is no honeypot
// or captcha to build. The address is not typed by anyone — it comes off the
// session — which is what makes the Reply-To below safe.
app.post('/api/contact', requireMember, route(async (req, res) => {
  if (!MAIL_READY) return res.status(503).json({ error: 'Email is not configured on this server.' });

  // Newlines stripped, not escaped: a CR or LF in a header is how a subject
  // line becomes extra headers. The body is the only place free text belongs.
  const subject = String(req.body?.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, CONTACT_MAX_SUBJECT);
  const body = String(req.body?.message || '').trim().slice(0, CONTACT_MAX_BODY);
  if (!subject) return res.status(400).json({ error: 'Add a subject.' });
  if (body.length < 4) return res.status(400).json({ error: 'Add a message.' });

  const who = await currentUser(req);
  const from = who ? who.email : 'admin (legacy login)';

  // Same per-key-per-day counter the chat quota uses — the table is a generic
  // counter that happens to be named for its first caller. The prefix keeps the
  // two namespaces apart.
  const quota = await store.noteChatUse('contact:' + from, CONTACT_DAILY_LIMIT);
  if (!quota.allowed) {
    return res.status(429).json({ error: `That is ${quota.limit} messages today. Try again tomorrow.` });
  }

  const to = await contactDestination();
  if (!to) return res.status(503).json({ error: 'No destination address is configured.' });

  const ok = await sendMail({
    to,
    // Replying in a mail client answers the person, not the server.
    replyTo: who ? who.email : (process.env.MAIL_REPLY_TO || undefined),
    subject: `[${BRAND}] ${subject}`,
    text: textShell({
      heading: subject,
      intro: `From ${from}`,
      lines: [body],
      note: 'Sent from the contact form. Replying to this email answers the sender directly.',
    }),
    html: emailShell({
      heading: subject,
      intro: `From ${from}`,
      body: `<div style="white-space:pre-wrap;padding:16px 18px;border-radius:10px;` +
        `background:${MC.panel};border:1px solid ${MC.line}">${mailEsc(body)}</div>`,
      note: 'Sent from the contact form. Replying to this email answers the sender directly.',
    }),
  });
  if (!ok) return res.status(502).json({ error: 'Could not send that just now. Try again shortly.' });
  logAct(req, 'contact', 'sent');
  res.json({ ok: true });
}));

// ---- Password reset --------------------------------------------------------

// Always answers the same, whether or not the address has an account. The
// login endpoint already refuses to confirm which emails exist; this one would
// otherwise give it away.
app.post('/api/forgot', route(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const generic = { ok: true, message: 'If that address has an account, a reset link is on its way.' };
  if (!EMAIL_RE.test(email)) return res.json(generic);
  if (!MAIL_READY) {
    console.warn('forgot: mail is not configured (RESEND_API_KEY / MAIL_FROM / APP_URL)');
    return res.json(generic);
  }

  const user = await store.findUserByEmail(email);
  if (!user) return res.json(generic);

  const token = await store.createReset(user.id);
  if (!token) return res.json(generic);   // one was issued moments ago

  const link = `${APP_URL}/reset?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: email,
    replyTo: process.env.MAIL_REPLY_TO || undefined,
    subject: `Reset your ${BRAND} password`,
    text: textShell({
      heading: 'Reset your password',
      intro: `Someone asked to reset the password for this ${BRAND} account.`,
      lines: [link, '', 'The link works once and expires in 30 minutes.'],
      note: 'If this was not you, ignore this email — nothing has changed.',
    }),
    html: emailShell({
      heading: 'Reset your password',
      intro: `Someone asked to reset the password for this ${BRAND} account.`,
      body: mailButton(link, 'Choose a new password') +
        `<p style="margin:0;font-size:13.5px;color:${MC.mute}">The link works once and expires in ` +
        '30 minutes. If the button does not work, paste this into your browser:<br>' +
        `<span style="word-break:break-all;color:${MC.faint}">${mailEsc(link)}</span></p>`,
      note: 'If this was not you, ignore this email — nothing has changed and the link will expire on its own.',
    }),
  });
  res.json(generic);
}));

app.post('/api/reset', route(async (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
  }
  const userId = await store.consumeReset(token);
  if (!userId) {
    return res.status(400).json({ error: 'That link has expired or has already been used. Request a new one.' });
  }
  // setPassword also clears the lockout counter and drops every session for the
  // account — a reset usually means someone else may have had access.
  await store.setPassword(userId, password);
  logAct(req, 'account', 'reset', null); // token flow — no session to name
  res.json({ ok: true });
}));

// Owner-only: see who has an account, and revoke one.
app.get('/api/users', requireAdmin, route(async (req, res) => {
  // The review half of member portfolios: each account row on /users shows
  // what its owner has built. Rows under a key with no account (the legacy
  // 'admin' key) still surface, so nothing is invisible to review.
  const [users, allMine] = await Promise.all([store.listUsers(), store.listAllUserPortfolios()]);
  const byUser = {};
  for (const r of allMine) (byUser[r.user] ||= []).push({ name: r.name, symbols: r.symbols });
  const emails = new Set(users.map((u) => u.email));
  const orphaned = Object.keys(byUser).filter((k) => !emails.has(k))
    .map((k) => ({ user: k, portfolios: byUser[k] }));
  return res.json({
    users: users.map((u) => ({ ...u, portfolios: byUser[u.email] || [] })),
    otherPortfolios: orphaned,
  });
}));
// Approve a pending registration. Flips the status, then sends the welcome
// that registration held back — at approval it is finally true. Idempotent:
// approving an active account answers ok and sends nothing twice.
app.post('/api/users/:id/approve', requireAdmin, route(async (req, res) => {
  const r = await store.approveUser(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'No such account.' });
  if (r.wasPending) {
    logAct(req, 'account', 'approved:' + r.email);
    sendWelcome(r.email, 'member').catch(() => {});
  }
  res.json({ ok: true, approved: r.wasPending });
}));

app.delete('/api/users/:id', requireAdmin, route(async (req, res) => {
  const id = Number(req.params.id);
  const users = await store.listUsers();
  const target = users.find((u) => u.id === id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.role === 'owner' && users.filter((u) => u.role === 'owner').length === 1) {
    return res.status(409).json({ error: 'Cannot remove the only owner.' });
  }
  // Deleting the account you are signed in as would revoke your own session
  // mid-request and drop you at the login page. Sign in as another owner if it
  // really needs doing.
  const me = await currentUser(req);
  if (me && me.id === id) {
    return res.status(409).json({ error: 'You cannot delete the account you are signed in as.' });
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
// ---- short names ----------------------------------------------------------
// The feed has one name field and it is the legal one: "Space Exploration
// Technologies Corp. Class A", "SK hynix Inc. American Depositary Receipt".
// These rules strip the furniture — instrument and share-class suffixes
// first, then the incorporation word, then a trailing Holding(s) — leaving
// what a person would actually say. Applied in a loop because the tails
// stack, and every step keeps the previous value if it would empty the name.
//
// ETF is deliberately NOT stripped: for a fund the instrument IS the product,
// so "VanEck Semiconductor ETF" is already its short name. "American
// Depositary Shares" and "Sponsored ADR" are matched whole (2026-09-15) — the
// old rule took "Depositary Shares" and left "AstraZeneca PLC American".
const SHORT_TAILS = [
  /\s*\b(?:Class|Series)\s+[A-Z]\b\s*$/,
  /\s*\b(?:Common\s+Stock|Ordinary\s+Shares?|(?:Sponsored\s+)?American\s+Depositary\s+(?:Shares?|Receipts?)|Depositary\s+(?:Shares?|Receipts?)|(?:Sponsored\s+|SP\s+)?ADRs?|ADS|Sponsored)\b\s*$/i,
  /\s*,?\s*\b(?:Incorporated|Inc|Corporation|Corp|Company|Co|Limited|Ltd|LLC|LP|PLC|N\.?V|S\.?A|AG|SE)\b\.?\s*$/i,
];
function deriveShortName(full) {
  let n = String(full || '').trim();
  if (!n) return null;
  const tidy = (x) => x.replace(/[\s,.&\-]+$/, '').trim();
  for (let pass = 0; pass < 6; pass++) {
    const before = n;
    for (const re of SHORT_TAILS) {
      const cut = tidy(n.replace(re, ''));
      if (cut.length >= 2) n = cut;
    }
    if (n === before) break;
  }
  // "Alibaba Group Holding" -> "Alibaba Group", but never down to nothing
  const noHold = tidy(n.replace(/\s*\bHoldings?\b\s*$/i, ''));
  if (noHold.length >= 2) n = noHold;
  const noThe = n.replace(/^The\s+/i, '').trim();
  if (noThe.length >= 2) n = noThe;
  return n || String(full || '').trim() || null;
}

// Stamps the display name onto rows being served from the snapshot. One
// query covers both columns, and the rule fills in wherever no override was
// typed — so improving the rule improves every untouched name at once.
async function stampShortNames(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  try {
    const nm = await store.readNamesFull();
    for (const r of rows) {
      if (!r || !r.symbol) continue;
      const e = nm[r.symbol];
      if (!r.name && e && e.name) r.name = e.name;
      r.shortName = (e && e.short) || deriveShortName(r.name || (e && e.name)) || null;
    }
  } catch { /* a display name must never fail a page */ }
}

// Every field a profile pull writes, null until the pull fills it. Kept as a
// function so each pull gets a fresh object, and so PROFILE_FIELDS below can
// say what a COMPLETE stored profile looks like.
function emptyProfile() {
  return {
    sector: null,
    industry: null,
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
}

// A stored profile missing one of these keys was pulled before that field
// existed (Industry, 2026-09-14, was the first case). Absent is not the same
// as null: a fund pulled since then carries `industry: null` because the
// provider has none, and re-pulling it would only buy the same null again.
const PROFILE_FIELDS = Object.keys(emptyProfile());

async function fetchProfile(symbol) {
  const enc = encodeURIComponent(symbol);
  const out = emptyProfile();
  // Whether every call that should have returned data actually did. A rate
  // limit or an outage leaves this false, and the caller then keeps what it
  // already had rather than replacing it with the nulls below.
  //
  // The distinction is exact, not a guess: Twelve Data answers a refused call
  // with { status: 'error' }, while an instrument that genuinely has no
  // fundamentals — an ETF — answers with a real statistics object whose market
  // capitalization is 0. Only the first is a failure.
  out.fetchOk = true;

  try {
    const p = await fetchJson(`${TD_BASE}/profile?symbol=${enc}&apikey=${API_KEY}`);
    if (p && p.status === 'error') {
      out.fetchOk = false;
    } else if (p) {
      if (p.sector) out.sector = p.sector;
      // The finer cut, in the same response and previously discarded: Twelve
      // Data returns a Morningstar-style industry ("Banks - Diversified",
      // "Semiconductors") beside the sector. Not GICS — that taxonomy is
      // licensed and this API does not carry it — but it costs no credits,
      // since the call is charged whether one field is read or six.
      if (p.industry) out.industry = p.industry;
      // Everything below was already in this response and being discarded. The
      // call costs the same whether one field is read or five, so these are
      // free — but they are kept out of the snapshot and out of the assistant's
      // prompt, and served only to the stock page. Eighty-odd descriptions is
      // ~70 KB on every screener load and ~20k tokens of prose that answers
      // none of the numeric questions anyone asks the bot.
      if (p.description) out.description = String(p.description).slice(0, 4000);
      const emp = Number(p.employees);
      if (isFinite(emp) && emp > 0) out.employees = Math.round(emp);
      if (p.website) out.website = String(p.website).slice(0, 300);
    }
  } catch {
    out.fetchOk = false;
  }
  if (FUNDAMENTALS_ENABLED) {
    try {
      const st = await fetchJson(`${TD_BASE}/statistics?symbol=${enc}&apikey=${API_KEY}`);
      if (st && st.status === 'error') out.fetchOk = false;
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
      out.fetchOk = false;
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
  const m = creditMeter.getStore();
  if (m) { if (out.fetchOk) m.profiles++; else m.profileFails++; }
  return out;
}

// Ensure sector/fundamentals are cached and fresh for the given symbols.
async function ensureProfiles(symbols, cap) {
  const profiles = await readProfiles();
  const now = Date.now();
  const stale = symbols.filter((s) => {
    const p = profiles[s];
    if (!p || !p.fetchedAt) return true; // never fetched
    return now - p.fetchedAt > PROFILE_TTL_MS; // otherwise refresh once a day
  });
  const batch = stale.slice(0, cap || MAX_PROFILE_FETCHES_PER_CALL);
  if (batch.length && API_KEY) {
    const results = await Promise.all(
      batch.map((s) => fetchProfile(s).then((r) => ({ s, r })))
    );
    for (const { s, r } of results) {
      const { fetchOk, ...vals } = r;
      if (fetchOk) {
        profiles[s] = { ...vals, fetchedAt: now };
        continue;
      }
      // The pull was refused, so `vals` is mostly nulls. Overwriting with it
      // erased good data and — because the row then looked fresh — kept it
      // erased for a day: a burst of rate limits could blank the fundamentals
      // for half the universe until the next Refresh all. Keep the previous
      // values, take whatever did come back, and leave the timestamp stale so
      // the next round tries again.
      const prev = profiles[s] || {};
      const merged = { ...prev };
      for (const [k, v] of Object.entries(vals)) if (v != null) merged[k] = v;
      merged.fetchedAt = prev.fetchedAt || 0;
      profiles[s] = merged;
      console.warn(`profile: ${s} pull was refused — keeping the cached values, will retry`);
    }
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

// Credits are measured, not estimated: Twelve Data states each call's cost in
// Api-Credits-Request. A refresh round runs inside creditMeter.run(), and every
// call it makes — prices, SPY, each profile's four endpoints — adds its cost to
// that round's tally. Outside a metered round the store is undefined and this
// does nothing.
const creditMeter = new AsyncLocalStorage();
async function metered(fn) {
  const m = { credits: 0, profiles: 0, profileFails: 0 };
  const t0 = Date.now();
  const r = await creditMeter.run(m, fn);
  return { r, m, ms: Date.now() - t0 };
}

async function fetchJson(url) {
  const res = await fetch(url);
  const m = creditMeter.getStore();
  if (m) {
    const c = Number(res.headers.get('api-credits-request'));
    if (Number.isFinite(c)) m.credits += c;
  }
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
// Today's volume against its own prior 20 sessions — the breakout marker's
// denominator, matching the 2026-09-14 volume study exactly (>=1.5x is the
// confirmed kind whose sign survived the 2020 split; the 200D upcross got
// nothing from volume, which is why the marker rides fresh highs only).
function volumeX(values) {
  if (!values || values.length < 22) return null;
  const v0 = Number(values[0]?.volume);
  if (!isFinite(v0) || v0 <= 0) return null;
  let sum = 0, n = 0;
  for (let i = 1; i <= 20; i++) {
    const v = Number(values[i]?.volume);
    if (isFinite(v) && v > 0) { sum += v; n++; }
  }
  if (n < 15) return null;
  return Math.round((v0 / (sum / n)) * 100) / 100;
}

// The first close above the prior 60 sessions' high — the study's E60 event,
// on today's bar. False the day after: a stock riding its highs re-arms only
// after slipping back under them, which is what keeps the marker an event.
function fresh3mHigh(values) {
  if (!values || values.length < 62) return null;
  const c0 = Number(values[0]?.close), c1 = Number(values[1]?.close);
  if (!isFinite(c0) || !isFinite(c1)) return null;
  let hi = -Infinity;
  for (let i = 1; i <= 60; i++) {
    const c = Number(values[i]?.close);
    if (isFinite(c) && c > hi) hi = c;
  }
  return c0 > hi && c1 <= hi;
}

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
      key: c.key || null,
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
// ---- absolute factor curves -------------------------------------------------
// A logistic curve rather than a clamped line. lin() pinned a third to a half of
// the universe at exactly 0 or 1 on every major factor, and a factor that is
// constant across half the list cannot order anything — which is what sent this
// model to percentiles in the first place. tanh is asymptotic: it approaches the
// ends without reaching them, so ordering survives at the extremes. Measured
// over the archive, only 0-3.5% of sub-scores land within 0.005 of either end.
//
// Centres are the medians measured across the bar archive at six dates spanning
// 2011 to 2026, and the scales are roughly the interquartile spread. The
// risk-adjusted returns are dimensionless — a return divided by its own
// volatility — which is why an absolute scale is well defined for them at all.
//
// These are constants on purpose. Deriving them from the current universe would
// be percentiles again by another name, and the whole point is a scale that does
// not move: a momentum of 70 has to mean in 2026 what it meant in 2011.
function curve(v, centre, scale) {
  if (v == null || !isFinite(v)) return null;
  return 0.5 + 0.5 * Math.tanh((v - centre) / scale);
}

// Scores every row. Momentum no longer needs the universe — each factor is
// measured against a fixed scale — so this is a plain loop rather than the
// two-pass ranking it used to be. It is kept as a function because both the live
// pull and the fortnight-ago reconstruction go through it.
// Stamp Company Type / Action / Flag / the four state columns onto rows.
// ONE fixed rule set — the Balanced defaults in code — at the owner's
// instruction; the profile machinery (house row, personal presets, the Rules
// picker) was built, then removed 2026-09-11. The engine still takes a config,
// so bringing configurability back is wiring, not a rewrite.
const ACTION_CFG = (() => { const { cfg } = Action.resolve(null, 'Balanced'); cfg.__resolved = true; return cfg; })();
function scoreActionInto(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const results = Action.apply(rows, ACTION_CFG);
  for (let i = 0; i < rows.length; i++) {
    const r = results[i];
    if (!r) continue;
    rows[i].companyType = r.type;
    rows[i].action = r.action;
    rows[i].actionFlag = r.flag;
    rows[i].actionTrend = r.states.trend;
    rows[i].actionEntry = r.states.entry;
    rows[i].actionFund = r.states.fund;
    rows[i].actionGuards = r.states.guards;
    // Risk to exit under Balanced — how far the price can fall before these
    // same rules flip to Avoid or worse. Engine-computed (exitDistance), so
    // the hover card and the ladder panel cannot drift apart on it.
    rows[i].actionRisk = Action.exitDistance({
      v200: rows[i].vs200ma, v50: rows[i].vs50ma, rsi: rows[i].rsi,
      m1: rows[i].oneMonthPct, m3: rows[i].threeMonthPct, fh: rows[i].pctFromHigh,
      vol: rows[i].volTrend, hist: rows[i].historyDays,
    }, ACTION_CFG);
  }
  // Yesterday's verdict: yesterday's technicals over today's cached
  // fundamentals, through the same engine. The table's change marker and the
  // refresh reports both read the difference.
  const prevRows = rows.map((r) => (r && !r.error && r.prevTech ? Object.assign({}, r, r.prevTech) : null));
  const prevResults = Action.apply(prevRows, ACTION_CFG);
  for (let i = 0; i < rows.length; i++) {
    rows[i].advicePrev = prevResults[i] && results[i] ? prevResults[i].action : null;
  }
}

function applyScores(rows) {
  rows.forEach((row) => {
    const sc = computeScores(row);
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

// Momentum is measured against a fixed scale, not against the rest of the list.
// A score therefore means the same thing in a weak quarter as in a strong one,
// does not shift when a ticker is added or removed, and can be compared with the
// same stock's score a year ago — none of which was true while it was ranked
// cross-sectionally. The list's own ordering is still available by sorting.
//
// Measured before the change: the ranked model's median score sat at 54 in every
// period sampled between 2011 and 2026, because percentiles average 0.5 by
// construction — it could not express a weak market at all. The absolute model
// ranged from 40 in the post-crisis chop of 2011 to 62 in the 2021 run, while
// moving today's ordering by a median of two places and no rating by more than
// one point.
//
// What changed, and why (each was measured against the live universe before
// being replaced):
//   - `RS vs S&P` was `3M return` minus a constant that is identical for every
//     stock, so it correlated 1.000 with 3M and could not reorder anything. It
//     spent a quarter of the weight restating one horizon.
//   - `MACD` was binary 0.8/0.2 and correlated 0.022 with the composite;
//     `Vol trend` was unsigned, so a crash on heavy volume scored as well as a
//     breakout, and 51% of the universe sat at its floor. Both are dropped.
//   - `Short squeeze` correlated -0.223 with the composite and rewarded heavy
//     short interest, which predicts weaker returns, not stronger. Dropped: it
//     is not a momentum factor.
//   - The short horizons enter as `1M reversal`, inverted. At one month the
//     evidence is reversal, not continuation — the same reason the 12-1 factor
//     skips its final month.
function computeScores(m) {
  // `key` is the stable name a client re-weights against. The label is prose and
  // may be reworded; the key is the contract, so a preset in screens.js cannot
  // quietly stop matching because a caption was improved.
  // Each centre is a measured median, each scale roughly the interquartile
  // spread. Trend regime and RSI timing were always absolute and are unchanged.
  const oneMonth = m.oneMonthPct;
  const momComps = [
    { key: 'mom121', label: '12-1 momentum', weight: 20,
      sub: curve(riskAdj(m.mom12_1, m.realisedVol), 0.70, 1.30) },
    { key: 'ret6m', label: '6M return (risk-adj.)', weight: 18,
      sub: curve(riskAdj(m.sixMonthPct, m.realisedVol), 0.55, 0.90) },
    { key: 'ret3m', label: '3M return (risk-adj.)', weight: 17,
      sub: curve(riskAdj(m.threeMonthPct, m.realisedVol), 0.25, 0.45) },
    { key: 'fromHigh', label: '% from 52W high', weight: 10,
      sub: curve(m.pctFromHigh, -12, 14) },
    { key: 'trend', label: 'Trend regime', weight: 10, sub: trendRegimeSub(m) },
    { key: 'consistency', label: 'Consistency', weight: 10,
      sub: curve(m.posMonths, 58, 15) },
    // Inverted: at a one-month horizon the strongest recent movers are the
    // likeliest to give some back, so leading this factor is a caution.
    { key: 'revers1m', label: '1M reversal', weight: 8,
      sub: oneMonth == null ? null : 1 - curve(oneMonth, 1.0, 10) },
    { key: 'rsi', label: 'RSI timing', weight: 7, sub: rsiScore(m.rsi) },
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

// ---- member portfolios ------------------------------------------------
// A member's own lists: named filters over the shared snapshot. The one
// invariant, enforced HERE and nowhere softer: a member can only reference
// stocks the system already has — every incoming symbol is checked against
// the live universe and anything else is silently dropped, so this can
// never become a way to add a ticker. Keyed like prefs (email, else
// 'admin'); guests are blocked by requireMember and have no key to write.
const MY_PORTFOLIOS_MAX = 10;
const MY_NAME_MAX = 40;

function cleanMyPortfolios(raw, universe) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [rawName, rawSyms] of Object.entries(raw)) {
    if (Object.keys(out).length >= MY_PORTFOLIOS_MAX) break;
    const name = String(rawName).trim().slice(0, MY_NAME_MAX);
    if (!name || out[name]) continue;
    const seen = new Set();
    const syms = [];
    for (const x of Array.isArray(rawSyms) ? rawSyms : []) {
      const sym = String(x).trim().toUpperCase();
      if (sym && universe.has(sym) && !seen.has(sym)) { seen.add(sym); syms.push(sym); }
    }
    out[name] = syms;
  }
  return out;
}

app.get('/api/my/portfolios', requireMember, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const mine = await store.readUserPortfolios(await prefsKey(req));
  // Filtered to the live universe on the way out too — a symbol dropped
  // since the last write must never render as a phantom row count.
  const universe = new Set(getUniverse(await readPortfolios()));
  for (const name of Object.keys(mine)) mine[name] = mine[name].filter((x) => universe.has(x));
  res.json({ portfolios: mine, max: MY_PORTFOLIOS_MAX });
}));

app.put('/api/my/portfolios', requireMember, route(async (req, res) => {
  const key = await prefsKey(req);
  const universe = new Set(getUniverse(await readPortfolios()));
  const next = cleanMyPortfolios(req.body && req.body.portfolios, universe);
  const prev = await store.readUserPortfolios(key);
  await store.writeUserPortfolios(key, next);

  // The activity log gets the DIFF, not the blob — one compact row per
  // portfolio that changed, capped so a bulk edit cannot flood the table.
  const rows = [];
  const ts = new Date().toISOString();
  const push = (detail) => { if (rows.length < 10) rows.push({ ts, user: key, kind: 'myportfolio', detail, ip: req.ip || null }); };
  for (const name of Object.keys(next)) {
    if (!(name in prev)) { push(('create:' + name + ' +' + next[name].length).slice(0, 80)); continue; }
    const was = new Set(prev[name]);
    const now = new Set(next[name]);
    const added = next[name].filter((x) => !was.has(x));
    const removed = prev[name].filter((x) => !now.has(x));
    if (added.length || removed.length) {
      push((name + (added.length ? ' +' + added.join(',') : '') + (removed.length ? ' -' + removed.join(',') : '')).slice(0, 80));
    }
  }
  for (const name of Object.keys(prev)) if (!(name in next)) push(('delete:' + name).slice(0, 80));
  if (rows.length) store.logActivity(rows).catch(() => { /* fire and forget */ });

  res.json({ ok: true, portfolios: next, max: MY_PORTFOLIOS_MAX });
}));

// ---- the NASDAQ reference list --------------------------------------------
// A free, keyless listing of every US-listed company with a market cap beside
// it — the one thing Twelve Data will not sell on this plan at a sane price
// (/market_cap is Ultra-only; /statistics is 50 credits a symbol, so sweeping
// NYSE + NASDAQ would be ~287,000 credits and eight hours).
//
// It is REFERENCE DATA, kept in its own table, on its own page, and joined to
// nothing. NASDAQ's sector and industry are a third taxonomy that agrees with
// neither GICS nor the Twelve Data values the screener shows, and its market
// cap is a snapshot from a different vendor on a different clock. Used as a
// place to go looking for a ticker, it costs nothing and answers well; mixed
// into the screener it would put two vendors' judgements in one column.
const NASDAQ_EXCHANGES = ['NASDAQ', 'NYSE', 'AMEX'];
// The endpoint wants a browser-shaped User-Agent, and the failure mode is the
// nasty one: given a bot-shaped agent it does not answer 403, it simply never
// replies. Measured — an honest "TickrLab/1.0" agent hung until a 20s abort,
// the agent below answered 200 in 296ms. So a timeout is not belt-and-braces
// here, it is the difference between an error and a serverless function
// sitting on its hands until the platform kills it.
const NASDAQ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const NASDAQ_TIMEOUT_MS = 20000;

// "$4.95" / "-4.808%" / "5,100,765,000,000" / "" all arrive as strings.
function nasdaqNum(v) {
  if (v == null) return null;
  const t = String(v).replace(/[$,%\s]/g, '').replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const nasdaqText = (v) => {
  const t = String(v == null ? '' : v).trim();
  return t ? t.slice(0, 120) : null;
};

async function fetchNasdaqExchange(exchange) {
  const url = 'https://api.nasdaq.com/api/screener/stocks' +
    `?tableonly=true&limit=25000&download=true&exchange=${encodeURIComponent(exchange)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), NASDAQ_TIMEOUT_MS);
  let body;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': NASDAQ_UA,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`NASDAQ returned ${res.status}`);
    body = await res.json();
  } finally {
    clearTimeout(timer);
  }
  const rows = (body && body.data && body.data.rows) || [];
  if (!rows.length) throw new Error('NASDAQ returned no rows');
  return rows.map((r) => ({
    symbol: String(r.symbol || '').trim().toUpperCase().slice(0, 20),
    // The API does not say which exchange a row came from, so the request does.
    exchange,
    name: nasdaqText(r.name),
    last_sale: nasdaqNum(r.lastsale),
    net_change: nasdaqNum(r.netchange),
    pct_change: nasdaqNum(r.pctchange),
    market_cap: nasdaqNum(r.marketCap),
    country: nasdaqText(r.country),
    ipo_year: nasdaqNum(r.ipoyear),
    volume: nasdaqNum(r.volume),
    sector: nasdaqText(r.sector),
    industry: nasdaqText(r.industry),
    // stored as the path it arrives as; the page makes the link
    url: nasdaqText(r.url),
  })).filter((r) => r.symbol);
}

// The whole list, for a page that filters in the browser. ~7,100 rows and
// about 1.2 MB — heavy for a table row, trivial for one admin page load, and
// it makes every filter on it instant.
app.get('/api/nasdaq', requireAdmin, route(async (req, res) => {
  const [rows, meta] = await Promise.all([store.readNasdaqListings(), store.nasdaqMeta()]);
  res.json({ rows, meta, exchanges: NASDAQ_EXCHANGES });
}));

// ONE exchange per request. The largest is 4,130 rows, and a serverless
// function is not awake long enough to pull and store all three — the same
// reason Refresh all is a loop of rounds driven by the browser.
app.post('/api/nasdaq/refresh', requireAdmin, route(async (req, res) => {
  const exchange = String(req.body?.exchange || '').toUpperCase();
  if (!NASDAQ_EXCHANGES.includes(exchange)) {
    return res.status(400).json({ error: 'Unknown exchange.' });
  }
  const t0 = Date.now();
  // Three requests, one run: the first starts it, the page passes its id on.
  const idx = NASDAQ_EXCHANGES.indexOf(exchange);
  let runId = Number(req.body?.runId) || null;
  if (!runId) {
    const who = await currentUser(req);
    runId = await trackSafe(store.startRun({ kind: 'nasdaq', trigger: 'manual', actor: who ? who.email : null,
      total: NASDAQ_EXCHANGES.length, targets: NASDAQ_EXCHANGES.length }));
  }
  let rows;
  try {
    rows = await fetchNasdaqExchange(exchange);
  } catch (err) {
    // Never echo an upstream body: it can restate the request.
    console.error('nasdaq fetch failed:', exchange, err.message);
    const msg = `Could not reach NASDAQ for ${exchange}.`;
    await trackSafe(store.noteRound(runId, { ms: Date.now() - t0, priceSource: exchange, loaded: idx,
      total: NASDAQ_EXCHANGES.length, error: msg }));
    await trackSafe(store.finishRun(runId, { status: 'failed', error: msg }));
    return res.status(502).json({ error: msg, runId });
  }
  const n = await store.writeNasdaqExchange(exchange, rows);
  logAct(req, 'refresh', 'nasdaq:' + exchange);
  await trackSafe(store.noteRound(runId, { ms: Date.now() - t0,
    priceSource: `${exchange} \u00b7 ${n.toLocaleString()} rows`, loaded: idx + 1, total: NASDAQ_EXCHANGES.length }));
  if (req.body?.last === true || idx === NASDAQ_EXCHANGES.length - 1) {
    await trackSafe(store.finishRun(runId, { status: 'complete', loaded: idx + 1, total: NASDAQ_EXCHANGES.length }));
  }
  res.json({ exchange, rows: n, ms: Date.now() - t0, runId, meta: await store.nasdaqMeta() });
}));

// Maintain one display name. An empty value clears the override and hands
// the symbol back to the rule, which is the only way to undo a bad edit.
app.put('/api/shortname', requireAdmin, route(async (req, res) => {
  const symbol = String(req.body?.symbol || '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Bad symbol.' });
  const raw = String(req.body?.name || '').trim().slice(0, 40);
  await store.writeShortName(symbol, raw || null);
  logAct(req, 'portfolio', 'shortname:' + symbol);
  const names = await readNames();
  res.json({ ok: true, symbol, shortName: raw || deriveShortName(names[symbol]) || null, custom: !!raw });
}));

app.get('/api/portfolios', requireMember, route(async (req, res) => {
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
  logAct(req, 'portfolio', 'create:' + name.slice(0, 40));
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
  logAct(req, 'portfolio', 'rename:' + oldName.slice(0, 30) + '>' + newName.slice(0, 30));
  res.json({ portfolios: rebuilt });
}));

// Delete a portfolio (its stocks remain in any other portfolios).
// A symbol dropped from the last portfolio holding it takes its data with it:
// bars, momentum history, fundamentals history, the cached profile and the
// name. Anything still in another portfolio is untouched, which is why this
// compares the universe before and after rather than trusting the route.
//
// Bars and momentum come back by themselves — a re-pull is one credit and
// momentum is computed from bars — but fundamentals history cannot be
// rebuilt at all, so re-adding a ticker starts that series over. The counts are
// logged for exactly that reason: this is not a reversible operation.
async function purgeDropped(before) {
  const after = new Set(getUniverse(await readPortfolios()));
  const gone = before.filter((s) => !after.has(s));
  const purged = [];
  for (const symbol of gone) {
    try {
      const r = await store.purgeSymbol(symbol);
      purged.push(r);
      console.log(`purged ${r.symbol}: ${r.total.toLocaleString()} rows — ` +
        (Object.entries(r.removed).map(([t, n]) => `${t} ${n.toLocaleString()}`).join(', ') || 'nothing stored'));
    } catch (err) {
      // Losing the portfolio edit because the cleanup failed would be worse
      // than leaving rows behind; purge-orphans.js sweeps them up later.
      console.warn(`purge ${symbol} failed (the ticker was still removed):`, err.message);
    }
  }
  return purged;
}

app.delete('/api/portfolios/:name', requireAdmin, route(async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const p = await readPortfolios();
  if (!(name in p)) return res.status(404).json({ error: 'Portfolio not found.' });
  const before = getUniverse(p);
  delete p[name];
  await writePortfolios(p);
  logAct(req, 'portfolio', 'delete:' + name.slice(0, 40));
  res.json({ portfolios: p, purged: await purgeDropped(before) });
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
  // It is returned as well: adding a ticker no longer triggers a price pull, so
  // this lookup is the only thing that touches the symbol before the next
  // Refresh, and a name coming back empty is the earliest hint of a typo.
  let name_ = (await readNames())[symbol] || null;
  if (API_KEY && !name_) {
    name_ = await fetchName(symbol);
    if (name_) await writeNames({ [symbol]: name_ });
  }

  logAct(req, 'portfolio', 'add:' + symbol + '>' + name.slice(0, 40));
  res.json({ portfolios: p, name: name_ });
}));

// Remove a ticker from one portfolio.
app.delete('/api/portfolios/:name/tickers/:symbol', requireAdmin, route(async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  const p = await readPortfolios();
  if (!(name in p)) return res.status(404).json({ error: 'Portfolio not found.' });
  const before = getUniverse(p);
  p[name] = p[name].filter((s) => s !== symbol);
  await writePortfolios(p);
  logAct(req, 'portfolio', 'remove:' + symbol + '<' + name.slice(0, 40));
  res.json({ portfolios: p, purged: await purgeDropped(before) });
}));

// Remove a ticker from every portfolio (used by the "All" view).
app.delete('/api/tickers/:symbol', requireAdmin, route(async (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  const p = await readPortfolios();
  const before = getUniverse(p);
  for (const name of Object.keys(p)) p[name] = p[name].filter((s) => s !== symbol);
  await writePortfolios(p);
  logAct(req, 'portfolio', 'remove:' + symbol);
  res.json({ portfolios: p, purged: await purgeDropped(before) });
}));

// Expire the per-symbol profile cache (sector / fundamentals / analyst) so the
// next refresh re-pulls it. Company names are static, so they're kept.
//
// Expire rather than delete: the backfill only manages a few symbols per call,
// so deleting the rows stripped sector, market cap and fundamentals out of the
// shared snapshot for the ten-odd minutes it ran, and every other viewer saw
// the holes. The old values stay visible and are replaced one by one.
// ---- Fill missing ----------------------------------------------------------
// Which stocks lack company data, and why. Three reasons, checked in order:
// no stored profile at all (a new ticker), a stored profile missing a field
// the app now writes (pulled before that field existed), or a pull that was
// refused or never finished (fetched_at 0 — the retry marker). A profile that
// is merely OLD is not missing: that is the rotation's job, and Refresh all's.
function profileGaps(universe, profiles) {
  const out = [];
  for (const symbol of universe) {
    const p = profiles[symbol];
    if (!p) { out.push({ symbol, reason: 'none', hasRow: false }); continue; }
    const absent = PROFILE_FIELDS.filter((k) => !(k in p));
    if (absent.length) { out.push({ symbol, reason: 'fields', fields: absent, hasRow: true }); continue; }
    if (!p.fetchedAt) out.push({ symbol, reason: 'failed', hasRow: true });
  }
  return out;
}

// What a Fill missing run would do right now, costed. Rounds follow the
// Refresh all pacing: 7 profiles a minute on archive rounds, and a first round
// that also prices any stock with no bars at all (a new ticker) at 1 credit
// each, sizing its profile batch down to fit the same minute.
async function missingPlan() {
  const universe = getUniverse(await readPortfolios());
  const gaps = profileGaps(universe, await readProfiles());
  const dates = await store.barsMaxDates();
  const noBars = universe.filter((s) => !dates.has(s));
  let left = gaps.length;
  let rounds = 0;
  if (noBars.length) {
    const firstCap = Math.max(0, Math.min(PROFILE_CAP_ARCHIVE_ROUND,
      Math.floor((CREDITS_PER_MINUTE - noBars.length - 1) / CREDITS_PER_PROFILE)));
    left = Math.max(0, left - firstCap);
    rounds = 1;
  }
  rounds += Math.ceil(left / PROFILE_CAP_ARCHIVE_ROUND);
  const fields = {};
  gaps.forEach((g) => (g.fields || []).forEach((f) => { fields[f] = (fields[f] || 0) + 1; }));
  return {
    total: universe.length,
    gaps,
    noBars,
    counts: {
      none: gaps.filter((g) => g.reason === 'none').length,
      fields: gaps.filter((g) => g.reason === 'fields').length,
      failed: gaps.filter((g) => g.reason === 'failed').length,
    },
    fields,
    rounds,
    // rounds run 62s apart; the last one does not wait
    minutes: rounds ? Math.max(1, Math.round(((rounds - 1) * 62 + 20) / 60)) : 0,
    credits: gaps.length * CREDITS_PER_PROFILE + noBars.length + rounds,
  };
}

// The preview the console shows before a run: nothing is expired or started.
app.get('/api/refresh-missing', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const p = await missingPlan();
  res.json({ ...p, gaps: p.gaps.map(({ hasRow, ...g }) => g) });
}));

app.post('/api/refresh-all', requireAdmin, route(async (req, res) => {
  const who = await currentUser(req);
  // Fill missing: the same loop, pointed at the gaps only.
  if (req.query.mode === 'missing' || req.body?.mode === 'missing') {
    const plan = await missingPlan();
    if (!plan.gaps.length && !plan.noBars.length) {
      return res.json({ ok: true, nothing: true, total: plan.total, targets: 0 });
    }
    logAct(req, 'refresh', 'missing:' + plan.gaps.length);
    const expired = await store.expireProfilesFor(plan.gaps.filter((g) => g.hasRow).map((g) => g.symbol));
    const runId = await trackSafe(store.startRun({ kind: 'missing', trigger: 'manual',
      actor: who ? who.email : null, total: plan.total, targets: plan.gaps.length }));
    await beginRefresh(who ? who.email : null, plan.total, 'missing', runId);
    // No stock without bars means no price pull at all: every round reads the
    // archive and spends its whole minute on the gaps.
    if (!plan.noBars.length) await store.markRefreshPrices();
    return res.json({ ok: true, mode: 'missing', runId, expired, total: plan.total,
      targets: plan.gaps.length, noBars: plan.noBars.length, rounds: plan.rounds });
  }
  logAct(req, 'refresh', 'all');
  const expired = await expireProfiles();
  const total = getUniverse(await readPortfolios()).length;
  const runId = await trackSafe(store.startRun({ kind: 'all', trigger: 'manual',
    actor: who ? who.email : null, total, targets: total }));
  await beginRefresh(who ? who.email : null, total, null, runId);
  res.json({ ok: true, runId, expired, total });
}));

// The client calls this when its backfill loop finishes or gives up, so the
// notice clears promptly. readRefreshState() ages the flag out on its own if
// this never arrives — an admin can always just close the tab.
app.delete('/api/refresh-all', requireAdmin, route(async (req, res) => {
  // Report from here too, the way the cron job's equivalent does. This is the
  // give-up path — the loop ran out of rounds, or the tab was closed — and a run
  // that stopped at 78 of 84 needs to say so. Silence is indistinguishable from
  // success, which is exactly how the incomplete run went unnoticed.
  //
  // endRefresh() returns the run only to whoever actually cleared the flag, so a
  // run that already finished naturally and reported cannot report twice.
  const cleared = await endRefresh();
  if (cleared) await closeRun(cleared, 'incomplete');
  const reported = await sendRefreshReport(cleared, 'all');
  res.json({ ok: true, reported });
}));

// Cheap poll for viewers: is a refresh running? Deliberately not the whole
// snapshot, since every open page hits this while one is in progress.
app.get('/api/status', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ refreshing: await readRefreshState() });
}));

// ---- API: stocks (the screener data) ---------------------------------------

// Compute the full screener payload live from the API. As-of mode (asOf set)
// recomputes momentum as it looked on that date (plus forward returns); fundamentals
// are skipped — they aren't point-in-time. Returns {ok, payload} or {ok:false, status, error}.
async function computeStocks(asOf, opts = {}) {
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
  const names = await readNames();
  const shortOverrides = await store.readShortNames();
  const profiles = asOf ? {} : await ensureProfiles(symbols, opts.profileCap); // no point-in-time fundamentals

  try {
    let series;
    // Which symbols this round actually priced live — null means all of them.
    // The archive write needs to know: re-persisting bars that came OUT of the
    // archive is a no-op upsert of the overlap window for every unpriced
    // symbol, every round.
    let pricedLive = null;
    if (opts.archivePrices && !asOf) {
      // A Refresh All round after the first: prices come from the archive the
      // first round just wrote — zero credits — leaving the whole minute for
      // profiles. SPY alone is fetched live (1 credit): the benchmark is
      // deliberately not archived, since it belongs to no portfolio and the
      // orphan sweep would collect it.
      const since = new Date(Date.now() - 470 * 86400000).toISOString().slice(0, 10);
      const bars = await store.readBarsFullFor(symbols, since);
      series = {};
      for (const sym of symbols) series[sym] = { values: bars[sym] || [] };
      const spyRaw = await fetchJson(
        `${TD_BASE}/time_series?symbol=${BENCHMARK}&interval=1day&outputsize=300&apikey=${API_KEY}`
      );
      if (spyRaw && spyRaw.status === 'error') {
        const code = spyRaw.code === 429 ? 429 : 502;
        return { ok: false, status: code, error: `Twelve Data: ${spyRaw.message}` };
      }
      series[BENCHMARK] = spyRaw;
      console.log(`prices: archive (${symbols.length} symbols), SPY live`);
    } else {
      // Live prices, CHUNKED: the API rejects a batch over 120 symbols, so
      // past that the pull is several calls in the same minute — 1 credit per
      // symbol regardless of chunking (measured), so the cost is symbols, not
      // calls. Live: last ~300 bars. As-of: from ~430 days before asOf through
      // today, so there is a year of history before the date AND the bars
      // after it (forward returns).
      series = {};
      // Only this round's slice is pulled live; everything else in the universe
      // comes off the archive below, so a universe too big to price inside one
      // minute is paced across rounds rather than having its round refused.
      const liveSet = opts.priceSlice ? new Set(opts.priceSlice) : null;
      pricedLive = opts.priceSlice ? opts.priceSlice.slice() : null;
      const toFetch = liveSet
        ? fetchSymbols.filter((x) => x === BENCHMARK || liveSet.has(x))
        : fetchSymbols;
      const CHUNK = 120;
      for (let i = 0; i < toFetch.length; i += CHUNK) {
        const chunk = toFetch.slice(i, i + CHUNK);
        let rangeParam = '&outputsize=300';
        if (asOf) {
          const start = new Date(asOf);
          start.setDate(start.getDate() - 430); // ~1 year of history before the as-of date
          const daysBack = Math.round((Date.now() - start.getTime()) / 86400000);
          const needed = Math.ceil(daysBack * 0.72) + 60; // approx trading days in range + buffer
          // Twelve Data batch limit: symbols × outputsize ≤ 100000.
          const maxPerSymbol = Math.floor(90000 / chunk.length);
          const outSize = Math.min(Math.max(needed, 300), maxPerSymbol, 5000);
          rangeParam = `&start_date=${start.toISOString().slice(0, 10)}&outputsize=${outSize}`;
        }
        const raw = await fetchJson(
          `${TD_BASE}/time_series?symbol=${encodeURIComponent(chunk.join(','))}&interval=1day${rangeParam}&apikey=${API_KEY}`
        );
        // A top-level error (bad key, rate limit) comes back as {status:"error"}.
        if (raw && raw.status === 'error') {
          const code = raw.code === 429 ? 429 : 502;
          return { ok: false, status: code, error: `Twelve Data: ${raw.message}` };
        }
        Object.assign(series, normalizeBySymbol(raw, chunk));
      }
      // Whatever this round did not price comes off the archive, so the
      // snapshot is still complete — those rows simply carry the close they
      // already had until their own slice comes round.
      if (liveSet) {
        const rest = symbols.filter((x) => !liveSet.has(x));
        if (rest.length) {
          const since = new Date(Date.now() - 470 * 86400000).toISOString().slice(0, 10);
          const bars = await store.readBarsFullFor(rest, since);
          for (const sym of rest) series[sym] = { values: bars[sym] || [] };
        }
        console.log(`prices: live ${liveSet.size}/${symbols.length} this round, ` +
          `${rest.length} from the archive`);
      } else if (fetchSymbols.length > CHUNK) {
        console.log(`prices: live, ${Math.ceil(toFetch.length / CHUNK)} chunks for ${toFetch.length} symbols`);
      }
    }

    // Trading-day approximations: ~5 ≈ 1W, ~10 ≈ 2W, ~21 ≈ 1M, ~63 ≈ 3M, ~126 ≈ 6M, ~252 ≈ 1Y.
    const TODAY = 1;
    const ONE_WEEK = 5;
    const TWO_WEEK = 10;
    const ONE_MONTH = 21;
    const THREE_MONTH = 63;
    const SIX_MONTH = 126;
    const ONE_YEAR = 252;

    // Benchmark 3-month return (as of the chosen date, if one is set).
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

      // With an as-of date, slice the series to it and compute the forward returns.
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
        // an override if the admin set one, otherwise shortened by rule
        shortName: shortOverrides[sym] || deriveShortName(names[sym]) || null,
        portfolios: membershipOf(sym, portfolios),
        sector: prof.sector || null,
        industry: prof.industry || null,
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
        volX: volumeX(values),             // today's volume / its prior 20-day average
        fresh3mHigh: fresh3mHigh(values),  // first close above the prior 3-month high
        // Yesterday's technical readings — the same fields, one bar back — so
        // the Advice can be re-evaluated as of the previous trading day.
        // Fundamentals are day-cached steps and stand for both days, the same
        // carry-forward the stock page's trend ribbon uses. Costs nothing:
        // the bars are already in hand.
        prevTech: (() => {
          if (!ok || values.length < 2) return null;
          const pv = values.slice(1);
          return {
            latestDate: pv[0].datetime, historyDays: pv.length,
            oneMonthPct: pctChange(pv, ONE_MONTH), threeMonthPct: pctChange(pv, THREE_MONTH),
            pctFromHigh: pctFromHigh(pv, 252), vs50ma: pctVsMA(pv, 50), vs200ma: pctVsMA(pv, 200),
            rsi: rsi(pv, 14), volTrend: volumeTrendPct(pv),
          };
        })(),
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

    // Scores each row. This used to have to wait until every row existed,
    // because momentum was ranked across the universe; it no longer is, so the
    // pass is here only because the rows are built by now anyway.
    applyScores(stocks);
    scoreActionInto(stocks);

    // The trend ribbon's year, as dated runs, for the assistant. Bar-derived,
    // so honestly replayable — which is why it survived the momentum cull that
    // took the past-score columns this window used to share.
    try {
      const bars = await trendBars(stocks.map((r) => r.symbol));
      for (const row of stocks) {
        const tb = bars[row.symbol];
        // `x.d`, not `x.datetime` — readBarsFor returns { d, high, close }. The
        // old code asked for .datetime and got undefined for every date, so the
        // assistant has been reading "undefined Strong uptrend -> undefined
        // Above 200D" for as long as the timeline has existed. It never failed,
        // it just quietly said nothing.
        row.trendTimeline = Array.isArray(tb)
          ? Action.trendTimeline(tb.map((x) => x.close), tb.map((x) => x.d),
            row.companyType || 'Established', ACTION_CFG, 252)
          : null;
      }
    } catch (err) {
      console.warn('trend timeline: could not build it:', err.message);
    }

    // Archive the bars we just fetched. Live pulls only — an as-of range is
    // truncated and would corrupt the history. Awaited rather than fired and
    // forgotten, because a serverless instance is free to stop the moment the
    // response is sent, but never allowed to fail the refresh: the archive is a
    // by-product, and the screener must still work if it breaks.
    if (!asOf && !opts.archivePrices) {
      try {
        const b = await persistBars(pricedLive || symbols, series);
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

// Only ever called for a live pull. An as-of pull fetches a different, truncated
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
  ['qualityRating', 'quality 1-10 from fundamentals; blank when too few inputs are usable'],
  ['companyType', 'Established, Early or ETF — which rule list judges this stock'],
  ['actionTrend', 'the Advice model\'s trend state: No data / Breakdown / Downtrend / Below 200D / Near 200D / Above 200D / Strong uptrend'],
  ['actionEntry', 'its entry state: Extended / None / Clean / Clean, near high'],
  ['actionFund', 'its fundamentals bucket: Weak / — / OK / Strong'],
  ['actionGuards', 'active timing guards (thin history, earnings soon); blank when none'],
  ['action', 'the Advice column: what the fixed Balanced rules conclude — Strong Buy / Buy / Buy with Risk / Hold / Avoid / Sell Immediately'],
  ['actionFlag', 'the ONE rule that fired — the stated reason for that advice'],
  ['advicePrev', 'the advice as of the previous trading day; a difference from action means it changed today'],
  ['trendTimeline', 'the trend state over the last ~12 months as dated runs, oldest first — "date state → date state", each date the session that state began. Replayed from the bars under the current Balanced rules and the stock\'s current type, so it is exact where full advice history would not be'],
  ['todayPct', 'return today, %'],
  ['oneWeekPct', 'return over 1 week, %'],
  ['twoWeekPct', 'return over 2 weeks, %'],
  ['oneMonthPct', 'return over 1 month, %'],
  ['threeMonthPct', 'return over 3 months, %'],
  ['sixMonthPct', 'return over 6 months, %'],
  ['oneYearPct', 'return over 1 year, %'],
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
    'You are the analyst built into Tickr Lab, a stock screener. You answer questions about one',
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
    '  - NO momentum or Overall scores. They exist in the product but are deliberately withheld',
    '    from you while the owner reworks the momentum model. Asked about momentum, say exactly',
    '    that and point at the table\'s Mom. column — and do NOT improvise a momentum verdict out',
    '    of the raw returns you do have.',
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
    'YOU DO NOT GIVE BUY, SELL OR HOLD VERDICTS OF YOUR OWN. Asked whether to buy something, set',
    '  out what the data supports on both sides and stop there: a verdict would need news, a',
    '  valuation model, and the person\'s horizon and risk tolerance, none of which you have.',
    '  The ADVICE column is different: it is the output of a fixed, published rule set, and you',
    '  may report it WITH ATTRIBUTION — "the Balanced rules read this as Buy: clean entry,',
    '  fundamentals OK (the actionFlag)" — never as your own recommendation. The distinction to',
    '  keep: the model advises, you explain the model. Do not append a standing disclaimer.',
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

app.post('/api/chat', requireMember, route(async (req, res) => {
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
  logAct(req, 'chat', 'asked'); // the fact only — never the question

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
  const guest = await isGuest(req);
  if (guest && !guestSet.has(symbol)) {
    return res.status(403).json({ error: 'The guest preview covers only a few stocks.' });
  }
  const snap = await readSnapshot();
  const stocks = (snap && snap.stocks) || [];
  const stock = stocks.find((x) => String(x.symbol).toUpperCase() === symbol);
  if (!stock) return res.status(404).json({ error: 'Not in the screener.' });
  // Read straight from the profile rather than the snapshot: these three are
  // deliberately absent from the row the screener serves to everyone.
  let profile = null;
  try { profile = await store.readProfile(stock.symbol); } catch { /* optional */ }

  res.json({
    stock,
    company: profile ? {
      description: profile.description || null,
      employees: profile.employees ?? null,
      website: profile.website || null,
    } : null,
    // The symbol picker's list. The whole snapshot is already in memory to work
    // out the rank above, so this costs a map and ~3 KB rather than a query.
    // Alphabetical, because the picker is for reaching a ticker you have in
    // mind; the filter box does the rest.
    universe: stocks
      .filter((x) => !x.error)
      .filter((x) => !guest || guestSet.has(String(x.symbol).toUpperCase()))
      .map((x) => ({ symbol: x.symbol, name: x.name || '' }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    updatedAt: snap.updatedAt || null,
  });
}));

// The momentum calculation as a spreadsheet, for one symbol. Built by the same
// module the CLI uses, so the workbook a reader downloads cannot drift from the
// one generated locally. ~35 KB and well under a second, so it is generated per
// request rather than cached — a cached copy would go stale on the next refresh
// and quietly disagree with the page it was downloaded from.
app.get('/api/model', requireAuth, route(async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Bad symbol.' });
  if ((await isGuest(req)) && !guestSet.has(symbol)) {
    return res.status(403).json({ error: 'The guest preview covers only a few stocks.' });
  }
  logAct(req, 'model', symbol);

  const rows = await store.readBars(symbol, MODEL_ROWS);
  if (rows.length < MODEL_MIN_BARS) {
    // Too young to have a momentum score at all, so there is nothing to model.
    return res.status(422).json({
      error: `${symbol} has ${rows.length} sessions stored; the model needs ${MODEL_MIN_BARS}.`,
    });
  }
  // readBars returns newest-first with `datetime`; the builder wants `d`.
  const bars = rows.map((b) => ({ d: b.datetime, high: Number(b.high), close: Number(b.close) }));
  const snap = await readSnapshot();
  const live = (snap && snap.stocks || []).find((x) => x.symbol === symbol) || null;

  const buf = buildModel(symbol, bars, live);
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="momentum-model-${symbol}.xlsx"`);
  res.set('Cache-Control', 'no-store');
  res.send(buf);
}));

// Everything /lab needs for one symbol: the price series and what happened
// next. The indicator itself is computed in the browser from the sliders —
// a round trip per drag would make the control feel like a query, and the
// arithmetic is the same module either way.
app.get('/api/lab', requireMember, route(async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Bad symbol.' });

  const rows = (await store.readBars(symbol, 6000))
    .map((b) => ({ d: b.datetime, c: Number(b.close) }))
    .reverse();                                     // oldest first, as Indicators wants
  if (rows.length < 300) {
    return res.status(422).json({ error: `${symbol} has ${rows.length} sessions stored; the lab needs 300.` });
  }
  // No forward-return array here. The page derives it from the closes for
  // whichever horizon is selected, which is both cheaper than shipping five of
  // them and the only way an arbitrary horizon could work at all.

  const snap = await readSnapshot();
  const row = (snap && snap.stocks || []).find((x) => x.symbol === symbol);
  res.set('Cache-Control', 'no-store');
  res.json({
    symbol,
    name: row ? row.name : '',
    horizons: Indicators.HORIZONS,
    dates: rows.map((r) => r.d),
    closes: rows.map((r) => Math.round(r.c * 100) / 100),
    indicators: Indicators.INDICATORS.map((x) => ({
      id: x.id, label: x.label, blurb: x.blurb,
      params: x.params, defaults: x.defaults,
    })),
    bounds: Indicators.BOUNDS,
    universe: ((snap && snap.stocks) || [])
      .map((x) => ({ symbol: x.symbol, name: x.name || '' }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol)),
  });
}));

// Which key a user's saved layout is stored under: their email, falling back to
// 'admin' for the legacy cookie and for open mode, where there is no user row —
// the same key convention chat_usage uses.
async function prefsKey(req) {
  const who = await currentUser(req);
  return who ? who.email : 'admin';
}

app.get('/api/prefs', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // A guest has no user row, so prefsKey() would fall through to the 'admin'
  // key — the owner's saved layout. Guests get defaults and store nothing.
  if (await isGuest(req)) return res.json({ prefs: {} });
  res.json({ prefs: await store.readPrefs(await prefsKey(req)) });
}));

app.put('/api/prefs', requireAuth, route(async (req, res) => {
  if (await isGuest(req)) return res.status(403).json({ error: 'Not on the guest preview.' });
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
  // Which momentum weighting the pages are showing: a preset id, and — only
  // for 'custom' — the map behind it. The map goes through the same
  // cleanWeights() the browser uses, so only the eight known factors survive,
  // as integers inside the slider's range. Anything else is dropped rather than
  // stored, which is what keeps this row from becoming free per-user storage.
  const out = { collapsed };
  const wid = /^[a-z]{1,16}$/.test(String(incoming.weights || '')) ? String(incoming.weights) : null;
  if (wid) out.weights = wid;
  const custom = Screens.cleanWeights(incoming.customWeights);
  if (custom) out.customWeights = custom;
  // Which optional advice columns the table shows beside Balanced (which is
  // always shown and never stored). Ids from the fixed four only — there is
  // deliberately no custom profile, so nothing free-form can get in.
  const ADVICE_COL_IDS = ['trend-rider', 'aggressive', 'max-risk', 'dip-buyer'];
  if (Array.isArray(incoming.advices)) {
    out.advices = ADVICE_COL_IDS.filter((id) => incoming.advices.includes(id));
  }
  // Whether the screener's filter row is shown. The filters themselves are
  // never stored — only whether the row is open.
  if (incoming.filterRow === true) out.filterRow = true;
  // The news ticker is on by default; only hiding it is stored.
  if (incoming.tickerOff === true) out.tickerOff = true;
  await store.writePrefs(await prefsKey(req), out);
  res.json({ ok: true });
}));

// Closes for the whole universe, for the table's sparklines. One query rather
// than 69, and loaded after the table paints — a decoration must not make the
// data wait on it.
// ---- news --------------------------------------------------------------
// Headlines per stock, from a swappable provider (news.js): Finnhub when
// FINNHUB_API_KEY is set, else Google News RSS, keyless. NEWS_PROVIDER=off
// kills the feature — routes serve empty, the pages show their quiet states.
// Only headline / source / url / timestamp are stored, never bodies.
const NEWS_OFF = String(process.env.NEWS_PROVIDER || '').toLowerCase() === 'off';
const FINNHUB_KEY = process.env.FINNHUB_API_KEY || '';
const NEWS_TTL_MS = 6 * 3600 * 1000;   // a visited stock page refetches after this
const NEWS_TOPUP_PER_REFRESH = 12;     // stalest symbols topped up per refresh

async function fetchNewsItems(symbol, name) {
  const signal = AbortSignal.timeout(6000);
  if (FINNHUB_KEY) {
    const res = await fetch(News.finnhubUrl(symbol, FINNHUB_KEY, News.KEEP_DAYS), { signal });
    if (!res.ok) throw new Error('news provider ' + res.status);
    return News.dedupe(News.normFinnhub(await res.json()));
  }
  const res = await fetch(News.googleRssUrl(name, symbol), {
    signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TickrLab/1.0)' },
  });
  if (!res.ok) throw new Error('news provider ' + res.status);
  return News.dedupe(News.parseGoogleRss(await res.text()));
}

const NEWS_PROVIDER_NAME = FINNHUB_KEY ? 'finnhub' : 'google';

async function refreshNewsFor(symbol, name) {
  const items = await fetchNewsItems(symbol, name);
  const w = await store.writeNews(symbol, items, News.KEEP_DAYS);
  return { items: items.length, added: w.added, stored: w.stored };
}

// The name a headline search uses: the display name (an owner's override, else
// the rule's short name), never the legal one. Quoted, "SK hynix Inc. American
// Depositary Receipt" matches almost nothing but old filings, which fall outside
// the 21-day window and leave the stock with no headlines at all — 36 of 271
// were in that state on 2026-09-15, and the short name found news for all 36.
async function newsNamesFor(picks) {
  let nm = {};
  try { nm = await store.readNamesFull(); } catch { /* fall back to the rule */ }
  return picks.map((p) => {
    const e = nm[p.symbol] || {};
    return { ...p, name: e.short || deriveShortName(p.name || e.name) || p.name || e.name || p.symbol };
  });
}

// One logged batch of headline fetches. Every symbol's outcome is written as
// it lands, and the batch is closed with its totals: complete, partial (some
// failed) or failed (all did). Logging is a by-product — trackSafe swallows
// its failures, and a batch that never closes is swept to abandoned.
async function runNewsBatch(picksIn, meta) {
  if (!picksIn.length) return null;
  const picks = await newsNamesFor(picksIn);
  const runId = await trackSafe(store.startNewsRun({ ...meta, provider: NEWS_PROVIDER_NAME, attempted: picks.length }));
  const t0 = Date.now();
  const results = await Promise.all(picks.map(async ({ symbol, name }) => {
    const s0 = Date.now();
    try {
      const r = await refreshNewsFor(symbol, name);
      await trackSafe(store.noteNewsItem(runId, { symbol, ok: true, ...r, ms: Date.now() - s0 }));
      return { ok: true, ...r };
    } catch (err) {
      await trackSafe(store.noteNewsItem(runId, { symbol, ok: false, ms: Date.now() - s0, error: err.message }));
      return { ok: false, error: err.message };
    }
  }));
  const ok = results.filter((x) => x.ok);
  const failed = results.length - ok.length;
  await trackSafe(store.finishNewsRun(runId, {
    status: failed === 0 ? 'complete' : ok.length === 0 ? 'failed' : 'partial',
    ok: ok.length, failed,
    items: ok.reduce((a, x) => a + x.items, 0),
    added: ok.reduce((a, x) => a + x.added, 0),
    ms: Date.now() - t0,
    error: failed ? results.find((x) => !x.ok).error : null,
  }));
  store.pruneNewsRuns().catch(() => { /* the bars rule */ });
  return { runId, results };
}

// Coverage without a schedule: every refresh tops up the few stalest
// symbols, never-fetched first, so the nightly job's ~20 rounds cycle the
// whole universe inside one night and no single call does bulk work.
// Fire-and-forget — headlines are a by-product, and the archive rule
// applies: a failed news write never fails a refresh.
function topUpNews(rows, ctx = {}) {
  if (NEWS_OFF) return;
  (async () => {
    const live = (rows || []).filter((r) => r && !r.error && r.symbol);
    if (!live.length) return;
    const state = await store.readNewsState();
    // A stock holding no headlines whose last fetch is past the TTL is treated
    // as never fetched, so an empty feed is retried ahead of the rotation
    // rather than waiting its turn with nothing to show.
    let held = {};
    try { held = (await store.newsHoldings()).perSymbol; } catch { /* plain stalest order */ }
    const order = { ...state };
    for (const r of live) {
      if (!held[r.symbol] && state[r.symbol] && Date.now() - state[r.symbol] > NEWS_TTL_MS) order[r.symbol] = 0;
    }
    const pick = News.pickStalest(live.map((r) => r.symbol), order, NEWS_TOPUP_PER_REFRESH);
    const byId = Object.fromEntries(live.map((r) => [r.symbol, r]));
    await runNewsBatch(pick.map((sym) => ({ symbol: sym, name: byId[sym] && byId[sym].name })), {
      trigger: 'refresh', actor: ctx.actor || null, refreshRunId: ctx.refreshRunId || null,
    });
  })().catch((err) => console.warn('news top-up skipped:', err.message));
}

// Stored-or-fetch for one symbol — the stock page's card. Six-hour TTL, so a
// visited page stays fresh with no schedule at all; on a provider failure
// the stored set is served, because stale beats nothing.
app.get('/api/news', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  if ((await isGuest(req)) && !guestSet.has(symbol)) {
    return res.status(403).json({ error: 'The guest preview covers only a few stocks.' });
  }
  if (NEWS_OFF) return res.json({ symbol, items: [] });
  const state = await store.readNewsState();
  if (!state[symbol] || Date.now() - state[symbol] > NEWS_TTL_MS) {
    try {
      const snap = await readSnapshot();
      const row = ((snap && snap.stocks) || []).find((x) => x.symbol === symbol);
      const who = await currentUser(req);
      const out = await runNewsBatch([{ symbol, name: row && row.name }], {
        trigger: 'page', actor: who ? who.email : ((await isGuest(req)) ? 'guest' : 'admin'),
      });
      const r = out && out.results[0];
      if (r && !r.ok) console.warn('news fetch failed for ' + symbol + ':', r.error);
    } catch (err) {
      console.warn('news fetch failed for ' + symbol + ':', err.message);
    }
  }
  res.json({ symbol, items: await store.readNews(symbol, 12) });
}));

// The screener's news ticker: headlines PUBLISHED in the last 12 hours, newest
// first. At most two per stock so one busy name cannot fill the strip, one row
// per story (the same article filed under two stocks keeps its first). Every
// stock's share is sent, not a top 60: the page narrows the strip to whatever
// the table is filtered to, and a universe-wide top 60 would leave most filters
// with nothing. Stored rows only — never a fetch.
const TICKER_HOURS = 12;
app.get('/api/news/recent', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (NEWS_OFF) return res.json({ items: [], hours: TICKER_HOURS });
  const since = new Date(Date.now() - TICKER_HOURS * 3600000).toISOString();
  const snap = await readSnapshot();
  let symbols = new Set(((snap && snap.stocks) || []).filter((x) => !x.error).map((x) => x.symbol));
  if (await isGuest(req)) symbols = new Set([...symbols].filter((s) => guestSet.has(String(s).toUpperCase())));
  const rows = await store.readRecentNews(since, 3000);
  const perSym = {};
  const seen = new Set();
  const items = [];
  for (const x of rows) {
    if (!symbols.has(x.symbol) || seen.has(x.url)) continue;
    if ((perSym[x.symbol] = (perSym[x.symbol] || 0) + 1) > 2) continue;
    seen.add(x.url);
    items.push(x);
  }
  res.json({ items, hours: TICKER_HOURS, since });
}));

// One newest headline per symbol, for the screener's hover card. Stored
// rows only — this path never calls anything external.
app.get('/api/news/latest', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  let items = NEWS_OFF ? [] : await store.readLatestNews();
  if (await isGuest(req)) items = items.filter((x) => guestSet.has(String(x.symbol).toUpperCase()));
  res.json({ items });
}));

app.get('/api/sparklines', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const days = Math.min(400, Math.max(20, Number(req.query.days) || 90));
  const snap = await readSnapshot();
  let symbols = ((snap && snap.stocks) || []).filter((x) => !x.error).map((x) => x.symbol);
  if (await isGuest(req)) symbols = symbols.filter((x) => guestSet.has(String(x).toUpperCase()));
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
// ---- the basket curve ---------------------------------------------------
// Equal dollars at the window start, held — an index of mean(close/start)
// per session, which is the honest convention for a LIST (no positions
// exist to weight by). The benchmark is the whole universe on the same
// convention: SPY is deliberately not archived, and "did my list beat my
// own screener" is the better question anyway. One readBarsFor covers both
// curves, since the basket is a subset of the universe (~23k rows at 1Y,
// the measured 2s query's little sibling).
function equalWeightIndex(bars, symbols, dates) {
  const maps = [];
  for (const sym of symbols) {
    const arr = bars[sym];
    if (!arr || !arr.length) continue;
    const m = new Map();
    for (const b of arr) if (b.close > 0) m.set(b.d, b.close);
    if (m.size) maps.push(m);
  }
  const start = dates[0];
  const active = [];
  for (const m of maps) {
    // a symbol must exist at the window start or it distorts the index the
    // day it lists; excluded symbols are counted for the caption
    let base = m.get(start);
    if (base == null) {
      // no bar exactly at the window start: use the newest close before it
      let bd = null;
      for (const [d, c] of m) if (d < start && (bd == null || d > bd)) { bd = d; base = c; }
    }
    if (base == null) continue;
    active.push({ m, base, last: base });
  }
  const out = [];
  for (const d of dates) {
    let sum = 0;
    for (const a of active) {
      const c = a.m.get(d);
      if (c != null) a.last = c;
      sum += a.last / a.base;
    }
    out.push(active.length ? Math.round((sum / active.length) * 10000) / 10000 : null);
  }
  return { index: out, used: active.length, of: maps.length };
}

// Each stock's own line for the small-multiples grid: normalised to ITS OWN
// first close in the window (each mini answers "what did this stock do", not
// "what did it contribute"), forward-filled through gaps, null before it has
// data so a late listing starts where it starts instead of drawing a lie.
function symbolSeries(bars, symbols, dates) {
  const out = {};
  for (const sym of symbols) {
    const arr = bars[sym];
    if (!arr || !arr.length) continue;
    const m = new Map();
    for (const b of arr) if (b.close > 0) m.set(b.d, b.close);
    let base = null, last = null;
    const series = dates.map((d) => {
      const c = m.get(d);
      if (c != null) { if (base == null) base = c; last = c; }
      if (base == null || last == null) return null;
      return Math.round((last / base) * 1000) / 1000;
    });
    if (base != null) out[sym] = series;
  }
  return out;
}

app.get('/api/basket', requireMember, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rawName = String(req.query.name || '').trim();
  // Floor of 5, a trading week: the promo studio's shortest chart window.
  const days = Math.min(400, Math.max(5, Number(req.query.days) || 253));
  const portfolios = await readPortfolios();
  const all = getUniverse(portfolios);
  let symbols;
  let label = rawName;
  if (rawName.startsWith('my:')) {
    const mine = await store.readUserPortfolios(await prefsKey(req));
    const nm = rawName.slice(3);
    if (!(nm in mine)) return res.status(404).json({ error: 'No such personal portfolio.' });
    const uni = new Set(all);
    symbols = mine[nm].filter((x) => uni.has(x));
    label = nm;
  } else if (rawName === 'All') {
    symbols = all;
  } else if (rawName in portfolios) {
    symbols = portfolios[rawName];
  } else {
    return res.status(404).json({ error: 'No such portfolio.' });
  }
  if (!symbols.length) {
    return res.json({ label, mine: rawName.startsWith('my:'), symbols: [], dates: [], basket: null, universe: null });
  }

  const since = new Date(Date.now() - Math.round(days * 1.55 + 14) * 86400000)
    .toISOString().slice(0, 10);
  const bars = await store.readBarsFor(all, since);

  // The date axis is every session anyone traded, oldest first, trimmed to
  // the asked-for window — US names dominate, so this is the US calendar.
  // Sessions only the foreign listings traded are dropped: 005930 keeps the
  // Korean calendar, so a US holiday would otherwise enter the axis with one
  // symbol on it — harmless over a year, a visible step at a five-day window.
  // The test is data-driven (half of the busiest day's coverage), so it needs
  // no calendar and no hardcoded holidays.
  const perDate = new Map();
  for (const sym of all) for (const b of bars[sym] || []) perDate.set(b.d, (perDate.get(b.d) || 0) + 1);
  const busiest = Math.max(0, ...perDate.values());
  const dates = [...perDate.keys()]
    .filter((d) => perDate.get(d) >= busiest * 0.5)
    .sort()
    .slice(-days);
  if (!dates.length) return res.json({ label, mine: rawName.startsWith('my:'), symbols, dates: [], basket: null, universe: null });

  const basket = equalWeightIndex(bars, symbols, dates);
  const universe = equalWeightIndex(bars, all, dates);
  res.json({
    label,
    mine: rawName.startsWith('my:'),
    symbols,
    dates,
    basket: basket.index, basketUsed: basket.used, basketOf: symbols.length,
    universe: universe.index, universeUsed: universe.used, universeOf: all.length,
    series: symbolSeries(bars, symbols, dates),
  });
}));

app.get('/api/history', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,15}$/.test(symbol)) return res.status(400).json({ error: 'Bad symbol.' });
  if ((await isGuest(req)) && !guestSet.has(symbol)) {
    return res.status(403).json({ error: 'The guest preview covers only a few stocks.' });
  }
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

// ---- the nightly refresh report --------------------------------------------
// Sent whenever a Refresh all finishes, whoever started it — the cron job, or
// the button. That is why it hangs off endRefresh() rather than off the cron
// route: both paths converge there, and endRefresh() reports only the caller
// that actually cleared the flag, so one run can never send two emails.
//
// A run that stalls outright sends nothing: nobody calls endRefresh() and the
// flag ages out on its own after REFRESH_STALE_MS. The cron job covers that
// case instead, since it is the thing still awake.

const REPORT_MOVERS = 5;

// ---- fundamentals that moved ------------------------------------------------
// What a Refresh all can say that a price refresh cannot: the company numbers
// changed. In practice that means a company reported.
//
// SIX FIELDS ARE DELIBERATELY NOT HERE — price, market cap, forward P/E, PEG,
// FCF yield and net-cash %. Measured across the recorded history, each moves on
// 79-100% of consecutive nights with a median of about 2%, because each is
// divided by, or is, the price. They restate the day's price move, which the
// movers list already gives, and including them would bury the real changes
// under a hundred lines of noise. The fields below move on 1-5% of nights, and
// when they move it is a step rather than a wobble: AVGO's revenue sat at
// 75.46B for five recorded days and then went to 89.10B and stayed.
//
// Two derived signals were tried and rejected. Forward EPS revision, backed out
// as relD(price) - relD(forward P/E), and share-count change as relD(market cap)
// - relD(price). Both look clever and both measure the wrong thing: SNOW threw a
// "+20.9% EPS revision" on a day its forward P/E was byte-identical, and the
// share-count signal oscillated -20.9% then +22.1% on consecutive days. The
// profile blob and the price are not sampled at the same instant, so the
// subtraction reads that staleness, not the company.
const FUND_MOVES = [
  // Absolutes, compared as a relative change and printed before -> after.
  { key: 'revenueTtm', label: 'revenue', kind: 'money' },
  { key: 'grossProfitTtm', label: 'gross profit', kind: 'money' },
  { key: 'netIncomeTtm', label: 'net income', kind: 'money',
    flip: ['turned profitable', 'swung to a loss'] },
  { key: 'fcfTtm', label: 'free cash flow', kind: 'money',
    flip: ['turned cash-generative', 'swung to cash burn'] },
  { key: 'netCash', label: 'net cash', kind: 'money',
    flip: ['moved to net cash', 'moved to net debt'] },
  // Already percentages, so the honest comparison is in POINTS. A margin going
  // from 0.1% to 0.3% is "+200%" and means nothing; it is +0.2pt.
  { key: 'grossMargin', label: 'gross margin', kind: 'pts' },
  { key: 'profitMargin', label: 'profit margin', kind: 'pts' },
  { key: 'fcfMargin', label: 'FCF margin', kind: 'pts' },
  { key: 'revenueGrowthYoY', label: 'revenue growth', kind: 'pts' },
  { key: 'earningsGrowthYoY', label: 'earnings growth', kind: 'pts' },
  { key: 'roe', label: 'ROE', kind: 'pts' },
  { key: 'shortPctFloat', label: 'short interest', kind: 'pts' },
];
// Sized against the recorded history: at these levels the whole universe yields
// roughly seven field-moves a night, clustered into one or two companies, which
// is a section worth reading rather than a wall.
const FUND_MIN_REL = 0.05;    // 5% for an absolute
const FUND_MIN_PTS = 1;       // one percentage point
const FUND_MIN_BASE = 1e6;    // a base under a million makes a percentage silly
const FUND_PTS_SCORE_CAP = 0.25;   // a point move never outranks a big absolute one
const FUND_MAX_SYMBOLS = 10;
const FUND_MAX_PER_SYMBOL = 6;

// Currency-neutral on purpose: these are in the company's reporting currency,
// and Samsung's revenue is not dollars.
const fmtBig = (v) => {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v), sign = v < 0 ? '-' : '';
  if (a >= 1e12) return sign + (a / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return sign + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return sign + (a / 1e6).toFixed(0) + 'M';
  return sign + Math.round(a).toLocaleString();
};
const fmtPts = (v) => (v == null || !isFinite(v) ? '—' : v.toFixed(1));

// One symbol's worth of change, or null when nothing cleared the bar.
function fundamentalMovesFor(before, after) {
  const out = [];
  for (const spec of FUND_MOVES) {
    const x = before[spec.key], y = after[spec.key];
    if (x == null || y == null || !isFinite(x) || !isFinite(y) || x === y) continue;
    if (spec.kind === 'money') {
      const flipped = (x < 0) !== (y < 0);
      if (Math.max(Math.abs(x), Math.abs(y)) < FUND_MIN_BASE) continue;
      const rel = Math.abs(x) > 0 ? (y - x) / Math.abs(x) : null;
      if (!flipped && (rel == null || Math.abs(rel) < FUND_MIN_REL)) continue;
      // A sign change makes the percentage nonsense — net income going -29M to
      // 59M is not "+302%", it is a company that started making money. Say that
      // instead, and let it lead: it is the most important thing on the page.
      const note = flipped
        ? (spec.flip ? spec.flip[y > x ? 0 : 1] : 'changed sign')
        : signed(rel * 100, 0);
      out.push({ label: spec.label, text: `${fmtBig(x)} → ${fmtBig(y)} ${note}`,
        score: flipped ? 100 : Math.abs(rel), up: y > x });
    } else {
      const d = y - x;
      if (Math.abs(d) < FUND_MIN_PTS) continue;
      // Capped, because a percentage-POINT move is not on the same scale as a
      // relative one and the growth rates swing wildly: AVGO's earnings growth
      // moved 128.6 points on the night its net income rose 31%, and without a
      // cap the derived figure outranks the report it was derived from. Beyond
      // about 25 points the field is a volatile growth rate rather than a
      // margin, so the extra magnitude carries no extra meaning.
      out.push({ label: spec.label,
        text: `${fmtPts(x)} → ${fmtPts(y)} ${signed(d, 1)}pt`.replace('%pt', 'pt'),
        score: Math.min(Math.abs(d) / 100, FUND_PTS_SCORE_CAP), up: d > 0 });
    }
  }
  if (!out.length) return null;
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, FUND_MAX_PER_SYMBOL);
}

// Every symbol whose company numbers moved since the previous recorded set.
function fundamentalMoves(pair) {
  if (!pair || !pair.prevDay || !pair.curr.size) return { prevDay: null, symbols: [], fresh: 0 };
  const symbols = [];
  let fresh = 0;
  for (const [symbol, after] of pair.curr) {
    const before = pair.prev.get(symbol);
    // No earlier row means the ticker is new to the archive, not that
    // everything about it changed overnight.
    if (!before) { fresh++; continue; }
    const moves = fundamentalMovesFor(before, after);
    if (moves) symbols.push({ symbol, moves, score: moves[0].score });
  }
  symbols.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  return { prevDay: pair.prevDay, symbols: symbols.slice(0, FUND_MAX_SYMBOLS),
    total: symbols.length, fresh };
}

function fmtDuration(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return sec + 's';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ' + String(sec % 60).padStart(2, '0') + 's';
  return Math.floor(min / 60) + 'h ' + String(min % 60).padStart(2, '0') + 'm';
}

// Wall-clock start, in the market's own timezone rather than the server's. The
// runner is UTC and the reader is not, so "00:03" would need translating every
// night; REPORT_TZ exists for whoever eventually reads this somewhere else.
function fmtClock(ms) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: process.env.REPORT_TZ || 'America/New_York',
      // Explicit components rather than dateStyle/timeStyle: ECMA-402 refuses
      // to combine those with timeZoneName, and the throw lands in the catch
      // below, which would quietly print UTC instead of saying so.
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }
}

const escHtml = (t) => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const signed = (n, d = 1) => (n == null || !isFinite(n) ? '—'
  : `${n >= 0 ? '+' : ''}${n.toFixed(d)}%`);


// Everything the report says, gathered once so the text and HTML bodies cannot
// disagree with each other.
// `kind` is 'all' for a Refresh all and 'plain' for an ordinary price Refresh.
// The two runs differ in one way that matters to a reader: a plain Refresh does
// not re-pull the profile cache, so every fundamental in the snapshot is
// yesterday's. Saying so is the difference between a report and a misleading one.
async function buildRefreshReport(state, snap, kind = 'all') {
  const rows = (snap && snap.stocks) || [];
  const live = rows.filter((x) => !x.error);
  const loaded = live.filter((x) => x.profileFetchedAt != null);
  const failed = rows.filter((x) => x.error);
  const missing = live.filter((x) => x.profileFetchedAt == null);
  const day = marketDay(live);

  let stats = { barRows: null, barsThrough: null, fundamentalsToday: null };
  try {
    stats = await store.archiveStats(day);
  } catch (err) {
    console.warn('report: archive stats unavailable:', err.message);
  }

  // Only a Refresh all re-pulls the profile cache, so only a Refresh all can
  // have a fundamentals change to report. A plain Refresh reuses yesterday's
  // profiles and would compare a number with itself.
  let funds = { prevDay: null, symbols: [], total: 0, fresh: 0 };
  if (kind === 'all') {
    try {
      funds = fundamentalMoves(await store.readFundamentalsPair(day));
    } catch (err) {
      console.warn('report: fundamentals comparison unavailable:', err.message);
    }
  }

  const asOf = live.reduce((m, x) => (x.latestDate && x.latestDate > m ? x.latestDate : m), '');
  // A Refresh all is judged on coverage; a plain Refresh never touches profiles,
  // so the only thing that can go wrong in one is a symbol that failed outright.
  const complete = kind === 'all'
    ? (rows.length > 0 && loaded.length >= live.length && !failed.length)
    : (rows.length > 0 && !failed.length);

  const num = (n) => n != null && isFinite(n);
  const movers = live.filter((x) => num(x.todayPct)).sort((a, b) => b.todayPct - a.todayPct);

  // Advice that changed since the previous trading day — the one thing in the
  // report that is a verdict moving rather than a number moving. Biggest tier
  // jumps first.
  const tier = (a) => Action.ACTIONS.indexOf(a);
  const advice = live
    .filter((x) => x.action && x.advicePrev && x.advicePrev !== x.action)
    .map((x) => ({ symbol: x.symbol, from: x.advicePrev, to: x.action, flag: x.actionFlag || '',
      up: tier(x.action) > tier(x.advicePrev) }))
    .sort((a, b) => (Math.abs(tier(b.to) - tier(b.from)) - Math.abs(tier(a.to) - tier(a.from)))
      || a.symbol.localeCompare(b.symbol));

  // A Refresh all pairs each changed verdict with its freshest stored
  // headlines — a flip raises "what happened?", and this is where it gets
  // answered. Stored rows only, never a fetch on the report path (the same
  // run's earlier rounds have usually topped these up minutes before); a
  // symbol with nothing recent simply shows none.
  if (kind === 'all') {
    const since = new Date(Date.now() - 3 * 86400000).toISOString();
    for (const x of advice) {
      try {
        x.news = (await store.readNews(x.symbol, 4)).filter((h) => h.published_at >= since).slice(0, 2);
      } catch { x.news = []; }
    }
  }

  return {
    kind, complete, rows, live, loaded, failed, missing, asOf, day, stats,
    // The digest is the day's movers and nothing else. The screens and the
    // highest-rated list were dropped in Sep 2026: both restate a standing
    // rather than reporting what happened, and both are a click away on
    // /analysis and the screener, where they are current rather than a
    // snapshot of whenever the refresh happened to finish. Screens.run() over
    // the whole universe went with them.
    top: movers.slice(0, REPORT_MOVERS),
    bottom: movers.slice(-REPORT_MOVERS).reverse(),
    advice,
    funds,
    actor: state.actor || 'unknown',
    startedAt: state.startedAt,
    duration: fmtDuration(Date.now() - state.startedAt),
  };
}

function refreshReportBodies(r) {
  const url = APP_URL || '';
  // Every ticker in the mail links to its stock page. Colour inherited and no
  // underline, so the layout reads exactly as before — the symbol is simply
  // clickable. Without APP_URL there is nothing to link to, so plain text.
  const symLink = (sym) => (url
    ? `<a href="${url}/stock/${encodeURIComponent(sym)}" style="color:inherit;text-decoration:none">${escHtml(sym)}</a>`
    : escHtml(sym));
  const line = (k, v) => k.padEnd(14) + v;
  const isAll = r.kind === 'all';
  const runName = r.mode === 'missing' ? 'Fill missing' : isAll ? 'Refresh all' : 'Refresh';
  // Prices moved; the company numbers did not. Say which.
  const fundLine = !isAll ? 'not re-pulled — prices only'
    : (r.stats.fundamentalsToday == null ? '—'
      : `${r.stats.fundamentalsToday} symbols recorded for ${r.day}`);
  const headCount = isAll
    ? `${r.loaded.length} of ${r.live.length} profiles`
    : `${r.live.length} symbols`;
  const barLine = r.stats.barRows == null ? '—'
    : `${r.stats.barRows.toLocaleString()} rows through ${r.stats.barsThrough || '—'}`;

  const t = [
    `${runName} — ${headCount}`,
    r.complete ? 'Complete.' : 'Incomplete — see below.',
    '',
    line('Took', r.duration),
    line('Started', fmtClock(r.startedAt)),
    line('Finished', fmtClock(Date.now())),
    line('Triggered by', r.actor),
    line('Prices as of', r.asOf || '—'),
    line('Fundamentals', fundLine),
    line('Bar archive', barLine),
  ];
  if (r.failed.length) {
    t.push('', `Failed (${r.failed.length}): ` +
      r.failed.map((x) => `${x.symbol} — ${x.error}`).join('; '));
  }
  if (isAll && r.missing.length) {
    t.push('', `No profile yet (${r.missing.length}): ` + r.missing.map((x) => x.symbol).join(', '));
  }
  if (r.mode === 'missing') {
    t.push('', r.stillGaps.length
      ? `Still missing (${r.stillGaps.length}): ` + r.stillGaps.map((g) => g.symbol).join(', ')
      : 'Still missing: none — every stock has complete company data.');
    if (r.noIndustry.length) {
      t.push(`No industry from the provider (${r.noIndustry.length}, expected for funds): ` + r.noIndustry.join(', '));
    }
  }
  t.push('', 'Movers today');
  for (const x of r.top) t.push('  ' + signed(x.todayPct).padStart(7) + '  ' + x.symbol);
  if (r.top.length && r.bottom.length) t.push('  …');
  for (const x of r.bottom) t.push('  ' + signed(x.todayPct).padStart(7) + '  ' + x.symbol);
  t.push('', 'Advice changes  (vs the previous trading day)');
  if (!(r.advice || []).length) t.push('  none — every verdict held');
  else {
    for (const x of r.advice) {
      t.push(`  ${x.symbol.padEnd(6)} ${x.from} → ${x.to}   ${x.flag}`);
      for (const h of x.news || []) t.push(`         · ${h.headline}${h.source ? ' — ' + h.source : ''}`);
    }
  }
  if (isAll && r.funds.prevDay) {
    t.push('', `Fundamentals that moved  (against ${r.funds.prevDay}, the previous recorded set)`);
    if (!r.funds.symbols.length) {
      t.push('  Nothing moved enough to mention.');
    } else {
      for (const s of r.funds.symbols) {
        t.push(`  ${s.symbol}`);
        for (const m of s.moves) t.push(`      ${m.label}  ${m.text}`);
      }
      if (r.funds.total > r.funds.symbols.length) {
        t.push(`  …and ${r.funds.total - r.funds.symbols.length} more`);
      }
    }
    if (r.funds.fresh) t.push(`  ${r.funds.fresh} recorded for the first time, so nothing to compare.`);
    t.push('  Price, market cap, forward P/E, PEG, FCF yield and net-cash % are left out —',
      '  they move with the price every night rather than with the company.');
  }
  if (url) t.push('', url);

  // --- html ---
  const tone = r.complete ? '#0f9d58' : '#c5221f';
  const cell = 'padding:3px 10px 3px 0;font-size:13px';
  const kv = (k, v) => `<tr><td style="${cell};color:#777;white-space:nowrap">${escHtml(k)}</td>` +
    `<td style="${cell}">${escHtml(v)}</td></tr>`;
  const chip = (x) => `<span style="display:inline-block;margin:0 10px 4px 0;font-size:13px">` +
    `<b>${symLink(x.symbol)}</b> <span style="color:${x.todayPct >= 0 ? '#0f9d58' : '#c5221f'}">` +
    `${signed(x.todayPct)}</span></span>`;
  // The section a Refresh all exists for: what changed about the companies,
  // rather than about their prices.
  let fundsBlock = '';
  if (isAll && r.funds.prevDay) {
    const rows = r.funds.symbols.map((s) => {
      const items = s.moves.map((m) =>
        `<div style="font-size:13px;margin:0 0 2px">` +
        `<span style="color:#777">${escHtml(m.label)}</span> ` +
        `<span style="color:${m.up ? '#0f9d58' : '#c5221f'}">${escHtml(m.text)}</span></div>`).join('');
      return `<tr><td style="${cell};white-space:nowrap;vertical-align:top">` +
        `<b>${symLink(s.symbol)}</b></td><td style="${cell}">${items}</td></tr>`;
    }).join('');
    const more = r.funds.total > r.funds.symbols.length
      ? `<p style="margin:6px 0 0;font-size:12px;color:#999">…and ${r.funds.total - r.funds.symbols.length} more.</p>` : '';
    const first = r.funds.fresh
      ? `<p style="margin:6px 0 0;font-size:12px;color:#999">${r.funds.fresh} recorded for the first time, so nothing to compare.</p>` : '';
    fundsBlock =
      '<h3 style="margin:22px 0 2px;font-size:14px">Fundamentals that moved</h3>' +
      `<p style="margin:0 0 8px;font-size:12px;color:#999">Against ${escHtml(r.funds.prevDay)}, ` +
      'the previous recorded set — not necessarily yesterday.</p>' +
      (r.funds.symbols.length
        ? `<table style="border-collapse:collapse">${rows}</table>`
        : '<p style="margin:0;font-size:13px;color:#999">Nothing moved enough to mention.</p>') +
      more + first +
      '<p style="margin:8px 0 0;font-size:12px;color:#999">Price, market cap, forward P/E, PEG, ' +
      'FCF yield and net-cash % are left out: they move with the price every night rather than ' +
      'with the company.</p>';
  }

  let problems = '';
  if (r.failed.length) {
    problems += `<p style="margin:14px 0 0;font-size:13px"><b style="color:#c5221f">` +
      `Failed (${r.failed.length}):</b> ` +
      r.failed.map((x) => `${escHtml(x.symbol)} — ${escHtml(x.error)}`).join('; ') + '</p>';
  }
  if (isAll && r.missing.length) {
    problems += `<p style="margin:8px 0 0;font-size:13px"><b style="color:#b06000">` +
      `No profile yet (${r.missing.length}):</b> ` +
      escHtml(r.missing.map((x) => x.symbol).join(', ')) + '</p>';
  }
  if (r.mode === 'missing') {
    problems += `<p style="margin:8px 0 0;font-size:13px"><b style="color:${r.stillGaps.length ? '#b06000' : '#137333'}">` +
      (r.stillGaps.length ? `Still missing (${r.stillGaps.length}):</b> ` +
        escHtml(r.stillGaps.map((g) => g.symbol).join(', ')) : 'Still missing: none.</b>') + '</p>';
    if (r.noIndustry.length) {
      problems += '<p style="margin:8px 0 0;font-size:13px;color:#5f6368">' +
        `No industry from the provider (${r.noIndustry.length}, expected for funds): ` +
        escHtml(r.noIndustry.join(', ')) + '</p>';
    }
  }

  const inner =
    '<table style="border-collapse:collapse">' +
    // The run time leads: it is the number that says whether the night went
    // normally, and a Refresh all that finishes in seconds did not really run.
    `<tr><td style="${cell};color:#777;white-space:nowrap">Took</td>` +
    `<td style="padding:3px 10px 3px 0;font-size:15px;font-weight:600">${escHtml(r.duration)}</td></tr>` +
    kv('Started', fmtClock(r.startedAt)) +
    kv('Finished', fmtClock(Date.now())) +
    kv('Prices as of', r.asOf || '—') + kv('Fundamentals', fundLine) + kv('Bar archive', barLine) +
    '</table>' +
    problems +
    '<h3 style="margin:22px 0 6px;font-size:14px">Movers today</h3>' +
    '<div>' + r.top.map(chip).join('') + '</div>' +
    '<div style="margin-top:4px">' + r.bottom.map(chip).join('') + '</div>' +
    (() => {
      const aCell = 'padding:3px 12px 3px 0;vertical-align:top;font-size:13px';
      const rowsH = (r.advice || []).map((x) =>
        `<tr><td style="${aCell};font-weight:600;white-space:nowrap">${symLink(x.symbol)}</td>` +
        `<td style="${aCell};white-space:nowrap;color:${x.up ? '#0f766e' : '#b91c1c'}">${x.from} → ${x.to}</td>` +
        `<td style="${aCell};color:#666">${x.flag}</td></tr>` +
        ((x.news || []).length
          ? `<tr><td></td><td colspan="2" style="padding:0 12px 7px 0;font-size:12px;color:#888">` +
            x.news.map((h) => (/^https?:\/\//i.test(h.url || '')
              ? `<a href="${escHtml(h.url)}" style="color:#556a8a;text-decoration:none">${escHtml(h.headline)}</a>`
              : escHtml(h.headline))
              + (h.source ? ` <span style="color:#aaa">— ${escHtml(h.source)}</span>` : '')).join('<br>') +
            '</td></tr>'
          : '')).join('');
      return '<h3 style="margin:22px 0 6px;font-size:14px">Advice changes</h3>' +
        (rowsH
          ? `<table cellpadding="0" cellspacing="0">${rowsH}</table>` +
            '<p style="margin:6px 0 0;font-size:12px;color:#999">Against the previous trading day, on the Balanced rules. Headlines are the newest stored for each changed symbol.</p>'
          : '<p style="margin:0;font-size:13px;color:#666">None — every verdict held from the previous trading day.</p>');
    })() +
    fundsBlock +
    '';

  const html = emailShell({
    heading: `${runName} — ${headCount}`,
    // The duration leads the table below; repeating it here reads as a stutter.
    intro: `${r.complete ? 'Complete' : 'Incomplete'} · started by ${r.actor}`,
    body: inner + (url ? mailButton(url, 'Open the screener') : ''),
    note: `Sent automatically when a ${runName} finishes.`,
  });

  return { text: t.join('\n'), html };
}

// Never throws: the report is a by-product, and a mail outage must not fail the
// refresh round that happened to finish the run.
async function sendRefreshReport(state, kind = 'all') {
  if (!state) return false;          // nothing was cleared — someone else reported this run
  // A tracked run keeps its report on /refreshes even when mail is not set up.
  if (!MAIL_READY && !state.runId) return false;
  try {
    const r = await buildRefreshReport(state, await readSnapshot(), kind);
    r.mode = state.mode || null;
    if (r.mode === 'missing') {
      // What is still missing after the run, and which stocks the provider
      // simply has no industry for — the second list is expected, not a gap.
      const universe = r.live.map((x) => x.symbol);
      r.stillGaps = profileGaps(universe, await readProfiles());
      r.noIndustry = r.live.filter((x) => x.profileFetchedAt != null && !x.industry).map((x) => x.symbol);
    }
    const { text, html } = refreshReportBodies(r);
    const subject = r.mode === 'missing'
      ? `[Tickr Lab] Fill missing — ${r.stillGaps.length ? r.stillGaps.length + ' still missing' : 'complete'}`
      : kind === 'all'
      ? `[Tickr Lab] Refresh all — ${r.loaded.length}/${r.live.length}` + (r.complete ? '' : ' incomplete')
      : `[Tickr Lab] Refresh — ${r.live.length} symbols as of ${r.asOf || 'n/a'}` +
        (r.failed.length ? `, ${r.failed.length} failed` : '');
    let ok = false;
    const to = MAIL_READY ? await operatorEmail() : null;
    if (to) {
      ok = await sendMail({ to, subject, text, html });
      console.log(`report: ${kind === 'all' ? 'refresh all' : 'refresh'} summary ` +
        `${ok ? 'sent to ' + to : 'could not be sent'}`);
    }
    if (state.runId) {
      await trackSafe(store.setRunReport(state.runId, {
        sent: ok, html,
        failed: r.failed.map((x) => x.symbol),
        stillMissing: r.stillGaps ? r.stillGaps.map((g) => g.symbol) : null,
      }));
    }
    return ok;
  } catch (err) {
    console.warn('report: refresh summary failed (refresh unaffected):', err.message);
    return false;
  }
}

// The trading day a run belongs to — the freshest bar anything in the universe
// has, not the wall clock. The nightly job runs at 8PM Eastern, which is already
// tomorrow in UTC, so dating these rows by the server's own date would file every
// automated run one day ahead of the bars it was computed from. Falls back to the
// UTC date only when no row carries a bar date at all.
function marketDay(rows) {
  const latest = (rows || []).reduce((m, x) => (x.latestDate && x.latestDate > m ? x.latestDate : m), '');
  return latest || new Date().toISOString().slice(0, 10);
}

// Everything that happens after a live, non-as-of recompute: cache it, record
// the day's fundamentals, move the shared flag on, and report when the run ends.
// Shared by the admin's ?refresh=1 and the cron route so the two cannot drift.
// `ctx` carries what an ordinary Refresh has no refresh_state row to hold: when
// the request started, and who asked for it. Absent, no plain-refresh report is
// sent — which is what keeps the nightly job's rounds quiet.
async function finishLiveRefresh(payload, ctx = {}) {
  await writeSnapshot({ ...payload, snapshotAt: payload.updatedAt });
  const rows = payload.stocks || [];
  const loaded = rows.filter((x) => x.profileFetchedAt != null).length;

  // Headlines ride along: the stalest few symbols get their news topped up
  // on every refresh, so coverage accrues without a schedule of its own.
  store.pruneActivity(ACTIVITY_KEEP_DAYS).catch(() => { /* the bars rule */ });
  store.pruneRuns().catch(() => { /* the bars rule */ });

  // Snapshot the day's fundamentals — but only during a Refresh all, which is
  // when the profile cache has actually been re-pulled. An ordinary price
  // Refresh reuses day-old cached profiles, so writing then would record the
  // same numbers under a new date and invent movement that never happened.
  // readRefreshState() is non-null only while a Refresh all runs.
  const running = await readRefreshState();
  // Read after the run state so the news batch can name the refresh run it
  // rode on — a plain Refresh passes its own run id in ctx.
  topUpNews(rows, {
    refreshRunId: (running && running.runId) || ctx.runId || null,
    actor: (running && running.actor) || ctx.actor || null,
  });
  if (running) {
    try {
      // Rows whose profile has not come back yet are skipped rather than
      // stored empty; a later round in the same run upserts over them.
      const withProfile = rows.filter((x) => !x.error && x.profileFetchedAt != null);
      const n = await store.writeFundamentals(marketDay(rows), withProfile);
      if (n) console.log(`fundamentals: ${n} symbols recorded for ${marketDay(rows)}`);
    } catch (err) {
      // A history write must never fail a refresh — same rule as the bars.
      console.warn('fundamentals: history write failed (screener unaffected):', err.message);
    }
  }

  // Full profile coverage is what finishing means for a Refresh all, and only
  // for a Refresh all. An ordinary Refresh never touches a profile, so it is
  // complete the moment it returns — tying its report to coverage meant that one
  // abandoned Refresh all silently suppressed every plain-refresh email until
  // somebody noticed the missing mail.
  const covered = rows.length > 0 && loaded >= rows.length;

  if (running) {
    if (covered) {
      const cleared = await endRefresh();
      if (cleared) {
        await closeRun(cleared, 'complete', { loaded, total: rows.length });
        await sendRefreshReport(cleared, 'all');
      }
    } else {
      await noteRefreshProgress(loaded, rows.length);
    }
  } else if (ctx.startedAt) {
    // endRefresh() here is housekeeping: it clears a row left behind by a run
    // that was abandoned and has since aged out, so the next Refresh all starts
    // from a clean flag. It returns the stale run, which is deliberately not
    // reported — a run nobody finished has nothing to say.
    const stale = await endRefresh();
    if (stale) await closeRun(stale, 'abandoned');
    await sendRefreshReport({ startedAt: ctx.startedAt, actor: ctx.actor, runId: ctx.runId }, 'plain');
  }
  return { loaded, total: rows.length, done: running ? covered : true };
}

// The horizons the Past Momentum column offers. Fixed rather than free-form, so
// every one is precomputed at refresh and switching between them is instant —
// the alternative is a round trip and a fresh scoring pass on every change of a
// dropdown, which is a lot of machinery for five useful answers.
//
// `move` is how far the median name's score actually travels over that horizon,
// measured across the live universe. A fixed threshold cannot work here: five
// points is half the table at a fortnight and nearly all of it at three months,
// so the arrow and the Delta column scale their deadband with the horizon.
// Enough calendar days for the trend ribbon's year: 252 sessions of output
// plus the 200 its moving average needs is about 640 calendar days. This used
// to be sized for momentum's run-up as well, and came out at the same number.
const TREND_WINDOW_DAYS = 650;

// The bar window the trend timeline is built from. One read for the universe,
// the same shape the momentum pass used to make before it was retired.
async function trendBars(symbols) {
  const since = new Date(Date.now() - TREND_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  return store.readBarsFor(symbols, since);
}

// The nightly job's one endpoint. It drives exactly the loop the browser drives
// — start once, then a round per call — because that loop is the one proven
// against the rate limits, and no serverless function can hold the twelve
// minutes it takes.
// How this live pass sources prices and how many profiles it may pull.
// One Refresh All pulls prices ONCE (its first round archives them and
// stamps prices_at); every later round reads the archive and spends the
// whole minute on profiles — 7 x 80 = 560 of the 610. A pass that fetches
// prices sizes its profile batch so prices + profiles fit the same minute.
async function liveRefreshOpts() {
  const running = await readRefreshState();
  const archivePrices = !!(running && running.pricesAt);
  const universe = getUniverse(await readPortfolios());
  const n = universe.length + 1;   // + SPY
  // Fill missing prices ONLY the stocks with no bars at all, in its first
  // round; everything else comes off the archive. notePriceRound then stamps
  // prices_at, so every later round is an archive round.
  if (running && running.mode === 'missing' && !archivePrices && !ANALYST_ENABLED) {
    const dates = await store.barsMaxDates();
    const slice = universe.filter((s) => !dates.has(s)).slice(0, CREDITS_PER_MINUTE - 1);
    return {
      archivePrices: false,
      profileCap: Math.max(0, Math.min(PROFILE_CAP_ARCHIVE_ROUND,
        Math.floor((CREDITS_PER_MINUTE - slice.length - 1) / CREDITS_PER_PROFILE))),
      running,
      priceSlice: slice,
      pricedAfter: universe.length,
      priceTotal: universe.length,
    };
  }
  if (archivePrices || ANALYST_ENABLED) {
    return {
      archivePrices,
      profileCap: ANALYST_ENABLED ? MAX_PROFILE_FETCHES_PER_CALL : PROFILE_CAP_ARCHIVE_ROUND,
      running,
    };
  }

  // A PRICE round. Prices are 1 credit a symbol, so the whole universe stopped
  // fitting inside one minute at 530 symbols — and the failure was not graceful:
  // the round was refused outright and a Refresh All could never get past its
  // first one. The pull is paced instead. `priced` says how far the run got;
  // this round takes the next slice, anything outside it comes from the archive
  // (yesterday's close, replaced when its own slice comes round), and only the
  // round that reaches the end stamps prices_at.
  const done = (running && running.priced) || 0;
  const left = Math.max(0, universe.length - done);
  // SPY is fetched live on every round, priced or archived, so it is always
  // one credit off the top.
  const priceBudget = CREDITS_PER_MINUTE - 1;
  const priceCap = Math.min(left || universe.length, priceBudget);
  const slice = universe.slice(done, done + priceCap);
  const spent = slice.length + 1;
  const profileCap = Math.max(0, Math.min(PROFILE_CAP_ARCHIVE_ROUND,
    Math.floor((CREDITS_PER_MINUTE - spent) / CREDITS_PER_PROFILE)));
  return {
    archivePrices,
    profileCap,
    running,
    // null means "price everything", which is what a plain Refresh outside a
    // run wants and what a universe under the ceiling gets anyway.
    priceSlice: slice.length === universe.length ? null : slice,
    pricedAfter: done + slice.length,
    priceTotal: universe.length,
  };
}

// A price round just finished. Move the run's marker on, and only stamp
// prices_at — which flips every later round to the archive — once the last
// symbol has actually been priced. Both callers go through here so the two
// cannot drift apart, the same rule finishLiveRefresh follows.
async function notePriceRound(opts) {
  if (!opts || !opts.running || opts.archivePrices) return;
  if (opts.priceSlice) {
    await store.markPriced(opts.pricedAfter);
    if (opts.pricedAfter >= opts.priceTotal) await store.markRefreshPrices();
    return;
  }
  await store.markRefreshPrices();
}

// ---- refresh run tracking --------------------------------------------------
// Tracking is a by-product, like the bar archive: a failed write is logged and
// swallowed, and never fails the refresh it describes.
async function trackSafe(p) {
  try { return await p; } catch (err) {
    console.warn('runs: tracking write failed (refresh unaffected):', err.message);
    return null;
  }
}

async function recordRound(runId, opts, m, ms, extra = {}) {
  if (!runId) return;
  const priceSource = opts.archivePrices ? 'archive' : opts.priceSlice ? 'slice' : 'live';
  const pricedLive = opts.archivePrices ? 0 : opts.priceSlice ? opts.priceSlice.length : (extra.rows || 0);
  await trackSafe(store.noteRound(runId, {
    ms, credits: m.credits, profiles: m.profiles, profileFails: m.profileFails,
    priceSource, pricedLive, loaded: extra.loaded, total: extra.total,
    error: extra.error, refused: extra.refused,
  }));
}

// A live run just ended — naturally, by giving up, or by Stop.
async function closeRun(state, status, extra = {}) {
  if (!state || !state.runId) return;
  await trackSafe(store.finishRun(state.runId, {
    status, loaded: extra.loaded ?? state.loaded, total: extra.total ?? state.total,
  }));
}

// The day a moment belongs to, in New York — the nightly job's clock.
function nyDay(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}
function nyHour(ms) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
    hour: 'numeric', hourCycle: 'h23' }).format(new Date(ms)));
}
const NIGHTLY_KINDS = new Set(['nightly', 'nightly-full']);

// One verdict per New York day for the nightly job: ok, running, missed,
// pending (today, before 5 PM), untracked (before recording began), or the
// run's own status (incomplete, failed, abandoned, stopped).
function nightVerdicts(runs, days = 14, now = Date.now()) {
  const firstTracked = runs.reduce((mn, x) => Math.min(mn, x.startedAt), Infinity);
  const firstDay = Number.isFinite(firstTracked) ? nyDay(firstTracked) : null;
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = nyDay(now - i * 86400000);
    const night = runs.filter((x) => NIGHTLY_KINDS.has(x.kind) && nyDay(x.startedAt) === day)
      .sort((a, b) => b.startedAt - a.startedAt)[0] || null;
    let verdict;
    if (night) verdict = night.status === 'complete' ? 'ok' : night.status;
    else if (i === 0 && nyHour(now) < 17) verdict = 'pending';
    else if (!firstDay || day < firstDay) verdict = 'untracked';
    else verdict = 'missed';
    out.push({ day, verdict, runId: night ? night.id : null });
  }
  return out;
}

// The counts behind /database. Cached five minutes per instance: every open
// is an exact count(*) of every table, which Turso meters as rows read
// (~382k at the time of writing, nearly all of it the bar archive), so a few
// reloads should not each pay for it. ?fresh=1 counts again.
let dbStatsCache = null;
app.get('/api/db-stats', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const fresh = req.query.fresh === '1';
  if (!fresh && dbStatsCache && Date.now() - dbStatsCache.countedAt < 5 * 60 * 1000) {
    return res.json({ ...dbStatsCache, cached: true });
  }
  dbStatsCache = await store.tableStats();
  res.json({ ...dbStatsCache, cached: false });
}));

// The news job's log and the archive's current state.
app.get('/api/news-runs', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 30));
  const now = Date.now();
  const [runs, state, holdings, portfolios] = await Promise.all([
    store.readNewsRuns(now - days * 86400000), store.readNewsState(), store.newsHoldings(), readPortfolios(),
  ]);
  const universe = getUniverse(portfolios);
  const fetched = { day: 0, week: 0, older: 0, never: 0 };
  let stalest = null;
  for (const s of universe) {
    const t = state[s];
    if (!t) { fetched.never++; continue; }
    const d = (now - t) / 86400000;
    if (d < 1) fetched.day++; else if (d < 7) fetched.week++; else fetched.older++;
    if (!stalest || t < stalest.at) stalest = { symbol: s, at: t };
  }
  const emptyFeeds = universe.filter((s) => state[s] && !holdings.perSymbol[s]);
  res.json({
    runs, now,
    health: {
      off: NEWS_OFF, provider: NEWS_PROVIDER_NAME, perRefresh: NEWS_TOPUP_PER_REFRESH,
      ttlHours: NEWS_TTL_MS / 3600000, keepDays: News.KEEP_DAYS, maxPerSymbol: News.MAX_PER_SYMBOL,
      universe: universe.length, fetched, stalest,
      headlines: holdings.headlines, symbolsWithNews: holdings.perSymbol ? Object.keys(holdings.perSymbol).filter((s) => universe.includes(s)).length : 0,
      newestPublished: holdings.newestPublished, emptyFeeds,
    },
  });
}));

app.get('/api/news-runs/:id', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const run = await store.readNewsRun(Number(req.params.id) || 0);
  if (!run) return res.status(404).json({ error: 'No such news run.' });
  res.json(run);
}));

app.get('/api/refresh-runs', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 90));
  const runs = await store.readRuns(Date.now() - days * 86400000);
  const state = await readRefreshState();
  const live = state && state.runId ? await store.readRun(state.runId) : null;
  if (live) {
    delete live.reportHtml;
    live.mode = state.mode || null;
    live.pricesAt = state.pricesAt || null;
  }
  res.json({ runs, live, nights: nightVerdicts(runs), now: Date.now() });
}));

// The slower half of the page: how fresh the stored data is right now.
app.get('/api/refresh-runs/health', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const universe = getUniverse(await readPortfolios());
  const profiles = await readProfiles();
  const now = Date.now();
  const ages = { day: 0, three: 0, week: 0, older: 0, none: 0 };
  for (const s of universe) {
    const p = profiles[s];
    if (!p || !p.fetchedAt) { ages.none++; continue; }
    const d = (now - p.fetchedAt) / 86400000;
    if (d < 1) ages.day++; else if (d < 3) ages.three++; else if (d < 7) ages.week++; else ages.older++;
  }
  let stats = { barRows: null, barsThrough: null };
  try { stats = await store.archiveStats(nyDay(now)); } catch { /* shown as unknown */ }
  res.json({
    universe: universe.length,
    ages,
    gaps: profileGaps(universe, profiles).length,
    barsThrough: stats.barsThrough,
    rotationDays: FUND_ROTATION_DAYS,
  });
}));

app.get('/api/refresh-runs/:id', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const run = await store.readRun(Number(req.params.id) || 0);
  if (!run) return res.status(404).json({ error: 'No such run.' });
  res.json(run);
}));

// Stop the live run. The flag is cleared at once, the run is marked stopped
// and reported, and the loop driving it — a browser tab or the nightly job —
// is answered `stopped` on its next round without spending anything.
app.post('/api/refresh-runs/stop', requireAdmin, route(async (req, res) => {
  const cleared = await endRefresh();
  if (!cleared) return res.json({ ok: true, stopped: false });
  await closeRun(cleared, 'stopped');
  logAct(req, 'refresh', 'stop');
  const reported = await sendRefreshReport(cleared, 'all');
  res.json({ ok: true, stopped: true, runId: cleared.runId || null, reported });
}));

// The missed-night alarm. Called once a day by a Vercel cron (vercel.json),
// deliberately NOT by GitHub: the failure it exists to catch is GitHub's
// scheduler not firing at all, and a watchdog on the same scheduler would
// miss the same night. Mails only when something is wrong; ?dry=1 reports the
// verdict without mailing.
app.get('/api/cron/watchdog', route(async (req, res) => {
  if (!isCron(req)) return res.status(401).json({ error: 'Bad or missing cron secret.' });
  const now = Date.now();
  const runs = await store.readRuns(now - 3 * 86400000);
  const today = nightVerdicts(runs, 1, now)[0];
  const bad = !['ok', 'running', 'pending', 'untracked'].includes(today.verdict);
  let mailed = false;
  if (bad && req.query.dry !== '1' && MAIL_READY) {
    const to = await operatorEmail();
    if (to) {
      const words = {
        missed: 'did not run', incomplete: 'stopped short', failed: 'failed',
        abandoned: 'was abandoned partway', stopped: 'was stopped',
      };
      const what = words[today.verdict] || today.verdict;
      const heading = `Nightly refresh ${what}`;
      const intro = today.verdict === 'missed'
        ? `No nightly refresh started on ${today.day} (New York). GitHub's scheduler sometimes skips a run; ` +
          'the data on the site is from the previous refresh.'
        : `The nightly refresh on ${today.day} (New York) ${what}. Some data may not have been updated.`;
      const link = APP_URL ? `${APP_URL}/refreshes` : '';
      const html = emailShell({
        heading, intro,
        body: '<p style="margin:0 0 14px;font-size:14px;line-height:1.6">Open the refresh runs page to see ' +
          'what happened, then run Fill missing or Refresh all from the admin console if needed.</p>' +
          (link ? mailButton(link, 'Open refresh runs') : ''),
        note: 'Sent by the daily check that watches the nightly job.',
      });
      const text = textShell({ heading, intro, lines: link ? [link] : [],
        note: 'Sent by the daily check that watches the nightly job.' });
      mailed = await sendMail({ to, subject: `[Tickr Lab] ${heading} — ${today.day}`, text, html });
    }
  }
  console.log(`watchdog: ${today.day} ${today.verdict}${mailed ? ' — alert mailed' : ''}`);
  res.json({ ok: true, ...today, alert: bad, mailed });
}));

app.post('/api/cron/refresh', route(async (req, res) => {
  if (!isCron(req)) return res.status(401).json({ error: 'Bad or missing cron secret.' });
  if (!API_KEY) return res.status(500).json({ error: 'No API key configured.' });

  let cronRunId = null;
  const starting = req.query.start === '1' || req.body?.start === true;
  const askedRun = Number(req.body?.runId) || null;
  if (!starting && askedRun && (await trackSafe(store.runStatus(askedRun))) === 'stopped') {
    // Stopped from /refreshes: tell the job it is done, and spend nothing.
    return res.json({ ok: true, done: true, stopped: true, runId: askedRun });
  }
  if (starting) {
    const total = getUniverse(await readPortfolios()).length;
    // ?full=1 forces the old behaviour — every profile re-pulled tonight. The
    // default rotates: the oldest slice is expired so it comes up for renewal,
    // and the TTL leaves the rest alone. After the first week the fetched_at
    // values have fanned out and the rotation keeps itself spread.
    const full = req.query.full === '1' || req.body?.full === true;
    // Gaps go first on a rotation night: a new ticker or a new field fills the
    // next night instead of waiting its turn. expireOldestProfiles() only picks
    // among fetched_at > 0, so these are not counted against the rotation.
    let gapped = 0;
    if (!full) {
      const universe = getUniverse(await readPortfolios());
      const gaps = profileGaps(universe, await readProfiles());
      gapped = await store.expireProfilesFor(gaps.filter((g) => g.hasRow).map((g) => g.symbol));
      if (gaps.length) console.log(`cron: ${gaps.length} stocks with missing company data queued first`);
    }
    const expired = gapped + (full
      ? await expireProfiles()
      : await store.expireOldestProfiles(Math.ceil(total / FUND_ROTATION_DAYS)));
    const actor = String(req.body?.actor || 'nightly job').slice(0, 80);
    // workflow_dispatch is a person pressing Run; the two crons are the schedule.
    const trigger = req.body?.trigger === 'manual' ? 'manual' : 'scheduled';
    const runUrl = String(req.body?.runUrl || '');
    cronRunId = await trackSafe(store.startRun({ kind: full ? 'nightly-full' : 'nightly', trigger, actor,
      total, targets: expired, link: /^https:\/\/github\.com\//.test(runUrl) ? runUrl.slice(0, 300) : null }));
    await beginRefresh(actor, total, null, cronRunId);
    console.log(`cron: refresh all started — ${expired} profiles expired ` +
      `(${full ? 'full sweep' : `1/${FUND_ROTATION_DAYS} rotation`}), ${total} symbols`);
  }

  const opts = await liveRefreshOpts();
  const runId = cronRunId || (opts.running && opts.running.runId) || askedRun;
  const { r, m, ms } = await metered(() => computeStocks(null, opts));
  if (!r.ok) {
    await recordRound(runId, opts, m, ms, { error: r.error, refused: r.status === 429 });
    return res.status(r.status).json({ error: r.error, runId });
  }
  await notePriceRound(opts);
  const fin = await finishLiveRefresh(r.payload);
  await recordRound(runId, opts, m, ms, { loaded: fin.loaded, total: fin.total, rows: r.payload.stocks.length });
  res.json({ ok: true, runId, ...fin });
}));

// Lets the job clean up after itself when it gives up, and report what it got.
// Same idempotency as everywhere else: only the caller that clears the flag mails.
app.delete('/api/cron/refresh', route(async (req, res) => {
  if (!isCron(req)) return res.status(401).json({ error: 'Bad or missing cron secret.' });
  const cleared = await endRefresh();
  if (cleared) await closeRun(cleared, 'incomplete');
  res.json({ ok: true, reported: await sendRefreshReport(cleared) });
}));

// Snapshot: the public sees the last computed data (no live API calls). Admin
// refreshes recompute live and overwrite it.
app.get('/api/stocks', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store'); // never let the browser serve a stale copy

  // ?asOf=YYYY-MM-DD recomputes momentum as it looked on that date and reports the
  // returns since — a forward-returns view, not a backtest. The real one is /strategy.
  const asOfRaw = String(req.query.asOf || '').trim();
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) ? asOfRaw : null;
  // A live pull (recompute from the API) happens for an as-of date or an explicit
  // ?refresh=1 (the admin Refresh / Refresh All). Everything else serves the snapshot.
  const wantLive = !!asOf || req.query.refresh === '1';

  if (wantLive) {
    if (!(await isAdmin(req))) {
      return res.status(403).json({ error: 'Admin only — log in to refresh or rewind the table.' });
    }
    const startedAt = Date.now();
    const opts = asOf ? {} : await liveRefreshOpts();
    // A running Refresh All logs once at its POST; its rounds pass through
    // here too and would be a dozen rows of noise for one action.
    if (asOf) logAct(req, 'refresh', 'as-of:' + asOf);
    else if (!opts.running) logAct(req, 'refresh', 'plain');
    if (asOf) {
      const r = await computeStocks(asOf, opts);
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      return res.json({ ...r.payload, refreshing: await readRefreshState() });
    }

    // Which run this round belongs to. The loop passes its run id: a run
    // stopped from /refreshes answers `stopped` here and costs nothing, and
    // a round whose flag aged out still lands on the run that started it. No
    // run at all means a plain Refresh, which is a run of one round.
    const who = await currentUser(req);
    const actor = who ? who.email : 'admin (legacy login)';
    const asked = Number(req.query.run) || null;
    if (asked && (await trackSafe(store.runStatus(asked))) === 'stopped') {
      return res.json({ stopped: true, runId: asked, refreshing: await readRefreshState() });
    }
    let runId = (opts.running && opts.running.runId) || asked;
    const plainRun = !runId && !opts.running;
    if (plainRun) {
      const total = getUniverse(await readPortfolios()).length;
      runId = await trackSafe(store.startRun({ kind: 'refresh', trigger: 'manual', actor, total, targets: total }));
    }
    const { r, m, ms } = await metered(() => computeStocks(null, opts));
    if (!r.ok) {
      await recordRound(runId, opts, m, ms, { error: r.error, refused: r.status === 429 });
      if (plainRun) await trackSafe(store.finishRun(runId, { status: 'failed', error: r.error }));
      return res.status(r.status).json({ error: r.error });
    }
    await notePriceRound(opts);
    // Cache the live pull, record today's fundamentals, and move the shared
    // refresh flag on — the same tail the nightly job runs, so the two callers
    // cannot drift apart.
    const fin = await finishLiveRefresh(r.payload, { startedAt, actor, runId: plainRun ? runId : null });
    await recordRound(runId, opts, m, ms, { loaded: fin.loaded, total: fin.total, rows: r.payload.stocks.length });
    if (plainRun) await trackSafe(store.finishRun(runId, { status: 'complete', loaded: fin.loaded, total: fin.total }));
    return res.json({ ...r.payload, runId, refreshing: await readRefreshState() });
  }

  // Public read: serve the saved snapshot — no API calls, no credits burned.
  const snap = await readSnapshot();
  if (snap) {
    // Scored on the way out, not only when the snapshot is written: ~1ms for
    // the whole universe, and it means a snapshot written before this feature
    // existed still carries the column, and a house-profile edit shows up on
    // the next load rather than after the nightly refresh.
    scoreActionInto(snap.stocks);
    // Display names are stamped on the way out for the same reason the Advice
    // columns are: they derive from data we already hold, so a snapshot
    // written before the field existed still carries it, and an override
    // typed a moment ago shows without waiting for a refresh.
    await stampShortNames(snap.stocks);
    if (await isGuest(req)) {
      // The guest preview: the picked handful, and only portfolio names that
      // still contain one of them. Filtered here, never in the browser.
      const stocks = snap.stocks.filter((x) => guestSet.has(String(x.symbol).toUpperCase()));
      const names = new Set();
      for (const x of stocks) for (const pn of (x.portfolios || [])) names.add(pn);
      return res.json({ ...snap, stocks,
        portfolios: (snap.portfolios || []).filter((pn) => names.has(pn)),
        fromSnapshot: true, guest: true, refreshing: null });
    }
    return res.json({ ...snap, fromSnapshot: true, refreshing: await readRefreshState() });
  }

  // No snapshot yet: an admin (or open/local mode) computes and seeds the first one.
  if (await isAdmin(req)) {
    const r = await computeStocks(null);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    await writeSnapshot({ ...r.payload, snapshotAt: r.payload.updatedAt });
    return res.json(r.payload);
  }
  return res.json({ stocks: [], portfolios: Object.keys(await readPortfolios()), asOf: null, updatedAt: null, fromSnapshot: true, empty: true });
}));

// The activity log's own three routes, beside the visitor log they mirror.
app.get('/api/activity', requireAdmin, route(async (req, res) => {
  res.json(await store.readActivityStats(500));
}));

// Wipe it. Irreversible — the client confirms with the count first.
app.delete('/api/activity', requireAdmin, route(async (req, res) => {
  const removed = await store.clearActivity();
  res.json({ ok: true, removed });
}));

// The client half: batched UI facts (sorts, picker changes, chart toggles)
// the server never sees, delivered by sendBeacon from track.js. Kinds are
// allowlisted and details clamped, so this cannot become free-form storage;
// guests are welcome — a guest's walk is the most valuable trace the log
// produces. requireAuth already admits the guest cookie.
const CLIENT_ACT_KINDS = new Set(['sort', 'tab', 'picker', 'panel', 'chart']);
app.post('/api/activity', requireAuth, route(async (req, res) => {
  const events = Array.isArray(req.body && req.body.events) ? req.body.events.slice(0, 50) : [];
  const user = await actKey(req);
  const ts = new Date().toISOString();
  const rows = [];
  for (const e of events) {
    const kind = String((e && e.k) || '');
    if (!CLIENT_ACT_KINDS.has(kind)) continue;
    const detail = String((e && e.d) || '').replace(/[^\x20-\x7e]/g, '').slice(0, 80);
    rows.push({ ts, user, kind, detail: detail || null, ip: req.ip || null });
  }
  if (rows.length) store.logActivity(rows).catch(() => { /* fire and forget */ });
  res.json({ ok: true, accepted: rows.length });
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

// ALWAYS listen. This was briefly guarded by `require.main === module` so a
// script could require the file for its mail helpers, and it took the site down:
// package.json sets "main": "server.js", so Vercel imports this module rather
// than running it as the entry point, `require.main` is its own wrapper, and
// nothing ever bound a port — every request came back
// FUNCTION_INVOCATION_FAILED. Do not reintroduce that guard. Anything that wants
// these helpers without a server should import them from their own module.
app.listen(PORT, () => {
  console.log(`Stock screener POC running at http://localhost:${PORT}`);
  if (!API_KEY) {
    console.warn('WARNING: TWELVE_DATA_API_KEY is not set — /api/stocks will return an error until you add it to .env');
  }
});
