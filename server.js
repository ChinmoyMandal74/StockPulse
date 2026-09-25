// Stock screener — POC backend
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
// The benchmark. Module scope because two features read it now: the refresh
// (which fetches it live, since it is deliberately never archived) and the
// backtest's S&P comparison.
const BENCHMARK = 'SPY';
// The index-tracking ETFs. They are ordinary universe rows — a stranger can
// chart them and the stock page overlays them — but they are EXCLUDED from
// every "your universe, equal weight" line, because a comparison against a
// universe containing the thing you are comparing to is circular. Four rows in
// 431 is under a percent, so this is about the claim rather than the number.
const BENCHMARKS = new Set(['SPY', 'QQQ', 'IWM', 'DIA']);
const notBenchmark = (sym) => !BENCHMARKS.has(sym);
// Persistence lives in Turso (libSQL). The accessors below keep the shapes the
// old flat-file helpers returned, so this file only had to gain `await`s.
// See db.js and migrate-to-turso.js.
const store = require('./db');
// The analysis screens, shared with public/analysis.html so the nightly report
// and the page can never disagree about what "bouncing off the lows" means.
// Loaded here so the SERVER can run a screen and render a row the way the
// browser would: the mobile page gets the twenty matching rows, formatted,
// instead of the 1.3MB table. Both are the same modules the pages load.
const Filters = require('./private/filters.js');
require('./private/rowcard.js');
const RowCard = globalThis.RowCard;
// The promo cards, so a saved post can be built here and a phone handed
// finished markup rather than the whole snapshot.
require('./private/cards.js');
const Cards = globalThis.Cards;
// file so the workbook served here and the one written locally are one thing.
// history and the live score can never drift into two different models.
const BarMath = require('./barmath.js');
const TechRow = require('./techrow.js');
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

// THE SNAPSHOT IS ONE ROW AND 3.56MB OF IT, and /api/stock reads the whole
// thing to answer with 65KB about one company — measured at a stable ~1.9s
// warm, and 14.56s on a cold instance, with the stock page's chart not drawn
// until 16.3s because /api/history cannot start until this returns. It was
// 1.3MB at 271 stocks; at the 1,000 the universe is heading for it is ~4.6MB,
// so this gets worse on its own.
//
// Cached per INSTANCE for a few seconds — deliberately at the call site rather
// than inside store.readSnapshot(), which the refresh path uses and which must
// never hand anyone a stale copy of a blob it is in the middle of rewriting.
//
// THE COST, STATED: an edited short name, or a refresh that has just landed,
// can take up to the TTL to show on a page served by an instance that already
// has a copy. Twenty seconds is chosen to be shorter than anyone's patience
// for a page they are reading, and the instance that WRITES a snapshot drops
// its own copy at once, so the tab that ran the refresh never sees stale data.
// Other instances hold theirs for the TTL; nothing is shared between them.
const SNAP_TTL_MS = Math.max(0, Number(process.env.SNAP_CACHE_MS) || 20000);
let snapCache = { at: 0, snap: null };
async function snapshotCached() {
  if (snapCache.snap && Date.now() - snapCache.at < SNAP_TTL_MS) return snapCache.snap;
  const snap = await readSnapshot();
  snapCache = { at: Date.now(), snap };
  return snap;
}
function dropSnapshotCache() { snapCache = { at: 0, snap: null }; }
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
// A cold profile fetch hits several endpoints — /profile, /statistics, /earnings,
// and /earnings. Costs are not
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
// How many quarters to ask /earnings for. Its cost is flat at 20 credits
// whatever this says, so asking for 8 (as we did until 2026-09-18) simply
// threw away eighteen quarters of surprise history that the PEAD study
// needs and that nothing else can reconstruct.
const EARNINGS_QUARTERS = 40;
const MAX_PROFILE_FETCHES_PER_CALL = 6;
const PROFILE_CAP_ARCHIVE_ROUND = 7;   // 7 x 80 = 560 <= 610
const CREDITS_PER_MINUTE = 610;
const CREDITS_PER_PROFILE = 80;
// How many symbols one round may price LIVE. The credit ceiling already caps a
// round at 609, and that was the only cap until 2026-09-22 — but credits bound
// what a round may SPEND, not how long it takes, and the platform kills a
// function at 300s. At 767 stocks a 609-symbol round measured 170s on a good
// day and 423s on a bad one (run 63), so the plain Refresh had started losing
// more often than it won: two 504s in a row, reproduced.
//
// 500 is chosen from the phases of a good run — `prices 45.9s` and
// `persist-bars 65.2s` scale with the slice while the other ~62s does not, so
// pricing 500 instead of 609 takes a round to ~155s, about half the ceiling.
// It also bounds the round at the owner's stated 1,000-stock ceiling: 500 is
// two rounds there, and the loop simply takes a third if it is ever exceeded.
const PRICE_SLICE = Math.max(1, Number(process.env.PRICE_SLICE) || 500);
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
// ONE ROUTE MAY SEND MORE THAN 100kb, and it has to be mounted ahead of the
// global parser rather than on the route itself: `express.json()` below runs
// first for every request, so a picture would be rejected with an HTML error
// page long before reaching a handler with a larger limit of its own. Parsing
// is idempotent — the second parser sees `req._body` and stands aside — so this
// raises the ceiling for blog image uploads and nothing else. Base64 costs a
// third on top of the 2MB the route itself allows.
app.use('/api/admin/posts/image', express.json({ limit: '4mb' }));
app.use(express.json());

// When this request arrived, so `logAct` can say how long the operation took.
// FIRST middleware, or the number measures less than the request: it has to be
// set before anything else gets a chance to spend time. Nothing else reads it,
// and a request that never logs pays one Date.now().
app.use((req, _res, next) => { req._t0 = Date.now(); next(); });

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
  // The door: the screener is only served to signed-in users. A stranger gets
  // the marketing page rather than a login form (2026-09-16) — the form asks
  // for a password before saying what the site is.
  if (!(await isSignedIn(req))) {
    store.logVisit({
      ts: new Date().toISOString(), ip: req.ip || null,
      ua: req.headers['user-agent'] || null,
      ref: req.headers['referer'] || req.headers['referrer'] || null,
      userEmail: null,
    }).catch(() => { /* a logging failure must never block the page */ });
    return res.sendFile(path.join(__dirname, 'private', 'landing.html'));
  }
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

// /analysis was retired on 2026-09-15: its seven screens are starter screens
// on the screener now. The address sends people there rather than to a 404.
app.get('/analysis', (req, res) => res.redirect('/'));

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
// /theme/<name> is the address now; /portfolio/<name> keeps working because
// links to it have already been shared. Same handler, one canonical URL — the
// GATED_PAGES funnel's rule.
app.get(['/theme/:name', '/portfolio/:name'], route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  if (await isGuest(req)) return res.redirect('/');
  logAct(req, 'page', 'basket:' + String(req.params.name || '').slice(0, 30));
  res.sendFile(path.join(__dirname, 'private', 'basket.html'));
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

// The two numbers the landing page claims, from the product itself. Public and
// deliberately CHEAP — the universe is 271 rows and the snapshot's timestamp is
// its own column, so this costs nothing like the row counts on /database.
// Cached ten minutes per instance.
let publicStatsCache = null;
app.get('/api/public-stats', route(async (req, res) => {
  if (publicStatsCache && Date.now() - publicStatsCache.at < 10 * 60 * 1000) {
    return res.json(publicStatsCache.body);
  }
  try {
    const [universe, updatedAt] = await Promise.all([readUniverse(), store.snapshotUpdatedAt()]);
    const body = { symbols: universe.length, updatedAt: updatedAt || null };
    publicStatsCache = { at: Date.now(), body };
    res.json(body);
  } catch (err) {
    res.json({});   // the page ships with sensible numbers already
  }
}));

// Every figure the /about page prints, so none of them is typed into its prose.
// The universe grows and the archive deepens between deploys, and a stale claim
// on a public page is worse than no claim at all.
//
// EVERY query here is cheap or bounded, because this is public and uncached
// traffic would otherwise meter rows. `select count(*) from bars` reads 1.08M
// rows — the shape that produced the Turso quota warning — and `min(d)` over
// the whole table is the same scan, since the primary key is (symbol, d) and
// cannot seek on a date alone. So the archive is measured by SPAN, two indexed
// seeks per symbol (~850 rows for the whole universe), and the session count
// that follows is an ESTIMATE the page labels as one. The other three tables
// are bounded by the universe times a small constant.
//
// One refresh an hour per instance whatever the traffic, so a crawler costs
// the same as a single reader.
let aboutStatsCache = null;
const ABOUT_TTL_MS = 60 * 60 * 1000;
const SESSIONS_PER_DAY = 0.69;      // trading days per calendar day, the /quality page's ratio
const DEEP_SPAN_DAYS = 1826;        // five years, the 5Y column's requirement

app.get('/api/about-stats', route(async (req, res) => {
  if (!req.query.fresh && aboutStatsCache && Date.now() - aboutStatsCache.at < ABOUT_TTL_MS) {
    return res.json({ ...aboutStatsCache.body, cached: true });
  }
  try {
    const universe = await readUniverse();
    const [updatedAt, spans, roll, screens, portfolios] = await Promise.all([
      store.snapshotUpdatedAt(),
      store.barsSpan(universe),
      store.coverageRollups(),
      store.readScreens(),
      readPortfolios(),
    ]);

    const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
    let earliest = null, latest = null, sessions = 0, deep = 0;
    const held = Object.values(spans);
    for (const s of held) {
      if (!earliest || s.first < earliest) earliest = s.first;
      if (!latest || s.last > latest) latest = s.last;
      const span = days(s.first, s.last);
      sessions += Math.round(span * SESSIONS_PER_DAY);
      if (span >= DEEP_SPAN_DAYS) deep++;
    }
    // Starter screens are seeded lazily by the first GET /api/screens, so a
    // cold database has none stored yet and the page would claim zero. The
    // honest figure is how many a reader would GET, which before seeding is the
    // starter list itself — and reading it here avoids a public route causing a
    // write, which seeding from here would.
    const screenCount = (screens || []).length || STARTER_SCREENS.length;
    const sum = (m) => Object.values(m).reduce((a, x) => a + x.n, 0);
    const firstOf = (m) => Object.values(m).reduce((a, x) => (!a || x.first < a ? x.first : a), null);
    // fundamentals_history holds one row per symbol per day a Refresh all ran,
    // so the busiest symbol's row count IS the number of recorded days.
    const recordedDays = Object.values(roll.fund).reduce((a, x) => Math.max(a, x.n), 0);

    const body = {
      symbols: universe.length,
      portfolios: Object.keys(portfolios || {}).length,
      columns: columnCatalogue().length,
      screens: screenCount,
      updatedAt: updatedAt || null,
      bars: { symbols: held.length, earliest, latest, sessions, deep },
      fundamentals: { symbols: Object.keys(roll.fund).length, days: recordedDays, since: firstOf(roll.fund) },
      earnings: { symbols: Object.keys(roll.earn).length, quarters: sum(roll.earn), since: firstOf(roll.earn) },
      news: { symbols: Object.keys(roll.news).length, items: sum(roll.news) },
      builtAt: Date.now(),
    };
    aboutStatsCache = { at: Date.now(), body };
    res.json(body);
  } catch (err) {
    console.error('about-stats failed:', err.message);
    res.json({});   // the page renders without numbers rather than not at all
  }
}));

app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, 'private', 'about.html'));
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
                      '/backtest.html': '/backtest', '/quality.html': '/quality',
                      '/trend-backtest.html': '/trend-backtest',
                      '/architecture.html': '/architecture', '/themes.html': '/themes',
                      // no symbols in that path, so it opens with both pickers empty
                      '/compare.html': '/compare',
                      '/news-runs.html': '/news-runs', '/columns.html': '/columns',
                      '/export.html': '/export',
                      // The public pages have canonical addresses of their own.
                      '/blog.html': '/blog', '/landing.html': '/', '/post.html': '/blog',
                      '/about.html': '/about',
                      '/posts.html': '/posts',
                      '/mobile.html': '/m', '/mobile-setup.html': '/mobile-setup',
                      '/nasdaq.html': '/nasdaq',
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

// ---- the blog --------------------------------------------------------------
// PUBLIC: the pages and the two read routes below are the only things in this
// app a stranger can see. They serve `status = 'published'` only, and a draft
// is invisible without an admin session — the same rule the screener follows,
// enforced in the route rather than in the page.

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// A small markdown subset, rendered SERVER-SIDE and escape-first — the same
// order chat.html uses, and the reason is the same: a post is written by the
// owner but rendered to the public, so nothing in it may become markup by
// accident. Supported: #/##/### headings, - and 1. lists, > quotes, ```code```,
// **bold**, *italic*, `code`, [text](href) with http(s) and internal links
// only, --- rules, and blank-line paragraphs.
// Our own uploads, or a plain https picture. Anything else keeps its words and
// loses its tag, the rule links already follow — and it stops the blog becoming
// an open proxy for data: and javascript: srcs. ONE definition, because the
// index's thumbnail must never show a src the post itself would have refused.
const safeImgSrc = (src) => /^\/blog\/img\/[a-f0-9]{8,64}$/.test(src) || /^https:\/\//i.test(src);

// The first picture in a post, for the index's thumbnail. Read off the MARKDOWN
// rather than the rendered HTML: the renderer escapes before it formats, so
// scraping its output means matching `&quot;` and unpicking entities to get a
// src back — parsing our own output to recover what the input already said.
const firstImage = (md) => {
  const re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(String(md || '')))) {
    if (safeImgSrc(m[2])) return { src: m[2], alt: m[1] };
  }
  return null;
};

// ONE PARSER, TWO SKINS. The page wants classes and a stylesheet; an email
// wants inline styles on every tag and a table where each figure is, because
// Outlook renders through Word and most clients strip a <style> block. A
// second renderer would drift from this one inside a week — rowcard.js,
// action.js and filters.js all exist for exactly that reason — so the block
// and inline grammar stays here and only the ATTRIBUTES are handed in.
// PAGE_SKIN is every attribute the page emits today, so its output is
// byte-for-byte what it was; there is a test that compares the two.
const PAGE_SKIN = {
  p: '', h2: '', h3: '', h4: '', ul: '', ol: '', li: '',
  blockquote: '', hr: '', pre: '', precode: '', code: '', strong: '', em: '',
  link: (href, text, ext) =>
    `<a href="${href}"${ext ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`,
  fig: (src, alt, size, titleAttr) =>
    `<figure class="pimg${size ? ' ' + size : ''}">`
    + `<img src="${src}" alt="${alt}" loading="lazy"${titleAttr} />`
    + (alt ? `<figcaption>${alt}</figcaption>` : '') + '</figure>',
};

function renderMarkdown(src, skin) {
  const S = skin || PAGE_SKIN;
  const esc = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, (_, c) => `<code${S.code}>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, `<strong${S.strong}>$1</strong>`)
    .replace(/(^|[^*])\*([^*]+)\*/g, `$1<em${S.em}>$2</em>`)
    // SIZE RIDES IN MARKDOWN'S OWN TITLE SLOT -- `![alt](src "small")` -- rather
    // than in an invented grammar or in the alt, which belongs to screen
    // readers. A title that is not one of the known widths stays a real title
    // attribute, so nothing standard is lost by the reuse.
    //
    // The class comes from an ALLOWLIST, never from the text: it is being
    // written into a class attribute, and a caption is author input.
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, alt, src, title) => {
      // Our own uploads, or a plain https picture. Anything else keeps its
      // words and loses its tag, the rule links already follow -- and it stops
      // the blog becoming an open proxy for data: and javascript: srcs.
      if (!safeImgSrc(src)) return alt;
      const t = String(title || '').trim().toLowerCase();
      const size = ['small', 'medium', 'wide'].includes(t) ? t : '';
      const attr = (!size && title) ? ` title="${title}"` : '';
      return S.fig(src, alt, size, attr);
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) =>
      (/^https?:\/\//i.test(href) || /^\//.test(href))
        ? S.link(href, text, /^https?:/i.test(href))
        : text);   // anything else (javascript:, data:) loses its link, keeps its words
  const out = [];
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  let list = null, quote = false, code = false, para = [];
  const closePara = () => { if (para.length) { out.push(`<p${S.p}>${inline(para.join(' '))}</p>`); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closeQuote = () => { if (quote) { out.push('</blockquote>'); quote = false; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^```/.test(line)) {
      closePara(); closeList(); closeQuote();
      out.push(code ? '</code></pre>' : `<pre${S.pre}><code${S.precode}>`);
      code = !code;
      continue;
    }
    if (code) { out.push(esc(raw)); continue; }
    if (!line.trim()) { closePara(); closeList(); closeQuote(); continue; }
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      closePara(); closeList(); closeQuote();
      const n = m[1].length + 1;            // # is an h2: the page owns the h1
      out.push(`<h${n}${S['h' + n] || ''}>${inline(m[2])}</h${n}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) { closePara(); closeList(); closeQuote(); out.push(`<hr${S.hr} />`); continue; }
    // An image ALONE on a line is a block, not a paragraph. `inline()` turns it
    // into a <figure>, and a figure inside a <p> is invalid -- the browser
    // auto-closes the paragraph and leaves an empty one behind, which shows up
    // as a phantom gap above every picture.
    if (/^!\[[^\]]*\]\([^)\s]+(\s+"[^"]*")?\)$/.test(line.trim())) {
      closePara(); closeList(); closeQuote();
      out.push(inline(line.trim()));
      continue;
    }
    if ((m = /^>\s?(.*)$/.exec(line))) {
      closePara(); closeList();
      if (!quote) { out.push(`<blockquote${S.blockquote}>`); quote = true; }
      out.push(`<p${S.p}>${inline(m[1])}</p>`);
      continue;
    }
    if ((m = /^[-*]\s+(.*)$/.exec(line))) {
      closePara(); closeQuote();
      if (list !== 'ul') { closeList(); out.push(`<ul${S.ul}>`); list = 'ul'; }
      out.push(`<li${S.li}>${inline(m[1])}</li>`);
      continue;
    }
    if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) {
      closePara(); closeQuote();
      if (list !== 'ol') { closeList(); out.push(`<ol${S.ol}>`); list = 'ol'; }
      out.push(`<li${S.li}>${inline(m[1])}</li>`);
      continue;
    }
    closeList(); closeQuote();
    para.push(line.trim());
  }
  closePara(); closeList(); closeQuote();
  if (code) out.push('</code></pre>');
  return out.join('\n');
}

// Roughly how long the post takes to read, at 220 words a minute.
const readingMinutes = (body) => Math.max(1, Math.round(String(body || '').split(/\s+/).filter(Boolean).length / 220));

const publicPost = (p) => ({
  slug: p.slug, title: p.title, summary: p.summary, author: p.author,
  publishedAt: p.publishedAt, updatedAt: p.updatedAt,
  minutes: readingMinutes(p.body), html: p.body ? renderMarkdown(p.body) : undefined,
});

// Public: the published list, newest first.
app.get('/api/posts', route(async (req, res) => {
  const posts = await store.readPosts({ publishedOnly: true });
  res.json({ posts: posts.map(publicPost) });
}));

// Public: one published post, rendered.
app.get('/api/posts/:slug', route(async (req, res) => {
  const p = await store.readPost(req.params.slug, { publishedOnly: true });
  if (!p) return res.status(404).json({ error: 'No such post.' });
  res.json({ post: publicPost(p) });
}));

// The public pages. Served by the function rather than from public/, so the
// markup stays in private/ with everything else; nothing here checks a session.
// RENDERED ON THE SERVER, not fetched by the page: a blog that needs
// JavaScript to show its words is a blog search engines and readers-with-a-bad
// connection cannot read. The templates carry %PLACEHOLDERS% which are filled
// here; the pages ship no script at all.
const pageTemplate = (() => {
  const cache = {};
  return (name) => (cache[name] ||= fs.readFileSync(path.join(__dirname, 'private', name), 'utf8'));
})();
const htmlEsc = (t) => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const postDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return String(iso).slice(0, 10); }
};

app.get('/blog', route(async (req, res) => {
  logAct(req, 'page', 'blog');
  // The one caller that wants the bodies — see readPosts. It needs them only to
  // find each post's first picture, which never reaches the browser as markdown.
  const posts = await store.readPosts({ publishedOnly: true, withBody: true });
  const list = posts.length ? posts.map((p) => {
    const bits = [postDate(p.publishedAt), p.author ? htmlEsc(p.author) : '', `${readingMinutes(p.summary || '')} min read`]
      .filter(Boolean);
    const pic = firstImage(p.body);
    // THE THUMBNAIL IS DECORATIVE, so its alt is empty on purpose: the title is
    // the next thing in the same link, and a screen reader announcing the
    // picture's caption first would read the row twice.
    const thumb = pic
      ? `<span class="pthumb"><img src="${htmlEsc(pic.src)}" alt="" loading="lazy" decoding="async" /></span>`
      : '';
    return `<a class="post bezel" href="/blog/${encodeURIComponent(p.slug)}"><div class="core">` +
      '<span class="ptext">' +
      `<span class="meta">${bits.slice(0, 2).join(' · ')}</span>` +
      `<h2>${htmlEsc(p.title)}</h2>` +
      (p.summary ? `<p>${htmlEsc(p.summary)}</p>` : '') +
      '<span class="more">Read it &rarr;</span>' +
      '</span>' + thumb +
      '</div></a>';
  }).join('\n') : '<div class="empty">No posts yet. The first one is being written.</div>';
  res.type('html').send(pageTemplate('blog.html').replace('%POSTS%', list));
}));

// Public, because the blog is. The id is a content hash, so these bytes can
// never change under this URL -- hence `immutable` and a year, which keeps the
// function out of the path on every page view after the first.
app.get('/blog/img/:id', route(async (req, res, next) => {
  if (!/^[a-f0-9]{8,64}$/.test(String(req.params.id || ''))) return next();
  const img = await store.readPostImage(req.params.id);
  if (!img) return res.status(404).type('text/plain').send('No such image.');
  res.set('Content-Type', img.mime);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(img.bytes);
}));

// How many other posts the rail offers. Enough to navigate, short enough that
// the column is a list rather than a second page.
const RECENT_MAX = 8;

// The recent-posts rail, RENDERED SERVER-SIDE like the rest of this page: a
// blog that needs JavaScript to show its own navigation is one a crawler
// cannot follow. The post being read is kept in the list and marked rather
// than dropped — losing your place in a list of eight is worse than a row you
// cannot click.
const recentRail = (posts, currentSlug) => {
  const rows = posts.slice(0, RECENT_MAX);
  if (rows.length <= 1) {
    return '<p class="sideempty">This is the first one. More soon.</p>';
  }
  return '<ol class="sidelist">' + rows.map((p) => {
    const when = `<span class="sidewhen">${htmlEsc(postDate(p.publishedAt))}</span>`;
    const title = htmlEsc(p.title);
    return p.slug === currentSlug
      ? `<li aria-current="page"><span class="sidenow">${title}</span>${when}</li>`
      : `<li><a href="/blog/${encodeURIComponent(p.slug)}">${title}</a>${when}</li>`;
  }).join('') + '</ol>';
};

app.get('/blog/:slug', route(async (req, res, next) => {
  const p = await store.readPost(req.params.slug, { publishedOnly: true });
  if (!p) return next();                     // falls through to the 404 handler
  // One extra read of a table holding a dozen rows with no bodies selected —
  // the rail is worth that, and there is nothing here to cache against.
  const others = await store.readPosts({ publishedOnly: true }).catch(() => []);
  logAct(req, 'page', 'post:' + String(req.params.slug).slice(0, 60));
  const base = APP_URL || `https://${req.headers.host}`;
  const meta = [postDate(p.publishedAt), p.author ? htmlEsc(p.author) : '', `${readingMinutes(p.body)} min read`]
    .filter(Boolean).join(' · ');
  const summary = p.summary || '';
  const html = pageTemplate('post.html')
    .split('%TITLE%').join(htmlEsc(p.title))
    .split('%DESC%').join(htmlEsc(summary || p.title))
    .replace('%CANONICAL%', htmlEsc(`${base}/blog/${p.slug}`))
    .replace('%META%', meta)
    .replace('%SUMMARY%', htmlEsc(summary))
    // ?guides=1 draws the column boundaries over the real page at the real
    // width, which is the only place the allocation can be seen honestly -- the
    // editor's preview box is a different width, so its proportions would be a
    // different answer. Opt-in by URL, so no reader ever meets it, and pure CSS,
    // because this page carries no script and is not going to start.
    //
    // It sits on the SHELL rather than on the body, because there are three
    // columns to describe now and the third one is the body's sibling.
    .replace('%SHELLCLASS%', 'shell' + (req.query.guides === '1' ? ' guides' : ''))
    .replace('%RECENT%', recentRail(others, p.slug))
    .replace('%BODY%', renderMarkdown(p.body));
  res.type('html').send(summary ? html : html.replace('<p class="summary"></p>', ''));
}));

// Admin: writing them.
app.get('/posts', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  logAct(req, 'page', 'posts');
  res.sendFile(path.join(__dirname, 'private', 'posts.html'));
}));

// Public pages want to be findable, which is most of the point of a blog.
app.get('/robots.txt', route(async (req, res) => {
  res.type('text/plain').send(
    'User-agent: *\n' +
    'Allow: /$\nAllow: /blog\nAllow: /login\n' +
    // Everything else needs a session anyway; saying so keeps crawlers out of
    // the redirect loop rather than protecting anything.
    'Disallow: /api/\nDisallow: /stock/\nDisallow: /admin\n' +
    (APP_URL ? `Sitemap: ${APP_URL}/sitemap.xml\n` : ''));
}));

app.get('/sitemap.xml', route(async (req, res) => {
  const base = APP_URL || `https://${req.headers.host}`;
  const posts = await store.readPosts({ publishedOnly: true });
  const url = (loc, when) => `  <url><loc>${loc}</loc>${when ? `<lastmod>${String(when).slice(0, 10)}</lastmod>` : ''}</url>`;
  res.type('application/xml').send(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    [url(base + '/'), url(base + '/about'), url(base + '/blog'),
      ...posts.map((p) => url(`${base}/blog/${p.slug}`, p.updatedAt ? new Date(p.updatedAt).toISOString() : p.publishedAt))
    ].join('\n') + '\n</urlset>\n');
}));

// The phone. Any signed-in user, guests included — the owner's call: it is the
// friendliest surface the site has.
app.get('/m', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  logAct(req, 'page', 'mobile');
  res.sendFile(path.join(__dirname, 'private', 'mobile.html'));
}));

// Where its views are decided — on a desktop, by the owner.
app.get('/mobile-setup', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  logAct(req, 'page', 'mobile-setup');
  res.sendFile(path.join(__dirname, 'private', 'mobile-setup.html'));
}));

// Admin only: which screener columns everyone sees.
// Adding stocks and keeping the themes. It was three panels on /admin; the
// console is a door, and a panel that does work belongs on its own page — the
// same move /columns made.
app.get('/themes', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  logAct(req, 'page', 'themes');
  res.sendFile(path.join(__dirname, 'private', 'themes.html'));
}));

app.get('/columns', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  logAct(req, 'page', 'columns');
  res.sendFile(path.join(__dirname, 'private', 'columns.html'));
}));

// Admin only: every table in the database, with its row and column count.
// What talks to what, drawn from a layout spec rather than hand-placed
// markup. Admin only: it is an internal document, and it names the schedulers
// and the stores.
app.get('/architecture', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  logAct(req, 'page', 'architecture');
  res.sendFile(path.join(__dirname, 'private', 'architecture.html'));
}));

// Admin only: the advice backtest. It is the one page that produces a number
// that looks like performance, which is exactly why it is not a member surface.
app.get('/backtest', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  logAct(req, 'page', 'backtest');
  res.sendFile(path.join(__dirname, 'private', 'backtest.html'));
}));

app.get('/trend-backtest', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  logAct(req, 'page', 'trend-backtest');
  res.sendFile(path.join(__dirname, 'private', 'trend-backtest.html'));
}));

// Admin only: what we actually hold for each stock, and what to run about it.
app.get('/quality', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  logAct(req, 'page', 'quality');
  res.sendFile(path.join(__dirname, 'private', 'quality.html'));
}));

app.get('/database', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  logAct(req, 'page', 'database');
  res.sendFile(path.join(__dirname, 'private', 'database.html'));
}));

