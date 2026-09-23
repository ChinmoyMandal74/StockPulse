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

// ---- a deadline on one round trip -----------------------------------------
// **A DROPPED SOCKET DOES NOT THROW FOR HOURS.** Measured on 2026-09-20 during
// the `tech_history` build: a write stalled at the 72-minute mark and the
// `terminated` error did not surface until minute 231 — **159 minutes inside a
// single `await db.batch(...)`**, with no error to catch and nothing printed.
// From the outside that is indistinguishable from healthy work on a
// network-bound job: the process is alive, CPU is near zero, stdout is silent.
//
// It cost 2h39m of a 4h38m offline run, which is merely annoying. The same
// `writeTechHistory` is called by `noteTechMark` inside the REFRESH TAIL,
// where the platform kills the function instead and the night is reported as
// a failure over data that was fine — the 2026-09-19 nightly's exact shape.
//
// So: race the work against a clock. **The request is NOT cancelled** — libSQL
// offers no handle for that — which is safe here only because every caller is
// an idempotent upsert, and a caller that is not must not use this.
const DB_BATCH_TIMEOUT_MS = Number(process.env.DB_BATCH_TIMEOUT_MS) || 60000;

function withDeadline(label, ms, run) {
  const work = run();
  // The abandoned request settles minutes later and would otherwise land as an
  // unhandled rejection long after we stopped waiting — which on Node takes
  // the process down. Marking it handled here is the whole reason this is not
  // a bare Promise.race at each call site.
  work.catch(() => {});
  let timer = null;
  const bell = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not answer within ${Math.round(ms / 1000)}s`)), ms);
  });
  // NO `timer.unref()` here, and a test pins that. An unref'd timer does not
  // hold the event loop open, so in a CLI script — the builder, which is the
  // one place this deadline most has to work — a hung request would leave
  // nothing else pending and Node would exit 0 mid-write instead of throwing.
  // The `clearTimeout` below is what stops a healthy call waiting on the clock.
  return Promise.race([work, bell]).finally(() => clearTimeout(timer));
}

// ---- schema ---------------------------------------------------------------
// Idempotent. Called once at boot; cheap enough to be safe on a warm start too.

const SCHEMA = [
  // Portfolio order drives the UI's tab order and its colour assignment, so it
  // has to survive a round trip — hence an explicit position rather than
  // relying on insertion order.
  `create table if not exists themes (
     name     text primary key,
     position integer not null
   )`,
  `create table if not exists theme_tickers (
     theme    text    not null,
     symbol   text    not null,
     position integer not null,
     primary key (theme, symbol)
   )`,
  // How long the Balanced verdict has stood, counted in market days. It could
  // not be backfilled: only one day of technicals is stored (prevTech), and a
  // full verdict replay needs fundamentals, which begin 2026-08-30 and land
  // only on the days a Refresh all ran. So this starts counting when it ships
  // and says so — `exact` is 0 until the row has actually been SEEN to change,
  // which is what lets the column print "at least" rather than a number it
  // cannot stand behind.
  `create table if not exists advice_state (
     symbol   text primary key,
     action   text not null,
     since_d  text not null,
     seen_d   text not null,
     sessions integer not null,
     exact    integer not null default 0
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
  // Who did what, fact-only: one row per meaningful action, from server
  // routes and the batched client beacon. Facts, never content (a chat row
  // says 'asked', not the question). Pruned to ~60 days on refresh — a
  // sense-of-usage tool, not an audit archive. 'user' is the account email,
  // 'admin' for the legacy password cookie, or 'guest-<id>' (the st_gid
  // cookie) so one guest's walk can be followed.
  `create table if not exists activity (
     id     integer primary key autoincrement,
     ts     text not null,
     user   text,
     kind   text not null,
     detail text,
     ip     text
   )`,
  `create index if not exists idx_activity_ts on activity (ts)`,
  `create index if not exists idx_activity_user on activity (user)`,
  // A member's own portfolios: named FILTERS over the shared snapshot, never
  // new data — every symbol must already be in the universe, enforced by the
  // route. symbols is a JSON array in the row: whole-collection replaces at
  // tens of rows, the house write pattern, and no join needed to render a
  // picker. NOT in prefs: three pages debounce-write prefs under the
  // hand-back-what-you-don't-edit rule, and a page bug there must not be
  // able to wipe someone's portfolios.
  // Column views: a named set of screener columns. scope is 'shared' for the
  // starter views every account sees and only the owner edits, or the
  // account's key (email, else 'admin') for its own. Own table rather than
  // prefs, for the reason user_portfolios is: three pages write prefs, and a
  // bug there must not be able to wipe someone's views.
  `create table if not exists column_views (
     id         text primary key,
     scope      text not null,
     name       text not null,
     position   integer not null,
     columns    text not null,
     updated_at integer
   )`,
  `create index if not exists idx_column_views_scope on column_views(scope, position)`,
  // Screens: a saved set of filters, a sort and the columns that explain the
  // result. Starter screens only — every account sees them, the owner edits.
  // grp is the heading the menu files them under.
  `create table if not exists screens (
     id          text primary key,
     name        text not null,
     grp         text not null,
     position    integer not null,
     description text,
     def         text not null,
     updated_at  integer
   )`,
  // One-time markers (key -> value), so a seed runs once rather than
  // re-appearing after the owner deletes what it created.
  // Reported quarters: estimate, actual and the surprise, from the /earnings
  // call the profile pull already makes (8 quarters, 20 credits, previously
  // reduced to one number). A reported quarter does not change, so this is an
  // append in practice and an upsert in code — the row is rewritten only if
  // the feed revises it. Keyed on the report date.
  `create table if not exists earnings_history (
     symbol       text not null,
     d            text not null,
     eps_estimate real,
     eps_actual   real,
     surprise     real,
     surprise_prc real,
     reported     text,
     fetched_at   integer,
     primary key (symbol, d)
   )`,
  // Blog posts (2026-09-16). PUBLIC when published — the only table in here
  // whose rows a stranger can read — so the routes serve `status = 'published'`
  // only and the body is rendered to HTML server-side, escaped first.
  `create table if not exists posts (
     slug         text primary key,
     title        text not null,
     summary      text,
     body         text not null,
     status       text not null default 'draft',
     author       text,
     published_at text,
     created_at   integer,
     updated_at   integer
   )`,
  `create index if not exists idx_posts_published on posts (status, published_at)`,
  `create table if not exists app_meta (
     key   text primary key,
     value text
   )`,
  // The stocks the screener tracks (2026-09-15). Until then the universe was
  // the union of the admin portfolios, so deleting a portfolio deleted every
  // stock only it held — and their data. Portfolios are groupings now; a stock
  // leaves the screener only by being removed from here.
  `create table if not exists universe (
     symbol   text primary key,
     added_at integer
   )`,
  `create table if not exists user_themes (
     user_key text not null,
     name     text not null,
     position integer not null,
     symbols  text not null,
     primary key (user_key, name)
   )`,
  // Accounts. The screener itself is shared — every signed-in user sees the same
  // data — so these exist purely to control who gets through the door.
  // role: 'owner' can edit tickers / refresh / rewind the table; 'member' is read-only.
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
  // One row per symbol per day. The screener holds only the current value of
  // every fundamental — `profiles` is overwritten on each refresh — so there is
  // no way to chart how a valuation moved. This accumulates one.
  //
  // Explicit columns rather than a JSON blob, unlike `profiles`: the shape here
  // is ours and stable, and a chart wants `select d, forward_pe` over a year
  // rather than 365 blobs to parse. Adding a field later is an ALTER in
  // ADDED_COLUMNS, the same as any other table.
  //
  `create table if not exists fundamentals_history (
     symbol              text not null,
     d                   text not null,
     price               real,
     market_cap          real,
     forward_pe          real,
     peg                 real,
     revenue_ttm         real,
     revenue_growth_yoy  real,
     gross_profit_ttm    real,
     gross_margin        real,
     net_income_ttm      real,
     profit_margin       real,
     earnings_growth_yoy real,
     fcf_ttm             real,
     fcf_margin          real,
     fcf_yield           real,
     net_cash            real,
     net_cash_pct        real,
     roe                 real,
     short_pct_float     real,
     primary key (symbol, d)
   )`,
  // The refresh report compares a day against the previous recorded one, and
  // both halves are looked up by date. The primary key is (symbol, d), which
  // cannot seek on a date alone.
  `create index if not exists idx_fund_hist_d on fundamentals_history (d)`,
  // The all-technical verdict at weekly marks, for the long backtest.
  //
  // Everything here is derived from a symbol's own bars, so unlike
  // fundamentals_history it CAN be rebuilt — and reaches back to 2003 rather
  // than to 2026-08-30. That is the whole reason it exists: a trend-only study
  // needs no fundamentals, so it is not bounded by when we started recording
  // them. `close` rides along so a sweep never has to touch `bars` at all,
  // which is what keeps a twenty-year study off the rows-read meter.
  //
  // It stores the INPUTS the engine reads, not only the verdict it reached, so
  // the table is rule-set agnostic: a page can re-evaluate any preset at read
  // time rather than being locked to whichever one the builder baked in.
  // Between them vs200/vs50/rsi/m1/m3/from_high/vol_trend/history_days are
  // every field the all-technical rules touch. `action` and `flag` are kept as
  // the Balanced reading, so a sweep that does not care about presets can read
  // them straight rather than re-evaluating 344,000 rows.
  `create table if not exists tech_history (
     symbol    text not null,
     d         text not null,
     action    text,
     flag      text,
     trend     text,
     close     real,
     vs200     real,
     vs50      real,
     rsi       real,
     m1        real,
     m3        real,
     from_high real,
     vol_trend real,
     history_days integer,
     primary key (symbol, d)
   )`,
  // The sweep walks DATES across every symbol, which the primary key cannot
  // seek on. Same lesson fundamentals_history records one line above, and the
  // reads must order by `d` alone — ordering by (symbol, d) makes SQLite walk
  // the primary key as a covering index and ignore the date filter.
  `create index if not exists idx_tech_hist_d on tech_history (d)`,
  // The backtest asks "what was the next earnings date, as of a past day", one
  // bounded range over d. The primary key is (symbol, d), which cannot seek on
  // a date alone, so without this the question is a scan of the whole table.
  `create index if not exists idx_earnings_d on earnings_history (d)`,
  // Password-reset tokens. The token itself is never stored: only its SHA-256,
  // for the same reason sessions and passwords are hashed — a database read
  // must not hand anyone a working reset link.
  `create table if not exists password_resets (
     token_hash text primary key,
     user_id    integer not null,
     created_at integer not null,
     expires_at integer not null
   )`,
  `create index if not exists idx_resets_user on password_resets (user_id)`,
  // Per-account UI preferences — which column groups are collapsed, for now.
  // Stored server-side rather than in localStorage so the setting follows the
  // person to another browser or machine, instead of belonging to a device and
  // being shared by anyone who sits at it. A JSON blob because nothing queries
  // inside it and the shape will grow.
  `create table if not exists prefs (
     user_key   text primary key,
     data       text not null,
     updated_at integer not null
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

  // Every refresh run, manual or scheduled — the history /refreshes reads.
  // refresh_state is the live flag and is deleted when a run ends; this is
  // what is left afterwards. One row per run, written at the start and
  // updated every round; the rounds themselves in refresh_rounds.
  `create table if not exists refresh_runs (
     id            integer primary key autoincrement,
     kind          text not null,
     trigger       text not null,
     actor         text,
     started_at    integer not null,
     updated_at    integer not null,
     ended_at      integer,
     status        text not null default 'running',
     total         integer,
     targets       integer,
     loaded        integer,
     rounds        integer not null default 0,
     refused       integer not null default 0,
     credits       integer not null default 0,
     profiles      integer not null default 0,
     prices_live   integer not null default 0,
     error         text,
     failed_symbols text,
     still_missing text,
     report_sent   integer,
     report_html   text,
     link          text
   )`,
  `create index if not exists idx_refresh_runs_started on refresh_runs(started_at)`,
  `create table if not exists refresh_rounds (
     run_id        integer not null,
     n             integer not null,
     at            integer not null,
     ms            integer,
     credits       integer,
     profiles      integer,
     profile_fails integer,
     price_source  text,
     priced_live   integer,
     loaded        integer,
     total         integer,
     error         text,
     primary key (run_id, n)
   )`,

  // Headlines per stock: headline / source / url / timestamp, never bodies.
  // The id is a hash of the url, so the same story from two fetches is one row.
  // RESTORED 2026-09-15: these two were deleted from the schema by the momentum
  // cleanup (ca2efed) and nothing noticed, because production already had the
  // tables — a fresh database would have failed every news write. Copied back
  // from the live `sqlite_master`, so they match what is deployed exactly.
  // Found by the query-plan test, which could not prepare the news statements.
  `create table if not exists news (
     id           text primary key,
     symbol       text not null,
     published_at text not null,
     source       text,
     headline     text not null,
     url          text not null
   )`,
  `create index if not exists idx_news_symbol on news (symbol, published_at)`,
  // The ticker asks for everything published in the last 12 hours across the
  // universe; without this it scanned the table (query-plan test, 2026-09-15).
  `create index if not exists idx_news_published on news (published_at)`,
  // Separate from `news` so a stock whose feed came back empty still counts as
  // fetched, and does not come up first in the rotation forever.
  `create table if not exists news_state (
     symbol     text primary key,
     fetched_at integer not null
   )`,
  // When each symbol's price was last fetched from the provider — a per-symbol
  // clock, exactly like news_state's, and separate from the bars for the same
  // reason: "we asked" and "there was something new" are different facts. A
  // stock can be pulled on time and still carry a month-old close (AVB did, on
  // 2026-09-17), and the snapshot's single updatedAt cannot tell the two apart.
  //
  // It is per SYMBOL rather than global because price rounds are paced: past
  // ~529 stocks a round prices only the slice that fits inside the minute and
  // the rest are read from the archive, so "when was this priced" genuinely
  // differs row to row.
  `create table if not exists price_state (
     symbol    text primary key,
     pulled_at integer not null
   )`,
  // The news job's log: one row per batch of headline fetches (a refresh
  // round's top-up, or a stock page fetching stale headlines), one row per
  // symbol inside it. The /news-runs page reads these.
  `create table if not exists news_runs (
     id             integer primary key autoincrement,
     trigger        text not null,
     actor          text,
     refresh_run_id integer,
     provider       text,
     started_at     integer not null,
     ended_at       integer,
     status         text not null default 'running',
     attempted      integer not null default 0,
     ok             integer not null default 0,
     failed         integer not null default 0,
     items          integer not null default 0,
     added          integer not null default 0,
     ms             integer,
     error          text
   )`,
  `create index if not exists idx_news_runs_started on news_runs(started_at)`,
  `create table if not exists news_run_items (
     run_id  integer not null,
     symbol  text not null,
     at      integer not null,
     ok      integer not null,
     items   integer,
     added   integer,
     stored  integer,
     ms      integer,
     error   text,
     primary key (run_id, symbol)
   )`,

  // Every US listing NASDAQ publishes, as a REFERENCE LIST and nothing more.
  // It is deliberately not joined to anything: the screener's universe, its
  // sectors and its industries come from Twelve Data, and NASDAQ's taxonomy is
  // a third one that agrees with neither GICS nor Twelve Data. Mixing them
  // would put two vendors' judgements in one column. This table exists so a
  // candidate ticker can be FOUND; adding it is still a deliberate act.
  `create table if not exists nasdaq_listings (
     symbol     text primary key,
     exchange   text,
     name       text,
     last_sale  real,
     net_change real,
     pct_change real,
     market_cap real,
     country    text,
     ipo_year   integer,
     volume     integer,
     sector     text,
     industry   text,
     url        text,
     fetched_at integer not null
   )`,
  // The one question this table is for — "what is above N" — is a range scan.
  'create index if not exists idx_nasdaq_cap on nasdaq_listings(market_cap)',
];

// Columns added after a table shipped. SQLite has no "add column if not
// exists", so each is attempted and a duplicate-column error is ignored.
// `alter table X add column Y ...` -> { table, column }, so a boot can ask
// which columns exist rather than attempting every ALTER and catching the
// failure. Anything it cannot parse falls through and is attempted as before.
function parseAddColumn(stmt) {
  const m = /^\s*alter\s+table\s+([A-Za-z0-9_]+)\s+add\s+column\s+([A-Za-z0-9_]+)/i.exec(stmt || '');
  return m ? { table: m[1], column: m[2] } : null;
}

const ADDED_COLUMNS = [
  // Each step of a round and what it cost, as JSON — so a slow round can be
  // explained after the fact. The phases used to ride the HTTP response only,
  // which meant the one round you most wanted to understand, the one that
  // timed out, was exactly the one whose timings were destroyed with it.
  'alter table refresh_rounds add column phases text',
  'alter table visitors add column user_email text',
  // How long the operation took, in milliseconds — null when nothing timed it.
  // WHOSE clock depends on the kind, and there is deliberately no second column
  // saying which: the CLIENT kinds (see CLIENT_ACT_KINDS in server.js, plus
  // `load`) are measured in the browser and are what the person actually
  // waited; every other kind is the server's own elapsed time. One rule, read
  // off the kind, rather than a flag that can disagree with it.
  'alter table activity add column ms integer',
  // How many symbols of this run have had their prices pulled live. Prices are
  // 1 credit each, so above ~530 symbols the whole universe does not fit in one
  // minute and the round is refused outright — the pull is paced across rounds
  // instead, and this is how a stateless function knows where it got to.
  'alter table refresh_state add column priced integer',
  // Earnings dates and the last surprise, recorded from 2026-09-13. Two
  // consumers were waiting on these: the advice-history replay (the
  // "Earnings soon" blackout is the one input the archive could not
  // reconstruct) and the PEAD study the research log has wanted for months
  // ("they are already in the profile payload... and currently discarded").
  'alter table fundamentals_history add column next_earnings_date text',
  'alter table fundamentals_history add column next_earnings_estimated integer',
  'alter table fundamentals_history add column last_earnings_date text',
  'alter table fundamentals_history add column last_surprise real',
  // The rest of what /statistics returns, recorded from 2026-09-15. They ride
  // in the same response as the original eighteen and were simply discarded,
  // so recording them costs no credits — and a day not recorded is gone for
  // good, which is the whole argument for keeping them. Every one is a point-
  // in-time snapshot the API cannot hand back later. Left out on purpose:
  // beta, the 52-week extremes and the moving averages, all of which the bar
  // archive reproduces exactly.
  'alter table fundamentals_history add column shares_outstanding real',
  'alter table fundamentals_history add column float_shares real',
  'alter table fundamentals_history add column total_cash real',
  'alter table fundamentals_history add column total_debt real',
  'alter table fundamentals_history add column debt_to_equity real',
  'alter table fundamentals_history add column current_ratio real',
  'alter table fundamentals_history add column enterprise_value real',
  'alter table fundamentals_history add column trailing_pe real',
  'alter table fundamentals_history add column price_to_book real',
  'alter table fundamentals_history add column price_to_sales real',
  'alter table fundamentals_history add column ev_to_ebitda real',
  'alter table fundamentals_history add column ebitda real',
  'alter table fundamentals_history add column operating_cash_flow_ttm real',
  'alter table fundamentals_history add column operating_margin real',
  'alter table fundamentals_history add column roa_ttm real',
  'alter table fundamentals_history add column diluted_eps_ttm real',
  'alter table fundamentals_history add column book_value_per_share real',
  'alter table fundamentals_history add column div_yield real',
  'alter table fundamentals_history add column div_rate real',
  'alter table fundamentals_history add column payout_ratio real',
  'alter table fundamentals_history add column short_ratio real',
  'alter table fundamentals_history add column short_pct_outstanding real',
  'alter table fundamentals_history add column insider_pct real',
  'alter table fundamentals_history add column institution_pct real',
  'alter table fundamentals_history add column ex_div_date text',
  // One Refresh All pulls prices ONCE; this stamp is how later rounds know
  // the pull already happened and spend their whole minute on profiles.
  'alter table refresh_state add column prices_at integer',
  // What kind of run this is: null for a Refresh all (full sweep or the
  // nightly rotation), 'missing' for Fill missing, which re-pulls only the
  // stocks whose company data is absent, failed or older than a field.
  'alter table refresh_state add column mode text',
  // The refresh_runs row this live run writes its rounds to.
  'alter table refresh_state add column run_id integer',
  // Registration approval (2026-09-14): new members are 'pending' until the
  // owner approves. The default backfills every existing account as active.
  "alter table users add column status text not null default 'active'",
  // The display name, when the legal one will not fit. Only OVERRIDES live
  // here: an untouched symbol has no row value and is shortened by rule at
  // serve time, so improving the rule improves every name that was never
  // edited, and an edited one is never quietly overwritten.
  'alter table names add column short_name text',
];

let ready = null;
async function init() {
  if (!ready) {
    ready = (async () => {
      // ONE round trip, not 45. Measured against the live database on
      // 2026-09-18: 46 statements sequentially is 1.72s, the same 46 in a
      // batch is 0.04s — and this runs on EVERY cold start, before the
      // instance can answer anything. It is why a second tab crawled while a
      // Fill missing held the warm instance.
      //
      // Safe to batch because every statement is `if not exists`, checked by
      // a test: none of them can raise the "already exists" the old loop
      // tolerated. The fallback below keeps that tolerance anyway, because the
      // race it was written for is real — cold instances initialise
      // simultaneously, and on 2026-09-14 every loser cached its rejected init
      // and served 500s until it was recycled.
      // BEFORE the schema, and that order is the whole thing: SCHEMA carries
      // `create table if not exists themes`, so running it first would make an
      // empty themes table, the rename below would then refuse ("table themes
      // already exists"), and 26 themes plus 281 memberships would sit stranded
      // in a table nothing reads. Rename first, create second.
      //
      // Each rename is attempted only when the OLD table is present and the NEW
      // one is not, so this is idempotent: on every boot after the first it
      // asks pragma_table_list, finds nothing to do, and costs one read.
      try {
        const RENAMES = [
          ['portfolios', 'themes'],
          ['portfolio_tickers', 'theme_tickers'],
          ['user_portfolios', 'user_themes'],
        ];
        const found = await db.execute(
          "select name from sqlite_master where type = 'table' and name in " +
          "('portfolios','themes','portfolio_tickers','theme_tickers','user_portfolios','user_themes')");
        const have = new Set(found.rows.map((r) => r.name));
        for (const [from, to] of RENAMES) {
          if (have.has(from) && !have.has(to)) {
            await db.execute(`alter table ${from} rename to ${to}`);
            console.log(`Turso: renamed ${from} -> ${to}`);
          }
        }
        // The column inside the membership table, same guard.
        if (have.has('portfolio_tickers') || have.has('theme_tickers')) {
          const cols = await db.execute("select name from pragma_table_info('theme_tickers')");
          const names = new Set(cols.rows.map((r) => r.name));
          if (names.has('portfolio') && !names.has('theme')) {
            await db.execute('alter table theme_tickers rename column portfolio to theme');
            console.log('Turso: renamed theme_tickers.portfolio -> theme');
          }
        }
      } catch (err) {
        // A failed rename must not stop the app booting — the old tables are
        // still there and readable, and the next cold start tries again.
        console.warn('Turso: theme rename skipped:', err.message);
      }

      try {
        await db.batch(SCHEMA, 'write');
      } catch (err) {
        for (const stmt of SCHEMA) {
          try {
            await db.execute(stmt);
          } catch (e2) {
            if (!/already exists/i.test(e2.message || '')) throw e2;
          }
        }
      }
      // These CANNOT be batched: `alter table add column` throws "duplicate
      // column" on every boot after the first, and a batch is all-or-nothing.
      // 36 guaranteed failures a cold start. Ask what the columns ARE instead,
      // in one batch, and run only what is genuinely missing — normally none.
      const wanted = ADDED_COLUMNS.map(parseAddColumn).filter(Boolean);
      const tables = [...new Set(wanted.map((x) => x.table))];
      const have = new Set();
      if (tables.length) {
        const info = await db.batch(tables.map((t) => ({
          sql: 'select name from pragma_table_info(?)', args: [t],
        })), 'read');
        tables.forEach((t, i) => {
          for (const row of info[i].rows) have.add(t + '.' + row.name);
        });
      }
      const missing = ADDED_COLUMNS.filter((stmt, i) => {
        const w = wanted[i];
        return !w || !have.has(w.table + '.' + w.column);
      });
      for (const stmt of missing) {
        try {
          await db.execute(stmt);
        } catch (err) {
          if (!/duplicate column/i.test(err.message || '')) throw err;
        }
      }
      // Every portfolio member belongs to the universe. Idempotent, so it is
      // safe on every cold start and needs no marker: it is what carried the
      // 271 portfolio stocks into the table on the first boot after it existed.
      await db.execute({ sql: UNIVERSE_FROM_PORTFOLIOS, args: [Date.now()] });
    })().catch((err) => {
      // Never cache a failed init: the next request retries instead of the
      // instance serving 500s for the rest of its life.
      ready = null;
      throw err;
    });
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
    db.execute('select name from themes order by position, name'),
    db.execute('select theme, symbol from theme_tickers order by theme, position'),
  ]);
  const out = {};
  for (const r of pf.rows) out[r.name] = [];
  for (const r of tk.rows) if (out[r.theme]) out[r.theme].push(r.symbol);
  return out;
}

const UNIVERSE_FROM_PORTFOLIOS =
  'insert or ignore into universe (symbol, added_at) select distinct symbol, ? from theme_tickers';

// The stocks the screener tracks: the universe table, plus any portfolio
// member not yet in it (belt and braces — writePortfolios keeps them in step).
// Ordered by when each joined.
async function readUniverse() {
  await init();
  const [u, tk] = await Promise.all([
    db.execute('select symbol from universe order by added_at, rowid'),
    db.execute('select distinct symbol from theme_tickers'),
  ]);
  const out = u.rows.map((r) => r.symbol);
  const seen = new Set(out);
  for (const r of tk.rows) if (!seen.has(r.symbol)) { seen.add(r.symbol); out.push(r.symbol); }
  return out;
}

async function addToUniverse(symbol) {
  await init();
  const r = await db.execute({ sql: 'insert or ignore into universe (symbol, added_at) values (?, ?)',
    args: [String(symbol).toUpperCase(), Date.now()] });
  return Number(r.rowsAffected || 0) > 0;
}

// Many at once (the NASDAQ page's bulk add). Returns the symbols that were new.
async function addManyToUniverse(symbols) {
  await init();
  const list = [...new Set((symbols || []).map((x) => String(x).toUpperCase()))];
  if (!list.length) return [];
  const now = Date.now();
  const res = await db.batch(list.map((sym) => ({
    sql: 'insert or ignore into universe (symbol, added_at) values (?, ?)', args: [sym, now],
  })), 'write');
  return list.filter((_, i) => Number((res[i] && res[i].rowsAffected) || 0) > 0);
}

// Out of the screener: the universe row and every portfolio membership, in one
// batch, so the union in readUniverse() cannot bring it straight back. The
// caller purges its data.
async function removeFromUniverse(symbol) {
  await init();
  const sym = String(symbol).toUpperCase();
  await db.batch([
    { sql: 'delete from theme_tickers where symbol = ?', args: [sym] },
    { sql: 'delete from universe where symbol = ?', args: [sym] },
  ], 'write');
}

async function writePortfolios(obj) {
  await init();
  const clean = normalize(obj);
  const stmts = [
    // Before the memberships are replaced, every current member is recorded in
    // the universe — so deleting a portfolio can never drop a stock with it.
    { sql: UNIVERSE_FROM_PORTFOLIOS, args: [Date.now()] },
    { sql: 'delete from theme_tickers', args: [] },
    { sql: 'delete from themes', args: [] },
  ];
  let pi = 0;
  for (const [name, syms] of Object.entries(clean)) {
    stmts.push({ sql: 'insert into themes (name, position) values (?, ?)', args: [name, pi++] });
    syms.forEach((sym, si) => {
      stmts.push({
        sql: 'insert into theme_tickers (theme, symbol, position) values (?, ?, ?)',
        args: [name, sym, si],
      });
    });
  }
  stmts.push({ sql: UNIVERSE_FROM_PORTFOLIOS, args: [Date.now()] });
  await db.batch(stmts, 'write');
}

// ---- the tile setup --------------------------------------------------------

// How a tile is laid out, for EVERYONE. A site setting like the hidden columns
// beside it, not a pref: the owner decides what a tile says (these are the
// cards that get shared), and a member choosing their own would make the same
// screenshot mean different things.
async function readTileConfig() {
  await init();
  const r = await db.execute("select value from app_meta where key = 'tile_config'");
  if (!r.rows.length) return null;
  try { return JSON.parse(r.rows[0].value || 'null'); } catch { return null; }
}

async function writeTileConfig(cfg) {
  await init();
  await db.execute({
    sql: "insert or replace into app_meta (key, value) values ('tile_config', ?)",
    args: [JSON.stringify(cfg)],
  });
  return cfg;
}

// ---- how long a verdict has stood ------------------------------------------

async function readAdviceState() {
  await init();
  const r = await db.execute('select symbol, action, since_d, seen_d, sessions, exact from advice_state');
  const out = {};
  for (const row of r.rows) {
    out[row.symbol] = { action: row.action, since: row.since_d, seen: row.seen_d,
      sessions: Number(row.sessions), exact: !!Number(row.exact) };
  }
  return out;
}

// One market day at a time, and idempotent: called twice for the same day it
// counts once, because a Refresh all runs a dozen rounds and may be run again
// by hand on the same afternoon.
async function noteAdvice(day, rows) {
  await init();
  if (!day || !Array.isArray(rows) || !rows.length) return 0;
  const prev = await readAdviceState();
  const stmts = [];
  for (const r of rows) {
    if (!r || !r.symbol || !r.action) continue;
    const was = prev[r.symbol];
    if (was && was.action === r.action) {
      if (was.seen >= day) continue;   // already counted today
      stmts.push({
        sql: `update advice_state set sessions = sessions + 1, seen_d = ?
              where symbol = ? and seen_d < ?`,
        args: [day, r.symbol, day],
      });
    } else {
      // A change we watched: from here the count is exact.
      stmts.push({
        sql: `insert or replace into advice_state (symbol, action, since_d, seen_d, sessions, exact)
              values (?, ?, ?, ?, 1, ?)`,
        args: [r.symbol, r.action, day, day, was ? 1 : 0],
      });
    }
  }
  if (!stmts.length) return 0;
  await db.batch(stmts, 'write');
  return stmts.length;
}

// ---- saved promo posts -----------------------------------------------------

// The studio cards the owner has named and kept, so a phone can open one and
// screenshot it. A site setting like the tile and mobile setups beside it: the
// owner curates the list on a desktop, everyone sees the same list.
async function readPromoPresets() {
  await init();
  const r = await db.execute("select value from app_meta where key = 'promo_presets'");
  if (!r.rows.length) return null;
  try { return JSON.parse(r.rows[0].value || 'null'); } catch { return null; }
}

async function writePromoPresets(list) {
  await init();
  await db.execute({
    sql: "insert or replace into app_meta (key, value) values ('promo_presets', ?)",
    args: [JSON.stringify(list)],
  });
  return list;
}

// ---- the mobile setup ------------------------------------------------------

// The views the phone offers, and what each shows. A site setting like the
// tile setup beside it: the owner configures it on a desktop, and the mobile
// page has no configuration of its own — only a switch between these.
async function readMobileConfig() {
  await init();
  const r = await db.execute("select value from app_meta where key = 'mobile_config'");
  if (!r.rows.length) return null;
  try { return JSON.parse(r.rows[0].value || 'null'); } catch { return null; }
}

async function writeMobileConfig(cfg) {
  await init();
  await db.execute({
    sql: "insert or replace into app_meta (key, value) values ('mobile_config', ?)",
    args: [JSON.stringify(cfg)],
  });
  return cfg;
}

// ---- blog posts -----------------------------------------------------------

const postRow = (x) => ({
  slug: x.slug, title: x.title, summary: x.summary, body: x.body, status: x.status,
  author: x.author, publishedAt: x.published_at,
  createdAt: Number(x.created_at) || null, updatedAt: Number(x.updated_at) || null,
});

// The list. `publishedOnly` is what every public route passes; the editor asks
// for everything. Bodies are left out — a list page does not need them and a
// dozen posts of markdown is a payload nobody reads.
async function readPosts({ publishedOnly = true } = {}) {
  await init();
  const r = await db.execute(publishedOnly
    ? { sql: `select slug, title, summary, '' as body, status, author, published_at, created_at, updated_at
                from posts where status = 'published' order by published_at desc`, args: [] }
    : { sql: `select slug, title, summary, '' as body, status, author, published_at, created_at, updated_at
                from posts order by coalesce(published_at, '') desc, updated_at desc`, args: [] });
  return r.rows.map(postRow);
}

async function readPost(slug, { publishedOnly = true } = {}) {
  await init();
  const r = await db.execute({
    sql: `select * from posts where slug = ?` + (publishedOnly ? " and status = 'published'" : ''),
    args: [String(slug)],
  });
  return r.rows.length ? postRow(r.rows[0]) : null;
}

// Whole-row upsert, keyed on the slug. `published_at` is stamped by the caller
// so the first publish sets it and an edit afterwards does not move it.
async function writePost(p) {
  await init();
  const now = Date.now();
  await db.execute({
    sql: `insert into posts (slug, title, summary, body, status, author, published_at, created_at, updated_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(slug) do update set
            title = excluded.title, summary = excluded.summary, body = excluded.body,
            status = excluded.status, author = excluded.author,
            published_at = excluded.published_at, updated_at = excluded.updated_at`,
    args: [p.slug, p.title, p.summary || null, p.body, p.status, p.author || null,
      p.publishedAt || null, p.createdAt || now, now],
  });
  return readPost(p.slug, { publishedOnly: false });
}

async function renamePost(from, to) {
  await init();
  await db.execute({ sql: 'update posts set slug = ?, updated_at = ? where slug = ?', args: [to, Date.now(), from] });
}

async function deletePost(slug) {
  await init();
  const r = await db.execute({ sql: 'delete from posts where slug = ?', args: [String(slug)] });
  return Number(r.rowsAffected || 0) > 0;
}

// ---- site-wide column visibility ------------------------------------------

// Which screener columns the owner has hidden for EVERYONE. One app_meta row
// holding a JSON array of column ids — site settings, not per-account, so it
// has no business in `prefs` (which is keyed per user and rewritten by three
// pages under the hand-back rule).
async function readHiddenColumns() {
  await init();
  const r = await db.execute("select value from app_meta where key = 'hidden_columns'");
  if (!r.rows.length) return [];
  try {
    const v = JSON.parse(r.rows[0].value || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

async function writeHiddenColumns(ids) {
  await init();
  const list = [...new Set((ids || []).filter((x) => typeof x === 'string'))];
  await db.execute({
    sql: "insert or replace into app_meta (key, value) values ('hidden_columns', ?)",
    args: [JSON.stringify(list)],
  });
  return list;
}

// ---- earnings history -----------------------------------------------------

// One batch for a whole refresh round rather than one write per symbol. Rows
// the feed has not revised are rewritten with identical values, which costs a
// statement and keeps the code a single upsert.
async function writeEarnings(rows) {
  await init();
  const list = (rows || []).filter((r) => r && r.symbol && r.date);
  if (!list.length) return 0;
  const now = Date.now();
  const num = (v) => (v == null || !isFinite(Number(v)) ? null : Number(v));
  await db.batch(list.map((r) => ({
    sql: `insert into earnings_history (symbol, d, eps_estimate, eps_actual, surprise, surprise_prc, reported, fetched_at)
          values (?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(symbol, d) do update set
            eps_estimate = excluded.eps_estimate, eps_actual = excluded.eps_actual,
            surprise = excluded.surprise, surprise_prc = excluded.surprise_prc,
            reported = excluded.reported, fetched_at = excluded.fetched_at`,
    args: [String(r.symbol).toUpperCase(), r.date, num(r.epsEstimate), num(r.epsActual),
      num(r.surprise), num(r.surprisePrc), r.time || null, now],
  })), 'write');
  return list.length;
}

// Every stored quarter for one symbol, newest first — for the stock page and
// the post-earnings-drift study the research log has been waiting on.
async function readEarnings(symbol) {
  await init();
  const r = await db.execute({
    sql: `select d, eps_estimate, eps_actual, surprise, surprise_prc, reported
            from earnings_history where symbol = ? order by d desc`,
    args: [String(symbol).toUpperCase()],
  });
  return r.rows.map((x) => ({
    date: x.d, epsEstimate: x.eps_estimate, epsActual: x.eps_actual,
    surprise: x.surprise, surprisePrc: x.surprise_prc, time: x.reported,
  }));
}

// ---- company names --------------------------------------------------------

async function readNames() {
  await init();
  const r = await db.execute('select symbol, name from names');
  const out = {};
  for (const row of r.rows) out[row.symbol] = row.name;
  return out;
}

// Admin overrides only — a null clears one and hands the symbol back to the
// rule. writeNames() upserts the name column alone, so a company renaming
// itself cannot wipe an override.
// Both columns in one read: the snapshot path stamps display names onto
// every row it serves, so this runs on each screener load.
async function readNamesFull() {
  await init();
  const r = await db.execute('select symbol, name, short_name from names');
  const out = {};
  for (const row of r.rows) out[row.symbol] = { name: row.name, short: row.short_name };
  return out;
}

async function readShortNames() {
  await init();
  const r = await db.execute('select symbol, short_name from names where short_name is not null');
  const out = {};
  for (const row of r.rows) out[row.symbol] = row.short_name;
  return out;
}

async function writeShortName(symbol, value) {
  await init();
  await db.execute({
    sql: `insert into names (symbol, short_name) values (?, ?)
          on conflict(symbol) do update set short_name = excluded.short_name`,
    args: [String(symbol).toUpperCase(), value || null],
  });
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

// One profile, for the stock page. readProfiles() pulls the whole table, and the
// blob now carries a company description — reading 84 of them to render one page
// is a lot of rows to throw away.
async function readProfile(symbol) {
  await init();
  const r = await db.execute({
    sql: 'select data, fetched_at from profiles where symbol = ?', args: [String(symbol)],
  });
  if (!r.rows.length) return null;
  try {
    const obj = JSON.parse(r.rows[0].data) || {};
    const t = Number(r.rows[0].fetched_at);
    if (t > 0) obj.fetchedAt = t; else delete obj.fetchedAt;
    return obj;
  } catch {
    return null;
  }
}

// Merge a few fields into stored profiles WITHOUT touching fetched_at.
//
// Deliberately not a readProfiles/writeProfiles round trip: readProfiles
// DELETES `fetchedAt` when the column is 0 -- the "the pull was refused, retry
// me" sentinel -- and writeProfiles then stores null rather than 0, which would
// hide that symbol from both the rotation (it picks among fetched_at > 0) and
// from profileGaps's `failed` test. Only the blob is rewritten here, so the
// timestamps mean exactly what they meant before.
async function mergeProfileFields(patch) {
  await init();
  const syms = Object.keys(patch || {});
  if (!syms.length) return 0;
  let done = 0;
  for (let i = 0; i < syms.length; i += 100) {
    const chunk = syms.slice(i, i + 100);
    const r = await db.execute({
      sql: `select symbol, data from profiles where symbol in (${chunk.map(() => '?').join(',')})`,
      args: chunk,
    });
    const stmts = [];
    for (const row of r.rows) {
      let obj;
      try { obj = JSON.parse(row.data); } catch { continue; }
      stmts.push({ sql: 'update profiles set data = ? where symbol = ?',
        args: [JSON.stringify({ ...obj, ...patch[row.symbol] }), row.symbol] });
    }
    if (stmts.length) { await db.batch(stmts, 'write'); done += stmts.length; }
  }
  return done;
}

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
// The rotation. A full sweep re-pulls every profile at 80 credits a symbol,
// which at 1,000 symbols is 80,000 credits and two and a half hours — for
// fields that move on 1-5% of nights, and that move as a step when they do.
// Expiring the OLDEST slice instead spreads the same work over the rotation
// window, and the fetched_at values fan out on their own after the first pass.
// A symbol with no profile at all is not here to be expired: ensureProfiles
// already treats a missing one as stale, so a newly added ticker is never
// waiting on its turn in the rotation.
async function expireOldestProfiles(limit) {
  await init();
  const n = Math.max(1, Math.floor(limit) || 1);
  const r = await db.execute({
    sql: `update profiles set fetched_at = 0
           where symbol in (select symbol from profiles
                             where fetched_at > 0 order by fetched_at asc limit ?)`,
    args: [n],
  });
  return r.rowsAffected ?? 0;
}

// Fill missing: expire exactly the stocks it targets, and nothing else. Chunked
// under SQLite's parameter ceiling, though a universe that needs a second
// chunk is a universe with a very bad day behind it.
async function expireProfilesFor(symbols) {
  await init();
  const list = [...new Set((symbols || []).filter(Boolean))];
  let n = 0;
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const r = await db.execute({
      sql: `update profiles set fetched_at = 0 where symbol in (${chunk.map(() => '?').join(',')})`,
      args: chunk,
    });
    n += r.rowsAffected ?? 0;
  }
  return n;
}

async function expireProfiles() {
  await init();
  const r = await db.execute('update profiles set fetched_at = 0');
  return r.rowsAffected ?? 0;
}

// ---- refresh state --------------------------------------------------------

// HOW LONG A ROUND CAN LEGITIMATELY BE SILENT, which both timeouts below are
// derived from rather than guessed at (2026-09-21).
//
// A round writes `updated_at` when it FINISHES, so between two writes there is
// one whole round plus the loop's deliberate pacing. The round has a hard
// ceiling that is not ours: the platform kills a function at ~300s. So the
// longest legitimate silence is about 362 seconds — six minutes — whatever the
// universe grows to.
//
// Both constants used to sit AT that worst case instead of above it, and at
// 602 symbols the worst case arrived. Run 55 (Fill missing, 2026-09-21)
// recorded four rounds of 73s, 244s, 218s and 251s — gaps of 5m38s, 5m30s and
// 6m08s — and the six-minute sweep buried it mid-flight while it was still
// working. The fingerprint is a run whose `ended_at` is EARLIER than its
// `updated_at`: it was marked over, and then kept reporting.
//
// A tolerance must therefore exceed the ceiling plus the gap, with slack. The
// cost of being generous is small and bounded (a notice that lingers, a run
// that reads `running` a few minutes longer); the cost of being tight is a
// night that reports failure over work that succeeded, three times over now.
const ROUND_CEILING_MS = 300 * 1000;  // the platform kills a function here
const ROUND_GAP_MS = 62 * 1000;       // the loop's pacing, set by the credit ceiling

// A refresh whose last progress report is older than this is treated as over.
// It must outlast a whole round, not just the gap between two: `/api/status`
// raises the banner from it and `standAside` guards the heavy reads with it,
// so a value under the round time makes both flicker off mid-round — the
// guard would stand down for the tail of every long round, which is exactly
// when a refresh most needs the database to itself.
//
// It is also what stops an admin closing the tab mid-backfill from pinning the
// banner up forever; that now takes ~7 minutes to clear rather than 4, which
// is the price of the round above being allowed to finish.
const REFRESH_STALE_MS = ROUND_CEILING_MS + ROUND_GAP_MS + 60 * 1000;

async function beginRefresh(actor, total, mode, runId) {
  await init();
  const now = Date.now();
  // prices_at and priced are reset too: a row left by an earlier run must not
  // tell this one its prices were already pulled.
  await db.execute({
    sql: `insert into refresh_state (id, started_at, updated_at, loaded, total, actor, mode, prices_at, priced, run_id)
          values (1, ?, ?, 0, ?, ?, ?, null, 0, ?)
          on conflict(id) do update set
            started_at = excluded.started_at, updated_at = excluded.updated_at,
            loaded = 0, total = excluded.total, actor = excluded.actor,
            mode = excluded.mode, prices_at = null, priced = 0, run_id = excluded.run_id`,
    args: [now, now, total ?? null, actor || null, mode || null, runId ?? null],
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

// Returns the run it just cleared, or null when there was nothing to clear.
// Both the natural finish and the client's DELETE land here, so "did I actually
// clear it" is the only thing standing between one run and two report emails.
// The read and the delete are separate statements, so two callers can both see
// the row — but only one delete reports a row affected, and that one reports.
async function endRefresh() {
  await init();
  const r = await db.execute(
    'select started_at, updated_at, loaded, total, actor, mode, run_id from refresh_state where id = 1');
  const del = await db.execute('delete from refresh_state where id = 1');
  if (!r.rows.length || (del.rowsAffected ?? 0) < 1) return null;
  const row = r.rows[0];
  return {
    startedAt: Number(row.started_at),
    updatedAt: Number(row.updated_at),
    loaded: row.loaded == null ? null : Number(row.loaded),
    total: row.total == null ? null : Number(row.total),
    actor: row.actor || null,
    mode: row.mode || null,
    runId: row.run_id == null ? null : Number(row.run_id),
  };
}

// ---- refresh run history ----------------------------------------------------

// A run still marked running with no update for this long is over — the tab
// closed or the job died. Derived from the same ceiling as REFRESH_STALE_MS
// (see there for the incident that forced it) and deliberately the more
// forgiving of the two: the live flag should clear promptly so the banner and
// the read guard let go, while the HISTORY should wait longer before calling a
// run dead, because mislabelling a working run is what sends a false failure.
const RUN_ABANDON_MS = ROUND_CEILING_MS + ROUND_GAP_MS + 3 * 60 * 1000;

async function recordSkippedRun({ kind, trigger, actor, reason }) {
  await init();
  const now = Date.now();
  await db.execute({
    sql: `insert into refresh_runs (kind, trigger, actor, started_at, updated_at, ended_at, status, error)
          values (?, ?, ?, ?, ?, ?, 'skipped', ?)`,
    args: [kind, trigger, actor || null, now, now, now, String(reason || '').slice(0, 300)],
  });
}

async function startRun({ kind, trigger, actor, total, targets, link }) {
  await init();
  const now = Date.now();
  const r = await db.execute({
    sql: `insert into refresh_runs (kind, trigger, actor, started_at, updated_at, total, targets, link)
          values (?, ?, ?, ?, ?, ?, ?, ?) returning id`,
    args: [kind, trigger, actor || null, now, now, total ?? null, targets ?? null, link || null],
  });
  return Number(r.rows[0].id);
}

// One round: its own row, and the run's running totals moved on.
async function noteRound(runId, rd) {
  if (!runId) return;
  await init();
  const now = Date.now();
  await db.batch([
    {
      sql: `insert into refresh_rounds (run_id, n, at, ms, credits, profiles, profile_fails,
              price_source, priced_live, loaded, total, error, phases)
            select ?, coalesce(max(n), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
              from refresh_rounds where run_id = ?`,
      args: [runId, now, rd.ms ?? null, rd.credits ?? 0, rd.profiles ?? 0, rd.profileFails ?? 0,
        rd.priceSource || null, rd.pricedLive ?? 0, rd.loaded ?? null, rd.total ?? null,
        rd.error ? String(rd.error).slice(0, 300) : null,
        // Capped like every other free-form column here: a step map is ours,
        // but the column must not become somewhere unbounded text can land.
        rd.phases && Object.keys(rd.phases).length
          ? JSON.stringify(rd.phases).slice(0, 2000) : null,
        runId],
    },
    {
      sql: `update refresh_runs set rounds = rounds + 1, credits = credits + ?,
              profiles = profiles + ?, prices_live = prices_live + ?, refused = refused + ?,
              loaded = coalesce(?, loaded), total = coalesce(?, total), updated_at = ?
            where id = ?`,
      args: [rd.credits ?? 0, rd.profiles ?? 0, rd.pricedLive ?? 0, rd.refused ? 1 : 0,
        rd.loaded ?? null, rd.total ?? null, now, runId],
    },
  ], 'write');
}

// Close a run. Only a run still running is closed, so a Stop is never
// overwritten by the client's give-up that arrives a moment later.
async function finishRun(runId, { status, error, loaded, total } = {}) {
  if (!runId) return false;
  await init();
  const now = Date.now();
  const r = await db.execute({
    sql: `update refresh_runs set status = ?, ended_at = ?, updated_at = ?,
            error = coalesce(?, error), loaded = coalesce(?, loaded), total = coalesce(?, total)
          where id = ? and status = 'running'`,
    args: [status, now, now, error ? String(error).slice(0, 300) : null,
      loaded ?? null, total ?? null, runId],
  });
  return (r.rowsAffected ?? 0) > 0;
}

// The report for a run, kept whether or not mail went out, plus the lists the
// page shows without opening it.
async function setRunReport(runId, { sent, html, failed, stillMissing }) {
  if (!runId) return;
  await init();
  await db.execute({
    sql: `update refresh_runs set report_sent = ?, report_html = ?,
            failed_symbols = ?, still_missing = ? where id = ?`,
    args: [sent ? 1 : 0, html || null, JSON.stringify(failed || []),
      stillMissing == null ? null : JSON.stringify(stillMissing), runId],
  });
}

async function runStatus(runId) {
  if (!runId) return null;
  await init();
  const r = await db.execute({ sql: 'select status from refresh_runs where id = ?', args: [runId] });
  return r.rows.length ? r.rows[0].status : null;
}

const RUN_COLS = `id, kind, trigger, actor, started_at, updated_at, ended_at, status, total, targets,
  loaded, rounds, refused, credits, profiles, prices_live, error, failed_symbols, still_missing,
  report_sent, link`;

function runFromRow(row) {
  const num = (v) => (v == null ? null : Number(v));
  const arr = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
  return {
    id: Number(row.id), kind: row.kind, trigger: row.trigger, actor: row.actor || null,
    startedAt: num(row.started_at), updatedAt: num(row.updated_at), endedAt: num(row.ended_at),
    status: row.status, total: num(row.total), targets: num(row.targets), loaded: num(row.loaded),
    rounds: num(row.rounds), refused: num(row.refused), credits: num(row.credits),
    profiles: num(row.profiles), pricesLive: num(row.prices_live), error: row.error || null,
    failedSymbols: arr(row.failed_symbols), stillMissing: arr(row.still_missing),
    reportSent: row.report_sent == null ? null : !!Number(row.report_sent), link: row.link || null,
  };
}

// Anything left running and silent is marked abandoned first, so every reader
// sees the same outcome without a job having to sweep for it.
async function sweepAbandoned() {
  await init();
  const cutoff = Date.now() - RUN_ABANDON_MS;
  await db.execute({
    sql: `update refresh_runs set status = 'abandoned', ended_at = updated_at
          where status = 'running' and updated_at < ?`,
    args: [cutoff],
  });
}

async function readRuns(sinceMs) {
  await sweepAbandoned();
  const r = await db.execute({
    sql: `select ${RUN_COLS} from refresh_runs where started_at >= ? order by started_at desc limit 1000`,
    args: [sinceMs || 0],
  });
  return r.rows.map(runFromRow);
}

async function readRun(id) {
  await sweepAbandoned();
  const r = await db.execute({
    sql: `select ${RUN_COLS}, report_html from refresh_runs where id = ?`, args: [id],
  });
  if (!r.rows.length) return null;
  const run = runFromRow(r.rows[0]);
  run.reportHtml = r.rows[0].report_html || null;
  const rr = await db.execute({
    sql: `select n, at, ms, credits, profiles, profile_fails, price_source, priced_live,
                 loaded, total, error, phases
            from refresh_rounds where run_id = ? order by n`,
    args: [id],
  });
  const num = (v) => (v == null ? null : Number(v));
  run.roundsDetail = rr.rows.map((x) => ({
    n: num(x.n), at: num(x.at), ms: num(x.ms), credits: num(x.credits), profiles: num(x.profiles),
    profileFails: num(x.profile_fails), priceSource: x.price_source || null,
    pricedLive: num(x.priced_live), loaded: num(x.loaded), total: num(x.total), error: x.error || null,
    // Stored as JSON; a round written before the column existed simply has
    // none, and the page says so rather than drawing an empty drill-down.
    phases: (() => { try { return x.phases ? JSON.parse(x.phases) : null; } catch (e) { return null; } })(),
  }));
  return run;
}

// 90 days of runs, 30 of round detail — a few hundred small rows either way.
async function pruneRuns(runDays = 90, roundDays = 30) {
  await init();
  const now = Date.now();
  await db.batch([
    { sql: 'delete from refresh_rounds where at < ?', args: [now - roundDays * 86400000] },
    { sql: 'delete from refresh_rounds where run_id in (select id from refresh_runs where started_at < ?)',
      args: [now - runDays * 86400000] },
    { sql: 'delete from refresh_runs where started_at < ?', args: [now - runDays * 86400000] },
  ], 'write');
}

// ---- the database page ------------------------------------------------------
// Every table with its row and column count, and every view with its columns.
// Counts are exact (count(*)), all in one read batch: measured at ~90ms for 21
// tables and ~382k rows. Views are listed but not counted — a view can be an
// arbitrary query, and counting one runs it.
async function tableStats() {
  await init();
  const m = await db.execute(
    `select type, name from sqlite_master
      where type in ('table', 'view') and name not like 'sqlite_%' and name not like '_litestream%'
      order by name`);
  const items = m.rows.map((r) => ({ type: r.type, name: r.name }));
  const quote = (n) => '"' + String(n).replace(/"/g, '""') + '"';
  const stmts = [];
  for (const it of items) {
    stmts.push({ sql: `select count(*) as n from pragma_table_info(?)`, args: [it.name] });
    if (it.type === 'table') stmts.push({ sql: `select count(*) as n from ${quote(it.name)}`, args: [] });
  }
  const t0 = Date.now();
  const res = stmts.length ? await db.batch(stmts, 'read') : [];
  let i = 0;
  for (const it of items) {
    it.columns = Number(res[i++].rows[0].n);
    it.rows = it.type === 'table' ? Number(res[i++].rows[0].n) : null;
  }
  return { items, ms: Date.now() - t0, countedAt: Date.now() };
}

// Counts for the nightly report: how much of the archive exists, and whether
// today's fundamentals row actually landed. Cheap enough to run once per run.
// **NO AGGREGATE OVER `bars` HERE. It was the slowest thing in the app.**
//
// This ran `select count(*), max(d) from bars` — over 1,708,408 rows, uncached,
// in the refresh TAIL on every report build, and on `/api/refresh-runs/health`.
// Measured against production on 2026-09-20, cold:
//
//   count(*) from bars                    135.9s
//   max(d) from bars                      268.9s   <- WORSE than the count
//   d order by d desc limit 1             253.0s
//   max(d) again, same connection           0.9s   <- cold cost only
//
// That is where a plain refresh's ~200-second tail went: 99.6s of round work,
// then this. The response died on the 300s gateway while the snapshot had been
// written correctly at +100s, which is how the night gets reported as a failure
// over good data — the third time that shape has bitten (news 2026-09-18,
// tech-history 2026-09-19, this).
//
// **`max(d)` looked like the safe half and is the expensive half**, and its plan
// reads `SEARCH bars USING COVERING INDEX` — the second time in one day that a
// SEARCH line concealed a minutes-long walk. There is no index on `d` alone;
// the primary key is (symbol, d). So "drop the count, keep the through-date"
// would have been a 2x REGRESSION shipped as a fix.
//
// Both callers get the through-date cheaply instead: the report already holds
// the freshest bar date in memory, and the health endpoint uses
// `barsMaxDates()`, which seeks per symbol on the primary key.
async function archiveStats(day) {
  await init();
  // Bounded: one row per symbol for one day, over the `d` index.
  const f = await db.execute({
    sql: 'select count(*) as n from fundamentals_history where d = ?', args: [day],
  });
  return { fundamentalsToday: Number(f.rows[0]?.n || 0) };
}

// The archive's newest bar date, WITHOUT touching the whole table: one indexed
// seek per symbol on the (symbol, d) primary key, batched — the same shape
// `barsMaxDates` already uses for the refresh (271 rows, 57ms).
async function barsThrough(symbols) {
  const dates = await barsMaxDates(symbols);
  let out = null;
  for (const { maxDate } of dates.values()) if (maxDate && (!out || maxDate > out)) out = maxDate;
  return out;
}

// null when nothing is running, so callers can spread it straight into a payload.
async function readRefreshState() {
  await init();
  const r = await db.execute('select started_at, updated_at, loaded, total, actor, prices_at, priced, mode, run_id from refresh_state where id = 1');
  if (!r.rows.length) return null;
  const row = r.rows[0];
  if (Date.now() - Number(row.updated_at) > REFRESH_STALE_MS) return null;
  return {
    startedAt: Number(row.started_at),
    loaded: row.loaded == null ? null : Number(row.loaded),
    total: row.total == null ? null : Number(row.total),
    actor: row.actor || null,
    pricesAt: row.prices_at == null ? null : Number(row.prices_at),
    priced: row.priced == null ? 0 : Number(row.priced),
    mode: row.mode || null,
    runId: row.run_id == null ? null : Number(row.run_id),
  };
}

// Stamped by the round that FINISHED pulling prices, so every later round in
// the same run reads the archive instead of the API.
async function markRefreshPrices() {
  await init();
  await db.execute({ sql: 'update refresh_state set prices_at = ? where id = 1', args: [Date.now()] });
}

// How far through the price pull this run is. Advanced by each price round;
// once it reaches the universe size the caller stamps prices_at and every
// later round is an archive round.
async function markPriced(n) {
  await init();
  await db.execute({ sql: 'update refresh_state set priced = ?, updated_at = ? where id = 1',
    args: [n, Date.now()] });
}

// ---- the NASDAQ reference list --------------------------------------------

// 13 columns against SQLite's 999-parameter ceiling puts a multi-row insert at
// 76; 70 leaves room. One statement per 70 rows rather than one per row is the
// same reasoning the bar archive follows — 4,130 statements is 4,130 to parse.
const NASDAQ_CHUNK = 70;
const NASDAQ_COLS = ['symbol', 'exchange', 'name', 'last_sale', 'net_change', 'pct_change',
  'market_cap', 'country', 'ipo_year', 'volume', 'sector', 'industry', 'url', 'fetched_at'];

// One exchange replaced wholesale, which is how a delisting leaves. Per
// exchange rather than per pull so the refresh can run in three requests: the
// largest is 4,130 rows and a serverless function is not awake for long.
async function writeNasdaqExchange(exchange, rows) {
  await init();
  const at = Date.now();
  await db.execute({ sql: 'delete from nasdaq_listings where exchange = ?', args: [exchange] });
  if (!rows || !rows.length) return 0;
  const placeholders = `(${NASDAQ_COLS.map(() => '?').join(', ')})`;
  const stmts = [];
  for (let i = 0; i < rows.length; i += NASDAQ_CHUNK) {
    const slice = rows.slice(i, i + NASDAQ_CHUNK);
    const args = [];
    for (const r of slice) {
      for (const c of NASDAQ_COLS) args.push(c === 'fetched_at' ? at : (r[c] ?? null));
    }
    stmts.push({
      sql: `insert into nasdaq_listings (${NASDAQ_COLS.join(', ')})
            values ${slice.map(() => placeholders).join(', ')}
            on conflict(symbol) do update set
              ${NASDAQ_COLS.filter((c) => c !== 'symbol').map((c) => `${c} = excluded.${c}`).join(', ')}`,
      args,
    });
  }
  // The bar-archive rule: libSQL takes a whole batch in one round trip, but
  // not an arbitrarily large one.
  for (let i = 0; i < stmts.length; i += 40) await db.batch(stmts.slice(i, i + 40), 'write');
  return rows.length;
}

// Which of these symbols the NASDAQ listing knows. `symbol` is the primary
// key, so this is N seeks and never a scan -- it exists so a pasted batch can
// be checked BEFORE it is added, since free text splits into plausible-looking
// tickers ("not a ticker!" becomes NOT, A, TICKER, and A is Agilent).
async function knownListings(symbols) {
  await init();
  const syms = [...new Set((symbols || []).map((x) => String(x).toUpperCase()))];
  const out = new Set();
  for (let i = 0; i < syms.length; i += 200) {
    const chunk = syms.slice(i, i + 200);
    const r = await db.execute({
      sql: `select symbol from nasdaq_listings where symbol in (${chunk.map(() => '?').join(',')})`,
      args: chunk,
    });
    for (const row of r.rows) out.add(row.symbol);
  }
  return out;
}

async function readNasdaqListings() {
  await init();
  // `url` is stored but not selected: every one of the 7,136 is exactly
  // /market-activity/stocks/<lowercase symbol>, checked, so shipping it is
  // 277 KB of something the page can derive.
  const r = await db.execute(
    `select symbol, exchange, name, last_sale, net_change, pct_change, market_cap,
            country, ipo_year, volume, sector, industry
       from nasdaq_listings order by market_cap desc`);
  // Named, not spread: a libSQL Row answers to its column names but spreads
  // to POSITIONAL keys, so `{ ...row }` hands the client {0: 'AAPL', 1: ...}
  // and every field on the page reads undefined.
  return r.rows.map((x) => ({
    symbol: x.symbol, exchange: x.exchange, name: x.name,
    last_sale: x.last_sale, net_change: x.net_change, pct_change: x.pct_change,
    market_cap: x.market_cap, country: x.country, ipo_year: x.ipo_year,
    volume: x.volume, sector: x.sector, industry: x.industry,
  }));
}

// Counts and the clock, for a page that has to say how stale it is before it
// is worth reading.
async function nasdaqMeta() {
  await init();
  const r = await db.execute(
    `select exchange, count(*) as n, max(fetched_at) as at from nasdaq_listings group by exchange`);
  const byExchange = {};
  let total = 0, at = 0;
  for (const row of r.rows) {
    byExchange[row.exchange || '?'] = { rows: Number(row.n), fetchedAt: Number(row.at) || 0 };
    total += Number(row.n);
    if (Number(row.at) > at) at = Number(row.at);
  }
  return { total, fetchedAt: at || null, byExchange };
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
// The newest stored bar per symbol. SEEKS, not a `group by` over the table:
// that scanned all 1,077,738 rows on every refresh round (measured 133ms and,
// more to the point, 1.08M rows read against a metered quota). One indexed
// probe per symbol answers the same question from 271 rows in 57ms. The row
// COUNT the old version also returned was never read by anything.
async function barsMaxDates(symbols) {
  await init();
  const syms = [...new Set((symbols || []).map((x) => String(x).toUpperCase()))];
  const out = new Map();
  if (!syms.length) return out;
  for (let i = 0; i < syms.length; i += ANCHOR_CHUNK) {
    const slice = syms.slice(i, i + ANCHOR_CHUNK);
    const res = await db.batch(slice.map((s) => ({
      sql: 'select d from bars where symbol = ? order by d desc limit 1', args: [s],
    })), 'read');
    slice.forEach((s, k) => {
      const row = res[k].rows[0];
      if (row && row.d) out.set(s, { maxDate: row.d });
    });
  }
  return out;
}

// The SPAN of each symbol's archive: the first and last bar, by seek.
//
// Deliberately not `select symbol, count(*) from bars group by symbol`. That
// reads all 1.08M rows, which is the exact shape that produced the Turso
// quota warning, and no index can answer "how many". Two seeks per symbol on
// the (symbol, d) primary key read two rows each instead — 708 rows for the
// whole universe against 1.08M — and a span answers the question a count was
// being asked for anyway: "does this stock have enough history". Sessions are
// ESTIMATED from the span (~0.69 of calendar days) and the page says so.
async function barsSpan(symbols) {
  await init();
  const syms = [...new Set((symbols || []).map((x) => String(x).toUpperCase()))];
  const out = {};
  if (!syms.length) return out;
  for (let i = 0; i < syms.length; i += ANCHOR_CHUNK) {
    const slice = syms.slice(i, i + ANCHOR_CHUNK);
    const stmts = [];
    for (const sym of slice) {
      stmts.push({ sql: 'select d from bars where symbol = ? order by d limit 1', args: [sym] });
      stmts.push({ sql: 'select d from bars where symbol = ? order by d desc limit 1', args: [sym] });
    }
    const res = await db.batch(stmts, 'read');
    slice.forEach((sym, k) => {
      const first = res[k * 2].rows[0];
      const last = res[k * 2 + 1].rows[0];
      if (first && last) out[sym] = { first: first.d, last: last.d };
    });
  }
  return out;
}

// Per-symbol rollups over the SMALL tables. Bounded by the universe times a
// retention window — fundamentals is universe x recorded days, earnings is
// universe x 40 quarters — so these are thousands of rows, not a million, and
// are allowlisted in query-plan-test.js with that reasoning.
async function coverageRollups() {
  await init();
  const [fund, earn, news] = await Promise.all([
    db.execute('select symbol, count(*) n, min(d) f from fundamentals_history group by symbol'),
    db.execute('select symbol, count(*) n, min(d) f from earnings_history group by symbol'),
    db.execute('select symbol, count(*) n from news group by symbol'),
  ]);
  const pack = (r, withFirst) => {
    const out = {};
    for (const row of r.rows) out[row.symbol] = withFirst
      ? { n: Number(row.n), first: row.f } : { n: Number(row.n) };
    return out;
  };
  return { fund: pack(fund, true), earn: pack(earn, true), news: pack(news, false) };
}

// Stored closes on a handful of dates, for the split probe. One query for the
// whole universe: US symbols share trading days, so the date set is tiny.
// The split probe's stored closes — one per (symbol, date) pair the caller
// asks about. `where d in (...)` had no index to use (the primary key is
// (symbol, d), so a date alone cannot seek) and scanned the whole table:
// 1.08M rows and 261ms, against 271 rows and 62ms for the pairs.
async function barsOn(pairs) {
  await init();
  const list = (pairs || []).filter((p) => p && p.sym && p.d);
  const out = new Map();
  if (!list.length) return out;
  for (let i = 0; i < list.length; i += ANCHOR_CHUNK) {
    const slice = list.slice(i, i + ANCHOR_CHUNK);
    const res = await db.batch(slice.map((p) => ({
      sql: 'select close from bars where symbol = ? and d = ?',
      args: [String(p.sym).toUpperCase(), p.d],
    })), 'read');
    slice.forEach((p, k) => {
      const row = res[k].rows[0];
      if (row) out.set(String(p.sym).toUpperCase() + '|' + p.d, Number(row.close));
    });
  }
  return out;
}

// How many days of recorded fundamentals each symbol holds.
//
// This is the number a bulk delete has to show, because it is THE ONE THING
// THAT DOES NOT COME BACK. Bars cost a credit to re-pull at any depth and
// earnings history comes back forty quarters at a time, but `profiles` only
// ever holds today's values — so a deleted day of fundamentals_history is gone
// for good and re-adding the ticker starts that series from zero.
//
// Seeks, never `group by` over the table: the (symbol, d) primary key answers
// this per symbol, and a grouped scan here is the shape that produced the
// Turso quota warning.
async function fundamentalsDaysFor(symbols) {
  await init();
  const syms = [...new Set((symbols || []).map((x) => String(x).toUpperCase()))];
  const out = new Map();
  if (!syms.length) return out;
  for (let i = 0; i < syms.length; i += ANCHOR_CHUNK) {
    const slice = syms.slice(i, i + ANCHOR_CHUNK);
    const res = await db.batch(slice.map((s) => ({
      sql: 'select count(*) n, min(d) lo, max(d) hi from fundamentals_history where symbol = ?',
      args: [s],
    })), 'read');
    slice.forEach((s, k) => {
      const row = res[k].rows[0];
      const n = Number((row && row.n) || 0);
      if (n) out.set(s, { days: n, from: row.lo, to: row.hi });
    });
  }
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
// Closes per symbol WITH the window each one actually covers. The query already
// selected `d` and threw it away, so the two dates cost nothing — and they are
// the only honest x-axis a card can carry: symbols do not share a calendar
// (Samsung misses US sessions, a recent listing starts late), so one shared
// date axis would mislabel some of them.
async function readCloseSeries(symbols, since) {
  await init();
  if (!symbols || !symbols.length) return {};
  const r = await db.execute({
    sql: `select symbol, d, close from bars
          where symbol in (${symbols.map(() => '?').join(',')}) and d >= ?
          order by symbol, d`,
    args: [...symbols, since],
  });
  const out = {};
  for (const row of r.rows) {
    const s = (out[row.symbol] ||= { closes: [], dates: [] });
    s.closes.push(Number(row.close));
    s.dates.push(row.d);
  }
  return out;
}

async function readCloses(symbols, since) {
  const series = await readCloseSeries(symbols, since);
  const out = {};
  for (const k of Object.keys(series)) out[k] = series[k].closes;
  return out;
}

// Bars for many symbols at once, newest first, with the high — which readCloses
// drops and `% from 52-week high` needs. Used for the trend ribbon's year at a
// date: the refresh only fetches ~300 bars per symbol, and scoring six months
// ago needs 274 of run-up on top of the 126 you are stepping back, so anything
// past about a month has to come from the archive rather than the pull.
// Full bars for many symbols at once, newest-first per symbol, in the exact
// shape a live time_series fetch has — so a Refresh All's later rounds can
// rebuild every row from the archive the first round just wrote, for zero
// API credits. ~96k rows at 300 symbols; the 50k-row read measures 2.0s.
// Stamp the symbols a live price pull actually served. Whole-batch, keyed on
// the primary key, so this is N indexed writes and never a scan.
// Report dates inside a window, for the backtest's "next earnings as of then".
// `d` IS the report date (verified: AAPL 2026-07-30), and `reported` is text
// ("After Hours"), not a flag — so it is deliberately not filtered on.
async function readEarningsDates(fromD, toD) {
  await init();
  const r = await db.execute({
    sql: 'select symbol, d from earnings_history where d >= ? and d <= ? order by symbol, d',
    args: [fromD, toD],
  });
  const out = {};
  for (const row of r.rows) (out[row.symbol] ||= []).push(row.d);
  return out;
}

async function notePricePull(symbols, at) {
  await init();
  const list = (symbols || []).filter(Boolean);
  if (!list.length) return 0;
  const when = at || Date.now();
  await db.batch(list.map((symbol) => ({
    sql: 'insert or replace into price_state (symbol, pulled_at) values (?, ?)',
    args: [symbol, when],
  })));
  return list.length;
}

async function readPriceState() {
  await init();
  const r = await db.execute('select symbol, pulled_at from price_state');
  const out = {};
  for (const row of r.rows) out[row.symbol] = Number(row.pulled_at);
  return out;
}

async function readBarsFullFor(symbols, since) {
  await init();
  if (!symbols || !symbols.length) return {};
  const r = await db.execute({
    sql: `select symbol, d, open, high, low, close, volume from bars
          where symbol in (${symbols.map(() => '?').join(',')}) and d >= ?
          order by symbol, d desc`,
    args: [...symbols, since],
  });
  const out = {};
  for (const row of r.rows) {
    (out[row.symbol] ||= []).push({
      datetime: row.d,
      open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume,
    });
  }
  return out;
}

async function readBarsFor(symbols, since) {
  await init();
  if (!symbols || !symbols.length) return {};
  const r = await db.execute({
    sql: `select symbol, d, high, close from bars
          where symbol in (${symbols.map(() => '?').join(',')}) and d >= ?
          order by symbol, d desc`,
    args: [...symbols, since],
  });
  const out = {};
  for (const row of r.rows) {
    (out[row.symbol] ||= []).push({ d: row.d, high: Number(row.high), close: Number(row.close) });
  }
  return out;
}

// Every table keyed by symbol. `snapshot` is deliberately absent: it is one
// JSON row rewritten wholesale on the next refresh, so it heals itself.
const SYMBOL_TABLES = ['bars', 'fundamentals_history', 'profiles', 'names', 'news', 'news_state',
  'earnings_history', 'price_state', 'tech_history'];

// Remove a symbol from the database entirely.
//
// Two of these come back on their own — bars cost one API credit to re-pull at
// any depth, and momentum is computed from bars — but FUNDAMENTALS HISTORY DOES
// NOT. The API only ever returns today's values, so a row that is deleted is
// gone for good and re-adding the ticker starts its series from zero. That is
// the price of the caller's request to drop everything, and it is why this
// returns per-table counts rather than doing its work quietly.
async function purgeSymbol(symbol) {
  await init();
  const sym = String(symbol).toUpperCase();
  const removed = {};
  let total = 0;
  // ONE ROUND TRIP, not nine. This was a sequential delete per table, and on
  // this database a path's cost is its number of round trips: at ~200ms each
  // that is over two seconds a symbol before the rows are even counted, and a
  // bulk removal of a hundred stocks ran past the platform's 300s ceiling and
  // was killed part way through its list. The nine deletes are independent —
  // different tables, same symbol — so they belong in one batch.
  const res = await db.batch(SYMBOL_TABLES.map((t) => ({
    sql: `delete from ${t} where symbol = ?`, args: [sym],
  })), 'write');
  SYMBOL_TABLES.forEach((table, i) => {
    const n = Number((res[i] && res[i].rowsAffected) || 0);
    if (n) removed[table] = n;
    total += n;
  });
  // Member lists hold JSON arrays, so they cannot ride SYMBOL_TABLES; counted
  // as rows edited, not rows deleted, and never fatal to the purge.
  try {
    const n = await removeSymbolFromUserPortfolios(sym);
    if (n) removed.user_themes = n;
  } catch { /* the sweep can catch it later */ }
  return { symbol: sym, removed, total };
}

// How many rows one table holds for one symbol — what the removal dialog
// counts before anything is destroyed.
async function countSymbolRows(table, symbol) {
  await init();
  if (!SYMBOL_TABLES.includes(table)) throw new Error(`not a per-symbol table: ${table}`);
  const r = await db.execute({
    sql: `select count(*) n from ${table} where symbol = ?`, args: [String(symbol).toUpperCase()],
  });
  return Number(r.rows[0]?.n || 0);
}

// Every symbol that has rows anywhere, so a caller can compare against the
// portfolios and find what has been left behind.
async function symbolsWithData() {
  await init();
  const sql = SYMBOL_TABLES.map((t) => `select distinct symbol from ${t}`).join(' union ');
  const r = await db.execute(sql);
  return r.rows.map((x) => x.symbol).filter(Boolean).sort();
}

async function barsStats() {
  await init();
  const r = await db.execute('select count(*) as n, count(distinct symbol) as syms, min(d) as mind, max(d) as maxd from bars');
  const x = r.rows[0] || {};
  return { rows: Number(x.n || 0), symbols: Number(x.syms || 0), from: x.mind || null, to: x.maxd || null };
}

// ---- fundamentals history -------------------------------------------------

// Column name in the table, then the field it comes from on a screener row.
const FUND_FIELDS = [
  ['price', 'price'],
  ['market_cap', 'marketCap'],
  ['forward_pe', 'forwardPe'],
  ['peg', 'peg'],
  ['revenue_ttm', 'revenueTtm'],
  ['revenue_growth_yoy', 'revenueGrowthYoY'],
  ['gross_profit_ttm', 'grossProfitTtm'],
  ['gross_margin', 'grossMargin'],
  ['net_income_ttm', 'netIncomeTtm'],
  ['profit_margin', 'profitMargin'],
  ['earnings_growth_yoy', 'earningsGrowthYoY'],
  ['fcf_ttm', 'fcfTtm'],
  ['fcf_margin', 'fcfMargin'],
  ['fcf_yield', 'fcfYield'],
  ['net_cash', 'netCash'],
  ['net_cash_pct', 'netCashPct'],
  ['roe', 'roe'],
  ['short_pct_float', 'shortPctFloat'],
  ['shares_outstanding', 'sharesOutstanding'],
  ['float_shares', 'floatShares'],
  ['total_cash', 'totalCash'],
  ['total_debt', 'totalDebt'],
  ['debt_to_equity', 'debtToEquity'],
  ['current_ratio', 'currentRatio'],
  ['enterprise_value', 'enterpriseValue'],
  ['trailing_pe', 'trailingPe'],
  ['price_to_book', 'priceToBook'],
  ['price_to_sales', 'priceToSales'],
  ['ev_to_ebitda', 'evToEbitda'],
  ['ebitda', 'ebitda'],
  ['operating_cash_flow_ttm', 'operatingCashFlowTtm'],
  ['operating_margin', 'operatingMargin'],
  ['roa_ttm', 'roa'],
  ['diluted_eps_ttm', 'dilutedEpsTtm'],
  ['book_value_per_share', 'bookValuePerShare'],
  ['div_yield', 'divYield'],
  ['div_rate', 'divRate'],
  ['payout_ratio', 'payoutRatio'],
  ['short_ratio', 'shortRatio'],
  ['short_pct_outstanding', 'shortPctOutstanding'],
  ['insider_pct', 'insiderPct'],
  ['institution_pct', 'institutionPct'],
];

// One set per symbol per day, enforced by the primary key. A Refresh all runs
// for a dozen-odd rounds and calls this on each, so the upsert matters: later
// rounds carry more populated profiles and should replace what earlier ones
// wrote, not sit alongside it.
// The earnings fields ride beside FUND_FIELDS rather than inside it: the
// refresh report's moved-fields comparison iterates FUND_FIELDS numerically,
// and a date does not belong in that pipeline. Written, never compared.
const FUND_EXTRAS = [
  ['ex_div_date', 'exDivDate', 'text'],
  ['next_earnings_date', 'nextEarningsDate', 'text'],
  ['next_earnings_estimated', 'nextEarningsEstimated', 'bool'],
  ['last_earnings_date', 'lastEarningsDate', 'text'],
  ['last_surprise', 'lastSurprise', 'num'],
];

async function writeFundamentals(day, rows) {
  await init();
  if (!rows || !rows.length) return 0;
  const cols = FUND_FIELDS.map(([c]) => c).concat(FUND_EXTRAS.map(([c]) => c));
  const num = (v) => (v == null || !isFinite(v) ? null : Number(v));
  const extra = (r, f, kind) => {
    const v = r[f];
    if (v == null) return null;
    if (kind === 'text') return String(v);
    if (kind === 'bool') return v ? 1 : 0;
    return num(v);
  };
  const stmts = rows.map((r) => ({
    sql: `insert into fundamentals_history (symbol, d, ${cols.join(', ')})
          values (?, ?, ${cols.map(() => '?').join(', ')})
          on conflict(symbol, d) do update set
            ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`,
    args: [r.symbol, day,
      ...FUND_FIELDS.map(([, f]) => num(r[f])),
      ...FUND_EXTRAS.map(([, f, kind]) => extra(r, f, kind))],
  }));
  for (let i = 0; i < stmts.length; i += BAR_CHUNK) {
    await db.batch(stmts.slice(i, i + BAR_CHUNK), 'write');
  }
  return rows.length;
}

// Oldest-first, which is the order a chart draws in.
async function readFundamentals(symbol, since) {
  await init();
  const cols = FUND_FIELDS.map(([c]) => c);
  const r = await db.execute({
    sql: `select d, ${cols.join(', ')} from fundamentals_history
          where symbol = ? and d >= ? order by d`,
    args: [String(symbol).toUpperCase(), since || '0000-00-00'],
  });
  return r.rows.map((row) => {
    const out = { d: row.d };
    for (const [c, f] of FUND_FIELDS) out[f] = row[c] == null ? null : Number(row[c]);
    return out;
  });
}

// Today's set beside the previous RECORDED set, which is what the refresh
// report compares. Both in one round trip.
//
// "The previous recorded set" is not "yesterday": a row exists only for days a
// Refresh all actually ran, so after a quiet weekend the comparison reaches
// back further. The caller is given `prevDay` and prints it, because a change
// "since yesterday" that is really since last Thursday would be a lie told by
// omission.
async function readFundamentalsPair(day) {
  await init();
  const cols = FUND_FIELDS.map(([c]) => c);
  const r = await db.execute({
    sql: `select symbol, d, ${cols.join(', ')} from fundamentals_history
          where d = ? or d = (select max(d) from fundamentals_history where d < ?)`,
    args: [day, day],
  });
  const curr = new Map(), prev = new Map();
  let prevDay = null;
  for (const row of r.rows) {
    const out = { symbol: row.symbol };
    for (const [c, f] of FUND_FIELDS) out[f] = row[c] == null ? null : Number(row[c]);
    if (row.d === day) curr.set(row.symbol, out);
    else { prev.set(row.symbol, out); prevDay = row.d; }
  }
  return { day, prevDay, curr, prev };
}

// The fundamentals as they stood ON a past date: for each symbol, the newest
// recorded row on or before it. Genuinely point-in-time — a row exists only for
// days a Refresh all ran, and these values move in steps at earnings, so the
// last recorded set before D is what stood on D rather than an approximation.
// Symbols with nothing recorded by then simply do not appear, and the caller
// decides what to do about that.
async function readFundamentalsAsOf(day) {
  await init();
  const cols = FUND_FIELDS.map(([c]) => c);
  const r = await db.execute({
    sql: `select symbol, d, ${cols.join(', ')} from fundamentals_history
          where d <= ? order by d`,
    args: [day],
  });
  const out = {};
  // Ordered by d ALONE, not (symbol, d): ordering by the primary key makes
  // SQLite walk it as a covering index and ignore the date filter, which is a
  // scan of the whole table. Ascending by d, the last row seen for a symbol is
  // still its newest.
  for (const row of r.rows) {
    const v = { asOf: row.d };
    for (const [c, f] of FUND_FIELDS) v[f] = row[c] == null ? null : Number(row[c]);
    out[row.symbol] = v;
  }
  return out;
}

// Every recorded set through `day`, oldest first, for a caller that needs the
// fundamentals AT SEVERAL DATES — a rebalancing backtest asks "what stood on
// each rebalance day", and readFundamentalsAsOf would re-read the whole table
// for each one. One read, folded forward by the caller: the rows arrive in date
// order, so walking them with a pointer gives every date's set in one pass.
//
// Rows, not a folded map, precisely because the folding is what differs per
// caller. Bounded by universe x recorded days, the same shape the /quality
// rollups are allowlisted for.
async function readFundamentalsRows(through) {
  await init();
  const cols = FUND_FIELDS.map(([c]) => c);
  const r = await db.execute({
    sql: `select symbol, d, ${cols.join(', ')} from fundamentals_history
          where d <= ? order by d`,
    args: [through],
  });
  return r.rows.map((row) => {
    const v = { symbol: row.symbol, d: row.d, asOf: row.d };
    for (const [c, f] of FUND_FIELDS) v[f] = row[c] == null ? null : Number(row[c]);
    return v;
  });
}

// ---- tech_history: the all-technical verdict at weekly marks ---------------
//
// Written by build-tech-history.js for the whole archive and topped up by the
// nightly job. Every field is derived from bars, so this table is rebuildable
// — the opposite of fundamentals_history, and the reason a trend-only backtest
// can reach 2003 while the advice one is capped at two months.

const TECH_COLS = ['action', 'flag', 'trend', 'close', 'vs200', 'vs50', 'rsi', 'm1', 'm3',
  'from_high', 'vol_trend', 'history_days'];

// `opts.timeoutMs` is the deadline on EACH batch, not on the call. The default
// suits a request path; the offline builder sends far larger batches and passes
// its own — see withDeadline above for what the deadline is protecting against.
async function writeTechHistory(rows, opts = {}) {
  await init();
  if (!Array.isArray(rows) || !rows.length) return 0;
  // Reject the empty BEFORE coercing: Number(null) is 0 and isFinite(0) is
  // true, so the other order stores a fabricated zero reading where the engine
  // should see a blank — and blanks satisfy no comparison in either direction,
  // which is load-bearing in these rules.
  const num = (v) => (v == null || !isFinite(Number(v)) ? null : Number(v));
  // MULTI-ROW inserts, not one statement per row. The initial build is ~333,000
  // rows, and a batch of 500 single-row statements measured about 30 seconds —
  // five hours for the table. The cost is per STATEMENT, not per row, so 200
  // rows in one `values (...),(...)` is the same work in a fraction of the
  // round trips. (14 columns x 200 rows = 2,800 bound parameters, well inside
  // SQLite's 32,766 limit; the old 500-row batch of single statements stays
  // the shape for everything else, which writes tens of rows at a time.)
  const PER_STMT = 200;
  const cols = ['symbol', 'd', ...TECH_COLS];
  const tuple = `(${cols.map(() => '?').join(', ')})`;
  const argsFor = (r) => [r.symbol, r.d, r.action || null, r.flag || null, r.trend || null,
    num(r.close), num(r.vs200), num(r.vs50), num(r.rsi), num(r.m1), num(r.m3), num(r.fromHigh),
    num(r.volTrend), num(r.historyDays)];
  const stmts = [];
  for (let i = 0; i < rows.length; i += PER_STMT) {
    const slice = rows.slice(i, i + PER_STMT);
    stmts.push({
      sql: `insert into tech_history (${cols.join(', ')})
            values ${slice.map(() => tuple).join(', ')}
            on conflict(symbol, d) do update set
              ${TECH_COLS.map((c) => `${c} = excluded.${c}`).join(', ')}`,
      args: slice.flatMap(argsFor),
    });
  }
  const ms = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DB_BATCH_TIMEOUT_MS;
  for (let i = 0; i < stmts.length; i += 20) {
    const slice = stmts.slice(i, i + 20);
    await withDeadline(`tech_history write (${slice.length} statements)`, ms,
      () => db.batch(slice, 'write'));
  }
  return rows.length;
}

// One stored mark, as the engine and the sweep expect it. Defined once so the
// range read and the by-date read cannot decode a row differently.
const techMark = (row) => ({
  symbol: row.symbol, d: row.d,
  action: row.action, flag: row.flag, trend: row.trend,
  close: row.close == null ? null : Number(row.close),
  vs200: row.vs200 == null ? null : Number(row.vs200),
  vs50: row.vs50 == null ? null : Number(row.vs50),
  rsi: row.rsi == null ? null : Number(row.rsi),
  m1: row.m1 == null ? null : Number(row.m1),
  m3: row.m3 == null ? null : Number(row.m3),
  fromHigh: row.from_high == null ? null : Number(row.from_high),
  volTrend: row.vol_trend == null ? null : Number(row.vol_trend),
  historyDays: row.history_days == null ? null : Number(row.history_days),
});

// A window of marks across every symbol. ORDERED BY `d` ALONE — ordering by
// the primary key makes SQLite walk it as a covering index and ignore the date
// filter, which is a scan of the whole table. The same trap
// readFundamentalsAsOf records, and query-plan-test.js enforces.
//
// NOTHING ON A REQUEST PATH MAY CALL THIS. It is the shape that cost 181.8
// seconds (see readTechMarksOn below); it is kept for offline work, where a
// range genuinely is what is wanted.
async function readTechMarks(from, to) {
  await init();
  const r = await db.execute({
    sql: `select symbol, d, ${TECH_COLS.join(', ')} from tech_history
          where d >= ? and d <= ? order by d`,
    args: [from, to],
  });
  return r.rows.map(techMark);
}

// Exactly the dates asked for, and only the columns the caller will read.
//
// WHY IT EXISTS, measured against production on 2026-09-20: the trend sweep
// read the whole table through readTechMarks and took **181.8 seconds** cold,
// of which the arithmetic was 154ms. The table was 232k rows on its way to
// ~333k, and the documented response wall is about three minutes — so the
// page was days away from simply failing. The sweep lands on one mark a month
// and reads four of the fourteen columns, and asking for that is the whole
// fix: 280 dates against 1,200, four columns against fourteen.
//
// `d in (...)` seeks the date index rather than scanning, which is why the
// list is passed as dates and not as a range. Chunked because an IN list is a
// parameter per date and the sweep's is a few hundred; `read` batches so the
// chunks are one round trip.
const TECH_ON_CHUNK = 300;
// Everything tbSweep touches without a rule set of its own. `flag` and `trend`
// are never read by it at all, at any rule set.
const TECH_SLIM_COLS = ['close', 'action'];
async function readTechMarksOn(dates, slim) {
  await init();
  const want = [...new Set(dates)].sort();
  if (!want.length) return [];
  const cols = slim ? TECH_SLIM_COLS : TECH_COLS;
  const stmts = [];
  for (let i = 0; i < want.length; i += TECH_ON_CHUNK) {
    const slice = want.slice(i, i + TECH_ON_CHUNK);
    stmts.push({
      sql: `select symbol, d, ${cols.join(', ')} from tech_history
            where d in (${slice.map(() => '?').join(', ')})`,
      args: slice,
    });
  }
  const res = await db.batch(stmts, 'read');
  const out = [];
  for (const r of res) for (const row of r.rows) out.push(techMark(row));
  return out;
}

// The newest mark, and NOTHING else. This is the nightly job's "is a mark due"
// test and it runs inside the refresh tail, so it has to be a seek: `max(d)`
// over the date index is a covering-index lookup, 0ms.
//
// It exists because the first version asked techHistorySpan() instead, which
// is a full scan — measured at 14 SECONDS cold against 228k rows, on every
// round of a nightly. That is what broke the 2026-09-19 nightly: the final
// round was recorded, then the tail ran out of time before it could build the
// report or answer the job, so the workflow saw no `done` and failed a run
// whose data was perfectly good.
async function techHistoryLastMark() {
  await init();
  const r = await db.execute('select max(d) as last from tech_history');
  return (r.rows[0] && r.rows[0].last) || null;
}

// What the table holds, for the page's coverage note. NOT for the refresh path
// — this one scans. Two aggregates over an indexed column and a count,
// which is bounded by the table rather than by `bars`.
async function techHistorySpan() {
  await init();
  const r = await db.execute(
    'select count(*) as n, count(distinct symbol) as syms, min(d) as first, max(d) as last from tech_history');
  const row = r.rows[0] || {};
  return { rows: Number(row.n || 0), symbols: Number(row.syms || 0),
    first: row.first || null, last: row.last || null };
}

// How many marks each symbol already holds. Only the BUILDER calls this, to
// resume after a dropped connection — a full rebuild is ~333,000 rows over
// twenty minutes or more, and a write that long across a network will be cut
// at least once. Returns at most one row per symbol.
async function techHistoryCounts() {
  await init();
  const r = await db.execute('select symbol, count(*) as n from tech_history group by symbol');
  const out = {};
  for (const row of r.rows) out[row.symbol] = Number(row.n || 0);
  return out;
}

// The mark calendar, oldest first — the sweep's list of candidate start dates.
// Reads only the date column over the index.
//
// A separate `tech_marks` table was built for this on 2026-09-20 and REMOVED
// the same day. The case for it was a 429.9-second reading of this query —
// which turned out to be contention with a bulk writer saturating the same
// database, not the query. Measured idle, at the table's full 332,883 rows:
// **~250ms here against ~100ms from a dedicated table.** 150ms inside a
// six-second operation does not buy a second copy of state that is already
// derivable, plus a write to keep in step. **Time a query on an IDLE database
// before designing around it.**
async function readTechMarkDates(from) {
  await init();
  const r = await db.execute({
    sql: 'select distinct d from tech_history where d >= ? order by d', args: [from],
  });
  return r.rows.map((row) => row.d);
}

// The first day each symbol was ever recorded. That is all the coverage strip
// needs: what a backtest gets for a date D is every symbol with ANY row on or
// before D (fundamentals are step functions, so the last set before D stands),
// which is cumulative and derivable from these few points alone.
async function readFundamentalsFirstSeen(since) {
  await init();
  // BOUNDED to the window, deliberately. An unbounded `group by symbol` walks
  // the whole table as a covering index, which is fine at 2,000 rows and is
  // ~365,000 a year at 1,000 stocks. Two indexed range reads instead: who was
  // already recorded before the window (they count for every date in it), and
  // when each of the rest first appeared inside it.
  const before = await db.execute({
    sql: 'select distinct symbol from fundamentals_history where d < ?', args: [since],
  });
  // No `group by symbol` here either: it makes SQLite walk the primary key as a
  // covering index and ignore the date filter. Ordered by d over the indexed
  // range, the FIRST row seen for a symbol is its earliest in the window.
  const inside = await db.execute({
    sql: 'select symbol, d from fundamentals_history where d >= ? order by d',
    args: [since],
  });
  const out = {};
  for (const row of before.rows) out[row.symbol] = '0000-00-00';   // before the window
  for (const row of inside.rows) if (!out[row.symbol]) out[row.symbol] = row.d;
  return out;
}

async function fundamentalsStats() {
  await init();
  const r = await db.execute(
    'select count(*) n, count(distinct symbol) syms, count(distinct d) days, min(d) mind, max(d) maxd from fundamentals_history');
  const x = r.rows[0] || {};
  return { rows: Number(x.n || 0), symbols: Number(x.syms || 0), days: Number(x.days || 0),
           from: x.mind || null, to: x.maxd || null };
}

// ---- password reset -------------------------------------------------------

const RESET_TTL_MS = 30 * 60 * 1000;   // long enough to find the mail, short enough to matter
const RESET_MIN_GAP_MS = 60 * 1000;    // one request a minute per account

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// Returns the raw token to put in the link, or null if one was issued moments
// ago — otherwise this endpoint is a way to flood someone's inbox.
async function createReset(userId) {
  await init();
  const now = Date.now();
  const recent = await db.execute({
    sql: 'select max(created_at) as last from password_resets where user_id = ?',
    args: [userId],
  });
  const last = recent.rows[0] && recent.rows[0].last;
  if (last != null && now - Number(last) < RESET_MIN_GAP_MS) return null;

  const token = crypto.randomBytes(32).toString('hex');
  await db.batch([
    // Only the newest link works. An older one still sitting in an inbox is a
    // liability, not a convenience.
    { sql: 'delete from password_resets where user_id = ?', args: [userId] },
    { sql: 'insert into password_resets (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)',
      args: [hashToken(token), userId, now, now + RESET_TTL_MS] },
  ], 'write');
  return token;
}

// Single use: valid tokens are deleted as they are read, so a link cannot be
// replayed even within its lifetime.
async function consumeReset(token) {
  await init();
  const h = hashToken(token);
  const r = await db.execute({
    sql: 'select user_id, expires_at from password_resets where token_hash = ?',
    args: [h],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0];
  await db.execute({ sql: 'delete from password_resets where token_hash = ?', args: [h] });
  if (Number(row.expires_at) < Date.now()) return null;
  return Number(row.user_id);
}

// ---- per-account preferences ----------------------------------------------

async function readPrefs(userKey) {
  await init();
  const r = await db.execute({ sql: 'select data from prefs where user_key = ?', args: [String(userKey)] });
  if (!r.rows.length) return {};
  try {
    return JSON.parse(r.rows[0].data) || {};
  } catch {
    return {};   // a corrupt blob is not worth failing a page load over
  }
}

async function writePrefs(userKey, obj) {
  await init();
  await db.execute({
    sql: `insert into prefs (user_key, data, updated_at) values (?, ?, ?)
          on conflict(user_key) do update set data = excluded.data, updated_at = excluded.updated_at`,
    args: [String(userKey), JSON.stringify(obj || {}), Date.now()],
  });
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

// When the served snapshot was computed, without reading the snapshot itself
// (~1MB). Open screener tabs poll this to know newer prices have landed.
async function snapshotUpdatedAt() {
  await init();
  const r = await db.execute('select updated_at from snapshot where id = 1');
  return r.rows.length ? (r.rows[0].updated_at || null) : null;
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

// ---- activity ---------------------------------------------------------------
// One batch regardless of row count: the client beacon delivers bursts (a
// sorting session arrives as one array), and a batch keeps that one write.
async function logActivity(rows) {
  await init();
  if (!rows || !rows.length) return;
  await db.batch(rows.map((r) => ({
    sql: 'insert into activity (ts, user, kind, detail, ip, ms) values (?, ?, ?, ?, ?, ?)',
    args: [r.ts, r.user ?? null, r.kind, r.detail ?? null, r.ip ?? null,
      Number.isFinite(r.ms) && r.ms >= 0 ? Math.round(r.ms) : null],
  })), 'write');
}

// Aggregated in SQL like the visitor stats — per-user and per-kind rollups
// plus the raw tail, which is what makes the page explorable.
async function readActivityStats(limit = 500) {
  await init();
  const today = new Date().toISOString().slice(0, 10);
  const [agg, users, kinds, recent, timed] = await Promise.all([
    db.execute({
      sql: `select count(*) as total,
                   sum(case when ts like ? then 1 else 0 end) as today_count,
                   count(distinct case when ts like ? then user end) as users_today
            from activity`,
      args: [today + '%', today + '%'],
    }),
    db.execute('select user, count(*) as c, max(ts) as last from activity group by user order by c desc limit 50'),
    db.execute('select kind, count(*) as c from activity group by kind order by c desc'),
    db.execute({ sql: 'select ts, user, kind, detail, ip, ms from activity order by id desc limit ?', args: [limit] }),
    // Every timing, one column, for exact percentiles computed below. A bounded
    // read by the same reasoning as the rollups above: `activity` is pruned to
    // ACTIVITY_KEEP_DAYS (60) and measured at 1,236 rows, so this is thousands
    // rather than the million that made barsMaxDates a quota event. Percentiles
    // are done in JS because SQLite has no percentile function and the
    // alternative is a window query over the same rows.
    db.execute('select kind, ms from activity where ms is not null'),
  ]);
  const a = agg.rows[0] || {};
  return {
    total: Number(a.total || 0),
    todayCount: Number(a.today_count || 0),
    usersToday: Number(a.users_today || 0),
    users: users.rows.map((r) => ({ user: r.user, count: Number(r.c), last: r.last })),
    kinds: kinds.rows.map((r) => ({ kind: r.kind, count: Number(r.c) })),
    entries: recent.rows.map((r) => ({
      ts: r.ts, user: r.user, kind: r.kind, detail: r.detail, ip: r.ip,
      ms: r.ms == null ? null : Number(r.ms),
    })),
    timing: timingByKind(timed.rows),
  };
}

// How long each kind of operation takes. The SUMMARY is the point rather than
// the per-row number: a column of milliseconds down a 500-row tail is not
// something anyone reads, where "chart p95 2.1s" is.
//
// p95 over few observations is noise, so `n` travels beside every figure and
// the page says so. Exact percentiles on the sorted sample — no interpolation,
// no estimator to explain.
function timingByKind(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const ms = Number(r.ms);
    if (!Number.isFinite(ms) || ms < 0) continue;
    if (!by.has(r.kind)) by.set(r.kind, []);
    by.get(r.kind).push(ms);
  }
  const at = (a, p) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
  const out = [];
  for (const [kind, a] of by) {
    a.sort((x, y) => x - y);
    out.push({ kind, n: a.length, median: at(a, 0.5), p95: at(a, 0.95), max: a[a.length - 1] });
  }
  // Slowest first: the reason to open this table is to find what is slow.
  out.sort((x, y) => y.p95 - x.p95);
  return out;
}

// Wipes the log, like clearVisitors — the autoincrement resets too.
async function clearActivity() {
  await init();
  const before = await db.execute('select count(*) as c from activity');
  await db.batch([
    { sql: 'delete from activity', args: [] },
    { sql: "delete from sqlite_sequence where name = 'activity'", args: [] },
  ], 'write');
  return Number(before.rows[0].c || 0);
}

// Rides the refresh, fire-and-forget: this log answers "how is it being
// used lately", so rows past the window are weight, not signal.
async function pruneActivity(days = 60) {
  await init();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  await db.execute({ sql: 'delete from activity where ts < ?', args: [cutoff] });
}

// ---- member portfolios ------------------------------------------------------
// Ordered like the shared portfolios: position is an explicit column because
// the picker renders in saved order and insertion order does not survive the
// round trip.
// ---- column views -----------------------------------------------------------
async function readViews(scope) {
  await init();
  const r = await db.execute({
    sql: 'select id, name, columns from column_views where scope = ? order by position',
    args: [scope],
  });
  return r.rows.map((x) => {
    let columns = [];
    try { columns = JSON.parse(x.columns); } catch { /* an unreadable row is an empty view */ }
    return { id: x.id, name: x.name, columns };
  });
}

// Whole-collection replace per scope, in one batch — the user_portfolios shape.
async function writeViews(scope, views) {
  await init();
  const now = Date.now();
  const stmts = [{ sql: 'delete from column_views where scope = ?', args: [scope] }];
  (views || []).forEach((v, i) => stmts.push({
    sql: 'insert into column_views (id, scope, name, position, columns, updated_at) values (?, ?, ?, ?, ?, ?)',
    args: [v.id, scope, v.name, i, JSON.stringify(v.columns), now],
  }));
  await db.batch(stmts, 'write');
}

async function readScreens() {
  await init();
  const r = await db.execute('select id, name, grp, description, def from screens order by position');
  return r.rows.map((x) => {
    let def = {};
    try { def = JSON.parse(x.def); } catch { /* an unreadable screen has no filters */ }
    return { id: x.id, name: x.name, group: x.grp, description: x.description || '', def };
  });
}

async function writeScreens(list) {
  await init();
  const now = Date.now();
  const stmts = [{ sql: 'delete from screens', args: [] }];
  (list || []).forEach((sc, i) => stmts.push({
    sql: 'insert into screens (id, name, grp, position, description, def, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
    args: [sc.id, sc.name, sc.group, i, sc.description || null, JSON.stringify(sc.def), now],
  }));
  await db.batch(stmts, 'write');
}

async function seedScreensOnce(list) {
  await init();
  const r = await db.execute("select value from app_meta where key = 'screens_seeded'");
  if (r.rows.length) return false;
  const have = await db.execute('select count(*) as n from screens');
  if (!Number(have.rows[0].n)) await writeScreens(list);
  await db.execute({ sql: "insert or replace into app_meta (key, value) values ('screens_seeded', ?)", args: [String(Date.now())] });
  return true;
}

// Writes the starter views once, ever. The marker is what stops them coming
// back after the owner deletes one.
async function seedSharedViewsOnce(views) {
  await init();
  const r = await db.execute("select value from app_meta where key = 'views_seeded'");
  if (r.rows.length) return false;
  const have = await db.execute("select count(*) as n from column_views where scope = 'shared'");
  if (!Number(have.rows[0].n)) await writeViews('shared', views);
  await db.execute({ sql: "insert or replace into app_meta (key, value) values ('views_seeded', ?)", args: [String(Date.now())] });
  return true;
}

async function readUserPortfolios(userKey) {
  await init();
  const r = await db.execute({
    sql: 'select name, symbols from user_themes where user_key = ? order by position',
    args: [userKey],
  });
  const out = {};
  for (const row of r.rows) {
    try { out[row.name] = JSON.parse(row.symbols); } catch { out[row.name] = []; }
  }
  return out;
}

// Whole-collection replace inside one batch — the same semantics every other
// collection write here has, and fine at a ten-portfolio cap.
async function writeUserPortfolios(userKey, map) {
  await init();
  const stmts = [{ sql: 'delete from user_themes where user_key = ?', args: [userKey] }];
  let pos = 0;
  for (const [name, symbols] of Object.entries(map || {})) {
    stmts.push({
      sql: 'insert into user_themes (user_key, name, position, symbols) values (?, ?, ?, ?)',
      args: [userKey, name, pos++, JSON.stringify(symbols)],
    });
  }
  await db.batch(stmts, 'write');
}

// The admin review read: every account's portfolios in one query, attached to
// /api/users by email so /users can show them beside the delete button.
async function listAllUserPortfolios() {
  await init();
  const r = await db.execute('select user_key, name, symbols from user_themes order by user_key, position');
  return r.rows.map((row) => {
    let symbols = [];
    try { symbols = JSON.parse(row.symbols); } catch { /* leave empty */ }
    return { user: row.user_key, name: row.name, symbols };
  });
}

// A dropped ticker leaves member portfolios too. Reads also filter to the
// live universe, so this is hygiene rather than correctness — but a stored
// symbol that no longer exists would silently come back if the ticker were
// ever re-added, which is not what anyone meant by their saved list.
async function removeSymbolFromUserPortfolios(symbol) {
  await init();
  const sym = String(symbol).toUpperCase();
  const r = await db.execute('select user_key, name, symbols from user_themes');
  let touched = 0;
  for (const row of r.rows) {
    let arr;
    try { arr = JSON.parse(row.symbols); } catch { continue; }
    if (!Array.isArray(arr) || !arr.includes(sym)) continue;
    await db.execute({
      sql: 'update user_themes set symbols = ? where user_key = ? and name = ?',
      args: [JSON.stringify(arr.filter((x) => x !== sym)), row.user_key, row.name],
    });
    touched++;
  }
  return touched;
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

async function createUser({ email, passwordHash, salt, role, status = 'active' }) {
  await init();
  await db.execute({
    sql: `insert into users (email, password_hash, salt, role, created_at, status)
          values (?, ?, ?, ?, ?, ?)`,
    args: [String(email).trim().toLowerCase(), passwordHash, salt, role, new Date().toISOString(), status],
  });
  return findUserByEmail(email);
}

// Approval flips pending to active; the route sends the welcome on success.
async function approveUser(id) {
  await init();
  const r = await db.execute({ sql: 'select email, status from users where id = ?', args: [id] });
  if (!r.rows.length) return null;
  await db.execute({ sql: "update users set status = 'active' where id = ?", args: [id] });
  return { email: r.rows[0].email, wasPending: r.rows[0].status === 'pending' };
}

// Includes enough for a maintenance screen to be useful: who is actually
// signed in somewhere, when they last did, and whether an account is locked
// out after failed sign-ins.
async function listUsers() {
  await init();
  const r = await db.execute({
    sql: `select u.id, u.email, u.role, u.created_at, u.locked_until, u.status,
                 (select count(*) from sessions s
                   where s.user_id = u.id and s.expires_at > ?) as active,
                 (select max(s.created_at) from sessions s where s.user_id = u.id) as last_seen
            from users u order by u.created_at`,
    args: [Date.now()],
  });
  return r.rows.map((u) => ({
    id: Number(u.id),
    email: u.email,
    role: u.role,
    status: u.status || 'active',
    createdAt: u.created_at,
    activeSessions: Number(u.active || 0),
    lastSignIn: u.last_seen || null,
    lockedUntil: u.locked_until != null && Number(u.locked_until) > Date.now()
      ? Number(u.locked_until) : null,
  }));
}

// Everything belonging to the account goes, not just the row. prefs and
// chat_usage are keyed on email rather than user id, so without this a new
// account registered at the same address would inherit the old one's saved
// column layout and its chat quota for the day.
async function deleteUser(id) {
  await init();
  const r = await db.execute({ sql: 'select email from users where id = ?', args: [id] });
  const email = r.rows.length ? r.rows[0].email : null;
  const stmts = [
    { sql: 'delete from sessions where user_id = ?', args: [id] },
    { sql: 'delete from users where id = ?', args: [id] },
  ];
  if (email) {
    stmts.push({ sql: 'delete from prefs where user_key = ?', args: [email] });
    stmts.push({ sql: 'delete from chat_usage where user_key = ?', args: [email] });
    stmts.push({ sql: 'delete from user_themes where user_key = ?', args: [email] });
    stmts.push({ sql: 'delete from column_views where scope = ?', args: [email] });
  }
  await db.batch(stmts, 'write');
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
          where s.token = ? and u.status <> 'pending'`,
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

// ---- news ------------------------------------------------------------------
// writeNews replaces a symbol's stored headlines wholesale (they arrive as a
// full de-duplicated set from the provider) and stamps the fetch clock in the
// same batch, then prunes anything older than keepDays. One batch, so a
// half-written set cannot survive a failure.
// Returns { added, stored }: how many of these headlines were not already
// held for the symbol, and how many it holds afterwards. The first and last
// statements of the same batch read both, so the log costs no extra trip.
// HEADLINES ACCUMULATE; they are not replaced.
//
// This used to `delete from news where symbol = ?` before inserting — the
// whole-collection-replace pattern that is right for portfolios and profiles,
// where the stored set IS the source of truth. A news feed is not that: Google
// News RSS serves a rolling window of the last day or two, so replacing meant
// each fetch threw away everything older than the provider currently happened
// to be carrying. Measured before the change: NVDA, MU and AAPL each held 12
// items spanning ONE OR TWO DAYS, against a nominal 21-day window and a
// 25-item cap that could therefore never bind.
//
// The id is a hash of the url, so `insert or replace` already dedupes an item
// the feed keeps serving. Two trims bound the table instead of the wipe: the
// date cutoff that was always here, and a newest-N cap — needed now because
// MAX_PER_SYMBOL was only ever applied to the incoming batch, and over three
// weeks a stored set would otherwise drift past it.
async function writeNews(symbol, items, keepDays = 21, keepMax = 25) {
  await init();
  const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString();
  const idOf = (x) => crypto.createHash('sha256').update(x.url).digest('hex').slice(0, 32);
  const stmts = [
    { sql: 'select id from news where symbol = ?', args: [symbol] },
    ...items.map((x) => ({
      sql: 'insert or replace into news (id, symbol, published_at, source, headline, url) values (?, ?, ?, ?, ?, ?)',
      args: [idOf(x), symbol, x.published_at, x.source || null, x.headline, x.url],
    })),
    { sql: 'delete from news where symbol = ? and published_at < ?', args: [symbol, cutoff] },
    // Newest N. Seeks on idx_news_symbol (symbol, published_at) rather than
    // walking the table — the rule this database is metered by.
    { sql: `delete from news where symbol = ? and id not in (
              select id from news where symbol = ? order by published_at desc limit ?)`,
      args: [symbol, symbol, keepMax] },
    { sql: 'insert or replace into news_state (symbol, fetched_at) values (?, ?)', args: [symbol, Date.now()] },
    { sql: 'select count(*) as n from news where symbol = ?', args: [symbol] },
  ];
  const res = await db.batch(stmts, 'write');
  const had = new Set((res[0].rows || []).map((r) => r.id));
  const added = new Set(items.map(idOf).filter((id) => !had.has(id))).size;
  const stored = Number(res[res.length - 1].rows[0].n);
  return { added, stored };
}

// ---- the news job's log ---------------------------------------------------------

// A batch is a dozen fetches with a 6-second timeout each, so one still
// "running" after three minutes did not finish — on serverless that usually
// means the instance was frozen after the response went out.
const NEWS_RUN_ABANDON_MS = 3 * 60 * 1000;

async function startNewsRun({ trigger, actor, refreshRunId, provider, attempted }) {
  await init();
  const r = await db.execute({
    sql: `insert into news_runs (trigger, actor, refresh_run_id, provider, started_at, attempted)
          values (?, ?, ?, ?, ?, ?) returning id`,
    args: [trigger, actor || null, refreshRunId || null, provider || null, Date.now(), attempted || 0],
  });
  return Number(r.rows[0].id);
}

async function noteNewsItem(runId, { symbol, ok, items, added, stored, ms, error }) {
  if (!runId) return;
  await init();
  await db.execute({
    sql: `insert or replace into news_run_items (run_id, symbol, at, ok, items, added, stored, ms, error)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [runId, symbol, Date.now(), ok ? 1 : 0, items ?? null, added ?? null, stored ?? null,
      ms ?? null, error ? String(error).slice(0, 300) : null],
  });
}

async function finishNewsRun(runId, { status, ok, failed, items, added, ms, error }) {
  if (!runId) return;
  await init();
  await db.execute({
    sql: `update news_runs set status = ?, ended_at = ?, ok = ?, failed = ?, items = ?, added = ?, ms = ?,
            error = ? where id = ? and status = 'running'`,
    args: [status, Date.now(), ok || 0, failed || 0, items || 0, added || 0, ms ?? null,
      error ? String(error).slice(0, 300) : null, runId],
  });
}

const NEWS_RUN_COLS = `n.id, n.trigger, n.actor, n.refresh_run_id, n.provider, n.started_at, n.ended_at,
  n.status, n.attempted, n.ok, n.failed, n.items, n.added, n.ms, n.error, r.kind as refresh_kind`;

function newsRunFromRow(x) {
  const num = (v) => (v == null ? null : Number(v));
  return {
    id: Number(x.id), trigger: x.trigger, actor: x.actor || null, refreshRunId: num(x.refresh_run_id),
    refreshKind: x.refresh_kind || null, provider: x.provider || null, startedAt: num(x.started_at),
    endedAt: num(x.ended_at), status: x.status, attempted: num(x.attempted), ok: num(x.ok),
    failed: num(x.failed), items: num(x.items), added: num(x.added), ms: num(x.ms), error: x.error || null,
  };
}

async function sweepNewsAbandoned() {
  await init();
  await db.execute({
    sql: `update news_runs set status = 'abandoned'
          where status = 'running' and started_at < ?`,
    args: [Date.now() - NEWS_RUN_ABANDON_MS],
  });
}

async function readNewsRuns(sinceMs) {
  await sweepNewsAbandoned();
  const r = await db.execute({
    sql: `select ${NEWS_RUN_COLS} from news_runs n left join refresh_runs r on r.id = n.refresh_run_id
          where n.started_at >= ? order by n.started_at desc limit 2000`,
    args: [sinceMs || 0],
  });
  return r.rows.map(newsRunFromRow);
}

async function readNewsRun(id) {
  await sweepNewsAbandoned();
  const r = await db.execute({
    sql: `select ${NEWS_RUN_COLS} from news_runs n left join refresh_runs r on r.id = n.refresh_run_id where n.id = ?`,
    args: [id],
  });
  if (!r.rows.length) return null;
  const run = newsRunFromRow(r.rows[0]);
  const it = await db.execute({
    sql: `select symbol, at, ok, items, added, stored, ms, error from news_run_items
          where run_id = ? order by ok asc, symbol`,
    args: [id],
  });
  const num = (v) => (v == null ? null : Number(v));
  run.symbols = it.rows.map((x) => ({ symbol: x.symbol, at: num(x.at), ok: !!Number(x.ok), items: num(x.items),
    added: num(x.added), stored: num(x.stored), ms: num(x.ms), error: x.error || null }));
  return run;
}

// What the headline archive holds right now, for the page's health strip.
async function newsHoldings() {
  await init();
  const r = await db.batch([
    { sql: 'select count(*) as n, count(distinct symbol) as syms, max(published_at) as newest from news', args: [] },
    { sql: 'select symbol, count(*) as n from news group by symbol', args: [] },
  ], 'read');
  return {
    headlines: Number(r[0].rows[0].n),
    symbolsWithNews: Number(r[0].rows[0].syms),
    newestPublished: r[0].rows[0].newest || null,
    perSymbol: Object.fromEntries(r[1].rows.map((x) => [x.symbol, Number(x.n)])),
  };
}

// 30 days of batches, 14 of per-symbol detail.
async function pruneNewsRuns(runDays = 30, itemDays = 14) {
  await init();
  const now = Date.now();
  await db.batch([
    { sql: 'delete from news_run_items where at < ?', args: [now - itemDays * 86400000] },
    { sql: 'delete from news_run_items where run_id in (select id from news_runs where started_at < ?)',
      args: [now - runDays * 86400000] },
    { sql: 'delete from news_runs where started_at < ?', args: [now - runDays * 86400000] },
  ], 'write');
}

async function readNews(symbol, limit = 12, offset = 0) {
  await init();
  const r = await db.execute({
    sql: `select published_at, source, headline, url from news where symbol = ?
          order by published_at desc limit ? offset ?`,
    args: [symbol, limit, Math.max(0, Number(offset) || 0)],
  });
  return r.rows.map((x) => ({ published_at: x.published_at, source: x.source, headline: x.headline, url: x.url }));
}

// How many headlines are stored for one symbol, so a page can say "10 of 43"
// and know when to stop asking. Bounded by the keep window and seeking on
// idx_news_symbol, so it is a handful of rows rather than a count over the
// table — the distinction this database is metered by.
async function newsCount(symbol) {
  await init();
  const r = await db.execute({
    sql: 'select count(*) n from news where symbol = ?', args: [symbol],
  });
  return Number((r.rows[0] && r.rows[0].n) || 0);
}

// The screener's one-per-symbol read: the newest stored headline everywhere,
// one query, the sparklines pattern.
async function readLatestNews() {
  await init();
  const r = await db.execute(
    `select n.symbol, n.published_at, n.source, n.headline, n.url
     from news n join (select symbol, max(published_at) m from news group by symbol) x
       on n.symbol = x.symbol and n.published_at = x.m
     group by n.symbol`);
  return r.rows.map((x) => ({ symbol: x.symbol, published_at: x.published_at,
    source: x.source, headline: x.headline, url: x.url }));
}

// How many stored headlines each symbol has since a date. The news table is
// pruned to 21 days and 25 items a symbol, so this is a few thousand rows at
// most — the same bounded read the /news-runs rollup makes.
async function newsCountsSince(sinceIso) {
  await init();
  const r = await db.execute({
    sql: 'select symbol, count(*) as n from news where published_at >= ? group by symbol',
    args: [String(sinceIso)],
  });
  return Object.fromEntries(r.rows.map((x) => [x.symbol, Number(x.n)]));
}

// The last stored close strictly before a date, per symbol — the anchor a
// week-to-date or month-to-date move is measured from. One query per anchor;
// ~80ms each for the universe.
// ONE SEEK PER SYMBOL, not a scan (2026-09-15). The first version joined
// against `select symbol, max(d) from bars where d < ? group by symbol`, which
// reads every bar older than the boundary — measured at 748,859 rows for the
// five-year anchor once the archive was deepened, on EVERY refresh round, and
// Turso meters rows read (it sent a quota warning the same evening). Seeking
// per symbol on the (symbol, d) primary key reads one row each: 254 rows and
// 80ms against 748,859 rows and 231ms. Batched, and chunked so a 1,000-symbol
// universe does not build one enormous batch.
const ANCHOR_CHUNK = 250;
async function closesBefore(dates, symbols) {
  await init();
  const syms = [...new Set((symbols || []).map((x) => String(x).toUpperCase()))];
  if (!syms.length || !dates.length) return dates.map(() => ({}));
  const out = dates.map(() => ({}));
  for (let i = 0; i < syms.length; i += ANCHOR_CHUNK) {
    const slice = syms.slice(i, i + ANCHOR_CHUNK);
    const stmts = [];
    for (const before of dates) {
      for (const sym of slice) {
        stmts.push({
          sql: 'select d, close from bars where symbol = ? and d < ? order by d desc limit 1',
          args: [sym, before],
        });
      }
    }
    const res = await db.batch(stmts, 'read');
    let k = 0;
    for (let di = 0; di < dates.length; di++) {
      for (const sym of slice) {
        const row = res[k++].rows[0];
        if (row) out[di][sym] = { d: row.d, close: Number(row.close) };
      }
    }
  }
  return out;
}

// Headlines published since an ISO time, newest first — the ticker's read.
// published_at is stored as an ISO string, so the comparison is lexical.
async function readRecentNews(sinceIso, limit = 600) {
  await init();
  const r = await db.execute({
    sql: `select symbol, published_at, source, headline, url from news
          where published_at >= ? order by published_at desc limit ?`,
    args: [sinceIso, limit],
  });
  return r.rows.map((x) => ({ symbol: x.symbol, published_at: x.published_at,
    source: x.source, headline: x.headline, url: x.url }));
}

async function readNewsState() {
  await init();
  const r = await db.execute('select symbol, fetched_at from news_state');
  return Object.fromEntries(r.rows.map((x) => [x.symbol, Number(x.fetched_at)]));
}

module.exports = {
  db,
  init,
  clearVisitors,
  logActivity,
  readActivityStats,
  clearActivity,
  pruneActivity,
  readUserPortfolios,
  writeUserPortfolios,
  listAllUserPortfolios,
  removeSymbolFromUserPortfolios,
  hashPassword,
  newSalt,
  verifyPassword,
  setPassword,
  setRole,
  countUsers,
  findUserByEmail,
  createUser,
  approveUser,
  listUsers,
  deleteUser,
  noteLoginFailure,
  clearLoginFailures,
  createSession,
  getSessionUser,
  deleteSession,
  readPortfolios,
  readUniverse,
  addToUniverse,
  addManyToUniverse,
  removeFromUniverse,
  writePortfolios,
  readNames,
  readTileConfig,
  readMobileConfig,
  readAdviceState,
  noteAdvice,
  readPromoPresets,
  writePromoPresets,
  writeMobileConfig,
  writeTileConfig,
  readPosts,
  readPost,
  writePost,
  renamePost,
  deletePost,
  readHiddenColumns,
  writeHiddenColumns,
  writeEarnings,
  readEarnings,
  writeNames,
  readShortNames,
  readNamesFull,
  writeShortName,
  markPriced,
  expireOldestProfiles,
  expireProfilesFor,
  tableStats,
  readScreens,
  writeScreens,
  seedScreensOnce,
  readViews,
  writeViews,
  seedSharedViewsOnce,
  snapshotUpdatedAt,
  closesBefore,
  readRecentNews,
  startNewsRun,
  noteNewsItem,
  finishNewsRun,
  readNewsRuns,
  readNewsRun,
  newsHoldings,
  pruneNewsRuns,
  startRun,
  recordSkippedRun,
  noteRound,
  finishRun,
  setRunReport,
  runStatus,
  readRuns,
  readRun,
  pruneRuns,
  writeNasdaqExchange,
  readNasdaqListings,
  nasdaqMeta,
  readProfile,
  readProfiles,
  writeProfiles,
  expireProfiles,
  archiveStats, barsThrough,
  beginRefresh,
  noteRefreshProgress,
  endRefresh,
  readRefreshState,
  readSnapshot,
  writeSnapshot,
  noteChatUse,
  readPrefs,
  writePrefs,
  createReset,
  consumeReset,
  writeFundamentals,
  readFundamentals,
  fundamentalsStats,
  readFundamentalsPair,
  barsMaxDates,
  barsOn,
  upsertBars,
  replaceBarsFor,
  fundamentalsDaysFor,
  // Exported so a caller can report how many round trips a write actually
  // cost, rather than guessing at the chunking.
  BAR_CHUNK,
  readBars,
  readBarsFor,
  purgeSymbol,
  markRefreshPrices, readBarsFullFor, notePricePull, readPriceState, readEarningsDates,
  barsSpan, coverageRollups,
  knownListings,
  readFundamentalsAsOf, readFundamentalsRows,
  readFundamentalsFirstSeen,
  writeTechHistory, readTechMarks, readTechMarksOn, readTechMarkDates,
  techHistorySpan, techHistoryCounts,
  techHistoryLastMark,
  mergeProfileFields,
  writeNews, readNews, newsCount, readLatestNews, readNewsState, newsCountsSince,
  symbolsWithData,
  countSymbolRows,
  SYMBOL_TABLES,
  readCloses,
  readCloseSeries,
  barsStats,
  logVisit,
  readVisitorStats,
};