// Admin only: take the data out, as a spreadsheet, with the fields chosen.
// ADMIN rather than member on purpose. The CSV export came out of the screener
// on 2026-09-14 because it was the one bulk-copy button a member had, and the
// watermark work went in beside it; this is the owner taking their own data
// out, which was never the thing that rule was about.
app.get('/export', route(async (req, res) => {
  if (!(await isAdmin(req))) return res.redirect('/');
  logAct(req, 'page', 'export');
  res.sendFile(path.join(__dirname, 'private', 'export.html'));
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

// The pivot: the screen counted by two dimensions at once. A member page beside
// the studio, refused to guests for the same reason — five preview stocks have
// no shape to show. Everything it needs is already on a snapshot row, so it
// reads /api/stocks and cross-tabulates in the browser: no endpoint of its own,
// no query, nothing on the rows-read meter.
app.get('/pivot', route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  if (await isGuest(req)) return res.redirect('/');
  logAct(req, 'page', 'pivot');
  res.sendFile(path.join(__dirname, 'private', 'pivot.html'));
}));

// Two stocks side by side. TWO, never more: the difference column is inherently
// pairwise, and three columns of ninety fields is a table rather than a
// comparison — the owner's call, and the reason there is no "add another".
//
// The symbols ride in the PATH so a comparison can be bookmarked and sent, and
// so the stock page can link straight to one with itself already chosen. Both
// are optional: /compare opens with two empty pickers, /compare/NVDA with the
// first filled. Nothing is validated here — the page asks /api/stock for each,
// which is the route that already knows what is in the universe and already
// refuses a guest a symbol outside the preview. A bad symbol becomes a message
// on the page rather than a 404 on the whole comparison.
//
// Refused to guests like the studio and the pivot beside it. Five preview
// stocks make ten pairs, and every one of them would be a page explaining what
// the reader cannot see.
app.get(['/compare', '/compare/:a', '/compare/:a/:b'], route(async (req, res) => {
  if (!(await isSignedIn(req))) return res.redirect('/login');
  if (await isGuest(req)) return res.redirect('/');
  const pair = [req.params.a, req.params.b].filter(Boolean)
    .map((s) => String(s).toUpperCase().slice(0, 12)).join(':');
  logAct(req, 'page', 'compare' + (pair ? ':' + pair : ''));
  res.sendFile(path.join(__dirname, 'private', 'compare.html'));
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
// `ms` is how long the server had been working on this request when the line was
// written, which is the operation's cost for anything logged at the END of its
// route — a refresh, a chat answer, a model build.
//
// **NOT for `page`.** Those log at the TOP of their route and then serve a
// static file, so the elapsed time is ~1ms every time and says nothing about
// the wait: the browser then fetches the data and paints. A page's real cost
// arrives separately as a browser-measured `load` row (see trackLoad in
// private/track.js). Recording 1ms against "page screener" would be true and
// useless, and it would drag the per-kind summary into nonsense.
const UNTIMED_ACT_KINDS = new Set(['page']);

function logAct(req, kind, detail, userKey) {
  const k = String(kind).slice(0, 16);
  const ms = UNTIMED_ACT_KINDS.has(k) || !req || !req._t0 ? null : Date.now() - req._t0;
  Promise.resolve(userKey !== undefined ? userKey : actKey(req))
    .then((user) => store.logActivity([{
      ts: new Date().toISOString(),
      user,
      kind: k,
      detail: detail == null ? null : String(detail).slice(0, 80),
      ip: req.ip || null,
      ms,
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
      : `You now have access to ${BRAND} — a stock screener for a watchlist of stocks, ` +
        'refreshed after every close.';
    const bullets = [
      ['The screener', 'Every ticker scored on quality and read by the advice rules, with 48 columns you can ' +
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
// The tagline, and the ONE place it is written. The email shell reads it from
// here; the static public pages cannot, so they carry it as text for SEO and to
// avoid it flashing in after paint — and `tagline-test.js` asserts every one of
// them still matches this string exactly, naming any file that drifts. Same
// bargain /help takes with the numbers it restates.
const BRAND_TAG = 'From data to decisions';

// Colours picked for a light background rather than lifted from the app: mail
// clients invert or ignore dark themes unpredictably, and a screenshot-black
// email tends to arrive unreadable somewhere.
const MC = {
  ink: '#12151c', body: '#3d4450', mute: '#6b7382', faint: '#98a0ae',
  line: '#e4e7ec', panel: '#f6f7f9', head: '#0c0f16', accent: '#0f9d58', bad: '#c5221f',
};

const mailEsc = (t) => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- dark mode, ours rather than the client's ------------------------------
// The email arrived dark and nobody asked it to: a message that declares
// `color-scheme: light` and carries no dark rules gives a dark-mode client
// nothing to follow, so it repaints the white card by algorithm — a guess at
// what every colour should become, which is how a designed email turns muddy.
// Refusing does not work (Gmail and Outlook.com ignore the opt-out), so the
// answer is to SAY what dark looks like. This is the site's own palette, which
// also gets much closer to "similar to the webpage" than the light version
// ever could, in exactly the clients that were going to go dark anyway.
//
// THE LIGHT VERSION IS STILL THE DEFAULT and still entirely inline, so a client
// that strips <style> — which is most of the reason this file distrusts them —
// gets the house style unchanged. This block only ever adds.
//
// What it cannot reach: a client that BOTH strips <style> and force-inverts.
// That is the Gmail app signed in to a non-Gmail account, and nothing in the
// message can speak to it.
const MAIL_DARK = {
  bg: '#050505', card: '#0a0c11', foot: '#080a0f', line: '#1e2430',
  ink: '#e9ecf2', body: '#cfd6e2', mute: '#9aa3b2', faint: '#7d8797',
  accent: '#7c9cff', code: '#171c26', pre: '#12161f',
};

// Element selectors under .em-card rather than a class on every tag: the post
// body is rendered by the markdown skin and classing each of its tags would be
// a third description of the same document.
// THE RULES ARE DATA, not a finished stylesheet, because they have to be
// emitted twice with different selectors. The first attempt ran a regex over
// the rendered CSS to add the Outlook.com prefix, and it produced nested rules
// with only the first line of each multi-line selector list prefixed — valid
// enough to parse, worth nothing. A selector list cannot be prefixed by
// find-and-replace; it has to be prefixed one selector at a time.
const MAIL_DARK_RULES = (D) => [
  [['.em-bg'], `background:${D.bg}`],
  [['.em-card'], `background:${D.card};border-color:${D.line}`],
  [['.em-card td', '.em-card p', '.em-card li', '.em-card ul', '.em-card ol',
    '.em-card blockquote', '.em-card span'], `color:${D.body}`],
  [['.em-card h1', '.em-card h2', '.em-card h3', '.em-card h4',
    '.em-card strong', '.em-card b'], `color:${D.ink}`],
  [['.em-card a'], `color:${D.accent}`],
  [['.em-card img'], `border-color:${D.line}`],
  [['.em-card pre'], `background:${D.pre};border-color:${D.line}`],
  [['.em-card code'], `background:${D.code};color:${D.ink}`],
  [['.em-card hr'], `border-top-color:${D.line}`],
  // Scoped under .em-card deliberately: a bare .em-quiet is one class against
  // .em-card p's class-plus-element and loses, so the kicker and the captions
  // came back at body colour and the hierarchy flattened.
  [['.em-card .em-quiet', '.em-card .em-quiet td'], `color:${D.faint}`],
  // Header and card are near neighbours in the dark palette, so the masthead
  // stops reading as a band without a line under it.
  [['.em-head'], `border-bottom:1px solid ${D.line}`],
  [['.em-foot'], `background:${D.foot};border-top-color:${D.line}`],
  [['.em-foot p', '.em-foot a', '.em-foot strong'], `color:${D.mute}`],
  // A near-black pill on a near-black card is an invisible button.
  [['.em-btn td'], 'background:#ffffff'],
  [['.em-btn a'], 'color:#0c0f16'],
];

// Every declaration carries !important: the light version is inline, and an
// inline style beats any selector without it.
const mailDarkCss = (D, prefix) => MAIL_DARK_RULES(D).map(([sels, decls]) =>
  sels.map((sel) => (prefix ? prefix + ' ' + sel : sel)).join(',')
  + '{' + decls.split(';').filter(Boolean).map((d) => d + ' !important').join(';') + '}').join('');

// Apple Mail, and every client that honours a media query, takes the first
// block. Outlook.com honours none: it rewrites the message and stamps what it
// touched with data-ogsc (a colour it changed) or data-ogsb (a background), and
// those attributes are the only hook there is — so the same rules go out again,
// unwrapped, keyed on the attribute.
const MAIL_DARK_CSS = '<style>'
  + ':root{color-scheme:light dark;supported-color-schemes:light dark;}'
  + '@media (prefers-color-scheme:dark){' + mailDarkCss(MAIL_DARK, '') + '}'
  + mailDarkCss(MAIL_DARK, '[data-ogsc]')
  + mailDarkCss(MAIL_DARK, '[data-ogsb]')
  + '</style>';

// A pill button that survives Outlook, which ignores border-radius on <a>.
function mailButton(href, label) {
  // `em-btn` is the hook the dark block needs: a near-black pill on a
  // near-black card is an invisible button, so in dark mode it flips to
  // white-on-dark — which is what the site's own primary button does.
  return `<table class="em-btn" role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0">` +
    `<tr><td style="border-radius:999px;background:${MC.head}">` +
    `<a href="${href}" style="display:inline-block;padding:13px 26px;font-family:` +
    `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
    `font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">` +
    `${mailEsc(label)}</a></td></tr></table>`;
}

// ---- a post, as an email ---------------------------------------------------

// WHAT AN EMAIL CANNOT DO, stated once so the differences read as decisions:
// no flexbox, no grid, no stylesheet worth relying on (Outlook renders through
// Word and Gmail strips <style>), and no float that survives a rewrite. So the
// page's two columns become ONE — a rail beside the text is not expressible —
// and "wide" is the same width as everything else, because there is nothing to
// break out of inside a 600px card.
//
// The ground is LIGHT on purpose, which is the one place this deliberately
// differs from the site. The dark header carries the brand; the body does not,
// because dark-mode-inverting clients repaint a black email unpredictably and
// a reader who gets a muddy one cannot tell it from a broken one.
const MAIL_SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MAIL_MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
// 600px card less the shell's 28px of padding each side.
const MAIL_W = 544;
const MAIL_IMG_W = { small: 300, medium: 440 };

const st = (css) => ` style="${css}"`;

// An email has no origin, so every href and every src has to be absolute or it
// resolves against the reader's mail client and goes nowhere.
const mailAbs = (u) => (/^https?:\/\//i.test(u) ? u : (APP_URL || '') + u);

const emailSkin = () => ({
  p: st(`margin:0 0 16px;font-family:${MAIL_SANS};font-size:15px;line-height:1.65;color:${MC.body}`),
  h2: st(`margin:28px 0 10px;font-family:${MAIL_SANS};font-size:19px;line-height:1.3;font-weight:700;letter-spacing:-0.3px;color:${MC.ink}`),
  h3: st(`margin:22px 0 8px;font-family:${MAIL_SANS};font-size:16.5px;line-height:1.35;font-weight:700;color:${MC.ink}`),
  h4: st(`margin:18px 0 6px;font-family:${MAIL_SANS};font-size:15px;line-height:1.4;font-weight:700;color:${MC.ink}`),
  ul: st(`margin:0 0 16px;padding-left:22px;font-family:${MAIL_SANS};font-size:15px;line-height:1.65;color:${MC.body}`),
  ol: st(`margin:0 0 16px;padding-left:22px;font-family:${MAIL_SANS};font-size:15px;line-height:1.65;color:${MC.body}`),
  li: st('margin:0 0 7px'),
  blockquote: st(`margin:0 0 16px;padding:2px 0 2px 15px;border-left:3px solid ${MC.accent};color:${MC.mute};font-family:${MAIL_SANS};font-size:15px;line-height:1.6`),
  hr: st(`border:0;border-top:1px solid ${MC.line};margin:26px 0`),
  pre: st(`margin:0 0 16px;padding:12px 14px;background:${MC.panel};border:1px solid ${MC.line};border-radius:8px;overflow-x:auto`),
  precode: st(`font-family:${MAIL_MONO};font-size:12.5px;line-height:1.55;color:${MC.ink}`),
  code: st(`font-family:${MAIL_MONO};font-size:13px;background:#eef1f6;padding:1px 5px;border-radius:4px;color:${MC.ink}`),
  strong: st(`color:${MC.ink}`),
  em: '',
  // target=_blank means nothing in a mail client and rel even less; dropped
  // rather than carried along as furniture.
  link: (href, text) => `<a href="${mailAbs(href)}"${st('color:#2f6bff;text-decoration:underline')}>${text}</a>`,
  // A TABLE, not a figure: Outlook ignores display on a <figure> and centring a
  // block by margin is the thing it is least reliable about. The caption is a
  // second row rather than a sibling element for the same reason.
  fig: (src, alt, size) => {
    const w = MAIL_IMG_W[size] || MAIL_W;
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
      + st('margin:0 0 20px') + '><tr><td align="center"'+ st('padding:0') + '>'
      + `<img src="${mailAbs(src)}" alt="${alt}" width="${w}"`
      + st(`display:block;width:100%;max-width:${w}px;height:auto;border:1px solid ${MC.line};border-radius:8px`)
      + '></td></tr>'
      + (alt
        ? `<tr><td class="em-quiet" align="center"${st(`padding:7px 0 0;font-family:${MAIL_SANS};font-size:12.5px;line-height:1.5;color:${MC.faint}`)}>${alt}</td></tr>`
        : '')
      + '</table>';
  },
});

// The plain-text half. Derived from the MARKDOWN rather than from the HTML,
// because stripping tags out of the rendered version reintroduces every
// escaping question the renderer just answered.
function postAsText(p, url) {
  const lines = String(p.body || '').replace(/\r\n/g, '\n').split('\n').map((l) => l
    .replace(/^#{1,4}\s+/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (m, alt) => (alt ? `[picture: ${alt}]` : '[picture]'))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1'));
  return { lines, url };
}

function postEmail(p, url) {
  const when = postDate(p.publishedAt);
  const mins = `${readingMinutes(p.body)} min read`;
  const kicker = `<p class="em-quiet"${st(`margin:0 0 18px;font-family:${MAIL_MONO};font-size:11.5px;letter-spacing:0.08em;`
    + `text-transform:uppercase;color:${MC.faint}`)}>${mailEsc([when, mins].filter(Boolean).join(' · '))}</p>`;
  return kicker + renderMarkdown(p.body, emailSkin())
    + mailButton(url, 'Read it on the site');
}

// `note` is the one line that says why this particular message arrived — the
// question a reader asks first about mail they did not expect.
function emailShell({ heading, intro, body = '', note = '' }) {
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const site = APP_URL || '';
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light dark">` +
        `<meta name="supported-color-schemes" content="light dark">` +
        MAIL_DARK_CSS + `</head>` +
        `<body class="em-bg" style="margin:0;padding:0;background:${MC.panel}">` +
    // Preheader: the grey line clients show beside the subject. Left to the
    // intro rather than invented, and hidden in the body itself.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${mailEsc(intro)}</div>` +
    `<table class="em-bg" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="background:${MC.panel};padding:28px 12px">` +
    `<tr><td align="center">` +
    `<table class="em-card" role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ` +
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
    `<tr><td class="em-head" style="background:${MC.head};padding:18px 28px">` +
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
    `<tr><td class="em-foot" style="padding:18px 28px 22px;border-top:1px solid ${MC.line};background:#fbfcfd">` +
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

// The stocks the screener tracks. Its own table since 2026-09-15 — it was the
// union of the portfolios, which made deleting a portfolio delete its stocks.
// Portfolios are groupings now: only removing a stock from the universe takes
// it (and its data) out of the screener.
const readUniverse = () => store.readUniverse();

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

// Fetch sector (/profile), fundamentals (/statistics) and the earnings
// quarters (/earnings) for one symbol. Best-effort: any field stays null if
// the endpoint errors or omits it. /statistics requires a Twelve Data Pro+
// plan, so it is gated behind FUNDAMENTALS_ENABLED.
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
// How long the Balanced verdict has stood, stamped on the way out for the
// reason the display names are: it derives from data already held, so a
// snapshot written before the field existed still carries it.
//
// `adviceExact` is false until the row has been SEEN to change. The column
// prints "at least" then, because the history could not be backfilled: one day
// of technicals is stored and a verdict replay needs fundamentals, which begin
// 2026-08-30 and only on the days a Refresh all ran.
async function stampAdviceAge(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  let state = {};
  try { state = await store.readAdviceState(); } catch (e) { return; }
  for (const r of rows) {
    const s = r && r.symbol ? state[r.symbol] : null;
    // A verdict that has moved since the last close is one session old today,
    // whatever the stored run says — the stored run is yesterday's news.
    if (!s || !r.action) { r.adviceDays = null; r.adviceExact = null; r.adviceSince = null; continue; }
    const moved = s.action !== r.action;
    r.adviceDays = moved ? 1 : s.sessions;
    r.adviceExact = moved ? true : s.exact;
    r.adviceSince = moved ? null : s.since;
  }
}

// When each row's price was last fetched, stamped on the way out for the same
// reason the display names and the advice age are: it derives from data we
// already hold, so a snapshot written before the column existed still carries
// it, and it is current rather than frozen at whenever the snapshot was built.
async function stampPricedAt(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  let state = {};
  try { state = await store.readPriceState(); } catch (e) { return; }
  for (const r of rows) {
    if (!r || !r.symbol) continue;
    const t = state[r.symbol];
    r.pricedAt = Number.isFinite(t) ? t : null;
  }
}

// The market-cap band, stamped beside the others and for the same reason: it
// derives from a field already on the row, so a snapshot written before the
// column existed carries it, and moving a threshold moves every surface at once
// without waiting for a refresh. The bands themselves live in filters.js, which
// the screener and the pivot load too — one definition, four readers.
//
// Synchronous and free: no query, no API call. It reads `marketCap` and nothing
// else, so it can run wherever rows are about to be served.
function stampCapBand(rows) {
  if (!Array.isArray(rows)) return;
  for (const r of rows) {
    if (!r || !r.symbol) continue;
    r.capBand = Filters.capBandOf(r.marketCap);
  }
}

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
    // Where it trades, and in what. These were being read off the PRICE call's
    // meta block, which only exists when a symbol was priced live — so every
    // archive-priced round (rounds 2+ of a Refresh all) wrote a snapshot with
    // all three null, and after a full sweep the whole universe had lost them.
    // They belong with sector and industry: per-symbol facts, stored once,
    // surviving every round. Both come out of calls already being made.
    //
    // `currency` here is the TRADING currency — USD for an ADR like ERIC, which
    // reports in SEK. It is right for the price column and WRONG for the money
    // columns; the reporting currency lives in /income_statement's meta and is
    // a separate, 100-credit-a-symbol question.
    exchange: null,
    micCode: null,
    currency: null,
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
    // Everything below arrives in the SAME /statistics response as the fields
    // above and was being discarded (2026-09-15). The call is charged whether
    // one field is read or sixty, so none of this costs a credit — it only
    // needed columns. What is deliberately still dropped is what the bar
    // archive already gives us exactly: beta, the 52-week high/low/change, the
    // 50- and 200-day averages and the average volumes.
    sharesOutstanding: null,   // the share count itself: buybacks and dilution
    floatShares: null,
    totalCash: null,           // stored beside netCash, which hides the two sides
    totalDebt: null,
    debtToEquity: null,
    currentRatio: null,
    enterpriseValue: null,
    trailingPe: null,
    priceToBook: null,
    priceToSales: null,
    evToEbitda: null,
    ebitda: null,
    operatingCashFlowTtm: null,
    operatingMargin: null,
    roa: null,
    dilutedEpsTtm: null,
    bookValuePerShare: null,
    divYield: null,            // forward, as a percentage
    divRate: null,
    payoutRatio: null,
    exDivDate: null,
    shortRatio: null,
    shortPctOutstanding: null,
    insiderPct: null,
    institutionPct: null,
    lastEarningsDate: null,
    lastSurprise: null,
    nextEarningsDate: null,
    nextEarningsEstimated: false,
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
      if (p.name) out.providerName = String(p.name).slice(0, 200);
      if (p.exchange) out.exchange = String(p.exchange).slice(0, 40);
      if (p.mic_code) out.micCode = String(p.mic_code).slice(0, 12);
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
      // The meta block rides along with every statistics response and was being
      // thrown away. Free.
      if (st?.meta?.currency) out.currency = String(st.meta.currency).slice(0, 8);
      if (!out.exchange && st?.meta?.exchange) out.exchange = String(st.meta.exchange).slice(0, 40);
      if (!out.micCode && st?.meta?.mic_code) out.micCode = String(st.meta.mic_code).slice(0, 12);
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

      // The rest of the same payload. `pc` turns the feed's fractions into
      // percentages, the convention every other percentage column here uses.
      const nn = (v) => (v == null || !isFinite(Number(v)) ? null : Number(v));
      const pc = (v) => (nn(v) == null ? null : nn(v) * 100);
      if (vm) {
        out.enterpriseValue = nn(vm.enterprise_value);
        out.trailingPe = nn(vm.trailing_pe);
        out.priceToBook = nn(vm.price_to_book_mrq);
        out.priceToSales = nn(vm.price_to_sales_ttm);
        out.evToEbitda = nn(vm.enterprise_to_ebitda);
      }
      if (fin) {
        out.operatingMargin = pc(fin.operating_margin);
        out.roa = pc(fin.return_on_assets_ttm);
      }
      if (inc) {
        out.ebitda = nn(inc.ebitda);
        out.dilutedEpsTtm = nn(inc.diluted_eps_ttm);
      }
      if (bs) {
        out.totalCash = nn(bs.total_cash_mrq);
        out.totalDebt = nn(bs.total_debt_mrq);
        out.debtToEquity = nn(bs.total_debt_to_equity_mrq);
        out.currentRatio = nn(bs.current_ratio_mrq);
        out.bookValuePerShare = nn(bs.book_value_per_share_mrq);
      }
      if (cf) out.operatingCashFlowTtm = nn(cf.operating_cash_flow_ttm);
      if (ss) {
        out.sharesOutstanding = nn(ss.shares_outstanding);
        out.floatShares = nn(ss.float_shares);
        out.shortRatio = nn(ss.short_ratio);
        out.shortPctOutstanding = pc(ss.short_percent_of_shares_outstanding);
        out.insiderPct = pc(ss.percent_held_by_insiders);
        out.institutionPct = pc(ss.percent_held_by_institutions);
      }
      const dv = st?.statistics?.dividends_and_splits;
      if (dv) {
        out.divYield = pc(dv.forward_annual_dividend_yield);
        out.divRate = nn(dv.forward_annual_dividend_rate);
        out.payoutRatio = pc(dv.payout_ratio);
        out.exDivDate = dv.ex_dividend_date || null;
      }
    } catch {
      out.fetchOk = false;
      /* leave fundamentals null */
    }
    // Earnings: last reported date + surprise, and the next date (confirmed if the
    // feed lists a future date, else estimated ~91 days after the last report).
    try {
      // 40 asked, ~26 quarters returned (measured on MSFT, 2026-09-18:
      // 2020-04 to 2026-07) — for the SAME 20 credits as the 8 we used to ask
      // for. The cap is the provider's, not ours, so asking for more simply
      // takes what it has; the financial statements are the endpoints with a
      // hard 6-quarter plan wall, and asking those for more answers 400.
      const e = await fetchJson(`${TD_BASE}/earnings?symbol=${enc}&outputsize=${EARNINGS_QUARTERS}&apikey=${API_KEY}`);
      const arr = Array.isArray(e?.earnings) ? e.earnings : [];
      const today = new Date().toISOString().slice(0, 10);
      const reported = arr.find((x) => x.eps_actual != null && x.date <= today) || arr.find((x) => x.eps_actual != null);
      const upcoming = arr.filter((x) => x.date > today).sort((a, b) => a.date.localeCompare(b.date))[0];
      // Every quarter the call returned, not just the latest surprise — the
      // same 20 credits either way, and a reported quarter never changes, so
      // the table only ever grows sideways. Rides on the profile object and is
      // stripped before the profile is cached (it is not a profile field).
      out.earningsRows = arr
        .filter((x) => x && x.date && (x.eps_actual != null || x.eps_estimate != null))
        .map((x) => ({
          date: x.date,
          epsEstimate: x.eps_estimate == null ? null : Number(x.eps_estimate),
          epsActual: x.eps_actual == null ? null : Number(x.eps_actual),
          surprise: x.difference == null ? null : Number(x.difference),
          surprisePrc: x.surprise_prc == null ? null : Number(x.surprise_prc),
          time: x.time || null,
        }));
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
    // One write for the whole round rather than one per symbol.
    const quarters = [];
    for (const { s, r } of results) {
      for (const q of (r.earningsRows || [])) quarters.push({ symbol: s, ...q });
    }
    if (quarters.length) {
      // An earnings write never fails a refresh — the bars rule.
      try { await store.writeEarnings(quarters); }
      catch (err) { console.warn('earnings history skipped:', err.message); }
    }
    // Fill a MISSING name from the response we just paid for. The bulk add
    // takes names from nasdaq_listings, and that file holds no ETFs — so SPY,
    // IWM and DIA arrived nameless and nothing would ever have fixed them:
    // profiles never carried a name, and no other path writes one. An existing
    // name is never overwritten, so an edited one survives.
    try {
      const have = await readNames();
      const fill = {};
      for (const { s, r } of results) if (!have[s] && r && r.providerName) fill[s] = r.providerName;
      if (Object.keys(fill).length) await writeNames(fill);
    } catch (err) { console.warn('name backfill skipped:', err.message); }

    for (const { s, r } of results) {
      const { fetchOk, earningsRows, providerName, ...vals } = r;
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

// Every call to Twelve Data carries a deadline and may be retried once, and
// both halves were bought the hard way. On 2026-09-17 its batched time_series
// began flapping: the SAME 120-symbol request returned in 12s, in 375s, as an
// HTML gateway error page, and as a dropped socket, within one hour. A bare
// fetch() turned each of those into a two-to-six minute hang that ended in the
// word "terminated" — undici's word for "the connection died", with the actual
// reason buried in err.cause — or, for the error page, in a JSON parse error
// that read like a bug in here rather than a failure over there.
//
// The per-attempt deadline matters more than it looks: a serverless function is
// killed at the platform's ceiling, so an unbounded wait does not fail, it
// vanishes, taking the round's credits with it.
const TD_TIMEOUT_MS = Number(process.env.TD_TIMEOUT_MS || 120000);
// A budget for the WHOLE call, retry included, because what must not be
// exceeded is the platform's ceiling on the request — not any one attempt.
// A first attempt that fails at 77s (the 2026-09-17 gateway page did exactly
// that) still leaves room to try again; one that burns the full deadline does
// not, and retrying it would run the round off the end of the function.
const TD_BUDGET_MS = Number(process.env.TD_BUDGET_MS || 200000);
// ...and a ceiling on the price phase as a WHOLE. The budget above bounds one
// call; three chunks each taking it would still run the round off the end of
// the function. Measured 2026-09-17, a healthy shallow phase is 18-30s, so this
// is slack rather than a constraint — it exists for the bad afternoon, where a
// round that returns 271 rows late is worth more than one the platform kills.
const PRICE_PHASE_MS = Number(process.env.TD_PRICE_PHASE_MS || 210000);
const TD_RETRY_WAIT_MS = 2000;
// Below this there is no point starting again.
const TD_MIN_ATTEMPT_MS = 15000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// undici keeps the useful half of a network failure in .cause: the top-level
// message is "fetch failed" or "terminated", and the chain underneath says
// SocketError / UND_ERR_SOCKET / ETIMEDOUT. Flatten it so one line names the
// reason in the log, in the run's stored error and on the screener's status.
function netReason(err) {
  const out = [];
  const add = (v) => { if (v && !out.includes(v)) out.push(v); };
  for (let e = err, i = 0; e && i < 4; e = e.cause, i++) {
    add(e.message || e.name);
    // Only a NAMED code is worth printing. DOMException.code is the legacy
    // numeric constant — a timeout is 23 — so preferring it over the message
    // turned an aborted fetch into the error text "23 — 23". Undici's codes
    // are names (UND_ERR_SOCKET, ETIMEDOUT); all-digits means legacy, drop it.
    if (typeof e.code === 'string' && !/^\d+$/.test(e.code)) add(e.code);
  }
  return out.join(' \u2014 ') || 'unknown error';
}

async function fetchJson(url, opts = {}) {
  const perAttempt = opts.timeout || TD_TIMEOUT_MS;
  const budget = opts.budget || TD_BUDGET_MS;
  const attempts = opts.retry === false ? 1 : 2;
  const started = Date.now();
  let last;
  for (let n = 1; n <= attempts; n++) {
    const t0 = Date.now();
    // Never let attempt two run past the budget the platform allows — but
    // never hand AbortSignal a zero either, which would abort instantly.
    const timeout = Math.max(1000, Math.min(perAttempt, budget - (t0 - started)));
    // Whether the provider CHARGED for this attempt decides whether retrying is
    // free or doubles the bill. Credits are the binding constraint (610 a
    // minute, and the round's profile budget is sized against a known price
    // cost), so a blind retry could breach the ceiling and get the next round
    // refused. An attempt whose Api-Credits-Request header never arrived was
    // never served — retrying that spends what the first attempt failed to.
    let charged = false;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      const m = creditMeter.getStore();
      // Reject the empty BEFORE coercing: a missing header is null, and
      // Number(null) is 0, which is finite. Reading that as "charged 0" would
      // have meant "we were served" and suppressed every retry — the exact
      // trap that fabricated slopes out of null values once already.
      const raw = res.headers.get('api-credits-request');
      const c = raw == null || raw === '' ? NaN : Number(raw);
      if (Number.isFinite(c)) { charged = true; if (m) m.credits += c; }
      if (!res.ok) {
        // A gateway failure is an HTML page, not JSON. Read it as text and say
        // what it was; res.json() here is what produced the useless
        // "Unexpected token '<', \"<!DOCTYPE \"..." on 2026-09-17.
        const body = await res.text().catch(() => '');
        let msg = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(body);
          if (j && j.message) msg += `: ${j.message}`;
        } catch {
          if (res.status >= 500) msg += ' \u2014 the provider returned an error page, not data';
        }
        throw new Error(msg);
      }
      return await res.json();
    } catch (err) {
      last = err;
      const left = budget - (Date.now() - started) - TD_RETRY_WAIT_MS;
      if (n === attempts || charged || left < TD_MIN_ATTEMPT_MS) break;
      console.warn(`twelve data: attempt ${n} failed after ${Date.now() - t0}ms ` +
                   `(${netReason(err)}) \u2014 nothing was charged, ` +
                   `${Math.round(left / 1000)}s of budget left, retrying`);
      await sleep(TD_RETRY_WAIT_MS);
    }
  }
  throw new Error(netReason(last), { cause: last });
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
// A transparent composite: ~60% trend, ~25% fundamentals,
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
// Sessions since the 52-week high and low were set (0 = today). A level like
// "% from the high" cannot say whether the high was yesterday or ten months
// ago; the "recent 52-week highs / lows" screens need exactly that.
function extremeAges(values, lookback = 252) {
  if (!Array.isArray(values) || !values.length) return { hi: null, lo: null };
  let high = -Infinity, low = Infinity, hi = null, lo = null;
  const n = Math.min(values.length, lookback);
  for (let i = 0; i < n; i++) {
    const h = parseFloat(values[i].high);
    const l = parseFloat(values[i].low);
    if (isFinite(h) && h > high) { high = h; hi = i; }
    if (isFinite(l) && l > 0 && l < low) { low = l; lo = i; }
  }
  return { hi, lo };
}

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

// ---- how STEADY the year was, and how much it hurt -------------------------
// Two columns rather than one score, because they are nearly independent
// (rank correlation 0.25 over 421 symbols) and a composite would hide which of
// the two a stock is bad at.
//
// WHY NOT "months up out of 12", which is the obvious measure: over the same
// 421 symbols it takes only TEN distinct values, so it ties ~42 stocks at every
// level and cannot rank a universe; it is blind to magnitude (a +0.1% month
// counts like +20%) and to order (up-down-up-down scores like a steady climb);
// and it is 0.72 rank-correlated with the plain return, so most of what it says
// the return column already said.
//
// AND WHY NOT SHARPE, WHICH IS THE OTHER OBVIOUS ONE: measured on the same
// year, Sharpe is **0.96** rank-correlated with total return, Sortino 0.97 and
// gain-to-pain 0.96 -- and all three are 1.00 with EACH OTHER. Inside a return
// decile they reorder almost nothing. Over a one-year window, ranking by Sharpe
// is very nearly ranking by return: the RS-vs-S&P trap in momentum-scoring.md,
// where a factor correlated 1.000 with the 3M return and could not reorder
// anything while consuming a quarter of the weight.

// R^2 of log price against time: how much of the year's movement is the trend
// rather than noise. 100 is a ruler-straight path, 0 is chop.
//
// IT IS DELIBERATELY DIRECTION-BLIND, and signing it was measured and rejected:
// multiplying by sign(slope) takes the correlation with return from 0.34 to
// 0.89 and halves the separation it achieves among stocks that made the same
// money, because "which way" is mostly "how much". Slope x R^2 is worse still
// at 0.94. So direction stays where it already is -- the return columns, the
// trend state, the moving averages -- and this number answers only "how
// straight". 61 of 421 symbols fall STEADILY, so that is a real reading and not
// a hypothetical; the column header says so.
function steadiness(values, lookback = 252) {
  if (!Array.isArray(values) || values.length < lookback) return null;
  // `values` is newest-first everywhere in this file; a regression against time
  // needs it the other way round or the slope's sign is inverted.
  const n = lookback;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, used = 0;
  for (let i = 0; i < n; i++) {
    const c = parseFloat(values[n - 1 - i].close);
    if (!isFinite(c) || c <= 0) return null;          // a log needs a positive price
    const y = Math.log(c);
    sx += i; sy += y; sxx += i * i; sxy += i * y; syy += y * y; used++;
  }
  if (used < lookback) return null;
  const varX = sxx - (sx * sx) / used;
  const varY = syy - (sy * sy) / used;
  const cov = sxy - (sx * sy) / used;
  if (!(varX > 0) || !(varY > 0)) return null;        // a flat line explains nothing
  const r2 = (cov * cov) / (varX * varY);
  return Math.max(0, Math.min(1, r2)) * 100;
}

// Ulcer index: the root-mean-square drawdown from the running high, in percent.
// Depth AND duration, so a long shallow slide and a brief deep one are told
// apart -- which is the half "months up" cannot see at all. Low is calm.
function ulcerIndex(values, lookback = 252) {
  if (!Array.isArray(values) || values.length < lookback) return null;
  let peak = 0, sq = 0, n = 0;
  for (let i = lookback - 1; i >= 0; i--) {          // oldest to newest
    const c = parseFloat(values[i].close);
    // A FULL year of usable closes or nothing. Skipping the bad ones and
    // averaging over what is left would quietly make this a four-month figure
    // on a row whose neighbours are twelve-month ones, and the column has to
    // mean the same thing down the whole table. `steadiness` bails the same way.
    if (!isFinite(c) || c <= 0) return null;
    if (c > peak) peak = c;
    const dd = (c / peak - 1) * 100;
    sq += dd * dd; n++;
  }
  return n === lookback ? Math.sqrt(sq / n) : null;
}

// ---- is it trading in a RANGE? ---------------------------------------------
// "No trend" is not "in a range": a random walk has no trend either, it just
// wanders off and never comes back. Measured over 421 symbols, the 40 LEAST
// steady stocks were 24 genuine ranges, 12 rollercoasters (no net move but a
// huge band) and 4 that crashed or spiked -- so low Steadiness alone is 60%
// precise and the other two readings are what fix it.
//
// Kaufman's efficiency ratio was the obvious candidate and was REJECTED on the
// same measurement: rank correlation 0.79 with the absolute return, so it
// mostly restates how far the thing went. The same trap that sank Sharpe for
// the consistency rating.

// How often the price crosses its own median for the window. A trender crosses
// once or twice; something oscillating crosses twenty-five to thirty-five
// times. **Rank correlation with volatility 0.07** -- which is the property
// that matters, because it means this finds stocks that go back and forth
// rather than merely stocks that are quiet.
function medianCrossings(values, lookback = 252) {
  if (!Array.isArray(values) || values.length < lookback) return null;
  const c = [];
  for (let i = lookback - 1; i >= 0; i--) {          // oldest to newest
    const x = parseFloat(values[i].close);
    if (!isFinite(x) || x <= 0) return null;         // a full window or nothing
    c.push(x);
  }
  const med = [...c].sort((a, b) => a - b)[Math.floor(c.length / 2)];
  let n = 0;
  for (let i = 1; i < c.length; i++) if ((c[i - 1] - med) * (c[i] - med) < 0) n++;
  return n;
}

// The width of the window's range as a share of its median. Deliberately NOT an
// independent signal -- it is 0.89 rank-correlated with volatility, which is
// exactly right: it is the volatility CONSTRAINT, and it is what excludes the
// twelve rollercoasters that oscillate beautifully across an 80% span.
function bandPct(values, lookback = 252) {
  if (!Array.isArray(values) || values.length < lookback) return null;
  let hi = -Infinity, lo = Infinity;
  const c = [];
  for (let i = lookback - 1; i >= 0; i--) {
    const x = parseFloat(values[i].close);
    if (!isFinite(x) || x <= 0) return null;
    if (x > hi) hi = x;
    if (x < lo) lo = x;
    c.push(x);
  }
  const med = [...c].sort((a, b) => a - b)[Math.floor(c.length / 2)];
  return med > 0 ? ((hi - lo) / med) * 100 : null;
}

// Annualised realised volatility (%), from daily log returns. The Cushion is
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

// Quality (company data), 1-10. Absolute, never ranked against the universe:
// a 25% margin is a 25% margin regardless of the company it keeps.
//
// A logistic curve rather than a clamped line — lin() pinned a third to a half
// of the universe at exactly 0 or 1 on every major factor, and a factor that is
// constant across half the list cannot order anything. tanh is asymptotic, so
// ordering survives at the extremes.
function curve(v, centre, scale) {
  if (v == null || !isFinite(v)) return null;
  return 0.5 + 0.5 * Math.tanh((v - centre) / scale);
}

// Scores every row. Nothing here needs the universe — every factor is measured
// against a fixed scale — so this is a plain loop. It is kept as a function
// because both the live pull and the fortnight-ago reconstruction go through it.
// Stamp Company Type / Action / Flag / the four state columns onto rows.
// ONE fixed rule set — the Balanced defaults in code — at the owner's
// instruction; the profile machinery (house row, personal presets, the Rules
// picker) was built, then removed 2026-09-11. The engine still takes a config,
// so bringing configurability back is wiring, not a rewrite.
const ACTION_CFG = (() => { const { cfg } = Action.resolve(null, 'Balanced'); cfg.__resolved = true; return cfg; })();

// Every rule set the app offers, resolved once each and kept. The screener's
// columns and the studio's cards are Balanced-only by design; the BACKTEST can
// run under any of them, which is the one place a second rule set answers a
// question rather than just showing a different word.
//
// The LIST is Cards.ADV_PROFILES — the same five the studio offers — so a rule
// set added there is offered here with no edit, and Conservative stays out of
// both for the reason action.js records. `Action.resolve` clones DEFAULTS on
// every call, so these are cached rather than resolved per request.
const RULE_SETS = (Cards.ADV_PROFILES || ['Balanced']).filter((n) => Action.PRESETS[n]);
const ruleCfgCache = new Map([['Balanced', ACTION_CFG]]);
function ruleCfg(name) {
  const want = RULE_SETS.indexOf(name) >= 0 ? name : 'Balanced';
  if (!ruleCfgCache.has(want)) {
    const { cfg } = Action.resolve(null, want);
    cfg.__resolved = true;
    ruleCfgCache.set(want, cfg);
  }
  return ruleCfgCache.get(want);
}

// ---- what a row gains on the way out ---------------------------------------
// Every field here derives from data already held, which is why it is stamped
// at SERVE time rather than when the snapshot is written: a snapshot from
// before a field existed still carries it, and an override typed a moment ago
// shows without waiting for a refresh.
//
// ONE LIST, because there are now two readers. /api/stocks needs these to run
// in parallel with the portfolios and the refresh flag — six round trips became
// two that way — so this hands back the promises rather than awaiting them, and
// the export spreads the same list into its own Promise.all. A field added to
// one reader cannot go missing from the other.
const serveStamps = (rows) => [
  stampShortNames(rows).catch(() => {}),
  stampAdviceAge(rows).catch(() => {}),
  stampPricedAt(rows).catch(() => {}),
];
// The two that need no round trip, and therefore wait for the portfolios.
function finishServe(rows, pf) {
  stampCapBand(rows);
  for (const x of rows) x.portfolios = membershipOf(x.symbol, pf);
}

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
    // Distance to the exit under Balanced — how far the price can fall before
    // these same rules flip to Avoid or worse. Engine-computed (exitDistance),
    // so the hover card and the ladder panel cannot drift apart on it.
    rows[i].actionRisk = Action.exitDistance({
      v200: rows[i].vs200ma, v50: rows[i].vs50ma, rsi: rows[i].rsi,
      m1: rows[i].oneMonthPct, m3: rows[i].threeMonthPct, fh: rows[i].pctFromHigh,
      vol: rows[i].volTrend, hist: rows[i].historyDays,
    }, ACTION_CFG);
    // CUSHION — that same distance measured in the stock's OWN monthly
    // volatility, and the only within-tier ordering the archive supports.
    //
    // Measured 2026-09-17 over 307,965 stock-days, 42,285 of them in the
    // technical Strong Buy tier, ranked within the day against the universe's
    // equal-weight return: ranking on the RAW distance orders the downside
    // BACKWARDS — the roomiest half sits 25.6% above its 200-day on 31.7%
    // volatility against 13.8% and 24.3%, so "more room" is really "more
    // extended", and its 3M p10 is -18.5% against -15.7%. Divided by the
    // stock's own volatility the tail orders correctly instead: thinner at
    // p10 and p25 in 6 of 6 era/horizon cells, by 0.9 to 3.3 points.
    //
    // It ranks TAIL SIZE, not return: every mean-excess difference is noise
    // (no |t| above 0.6), which is the tier-level backtest's verdict too —
    // the ladder orders downside and does not pick winners. Anything built on
    // this has to say so.
    const rv = rows[i].realisedVol;
    rows[i].actionCushion = (rows[i].actionRisk && rows[i].actionRisk.drop != null
      && rv != null && isFinite(rv) && rv > 0)
      ? Math.round((rows[i].actionRisk.drop / (rv / Math.sqrt(12))) * 100) / 100
      : null;
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

// Quality is the only composite left. Momentum and the Overall 65/35 blend
// that sat on top of it were removed on 2026-09-23 — see docs/momentum-scoring.md
// and the `momentum-scoring` tag for the model, its measured centres and the
// evidence that it never predicted anything.
function applyScores(rows) {
  rows.forEach((row) => {
    const sc = computeScores(row);
    row.qualityScore = sc.quality ? sc.quality.score : null;
    row.qualityRating = sc.quality ? sc.quality.rating : null;
    row.qualityBreakdown = sc.quality ? sc.quality.breakdown : null;
  });
}

function computeScores(m) {
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

  // A quality score resting on a sliver of the factor weight is not a quality
  // score — below this share of available weight, report none at all.
  const quality = scoreFactors(qualComps, QUALITY_MIN_WEIGHT);
  return { quality };
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

// ---- column views ------------------------------------------------------------
// A view is a named set of screener columns (Symbol and Name are always shown,
// so they are not listed). Starter views are shared: every account sees them,
// only the owner edits them. Members keep up to VIEWS_MAX of their own. The
// server does not know the screener's column list — it checks the SHAPE of
// each id and the page ignores ids it does not recognise — so adding a column
// never needs a matching edit here.
const VIEWS_MAX = 10;
// How many starter screens one account may star. A ceiling on what /api/prefs
// will store, not a limit anyone should meet: there are 22 screens today, so
// this clears the whole list four times over and still bounds the row.
const FAVS_MAX = 100;
const VIEW_COLUMNS_MAX = 80;
const VIEW_ID_RE = /^[a-z0-9]{8}$/;
const VIEW_COL_RE = /^[A-Za-z0-9:_ \-]{1,40}$/;
const STARTER_VIEWS = [
  { id: 'strtrend', name: 'Trend & returns', columns: ['marketCap', 'price', 'todayPct', 'oneWeekPct', 'oneMonthPct',
    'threeMonthPct', 'sixMonthPct', 'oneYearPct', 'spark90', 'actionTrend', 'actionEntry',
    'vs50ma', 'vs200ma', 'maCrossRank', 'rsi', 'pctFromHigh', 'volTrend'] },
  { id: 'strfunda', name: 'Fundamentals', columns: ['price', 'sector', 'industry', 'marketCap', 'nextEarningsDate',
    'qualityScore', 'revenueTtm', 'grossMargin', 'netIncomeTtm', 'fcfMargin', 'netCash', 'earningsGrowthYoY',
    'revenueGrowthYoY', 'profitMargin', 'roe', 'forwardPe', 'peg'] },
  { id: 'stradvic', name: 'Advice', columns: ['marketCap', 'price', 'todayPct', 'oneMonthPct', 'companyType', 'actionTrend',
    'actionEntry', 'actionFund', 'actionGuards', 'av:Balanced', 'av:Trend Rider', 'av:Aggressive', 'av:Max Risk',
    'av:Dip Buyer'] },
];

function cleanViews(input) {
  const out = [];
  const names = new Set();
  const ids = new Set();
  for (const v of Array.isArray(input) ? input : []) {
    if (out.length >= VIEWS_MAX || !v || typeof v !== 'object') break;
    const name = String(v.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
    if (!name || names.has(name.toLowerCase())) continue;
    const cols = [];
    for (const c of Array.isArray(v.columns) ? v.columns : []) {
      const id = String(c);
      if (VIEW_COL_RE.test(id) && !cols.includes(id)) cols.push(id);
      if (cols.length >= VIEW_COLUMNS_MAX) break;
    }
    if (!cols.length) continue;
    let id = VIEW_ID_RE.test(String(v.id || '')) ? String(v.id) : '';
    while (!id || ids.has(id)) id = crypto.randomBytes(6).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(8, '0').slice(0, 8);
    names.add(name.toLowerCase());
    ids.add(id);
    out.push({ id, name, columns: cols });
  }
  return out;
}

// ---- screens ----------------------------------------------------------------------
// A screen is filters + a sort + the columns that explain the result, applied
// in one click from the screener's Screens menu. Starter screens only (the
// owner's decision): every account sees them, only the owner edits. Filter
// keys and column ids are shape-checked, never matched against a list — the
// page ignores what it does not know, the views rule. The seven /analysis
// screens are here, translated into filter-row grammar.
const SCREENS_MAX = 60;
// Any printable text. The grammar itself uses < and > (">=3", "<20") and every
// value is escaped where the page shows it; excluding < and > here once
// stripped the filters out of every screen that went through a save.
const SCREEN_FILTER_VAL_RE = /^[^\u0000-\u001f]{1,80}$/;
const ADVICE_COLS = ['companyType', 'actionTrend', 'actionEntry', 'actionFund', 'actionGuards',
  'av:Balanced', 'av:Trend Rider', 'av:Aggressive', 'av:Max Risk', 'av:Dip Buyer'];
const sc = (id, group, name, description, def) => ({ id, group, name, description, def });
const STARTER_SCREENS = [
  sc('daygainr', 'Market movers', 'Day gainers', 'Up 3% or more today.',
    { filters: { todayPct: '>=3' }, sort: { key: 'todayPct', dir: -1 },
      columns: ['todayPct', 'oneWeekPct', 'volX', 'dollarVolume', 'marketCap', 'av:Balanced'] }),
  sc('daylosrs', 'Market movers', 'Day losers', 'Down 3% or more today.',
    { filters: { todayPct: '<=-3' }, sort: { key: 'todayPct', dir: 1 },
      columns: ['todayPct', 'oneWeekPct', 'volX', 'dollarVolume', 'marketCap', 'av:Balanced'] }),
  sc('rec52hi0', 'Market movers', 'Recent 52-week highs', 'Set a new 52-week high in the last five sessions.',
    { filters: { daysSince52wHigh: '..4' }, sort: { key: 'oneMonthPct', dir: -1 },
      columns: ['daysSince52wHigh', 'pctFromHigh', 'oneMonthPct', 'threeMonthPct', 'actionTrend', 'actionEntry'] }),
  sc('rec52lo0', 'Market movers', 'Recent 52-week lows', 'Set a new 52-week low in the last five sessions.',
    { filters: { daysSince52wLow: '..4' }, sort: { key: 'oneMonthPct', dir: 1 },
      columns: ['daysSince52wLow', 'pctFromLow', 'oneMonthPct', 'threeMonthPct', 'actionTrend'] }),
  sc('mostactv', 'Market movers', 'Most active', 'Everything, by the value of shares traded today.',
    { filters: {}, sort: { key: 'dollarVolume', dir: -1 },
      columns: ['todayPct', 'volume', 'dollarVolume', 'volX', 'marketCap'] }),
  // ---- How it moved: the SHAPE of the year, not the size of the move -------
  // Steadiness (R^2 of log price against time), Crossings (times the price
  // crossed its own median) and Ulcer (RMS drawdown) are descriptive readings,
  // and this group is where they are findable rather than one screen deep under
  // Technical. EVERY THRESHOLD IS SIZED AGAINST THE LIVE UNIVERSE -- the 1,150
  // stocks holding a full year of bars -- because a screen returning nothing is
  // a dead box and one returning a fifth of the screen is not a screen.
  sc('strline0', 'How it moved', 'Climbing in a straight line', 'Up over the year, and it got there smoothly rather than in one jump. About 8% of the screen.',
    { filters: { steadiness: '>=80', oneYearPct: '>10' },
      sort: { key: 'steadiness', dir: -1 },
      columns: ['steadiness', 'ulcer', 'oneYearPct', 'sixMonthPct', 'actionTrend', 'av:Balanced'] }),
  // The case that Steadiness being DIRECTION-BLIND exists to make visible: a
  // stock falling in a ruler-straight line scores 100 too, and this is where
  // they show up instead of hiding among the smooth risers.
  sc('strdown0', 'How it moved', 'Falling in a straight line', 'Down over the year in a steady grind — the case a direction-blind steadiness reading is for. About 4%.',
    { filters: { steadiness: '>=80', oneYearPct: '<-10' },
      sort: { key: 'steadiness', dir: -1 },
      columns: ['steadiness', 'ulcer', 'oneYearPct', 'pctFromHigh', 'actionTrend', 'av:Balanced'] }),
  // Three legs, each excluding a different impostor: the net move rules out a
  // trender, the band rules out a rollercoaster oscillating across an 80% span,
  // and the crossings rule out a random walk that merely ended where it began.
  // Tightened from band<45/cross>=12, which matched 22% of the live screen.
  // Identification only -- range TRADING was tested on this archive and came
  // back flat, the faint direction running toward continuation rather than
  // reversion (docs/momentum-delta.md).
  sc('inrange0', 'How it moved', 'Trading in a range', 'Went nowhere over the year, inside a contained band, crossing its own median again and again. About 7%.',
    { filters: { oneYearPct: '-15..15', bandPct: '<30', crossings: '>=20' },
      sort: { key: 'crossings', dir: -1 },
      columns: ['crossings', 'bandPct', 'steadiness', 'oneYearPct', 'range52Pos', 'rsi', 'av:Balanced'] }),
  // What Ulcer is for, and what Steadiness cannot say on its own: the same gain
  // bought with a far worse ride.
  sc('roughup0', 'How it moved', 'Up, but a rough ride', 'Gained over the year and spent much of it well below its own high. About 4%.',
    { filters: { oneYearPct: '>20', ulcer: '>=20' },
      sort: { key: 'ulcer', dir: -1 },
      columns: ['ulcer', 'oneYearPct', 'steadiness', 'bandPct', 'range52Pos', 'av:Balanced'] }),
  sc('undgrwth', 'Value and growth', 'Undervalued growth', 'Earnings growing 25%+, forward P/E under 20, PEG under 1.',
    { filters: { earningsGrowthYoY: '>=25', forwardPe: '0..20', peg: '0..1' }, sort: { key: 'peg', dir: 1 },
      columns: ['earningsGrowthYoY', 'revenueGrowthYoY', 'forwardPe', 'peg', 'marketCap', 'oneMonthPct'] }),
  sc('growtech', 'Value and growth', 'Growth technology', 'Technology with revenue and earnings both growing 25%+.',
    { filters: { revenueGrowthYoY: '>=25', earningsGrowthYoY: '>=25' }, sector: 'Technology', sort: { key: 'revenueGrowthYoY', dir: -1 },
      columns: ['revenueGrowthYoY', 'earningsGrowthYoY', 'grossMargin', 'forwardPe', 'threeMonthPct'] }),
  sc('lrgvalue', 'Value and growth', 'Undervalued large caps', '$10B and up, forward P/E under 20, PEG under 1.',
    { filters: { marketCap: '>=10B', forwardPe: '0..20', peg: '0..1' }, sort: { key: 'forwardPe', dir: 1 },
      columns: ['marketCap', 'forwardPe', 'peg', 'profitMargin', 'roe'] }),
  sc('smallagg', 'Value and growth', 'Aggressive small caps', 'Under $2B with earnings growing 25%+.',
    { filters: { marketCap: '..2B', earningsGrowthYoY: '>=25' }, sort: { key: 'earningsGrowthYoY', dir: -1 },
      columns: ['marketCap', 'earningsGrowthYoY', 'revenueGrowthYoY', 'oneMonthPct'] }),
  sc('cheapgrw', 'Value and growth', 'Cheap, growing and profitable', 'Forward P/E under 20, revenue growing 15%+, net margin over 15%.',
    { filters: { forwardPe: '0..20', revenueGrowthYoY: '>15', profitMargin: '>15' }, sort: { key: 'forwardPe', dir: 1 },
      columns: ['forwardPe', 'revenueGrowthYoY', 'profitMargin', 'marketCap', 'oneMonthPct'] }),
  sc('disconct', 'Value and growth', "Business improving, price isn't", 'Revenue growing 25%+ while the price fell 10%+ over three months.',
    { filters: { revenueGrowthYoY: '>25', threeMonthPct: '<-10' }, sort: { key: 'revenueGrowthYoY', dir: -1 },
      columns: ['revenueGrowthYoY', 'threeMonthPct', 'oneMonthPct', 'grossMargin', 'forwardPe'] }),
  sc('breakout', 'Technical', 'Upside breakouts', 'First close above the 3-month high, on 1.5x normal volume or more.',
    { filters: { fresh3mHigh: 'Yes', volX: '>=1.5' }, sort: { key: 'volX', dir: -1 },
      columns: ['actionEntry', 'actionTrend', 'oneWeekPct', 'pctFromHigh', 'volX', 'av:Balanced'] }),
  sc('bullnow0', 'Technical', 'Bullish right now', 'Strong uptrend with a clean entry, on our own trend and entry rules.',
    { filters: { actionTrend: 'Strong uptrend', actionEntry: 'Clean' }, sort: { key: 'oneMonthPct', dir: -1 },
      columns: ['actionTrend', 'actionEntry', 'vs50ma', 'vs200ma', 'rsi', 'av:Balanced'] }),
  sc('bearnow0', 'Technical', 'Bearish right now', 'In a breakdown or a downtrend, on our own trend rules.',
    { filters: { actionTrend: 'Breakdown|Downtrend' }, sort: { key: 'oneMonthPct', dir: 1 },
      columns: ['actionTrend', 'vs200ma', 'oneMonthPct', 'threeMonthPct', 'av:Balanced'] }),
  sc('bouncelw', 'Technical', 'Bouncing off the lows', 'Low in the 52-week range, but up over the last month and fortnight.',
    { filters: { range52Pos: '..30', oneMonthPct: '>3', twoWeekPct: '>0' }, sort: { key: 'range52Pos', dir: 1 },
      columns: ['range52Pos', 'pctFromHigh', 'twoWeekPct', 'oneMonthPct', 'actionTrend'] }),
  sc('wakingup', 'Technical', 'Just started moving', 'Up more than 5% in a fortnight, still down over three months.',
    { filters: { twoWeekPct: '>5', threeMonthPct: '<0' }, sort: { key: 'twoWeekPct', dir: -1 },
      columns: ['twoWeekPct', 'oneMonthPct', 'threeMonthPct', 'actionTrend', 'actionEntry'] }),
  sc('overextd', 'Technical', 'Overextended', 'RSI above 75 and more than 12% above the 50-day average.',
    { filters: { rsi: '>75', vs50ma: '>12' }, sort: { key: 'rsi', dir: -1 },
      columns: ['rsi', 'vs50ma', 'oneMonthPct', 'actionEntry', 'av:Balanced'] }),
  sc('shorted0', 'Short interest', 'Most shorted', '10% or more of the float sold short.',
    { filters: { shortPctFloat: '>=10' }, sort: { key: 'shortPctFloat', dir: -1 },
      columns: ['shortPctFloat', 'todayPct', 'oneMonthPct', 'marketCap'] }),
  sc('earnsoon', 'Earnings', 'Reporting in the next 14 days', 'A catalyst and a risk in the same event.',
    { filters: { nextEarningsDate: '0..14' }, sort: { key: 'nextEarningsDate', dir: 1 },
      columns: ['nextEarningsDate', 'todayPct', 'oneMonthPct', 'actionGuards', 'av:Balanced'] }),
  sc('driftbet', 'Earnings', 'Drifting after a beat', 'Beat estimates by 10-100%, reported in the last three weeks.',
    { filters: { lastSurprise: '10..100', daysSinceEarnings: '0..21' }, sort: { key: 'lastSurprise', dir: -1 },
      columns: ['nextEarningsDate', 'twoWeekPct', 'oneMonthPct', 'av:Balanced'] }),
  sc('strngbuy', 'Advice', 'Strong Buys (Balanced)', 'The Balanced rules read Strong Buy — a mechanical reading, not an analyst rating.',
    { filters: {}, advice: 'Strong Buy', sort: { key: 'marketCap', dir: -1 },
      columns: ['marketCap', 'price', 'todayPct', 'oneMonthPct'].concat(ADVICE_COLS) }),
  sc('chgtoday', 'Advice', 'Advice changed today', 'The Balanced verdict moved since the previous session.',
    { filters: {}, changed: true, sort: { key: 'marketCap', dir: -1 },
      columns: ['marketCap', 'price', 'todayPct', 'oneMonthPct'].concat(ADVICE_COLS) }),
];

function cleanScreens(input) {
  const out = [];
  const ids = new Set();
  const names = new Set();
  const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
  for (const x of Array.isArray(input) ? input : []) {
    if (out.length >= SCREENS_MAX || !x || typeof x !== 'object') break;
    const name = str(x.name, 60);
    if (!name || names.has(name.toLowerCase())) continue;
    const d = x.def && typeof x.def === 'object' ? x.def : {};
    const filters = {};
    for (const [k, v] of Object.entries(d.filters && typeof d.filters === 'object' ? d.filters : {})) {
      if (Object.keys(filters).length >= 20) break;
      if (VIEW_COL_RE.test(k) && SCREEN_FILTER_VAL_RE.test(String(v))) filters[k] = String(v);
    }
    const columns = [];
    for (const c of Array.isArray(d.columns) ? d.columns : []) {
      if (VIEW_COL_RE.test(String(c)) && !columns.includes(String(c))) columns.push(String(c));
      if (columns.length >= VIEW_COLUMNS_MAX) break;
    }
    const def = { filters, columns };
    // `size` joins these because it gained a bar picker of its own: a screen
    // that could not carry it would silently drop the band when saved, and
    // applying a screen would leave a stale one in force.
    for (const k of ['sector', 'industry', 'advice', 'size']) {
      const v = str(d[k], 80);
      if (v && v !== 'All') def[k] = v;
    }
    // The advice move. `changed: true` is the pre-2026-09-23 Changed chip and
    // means exactly 'Moved'; it is kept verbatim rather than rewritten, so a
    // screen stored before the picker existed round-trips unchanged and an old
    // screener tab still reads it.
    if (Filters.MOVES.includes(String(d.move || ''))) def.move = String(d.move);
    else if (d.changed === true) def.changed = true;
    if (d.sort && VIEW_COL_RE.test(String(d.sort.key || ''))) def.sort = { key: String(d.sort.key), dir: d.sort.dir === 1 ? 1 : -1 };
    let id = VIEW_ID_RE.test(String(x.id || '')) ? String(x.id) : '';
    while (!id || ids.has(id)) id = crypto.randomBytes(6).toString('hex').slice(0, 8);
    ids.add(id);
    names.add(name.toLowerCase());
    out.push({ id, name, group: str(x.group, 30) || 'Screens', description: str(x.description, 200), def });
  }
  return out;
}

app.get('/api/screens', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  await store.seedScreensOnce(STARTER_SCREENS);
  res.json({ screens: await store.readScreens(), canEdit: await isAdmin(req) });
}));

app.put('/api/screens', requireAdmin, route(async (req, res) => {
  const list = cleanScreens(req.body && req.body.screens);
  await store.writeScreens(list);
  logAct(req, 'view', 'screens:' + list.length);
  res.json({ ok: true, screens: list });
}));

app.get('/api/views', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  await store.seedSharedViewsOnce(STARTER_VIEWS);
  const guest = await isGuest(req);
  const [shared, mine] = await Promise.all([
    store.readViews('shared'),
    guest ? Promise.resolve([]) : store.readViews(await prefsKey(req)),
  ]);
  res.json({ shared, mine, max: VIEWS_MAX, canEditShared: await isAdmin(req), canEditMine: !guest });
}));

app.put('/api/views/mine', requireMember, route(async (req, res) => {
  const key = await prefsKey(req);
  const mine = cleanViews(req.body && req.body.views);
  // an id may not shadow a shared view's, or the active-view pref could not tell them apart
  const sharedIds = new Set((await store.readViews('shared')).map((v) => v.id));
  for (const v of mine) if (sharedIds.has(v.id)) v.id = crypto.randomBytes(6).toString('hex').slice(0, 8);
  await store.writeViews(key, mine);
  logAct(req, 'view', 'mine:' + mine.length);
  res.json({ ok: true, mine, max: VIEWS_MAX });
}));

app.put('/api/views/shared', requireAdmin, route(async (req, res) => {
  const shared = cleanViews(req.body && req.body.views);
  await store.writeViews('shared', shared);
  logAct(req, 'view', 'shared:' + shared.length);
  res.json({ ok: true, shared });
}));

app.get('/api/my/portfolios', requireMember, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const mine = await store.readUserPortfolios(await prefsKey(req));
  // Filtered to the live universe on the way out too — a symbol dropped
  // since the last write must never render as a phantom row count.
  const universe = new Set((await readUniverse()));
  for (const name of Object.keys(mine)) mine[name] = mine[name].filter((x) => universe.has(x));
  res.json({ portfolios: mine, max: MY_PORTFOLIOS_MAX });
}));

app.put('/api/my/portfolios', requireMember, route(async (req, res) => {
  const key = await prefsKey(req);
  const universe = new Set((await readUniverse()));
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

// ---- today's most active, from Yahoo --------------------------------------
// The stored NASDAQ file carries a `volume` column, so "most active" looked
// like a sort we already had. It is not, for two measured reasons.
//
// FRESHNESS: that file is refreshed by hand, and on 2026-09-24 it was 9.9 days
// old — an "active today" ranking off a ten-day-old number is a wrong answer
// wearing a useful label.
//
// AND SHARE VOLUME IS THE WRONG MEASURE. Measured the same day, top 100 of
// each: NASDAQ by share volume gives 20 names under $1, 39 under $5 and 35
// under a $2B cap — the penny-stock end, which is the category the universe
// deliberately purged. Yahoo's most_actives gives 0 under $1 and 0 under $2B,
// every row `quoteType: EQUITY`, every row USD on a US exchange. The two
// top-100s share only 65 names, so this is a different list and not a filter
// of the same one.
//
// It is one unauthenticated call with no crumb — checked, since Yahoo has put
// neighbouring endpoints behind one — and `count=250` returns the whole list
// (166 today), so there is no paging.
const YAHOO_ACTIVE_URL = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved' +
  '?scrIds=most_actives&count=250&formatted=false';
const YAHOO_TIMEOUT_MS = 20000;
// Undocumented and outside our control, so the page must not go blank when it
// changes shape: a short cache, and a failure that degrades to a sentence.
const ACTIVE_TTL_MS = 60000;
let activeCache = { at: 0, payload: null };

const yNum = (v) => {
  const n = Number(v && typeof v === 'object' && 'raw' in v ? v.raw : v);
  return Number.isFinite(n) ? n : null;
};

// THE LISTING IS THE TEST, NOT THE DOMICILE — and this is the first place in
// the app that can actually apply it. The bulk-add path can only warn when a
// symbol is ABSENT from the NASDAQ file, never when it is present but resolves
// to a foreign exchange, which is exactly how BBX arrived as an Australian
// listing. Yahoo names the exchange, so a non-US one is dropped here.
const usListed = (ex) => /^(Nasdaq|NYSE)/i.test(String(ex || ''));

async function fetchMostActive() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), YAHOO_TIMEOUT_MS);
  let body;
  try {
    const res = await fetch(YAHOO_ACTIVE_URL, {
      headers: { 'User-Agent': NASDAQ_UA, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);
    body = await res.json();
  } finally {
    clearTimeout(timer);
  }
  const r = body && body.finance && body.finance.result && body.finance.result[0];
  const quotes = (r && r.quotes) || [];
  if (!quotes.length) throw new Error('Yahoo returned no rows');

  // Counted separately rather than summed, because "not a company" and "not
  // listed here" are different facts and the page says which.
  let notEquity = 0, notUs = 0;
  const rows = [];
  let asOf = null;
  for (const q of quotes) {
    if (q.quoteType !== 'EQUITY') { notEquity++; continue; }
    const ex = q.fullExchangeName || q.exchange;
    if (!usListed(ex) || (q.currency && q.currency !== 'USD')) { notUs++; continue; }
    const t = yNum(q.regularMarketTime);
    if (t && (!asOf || t > asOf)) asOf = t;
    const price = yNum(q.regularMarketPrice);
    const volume = yNum(q.regularMarketVolume);
    rows.push({
      symbol: String(q.symbol || '').trim().toUpperCase().slice(0, 20),
      // Deliberately the SAME field names the stored listing uses, so the page
      // sorts, filters, ticks and adds these rows with no second code path.
      exchange: nasdaqText(ex),
      name: nasdaqText(q.shortName || q.longName),
      last_sale: price,
      net_change: yNum(q.regularMarketChange),
      pct_change: yNum(q.regularMarketChangePercent),
      market_cap: yNum(q.marketCap),
      country: null, ipo_year: null, sector: null, industry: null,
      volume,
      // The honest ranking, and the reason this list is worth having: it is
      // what separates a company from a penny stock trading hands all day.
      dollar_volume: price != null && volume != null ? Math.round(price * volume) : null,
      url: null,
    });
  }
  if (!rows.length) throw new Error('Yahoo returned rows but none were US-listed equities');
  return { rows, asOf: asOf ? asOf * 1000 : null, dropped: { notEquity, notUs }, source: 'Yahoo Finance' };
}

app.get('/api/active', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const fresh = req.query.fresh === '1';
  if (!fresh && activeCache.payload && Date.now() - activeCache.at < ACTIVE_TTL_MS) {
    return res.json({ ...activeCache.payload, cached: true });
  }
  try {
    const payload = await fetchMostActive();
    activeCache = { at: Date.now(), payload };
    res.json({ ...payload, cached: false });
  } catch (err) {
    // A source we do not control must not take the page down: say what failed
    // and let the stored listing still be usable beside it.
    res.status(502).json({ error: `Could not read the most-active list: ${err.message}` });
  }
}));

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
  res.json(await portfolioAnswer());
}));

// Every portfolio edit answers with both, so a page can reconcile its rows
// (the universe) and its badges (the portfolios) from one response.
async function portfolioAnswer(extra = {}) {
  const [portfolios, universe] = await Promise.all([readPortfolios(), readUniverse()]);
  return { portfolios, universe, ...extra };
}

// Cache the company name once (1 credit) so refreshes stay history-only.
// It is returned as well: adding a ticker does not trigger a price pull, so
// this lookup is the only thing that touches the symbol before the next
// Refresh, and a name coming back empty is the earliest hint of a typo.
async function nameForNewTicker(symbol) {
  let name = (await readNames())[symbol] || null;
  if (API_KEY && !name) {
    name = await fetchName(symbol);
    if (name) await writeNames({ [symbol]: name });
  }
  return name;
}

// Bulk add from the NASDAQ list (2026-09-15). Symbols are NASDAQ's spelling:
// a class share's slash becomes the dot the data provider uses (BRK/B ->
// BRK.B), and preferred shares (WFC^Z) are refused — the provider does not
// price them. Names come from the NASDAQ listing, trimmed of the instrument
// words, and only where no name is stored — so a bulk add costs no credits.
// The company data arrives with the next Fill missing or nightly run.
const BULK_ADD_MAX = 500;
// How long one bulk-delete request may spend removing, against the platform's
// ~300s hard kill. Deliberately a third of it: the tail (the portfolio answer,
// which re-reads the universe) still has to fit, and a symbol's cost varies
// from 200ms to 13s depending on how deep its archive is.
// The floor is 1ms, not something comfortable: the loop always does at least
// one symbol whatever the clock says, so a small value is merely slow (one
// stock per pass) and never unsafe. A comfortable-looking floor would only
// have made the continuation untestable, which is how it shipped unexercised.
const BULK_DELETE_PHASE_MS = Math.max(1, Number(process.env.BULK_DELETE_MS) || 100000);
const nasdaqToSymbol = (s) => String(s || '').trim().toUpperCase().replace(/\//g, '.');
const cleanListingName = (n) => String(n || '').trim()
  .replace(/\s+(American Depositary Shares?|American Depositary Receipts?|Sponsored ADR)\b.*$/i, '')
  .replace(/\s+(Common Stock|Capital Stock|Ordinary Shares|Common Shares|Class [A-Z] Ordinary Shares)$/i, '')
  .trim() || null;

// Check a pasted batch before adding it. Costs no API credits and changes
// nothing: it says which symbols the screener already has and which the NASDAQ
// listing has never heard of, because free text splits into symbol-shaped
// tokens and "not a ticker!" would otherwise become three stocks.
app.post('/api/universe/check', requireAdmin, route(async (req, res) => {
  const raw = Array.isArray(req.body?.symbols) ? req.body.symbols : [];
  if (raw.length > BULK_ADD_MAX * 2) return res.status(400).json({ error: 'Too many to check.' });
  const syms = [...new Set(raw.map((x) => nasdaqToSymbol(x)).filter((x) => SYMBOL_RE.test(x)))];
  let known = new Set();
  try { known = await store.knownListings(syms); } catch { known = null; }
  const have = new Set(await readUniverse());
  res.json({
    inUniverse: syms.filter((x) => have.has(x)),
    // null when the listing table is empty or unreadable, so the page can say
    // "not checked" rather than flagging everything as unknown.
    unlisted: known ? syms.filter((x) => !known.has(x)) : null,
    listingRows: known ? known.size : null,
  });
}));

app.post('/api/universe/bulk', requireAdmin, route(async (req, res) => {
  const raw = Array.isArray(req.body?.symbols) ? req.body.symbols : [];
  if (!raw.length) return res.status(400).json({ error: 'No symbols given.' });
  if (raw.length > BULK_ADD_MAX) return res.status(400).json({ error: `At most ${BULK_ADD_MAX} at a time.` });
  const pname = String(req.body?.portfolio || '').trim();

  const invalid = [];
  const wanted = [];
  const seen = new Set();
  for (const r of raw) {
    const sym = nasdaqToSymbol(r);
    if (!SYMBOL_RE.test(sym)) { invalid.push(String(r).slice(0, 16)); continue; }
    if (!seen.has(sym)) { seen.add(sym); wanted.push(sym); }
  }

  // Read BEFORE the portfolio write: writePortfolios() records members in the
  // universe, so reading after it would report every new stock as already there.
  const before = new Set(await readUniverse());
  let createdPortfolio = null;
  let target = pname;
  if (pname) {
    const p = await readPortfolios();
    // Case-INSENSITIVE, matching POST /api/portfolios: typing "semis" when
    // "Semis" exists must land in the existing list, not make a second one.
    const existing = Object.keys(p).find((n) => n.toLowerCase() === pname.toLowerCase());
    if (existing) target = existing;
    else {
      // Creating one takes an EXPLICIT flag. A batch is pasted, and a typo in
      // the portfolio name would otherwise leave a junk list behind with the
      // whole batch quietly inside it. The UI confirms before sending this;
      // a scripted call has to mean it.
      if (!req.body?.createPortfolio) {
        return res.status(404).json({ error: `No portfolio called "${pname}". `
          + 'Send createPortfolio: true to make one.', unknownPortfolio: pname });
      }
      if (pname.length > 40) return res.status(400).json({ error: 'Name too long (max 40 chars).' });
      p[pname] = [];
      createdPortfolio = pname;
    }
    p[target] = [...p[target], ...wanted.filter((sym) => !p[target].includes(sym))];
    await writePortfolios(p);
    if (createdPortfolio) logAct(req, 'portfolio', 'create:' + createdPortfolio.slice(0, 40));
  }
  // New = not in the screener before this request (the portfolio write may
  // already have inserted them, so the insert's own count cannot say).
  const added = wanted.filter((sym) => !before.has(sym));
  await store.addManyToUniverse(added);
  const already = wanted.filter((sym) => before.has(sym));

  // Names for the new ones, from the listing, where none is stored.
  if (added.length) {
    try {
      const [names, listings] = await Promise.all([readNames(), store.readNasdaqListings()]);
      const bySym = new Map(listings.map((l) => [nasdaqToSymbol(l.symbol), l.name]));
      // A stock added from the LIVE most-active list is not in that file, so it
      // would arrive as a bare ticker until the next profile pull named it.
      // The names came from the provider server-side and are already in hand;
      // the cache object is kept past its TTL (only reads check the age), so it
      // still answers for a page that has been open a while. Second, not first:
      // the stored listing stays the authority where it has an entry.
      if (activeCache.payload) {
        for (const r of activeCache.payload.rows) {
          if (r.name && !bySym.has(r.symbol)) bySym.set(r.symbol, r.name);
        }
      }
      const fill = {};
      for (const sym of added) {
        const nm = cleanListingName(bySym.get(sym));
        if (!names[sym] && nm) fill[sym] = nm;
      }
      if (Object.keys(fill).length) await writeNames(fill);
    } catch (err) {
      console.warn('bulk add: names skipped:', err.message);   // a name never fails an add
    }
  }
  logAct(req, 'portfolio', (`bulk-add:+${added.length}` + (pname ? '>' + pname : '')).slice(0, 80));
  // `createdPortfolio` and `target` so the caller can say what actually
  // happened -- "added to Semis" reads differently from "created Semis".
  res.json(await portfolioAnswer({ added, already, invalid,
    portfolio: target || null, createdPortfolio }));
}));

// Add a stock to the screener, optionally into a portfolio as well.
app.post('/api/universe', requireAdmin, route(async (req, res) => {
  const symbol = String(req.body?.symbol || '').trim().toUpperCase();
  const pname = String(req.body?.portfolio || '').trim();
  if (!symbol) return res.status(400).json({ error: 'Symbol is required.' });
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol format.' });
  const already = (await readUniverse()).includes(symbol);
  if (pname) {
    const p = await readPortfolios();
    if (!(pname in p)) return res.status(404).json({ error: 'Theme not found.' });
    if (p[pname].includes(symbol)) return res.status(409).json({ error: `${symbol} is already in "${pname}".` });
    p[pname].push(symbol);
    await writePortfolios(p);
  } else if (already) {
    return res.status(409).json({ error: `${symbol} is already in the screener.` });
  }
  await store.addToUniverse(symbol);
  const name = await nameForNewTicker(symbol);
  logAct(req, 'portfolio', ('add:' + symbol + (pname ? '>' + pname : '')).slice(0, 80));
  res.json(await portfolioAnswer({ name, added: !already }));
}));

// Create an empty portfolio.
app.post('/api/portfolios', requireAdmin, route(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Theme name is required.' });
  if (name.length > 40) return res.status(400).json({ error: 'Name too long (max 40 chars).' });
  const p = await readPortfolios();
  if (Object.keys(p).some((n) => n.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: `Theme "${name}" already exists.` });
  }
  p[name] = [];
  await writePortfolios(p);
  logAct(req, 'portfolio', 'create:' + name.slice(0, 40));
  res.json(await portfolioAnswer());
}));

// The order themes are shown in, everywhere. `position` has always been an
// explicit column and has always been honoured; there was just no way to set
// it. writePortfolios assigns position from key order, so this is the same map
// rebuilt in the order asked for — no membership is touched.
//
// Names the client does not mention keep their existing order AFTER the ones
// it does, so a stale tab cannot silently drop a theme created since it loaded.
app.put('/api/portfolios/order', requireAdmin, route(async (req, res) => {
  const asked = Array.isArray(req.body?.names) ? req.body.names.map((x) => String(x)) : null;
  if (!asked) return res.status(400).json({ error: 'Send { names: [...] }.' });
  const current = await readPortfolios();
  const known = new Set(Object.keys(current));
  const out = {};
  for (const n of asked) if (known.has(n) && !(n in out)) out[n] = current[n];
  const missing = Object.keys(current).filter((n) => !(n in out));
  for (const n of missing) out[n] = current[n];
  await writePortfolios(out);
  logAct(req, 'portfolio', 'reorder:' + Object.keys(out).length);
  res.json({ ...(await portfolioAnswer()), reordered: Object.keys(out).length, appended: missing.length });
}));

// Rename a portfolio (preserves order + membership).
app.put('/api/portfolios/:name', requireAdmin, route(async (req, res) => {
  const oldName = decodeURIComponent(req.params.name);
  const newName = String(req.body?.newName || '').trim();
  if (!newName) return res.status(400).json({ error: 'New name is required.' });
  if (newName.length > 40) return res.status(400).json({ error: 'Name too long (max 40 chars).' });
  const p = await readPortfolios();
  if (!(oldName in p)) return res.status(404).json({ error: 'Theme not found.' });
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
  res.json(await portfolioAnswer());
}));

// Delete a portfolio. Its stocks stay in the screener: the universe is its own
// table, and writePortfolios() records every member there before the
// memberships are replaced. Nothing is purged.
app.delete('/api/portfolios/:name', requireAdmin, route(async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const p = await readPortfolios();
  if (!(name in p)) return res.status(404).json({ error: 'Theme not found.' });
  delete p[name];
  await writePortfolios(p);
  logAct(req, 'portfolio', 'delete:' + name.slice(0, 40));
  res.json(await portfolioAnswer({ purged: [] }));
}));

// Add a ticker to a portfolio (and so to the screener, if it is new).
app.post('/api/portfolios/:name/tickers', requireAdmin, route(async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const symbol = String(req.body?.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'Symbol is required.' });
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol format.' });
  const p = await readPortfolios();
  if (!(name in p)) return res.status(404).json({ error: 'Theme not found.' });
  if (p[name].includes(symbol)) {
    return res.status(409).json({ error: `${symbol} is already in "${name}".` });
  }
  p[name].push(symbol);
  await writePortfolios(p);
  const name_ = await nameForNewTicker(symbol);
  logAct(req, 'portfolio', 'add:' + symbol + '>' + name.slice(0, 40));
  res.json(await portfolioAnswer({ name: name_ }));
}));

// Take a ticker out of one portfolio. It stays in the screener.
// Remove a PASTED LIST of stocks from the screener, data and all.
//
// DRY RUN BY DEFAULT — `commit: true` has to be sent explicitly, the same rule
// purge-orphans.js follows for the same operation, and the UI cannot send it
// until a preview has come back.
//
// The preview exists because of a hazard this project has already recorded:
// free text splits into symbol-shaped tokens, and `not a ticker!` becomes NOT,
// A and TICKER — and **A is Agilent**. On the ADD side that costs a wrong
// stock in the screener. Here it would delete a real company's history, so the
// preview names every company it matched and the count of recorded fundamentals
// days each one would lose. Nothing about a symbol's LENGTH or SHAPE can tell a
// header row from a ticker; only the name can.
app.post('/api/universe/bulk-delete', requireAdmin, route(async (req, res) => {
  const raw = Array.isArray(req.body?.symbols) ? req.body.symbols : [];
  if (!raw.length) return res.status(400).json({ error: 'No symbols given.' });
  if (raw.length > BULK_ADD_MAX) return res.status(400).json({ error: `At most ${BULK_ADD_MAX} at a time.` });
  const commit = req.body?.commit === true;

  const invalid = [];
  const wanted = [];
  const seen = new Set();
  for (const r of raw) {
    const sym = nasdaqToSymbol(r);
    if (!SYMBOL_RE.test(sym)) { invalid.push(String(r).slice(0, 16)); continue; }
    if (!seen.has(sym)) { seen.add(sym); wanted.push(sym); }
  }

  const universe = new Set(await readUniverse());
  const found = wanted.filter((s) => universe.has(s));
  // Shape-valid but not in the screener. Worth showing rather than ignoring:
  // a pasted column of something else lands here, and a list that is mostly
  // unmatched is the signal that the wrong column was copied.
  const unknown = wanted.filter((s) => !universe.has(s));

  const [names, fund, portfolios] = await Promise.all([
    store.readNamesFull().catch(() => ({})),
    store.fundamentalsDaysFor(found).catch(() => new Map()),
    readPortfolios().catch(() => ({})),
  ]);
  const themesOf = (sym) => Object.keys(portfolios).filter((n) => (portfolios[n] || []).includes(sym));
  const rows = found.map((sym) => {
    const n = names[sym] || {};
    const f = fund.get(sym) || null;
    return {
      symbol: sym,
      // readNamesFull answers with `short`, not `shortName`. Getting that wrong
      // would blank every company name in the preview — and the name IS the
      // guard here, so it would quietly remove the only defence this screen has.
      name: n.short || n.name || null,
      themes: themesOf(sym),
      fundDays: f ? f.days : 0,
      fundFrom: f ? f.from : null,
    };
  });
  const fundTotal = rows.reduce((a, r) => a + r.fundDays, 0);

  if (!commit) {
    return res.json({ dryRun: true, found: rows, unknown, invalid,
      fundDays: fundTotal, max: BULK_ADD_MAX });
  }

  // ---- the destructive half ------------------------------------------------
  // BOUNDED BY A DEADLINE, and the page loops. A removal is ~2 round trips a
  // symbol after the purge was batched, but one symbol with a deep archive was
  // measured at 13 SECONDS, so no fixed count is safe — the work per stock
  // varies by orders of magnitude. Without this the request ran past the
  // platform's 300s ceiling and was killed mid-list: every symbol it had
  // reached was already gone (each commits as it goes) while the log line at
  // the end never ran, so the operation both half-succeeded and left no record
  // of having done so. This is the shape every long job here uses — the
  // refresh rounds, the news batches: do what fits, say what is left.
  const deadline = Date.now() + BULK_DELETE_PHASE_MS;
  const purged = [];
  const failed = [];
  const remaining = [];
  for (const [i, sym] of found.entries()) {
    // ALWAYS DO AT LEAST ONE, whatever the clock says. A request that removes
    // nothing and asks to be called again with the same list is a livelock,
    // and the page's no-progress guard would stop the whole operation dead.
    // Forward progress is guaranteed here rather than hoped for.
    if (i > 0 && Date.now() > deadline) { remaining.push(sym); continue; }
    try {
      await store.removeFromUniverse(sym);
      try {
        purged.push(await store.purgeSymbol(sym));
      } catch (err) {
        // The removal stands even when the sweep fails — losing the edit
        // because the cleanup broke would be worse, and purge-orphans.js
        // collects what is left. The bars rule.
        console.warn(`purge ${sym} failed (removed anyway): ${err.message}`);
      }
    } catch (err) {
      failed.push(sym);
      console.warn(`bulk delete: ${sym} failed: ${err.message}`);
    }
  }
  const removed = found.filter((s) => !failed.includes(s) && !remaining.includes(s));
  // One activity row for the batch, capped, not one per symbol: the log is a
  // record of who did what, not somewhere to put a 500-line list.
  logAct(req, 'portfolio', 'bulk-remove:' + removed.length + ':' + removed.slice(0, 12).join(','));
  const rowsGone = purged.reduce((a, p) => a + (p.total || 0), 0);
  console.log(`bulk delete: ${removed.length} symbols, ${rowsGone.toLocaleString()} rows, ` +
    `${fundTotal} recorded fundamentals days`);
  res.json(await portfolioAnswer({
    purged, removed, failed, unknown, invalid, fundDays: fundTotal, rowsGone,
    // What this request did not reach. The page sends it straight back; the
    // operation is idempotent, so a repeat costs nothing but is never needed.
    remaining, done: remaining.length === 0,
  }));
}));

app.delete('/api/portfolios/:name/tickers/:symbol', requireAdmin, route(async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  const p = await readPortfolios();
  if (!(name in p)) return res.status(404).json({ error: 'Theme not found.' });
  p[name] = p[name].filter((s) => s !== symbol);
  await writePortfolios(p);
  logAct(req, 'portfolio', 'remove:' + symbol + '<' + name.slice(0, 40));
  res.json(await portfolioAnswer({ purged: [] }));
}));

// Remove a stock from the screener: out of the universe and every portfolio,
// and its data with it — bars, fundamentals history, the cached profile, the
// name and its headlines. Bars come back for a credit; FUNDAMENTALS HISTORY
// CANNOT BE REBUILT (the API only returns today's numbers), so re-adding the
// ticker starts that series over. The counts are returned for that reason.
app.delete('/api/tickers/:symbol', requireAdmin, route(async (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol format.' });
  await store.removeFromUniverse(symbol);
  logAct(req, 'portfolio', 'remove:' + symbol);
  const purged = [];
  try {
    const r = await store.purgeSymbol(symbol);
    purged.push(r);
    console.log(`purged ${r.symbol}: ${r.total.toLocaleString()} rows — ` +
      (Object.entries(r.removed).map(([t, n]) => `${t} ${n.toLocaleString()}`).join(', ') || 'nothing stored'));
  } catch (err) {
    // Losing the removal because the cleanup failed would be worse than
    // leaving rows behind; purge-orphans.js sweeps them up later.
    console.warn(`purge ${symbol} failed (the ticker was still removed):`, err.message);
  }
  res.json(await portfolioAnswer({ purged }));
}));

// Expire the per-symbol profile cache (sector / fundamentals) so the
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
  const universe = (await readUniverse());
  const gaps = profileGaps(universe, await readProfiles());
  const dates = await store.barsMaxDates(universe);
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
  // Fast refresh: the same stocks as a Refresh all, but the rounds ONLY fetch
  // profiles. The table is rebuilt once, at the end. A Refresh all rebuilds it
  // on every round — a year of bars for the whole universe, rescored and
  // rewritten — to fold in the seven profiles that round fetched; measured
  // 2026-09-16, that is ~46s of the 108s a round takes at 271 stocks, and it
  // is what makes a 1,000-stock sweep a five-hour job rather than a
  // two-and-a-half-hour one. The wait itself cannot go: 80 credits a profile
  // against 610 a minute is seven a minute whatever we do.
  if (req.query.mode === 'fast' || req.body?.mode === 'fast') {
    logAct(req, 'refresh', 'fast');
    const expiredFast = await expireProfiles();
    const totalFast = (await readUniverse()).length;
    const runIdFast = await trackSafe(store.startRun({ kind: 'fast', trigger: 'manual',
      actor: who ? who.email : null, total: totalFast, targets: totalFast }));
    await beginRefresh(who ? who.email : null, totalFast, 'fast', runIdFast);
    return res.json({ ok: true, mode: 'fast', runId: runIdFast, expired: expiredFast, total: totalFast });
  }
  // Refresh prices: the ordinary price refresh, but as a tracked RUN so it can
  // take more than one round. It expires no profiles — this is about prices —
  // and deliberately does NOT stamp prices_at, which is what keeps every round
  // a price round until the last slice is in.
  //
  // It became a run on 2026-09-22 because a single request stopped fitting: one
  // round priced the whole 610-credit budget and the work overran the 300s
  // ceiling. `priced` already existed to carry a price sweep across rounds; the
  // plain path simply never created the state that uses it, so it always
  // started from zero and tried to do the maximum.
  if (req.query.mode === 'prices' || req.body?.mode === 'prices') {
    const totalP = (await readUniverse()).length;
    logAct(req, 'refresh', 'prices');
    const runIdP = await trackSafe(store.startRun({ kind: 'refresh', trigger: 'manual',
      actor: who ? who.email : null, total: totalP, targets: totalP }));
    await beginRefresh(who ? who.email : null, totalP, 'prices', runIdP);
    return res.json({ ok: true, mode: 'prices', runId: runIdP, total: totalP,
      rounds: Math.ceil(totalP / PRICE_SLICE) });
  }
  logAct(req, 'refresh', 'all');
  const expired = await expireProfiles();
  const total = (await readUniverse()).length;
  const runId = await trackSafe(store.startRun({ kind: 'all', trigger: 'manual',
    actor: who ? who.email : null, total, targets: total }));
  await beginRefresh(who ? who.email : null, total, null, runId);
  res.json({ ok: true, runId, expired, total });
}));

// One round of a Fast refresh: fetch the next slice of profiles, store them,
// report progress. No bars are read, nothing is scored and no snapshot is
// written — the loop calls the ordinary round once at the end for that, which
// is where the report and the email come from, exactly as a Refresh all ends.
//
// Stopping mid-run loses nothing: the profiles fetched so far are stored, and
// the next refresh of any kind picks them up.
app.get('/api/refresh-profiles', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const asked = Number(req.query.run) || null;
  if (asked && (await trackSafe(store.runStatus(asked))) === 'stopped') {
    return res.json({ stopped: true, runId: asked });
  }
  const running = await readRefreshState();
  const runId = (running && running.runId) || asked;
  const universe = await readUniverse();
  const started = Date.now();
  const T = phaseTimer();
  const { r: profiles, m } = await metered(() => ensureProfiles(universe, PROFILE_CAP_ARCHIVE_ROUND));
  T.mark('profiles');
  const loaded = universe.filter((sym) => profiles[sym] && profiles[sym].fetchedAt).length;
  await recordRound(runId, { archivePrices: true }, m, Date.now() - started,
    { loaded, total: universe.length, phases: T.steps() });
  // Progress only: the run is closed by the rebuild round, not here.
  if (running) await noteRefreshProgress(loaded, universe.length);
  // The flag, with this round's counts folded in, so a light round is a DROP-IN
  // for the pages that draw progress from an ordinary one. Without it the
  // screener's Fill missing drew `refreshing: undefined` every round and blanked
  // its own banner for the length of the run.
  res.json({ loaded, total: universe.length, done: loaded >= universe.length, runId,
    refreshing: running ? { ...running, loaded, total: universe.length } : null });
}));

// One round of a price sweep: fetch the next slice's bars, archive them, move
// the marker on. NOTHING ELSE — no 650-day window, no scoring, no snapshot.
//
// That window is the reason this exists. Measured against production at 767
// stocks it is 290,277 rows and 30-60s, and an ordinary round pays it EVERY
// time regardless of how many symbols it prices — which is why capping the
// price slice at 500 did not rescue the plain Refresh and it still 504'd. The
// rebuild pays it once, at the end, where it is affordable: Fill missing's
// closing round did exactly that work in 102s.
// ONE SLICE OF PRICES: fetch it, archive it, move the cursor on. The body was
// inline in /api/refresh-prices until the intraday schedule needed the same
// round — and a second copy of "price the next slice" is exactly the drift
// this file keeps paying for.
//
// The caller owns the run record and the response, because the two callers
// differ there and nowhere else: the admin loop reports progress against a
// multi-round run, the schedule attaches its rounds to one run per slot.
async function runPriceSlice() {
  const started = Date.now();
  const opts = await liveRefreshOpts();
  const universe = await readUniverse();
  // `priceSlice: null` means "price EVERYTHING" — liveRefreshOpts' own
  // convention, and what any universe smaller than PRICE_SLICE gets, since the
  // first slice already covers it. Reading it as "nothing left to price" made
  // this round answer `done` having priced nothing at all, and silently: the
  // rebuild then serves yesterday's closes and the run is recorded complete.
  // Invisible at 767 stocks against a 500 slice; it bites the moment the
  // universe drops under the slice, which a ticker purge can do at any time.
  const slice = opts.priceSlice || (opts.priceTotal != null ? universe : null);
  // Nothing left to price: say so rather than pulling the first slice again.
  if (opts.archivePrices || !slice) return { nothing: true, opts, universe };
  const deadline = Date.now() + PRICE_PHASE_MS;
  const T = phaseTimer();
  const { r: out, m } = await metered(async () => {
    // SHALLOW for everyone, then repair. The alternative — deciding deep vs
    // light by loading each symbol's archive — is the 470-day read this round
    // exists to avoid; the newest stored date per symbol is one indexed seek.
    const newest = await store.barsMaxDates(slice);
    T.mark('archive-dates');
    const light = await pullPricesFor(slice, () => `&outputsize=${LIGHT_BARS}`, deadline);
    T.mark('prices');
    if (light.refusal) return light.refusal;
    const got = light.got;
    const dOf = (b) => String(b.datetime).slice(0, 10);
    // A SHALLOW WINDOW IS ONLY USABLE IF IT MEETS THE ARCHIVE. Without this,
    // persistBars reads "no overlap" as "rebuild this symbol from the fetch"
    // and twelve bars would replace years of history. A symbol with no archive
    // at all fails the test too, which is what a newly added ticker needs.
    const stragglers = slice.filter((sym) => {
      const v = got[sym] && got[sym].values;
      if (!Array.isArray(v) || !v.length) return true;
      // barsMaxDates answers with an OBJECT, `{ maxDate }`. This read the object
      // itself — `String(have)` is '[object Object]', and '[object Ob' is never
      // less than a date, so the STALENESS half of this guard had never once
      // fired: only the no-archive-at-all case did. A symbol whose archive
      // existed but sat behind the shallow window therefore fell through to
      // persistBars, which reads "no overlap" as "rebuild from the fetch" —
      // and twelve bars replaced years, which is the exact disaster the
      // comment above says this guard prevents.
      const have = newest.get(sym);
      const held = have && have.maxDate ? String(have.maxDate).slice(0, 10) : null;
      return !held || held < dOf(v[v.length - 1]);
    });
    if (stragglers.length) {
      console.warn(`prices: ${stragglers.length} symbol(s) did not meet the archive, re-pulling deep`);
      const redo = await pullPricesFor(stragglers, () => `&outputsize=${DEEP_BARS}`, deadline);
      T.mark('deep-repair');
      if (redo.refusal) return redo.refusal;
      Object.assign(got, redo.got);
    }
    const bars = await persistBars(slice, got, T);
    T.mark('persist-bars');
    console.log(`bars: +${bars.inserted} rows across ${bars.symbols} symbols ` +
                `in ${bars.trips} write round trips`);
    // Only the symbols the provider actually SERVED are stamped as pulled —
    // a chunk that failed must not claim to have been priced.
    const served = Object.keys(got).filter(
      (sym) => got[sym] && Array.isArray(got[sym].values) && got[sym].values.length);
    if (served.length) await store.notePricePull(served).catch(() => {});
    T.mark('price-clock');
    return { ok: true, bars, served: served.length };
  });
  if (!out.ok) return { ok: false, out, m, ms: Date.now() - started, opts, T };
  // Advances `priced`, and stamps prices_at once the last slice is in — which
  // is what tells the loop the sweep is over.
  await notePriceRound(opts);
  return { ok: true, out, m, ms: Date.now() - started, opts, T };
}

app.get('/api/refresh-prices', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const asked = Number(req.query.run) || null;
  if (asked && (await trackSafe(store.runStatus(asked))) === 'stopped') {
    return res.json({ stopped: true, runId: asked });
  }
  const running = await readRefreshState();
  const runId = (running && running.runId) || asked;
  const r = await runPriceSlice();
  if (r.nothing) {
    return res.json({ priced: r.universe.length, total: r.universe.length, done: true, runId,
      refreshing: running });
  }
  if (!r.ok) {
    await recordRound(runId, r.opts, r.m, r.ms,
      { error: r.out.error, refused: r.out.status === 429, phases: r.T.steps() });
    return res.status(r.out.status).json({ error: r.out.error });
  }
  const after = await readRefreshState();
  await recordRound(runId, r.opts, r.m, r.ms,
    { loaded: r.opts.pricedAfter, total: r.opts.priceTotal, phases: r.T.steps() });
  res.json({ priced: r.opts.pricedAfter, total: r.opts.priceTotal,
    served: r.out.served, done: !after || !!after.pricesAt, runId, refreshing: after });
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
  const [refreshing, updatedAt] = await Promise.all([readRefreshState(), store.snapshotUpdatedAt()]);
  res.json({ refreshing, updatedAt });
}));

// ---- Standing aside while a refresh runs -----------------------------------
//
// The research and diagnostic pages read the archive in one gulp: the trend
// sweep is 76,531 rows, the advice backtest ~157,000 bars, /database's counts
// touch every one of the 1.7M, and the data-quality rollups about 33,000. A
// refresh round reads 118,671 of its own and, unlike a page, CANNOT WAIT — on
// this platform the tail has to finish before the response, and the nightly
// job gives up after three rounds without progress.
//
// That is not hypothetical. On 2026-09-19 the nightly reported failure over
// data that was perfect, because work competing for the same database pushed
// the round past its deadline. A page is a click; a nightly run is a night.
//
// So the heavy reads stand aside rather than compete. A 503 naming the run and
// its progress is a better answer than a page that spends four minutes and
// then fails anyway.
//
// WHAT THIS COVERS, EXACTLY — and the gap is deliberate. readRefreshState() is
// non-null only while a MULTI-ROUND run is live: Refresh all, Fill missing,
// Fast refresh, the nightly. A plain price Refresh writes no state row on
// purpose, because a row there raises the "refreshing" banner for every
// viewer, and there are thirteen intraday runs a trading day. Those are ~30
// seconds each and are not the hazard; the 25-minute run is.
//
// No override, and none is needed: readRefreshState() ages the flag out after
// REFRESH_STALE_MS, so a run that dies mid-flight cannot lock these pages out.
const BUSY_TTL_MS = 5000;
let busyCache = null;

// One answer per five seconds, so a page firing several guarded calls pays one
// round trip rather than one each. A failure to READ the flag counts as NOT
// busy: a database hiccup must not be able to lock out the research pages, and
// the refresh itself is no worse off than it was before this existed.
async function refreshBusy() {
  if (busyCache && Date.now() - busyCache.at < BUSY_TTL_MS) return busyCache.state;
  let state = null;
  try { state = await readRefreshState(); } catch (e) { state = null; }
  busyCache = { at: Date.now(), state };
  return state;
}

// The first line of a heavy handler:  if (await standAside(res)) return;
// Returns true when it has already answered the request.
async function standAside(res) {
  const st = await refreshBusy();
  if (!st) return false;
  // The same naming the intraday cron's own skip uses, so two surfaces cannot
  // describe the same run differently.
  const name = st.mode === 'missing' ? 'Fill missing'
    : st.mode === 'fast' ? 'Fast refresh'
      : st.mode === 'prices' ? 'Refresh prices' : 'Refresh all';
  const at = st.total ? ` — ${st.loaded || 0} of ${st.total} stocks so far` : '';
  res.set('Retry-After', '120');
  res.status(503).json({
    error: `${name} is running${at}. This page reads a large slice of the archive in one go, `
      + 'and doing that now would slow the run down or break it — so it is standing aside. '
      + 'Try again once the run finishes; progress is on the Refresh runs page.',
    refreshing: st,
    busy: true,
  });
  return true;
}

// ---- API: stocks (the screener data) ---------------------------------------

// Compute the full screener payload live from the API. As-of mode (asOf set)
// recomputes the row as it looked on that date (plus forward returns); fundamentals
// are skipped — they aren't point-in-time. Returns {ok, payload} or {ok:false, status, error}.
// Where a refresh round's wall clock goes. One line per round in the logs —
// added 2026-09-15, when a plain refresh went from 15s to 140s after the bar
// archive tripled and there was no way to tell which phase had slowed.
function phaseTimer() {
  const t = {};
  let last = Date.now();
  return {
    mark(name) { t[name] = (t[name] || 0) + (Date.now() - last); last = Date.now(); },
    skip() { last = Date.now(); },
    // The RAW map, for storing against the round. `line()` drops anything under
    // 50ms because a log line reading "score 0.0s" is noise — but a drill-down
    // wants every step, including the ones that cost nothing, since "this step
    // was free" is itself an answer.
    steps() { return { ...t }; },
    line() {
      return Object.entries(t).filter(([, ms]) => ms >= 50)
        .map(([k, ms]) => `${k} ${(ms / 1000).toFixed(1)}s`).join(' · ');
    },
  };
}

async function computeStocks(asOf, opts = {}) {
  if (!API_KEY) {
    return { ok: false, status: 500, error: 'TWELVE_DATA_API_KEY is not set. Copy .env.example to .env and add your key.' };
  }

  const portfolios = await readPortfolios();
  const portfolioNames = Object.keys(portfolios);
  const symbols = await readUniverse();
  if (symbols.length === 0) {
    return { ok: true, payload: { stocks: [], portfolios: portfolioNames, asOf, updatedAt: new Date().toISOString() } };
  }

  // Fetch the S&P 500 (SPY) alongside the universe so we can compute relative
  // strength, without adding it to any portfolio or the output rows.
  const fetchSymbols = symbols.includes(BENCHMARK) ? symbols : [...symbols, BENCHMARK];
  const T = phaseTimer();
  const names = await readNames();
  const shortOverrides = await store.readShortNames();
  const profiles = asOf ? {} : await ensureProfiles(symbols, opts.profileCap); // no point-in-time fundamentals
  T.mark('profiles');

  try {
    let series;
    // Which symbols this round actually priced live — null means all of them.
    // The archive write needs to know: re-persisting bars that came OUT of the
    // archive is a no-op upsert of the overlap window for every unpriced
    // symbol, every round.
    let pricedLive = null;
    // The freshly fetched bars alone, where a live pull happened. persistBars
    // needs these rather than the archive-joined window (see its call below).
    let liveSeries = null;
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
      // calls. As-of: from ~430 days before asOf through today, so there is a
      // year of history before the date AND the bars after it (forward returns).
      //
      // A live pull is SHALLOW (see LIGHT_BARS): it asks only for the sessions
      // the archive does not already hold, and the scoring window is joined on
      // from the archive below. An as-of pull is unchanged and still deep — it
      // reads a range the archive may not cover at all.
      series = {};
      // Only this round's slice is pulled live; everything else in the universe
      // comes off the archive below, so a universe too big to price inside one
      // minute is paced across rounds rather than having its round refused.
      const liveSet = opts.priceSlice ? new Set(opts.priceSlice) : null;
      pricedLive = opts.priceSlice ? opts.priceSlice.slice() : null;
      const toFetch = liveSet
        ? fetchSymbols.filter((x) => x === BENCHMARK || liveSet.has(x))
        : fetchSymbols;
      const priceDeadline = Date.now() + PRICE_PHASE_MS;
      const pullPrices = (syms, depthFor) => pullPricesFor(syms, depthFor, priceDeadline);

      const asOfDepth = (chunk) => {
        const start = new Date(asOf);
        start.setDate(start.getDate() - 430); // ~1 year of history before the as-of date
        const daysBack = Math.round((Date.now() - start.getTime()) / 86400000);
        const needed = Math.ceil(daysBack * 0.72) + 60; // approx trading days in range + buffer
        // Twelve Data batch limit: symbols × outputsize ≤ 100000.
        const maxPerSymbol = Math.floor(90000 / chunk.length);
        const outSize = Math.min(Math.max(needed, 300), maxPerSymbol, 5000);
        return `&start_date=${start.toISOString().slice(0, 10)}&outputsize=${outSize}`;
      };
      const deepDepth = () => `&outputsize=${DEEP_BARS}`;
      const lightDepth = () => `&outputsize=${LIGHT_BARS}`;

      if (asOf) {
        const r = await pullPrices(toFetch, asOfDepth);
        if (r.refusal) return r.refusal;
        Object.assign(series, r.got);
      } else {
        // The archive carries the history. SPY is deliberately never archived
        // (it belongs to no portfolio and the orphan sweep would collect it),
        // so the benchmark is always a deep pull.
        const histSince = new Date(Date.now() - 470 * 86400000).toISOString().slice(0, 10);
        const archive = await store.readBarsFullFor(
          toFetch.filter((x) => x !== BENCHMARK), histSince);
        const deepSyms = [];
        const lightSyms = [];
        for (const sym of toFetch) {
          const h = archive[sym];
          if (sym === BENCHMARK || !h || h.length < LIGHT_MIN_ARCHIVE) deepSyms.push(sym);
          else lightSyms.push(sym);
        }

        const light = await pullPrices(lightSyms, lightDepth);
        if (light.refusal) return light.refusal;
        const deep = await pullPrices(deepSyms, deepDepth);
        if (deep.refusal) return deep.refusal;
        liveSeries = { ...light.got, ...deep.got };

        // A shallow window is only usable if it actually MEETS the archive.
        // Without this check a symbol whose archive had fallen behind would be
        // joined across a hole — and worse, persistBars treats "no overlap" as
        // "rebuild this symbol", which from a 12-bar pull would replace years
        // of history with twelve rows. Anything that does not meet is re-pulled
        // deep, which is the only honest repair.
        const dOf = (b) => String(b.datetime).slice(0, 10);
        const stragglers = lightSyms.filter((sym) => {
          const v = liveSeries[sym] && liveSeries[sym].values;
          const h = archive[sym];
          if (!Array.isArray(v) || !v.length || !h || !h.length) return true;
          return dOf(h[0]) < dOf(v[v.length - 1]);   // archive ends before the live window starts
        });
        if (stragglers.length) {
          console.warn(`prices: ${stragglers.length} symbol(s) did not meet the archive, ` +
                       `re-pulling deep: ${stragglers.slice(0, 8).join(', ')}` +
                       (stragglers.length > 8 ? ' …' : ''));
          const redo = await pullPrices(stragglers, deepDepth);
          if (redo.refusal) return redo.refusal;
          Object.assign(liveSeries, redo.got);
        }
        const deepSet = new Set([...deepSyms, ...stragglers]);

        // Join: the live bars, then the archive strictly older than them. The
        // live copy wins on any shared date — that is what upgrades a
        // provisional close captured mid-session to the settled one.
        for (const sym of toFetch) {
          const live = liveSeries[sym];
          const v = (live && live.values) || [];
          const h = archive[sym] || [];
          if (!v.length) { series[sym] = live || { values: h }; continue; }
          if (deepSet.has(sym)) { series[sym] = live; continue; }
          const oldest = dOf(v[v.length - 1]);
          series[sym] = { ...live, values: v.concat(h.filter((b) => dOf(b) < oldest)) };
        }
        const bars = lightSyms.length * LIGHT_BARS + deepSet.size * DEEP_BARS;
        console.log(`prices: live, ${lightSyms.length - stragglers.length} shallow + ` +
          `${deepSet.size} deep (~${bars} bars, was ${toFetch.length * DEEP_BARS})`);
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
      } else if (fetchSymbols.length > PRICE_CHUNK) {
        console.log(`prices: live, ${Math.ceil(toFetch.length / PRICE_CHUNK)} chunks for ${toFetch.length} symbols`);
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

    // 5Y comes from the ARCHIVE, not from `values`. A refresh fetches ~300 bars
    // and an archive round reads 650 days, so a five-year return cannot be a
    // pctChange over the series the other columns use — it would be null for
    // every stock. One query for the whole universe instead (the promo studio's
    // period anchors do the same): the last close before today minus five
    // years. A stock that listed later simply has no bar before the boundary
    // and stays blank, and an anchor more than 30 days early is refused so a
    // hole in the bars cannot quietly turn into a longer window.
    const FIVE_YEAR_GRACE_MS = 30 * 86400000;
    let fiveYearAnchor = {};
    if (!asOf) {
      const at = new Date();
      at.setFullYear(at.getFullYear() - 5);
      const boundary = at.toISOString().slice(0, 10);
      try {
        const [got] = await store.closesBefore([boundary], symbols);
        for (const [sym, a] of Object.entries(got || {})) {
          if (Date.parse(boundary) - Date.parse(a.d) <= FIVE_YEAR_GRACE_MS) fiveYearAnchor[sym] = a;
        }
      } catch (err) {
        // A column must never fail a refresh — the bars rule.
        console.warn('5Y anchors skipped:', err.message);
        fiveYearAnchor = {};
      }
    }

    // Benchmark 3-month return (as of the chosen date, if one is set).
    const spyFull = series[BENCHMARK]?.values;
    let spyThreeMonthPct;
    if (asOf && Array.isArray(spyFull)) {
      const sk = indexAsOf(spyFull, asOf);
      spyThreeMonthPct = sk >= 0 ? pctChange(spyFull.slice(sk), THREE_MONTH) : null;
    } else {
      spyThreeMonthPct = pctChange(spyFull, THREE_MONTH);
    }

    T.mark('prices');
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
        totalCash: prof.totalCash ?? null,
        totalDebt: prof.totalDebt ?? null,
        ebitda: prof.ebitda ?? null,
        operatingCashFlowTtm: prof.operatingCashFlowTtm ?? null,
        enterpriseValue: prof.enterpriseValue ?? null,
        trailingPe: prof.trailingPe ?? null,
        priceToBook: prof.priceToBook ?? null,
        priceToSales: prof.priceToSales ?? null,
        evToEbitda: prof.evToEbitda ?? null,
        operatingMargin: prof.operatingMargin ?? null,
        roa: prof.roa ?? null,
        dilutedEpsTtm: prof.dilutedEpsTtm ?? null,
        bookValuePerShare: prof.bookValuePerShare ?? null,
        debtToEquity: prof.debtToEquity ?? null,
        currentRatio: prof.currentRatio ?? null,
        divYield: prof.divYield ?? null,
        divRate: prof.divRate ?? null,
        payoutRatio: prof.payoutRatio ?? null,
        exDivDate: prof.exDivDate ?? null,
        sharesOutstanding: prof.sharesOutstanding ?? null,
        floatShares: prof.floatShares ?? null,
        shortRatio: prof.shortRatio ?? null,
        shortPctOutstanding: prof.shortPctOutstanding ?? null,
        insiderPct: prof.insiderPct ?? null,
        institutionPct: prof.institutionPct ?? null,
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
        price,
        // The PROFILE first: it survives an archive-priced round, where the
        // price call's meta does not exist at all.
        currency: prof.currency || s.meta?.currency || null,
        exchange: prof.exchange || s.meta?.exchange || null,
        micCode: prof.micCode || s.meta?.mic_code || null,
        historyDays: ok ? values.length : 0,
        latestDate: ok ? values[0].datetime : null,
        profileFetchedAt: prof.fetchedAt ?? null, // when sector and fundamentals were cached
        todayPct: pctChange(values, TODAY),
        yesterdayPct: singleDayChange(values, 1),
        oneWeekPct: pctChange(values, ONE_WEEK),
        twoWeekPct: pctChange(values, TWO_WEEK),
        oneMonthPct: pctChange(values, ONE_MONTH),
        threeMonthPct,
        sixMonthPct: pctChange(values, SIX_MONTH),
        oneYearPct: pctChange(values, ONE_YEAR),
        fiveYearPct: (() => {
          const a = fiveYearAnchor[sym];
          return a && isFinite(a.close) && a.close > 0 && isFinite(price)
            ? ((price - a.close) / a.close) * 100 : null;
        })(),
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
        // Today's shares traded and their value — what "most active" means. A
        // mid-session refresh sees the volume so far, which is what it is.
        //
        // THESE TWO ARE THE ONLY PLACES IN THE ROW THAT TOUCH `values` WITHOUT
        // A GUARD, and it took the whole universe down on 2026-09-24. They
        // check `values[0]` and not `values`, so a series that is UNDEFINED
        // rather than empty throws — and a batched time_series reply carries a
        // per-symbol error object with no `values` key at all for a symbol the
        // provider cannot serve, which the top-level `status === 'error'` test
        // never sees. One such symbol threw a TypeError out of the whole map
        // and 1,165 stocks got no refresh. `ok` is what every sibling field
        // uses, and it is `Array.isArray(values) && values.length > 0`.
        volume: (() => { const v = ok ? Number(values[0].volume) : NaN; return isFinite(v) && v > 0 ? v : null; })(),
        dollarVolume: (() => {
          if (!ok) return null;
          const v = Number(values[0].volume); const c = parseFloat(values[0].close);
          return isFinite(v) && v > 0 && isFinite(c) ? Math.round(v * c) : null;
        })(),
        daysSince52wHigh: extremeAges(values).hi,
        daysSince52wLow: extremeAges(values).lo,
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
        // Bar-derived inputs. All from the same daily bars, so they cost
        // no additional API credits.
        pctFromLow: pctFromLow(values),
        fcfYield: yieldPct(prof.fcfTtm, prof.marketCap),      // FCF / market cap
        netCashPct: yieldPct(prof.netCash, prof.marketCap),   // net cash as % of market cap
        range52Pos: range52Pos(values),   // 0 = on the 52w low, 100 = on the high
        steadiness: steadiness(values),   // R² of log price vs time, 0-100, direction-blind
        ulcer: ulcerIndex(values),        // RMS drawdown from the running high, %
        crossings: medianCrossings(values),  // times the price crossed its own 1y median
        bandPct: bandPct(values),            // (high-low)/median over the year, %
        realisedVol: rvol,
        fwd1M,
        fwd3M,
        fwd6M,
        fwdSince,
        error: ok ? null : (s.message || 'No data returned for this symbol.'),
      };

      return row;
    });

    // Scores each row. This used to have to wait until every row existed,
    // because the scores were once ranked across the universe; they are not, so the
    // pass is here only because the rows are built by now anyway.
    applyScores(stocks);
    scoreActionInto(stocks);

    // The trend ribbon's year, as dated runs, for the assistant. Bar-derived,
    // so honestly replayable — which is why it survived the cull that
    // took the past-score columns this window used to share.
    try {
      T.mark('score');
      // FROM THE SERIES ALREADY IN HAND, not a second read of the archive.
      // This was `trendBars()` — its own 650-day window over the universe —
      // left behind when the scoring history read it used to share was
      // retired. Measured against production at 767 stocks it had become
      // 290,277 rows and 101.5s of a 296.5s rebuild, on top of the 470-day
      // read the price series had just done: the same bars, twice, in one
      // round. The timeline is capped at 252 sessions and 470 days is ~324,
      // so nothing it draws is lost.
      const bars = {};
      for (const row of stocks) {
        const v = (series[row.symbol] && series[row.symbol].values) || [];
        bars[row.symbol] = v.map((b) => ({ d: String(b.datetime || b.d).slice(0, 10),
          high: b.high, close: b.close }));
      }
      T.mark('trend-bars');
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
        // The LIVE bars, deliberately: persistBars detects a split by comparing
        // an old fetched bar against the stored one, and every bar in the joined
        // window came FROM the store, so a joined series would agree with itself
        // and never see one.
        const b = await persistBars(pricedLive || symbols, liveSeries || series, T);
        // Exactly the symbols the provider served this round, not the ones we
        // asked for: a chunk that failed must not claim to have been priced.
        // Same guard as the archive write — an as-of pull and an archive round
        // did not fetch prices, so neither may move this clock.
        if (liveSeries) {
          const served = Object.keys(liveSeries).filter(
            (sym) => liveSeries[sym] &&
                     Array.isArray(liveSeries[sym].values) && liveSeries[sym].values.length);
          const at = Date.now();
          await store.notePricePull(served, at);
          // Stamp the rows this response is built from. The refresh branch of
          // /api/stocks returns the payload directly and never reaches the
          // stamp on the snapshot path, so without this the column is blank
          // for the one person who just clicked Refresh and populated for
          // everybody else — which is the wrong way round.
          const servedSet = new Set(served);
          for (const row of stocks) {
            if (servedSet.has(row.symbol)) row.pricedAt = at;
          }
        }
        T.mark('persist-bars');
        if (b.inserted) {
          console.log(`bars: +${b.inserted} rows across ${b.symbols} symbols ` +
                      `in ${b.trips} write round trips` +
                      (b.rewritten ? `, ${b.rewritten} rewritten in full` : ''));
        }
      } catch (err) {
        console.warn('bars: archive write failed (screener unaffected):', err.message);
      }
    }

    const line = T.line();
    const steps = T.steps();
    if (line) console.log(`refresh phases: ${line}`);
    // Also on the payload: Vercel's log view does not show stdout for a
    // function, and the question "which phase is slow" comes up per round.
    return { ok: true, payload: { stocks, portfolios: portfolioNames, asOf,
      phases: line || null, phaseSteps: steps, updatedAt: new Date().toISOString() } };
  } catch (err) {
    // NOT EVERYTHING IN HERE IS THE PROVIDER, and calling it all that cost an
    // afternoon on 2026-09-24: a TypeError from our own code was reported as
    // "Failed to reach Twelve Data: Cannot read properties of undefined", which
    // reads as a provider wobble and is a bug in this file. A network failure
    // arrives as a TypeError too (undici's `fetch failed`), so the test is the
    // CAUSE CHAIN — undici hangs the real reason off `err.cause`, and our own
    // faults have none.
    const ours = err instanceof TypeError && !err.cause;
    // The stack is the only thing that names the line, and it was being
    // discarded. Vercel does not show stdout for a function, so this has to be
    // console.error, and it has to happen before the message is flattened.
    console.error('refresh failed:', err && err.stack ? err.stack : err);
    return { ok: false, status: 502,
      error: ours
        ? `Refresh failed inside the app (not the provider): ${err.message}`
        : `Failed to reach Twelve Data: ${netReason(err)}` };
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

// How many bars a LIVE price pull asks for. The archive already holds the
// history, so re-fetching 300 sessions a symbol re-downloads ~9.5MB of bars we
// already have — and on 2026-09-17 that became the difference between a refresh
// and no refresh: measured seconds apart, 120 symbols x 300 bars answered HTTP
// 524 after 125s while 120 symbols x 12 bars answered 200 in 33s. Credits are
// unchanged (1 a symbol whatever the depth, measured), so this is free.
//
// 12 is chosen against what has to be true for the join to work: the window must
// overlap what the archive already holds. A nightly refresh leaves a one-session
// gap, so 12 covers a long weekend plus a week of missed runs, and anything that
// still fails to overlap is re-pulled deep rather than guessed at.
// One fetch of a set of symbols at a given depth, chunked. Returns the
// symbol-keyed payload, or a structured refusal for the caller to return.
//
// It was a closure inside computeStocks until 2026-09-22, when the light price
// round needed the same pull — and a second copy of "ask the provider for bars"
// is exactly the drift this project keeps paying for. `deadline` is an absolute
// timestamp: a serverless function is killed at the platform's ceiling, so an
// unbounded wait does not fail, it vanishes with the round's credits.
const PRICE_CHUNK = 120;
async function pullPricesFor(syms, depthFor, deadline) {
  const got = {};
  for (let i = 0; i < syms.length; i += PRICE_CHUNK) {
    const chunk = syms.slice(i, i + PRICE_CHUNK);
    const raw = await fetchJson(
      `${TD_BASE}/time_series?symbol=${encodeURIComponent(chunk.join(','))}` +
      `&interval=1day${depthFor(chunk)}&apikey=${API_KEY}`,
      { budget: deadline - Date.now() }
    );
    // A top-level error (bad key, rate limit) comes back as {status:"error"}.
    if (raw && raw.status === 'error') {
      return { refusal: { ok: false, status: raw.code === 429 ? 429 : 502,
                          error: `Twelve Data: ${raw.message}` } };
    }
    Object.assign(got, normalizeBySymbol(raw, chunk));
  }
  return { got };
}

const LIGHT_BARS = Number(process.env.TD_LIGHT_BARS || 12);
const DEEP_BARS = 300;
// Below this the archive cannot carry the scoring window (the rules need ~260
// sessions), so the symbol is pulled deep and the archive is not consulted.
const LIGHT_MIN_ARCHIVE = 300;

// Only ever called for a live pull. An as-of pull fetches a different, truncated
// range, and persisting from that path would poison the archive.
// `T` is the round's phase timer, optional. It is threaded in because
// `persist-bars` measured 104.8s of a 121.3s production round (run 77) and the
// single step could not say which of the three things in here spent it — two
// indexed reads, the row building, or the writes. Marks ACCUMULATE by name, so
// marking inside the loop costs one map write per symbol and gives the write
// path its own total.
async function persistBars(symbols, series, T = null) {
  const mark = T ? (n) => T.mark(n) : () => {};
  const meta = await store.barsMaxDates(symbols);
  mark('bars-maxdates');

  const probes = [];
  const have = [];
  for (const sym of symbols) {
    const v = series[sym] && series[sym].values;
    if (!Array.isArray(v) || !v.length) continue;
    have.push([sym, v]);
    const p = v[Math.min(SPLIT_PROBE_BARS, v.length - 1)];
    if (p && p.datetime) probes.push({ sym, d: String(p.datetime).slice(0, 10), close: parseFloat(p.close) });
  }
  const stored = await store.barsOn(probes);
  mark('bars-probe');
  const probeBySym = new Map(probes.map((x) => [x.sym, x]));

  // Every write below is a round trip, so count them: on this database a path's
  // cost is its number of round trips, not its number of rows.
  let inserted = 0, rewritten = 0, trips = 0;
  // The steady-state upserts, collected across symbols and written once.
  const pending = [];
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
      // A REWRITE STAYS ITS OWN TRIP, deliberately. It is a delete followed by
      // the inserts, and folding that into a batch shared with other symbols
      // would put one symbol's delete beside another's inserts — the way to
      // corrupt this archive. It is also the rare path: a split, or a symbol
      // whose window does not meet what we hold.
      mark('bars-prep');
      await store.replaceBarsFor(sym, rows);
      trips++;
      mark('bars-write');
      rewritten++;
      inserted += rows.length;
      continue;
    }

    // Steady state: everything newer than what we hold, plus a short overlap so
    // a provisional close gets corrected.
    const at = rows.findIndex((r) => r.d === m.maxDate);
    pending.push(...rows.slice(0, Math.min(rows.length, at + 1 + BAR_OVERLAP)));
  }

  // ONE BATCH ACROSS EVERY SYMBOL, not one per symbol. This was
  // `await store.upsertBars(slice)` INSIDE the loop, so a 500-symbol round made
  // 500 sequential round trips — measured in production (run 77) at ~210ms each
  // and 104.8s of a 121.3s round, the single biggest step in the refresh. The
  // rows were never the cost: the same round writes 2,400 rows cold and 48 in
  // the steady state and took the same 8 trips either way. upsertBars already
  // chunks at BAR_CHUNK statements, so this is ~6 trips for the whole universe.
  // Safe to merge because every statement here is an idempotent upsert keyed on
  // (symbol, d) — unlike the rewrite above, which deletes first.
  mark('bars-prep');
  if (pending.length) {
    inserted += await store.upsertBars(pending);
    trips += Math.ceil(pending.length / store.BAR_CHUNK);
    mark('bars-write');
  }
  return { inserted, rewritten, trips, symbols: have.length };
}


// ============================================================================
// The advice backtest
// ============================================================================
// "On this day a month ago, which stocks did the rules call a Strong Buy, and
// what would an equal-weight basket of them have done since?"
//
// What is REPLAYED and what is IMPUTED, because the difference is the whole
// honesty of this page and it is repeated on screen:
//   replayed exactly  trend, entry, RSI, volume, the moving averages, the 52-week
//                     position \u2014 every one derived from archived bars at that date,
//                     the same arithmetic action-backtest.js has used for 18 years
//   from the archive  the next earnings date as of then, read from earnings_history
//                     rather than borrowed from today
//   IMPUTED           every fundamental, and the company type that follows from it.
//                     fundamentals_history begins 2026-08-30, so before that there is
//                     nothing to read and today's values stand in. They move in steps
//                     at earnings, so this is harmless on a stock that did not report
//                     inside the window and a genuine look-ahead on one that did \u2014
//                     which is why the count of those is reported with the result.
//
// Two months is the cap, set in the UI and enforced here: past that the share of
// the verdict that is imputed grows without bound and the number stops meaning
// anything.
const BT_MAX_BACK_DAYS = 62;
// When fundamentals_history begins. Anything before this has no recorded
// fundamentals at all, which the page says in as many words.
const FUND_HISTORY_FROM = '2026-08-30';
// One window covers every start date the page can ask for, so changing the date
// or the tiers re-runs against bars already in memory. At 1,000 stocks that read
// is ~650k rows and must not happen per click.
// ============================================================================
// The trend-only backtest — twenty years, because it reads nothing but bars
// ============================================================================
// The advice backtest stops at two months: everything before 2026-08-30 would
// have its fundamentals imputed. This one asks a narrower question that the
// archive can actually answer — what the ALL-TECHNICAL rules did — and so it
// runs from 2008.
//
// It reads `tech_history` and never touches `bars`. Every field the rules need
// was precomputed at a weekly mark, which is what keeps a twenty-year study off
// the rows-read meter: ~333,000 small rows, read once and cached, against 1.7M
// bars re-read per request.
//
// ONE WINDOW IS ONE OBSERVATION. That is the advice backtest's stated weakness
// and the whole reason this exists: twenty years buys a DISTRIBUTION of start
// dates, not a longer curve. So the primary output is the spread across ~200
// windows — median, hit rate, the tail — and never a single equity line.
const TB_TTL_MS = 10 * 60 * 1000;
let tbMarks = null;          // { at, rows, slim }

// Forward horizons, in MONTHLY MARKS. A fixed horizon is what makes windows
// comparable: "carry every start date to today" gives a 2008 window eighteen
// years and a 2026 one a fortnight, and averaging those compares nothing.
//
// MONTHS, NOT WEEKS, since 2026-09-20 — and the reason is the read, not the
// statistics. The table holds a weekly mark, but a sweep whose start dates are
// month-firsts lands on a month-first at the far end too if the horizon is a
// whole number of months, so ONE set of month-first marks serves all four
// horizons and the cache survives changing one. Reading weekly marks meant
// reading four times the rows for end dates that were never start dates.
// It also reads better: "started in March 2012 and held three months" is what
// the page claims, and 13 weekly marks was 91 days pretending to be that.
const TB_HORIZONS = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 };
// Under this many picks a window is a thin basket — its excess is mostly one
// stock's idiosyncratic noise. FLAGGED, never dropped: excluding the windows
// where the rules found almost nothing would quietly remove exactly the
// periods a trend rule is supposed to be judged on.
const TB_THIN_PICKS = 3;

// Every month-first mark, once, cached — NOT the whole table.
//
// Measured before this existed: the whole table was 181.8 seconds cold against
// 232k rows, for a sweep whose arithmetic takes 154ms, and it was growing
// toward 333k against a ~3-minute response wall. Two narrowings, both of which
// only work because the sweep starts on month-firsts:
//
//   - the DATES. One mark a month, so ~280 of ~1,200. The other three weeks of
//     every month are never a start and, with whole-month horizons, never an
//     end either. Asked for by date because `d in (...)` seeks the index.
//   - the COLUMNS. Balanced reads the stored verdict and the close and nothing
//     else, so `slim` drops ten of fourteen. A non-default rule set re-runs the
//     engine and needs the inputs.
//
// The calendar read that precedes it comes from `tech_marks` — ~1,200 rows of
// one column — and NOT from a `distinct d` over tech_history, which walks
// every index entry and measured 429.9 seconds for the same answer.
//
// ONE cached copy is kept, never two: the full set is ~19MB of JSON and many
// times that as objects, and it already carries everything the slim path
// reads, so a slim request is served from a full copy rather than fetching a
// second one.
// Whether a sweep would read anything at all. One definition, used by the
// loader and by the refresh guard, so the two cannot disagree about what
// "warm" means — a guard that refused a sweep costing zero rows would be a
// regression, and one that let a cold sweep through would be the bug.
function tbMarksWarm(slim) {
  const held = tbMarks;
  return !!(held && Date.now() - held.at < TB_TTL_MS && (slim || !held.slim));
}

async function tbLoadMarks(slim) {
  const held = tbMarks;
  if (tbMarksWarm(slim)) return held.rows;
  const dates = await store.readTechMarkDates('1900-01-01');
  const firsts = [];
  let lastMonth = null;
  for (const d of dates) {
    const m = d.slice(0, 7);
    if (m === lastMonth) continue;
    lastMonth = m;
    firsts.push(d);
  }
  const rows = await store.readTechMarksOn(firsts, slim);
  tbMarks = { at: Date.now(), rows, slim: !!slim };
  return rows;
}

// One pass, one basket per start date.
//
// Pure over what it is handed: no database, no clock, no config beyond the
// rule set — so the whole sweep is testable without a server, which is what
// makes its arithmetic checkable against hand-computed numbers.
function tbSweep(opts) {
  const { rows, cfg, want, horizon, from, only, everyMonths } = opts;
  const H = TB_HORIZONS[horizon] || TB_HORIZONS['3M'];

  // marks -> symbol -> row. Rows arrive ordered by date, so this walk is one
  // pass rather than a sort.
  const byDate = new Map();
  for (const r of rows) {
    if (only && !only.has(r.symbol)) continue;
    if (!byDate.has(r.d)) byDate.set(r.d, new Map());
    byDate.get(r.d).set(r.symbol, r);
  }
  const marks = [...byDate.keys()].sort();

  // Start dates: the first mark of each month (or every Nth month), which is
  // how anyone describes "I would have started in March 2012".
  const starts = [];
  let lastKey = null;
  for (let i = 0; i < marks.length; i++) {
    if (marks[i] < from) continue;
    const key = marks[i].slice(0, 7);
    if (key === lastKey) continue;
    lastKey = key;
    const month = Number(marks[i].slice(5, 7)) - 1;
    if (everyMonths > 1 && month % everyMonths !== 0) continue;
    if (i + H >= marks.length) break;            // no full horizon left
    starts.push(i);
  }

  // Balanced is the stored default, so its verdict needs no re-evaluation —
  // which matters: the alternative is ~70,000 engine calls a sweep.
  const isDefault = !cfg || cfg.profile === 'Balanced';
  const verdictOf = (r) => (isDefault ? r.action : Action.actionAt({
    v200: r.vs200, v50: r.vs50, rsi: r.rsi, m1: r.m1, m3: r.m3,
    fh: r.fromHigh, vol: r.volTrend, hist: r.historyDays }, cfg).action);

  const windows = [];
  for (const i of starts) {
    const sd = marks[i], ed = marks[i + H];
    const at = byDate.get(sd), then = byDate.get(ed);
    let bSum = 0, bN = 0, uSum = 0, uN = 0;
    const picks = [];
    for (const [sym, r] of at) {
      const end = then.get(sym);
      // A return needs a price at BOTH ends. A symbol that stops trading part
      // way through is left out of both legs rather than counted in one.
      if (!end || !(r.close > 0) || !(end.close > 0)) continue;
      const ret = (end.close / r.close - 1) * 100;
      uSum += ret; uN++;
      if (want.has(verdictOf(r))) { bSum += ret; bN++; picks.push(sym); }
    }
    if (!uN) continue;
    const bench = uSum / uN;
    // NO PICKS IS A RESULT, NOT A GAP. If the rules qualify nothing, the money
    // sits in cash and earns nothing — so the window returns 0 and its excess
    // is minus the market's move. Treating it as a missing observation would
    // drop precisely the windows a trend rule exists for (it is what March 2009
    // looks like) and would flatter every one of them.
    const cash = bN === 0;
    const basket = cash ? 0 : bSum / bN;
    windows.push({ d: sd, end: ed, n: bN, universe: uN,
      basket, bench, excess: basket - bench,
      cash, thin: bN > 0 && bN < TB_THIN_PICKS,
      picks: picks.slice(0, 30) });
  }
  return { windows, horizon, horizonMarks: H, marks: marks.length };
}

// The spread, which is the answer — not any one window.
function tbStats(windows) {
  // Every window counts. `thin` and `cash` are reported alongside so a reader
  // can see how much of the distribution rests on almost nothing, but they are
  // not filtered out — a filter there is a thumb on the scale.
  const usable = windows.filter((w) => w.excess != null);
  const ex = usable.map((w) => w.excess).sort((a, b) => a - b);
  const q = (p) => (ex.length ? ex[Math.min(ex.length - 1, Math.floor(p * (ex.length - 1)))] : null);
  const mean = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : null);
  return {
    windows: usable.length,
    thinWindows: windows.filter((w) => w.thin).length,
    cashWindows: windows.filter((w) => w.cash).length,
    medianExcess: q(0.5), meanExcess: mean(ex),
    p10: q(0.1), p90: q(0.9),
    worst: ex.length ? ex[0] : null, best: ex.length ? ex[ex.length - 1] : null,
    hitRate: ex.length ? (ex.filter((x) => x > 0).length / ex.length) * 100 : null,
    meanBasket: mean(usable.map((w) => w.basket)),
    meanBench: mean(usable.map((w) => w.bench)),
    avgPicks: mean(usable.map((w) => w.n)),
    avgUniverse: mean(usable.map((w) => w.universe)),
  };
}

const BT_WINDOW_DAYS = 530;
const BT_BAR_TTL_MS = 10 * 60 * 1000;
const BT_SPY_TTL_MS = 30 * 60 * 1000;
let btBars = null;      // { at, since, bars }
let btSpy = null;       // { at, values }

async function btLoadBars(universe) {
  if (btBars && Date.now() - btBars.at < BT_BAR_TTL_MS && btBars.n === universe.length) {
    return btBars.bars;
  }
  const since = new Date(Date.now() - BT_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const bars = await store.readBarsFullFor(universe, since);
  btBars = { at: Date.now(), since, bars, n: universe.length };
  return bars;
}

// SPY is deliberately never archived (it belongs to no portfolio and the orphan
// sweep would collect it), so the benchmark is fetched and held in memory. One
// credit, and only when the cache is cold.
async function btLoadSpy() {
  if (btSpy && Date.now() - btSpy.at < BT_SPY_TTL_MS) return btSpy.values;
  const raw = await fetchJson(
    `${TD_BASE}/time_series?symbol=${BENCHMARK}&interval=1day&outputsize=400&apikey=${API_KEY}`);
  if (!raw || raw.status === 'error' || !Array.isArray(raw.values)) throw new Error('no benchmark data');
  const values = raw.values.slice().reverse()       // oldest-first, like the archive rows
    .map((b) => ({ d: String(b.datetime).slice(0, 10), c: parseFloat(b.close) }))
    .filter((b) => isFinite(b.c) && b.c > 0);
  btSpy = { at: Date.now(), values };
  return values;
}

// An equal-weight, buy-and-hold curve: every name gets the same dollar at the
// start and nothing is rebalanced. mean(close / close_at_start) per session,
// over the union of the dates the members actually traded \u2014 the convention
// /api/basket already uses, so the two pages cannot disagree.
// Every symbol's series normalised to 1.0 at `from`, on one shared date axis.
// btCurve averages every row of this; the random band averages random SUBSETS
// of it. One alignment rule, one implementation — a second walk of "the last
// close on or before d" would drift the moment either was fixed, which is why
// rowcard.js, screens.js and action.js exist at all.
function btMatrix(series, from) {
  const axis = new Set();
  const start = {};
  for (const sym of Object.keys(series)) {
    const rows = series[sym];
    const s0 = rows.find((r) => r.d >= from);
    if (!s0) continue;
    start[sym] = s0.c;
    for (const r of rows) if (r.d >= from) axis.add(r.d);
  }
  const dates = [...axis].sort();
  const syms = Object.keys(start);
  const rows = {};
  for (const sym of syms) {
    const src = series[sym];              // ascending by date, as btRun builds it
    const out = new Array(dates.length);
    // A forward pointer rather than a backwards scan per date: the old version
    // was O(dates x bars) per symbol, and the band asks for this many times.
    let k = 0, v = null;
    for (let j = 0; j < dates.length; j++) {
      while (k < src.length && src[k].d <= dates[j]) { v = src[k].c; k++; }
      out[j] = v == null ? null : v / start[sym];
    }
    rows[sym] = out;
  }
  return { dates, syms, rows };
}

// The equal-weight curve of whichever symbols are handed in.
function btAverage(m, syms) {
  const out = new Array(m.dates.length);
  for (let j = 0; j < m.dates.length; j++) {
    let sum = 0, n = 0;
    for (const s of syms) {
      const v = m.rows[s] && m.rows[s][j];
      if (v != null) { sum += v; n++; }
    }
    out[j] = n ? sum / n : null;
  }
  return out;
}

function btCurve(series, from) {
  const m = btMatrix(series, from);
  return { dates: m.dates, values: btAverage(m, m.syms), members: m.syms.length, matrix: m };
}

// Seeded, so the band does not jitter on every reload — a confidence interval
// that moves when nothing moved reads as a bug. mulberry32.
function btRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BT_BAND_TRIALS = 400;

// What a RANDOM basket of the same size, from the same pool, would have done.
// This is the point of the Top-N feature rather than an ornament: ten stocks
// over two months is one or two independent observations, so a ranked basket
// beating the tier average says nothing until you know the spread. If the
// ranked line sits inside this band, the ranking did nothing.
function btBand(m, pool, n, seed) {
  const syms = pool.filter((s) => m.rows[s]);
  if (n < 1 || syms.length <= n) return null;       // nothing to choose = no spread
  const rnd = btRng(seed);
  const D = m.dates.length;
  const draws = [];
  for (let t = 0; t < BT_BAND_TRIALS; t++) {
    const idx = syms.slice();
    for (let k = 0; k < n; k++) {                    // partial Fisher-Yates, no replacement
      const j = k + Math.floor(rnd() * (idx.length - k));
      const tmp = idx[k]; idx[k] = idx[j]; idx[j] = tmp;
    }
    draws.push(btAverage(m, idx.slice(0, n)));
  }
  const quantile = (j, q) => {
    const col = draws.map((c) => c[j]).filter((v) => v != null).sort((a, b) => a - b);
    return col.length ? col[Math.min(col.length - 1, Math.floor(q * col.length))] : null;
  };
  const p10 = [], p50 = [], p90 = [];
  for (let j = 0; j < D; j++) { p10.push(quantile(j, 0.10)); p50.push(quantile(j, 0.50)); p90.push(quantile(j, 0.90)); }
  const finals = draws.map((c) => c[D - 1]).filter((v) => v != null).sort((a, b) => a - b);
  return { p10, p50, p90, finals, trials: draws.length };
}

const BT_RANKS = ['cushion', 'random'];

// Choose the Top N. Ranked on what was knowable ON THE START DATE, never on
// what happened afterwards.
//
// THE TRAP: btRun returns `picks` already sorted by realised forward return,
// for the table. Slicing THAT array is one plausible line of code and is
// perfect hindsight — it would report a magnificent result that means nothing.
// The same look-ahead class the strategy backtest was caught on once already.
// So this sorts its own copy and the caller's order is never consulted.
function btPick(picks, rank, n, seed) {
  if (!n || n >= picks.length) return picks.slice();
  // Neutralise the inherited order BEFORE ranking. picks arrives sorted by
  // realised return, so every tie — and the whole list when a metric is null
  // for everyone, which exitDistance does return past -60% — would otherwise
  // resolve by what happened next. Caught by a fixture where the ranking and
  // the outcome are opposed: the cut came back as exactly the ten best
  // performers. Symbol order is arbitrary, and arbitrary is the point.
  const sorted = picks.slice().sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  if (rank === 'random') {
    const rnd = btRng(seed);
    for (let k = 0; k < n; k++) {
      const j = k + Math.floor(rnd() * (sorted.length - k));
      const tmp = sorted[k]; sorted[k] = sorted[j]; sorted[j] = tmp;
    }
  } else {
    const key = 'cushion';
    sorted.sort((a, b) => {
      // Tier first, metric second — the screener's own rule, where sorting by an
      // advice column breaks ties on cushion. A Buy should not outrank a Strong
      // Buy because it happens to have more room.
      if (a.tierRank !== b.tierRank) return b.tierRank - a.tierRank;
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;                     // unrankable sorts last, never first
      if (bv == null) return -1;
      return bv - av;
    });
  }
  return sorted.slice(0, n);
}

// The engine's inputs as they stood at index i of this symbol's closes. Exactly
// action-backtest.js's row builder \u2014 the same fields, the same arithmetic \u2014 so
// the page and the 18-year study cannot drift apart.
// The RSI the screener shows, at an arbitrary index. Cached per symbol per run,
// since it is O(n) and the loop asks for one index out of the same series.
const btRsiCache = new Map();
function rsiAt(rowsOldestFirst, i) {
  let ser = btRsiCache.get(rowsOldestFirst);
  if (!ser) {
    ser = TechRow.rsiSeries(rowsOldestFirst.map((r) => Number(r.close)));
    btRsiCache.set(rowsOldestFirst, ser);
  }
  return ser[i] == null ? null : ser[i];
}

// The bar-derived row lives in techrow.js now — server.js, action-backtest.js
// and the tech-history builder all need it, and the first two had already
// drifted apart while this file claimed they had not. Kept as a named wrapper
// so the ~dozen call sites and the tests read unchanged.
const btRowAt = (closes, highs, vols, i) => TechRow.rowAt(closes, highs, vols, i);

// Run the whole thing. Pure over what it is handed, so it is testable without a
// server and without the network.
// ---- rebalancing ----------------------------------------------------------
// Two modes, both asked for:
//
//   rerun — re-evaluate the rules every N days and hold whatever is in the
//           chosen verdicts, equal weight. The full strategy reading.
//   exit  — buy the opening set once and only ever SELL, when a holding's
//           verdict falls to the exit tier. Proceeds sit in cash and are never
//           re-invested. This tests the one claim the rules actually make:
//           measured over 307,875 stock-days the tiers order DOWNSIDE
//           correctly while medians are flat, so "does obeying the exit cut
//           the tail" is a fairer question than "does it make more".
//
// Deliberately NOT offered: resetting weights to equal without re-running the
// rules. Over two months of correlated large caps that moves a result by tens
// of basis points and would be a control that does nothing.
const BT_MODES = ['rerun', 'exit'];
const BT_EXIT_TIER = 'Avoid';          // this or worse closes a holding

// Every Nth calendar day from the start, snapped to the next session that
// actually traded. Calendar days rather than sessions because 7 / 14 / 30 is
// how anyone thinks about it, and a fortnight is a fortnight whatever the
// market did.
function btRebalanceDays(axis, everyDays) {
  if (!everyDays || everyDays < 1) return [];
  const out = [];
  const start = Date.parse(axis[0] + 'T00:00:00Z');
  for (let d = everyDays; ; d += everyDays) {
    const want = new Date(start + d * 86400000).toISOString().slice(0, 10);
    if (want > axis[axis.length - 1]) break;
    const j = axis.findIndex((x) => x >= want);
    if (j <= 0) continue;
    if (!out.includes(j)) out.push(j);
  }
  return out;
}

// Value-tracked, not weight-tracked: holdings drift with price between
// rebalances, which is the whole point of rebalancing, and turnover has to be
// measured against what was actually held.
//
// THE DAY IS EARNED BEFORE THE REBALANCE. Rebalancing first would decide a
// position from today's close and then earn today's own move with it — the
// look-ahead the strategy backtest was caught on once, where a synthetic 48%
// gap on a rebalance day booked 5.98% instead of 39.98%.
function btSimulate(opts) {
  const { axis, px, open, targets, mode, costBps } = opts;
  const cost = (costBps || 0) / 10000;
  let held = new Map();                // symbol -> value
  let cash = 0;
  const first = [...open].filter((sym) => px[sym] && px[sym][0] > 0);
  if (!first.length) return null;
  // What each holding was bought at, so a sale can report what the position
  // did while it was held rather than only that it happened. Keyed by symbol
  // because a name sold and bought back later starts a new position.
  const entry = new Map();             // symbol -> { j, px }
  for (const sym of first) { held.set(sym, 1 / first.length); entry.set(sym, { j: 0, px: px[sym][0] }); }

  const nav = new Array(axis.length).fill(null);
  nav[0] = 1;
  let traded = 0, rebalances = 0;
  const log = [];

  for (let j = 1; j < axis.length; j++) {
    for (const [sym, v] of held) {
      const a = px[sym][j - 1], b = px[sym][j];
      if (a > 0 && b > 0) held.set(sym, v * (b / a));
    }
    let total = cash;
    for (const v of held.values()) total += v;

    if (targets.has(j) && total > 0) {
      const want = targets.get(j);
      const before = new Map(held);
      if (mode === 'exit') {
        // Sell the failures only. Survivors keep the weight they drifted to —
        // this mode never re-weights and never buys.
        for (const sym of [...held.keys()]) {
          if (!want.has(sym)) { cash += held.get(sym); held.delete(sym); }
        }
      } else {
        const keep = [...want].filter((sym) => px[sym] && px[sym][j] > 0);
        held = new Map();
        cash = 0;
        if (keep.length) for (const sym of keep) held.set(sym, total / keep.length);
        else cash = total;             // nothing qualifies: sit in cash
      }
      let moved = 0;
      const sold = [], bought = [];
      const names = new Set([...before.keys(), ...held.keys()]);
      for (const sym of names) {
        const was = before.get(sym) || 0, now = held.get(sym) || 0;
        moved += Math.abs(now - was);
        // The same diff that measures turnover names the trades, so the two can
        // never disagree about what happened.
        if (was > 0 && now === 0) {
          const e = entry.get(sym);
          const at = px[sym] ? px[sym][j] : null;
          sold.push({ sym, from: e ? axis[e.j] : null,
            days: e ? j - e.j : null,
            ret: e && e.px > 0 && at > 0 ? Math.round((at / e.px - 1) * 1000) / 10 : null });
          entry.delete(sym);
        } else if (was === 0 && now > 0) {
          bought.push({ sym });
          entry.set(sym, { j, px: px[sym][j] });
        }
      }
      traded += moved / total;
      // Charge the spread on every dollar that moved, both sides of a switch.
      const fee = (moved / total) * cost;
      for (const [sym, v] of held) held.set(sym, v * (1 - fee));
      cash *= 1 - fee;
      rebalances++;
      log.push({ d: axis[j], j, held: held.size, cash: Math.round((cash / total) * 1000) / 10,
        turnover: Math.round((moved / total) * 1000) / 10, sold, bought });
    }
    let end = cash;
    for (const v of held.values()) end += v;
    nav[j] = end;
  }
  return { values: nav, turnover: Math.round(traded * 1000) / 10, rebalances, log,
           endNames: held.size, endCash: Math.round((cash / (nav[nav.length - 1] || 1)) * 1000) / 10 };
}

// What a Top-N cut ranks on, AS OF one session. Shared by the opening pick and
// by every rebalance, so a re-run cuts on exactly the measure the run was set
// up with — a second copy of this would drift the first time either moved.
// Both values come from data already in hand: this symbol's bars and the row
// just built. No query.
//
// Cushion is the screener's own definition — the distance to the technical
// exit in the stock's OWN monthly volatility. The raw drop is deliberately not
// offered as a ranking: measured over 307,965 stock-days it orders the
// downside BACKWARDS, because "more room" is mostly "more extended".
function btRankMetrics(row, rows, i, cfg) {
  const newestFirst = rows.slice(0, i + 1).reverse();   // barmath.js's orientation
  const rv = BarMath.realisedVol(newestFirst);
  // exitDistance takes a NORMALISED shape, not a snapshot row — it rescales
  // each field as it walks the price down, so it has to know which is which.
  // Handing it the row gave every field as undefined and a null cushion for
  // the whole universe, which then made btPick fall through to the inherited
  // return order. Same argument list as the live call in scoreActionInto.
  const ed = Action.exitDistance({
    v200: row.vs200ma, v50: row.vs50ma, rsi: row.rsi,
    m1: row.oneMonthPct, m3: row.threeMonthPct, fh: row.pctFromHigh,
    vol: row.volTrend, hist: row.historyDays,
    // The exit ladder is the RUN'S rule set, not Balanced: Max Risk stops at
    // −20% against Balanced's −10%, so the same stock genuinely has more room
    // under it. Ranking a Max Risk run on Balanced's cushion would rank it by
    // a threshold that run never uses.
  }, cfg || ACTION_CFG);
  return {
    cushion: (ed && ed.drop != null && rv != null && isFinite(rv) && rv > 0)
      ? Math.round((ed.drop / (rv / Math.sqrt(12))) * 100) / 100 : null,
  };
}

// A rebalance is a number until you can see what it did. btSimulate names the
// symbols that moved; this hangs the WHY on them — the verdict that fired at
// that date, which for a sale is precisely the one that disqualified it.
//
// Capped per side, because a re-run at weekly cadence over a wide universe can
// turn over most of the book at every mark and nobody reads three hundred
// rows. The cap trims by usefulness: sales worst-first (the ones the rule was
// there to avoid), buys best-verdict-first, and the full count travels with
// the list so a trimmed one says so rather than looking complete.
const BT_TRADE_CAP = 40;

function btTrades(log, verdicts, byS, opts) {
  const { want, cut } = opts || {};
  const nameOf = (sym) => {
    const s = byS.get(sym);
    return (s && (s.shortName || s.name)) || sym;
  };
  const tier = (a) => Action.ACTIONS.indexOf(a);
  return (log || []).map((e) => {
    const why = verdicts.get(e.j) || new Map();
    const deco = (t, out) => {
      const w = why.get(t.sym);
      return { ...t, name: nameOf(t.sym),
        action: w ? w.a : null, flag: w ? w.f : null, real: w ? w.real : false,
        // Under a Top-N cut a holding can be sold while its verdict still
        // qualifies — it was simply ranked out. Saying "Hold — Extended" beside
        // a sale AND beside the purchase that replaced it reads as a
        // contradiction; this is the flag that lets the page tell them apart.
        ranked: !!(out && cut && w && want && want.has(w.a)) };
    };
    const sold = e.sold.map((t) => deco(t, true))
      .sort((a, b) => (a.ret == null ? 1 : b.ret == null ? -1 : a.ret - b.ret));
    const bought = e.bought.map((t) => deco(t, false))
      .sort((a, b) => tier(b.action) - tier(a.action) || a.sym.localeCompare(b.sym));
    return { d: e.d, held: e.held, cash: e.cash, turnover: e.turnover,
      soldN: sold.length, boughtN: bought.length,
      sold: sold.slice(0, BT_TRADE_CAP), bought: bought.slice(0, BT_TRADE_CAP) };
  });
}

// The engine's verdict for ONE symbol at ONE session. btRun calls it for the
// start date and the rebalancer calls it again at every rebalance, so a run
// that re-runs the rules every 7 days evaluates through exactly the same code
// path as the one that evaluates once. A second row builder would drift from
// the Advice column inside a week — the reason rowcard.js and action.js exist.
function btEvalAt(sym, p, i, today, was, earnings, atDate, cfg, also) {
  const tech = p.tech || btRowAt(p.closes, p.highs, p.vols, i);
  if (!tech) return null;
  // As of then: the next report that actually happened after that date,
  // falling back to today's only when none has yet.
  const nextEarn = (earnings[sym] || []).find((d) => d > atDate) || null;
  const row = { ...today, ...(was || {}), ...tech, symbol: sym, latestDate: p.dates[i],
    nextEarningsDate: nextEarn || today.nextEarningsDate || null,
    // BarMath.rsiSeriesAt is the app's own Wilder RSI, fed newest-first the
    // way it expects.
    rsi: rsiAt(p.rows, i) };
  // The run's own rule set, defaulting to ACTION_CFG — the resolved Balanced
  // profile every other surface scores against, so an unqualified verdict here
  // still means what the column means.
  const use = cfg || ACTION_CFG;
  const v = Action.evaluate(row, use);
  if (!also || !also.length) return { row, v };
  // The row is the expensive half — bars, the 52-week window, a Wilder RSI —
  // and it is rule-set independent. So comparing five rule sets costs four more
  // `evaluate` calls on a row already in hand, not five passes over the archive.
  const by = {};
  for (const c of also) by[c.profile] = (c === use ? v : Action.evaluate(row, c));
  return { row, v, by };
}

function btRun(opts) {
  const { bars, snapshot, from, tiers, earnings, recorded, only, cfg, compare } = opts;
  btRsiCache.clear();
  const want = new Set(tiers);
  const use = cfg || ACTION_CFG;
  // Every rule set measured on the same date, the same rows and the same
  // verdicts asked for — the only comparison that says anything, since a
  // different date or a different tier selection would move the answer more
  // than the rules do.
  const also = (compare || []).map(ruleCfg);
  const cmp = new Map(also.map((c) => [c.profile, { profile: c.profile, n: 0, sum: 0, strong: 0 }]));
  const byS = new Map((snapshot || []).map((x) => [x.symbol, x]));
  const picks = [];
  const heldSeries = {};
  // Kept for the rebalancer: the same arrays, so evaluating at six more dates
  // costs six evaluations rather than six more passes over the archive.
  const prep = {};
  const everySeries = {};
  let evaluated = 0, tooShort = 0, noFund = 0, real = 0, imputed = 0;

  for (const sym of Object.keys(bars)) {
    // Scoped to a theme when one is chosen: the rules are run over those
    // stocks and nothing else, so a run on Chips asks what the rules did
    // INSIDE Chips rather than picking Chips names out of 430.
    if (only && !only.has(sym)) continue;
    const rows = (bars[sym] || []).slice().reverse();   // archive is newest-first
    btRsiCache.delete(rows);
    if (!rows.length) continue;
    const dates = rows.map((r) => String(r.datetime).slice(0, 10));
    const closes = rows.map((r) => Number(r.close));
    const highs = rows.map((r) => Number(r.high) || Number(r.close));
    const vols = rows.map((r) => Number(r.volume) || 0);
    // the session on or before the chosen date
    let i = -1;
    for (let k = dates.length - 1; k >= 0; k--) if (dates[k] <= from) { i = k; break; }
    if (i < 0) continue;
    const forward = [];
    for (let k = i; k < dates.length; k++) forward.push({ d: dates[k], c: closes[k] });
    // EVERY symbol, benchmarks included: a re-run can buy something that was
    // not in the opening basket, and one of them may be an index ETF.
    if (forward.length > 1) everySeries[sym] = forward;
    prep[sym] = { rows, dates, closes, highs, vols };

    if (i < 252) { tooShort++; continue; }             // no 52-week window yet
    const tech = btRowAt(closes, highs, vols, i);
    if (!tech) continue;
    const today = byS.get(sym) || {};
    if (today.qualityRating == null && today.forwardPe == null) noFund++;
    // The fundamentals AS THEY STOOD, when we recorded them. fundamentals_history
    // holds 42 fields — every one the Balanced gate and classify() read, since
    // `use_quality` is off in Balanced and qualityRating is the only field it
    // does not store. Where there is no recorded row yet (nothing before
    // 2026-08-30 exists at all) today's values stand in, as before.
    const was = recorded ? recorded[sym] : null;
    if (was) real++; else imputed++;
    // TODAY's fundamentals, THAT DATE's technicals. Starting from the live row
    // rather than listing the fundamental fields means a field added to the
    // engine later is carried here with no edit \u2014 and it is exactly what
    // "fundamentals filled forward" means.
    const { row, v, by } = btEvalAt(sym, { rows, dates, closes, highs, vols, tech },
      i, today, was, earnings, from, use, also);
    evaluated++;
    // Hoisted above the tier test: every rule set's comparison needs it, not
    // only the one that happened to pick this stock.
    const ret = (closes[closes.length - 1] / closes[i] - 1) * 100;
    if (by) {
      for (const name of Object.keys(by)) {
        const c = cmp.get(name);
        if (!c || !want.has(by[name].action)) continue;
        c.n++; c.sum += ret;
        if (by[name].action === 'Strong Buy') c.strong++;
      }
    }
    if (!want.has(v.action)) continue;
    // What a Top-N cut ranks on, AS OF THEN — computed only for rows that made
    // the cut, so a run that picks 12 of 427 pays for 12.
    const m = btRankMetrics(row, rows, i, use);
    picks.push({ symbol: sym, name: today.shortName || today.name || sym,
      action: v.action, flag: v.flag, type: v.type,
      cushion: m.cushion,
      tierRank: Action.ACTIONS.indexOf(v.action),
      fundAsOf: was ? was.asOf : null,
      priceThen: closes[i], dateThen: dates[i],
      priceNow: closes[closes.length - 1], lastDate: dates[dates.length - 1],
      ret,
      reportedInWindow: (earnings[sym] || []).some((d) => d > from),
      // "Verdict now" has to be read under the SAME rules as "verdict then",
      // or the two columns quietly compare two different machines. The
      // snapshot's stamped verdict is Balanced's, so it stands only for
      // Balanced; anything else is re-evaluated against the live row.
      actionNow: (use === ACTION_CFG ? today.action : (Action.evaluate(today, use) || {}).action) || null });
    if (forward.length > 1) heldSeries[sym] = forward;
  }

  picks.sort((a, b) => b.ret - a.ret);
  return { picks, heldSeries, everySeries, prep,
           evaluated, tooShort, noFund, real, imputed,
           // Equal dollars at the start, held: for that shape a basket's return
           // IS the mean of its members' returns, so no second simulation is
           // needed to price four more rule sets.
           compare: [...cmp.values()].map((c) => ({ profile: c.profile, n: c.n,
             strong: c.strong, ret: c.n ? c.sum / c.n : null })) };
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
  ['capBand', 'size band from that cap: Mega $200B+ / Large $50-200B / Mid-Large $10-50B / ' +
    'Mid $2-10B / Small $300M-2B / Micro under $300M; blank for funds, which report AUM. ' +
    'The $50B line inside Large is this site\'s own cut, not an industry standard'],
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
  // BOTH READS AT ONCE. The profile only ever needed the symbol off the query
  // string, so waiting for the 3.56MB snapshot before asking for it bought
  // nothing — the screener's own Promise.all lesson, unapplied here. Each keeps
  // its own failure: the profile is optional (three display fields), the
  // snapshot is the answer.
  const [snap, profile, earnings] = await Promise.all([
    snapshotCached(),
    store.readProfile(symbol).catch(() => null),
    // Seeks on the (symbol, d) primary key. Optional like the profile: a page
    // that loses its earnings table is thinner, not broken.
    store.readEarnings(symbol).catch(() => []),
  ]);
  const stocks = (snap && snap.stocks) || [];
  const stock = stocks.find((x) => String(x.symbol).toUpperCase() === symbol);
  if (!stock) return res.status(404).json({ error: 'Not in the screener.' });
  // The band, stamped here as it is on every other read path. It was NOT, so
  // `capBand` came back undefined and the Size row drew nothing on the stock
  // page and was skipped entirely on /compare — a field that exists, is
  // offered by both field pickers, and silently has no value, which is the
  // same defect the bare-string Size getter had and was hiding behind.
  // Synchronous and free: it reads marketCap and nothing else.
  stampCapBand([stock]);

  res.json({
    stock,
    company: profile ? {
      description: profile.description || null,
      employees: profile.employees ?? null,
      website: profile.website || null,
    } : null,
    // Every stored quarter, newest first. Deliberately NOT in the snapshot:
    // it is per-symbol and nothing else on any page reads it.
    earnings,
    // The symbol picker's list. The whole snapshot is already in memory to work
    // out the rank above, so this costs a map and ~3 KB rather than a query.
    // Alphabetical, because the picker is for reaching a ticker you have in
    // mind; the filter box does the rest.
    universe: stocks
      .filter((x) => !x.error)
      .filter((x) => !guest || guestSet.has(String(x.symbol).toUpperCase()))
      // The DISPLAY name too: the compare picker and the chart legend both read
      // it, and "NVIDIA" beats "NVIDIA Corporation" beside a line. `shortName`
      // is stamped on every row on the way out (deriveShortName, plus any
      // override), so it costs nothing here — the same reason the cards label
      // by name rather than by ticker. The legal name stays, so the symbol
      // picker's filter still matches what it always matched.
      .map((x) => ({ symbol: x.symbol, name: x.name || '', short: x.shortName || '' }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    updatedAt: snap.updatedAt || null,
  });
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

// ---- site-wide column visibility -------------------------------------------
// The owner can hide columns for everyone (2026-09-15) — 85 of them is more
// than most accounts want, and a view is a per-person choice rather than a
// default. The CATALOGUE is read out of index.html's own header row rather
// than restated here: the table is the one description of what columns exist,
// and a second list would drift the first time a column was added. Parsed
// once per instance.
let COLUMN_CATALOGUE = null;
function columnCatalogue() {
  if (COLUMN_CATALOGUE) return COLUMN_CATALOGUE;
  const out = [];
  try {
    const html = fs.readFileSync(path.join(__dirname, 'private', 'index.html'), 'utf8');
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    const labels = {};
    for (const m of head.matchAll(/<th class="group grp-([a-z]+)"[^>]*>([^<]+)<\/th>/g)) labels[m[1]] = m[2].trim();
    for (const m of head.matchAll(/<th ([^>]*class="[^"]*grp-([a-z]+)[^"]*"[^>]*)>([\s\S]*?)<\/th>/g)) {
      const attrs = m[1];
      const group = m[2];
      if (attrs.includes('class="group')) continue;       // the banner itself
      const id = (/data-col="([^"]+)"/.exec(attrs) || /data-fkey="([^"]+)"/.exec(attrs)
        || /data-key="([^"]+)"/.exec(attrs) || [])[1];
      if (!id || group === 'fwd') continue;               // forward returns follow the as-of mode
      const label = m[3].replace(/<br\s*\/?>/g, ' ').replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
      out.push({ id, label, group, groupLabel: labels[group] || group });
    }
  } catch (err) {
    console.warn('column catalogue could not be read:', err.message);
  }
  COLUMN_CATALOGUE = out;
  return out;
}

// ---- the export ------------------------------------------------------------
// The owner asked for the screener as a spreadsheet, "however in future maybe
// it can be extended to download price or fundamental data". So a DATASET is a
// registry entry — a label, a note, the fields it offers and the rows it
// yields — rather than a route per thing. Adding prices later is one entry;
// the page renders whatever the catalogue returns and needs no edit at all.
//
// SIX COLUMNS THE TABLE DRAWS THAT A ROW DOES NOT HOLD, each with its reason.
// Measured against the live snapshot rather than assumed: of the 85 columns in
// the catalogue, these six carry no value on any of 742 rows. Exporting them as
// empty columns is the quiet lie this file warns about in three other places,
// so they are left out and the page says which and why.
const EXPORT_SKIP = {
  spark90: 'a drawing, not a value',
  newsAge: 'fetched separately, never stored on the row',
  'av:Trend Rider': 'read in the browser under another rule set',
  'av:Aggressive': 'read in the browser under another rule set',
  'av:Max Risk': 'read in the browser under another rule set',
  'av:Dip Buyer': 'read in the browser under another rule set',
};
// The anchors: always written, never offered as a tick. A sheet of numbers
// with no symbol on it is not an export of anything. They are also exactly the
// columns `columnCatalogue()` leaves out, being the table's frozen pair.
const EXPORT_ANCHORS = [
  { id: 'symbol', label: 'Symbol' },
  { id: 'shortName', label: 'Name' },
];
// Two ids do not read straight off the row.
function exportValue(row, id) {
  if (id === 'av:Balanced') return row.action;     // the stamped Balanced verdict
  const v = row[id];
  if (Array.isArray(v)) return v.join(' · ');
  return v === undefined ? null : v;
}

const EXPORT_DATASETS = {
  screener: {
    label: 'Screener',
    note: 'One row per stock — every column the table can show, as it stands now.',
    async fields() {
      // Site-hidden columns are OFFERED, and marked. The floor at /columns is
      // about what the table shows everyone; the data is still recorded, and
      // an admin taking their own data out should not have to undo a display
      // choice to get at it.
      const hidden = new Set(await store.readHiddenColumns().catch(() => []));
      return columnCatalogue().filter((c) => !EXPORT_SKIP[c.id])
        .map((c) => ({ id: c.id, label: c.label, group: c.groupLabel, hidden: hidden.has(c.id) }));
    },
    async rows(scope) {
      // A fresh install has no snapshot at all, and this page is reachable
      // before the first refresh has ever run — so it answers "nothing yet"
      // rather than 500-ing on a null.
      const snap = (await readSnapshot()) || {};
      const all = (snap.stocks || []).filter((s) => s && s.symbol);
      // The SAME stamps the screener is served with, from the same list — a
      // capBand or a display name missing here would be a spreadsheet that
      // quietly disagrees with the page it came from.
      const [, , , pf] = await Promise.all([...serveStamps(all), readPortfolios()]);
      scoreActionInto(all);
      finishServe(all, pf);
      const rows = scope && scope !== 'All'
        ? all.filter((s) => (s.portfolios || []).includes(scope))
        : all;
      return { rows, scopes: ['All', ...Object.keys(pf)], updatedAt: snap.updatedAt || null };
    },
  },
};

app.get('/api/export/catalogue', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const out = [];
  for (const [id, d] of Object.entries(EXPORT_DATASETS)) {
    out.push({ id, label: d.label, note: d.note, fields: await d.fields() });
  }
  const { rows, scopes, updatedAt } = await EXPORT_DATASETS.screener.rows('All');
  res.json({ datasets: out, scopes, rows: rows.length, updatedAt,
    skipped: Object.entries(EXPORT_SKIP).map(([id, why]) => ({ id, why })) });
}));

// The file itself. `fields` is a comma-separated list of ids; anything the
// dataset does not offer is dropped rather than exported blank.
app.get('/api/export/download', requireAdmin, route(async (req, res) => {
  const dsId = String(req.query.dataset || 'screener');
  const ds = EXPORT_DATASETS[dsId];
  if (!ds) return res.status(400).json({ error: 'Unknown dataset: ' + dsId });
  const format = String(req.query.format || 'xlsx').toLowerCase();
  if (format !== 'xlsx' && format !== 'csv') {
    return res.status(400).json({ error: 'Unknown format: ' + format });
  }
  const offered = await ds.fields();
  const byId = new Map(offered.map((f) => [f.id, f]));
  const want = String(req.query.fields || '').split(',').map((s) => s.trim()).filter(Boolean);
  const cols = EXPORT_ANCHORS.concat(want.filter((id) => byId.has(id)).map((id) => byId.get(id)));
  if (cols.length <= EXPORT_ANCHORS.length) {
    return res.status(400).json({ error: 'Choose at least one field to export.' });
  }
  const scope = String(req.query.scope || 'All');
  const { rows } = await ds.rows(scope);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `tickrlab-${dsId}${scope && scope !== 'All' ? '-' + scope.replace(/[^\w-]+/g, '-') : ''}-${stamp}`;
  logAct(req, 'export', `${dsId}:${format}:${cols.length}f:${rows.length}r`);

  if (format === 'csv') {
    // Quote everything that could be misread: a comma, a quote, a newline, and
    // a leading = + - @, which a spreadsheet would treat as a formula.
    const q = (v) => {
      if (v == null) return '';
      const s = String(v);
      const risky = /^[=+\-@]/.test(s) || /[",\n\r]/.test(s);
      return risky ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.map((c) => q(c.label)).join(',')];
    for (const r of rows) lines.push(cols.map((c) => q(exportValue(r, c.id))).join(','));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.send('﻿' + lines.join('\r\n'));   // BOM, or Excel mangles accents
  }

  const XLSX = require('./xlsx.js');
  const head = cols.map((c) => ({ v: c.label, s: XLSX.S.head }));
  const body = rows.map((r) => cols.map((c) => {
    const v = exportValue(r, c.id);
    // A NUMBER MUST ARRIVE AS A NUMBER or the sheet cannot sum, sort or chart
    // it — which is most of the reason to want a spreadsheet at all.
    return typeof v === 'number' && isFinite(v) ? v : (v == null ? null : String(v));
  }));
  const widths = cols.map((c) => Math.min(30, Math.max(9, c.label.length + 3)));
  const sheet = XLSX.sheetXml([head, ...body], {
    widths, freeze: 1, tab: true,
    // The header row filters and the top row stays put: on 742 rows and 80
    // columns that is the difference between a spreadsheet and a dump.
    autoFilter: `A1:${XLSX.colName(cols.length - 1)}${rows.length + 1}`,
  });
  const buf = XLSX.workbook([{ name: XLSX.sheetName(ds.label), xml: sheet }]);
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="${base}.xlsx"`);
  return res.send(buf);
}));

// Admin: everything, drafts included, with the markdown source.
app.get('/api/admin/posts', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const slug = String(req.query.slug || '');
  if (slug) {
    const p = await store.readPost(slug, { publishedOnly: false });
    if (!p) return res.status(404).json({ error: 'No such post.' });
    return res.json({ post: { ...p, html: renderMarkdown(p.body) } });
  }
  res.json({ posts: await store.readPosts({ publishedOnly: false }) });
}));

// Admin: write one. The slug comes from the title unless it is given, and a
// rename carries the old post to the new slug rather than leaving two.
app.put('/api/admin/posts', requireAdmin, route(async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 160);
  const body = String(b.body || '').slice(0, 100000);
  if (!title) return res.status(400).json({ error: 'A title is required.' });
  if (!body.trim()) return res.status(400).json({ error: 'The post is empty.' });
  const slug = slugify(b.slug || title);
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'That title does not make a usable web address.' });
  const was = String(b.was || '').trim();
  const status = b.status === 'published' ? 'published' : 'draft';

  const existing = await store.readPost(slug, { publishedOnly: false });
  if (existing && was && was !== slug) return res.status(409).json({ error: `A post already lives at /blog/${slug}.` });
  if (existing && !was) return res.status(409).json({ error: `A post already lives at /blog/${slug}.` });
  if (was && was !== slug) await store.renamePost(was, slug);
  const prev = existing || (was ? await store.readPost(slug, { publishedOnly: false }) : null);

  const who = await currentUser(req);
  const post = await store.writePost({
    slug, title, body,
    summary: String(b.summary || '').trim().slice(0, 300) || null,
    status,
    author: (prev && prev.author) || String(b.author || '').trim().slice(0, 60) || (who ? who.email.split('@')[0] : null),
    // Stamped once, on the first publish: an edit later must not reorder the list.
    publishedAt: status === 'published' ? ((prev && prev.publishedAt) || new Date().toISOString()) : (prev && prev.publishedAt) || null,
    createdAt: (prev && prev.createdAt) || Date.now(),
  });
  logAct(req, 'post', `${status}:${slug}`.slice(0, 80));
  res.json({ ok: true, post, html: renderMarkdown(post.body) });
}));

// Send a post to a handful of people. ONE MESSAGE EACH, never a shared To
// line — a list of addresses in a header is other people's addresses given
// away, and there is no way to take it back.
//
// Deliberately NOT a subscriber list: there is no sign-up, nothing stored and
// nobody to unsubscribe, which is what keeps this person-to-person mail rather
// than a broadcast with legal obligations attached. If it ever becomes a list,
// it needs confirmed opt-in and a one-click unsubscribe in every message.
const MAIL_POST_MAX = 25;

// Free text: commas, semicolons, newlines, spaces, and "Name <a@b.com>" pasted
// out of a mail client. Kept apart into good and bad so the reply can name what
// it could not read rather than silently dropping it.
function parseAddresses(raw) {
  const seen = new Set();
  const good = [], bad = [];
  for (const tok of String(raw || '').split(/[\s,;]+/)) {
    const t = tok.trim().replace(/^</, '').replace(/>$/, '');
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    // `EMAIL_RE` is the one the sign-up and reset paths already use. Splitting
    // on commas and semicolons first means a token cannot contain either, so
    // the shared shape is enough and a second, subtly different one is exactly
    // the kind of near-duplicate that drifts.
    (EMAIL_RE.test(t) ? good : bad).push(t);
  }
  return { good, bad };
}

app.post('/api/admin/posts/:slug/email', requireAdmin, route(async (req, res) => {
  if (!MAIL_READY) {
    return res.status(503).json({ error: 'Email is not configured on this server, so nothing can be sent.' });
  }
  const p = await store.readPost(req.params.slug, { publishedOnly: false });
  if (!p) return res.status(404).json({ error: 'No such post.' });
  // A draft's link 404s for everyone but you, so the mail would be an invitation
  // to a page the reader cannot open.
  if (p.status !== 'published') {
    return res.status(400).json({ error: 'Publish it first — a draft 404s for anyone who follows the link.' });
  }
  const { good, bad } = parseAddresses(req.body && req.body.to);
  if (!good.length) {
    return res.status(400).json({
      error: bad.length ? `No address there that I can read (${bad.slice(0, 3).join(', ')}).` : 'Nobody to send it to.',
      invalid: bad,
    });
  }
  if (good.length > MAIL_POST_MAX) {
    return res.status(400).json({ error: `${good.length} addresses — ${MAIL_POST_MAX} at a time is the limit.` });
  }

  const base = APP_URL || `https://${req.headers.host}`;
  const url = `${base}/blog/${p.slug}`;
  const who = await currentUser(req);
  const from = (who && who.email) || (await ownerEmail());
  const intro = p.summary || `A new post on ${BRAND}.`;
  const note = from
    ? `${mailEsc(from)} sent you this post from ${BRAND}. Reply to reach them directly.`
    : `Sent from ${BRAND}.`;
  const html = emailShell({ heading: p.title, intro, body: postEmail(p, url), note });
  const txt = postAsText(p, url);
  const text = textShell({
    heading: p.title, intro,
    lines: txt.lines.concat(['', 'Read it on the site: ' + url]),
    note: from ? `${from} sent you this post from ${BRAND}.` : '',
  });

  // Sequential, with each failure kept rather than thrown: one bad address must
  // not decide the fate of the other twenty-four. Nothing may run after the
  // response on this platform, so it is all awaited here — 25 sends is a few
  // seconds, far inside the platform's ceiling.
  const sent = [], failed = [];
  for (const to of good) {
    const okSend = await sendMail({ to, subject: p.title, text, html, replyTo: from || undefined });
    (okSend ? sent : failed).push(to);
  }
  logAct(req, 'post', `emailed:${p.slug} ${sent.length}/${good.length}`.slice(0, 80));
  res.json({ ok: failed.length === 0, sent, failed, invalid: bad });
}));

app.delete('/api/admin/posts/:slug', requireAdmin, route(async (req, res) => {
  const gone = await store.deletePost(req.params.slug);
  if (!gone) return res.status(404).json({ error: 'No such post.' });
  logAct(req, 'post', 'delete:' + req.params.slug.slice(0, 60));
  res.json({ ok: true });
}));

// ---- blog images ------------------------------------------------------------
// Stored in Turso because it is the only store there is: a serverless
// filesystem discards writes, and `public/` is a git directory the CDN serves,
// so "upload" there would mean a commit and a deploy.
//
// THE EDITOR RESIZES BEFORE IT SENDS, which is what makes that affordable -- a
// 4MB phone photo arrives as tens of KB. The cap here is the backstop, not the
// mechanism, and it is generous enough that a legitimate resize never hits it.
const IMG_MAX_BYTES = 2 * 1024 * 1024;
const IMG_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

app.post('/api/admin/posts/image', requireAdmin, route(async (req, res) => {
  const dataUrl = String(req.body?.dataUrl || '');
  const m = /^data:([a-z]+\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!m) return res.status(400).json({ error: 'Send the image as a base64 data URL.' });
  const mime = m[1].toLowerCase();
  if (!IMG_MIME[mime]) {
    return res.status(400).json({ error: `That is a ${mime}. Use a JPEG, PNG, WebP or GIF.` });
  }
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length) return res.status(400).json({ error: 'That file is empty.' });
  if (bytes.length > IMG_MAX_BYTES) {
    return res.status(413).json({
      error: `That is ${(bytes.length / 1048576).toFixed(1)}MB and the ceiling is 2MB. `
        + 'The editor normally shrinks a picture before sending it, so this one may have arrived another way.' });
  }
  // The id IS the content, so the same picture twice is one row and the URL can
  // never come to mean different bytes -- which is what lets it be cached for a
  // year rather than revalidated on every page view.
  const id = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  const saved = await store.writePostImage({ id, mime, bytes });
  logAct(req, 'post', `image:${id.slice(0, 12)}`);
  res.json({ ok: true, ...saved, url: `/blog/img/${id}` });
}));

app.get('/api/admin/posts/images', requireAdmin, route(async (req, res) => {
  res.json({ images: (await store.listPostImages()).map((i) => ({ ...i, url: `/blog/img/${i.id}` })) });
}));

app.delete('/api/admin/posts/image/:id', requireAdmin, route(async (req, res) => {
  const gone = await store.deletePostImage(req.params.id);
  if (!gone) return res.status(404).json({ error: 'No such image.' });
  logAct(req, 'post', 'image-delete:' + String(req.params.id).slice(0, 24));
  res.json({ ok: true });
}));

// ---- the tile setup ---------------------------------------------------------
// What a tile shows, site-wide. The FIELDS are keys from rowcard's FIELD_SPEC
// (`group|label`), so the tile and the hover card cannot disagree about what a
// field is called or how it is formatted; the server only checks their shape,
// the way it does for column views — the browser ignores a key it no longer
// knows, so adding or renaming a field needs no edit here.
// `group|label`, where the group is one the table really has — rowcard's
// GROUP_ORDER. The LABEL is only shape-checked: it is rowcard's own text, the
// browser ignores a key it no longer knows, and renaming a field there should
// not need an edit here.
const TILE_GROUPS = ['info', 'rank', 'act', 'chart', 'short', 'long', 'rel', 'trend', 'vol', 'size', 'fund', 'own'];
// A literal, not a built string: inside a template literal `\|` collapses to a
// bare pipe, which made this "one of the groups, OR anything at all" — the
// test caught a field key of `evil|drop table` being stored.
const TILE_FIELD_RE = /^(info|rank|act|chart|short|long|rel|trend|vol|size|fund|own)\|[^|]{1,32}$/;
const TILE_SPARK_DAYS = [0, 21, 63, 126, 252];
const TILE_FIELDS_MAX = 6;   // six reads as a tile; eight reads as a table cell
const TILE_HEIGHTS = [44, 72, 110];
const TILE_DEFAULT = {
  spark: 90,                    // trading sessions in the tile's chart; 0 hides it
  sparkH: 72,                   // how tall it is drawn, in pixels
  fields: ['short|1W', 'short|1M', 'long|1Y', 'long|5Y'],
  scores: true,                 // the Overall / Mom / Qual chips
  sector: true,
  verdict: true,                // the Advice word
  why: true,                    // and the rule that fired
  trend: true,                  // the Trend state beside the verdict
};

function cleanTileConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const spark = TILE_SPARK_DAYS.includes(Number(c.spark)) || Number(c.spark) === 90
    ? Number(c.spark) : TILE_DEFAULT.spark;
  const fields = Array.isArray(c.fields)
    ? [...new Set(c.fields.filter((f) => typeof f === 'string' && TILE_FIELD_RE.test(f)))].slice(0, TILE_FIELDS_MAX)
    : TILE_DEFAULT.fields;
  const flag = (k) => (typeof c[k] === 'boolean' ? c[k] : TILE_DEFAULT[k]);
  const sparkH = TILE_HEIGHTS.includes(Number(c.sparkH)) ? Number(c.sparkH) : TILE_DEFAULT.sparkH;
  return { spark, sparkH, fields, scores: flag('scores'), sector: flag('sector'),
    verdict: flag('verdict'), why: flag('why'), trend: flag('trend') };
}

let tileConfigCache = null;
async function tileConfig() {
  if (tileConfigCache && Date.now() - tileConfigCache.at < 60 * 1000) return tileConfigCache.cfg;
  const cfg = cleanTileConfig(await store.readTileConfig());
  tileConfigCache = { at: Date.now(), cfg };
  return cfg;
}

// ---- the mobile page --------------------------------------------------------
// What the phone offers, decided on a desktop. The page itself has no settings:
// the owner's request was "the mobile view setup should be available to admin
// to configure on the desktop… the mobile view does not need any configuration
// option but should have option to change the view".
const MOBILE_VIEWS_MAX = 6;
const MOBILE_FIELDS_MAX = 5;          // a phone row, not a table row
const MOBILE_DEFAULT = {
  views: [
    { id: 'move', name: 'Move', fields: ['short|Today', 'short|1W', 'short|1M', 'long|1Y'] },
    { id: 'verdict', name: 'Verdict', fields: ['act|Advice', 'act|Trend', 'act|Entry', 'rank|Overall'] },
    { id: 'value', name: 'Value', fields: ['fund|Fwd P/E', 'fund|ROE', 'fund|Profit margin', 'info|Market Cap'] },
  ],
};

function cleanMobileConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const known = new Set(RowCard.fieldCatalogue().map((f) => f.key));
  const seen = new Set();
  const views = (Array.isArray(c.views) ? c.views : [])
    .map((v) => {
      const name = String((v && v.name) || '').trim().slice(0, 24);
      const id = slugify((v && v.id) || name).slice(0, 24);
      const fields = (Array.isArray(v && v.fields) ? v.fields : [])
        .filter((f) => known.has(f)).slice(0, MOBILE_FIELDS_MAX);
      return { id, name, fields };
    })
    .filter((v) => v.id && v.name && v.fields.length && !seen.has(v.id) && seen.add(v.id))
    .slice(0, MOBILE_VIEWS_MAX);
  return { views: views.length ? views : MOBILE_DEFAULT.views };
}

let mobileCfgCache = null;
async function mobileConfig() {
  if (mobileCfgCache && Date.now() - mobileCfgCache.at < 60 * 1000) return mobileCfgCache.cfg;
  const cfg = cleanMobileConfig(await store.readMobileConfig());
  mobileCfgCache = { at: Date.now(), cfg };
  return cfg;
}

// A row, rendered for a phone: the fixed head every list needs, plus the
// chosen view's fields formatted by rowcard — the same text the hover card and
// the tiles show, so a value cannot read differently on a phone.
function mobileRow(x, fields) {
  const vals = RowCard.fieldValues(x);
  const cur = { USD: '$', EUR: '\u20ac', GBP: '\u00a3', JPY: '\u00a5', KRW: '\u20a9', CAD: 'C$',
    AUD: 'A$', HKD: 'HK$', TWD: 'NT$', INR: '\u20b9', CHF: 'CHF ' }[x.currency || 'USD'] || '';
  return {
    symbol: x.symbol,
    name: x.shortName || x.name || x.symbol,
    price: x.price == null ? null : cur + x.price.toFixed(2),
    today: x.todayPct == null ? null : (x.todayPct >= 0 ? '+' : '') + x.todayPct.toFixed(1) + '%',
    up: x.todayPct == null ? null : x.todayPct >= 0,
    action: x.action || null,
    fields: fields.map((k) => {
      const v = vals[k];
      return { k: k.slice(k.indexOf('|') + 1), t: v ? v.t : '\u2014', c: v ? v.c : 'na' };
    }),
  };
}

// The ranges a card offers. No 1D: the archive is daily bars, so a single
// session is a single point — a button that drew nothing would be a lie. The
// top is a year, which keeps the widest read at ~68k rows (Turso meters rows
// read, and that lesson is written up under the anchor query).
const CARD_RANGES = [
  { id: '1w', label: '1 week', short: '1W', days: 5 },
  { id: '1m', label: '1 month', short: '1M', days: 21 },
  { id: '3m', label: '3 months', short: '3M', days: 63 },
  { id: '6m', label: '6 months', short: '6M', days: 126 },
  { id: '1y', label: '1 year', short: '1Y', days: 253 },
];
const cardRange = (id) => CARD_RANGES.find((r) => r.id === String(id || '')) || CARD_RANGES[2];

// A chart's points, thinned for a phone. Fewer coordinates than sessions is
// invisible at this width and halves what goes over the wire.
const CARD_POINTS = 64;
function thin(closes) {
  if (!closes || closes.length <= CARD_POINTS) return closes || [];
  const step = (closes.length - 1) / (CARD_POINTS - 1);
  return Array.from({ length: CARD_POINTS }, (_, i) => closes[Math.round(i * step)]);
}

async function mobileRows(req) {
  const snap = await readSnapshot();
  let rows = ((snap && snap.stocks) || []);
  if (await isGuest(req)) rows = rows.filter((x) => guestSet.has(String(x.symbol).toUpperCase()));
  scoreActionInto(rows);
  await stampShortNames(rows);
  await stampAdviceAge(rows);
  await stampPricedAt(rows);
  stampCapBand(rows);
  return rows;
}

app.get('/api/m/config', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ...(await mobileConfig()),
    max: MOBILE_VIEWS_MAX,
    fieldsMax: MOBILE_FIELDS_MAX,
    // The chart ranges, so the page can paint its strip before the first list
    // lands and cannot drift from what the server will actually serve.
    ranges: CARD_RANGES.map((r) => ({ id: r.id, short: r.short, label: r.label })),
  });
}));

app.put('/api/m/config', requireAdmin, route(async (req, res) => {
  const cfg = cleanMobileConfig(req.body && req.body.config);
  await store.writeMobileConfig(cfg);
  mobileCfgCache = { at: Date.now(), cfg };
  logAct(req, 'view', 'mobile:' + cfg.views.length);
  res.json({ ok: true, ...cfg });
}));

// Every screen with how many stocks it holds right now — the phone's front
// page. Counted here rather than on the phone, which is the whole point.
app.get('/api/m/screens', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const [screens, rows] = await Promise.all([store.readScreens(), mobileRows(req)]);
  const list = (screens || []).map((sc) => ({
    id: sc.id, name: sc.name, grp: sc.group, description: sc.description,
    count: Filters.screenRows(sc.def || {}, rows).length,
  }));
  res.json({ screens: list, universe: rows.length });
}));

// One screen's stocks, formatted for the chosen view. This is the request the
// phone actually makes, and it is a few kilobytes: the filtering, the sorting
// and the formatting all happen here.
app.get('/api/m/screen', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const id = String(req.query.id || '');
  const cfg = await mobileConfig();
  const view = cfg.views.find((v) => v.id === String(req.query.view || '')) || cfg.views[0];
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const rows = await mobileRows(req);
  let picked = rows.filter((x) => !x.error);
  let screen = null;
  if (id && id !== 'all') {
    const screens = await store.readScreens();
    screen = (screens || []).find((sc) => sc.id === id);
    if (!screen) return res.status(404).json({ error: 'No such screen.' });
    picked = Filters.screenRows(screen.def || {}, rows);
  } else {
    // Biggest first, the screener's own default now that Overall is gone.
    picked = picked.slice().sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
  }
  const out = picked.slice(0, limit).map((x) => mobileRow(x, view.fields));
  // Charts are opt-in, and the toggle controls the PAYLOAD as much as the
  // display: with it off nothing is drawn and nothing is sent. When it is on,
  // the whole card is rendered here through RowCard.stockCard — the same
  // function the screener's Tiles view draws with.
  const range = cardRange(req.query.range);
  if (String(req.query.chart || '') === '1') {
    const series = await sparkSeries(req, range.days);
    for (const r of out) {
      const s = series[r.symbol];
      r.card = RowCard.stockCard({
        symbol: r.symbol, name: r.name, price: r.price, change: r.today, up: r.up,
        fields: r.fields, closes: s ? thin(s.closes) : null,
        from: s && s.from, to: s && s.to, rangeLabel: range.label,
      }, { size: 'phone', cols: 2 });
    }
  }
  res.json({
    id: id || 'all',
    name: screen ? screen.name : 'Every stock',
    description: screen ? screen.description : null,
    view: { id: view.id, name: view.name, fields: view.fields.map((k) => k.slice(k.indexOf('|') + 1)) },
    range: range.id,
    ranges: CARD_RANGES.map((r) => ({ id: r.id, short: r.short, label: r.label })),
    total: picked.length,
    rows: out,
  });
}));

// One stock, in full, for the sheet that opens when a row is tapped: every
// field rowcard knows, grouped as the hover card groups them, plus its stored
// headlines. One stock is a couple of kilobytes.
app.get('/api/m/stock', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if ((await isGuest(req)) && !guestSet.has(symbol)) {
    return res.status(403).json({ error: 'The guest preview covers only a few stocks.' });
  }
  const rows = await mobileRows(req);
  const x = rows.find((r) => r.symbol === symbol);
  if (!x) return res.status(404).json({ error: 'No such stock.' });
  const vals = RowCard.fieldValues(x);
  const groups = {};
  for (const f of RowCard.fieldCatalogue()) {
    if (f.group === 'fwd') continue;                       // the as-of view's own
    const v = vals[f.key];
    if (!v || v.t === '\u2014') continue;                     // a sheet of dashes helps nobody
    (groups[f.group] = groups[f.group] || []).push({ k: f.label, t: v.t, c: v.c || '' });
  }
  let news = [];
  try { news = NEWS_OFF ? [] : (await store.readNews(symbol, 6)); } catch { news = []; }
  // The sheet's chart follows the same toggle the rows do — one stock, so it
  // is drawn taller and keeps every session rather than being thinned.
  let art = null;
  if (String(req.query.chart || '') === '1') {
    const range = cardRange(req.query.range);
    const s = (await sparkSeries(req, range.days))[symbol];
    art = s && s.closes.length > 1
      ? { svg: RowCard.sparkSVG(s.closes, { w: 320, h: 88, pad: 3, area: true }),
        up: s.closes[s.closes.length - 1] >= s.closes[0],
        window: range.label + ' · ' + s.closes.length + ' sessions' }
      : null;
  }
  res.json({
    symbol, name: x.shortName || x.name || symbol,
    sector: x.sector || null, industry: x.industry || null,
    action: x.action || null, actionFlag: x.actionFlag || null, actionTrend: x.actionTrend || null,
    spark: art ? art.svg : null, sparkUp: art ? art.up : null, sparkWindow: art ? art.window : null,
    groups: Object.entries(groups).map(([g, rowsOut]) => ({ group: g, rows: rowsOut })),
    news: news.map((n) => ({ headline: n.headline, source: n.source, url: n.url, published_at: n.published_at })),
  });
}));

// ---- saved posts ------------------------------------------------------------
// A studio card with its controls remembered and a name on it, so the owner
// can open it on a phone and screenshot it for Instagram. Site-wide and
// admin-curated, the Tile setup pattern: these are the brand's posts, not a
// per-account scratchpad.
const POSTS_MAX = 12;
const POST_SIZES = { portrait: { id: 'portrait', w: 1080, h: 1350 },
  square: { id: 'square', w: 1080, h: 1080 },
  story: { id: 'story', w: 1080, h: 1920 } };
// Control ids are SHAPE-checked, not listed: the studio owns that list, and
// restating it here would drift the first time a control was added. The card
// builder ignores an id it does not know, exactly as cleanViews leaves the
// screener's column list to the screener.
const POST_OPT_KEY = /^[a-z]{3,6}[A-Z][A-Za-z0-9]{0,20}$/;
// The cap is a guard against this becoming free storage, NOT a budget — and it
// was set at 40 while the studio collected 63 controls, so every id past the
// fortieth was silently dropped on save (2026-09-20). That was all seven of the
// Size card's controls, both of Intro's, and annKick/annHead/annBody — the
// Announcement card's free text, lost without a word. It went unnoticed because
// the test reopened a post without first moving the controls away, so the
// assertion passed on values that had never left the page.
//
// **A cap here must clear CONTROL_IDS in promo.html with room to spare**, since
// a template is added there and this number is nowhere near it. 100 against 63.
const POST_OPT_MAX = 100;

function cleanPosts(raw) {
  const known = new Set(Cards.ids);
  const seen = new Set();
  return (Array.isArray(raw) ? raw : [])
    .map((p) => {
      const q = p && typeof p === 'object' ? p : {};
      const name = String(q.name || '').trim().slice(0, 40);
      const id = slugify(q.id || name).slice(0, 24);
      const opts = {};
      let n = 0;
      for (const [k, v] of Object.entries(q.opts && typeof q.opts === 'object' ? q.opts : {})) {
        if (n >= POST_OPT_MAX || !POST_OPT_KEY.test(k)) continue;
        if (v == null || typeof v === 'object') continue;
        opts[k] = String(v).slice(0, 80);
        n++;
      }
      return { id, name, tpl: String(q.tpl || ''), size: String(q.size || 'portrait'), opts };
    })
    .filter((p) => p.id && p.name && known.has(p.tpl) && POST_SIZES[p.size]
      && !seen.has(p.id) && seen.add(p.id))
    .slice(0, POSTS_MAX);
}

let postsCache = null;
async function savedPosts() {
  if (postsCache && Date.now() - postsCache.at < 60 * 1000) return postsCache.list;
  const list = cleanPosts(await store.readPromoPresets());
  postsCache = { at: Date.now(), list };
  return list;
}

// NOT /api/posts — the blog owns that, registered higher up, and Express
// takes the first match: this one answered the blog's empty list instead.
app.get('/api/promo-posts', requireMember, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ posts: await savedPosts(), max: POSTS_MAX });
}));

app.put('/api/promo-posts', requireAdmin, route(async (req, res) => {
  const list = cleanPosts(req.body && req.body.posts);
  await store.writePromoPresets(list);
  postsCache = { at: Date.now(), list };
  logAct(req, 'view', 'posts:' + list.length);
  res.json({ ok: true, posts: list, max: POSTS_MAX });
}));

// ---- saved pivots ----------------------------------------------------------
// The promo-preset model applied to /pivot, at the owner's instruction: one
// site-wide list, every member sees it, only the owner writes. A saved pivot
// is the QUESTION and not the answer — two dimensions, a measure and a page
// filter — so opening one tomorrow counts tomorrow's screen.
const PIVOTS_MAX = 20;
// SHAPE-CHECKED, not listed against DIMS/MEASURES: those live in pivot.html,
// and restating them here would drift the first time a dimension was added.
// The page already ignores a key it does not know — `childOf` dimensions and
// the same-dimension guard both re-derive on load — which is the rule
// cleanViews follows for the screener's columns and cleanPosts for the
// studio's controls.
const PIVOT_KEY_RE = /^[a-zA-Z][a-zA-Z0-9]{0,23}$/;

function cleanPivots(raw) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : [])
    .map((p) => {
      const q = p && typeof p === 'object' ? p : {};
      const name = String(q.name || '').trim().slice(0, 40);
      const key = (v) => (PIVOT_KEY_RE.test(String(v || '')) ? String(v) : '');
      return {
        id: slugify(q.id || name).slice(0, 24),
        name,
        rowKey: key(q.rowKey),
        colKey: key(q.colKey),
        measure: key(q.measure) || 'count',
        pageDim: key(q.pageDim) || 'none',
        heat: key(q.heat) || 'grid',
        // A VALUE, not an identifier: it is a sector, a theme or a band name
        // that came out of the data, so anything printable is legitimate.
        // Narrowing this is how every screen silently lost its `<` and `>`
        // filters in 2026-09-15 — the page escapes it where it is shown.
        pageVal: String(q.pageVal == null ? '' : q.pageVal).slice(0, 80),
      };
    })
    // Both axes are required: a pivot with one dimension is not a pivot, and
    // a preset that opened to a broken grid would be worse than none.
    .filter((p) => p.id && p.name && p.rowKey && p.colKey
      && !seen.has(p.id) && seen.add(p.id))
    .slice(0, PIVOTS_MAX);
}

let pivotsCache = null;
async function savedPivots() {
  if (pivotsCache && Date.now() - pivotsCache.at < 60 * 1000) return pivotsCache.list;
  const list = cleanPivots(await store.readPivotPresets());
  pivotsCache = { at: Date.now(), list };
  return list;
}

app.get('/api/pivot-presets', requireMember, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ presets: await savedPivots(), max: PIVOTS_MAX });
}));

app.put('/api/pivot-presets', requireAdmin, route(async (req, res) => {
  const list = cleanPivots(req.body && req.body.presets);
  await store.writePivotPresets(list);
  pivotsCache = { at: Date.now(), list };
  logAct(req, 'view', 'pivots:' + list.length);
  res.json({ ok: true, presets: list, max: PIVOTS_MAX });
}));

// The phone lists posts by NAME and builds one only when it is opened
// (owner's call: "I need to see the Preset name and when it click on it it
// should open the visualization"). So the list is a few hundred bytes and the
// archive read a chart card needs happens on the tap, not on the tab.
// Member-only: a guest sees neither the studio nor the portfolio names and
// whole-universe rankings these carry.
app.get('/api/m/posts', requireMember, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const posts = await savedPosts();
  res.json({ posts: posts.map((p) => ({ id: p.id, name: p.name, tpl: p.tpl, size: POST_SIZES[p.size] })) });
}));

// One post, built from the snapshot as it stands right now.
app.get('/api/m/post', requireMember, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const id = String(req.query.id || '');
  const post = (await savedPosts()).find((p) => p.id === id);
  if (!post) return res.status(404).json({ error: 'No such post.' });

  const snap = await readSnapshot();
  const stocks = ((snap && snap.stocks) || []);
  scoreActionInto(stocks);
  await stampShortNames(stocks);
  await stampAdviceAge(stocks);
  await stampPricedAt(stocks);
  stampCapBand(stocks);
  const myLists = await store.readUserPortfolios(await prefsKey(req));
  // A post saved with a screen cut needs the screens to resolve it. Optional
  // like the basket below: a failure here draws the card over the whole screen
  // rather than refusing to draw it, and scopeOf names no screen in the kicker
  // when it cannot find one — so the card stays honest about what it shows.
  let screens = [];
  try { screens = await store.readScreens(); } catch { screens = []; }

  // Two templates read the archive; the rest never touch it.
  let basket = null;
  if (post.tpl === 'chart' || post.tpl === 'sparks') {
    const key = post.tpl === 'chart' ? post.opts.chtWin : post.opts.spkWin;
    const win = Cards.CHART_WINDOWS[key] || Cards.CHART_WINDOWS.m6;
    // The studio always reads the whole universe and lets the card narrow it.
    try { basket = await basketPayload(req, 'All', win[0]); } catch { basket = null; }
  }
  // A one-stock chart with a moving average needs that symbol's closes from
  // BEFORE the window — the basket only carries the window itself. Cards says
  // what it needs so this and the studio cannot ask for different depths; a
  // post saved with a 200-day average would otherwise open here without one,
  // silently, because the builder simply found no history to draw from.
  let hist = null;
  if (post.tpl === 'chart') {
    const need = Cards.chartHistoryNeed(post.opts || {});
    if (need && need.symbol) {
      try {
        const bars = await store.readBars(need.symbol, need.days);   // newest-first
        const asc = bars.slice().reverse();
        hist = { dates: asc.map((b) => b.datetime), closes: asc.map((b) => b.close) };
      } catch { hist = null; }
    }
  }

  const size = POST_SIZES[post.size];
  let html = '';
  try {
    html = Cards.build(post.tpl, {
      stocks, myLists, screens, size, opts: post.opts, getBasket: () => basket,
      getHistory: () => hist,
      updatedAt: (snap && snap.updatedAt) || null,
    });
  } catch (e) {
    return res.status(500).json({ error: 'That card could not be drawn.' });
  }
  res.json({ id: post.id, name: post.name, tpl: post.tpl, size, html, style: Cards.STYLE,
    updatedAt: (snap && snap.updatedAt) || null });
}));

app.get('/api/tile-config', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ tile: await tileConfig(), sparkDays: [21, 63, 126, 252],
    heights: TILE_HEIGHTS, max: TILE_FIELDS_MAX });
}));

app.put('/api/tile-config', requireAdmin, route(async (req, res) => {
  const cfg = cleanTileConfig(req.body && req.body.tile);
  await store.writeTileConfig(cfg);
  tileConfigCache = { at: Date.now(), cfg };
  logAct(req, 'view', 'tiles:' + cfg.fields.length);
  res.json({ ok: true, tile: cfg });
}));

app.get('/api/columns', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ columns: columnCatalogue(), hidden: await store.readHiddenColumns() });
}));

app.put('/api/columns', requireAdmin, route(async (req, res) => {
  const known = new Set(columnCatalogue().map((c) => c.id));
  const asked = Array.isArray(req.body && req.body.hidden) ? req.body.hidden : null;
  if (!asked) return res.status(400).json({ error: 'Expected a hidden array.' });
  // Only ids the table actually has, so the setting cannot rot into a list of
  // names nothing matches, and cannot be used as free storage.
  const hidden = await store.writeHiddenColumns(asked.filter((x) => known.has(x)));
  logAct(req, 'view', 'sitecols:' + hidden.length);
  res.json({ ok: true, hidden });
}));

app.get('/api/prefs', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // A guest has no user row, so prefsKey() would fall through to the 'admin'
  // key — the owner's saved layout. Guests get defaults and store nothing.
  // siteHidden rides along because the screener already awaits this call
  // before its first render — a second request would paint the full table and
  // then visibly drop columns.
  const [siteHidden, tile] = await Promise.all([store.readHiddenColumns(), tileConfig()]);
  // The card's chart ranges ride along too, so the screener's Tiles view and
  // the phone page offer the same windows without either restating the list.
  const ranges = CARD_RANGES.map((r) => ({ id: r.id, short: r.short, label: r.label, days: r.days }));
  if (await isGuest(req)) return res.json({ prefs: {}, siteHidden, tile, ranges });
  res.json({ prefs: await store.readPrefs(await prefsKey(req)), siteHidden, tile, ranges });
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
  const out = { collapsed };
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
  // Table or tiles: which shape the screener draws the same rows in.
  if (incoming.layout === 'tiles') out.layout = 'tiles';
  // How many tiles a row holds: 'auto' (fill the width) or a fixed 2-6.
  if (/^(auto|[2-6])$/.test(String(incoming.tileCols || ''))) out.tileCols = String(incoming.tileCols);
  // Which column view the screener opens in: 'standard' or a view's id.
  if (/^(standard|[a-z0-9]{8})$/.test(String(incoming.activeView || ''))) out.activeView = String(incoming.activeView);
  // Which starter screens this account has starred. The screens themselves are
  // site-wide and owner-curated; the star is the one thing about them that
  // belongs to the reader, which is why it lives here rather than on the row.
  //
  // SHAPE-CHECKED ONLY, deliberately not validated against the screens table.
  // Doing that would put a read on every debounced write for no gain: the page
  // renders from the screens it actually has and ignores an id it no longer
  // knows, so a deleted screen's star is invisible rather than wrong. The same
  // division cleanViews keeps, leaving the column list to the screener.
  //
  // The cap is a guard against free per-user storage, not a budget — it has to
  // clear the real list with room to spare, which is the lesson POST_OPT_MAX
  // taught by silently eating every control past the fortieth.
  if (Array.isArray(incoming.favScreens)) {
    out.favScreens = [...new Set(incoming.favScreens
      .filter((s) => typeof s === 'string' && /^[a-z0-9]{8}$/.test(s)))].slice(0, FAVS_MAX);
  }
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
// The default page for /api/news. The stock page asks for this many, then
// asks again; the screener's popover shows ten and takes the default.
const NEWS_PAGE = 10;
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
  const w = await store.writeNews(symbol, items, News.KEEP_DAYS, News.KEEP_MAX);
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

// One batch of the stalest stocks, on demand. Deliberately ONE batch per call
// rather than the whole universe: the fetches are a dozen network round trips
// and a serverless function must not be asked to hold hundreds of them. The
// caller loops, which is the same shape the price refreshes use.
app.post('/api/news/refresh', requireAdmin, route(async (req, res) => {
  if (NEWS_OFF) return res.status(400).json({ error: 'The news provider is switched off.' });
  const size = Math.max(1, Math.min(40, Number(req.query.n) || NEWS_TOPUP_PER_REFRESH));
  const universe = await store.readUniverse();
  if (!universe.length) return res.json({ done: true, fetched: 0, remaining: 0 });

  const names = await readNames().catch(() => ({}));
  const state = await store.readNewsState();
  let held = {};
  try { held = (await store.newsHoldings()).perSymbol; } catch { /* plain stalest order */ }
  // Same rule the refresh used: a stock holding nothing whose fetch is past the
  // TTL goes to the front, so an empty feed is retried rather than waiting its
  // turn with nothing to show.
  const order = { ...state };
  for (const sym of universe) {
    if (!held[sym] && state[sym] && Date.now() - state[sym] > NEWS_TTL_MS) order[sym] = 0;
  }
  // Staleness is purely the CLOCK, and must be the same test the `remaining`
  // count uses below or the loop cannot terminate: holding no headlines is a
  // reason to be fetched EARLIER (the `order` boost above), never a reason to
  // be fetched again in the same pass -- a stock the provider has nothing on
  // would otherwise be re-picked forever while the run reported itself done.
  const cutoff = Date.now() - NEWS_TTL_MS;
  const isStale = (sym, clock) => !clock[sym] || clock[sym] < cutoff;
  const stale = universe.filter((sym) => isStale(sym, state));
  if (!stale.length) return res.json({ done: true, fetched: 0, remaining: 0, universe: universe.length });

  const pick = News.pickStalest(stale, order, size);
  const out = await runNewsBatch(
    pick.map((sym) => ({ symbol: sym, name: names[sym] && (names[sym].shortName || names[sym].name) })),
    { trigger: 'manual', actor: (await currentUser(req))?.email || 'admin', refreshRunId: null });
  const after = await store.readNewsState();
  const left = universe.filter((sym) => isStale(sym, after)).length;
  // runNewsBatch answers { runId, results }; each result carries what
  // writeNews reported for that symbol.
  const rs = (out && out.results) || [];
  res.json({
    done: left === 0,
    fetched: pick.length,
    symbols: pick,
    ok: rs.filter((x) => x.ok).length,
    added: rs.reduce((n, x) => n + (x.added || 0), 0),
    stored: rs.reduce((n, x) => n + (x.stored || 0), 0),
    remaining: left,
    universe: universe.length,
    runId: (out && out.runId) || null,
  });
}));

// Stored-or-fetch for one symbol — the stock page's card. Six-hour TTL, so a
// visited page stays fresh with no schedule at all; on a provider failure
// the stored set is served, because stale beats nothing.
// `?force=1` checks now rather than waiting out the six-hour rule — the stock
// page's Check now button. The provider is free and keyless, so this costs no
// API credits; the floor below exists so a held-down button cannot hammer
// someone else's server, and it is per symbol per instance.
const newsForcedAt = new Map();
const NEWS_FORCE_FLOOR_MS = 60 * 1000;

app.get('/api/news', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  if ((await isGuest(req)) && !guestSet.has(symbol)) {
    return res.status(403).json({ error: 'The guest preview covers only a few stocks.' });
  }
  if (NEWS_OFF) return res.json({ symbol, items: [], checkedAt: null });
  const state = await store.readNewsState();
  const forced = req.query.force === '1' &&
    Date.now() - (newsForcedAt.get(symbol) || 0) > NEWS_FORCE_FLOOR_MS;
  if (forced) newsForcedAt.set(symbol, Date.now());
  if (forced || !state[symbol] || Date.now() - state[symbol] > NEWS_TTL_MS) {
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
  // The fetch clock is re-read: the page shows when this stock was last
  // checked, and after a forced check that is "just now".
  const after = await store.readNewsState();
  // PAGED. Serving the whole stored set was fine at 25 a symbol and is not the
  // shape to keep: the archive is bounded by a 21-day window now rather than by
  // a count, so a heavily-covered stock can hold a few hundred headlines and
  // neither the payload nor the page's DOM should carry all of them to show ten.
  // `total` is what lets the page say "10 of 43" and know when to stop asking.
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || NEWS_PAGE));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const [items, total] = await Promise.all([
    store.readNews(symbol, limit, offset),
    store.newsCount(symbol).catch(() => 0),
  ]);
  res.json({ symbol, items, total, offset, limit, checkedAt: after[symbol] || null, forced });
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
// The News column's data: each symbol's latest headline, how many it has from
// the last week, and WHEN IT WAS LAST CHECKED — which the column needs to tell
// "nothing to report" from "we have not looked yet". Headlines are topped up 12
// stocks a refresh round, so the second case is common and must not read as the
// first. Three bounded reads, none of them per symbol.
app.get('/api/news/latest', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (NEWS_OFF) return res.json({ items: [], counts: {}, checked: {} });
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const [latest, counts, state] = await Promise.all([
    store.readLatestNews(), store.newsCountsSince(weekAgo), store.readNewsState(),
  ]);
  let items = latest;
  let checked = state;
  let byCount = counts;
  if (await isGuest(req)) {
    const keep = (sym) => guestSet.has(String(sym).toUpperCase());
    items = items.filter((x) => keep(x.symbol));
    checked = Object.fromEntries(Object.entries(state).filter(([sym]) => keep(sym)));
    byCount = Object.fromEntries(Object.entries(counts).filter(([sym]) => keep(sym)));
  }
  res.json({ items, counts: byCount, checked });
}));

// Cached per (days, guest): every signed-in page asks for the same closes, and
// a year of them is ~68,000 bar rows — which Turso meters. Ten minutes is far
// inside the gap between refreshes, and a sparkline's tail is a shape anyway.
const sparkCacheSrv = new Map();
const SPARK_TTL_MS = 10 * 60 * 1000;

// Closes for every symbol the caller may see, cached per (days, guest). Shared
// by /api/sparklines and the phone page, so a chart on a phone and a chart in
// the table come off the same rows and the same cache.
async function sparkSeries(req, days) {
  const snap = await readSnapshot();
  let symbols = ((snap && snap.stocks) || []).filter((x) => !x.error).map((x) => x.symbol);
  const guest = await isGuest(req);
  if (guest) symbols = symbols.filter((x) => guestSet.has(String(x).toUpperCase()));
  if (!symbols.length) return {};
  const key = `${days}|${guest ? 'g' : 'm'}`;
  const hit = sparkCacheSrv.get(key);
  if (hit && Date.now() - hit.at < SPARK_TTL_MS) return hit.body.series;
  // A calendar cutoff rather than a row limit: one query for every symbol, and
  // US tickers share trading days so they come back the same length.
  const since = new Date(Date.now() - Math.round(days * 1.45) * 86400000)
    .toISOString().slice(0, 10);
  const raw = await store.readCloseSeries(symbols, since);
  const series = {};
  for (const k of Object.keys(raw)) {
    const s = raw[k];
    const cut = Math.max(0, s.closes.length - days);
    // The two dates follow the TRIM, or a card would label a 3-month chart
    // with the date its wider query happened to reach back to. The rest of the
    // date list is dropped here: it is a few MB across the universe and only
    // the two ends are ever shown.
    series[k] = {
      closes: s.closes.slice(cut).map((v) => Math.round(v * 100) / 100),
      from: s.dates[cut] || null,
      to: s.dates[s.dates.length - 1] || null,
    };
  }
  sparkCacheSrv.set(key, { at: Date.now(), body: { series, days } });
  return series;
}

// Closes alone, the shape the table's 90d column has always taken.
async function sparkCloses(req, days) {
  const series = await sparkSeries(req, days);
  const out = {};
  for (const k of Object.keys(series)) out[k] = series[k].closes;
  return out;
}

app.get('/api/sparklines', requireAuth, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const days = Math.min(560, Math.max(5, Number(req.query.days) || 90));
  const series = await sparkSeries(req, days);
  const closes = {};
  const ends = {};
  for (const k of Object.keys(series)) {
    closes[k] = series[k].closes;
    // Two dates a symbol, not a shared calendar: they do not share one.
    ends[k] = [series[k].from, series[k].to];
  }
  res.json({ closes, ends, days });
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

// Anchors for "this week" and "this month" on the cards: each symbol's last
// close before the current week (Monday) and the current month began, where
// "current" is the week and month of the freshest bar in the universe — so a
// Saturday post shows the whole week just ended. The page divides the row's
// price by the anchor. An anchor from well before the boundary (a symbol with
// a gap in its bars) is dropped, since the move would silently span more than
// the window it is labelled with. Cached ten minutes per instance.
let periodAnchorCache = null;
app.get('/api/period-anchors', requireMember, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (periodAnchorCache && Date.now() - periodAnchorCache.at < 10 * 60 * 1000) return res.json(periodAnchorCache.body);
  const snap = await readSnapshot();
  const rows = ((snap && snap.stocks) || []).filter((x) => !x.error);
  const latest = rows.reduce((m, x) => (x.latestDate && x.latestDate > m ? x.latestDate : m), '');
  if (!latest) return res.json({ latest: null, weekStart: null, monthStart: null, week: {}, month: {} });
  const day = new Date(latest + 'T12:00:00Z');
  const monday = new Date(day);
  monday.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const weekStart = monday.toISOString().slice(0, 10);
  const monthStart = latest.slice(0, 8) + '01';
  const [week, month] = await store.closesBefore([weekStart, monthStart], rows.map((x) => x.symbol));
  const within = (anchors, boundary) => {
    const floor = new Date(Date.parse(boundary + 'T12:00:00Z') - 7 * 86400000).toISOString().slice(0, 10);
    return Object.fromEntries(Object.entries(anchors).filter(([, a]) => a.d >= floor));
  };
  const body = { latest, weekStart, monthStart, week: within(week, weekStart), month: within(month, monthStart) };
  periodAnchorCache = { at: Date.now(), body };
  res.json(body);
}));

// The curve behind the chart and sparkline cards. Lifted out of the route so
// the phone's saved-posts endpoint can build the same cards server-side
// without a second copy of the axis rules. Returns the route's own payload,
// or { error, status } for the two not-founds.
async function basketPayload(req, rawName, days) {
  const portfolios = await readPortfolios();
  const all = await readUniverse();
  let symbols;
  let label = rawName;
  if (rawName.startsWith('my:')) {
    const mine = await store.readUserPortfolios(await prefsKey(req));
    const nm = rawName.slice(3);
    if (!(nm in mine)) return { error: 'No such personal theme.', status: 404 };
    const uni = new Set(all);
    symbols = mine[nm].filter((x) => uni.has(x));
    label = nm;
  } else if (rawName === 'All') {
    symbols = all;
  } else if (rawName in portfolios) {
    symbols = portfolios[rawName];
  } else {
    return { error: 'No such theme.', status: 404 };
  }
  if (!symbols.length) {
    return { label, mine: rawName.startsWith('my:'), symbols: [], dates: [], basket: null, universe: null };
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
  if (!dates.length) return { label, mine: rawName.startsWith('my:'), symbols, dates: [], basket: null, universe: null };

  const basket = equalWeightIndex(bars, symbols, dates);
  // The stocks you follow, without the benchmarks that track the market.
  const universe = equalWeightIndex(bars, all.filter(notBenchmark), dates);
  return {
    label,
    mine: rawName.startsWith('my:'),
    symbols,
    dates,
    basket: basket.index, basketUsed: basket.used, basketOf: symbols.length,
    // The count must describe the curve, not the table: the benchmarks are
    // out of the line, so they are out of the number beside it too.
    universe: universe.index, universeUsed: universe.used,
    universeOf: all.filter(notBenchmark).length,
    series: symbolSeries(bars, symbols, dates),
  };
}

app.get('/api/basket', requireMember, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // Floor of 5, a trading week: the promo studio's shortest chart window.
  const days = Math.min(400, Math.max(5, Number(req.query.days) || 253));
  const out = await basketPayload(req, String(req.query.name || '').trim(), days);
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
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
  // Added 2026-09-15 with the wider recording. Deliberately NOT every new
  // field: anything divided by the price (trailing P/E, P/B, P/S, EV/EBITDA,
  // dividend yield) moves every night and would restate the price move, the
  // same reason the six original price-driven fields are left out.
  { key: 'sharesOutstanding', label: 'share count', kind: 'money' },
  { key: 'totalDebt', label: 'total debt', kind: 'money' },
  { key: 'ebitda', label: 'EBITDA', kind: 'money' },
  { key: 'operatingCashFlowTtm', label: 'operating cash flow', kind: 'money' },
  { key: 'operatingMargin', label: 'operating margin', kind: 'pts' },
  { key: 'roa', label: 'ROA', kind: 'pts' },
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

  let stats = { fundamentalsToday: null };
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

  // The day's movers and the advice changes used to be the digest here. Both
  // went on 2026-09-16 (owner's call): each restated a standing the screener
  // shows live and neither said anything about the run, which is what this
  // mail is for. Their per-symbol news read went with them — the report path
  // no longer touches the news table at all.
  return {
    kind, complete, rows, live, loaded, failed, missing, asOf, day, stats,
    funds,
    actor: state.actor || 'unknown',
    startedAt: state.startedAt,
    duration: fmtDuration(Date.now() - state.startedAt),
  };
}

// What the JOB did, as opposed to what the data says — the same figures the
// Refresh runs page shows, so the mail answers "did it run normally?" without
// opening anything. Read from the run's own row, which the rounds have been
// updating as they went.
async function runFacts(runId) {
  if (!runId) return null;
  try {
    const run = await store.readRun(runId);
    if (!run) return null;
    const rounds = run.roundsDetail || [];
    const timed = rounds.filter((x) => x.ms);
    const gaps = [];
    for (let i = 1; i < rounds.length; i++) {
      if (rounds[i].at && rounds[i - 1].at) gaps.push(rounds[i].at - rounds[i - 1].at);
    }
    const sum = (xs) => xs.reduce((a, b) => a + b, 0);
    return {
      rounds: run.rounds || rounds.length,
      refused: run.refused || rounds.filter((x) => x.error).length,
      credits: run.credits || sum(rounds.map((x) => x.credits || 0)),
      profiles: run.profiles || sum(rounds.map((x) => x.profiles || 0)),
      profileFails: sum(rounds.map((x) => x.profileFails || 0)),
      pricedLive: run.pricesLive || 0,
      trigger: run.trigger || null,
      link: run.link || null,
      avgRoundMs: timed.length ? Math.round(sum(timed.map((x) => x.ms)) / timed.length) : null,
      maxRoundMs: timed.length ? Math.max(...timed.map((x) => x.ms)) : null,
      avgGapMs: gaps.length ? Math.round(sum(gaps) / gaps.length) : null,
      creditsPerRound: rounds.length ? Math.round(sum(rounds.map((x) => x.credits || 0)) / rounds.length) : null,
    };
  } catch (err) {
    console.warn('report: run facts unavailable:', err.message);
    return null;
  }
}

const secs = (ms) => (ms == null ? '—' : ms >= 60000 ? (ms / 60000).toFixed(1) + ' min' : (ms / 1000).toFixed(1) + 's');

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
  const runName = r.mode === 'missing' ? 'Fill missing'
    : r.mode === 'fast' ? 'Fast refresh'
      : r.mode === 'prices' ? 'Refresh prices' : isAll ? 'Refresh all' : 'Refresh';
  // Prices moved; the company numbers did not. Say which.
  const fundLine = !isAll ? 'not re-pulled — prices only'
    : (r.stats.fundamentalsToday == null ? '—'
      : `${r.stats.fundamentalsToday} symbols recorded for ${r.day}`);
  const headCount = isAll
    ? `${r.loaded.length} of ${r.live.length} profiles`
    : `${r.live.length} symbols`;
  // THERE IS NO "Bar archive" LINE ANY MORE. It printed the row count and the
  // archive's through-date, read with `count(*), max(d) from bars` — 135.9s and
  // 268.9s respectively against 1,708,408 rows, in the tail that must finish
  // before the response. `Prices as of` above already carries that date, from
  // `asOf`, which is in memory and free; the archive's SIZE lives on /database
  // and /quality, cached, where counting is the point of the page.

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
  // The movers list and the advice changes were removed on 2026-09-16 (owner's
  // call): both restated what the screener shows live, and the question this
  // mail exists to answer is whether the JOB went normally.
  if (r.job) {
    t.push('', 'The run');
    t.push(line('Rounds', `${r.job.rounds}` + (r.job.refused ? `, ${r.job.refused} refused` : '')));
    t.push(line('Profiles', `${r.job.profiles} pulled` + (r.job.profileFails ? `, ${r.job.profileFails} refused` : '')));
    t.push(line('Credits', `${r.job.credits.toLocaleString()}` +
      (r.job.creditsPerRound ? ` (~${r.job.creditsPerRound.toLocaleString()} a round, ceiling 610/min)` : '')));
    t.push(line('Prices', r.job.pricedLive ? `${r.job.pricedLive} pulled live` : 'from the archive'));
    t.push(line('Round time', `${secs(r.job.avgRoundMs)} average, ${secs(r.job.maxRoundMs)} longest`));
    if (r.job.avgGapMs) t.push(line('Round spacing', `${secs(r.job.avgGapMs)} (62s is the floor)`));
    if (r.job.trigger) t.push(line('Trigger', r.job.trigger));
    if (r.job.link) t.push(line('Job log', r.job.link));
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

  // How the job itself went: the numbers from the Refresh runs page, so the
  // mail answers "did it run normally?" on its own.
  let jobBlock = '';
  if (r.job) {
    const j = r.job;
    const jrow = (k, v) => `<tr><td style="${cell};color:#777;white-space:nowrap">${escHtml(k)}</td>` +
      `<td style="${cell}">${v}</td></tr>`;
    const runUrl = url && r.runId ? `${url}/refreshes?run=${r.runId}` : null;
    jobBlock =
      '<h3 style="margin:22px 0 6px;font-size:14px">The run</h3>' +
      '<table style="border-collapse:collapse">' +
      jrow('Rounds', escHtml(String(j.rounds)) +
        (j.refused ? ` <span style="color:#b06000">${j.refused} refused</span>` : '')) +
      jrow('Profiles', escHtml(`${j.profiles} pulled`) +
        (j.profileFails ? ` <span style="color:#c5221f">${j.profileFails} refused</span>` : '')) +
      jrow('Credits', escHtml(j.credits.toLocaleString()) +
        (j.creditsPerRound ? ` <span style="color:#999">~${escHtml(j.creditsPerRound.toLocaleString())} a round, ceiling 610/min</span>` : '')) +
      jrow('Prices', escHtml(j.pricedLive ? `${j.pricedLive} pulled live` : 'read from the archive')) +
      jrow('Round time', escHtml(`${secs(j.avgRoundMs)} average, ${secs(j.maxRoundMs)} longest`)) +
      (j.avgGapMs ? jrow('Round spacing', escHtml(`${secs(j.avgGapMs)} — 62s is the floor the credit ceiling sets`)) : '') +
      (j.trigger ? jrow('Trigger', escHtml(j.trigger)) : '') +
      '</table>' +
      (runUrl ? `<p style="margin:8px 0 0;font-size:12px"><a href="${runUrl}" style="color:#556a8a">` +
        'Every round of this run →</a></p>' : '') +
      (j.link ? `<p style="margin:4px 0 0;font-size:12px"><a href="${escHtml(j.link)}" style="color:#556a8a">The job log →</a></p>` : '');
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
    kv('Prices as of', r.asOf || '—') + kv('Fundamentals', fundLine) +
    '</table>' +
    problems +
    jobBlock +
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
// `snap` is the payload the caller already holds. Passing it skips re-reading
// the ~1.3MB snapshot blob the refresh has just written — measured at 2.1s
// against production, in the tail that must finish before the response. Small
// beside the 145s `archiveStats` used to spend there, but it is the same trap
// /quality recorded (readSnapshot took that page from 2.4s to 10.8s), and a
// caller with the data in hand should never ask the database for it back.
async function sendRefreshReport(state, kind = 'all', snap = null) {
  if (!state) return false;          // nothing was cleared — someone else reported this run
  // A tracked run keeps its report on /refreshes even when mail is not set up.
  if (!MAIL_READY && !state.runId) return false;
  try {
    const r = await buildRefreshReport(state, snap || await readSnapshot(), kind);
    r.mode = state.mode || null;
    r.runId = state.runId || null;
    r.job = await runFacts(state.runId);
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
      : r.mode === 'fast'
      ? `[Tickr Lab] Fast refresh — ${r.loaded.length}/${r.live.length}` + (r.complete ? '' : ' incomplete')
      : kind === 'all'
      ? `[Tickr Lab] Refresh all — ${r.loaded.length}/${r.live.length}` + (r.complete ? '' : ' incomplete')
      : `[Tickr Lab] Refresh — ${r.live.length} symbols as of ${r.asOf || 'n/a'}` +
        (r.failed.length ? `, ${r.failed.length} failed` : '');
    let ok = false;
    // Only a Refresh all (and Fill missing, which is one) mails. A plain price
    // Refresh stopped mailing on 2026-09-15, when intraday refreshes arrived —
    // thirteen emails a trading day would bury the one that matters. Its
    // report is still kept on the run, for /refreshes.
    const to = MAIL_READY && kind !== 'plain' ? await operatorEmail() : null;
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
// One weekly mark for the long backtest, written during a Refresh all beside
// the other histories and on the same gate: that run happens after the close,
// so the reading is the settled one.
//
// SELF-PACING rather than calendar-driven. "Write it if the newest mark is a
// week old" needs no weekday arithmetic, no holiday list, and heals itself
// after a missed night — where "write it on Fridays" would silently skip a
// week whenever a Friday was a holiday or the job failed.
//
// The verdict stored is the ALL-TECHNICAL one, from the same `Action.actionAt`
// the builder uses. It is deliberately NOT `row.action`, which is the Balanced
// verdict WITH fundamentals — mixing the two would make the column mean one
// thing before today and another after it.
const TECH_MARK_DAYS = 7;

async function noteTechMark(day, rows) {
  if (!day || !Array.isArray(rows) || !rows.length) return 0;
  // ONE INDEXED SEEK, and it has to stay that way. This runs inside the refresh
  // tail — the work that must finish before the response — on every round of a
  // Refresh all. The first version asked techHistorySpan(), a full scan
  // measured at 14 SECONDS cold over 228k rows, and that is what broke the
  // 2026-09-19 nightly: nine rounds of it, and on the last one the tail ran out
  // of time before it could build the report or answer the job. The data was
  // perfect; the workflow failed a run that had already succeeded.
  const last = await store.techHistoryLastMark();
  if (last) {
    const gap = (Date.parse(day + 'T00:00:00Z') - Date.parse(last + 'T00:00:00Z')) / 86400000;
    if (!(gap >= TECH_MARK_DAYS)) return 0;
  }
  const out = [];
  for (const r of rows) {
    if (r.error || !(r.price > 0)) continue;
    // Below the 52-week window the rules cannot be read properly, and the
    // builder skips these too — a mark present for some symbols and absent for
    // others at the same date is what an equal-weight basket must not have.
    if (!(Number(r.historyDays) >= TechRow.MIN_SESSIONS)) continue;
    const compact = { v200: r.vs200ma, v50: r.vs50ma, rsi: r.rsi,
      m1: r.oneMonthPct, m3: r.threeMonthPct, fh: r.pctFromHigh,
      vol: r.volTrend, hist: r.historyDays };
    const v = Action.actionAt(compact, ACTION_CFG);
    out.push({ symbol: r.symbol, d: day, action: v.action, flag: v.flag,
      trend: Action.trendAt(compact, 'ETF', ACTION_CFG),
      close: r.price, vs200: r.vs200ma, vs50: r.vs50ma, rsi: r.rsi,
      m1: r.oneMonthPct, m3: r.threeMonthPct, fromHigh: r.pctFromHigh,
      volTrend: r.volTrend, historyDays: r.historyDays });
  }
  // A SHORT deadline, because this runs in the refresh tail and is optional.
  // One weekly mark for ~420 stocks is three statements; if that cannot be
  // written in half a minute the socket is gone, and the right answer is to
  // let the refresh finish. Nothing is lost — noteTechMark is self-pacing, so
  // the next Refresh all past the seven-day gap writes the mark instead.
  // Without this the await simply never returns and the platform kills the
  // function, which is reported as a failed night over perfectly good data.
  return out.length ? store.writeTechHistory(out, { timeoutMs: 30000 }) : 0;
}

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
  // This instance just rewrote it, so its own copy is stale the moment the
  // write lands. Other instances hold theirs for the TTL; nothing is shared.
  dropSnapshotCache();
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
  // News NO LONGER rides the refresh (2026-09-18, owner's instruction: "don't
  // mix the news refresh with any API data refresh"). It used to top up a
  // dozen stocks here, awaited before the response because nothing may run
  // after a response on this platform — which put a dozen network fetches
  // inside the request that also had to price the universe and write the
  // snapshot. A refresh that had already done its work was then cut before it
  // could close its own run, and recorded as `abandoned` with no error.
  // It is its own button now: POST /api/news/refresh.
  // A PRICE run is deliberately NOT a profile sweep, and must not open this
  // gate (2026-09-22). Making Refresh prices a tracked run gave it a
  // refresh_state row, and `if (running)` alone then read that as "a Refresh
  // all is happening" — so a price refresh started recording fundamentals from
  // day-old cached profiles under today's date, which is precisely the
  // invented movement this gate was written to prevent, and aged the advice
  // counters against a provisional intraday bar. Caught by the round log
  // saying "fundamentals: 21 symbols recorded" during a price sweep.
  if (running && running.mode !== 'prices') {
    try {
      // Rows whose profile has not come back yet are skipped rather than
      // stored empty; a later round in the same run upserts over them.
      const withProfile = rows.filter((x) => !x.error && x.profileFetchedAt != null);
      const n = await store.writeFundamentals(marketDay(rows), withProfile);
      if (n) console.log(`fundamentals: ${n} symbols recorded for ${marketDay(rows)}`);
      // How long each Balanced verdict has stood, on the SAME gate and for the
      // same reason: a Refresh all runs after the close, so the verdict being
      // counted is the settled one. Counting on the intraday rounds instead
      // would advance the clock on a provisional bar and reset the run every
      // time a verdict flapped over lunch.
      const held = await store.noteAdvice(marketDay(rows), rows.filter((x) => !x.error && x.action));
      if (held) console.log(`advice: ${held} verdicts aged for ${marketDay(rows)}`);
      // The long backtest's weekly mark. Free here: every technical it stores
      // was already computed for this row, so nothing is re-read.
      const marked = await noteTechMark(marketDay(rows), rows);
      if (marked) console.log(`tech history: ${marked} marks written for ${marketDay(rows)}`);
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
  // WHAT "FINISHED" MEANS DEPENDS ON WHAT THE RUN IS FOR. A profile sweep ends
  // when every row has a profile; a PRICE sweep ends when every symbol has been
  // priced, which `notePriceRound` records by stamping prices_at on the last
  // slice. Judging a price run by profile coverage would close it after round
  // one — coverage is already complete — leaving the rest of the universe on
  // yesterday's close with the run marked `complete`.
  const covered = running && running.mode === 'prices'
    ? !!running.pricesAt
    : (rows.length > 0 && loaded >= rows.length);

  if (running) {
    if (covered) {
      const cleared = await endRefresh();
      if (cleared) {
        await closeRun(cleared, 'complete', { loaded, total: rows.length });
        await sendRefreshReport(cleared, 'all', payload);
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
    await sendRefreshReport({ startedAt: ctx.startedAt, actor: ctx.actor, runId: ctx.runId },
      'plain', payload);
  }
  // The headlines top-up started above runs alongside everything since; it has
  // to finish before the response does, or the platform freezes it mid-fetch.
  return { loaded, total: rows.length, done: running ? covered : true };
}

// Enough calendar days for the trend ribbon's year: 252 sessions of output
// plus the 200 its moving average needs is about 640 calendar days. This used
// to be sized for a longer scoring run-up as well, and came out the same.
const TREND_WINDOW_DAYS = 650;

// The bar window the trend timeline is built from. One read for the universe.
// Kept for the window constant alone; the trend timeline is built from the
// price series the round already holds (see computeStocks), because reading
// the same bars a second time cost 101.5s of a 296.5s rebuild.
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
  const universe = (await readUniverse());
  const n = universe.length + 1;   // + SPY
  // Fill missing prices ONLY the stocks with no bars at all, in its first
  // round; everything else comes off the archive. notePriceRound then stamps
  // prices_at, so every later round is an archive round.
  if (running && running.mode === 'missing' && !archivePrices) {
    const dates = await store.barsMaxDates(universe);
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
  if (archivePrices) {
    return {
      archivePrices,
      profileCap: PROFILE_CAP_ARCHIVE_ROUND,
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
  // WHERE THIS ROUND STARTS. Inside a multi-round run the marker is on the run
  // itself; outside one it is the stored cursor, so a plain Refresh and the
  // intraday schedule CONTINUE round the universe instead of re-pricing the
  // same opening slice for ever. Before the cursor existed they all started at
  // 0: at 1,165 symbols that was the same 500 every time and 665 stocks that
  // never saw an intraday price at all.
  //
  // A cursor at or past the end has wrapped — start again rather than slicing
  // nothing, which is also what happens the first time the universe shrinks
  // below where the cursor had reached.
  const stored = running ? 0 : await store.readPriceCursor().catch(() => 0);
  const done = running ? (running.priced || 0) : (stored < universe.length ? stored : 0);
  const left = Math.max(0, universe.length - done);
  // SPY is fetched live on every round, priced or archived, so it is always
  // one credit off the top.
  const priceBudget = CREDITS_PER_MINUTE - 1;
  // TWO ceilings, not one: the credit budget says what a round may spend, and
  // PRICE_SLICE says what it can finish inside the platform's 300s. The second
  // was missing, which is what made the plain Refresh a coin toss at 767.
  const priceCap = Math.min(left || universe.length, priceBudget, PRICE_SLICE);
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
  if (!opts || opts.archivePrices) return;
  // OUTSIDE a run there is no marker to move and no prices_at to stamp — but
  // the cursor still has to advance, or the next single-round refresh prices
  // the identical slice. Wraps at the end, so the universe rotates: at 1,165
  // symbols and a 500 slice that is three rounds, and every stock is priced
  // once every three.
  if (!opts.running) {
    if (!opts.priceSlice) return;             // the whole universe fitted; nothing to page
    const next = opts.pricedAfter >= opts.priceTotal ? 0 : opts.pricedAfter;
    await store.writePriceCursor(next).catch(() => {});
    return;
  }
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
    error: extra.error, refused: extra.refused, phases: extra.phases,
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
// ---- Turso usage -----------------------------------------------------------
// What the database ACTUALLY costs, from Turso's own platform API — rows read
// is the metered number and nothing in this app can measure it (the client
// reports rows returned, which for a scan is a tiny fraction of rows read:
// the query that triggered the 2026-09-15 quota alert returned 254 rows and
// read 748,859). So the honest way to watch it is to ask Turso.
//
// Needs TURSO_API_TOKEN (a platform token, NOT the database auth token) and
// TURSO_ORG. Optional TURSO_ROWS_READ_LIMIT / TURSO_ROWS_WRITTEN_LIMIT /
// TURSO_STORAGE_LIMIT_GB draw the percentage; without them the page shows the
// raw numbers, since the API does not report the plan's allowance.
const TURSO_API_TOKEN = process.env.TURSO_API_TOKEN || '';
const TURSO_ORG = process.env.TURSO_ORG || '';
const TURSO_LIMITS = {
  rowsRead: Number(process.env.TURSO_ROWS_READ_LIMIT) || 0,
  rowsWritten: Number(process.env.TURSO_ROWS_WRITTEN_LIMIT) || 0,
  storageBytes: (Number(process.env.TURSO_STORAGE_LIMIT_GB) || 0) * 1e9,
};
const TURSO_ALERT_AT = Math.min(0.99, Math.max(0.1, Number(process.env.TURSO_ALERT_AT) || 0.7));
let tursoUsageCache = null;

async function tursoUsage(force = false) {
  if (!TURSO_API_TOKEN || !TURSO_ORG) return { configured: false };
  if (!force && tursoUsageCache && Date.now() - tursoUsageCache.at < 60 * 60 * 1000) {
    return { ...tursoUsageCache.body, cached: true };
  }
  const r = await fetch(`https://api.turso.tech/v1/organizations/${encodeURIComponent(TURSO_ORG)}/usage`, {
    headers: { Authorization: `Bearer ${TURSO_API_TOKEN}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Turso API ${r.status}`);
  const j = await r.json();
  // The shape has moved before; take the usage object wherever it is and read
  // the keys we know, rather than assuming the whole envelope.
  const u = (j && j.organization && j.organization.usage) || (j && j.usage) || j || {};
  const body = {
    configured: true,
    org: TURSO_ORG,
    rowsRead: Number(u.rows_read || 0),
    rowsWritten: Number(u.rows_written || 0),
    storageBytes: Number(u.storage_bytes || 0),
    bytesSynced: Number(u.bytes_synced || 0),
    limits: TURSO_LIMITS,
    alertAt: TURSO_ALERT_AT,
    at: Date.now(),
  };
  tursoUsageCache = { at: Date.now(), body };
  return { ...body, cached: false };
}

// The worst of the three as a fraction of its limit, for the alert and the page.
function tursoWorst(u) {
  if (!u || !u.configured) return null;
  const parts = [
    ['rows read', u.rowsRead, u.limits.rowsRead],
    ['rows written', u.rowsWritten, u.limits.rowsWritten],
    ['storage', u.storageBytes, u.limits.storageBytes],
  ].filter(([, , lim]) => lim > 0).map(([name, used, lim]) => ({ name, used, lim, frac: used / lim }));
  if (!parts.length) return null;
  return parts.sort((a, b) => b.frac - a.frac)[0];
}

app.get('/api/turso-usage', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json(await tursoUsage(req.query.fresh === '1'));
  } catch (err) {
    // Never fail the page over a third-party status call.
    res.json({ configured: !!(TURSO_API_TOKEN && TURSO_ORG), error: err.message });
  }
}));



// ============================================================================
// Data quality
// ============================================================================
// One line per stock, saying what we actually hold for it. It exists because
// every gap this app has had was SILENT: exchange and currency were null for
// the whole universe for weeks, two stocks arrived with no earnings history at
// all, one with 66 bars, and nothing anywhere said so. A thin archive is the
// worst of them because it never heals on its own — a new ticker gets ~300 bars
// from its first price pull and stays there until someone runs backfill-bars.
//
// The archive is measured by SPAN, not by count: `count(*) group by symbol` over
// bars reads 1.08M rows, which is what produced the Turso quota warning. Two
// seeks per symbol read two rows. Sessions are estimated from the span and the
// page says they are estimates.
const DQ_TTL_MS = 5 * 60 * 1000;
// What each threshold actually gates, so the flags mean something specific.
const DQ_MIN_SCORE_BARS = 274;    // the advice rules' own history floor
const DQ_MIN_5Y_BARS = 1260;      // the 5Y column's window
const DQ_SESSIONS_PER_DAY = 0.69; // trading days per calendar day, for the estimate
let dqCache = null;

app.get('/api/data-quality', requireAdmin, route(async (req, res) => {
  if (!req.query.fresh && dqCache && Date.now() - dqCache.at < DQ_TTL_MS) {
    return res.json({ ...dqCache.body, cached: true });
  }
  // The cached answer above reads nothing and is served regardless. This does:
  // the span seeks are cheap, but the three coverage rollups are ~33,000 rows
  // and readProfiles is every blob. Measured at 2.4s on an idle database.
  if (await standAside(res)) return;
  const t0 = Date.now();
  const universe = await store.readUniverse();
  // Deliberately NOT readSnapshot(): it is a ~1.3MB JSON blob and the only
  // thing wanted from it was a display name, which readNamesFull answers from
  // two columns. Parsing a megabyte to label a table is not a trade worth making.
  const [span, rollups, profiles, priced, names] = await Promise.all([
    store.barsSpan(universe),
    store.coverageRollups(),
    store.readProfiles(),
    store.readPriceState().catch(() => ({})),
    store.readNamesFull().catch(() => ({})),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

  const rows = universe.map((sym) => {
    const sp = span[sym] || null;
    const prof = profiles[sym] || null;
    const f = rollups.fund[sym] || null;
    const e = rollups.earn[sym] || null;
    const n = rollups.news[sym] || null;
    const nm = names[sym] || {};
    // Estimated from the span, never counted.
    const sessions = sp ? Math.round(days(sp.first, sp.last) * DQ_SESSIONS_PER_DAY) + 1 : 0;
    const flags = [];
    if (!sp) flags.push('no bars');
    else {
      if (sessions < DQ_MIN_SCORE_BARS) flags.push('too short to score');
      else if (sessions < DQ_MIN_5Y_BARS) flags.push('no 5Y');
      if (days(sp.last, today) > 5) flags.push('stale prices');
    }
    if (!prof) flags.push('no profile');
    else if (prof.fetchedAt == null) flags.push('profile pull failed');
    if (!f) flags.push('no fundamentals');
    if (!e) flags.push('no earnings');
    if (!prof || !prof.exchange) flags.push('no exchange');
    return {
      symbol: sym,
      name: nm.shortName || nm.name || sym,
      firstBar: sp ? sp.first : null,
      lastBar: sp ? sp.last : null,
      sessions,
      pricedAt: priced[sym] == null ? null : priced[sym],
      profileAt: prof && prof.fetchedAt != null ? prof.fetchedAt : null,
      hasProfile: !!prof,
      exchange: (prof && prof.exchange) || null,
      fundDays: f ? f.n : 0,
      fundFirst: f ? f.first : null,
      earnQuarters: e ? e.n : 0,
      earnFirst: e ? e.first : null,
      news: n ? n.n : 0,
      flags,
    };
  });

  const count = (fn) => rows.filter(fn).length;
  const thin = rows.filter((r) => r.sessions > 0 && r.sessions < DQ_MIN_5Y_BARS).map((r) => r.symbol);
  // Built, then cached, then sent. Caching after the response would store
  // nothing useful, and on this platform the function can be frozen the moment
  // the response goes out.
  const body = {
    universe: universe.length,
    rows,
    ms: Date.now() - t0,
    thresholds: { score: DQ_MIN_SCORE_BARS, fiveYear: DQ_MIN_5Y_BARS },
    summary: {
      clean: count((r) => !r.flags.length),
      noBars: count((r) => r.flags.includes('no bars')),
      tooShort: count((r) => r.flags.includes('too short to score')),
      noFiveYear: count((r) => r.flags.includes('no 5Y')),
      stalePrices: count((r) => r.flags.includes('stale prices')),
      noProfile: count((r) => r.flags.includes('no profile')),
      profileFailed: count((r) => r.flags.includes('profile pull failed')),
      noFundamentals: count((r) => r.flags.includes('no fundamentals')),
      noEarnings: count((r) => r.flags.includes('no earnings')),
      noExchange: count((r) => r.flags.includes('no exchange')),
    },
    // The fix, not just the diagnosis. One credit a symbol at any depth.
    thin,
    fixCommand: thin.length
      ? `node --use-system-ca backfill-bars.js --commit --depth 1300 --only ${thin.join(',')}`
      : null,
  };
  dqCache = { at: Date.now(), body };
  res.json(body);
}));

// The backtest. Admin only: it is a research surface, it reads the whole bar
// window, and it is the one page here that produces a number that looks like
// performance.

// What the backtest would have to work with, for every date it will accept.
// Answered BEFORE a run, because it is the thing that decides which date to
// pick, and running one to find out is the wrong order.
let btCovCache = null;
// The trend-only sweep. Reads tech_history and nothing else.
app.get('/api/trend-backtest', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const horizon = TB_HORIZONS[String(req.query.horizon || '')] ? String(req.query.horizon) : '3M';
  const tiers = String(req.query.tiers || 'Strong Buy,Buy').split(',')
    .map((x) => x.trim()).filter((x) => Action.ACTIONS.indexOf(x) >= 0);
  if (!tiers.length) return res.status(400).json({ error: 'Pick at least one verdict.' });
  const rules = RULE_SETS.indexOf(String(req.query.rules || '')) >= 0
    ? String(req.query.rules) : 'Balanced';
  const everyMonths = Math.max(1, Math.min(12, parseInt(req.query.everyMonths, 10) || 1));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : '2008-01-01';

  const themes = await readPortfolios();
  const themeAsked = String(req.query.theme || '').trim();
  const theme = themeAsked && themeAsked in themes ? themeAsked : null;
  if (themeAsked && !theme) return res.status(404).json({ error: `No theme called "${themeAsked}".` });
  const only = theme ? new Set(themes[theme]) : null;

  // Balanced is the verdict stored on the row, so it needs neither the inputs
  // nor a re-evaluation; anything else re-runs the engine and needs all of
  // them. Same test tbSweep's `isDefault` makes, and it has to be — asking for
  // the slim row and then evaluating against it would read undefined inputs.
  //
  // 76,531 rows on a COLD cache, and nothing at all on a warm one — so the
  // refresh guard asks which this is rather than refusing every sweep. Warm,
  // the sweep is 154ms of arithmetic over rows already in memory and there is
  // nothing for a refresh to be slowed by.
  if (!tbMarksWarm(rules === 'Balanced') && await standAside(res)) return;
  const rows = await tbLoadMarks(rules === 'Balanced');
  if (!rows.length) {
    // Two different emptinesses, and saying the wrong one sends someone to
    // rebuild a table that is already there. The calendar can be missing while
    // the marks are not — marks written before `tech_marks` existed, or a
    // table restored by hand — so ask the marks directly. One indexed seek.
    const last = await store.techHistoryLastMark();
    return res.json({ error: null, empty: true,
      note: last
        ? `Marks are recorded through ${last} but the mark calendar is empty — run rebuildTechMarks() in db.js.`
        : 'No trend history recorded yet — run build-tech-history.js.' });
  }
  const t0 = Date.now();
  const swept = tbSweep({ rows, cfg: ruleCfg(rules), want: new Set(tiers),
    horizon, from, only, everyMonths });
  const stats = tbStats(swept.windows);

  // THE TWO NUMBERS THAT KEEP IT HONEST, computed rather than asserted.
  //
  // Overlap: monthly start dates with a three-month horizon means each window
  // shares two thirds of its life with its neighbour, so ~200 windows is not
  // ~200 independent readings. The research log's own discount rule, applied
  // here rather than left to the reader. Both figures are in months now that
  // the horizon is, so it is one division.
  const overlap = Math.max(1, swept.horizonMarks / everyMonths);
  const effective = stats.windows ? Math.max(1, Math.round(stats.windows / overlap)) : 0;
  // Coverage: the pool shrinks going back, and an early window that reads well
  // on 40 stocks is not the same claim as a late one on 400.
  const first = swept.windows[0], last = swept.windows[swept.windows.length - 1];

  res.json({
    horizon, tiers, rules, ruleSets: RULE_SETS, from, everyMonths,
    theme: theme || null,
    scopeOf: theme ? (themes[theme] || []).length : null,
    summary: { ...stats, effectiveWindows: effective, overlapFactor: Math.round(overlap * 10) / 10,
      firstWindow: first ? first.d : null, lastWindow: last ? last.d : null,
      firstUniverse: first ? first.universe : null, lastUniverse: last ? last.universe : null,
      ms: Date.now() - t0 },
    windows: swept.windows,
    // Split at 2020 — every result on this project has turned on it.
    eras: {
      pre2020: tbStats(swept.windows.filter((w) => w.d < '2020-01-01')),
      post2020: tbStats(swept.windows.filter((w) => w.d >= '2020-01-01')),
    },
  });
}));

app.get('/api/backtest/coverage', requireAdmin, route(async (req, res) => {
  if (btCovCache && Date.now() - btCovCache.at < 5 * 60 * 1000) return res.json(btCovCache.body);
  const today = new Date().toISOString().slice(0, 10);
  const floor = new Date(Date.now() - BT_MAX_BACK_DAYS * 86400000).toISOString().slice(0, 10);
  const universe = (await store.readUniverse()).length;
  let first = {};
  try { first = await store.readFundamentalsFirstSeen(floor); } catch (e) { first = {}; }
  // Cumulative: a date gets every symbol recorded on or before it, because
  // fundamentals are step functions and the last set before a date is what
  // stood on it. So this only ever rises.
  const seen = Object.values(first).sort();
  const days = [];
  for (let t = Date.parse(floor + 'T00:00:00Z'); t <= Date.parse(today + 'T00:00:00Z'); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const wd = new Date(t).getUTCDay();
    days.push({ d, n: seen.filter((f) => f <= d).length, weekend: wd === 0 || wd === 6 });
  }
  // The rule sets ride along on the page's own boot call, so the picker is
  // filled before the first run and the list is never restated in the page.
  const body = { universe, floor, today, days, recordingFrom: FUND_HISTORY_FROM,
    ruleSets: RULE_SETS };
  btCovCache = { at: Date.now(), body };
  res.json(body);
}));

app.get('/api/backtest', requireAdmin, route(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const asked = String(req.query.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asked)) return res.status(400).json({ error: 'A date is required.' });
  const floor = new Date(Date.now() - BT_MAX_BACK_DAYS * 86400000).toISOString().slice(0, 10);
  if (asked < floor) {
    return res.status(400).json({ error: `The earliest start date is ${floor} — two months. ` +
      'Further back, almost the whole verdict would be imputed rather than replayed.' });
  }
  if (asked >= today) return res.status(400).json({ error: 'Pick a date before today.' });

  const tiers = String(req.query.tiers || 'Strong Buy').split(',')
    .map((x) => x.trim()).filter((x) => Action.ACTIONS.indexOf(x) >= 0);
  if (!tiers.length) return res.status(400).json({ error: 'Pick at least one verdict.' });

  // After validation, so a malformed request still gets the 400 that explains
  // it rather than being told to come back later and then refused again. The
  // checks above are arithmetic on the query string and read nothing.
  //
  // ~157,000 bars on a cold cache (530 days x the universe), and never free
  // even on a warm one: the snapshot blob, the earnings dates and the recorded
  // fundamentals are read on every run.
  if (await standAside(res)) return;

  const universe = await store.readUniverse();
  const bars = await btLoadBars(universe);
  const snap = await readSnapshot();
  const stocks = (snap && snap.stocks) || [];
  scoreActionInto(stocks);
  await stampShortNames(stocks);
  const earnings = await store.readEarningsDates(asked, today);
  // Recorded fundamentals as of the start date — the newest set on or before it.
  let recorded = null;
  try { recorded = await store.readFundamentalsAsOf(asked); } catch (e) { recorded = null; }

  // The universe the run is allowed to pick from. A theme scopes it: the rules
  // are evaluated over that theme's stocks and nothing else, which is the
  // question worth asking once the whole-universe comparison is gone — "what
  // did the rules do inside Chips" rather than "how did 430 mixed stocks do".
  const themes = await readPortfolios();
  const themeAsked = String(req.query.theme || '').trim();
  const theme = themeAsked && themeAsked in themes ? themeAsked : null;
  if (themeAsked && !theme) return res.status(404).json({ error: `No theme called "${themeAsked}".` });
  const only = theme ? new Set(themes[theme]) : null;
  const scopeOf = theme ? (themes[theme] || []).length : universe.length;

  // Which rule set is being backtested. Balanced is the default and is what
  // every other surface shows; the others exist because the question "would
  // Max Risk have done better on this date" is exactly what a backtest is for.
  const rules = RULE_SETS.indexOf(String(req.query.rules || '')) >= 0
    ? String(req.query.rules) : 'Balanced';
  const cfg = ruleCfg(rules);

  const r = btRun({ bars, snapshot: stocks, from: asked, tiers, earnings, recorded, only,
    cfg, compare: RULE_SETS });
  const tier = btCurve(r.heldSeries, asked);        // every pick in the chosen verdicts

  // Top N. Seeded off the date + size so the same run draws the same band.
  const rank = BT_RANKS.indexOf(String(req.query.rank || '')) >= 0 ? String(req.query.rank) : 'cushion';
  const topAsked = Math.max(0, Math.min(200, parseInt(req.query.top, 10) || 0));
  const top = topAsked && topAsked < r.picks.length ? topAsked : 0;   // 0 = take them all
  const seed = Array.from(asked + '|' + top).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const chosen = btPick(r.picks, rank, top, seed);
  const chosenSet = new Set(chosen.map((x) => x.symbol));
  for (const p of r.picks) p.selected = chosenSet.has(p.symbol);
  // How many of the picks the chosen metric could actually rank. exitDistance
  // returns null past a 60% fall, so a stock a long way above its 200-day has
  // no cushion — and a cut made mostly on unrankable rows is an arbitrary cut,
  // which the page has to be able to say.
  const rankable = rank === 'random' ? r.picks.length
    : r.picks.filter((p) => p.cushion != null).length;

  // With no cut, the selection IS the tier and there is no spread to draw.
  const held = top
    ? { dates: tier.dates, values: btAverage(tier.matrix, chosen.map((x) => x.symbol)),
        members: chosen.length, matrix: tier.matrix }
    : tier;
  const band = top ? btBand(tier.matrix, r.picks.map((x) => x.symbol), top, seed) : null;

  // ---- rebalancing --------------------------------------------------------
  // Built to work better as fundamentals history accumulates rather than to
  // pretend it already has: every rebalance reports how many of ITS verdicts
  // used recorded fundamentals rather than today's, so the instrument says
  // what it is standing on and improves on its own as the archive fills.
  const byS2 = new Map(stocks.map((x) => [x.symbol, x]));
  const every = Math.max(0, Math.min(90, parseInt(req.query.every, 10) || 0));
  const mode = BT_MODES.indexOf(String(req.query.mode || '')) >= 0 ? String(req.query.mode) : 'rerun';
  const costBps = Math.max(0, Math.min(200, Number(req.query.cost) || 0));
  let rebal = null, rebalError = null;
  if (every && tier.dates.length > 2) {
    try {
      const axis = tier.dates;
      const marks = btRebalanceDays(axis, every);
      // Prices on the shared axis for EVERY symbol, not just the opening set:
      // a rerun can buy something that was not in the first basket.
      const full = btMatrix(r.everySeries, asked);
      const px = full.rows;
      // One read of the whole history, folded forward as the rebalance dates
      // are walked in order. readFundamentalsAsOf would re-read everything for
      // each date, which gets worse precisely as the archive grows.
      const rows = await store.readFundamentalsRows(today).catch(() => []);
      const targets = new Map();
      const coverage = [];
      // Every verdict at every rebalance date, not only the qualifying ones —
      // the reason a stock was SOLD is the verdict that disqualified it, which
      // by definition is not in the target set.
      const verdicts = new Map();
      const recut = mode === 'rerun' && top > 0;
      let ptr = 0;
      const stood = {};
      for (const j of marks) {
        const at = axis[j];
        while (ptr < rows.length && rows[ptr].d <= at) { stood[rows[ptr].symbol] = rows[ptr]; ptr++; }
        const set = new Set();
        const why = new Map();
        const cand = [];
        let real2 = 0, imputed2 = 0;
        for (const sym of Object.keys(bars)) {
          const p = r.prep[sym];
          if (!p) continue;
          let i = -1;
          for (let k = p.dates.length - 1; k >= 0; k--) if (p.dates[k] <= at) { i = k; break; }
          if (i < 252) continue;
          const was = stood[sym] || null;
          const ev = btEvalAt(sym, p, i, byS2.get(sym) || {}, was, earnings, at, cfg);
          if (!ev) continue;
          if (was) real2++; else imputed2++;
          why.set(sym, { a: ev.v.action, f: ev.v.flag || null, real: !!was });
          // In exit mode a holding survives while its verdict is ABOVE the exit
          // tier, which is a wider net than the tiers you bought on — you do not
          // sell a Strong Buy that merely slipped to Hold.
          const ok = mode === 'exit'
            ? Action.ACTIONS.indexOf(ev.v.action) > Action.ACTIONS.indexOf(BT_EXIT_TIER)
            : tiers.indexOf(ev.v.action) >= 0;
          if (!ok) continue;
          set.add(sym);
          // Ranked only when a cut has to be made, and only on the qualifying
          // names: the cushion is a pass over the bars, and doing it for
          // the whole universe at every mark would be the expensive half of the
          // run for a number nothing would read.
          if (recut) cand.push({ symbol: sym, tierRank: Action.ACTIONS.indexOf(ev.v.action),
            ...btRankMetrics(ev.row, p.rows, i, cfg) });
        }
        // A Top-N cut is part of the strategy, so re-running the rules has to
        // re-run the CUT as well. Without this, asking for the top 5 and
        // rebalancing weekly quietly held all 20 from the first mark onward —
        // invisible until the trade log named the fifteen it bought.
        //
        // The seed moves with the mark so the random control draws a fresh
        // basket each period rather than the same one every time; exit-only is
        // left alone, since a cut there would sell names for ranking low, which
        // is not what "sell on downgrade" means.
        if (recut && cand.length > top) {
          const keep = new Set(btPick(cand, rank, top, seed + j).map((x) => x.symbol));
          for (const sym of [...set]) if (!keep.has(sym)) set.delete(sym);
        }
        targets.set(j, set);
        verdicts.set(j, why);
        coverage.push({ d: at, recorded: real2, imputed: imputed2 });
      }
      const sim = btSimulate({ axis, px, open: chosen.map((x) => x.symbol),
        targets, mode, costBps });
      if (sim) {
        rebal = { ...sim, every, mode, costBps, coverage,
          marks: marks.map((j) => axis[j]),
          trades: btTrades(sim.log, verdicts, byS2,
            { want: new Set(tiers), cut: recut }) };
      }
    } catch (err) {
      rebalError = err.message;      // a failed simulation never fails the run
      console.error('rebalance failed:', err.message);
    }
  }

  // The benchmark is a nicety, not a dependency: if the provider is having one
  // of its days the rest of the answer still stands.
  let spy = null, spyError = null;
  try {
    const sv = await btLoadSpy();
    const from = sv.find((x) => x.d >= asked);
    if (from) {
      const rows = sv.filter((x) => x.d >= asked);
      spy = { dates: rows.map((x) => x.d), values: rows.map((x) => x.c / from.c) };
    }
  } catch (e) { spyError = netReason(e); }

  const last = (a) => (a && a.length ? a[a.length - 1] : null);
  const pct = (v) => (v == null ? null : (v - 1) * 100);
  const addedAfter = r.picks.filter((x) => x.dateThen > asked).length;
  res.json({
    date: asked, tradingDate: held.dates[0] || asked, today,
    tiers, universe: universe.length,
    picks: r.picks,
    rank, top, every, mode: every ? mode : null, cost: costBps,
    theme: theme || null,
    rules, ruleSets: RULE_SETS,
    // Every rule set over the same date, the same rows and the same verdicts —
    // buy-and-hold only, since that is what one shared row build can price
    // honestly. Rebalancing each of them would be five more simulations.
    compare: r.compare,
    curve: { dates: held.dates, portfolio: held.values,
             rebalanced: rebal ? rebal.values : null,
             tier: top ? tier.values : null,
             band: band ? { p10: band.p10, p50: band.p50, p90: band.p90 } : null,
             spy: spy ? spy.values : null, spyDates: spy ? spy.dates : null },
    // What the rebalancing actually traded, per rebalance, with the verdict
    // that caused each move. Beside the curve rather than inside summary:
    // it is a list, not a statistic.
    trades: rebal ? rebal.trades : null,
    summary: {
      n: r.picks.length,
      selected: chosen.length,
      rankable,
      portfolio: pct(last(held.values)),
      tier: top ? pct(last(tier.values)) : null,
      spy: spy ? pct(last(spy.values)) : null,
      up: chosen.filter((x) => x.ret > 0).length,
      best: r.picks[0] || null,
      worst: r.picks[r.picks.length - 1] || null,
      scope: theme || 'All',
      scopeOf,
      // Where the ranked basket landed among random baskets of the same size.
      // 50 means the ranking did exactly nothing; this is the number to read
      // first, ahead of the return.
      bandPct: band && last(held.values) != null
        ? Math.round((band.finals.filter((x) => x < last(held.values)).length / band.finals.length) * 100)
        : null,
      bandLo: band ? pct(last(band.p10)) : null,
      bandHi: band ? pct(last(band.p90)) : null,
      bandTrials: band ? band.trials : null,
      // The rebalanced run, beside the buy-and-hold one it is a variant of, so
      // the page can say what the rebalancing itself was worth.
      rebalanced: rebal ? pct(last(rebal.values)) : null,
      rebalances: rebal ? rebal.rebalances : null,
      turnover: rebal ? rebal.turnover : null,
      endNames: rebal ? rebal.endNames : null,
      endCash: rebal ? rebal.endCash : null,
      // How much of THIS run stood on recorded fundamentals rather than
      // today's, per rebalance — the number that improves on its own as the
      // archive fills, and the reason this is worth building before it does.
      rebalCoverage: rebal ? rebal.coverage : null,
      rebalError,
    },
    notes: {
      evaluated: r.evaluated,
      tooShort: r.tooShort,
      noFundamentals: r.noFund,
      reportedInWindow: r.picks.filter((x) => x.reportedInWindow).length,
      addedAfterStart: addedAfter,
      // How much of the verdict was measured rather than assumed.
      fundReal: r.real,
      fundImputed: r.imputed,
      picksReal: r.picks.filter((x) => x.fundAsOf).length,
      fundAsOf: r.picks.map((x) => x.fundAsOf).filter(Boolean).sort().pop() || null,
      fundamentalsFrom: FUND_HISTORY_FROM,
      spyError,
    },
  });
}));

app.get('/api/db-stats', requireAdmin, route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const fresh = req.query.fresh === '1';
  if (!fresh && dbStatsCache && Date.now() - dbStatsCache.countedAt < 5 * 60 * 1000) {
    return res.json({ ...dbStatsCache, cached: true });
  }
  // Only the counting stands aside — a cached answer reads nothing, so there
  // is no reason to refuse it. The heaviest read in the app by a distance:
  // counting every table reads every row, nearly all of them `bars`.
  if (await standAside(res)) return;
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
  const universe = await readUniverse();
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
  const universe = (await readUniverse());
  const profiles = await readProfiles();
  const now = Date.now();
  const ages = { day: 0, three: 0, week: 0, older: 0, none: 0 };
  for (const s of universe) {
    const p = profiles[s];
    if (!p || !p.fetchedAt) { ages.none++; continue; }
    const d = (now - p.fetchedAt) / 86400000;
    if (d < 1) ages.day++; else if (d < 3) ages.three++; else if (d < 7) ages.week++; else ages.older++;
  }
  // This asked archiveStats() for the archive's through-date and threw its row
  // count away — paying `count(*), max(d) from bars` over 1,708,408 rows, 135.9s
  // and 268.9s cold, for one date string. That is why this endpoint was "the
  // slower half of the page": the comment above blamed the profiles, which are
  // the cheap part. `barsThrough` seeks per symbol on the primary key instead.
  let through = null;
  try { through = await store.barsThrough(universe); } catch { /* shown as unknown */ }
  res.json({
    universe: universe.length,
    ages,
    gaps: profileGaps(universe, profiles).length,
    barsThrough: through,
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
  // Database usage, checked on the same daily pass rather than on its own
  // schedule: one more thing that is only worth hearing about when it is wrong.
  let usage = null;
  let usageMailed = false;
  try {
    usage = await tursoUsage();
    const worst = tursoWorst(usage);
    if (worst && worst.frac >= TURSO_ALERT_AT && req.query.dry !== '1' && MAIL_READY) {
      const to = await operatorEmail();
      if (to) {
        const pct = Math.round(worst.frac * 100);
        const heading = `Database usage at ${pct}% — ${worst.name}`;
        const intro = `Turso reports ${worst.used.toLocaleString()} of ${worst.lim.toLocaleString()} ` +
          `${worst.name} this billing period (${pct}%). Rows read is what a full-table scan spends, so ` +
          'a jump usually means a query started scanning rather than seeking.';
        const link = APP_URL ? `${APP_URL}/database` : '';
        const html = emailShell({ heading, intro,
          body: '<p style="margin:0 0 14px;font-size:14px;line-height:1.6">The Database page shows the ' +
            'current usage and every table. <code>node query-plan-test.js</code> fails on any query that ' +
            'scans a big table.</p>' + (link ? mailButton(link, 'Open the database page') : ''),
          note: 'Sent by the daily check that watches the nightly job and the database quota.' });
        const text = textShell({ heading, intro, lines: link ? [link] : [],
          note: 'Sent by the daily check that watches the nightly job and the database quota.' });
        usageMailed = await sendMail({ to, subject: `[Tickr Lab] ${heading}`, text, html });
      }
    }
  } catch (err) {
    console.warn('watchdog: usage check skipped:', err.message);
  }
  console.log(`watchdog: ${today.day} ${today.verdict}${mailed ? ' — alert mailed' : ''}` +
              (usage && usage.configured ? ` · rows read ${Number(usage.rowsRead || 0).toLocaleString()}${usageMailed ? ' — usage alert mailed' : ''}` : ''));
  res.json({ ok: true, ...today, alert: bad, mailed });
}));

// ---- intraday price refreshes -------------------------------------------------
// Called every 30 minutes by an external scheduler (cron-job.org, set in New
// York time: minutes 10 and 40, hours 9-15, Monday-Friday). The server decides
// whether to act, so the schedule can be broad and daylight saving needs no
// thought: a weekday between 9:40 AM and 4:00 PM New York time, nothing else
// running (two jobs in one minute breach the 610 credits), and NYSE open by
// Twelve Data's market_state (1 credit — it knows holidays and early closes).
// Then one plain price refresh, no email, logged as an `intraday` run. A call
// outside the window returns without logging (the 9:10 call lands there every
// day); a holiday or a busy slot is logged as `skipped`, since those are the
// calls worth seeing. ?dry=1 reports the decision and changes nothing.
const INTRADAY_START_MIN = 9 * 60 + 38;   // two minutes of scheduler slack before 9:40
const INTRADAY_END_MIN = 16 * 60;

function nyClock(ms = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { weekday: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute),
    label: `${parts.hour.padStart(2, '0')}:${parts.minute.padStart(2, '0')}` };
}

async function nyseState() {
  try {
    const j = await fetchJson(`${TD_BASE}/market_state?exchange=NYSE&apikey=${API_KEY}`);
    const x = Array.isArray(j) ? j.find((r) => r && r.code === 'XNYS') : null;
    return x ? { known: true, open: !!x.is_market_open, timeToClose: x.time_to_close || null } : { known: false };
  } catch {
    return { known: false };
  }
}

app.all('/api/cron/intraday', route(async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'GET or POST.' });
  if (!isCron(req)) return res.status(401).json({ error: 'Bad or missing cron secret.' });
  if (!API_KEY) return res.status(500).json({ error: 'No API key configured.' });
  const dry = req.query.dry === '1';
  const clock = nyClock();
  const actor = 'intraday schedule';
  const skip = async (reason, log) => {
    if (log && !dry) await trackSafe(store.recordSkippedRun({ kind: 'intraday', trigger: 'scheduled', actor, reason }));
    return res.json({ ok: true, ran: false, reason, ny: clock.label, dry });
  };
  if (['Sat', 'Sun'].includes(clock.weekday)) return skip('weekend', false);
  if (clock.minutes < INTRADAY_START_MIN || clock.minutes >= INTRADAY_END_MIN) {
    return skip(`outside 9:40 AM-4:00 PM New York (${clock.label})`, false);
  }
  const running = await readRefreshState();
  if (running) return skip(`another refresh is running (${running.mode === 'missing' ? 'Fill missing'
    : running.mode === 'fast' ? 'Fast refresh'
      : running.mode === 'prices' ? 'Refresh prices' : 'Refresh all'})`, true);
  const market = await nyseState();
  if (market.known && !market.open) return skip('NYSE closed (holiday or early close)', true);
  // The dry call also PLANS the slot, so the scheduler does not have to know
  // the universe size or the slice width — both move, and a copy of that
  // arithmetic in a shell script is a copy that goes stale silently.
  const total = (await readUniverse()).length;
  const rounds = Math.max(1, Math.ceil(total / PRICE_SLICE));
  if (dry) {
    return res.json({ ok: true, ran: false, wouldRun: true, ny: clock.label, market, dry,
      total, slice: PRICE_SLICE, rounds });
  }

  // A run is one SLOT, not one call. The light rounds and the closing full
  // round are rounds of the same run, so /refreshes shows "3 rounds, 1,164
  // priced" rather than three runs an hour that each look like a whole
  // refresh. The first call starts it; only the full round closes it. A slot
  // abandoned half way is swept like any other run that stopped reporting.
  const asked = Number(req.query.run) || null;
  const runId = asked
    || await trackSafe(store.startRun({ kind: 'intraday', trigger: 'scheduled', actor, total, targets: total }));

  // LIGHT: price the next slice, archive it, move the cursor — no 650-day
  // window, no scoring, no snapshot. That window is the whole reason this mode
  // exists: an ordinary round pays it EVERY time regardless of how many
  // symbols it priced, so three ordinary rounds a slot would triple the
  // database read for no extra prices. Two light rounds and one full one
  // price the entire universe every thirty minutes at the read cost of one.
  if (req.query.light === '1') {
    const r = await runPriceSlice();
    if (r.nothing) {
      return res.json({ ok: true, ran: false, light: true, runId, reason: 'nothing left to price',
        ny: clock.label, total, rounds });
    }
    if (!r.ok) {
      await recordRound(runId, r.opts, r.m, r.ms,
        { error: r.out.error, refused: r.out.status === 429, phases: r.T.steps() });
      await trackSafe(store.finishRun(runId, { status: 'failed', error: r.out.error }));
      return res.status(r.out.status).json({ error: r.out.error, runId });
    }
    r.m.credits += market.known ? 1 : 0;
    await recordRound(runId, r.opts, r.m, r.ms,
      { loaded: r.opts.pricedAfter, total: r.opts.priceTotal, phases: r.T.steps() });
    console.log(`intraday: priced ${r.out.served} symbols (light) at ${clock.label} New York`);
    return res.json({ ok: true, ran: true, light: true, runId, served: r.out.served,
      priced: r.opts.pricedAfter, total: r.opts.priceTotal, rounds, ny: clock.label });
  }

  const startedAt = Date.now();
  const opts = await liveRefreshOpts();
  const { r, m, ms } = await metered(() => computeStocks(null, opts));
  if (!r.ok) {
    await recordRound(runId, opts, m, ms, { error: r.error, refused: r.status === 429 });
    await trackSafe(store.finishRun(runId, { status: 'failed', error: r.error }));
    return res.status(r.status).json({ error: r.error, runId });
  }
  // MOVE THE PRICE CURSOR ON. This call was missing entirely, which is what
  // made the schedule re-price `universe.slice(0, 500)` every thirty minutes
  // and leave the other 665 stocks on a price from hours earlier. Outside a
  // multi-round run this only advances the cursor — no flag is raised and no
  // banner appears, which is why the schedule can page through the universe
  // without every viewer being told a refresh is in progress thirteen times a
  // day.
  await notePriceRound(opts);
  const fin = await finishLiveRefresh(r.payload, { startedAt, actor, runId });
  // the market check's credit belongs to this run too
  m.credits += market.known ? 1 : 0;
  await recordRound(runId, opts, m, ms, { loaded: fin.loaded, total: fin.total,
    rows: r.payload.stocks.length, phases: r.payload.phaseSteps });
  await trackSafe(store.finishRun(runId, { status: 'complete', loaded: fin.loaded, total: fin.total }));
  console.log(`intraday: refreshed ${r.payload.stocks.length} symbols at ${clock.label} New York`);
  res.json({ ok: true, ran: true, runId, ny: clock.label, market, updatedAt: r.payload.updatedAt });
}));

app.post('/api/cron/refresh', route(async (req, res) => {
  if (!isCron(req)) return res.status(401).json({ error: 'Bad or missing cron secret.' });
  if (!API_KEY) return res.status(500).json({ error: 'No API key configured.' });

  let cronRunId = null;
  const starting = req.query.start === '1' || req.body?.start === true;
  const askedRun = Number(req.body?.runId) || null;
  const askedStatus = !starting && askedRun
    ? await trackSafe(store.runStatus(askedRun)) : null;
  if (askedStatus === 'stopped') {
    // Stopped from /refreshes: tell the job it is done, and spend nothing.
    return res.json({ ok: true, done: true, stopped: true, runId: askedRun });
  }
  // ALREADY FINISHED: say so, and spend nothing.
  //
  // The job only exits 0 when a round answers `done`. If that one response is
  // ever lost — a slow tail, a cold instance, a dropped socket — every later
  // call used to fall through to a fresh full refresh, time out at the job's
  // 180s curl limit, and count as a round with no progress. Three of those and
  // the job gives up and reports failure.
  //
  // That is exactly what happened on 2026-09-19: the run was `complete` with
  // all 430 loaded and the job still failed, having burned three 180-second
  // calls after the work was done. The run's own status is the authority on
  // whether there is anything left to do.
  if (askedStatus === 'complete' || askedStatus === 'incomplete') {
    return res.json({ ok: true, done: true, runId: askedRun, already: askedStatus });
  }
  if (starting) {
    const total = (await readUniverse()).length;
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
      const universe = (await readUniverse());
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
  await recordRound(runId, opts, m, ms, { loaded: fin.loaded, total: fin.total,
    rows: r.payload.stocks.length, phases: r.payload.phaseSteps });
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

  // ?asOf=YYYY-MM-DD recomputes the table as it looked on that date and reports the
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
      const total = (await readUniverse()).length;
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
    // Recorded BEFORE the tail: finishLiveRefresh is what closes the run and
    // builds the report, and a round recorded after it would be missing from
    // the very summary it completes. The counts are the same ones
    // finishLiveRefresh derives from these rows.
    const rowsNow = r.payload.stocks || [];
    await recordRound(runId, opts, m, ms, {
      loaded: rowsNow.filter((x) => x.profileFetchedAt != null).length,
      total: rowsNow.length, rows: rowsNow.length, phases: r.payload.phaseSteps });
    const fin = await finishLiveRefresh(r.payload, { startedAt, actor, runId: plainRun ? runId : null });
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
    // FIVE SEQUENTIAL ROUND TRIPS BECAME ONE (2026-09-21). Serving the
    // screener took six: the snapshot, then short names, advice age, priced-at,
    // the portfolios and the refresh flag, each awaited in turn. None of the
    // five depends on any other — they only need `snap` — and each writes a
    // different field, so they were in series for no reason but the order they
    // were written in.
    //
    // It costs nothing on an idle database and everything on a busy one.
    // Measured while a Fill missing was running: /api/health, which touches no
    // database, answered in 0.09s every time, while /api/status — TWO tiny
    // indexed reads — took 3.1s, 6.3s, 9.2s and 47.2s. Whatever one round trip
    // costs under that contention, this path was paying it six times over. The
    // same arithmetic init() already records: 46 sequential is 1.72s and the
    // same 46 in one batch is 0.04s.
    //
    // Each stamp keeps its own catch so one slow auxiliary read degrades a
    // field rather than 500-ing the whole screener — which matters most
    // exactly when the database is struggling. The portfolios are deliberately
    // NOT tolerant: memberships are load-bearing for the badges and the tab
    // counts, and silently dropping them would be a wrong table, not a thin one.
    const [, , , pf, refreshing] = await Promise.all([
      ...serveStamps(snap.stocks),
      readPortfolios(),
      readRefreshState().catch(() => null),
    ]);
    // Memberships too: portfolios are edited between refreshes (a deleted one
    // must not linger on every row until the next refresh rewrites the snapshot).
    finishServe(snap.stocks, pf);
    snap.portfolios = Object.keys(pf);
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
    return res.json({ ...snap, fromSnapshot: true, refreshing });
  }

  // No snapshot yet: an admin (or open/local mode) computes and seeds the first one.
  if (await isAdmin(req)) {
    const r = await computeStocks(null);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    await writeSnapshot({ ...r.payload, snapshotAt: r.payload.updatedAt });
    dropSnapshotCache();
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
// The kinds the browser is allowed to report. `load` joined them for timing:
// how long a page took to become usable, which the server cannot see — its own
// `page` row is written before the static file even goes out.
//
// These are also exactly the kinds whose `ms` is a BROWSER measurement — what
// the person actually waited — where every other kind's is the server's own
// elapsed time. `/activity` reads that distinction off the kind rather than
// storing a flag beside it, so the two can never disagree.
const CLIENT_ACT_KINDS = new Set(['sort', 'tab', 'picker', 'panel', 'chart', 'load']);
// A browser-supplied duration is untrusted input like any other. Ten minutes is
// far past any real interaction and keeps a junk value out of the percentiles.
const ACT_MS_MAX = 600000;
app.post('/api/activity', requireAuth, route(async (req, res) => {
  const events = Array.isArray(req.body && req.body.events) ? req.body.events.slice(0, 50) : [];
  const user = await actKey(req);
  const ts = new Date().toISOString();
  const rows = [];
  for (const e of events) {
    const kind = String((e && e.k) || '');
    if (!CLIENT_ACT_KINDS.has(kind)) continue;
    const detail = String((e && e.d) || '').replace(/[^\x20-\x7e]/g, '').slice(0, 80);
    // Reject the empty BEFORE coercing: Number(null) and Number('') are both 0
    // and finite, so the other order records a fabricated 0ms for every event
    // that was never timed — and a floor of zeros would flatter every
    // percentile on the page. The `num()` lesson, third time in this codebase.
    const raw = e && e.m;
    const ms = raw == null || raw === '' || !Number.isFinite(Number(raw))
      ? null
      : Math.min(ACT_MS_MAX, Math.max(0, Math.round(Number(raw))));
    rows.push({ ts, user, kind, detail: detail || null, ip: req.ip || null, ms });
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
