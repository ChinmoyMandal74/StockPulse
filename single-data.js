// Every symbol's daily closes, on one date axis, for /single to run in the browser.
//
//   node --no-warnings single-data.js            # rebuild public/single-closes.json
//   node --no-warnings single-data.js --stats    # report only, write nothing
//
// WHY SHIP THE PRICES RATHER THAN THE RESULTS, which is the opposite of what
// /strategy does. Two reasons, and the first is a correctness one.
//
// The position cap is a NONLINEARITY. /strategy stores runs at a 10% target and
// the page scales them afterwards, which is exact for everything except the cap
// — so raising the target there does not re-apply it, and the published rule's
// 1.0x cap at a 15% target is a setting that page cannot honestly express. It
// binds on 2.2% of stock-days at 10% and 11.7% at 15%, so this is not a corner
// case. Recomputing from prices makes every slider exact.
//
// Second, a single stock is small. One symbol over 5,100 sessions is a
// millisecond; all 116 is a few hundred, which is a debounce rather than a
// build step. That means the detail view and the sweep across every symbol read
// the same numbers from the same code at the same settings — they cannot drift,
// and there is no grid to snap to.
//
// The cost is the payload: ~880 KB gzipped for 436,000 closes, fetched once and
// cached. Deltas rather than prices, because consecutive closes are close
// together and small integers compress — measured at 943 KB as plain numbers
// against 880 KB this way, for the same values.
//
// SCALE is 1e6, and the two cheaper options were measured rather than assumed.
// The archive holds split-adjusted floats, so 115 of 116 symbols carry more
// than two decimals and per-symbol precision buys nothing. Rounding to cents
// corrupts a daily return by up to 5.45 PERCENTAGE POINTS — NVDA's 2007 closes
// are $0.16 after every split since, where a cent is 3% of the price. 4dp costs
// 750 KB and is wrong by at most 0.007 points of CAGR, which is invisible at
// the precision anything is displayed to; 1e6 costs 880 KB and is exact. The
// extra 130 KB buys "the data is not the reason" on a page built to be trusted.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const STATS = process.argv.includes('--stats');
const DB = path.resolve('analysis.db');
const OUT = path.resolve('public/single-closes.json');
const FROM = '2007-01-01';

if (!fs.existsSync(DB)) {
  console.error(`no local copy at ${DB} — run: node --use-system-ca analysis-db.js --full`);
  process.exit(1);
}
const db = new DatabaseSync(DB);
const t0 = Date.now();

const rows = db.prepare('select symbol, d, close from bars where d >= ? order by d, symbol').all(FROM);
const dates = [...new Set(rows.map((r) => r.d))].sort();
const at = new Map(dates.map((d, i) => [d, i]));
const bySym = new Map();
for (const r of rows) {
  if (!bySym.has(r.symbol)) bySym.set(r.symbol, new Array(dates.length).fill(null));
  bySym.get(r.symbol)[at.get(r.d)] = Number(r.close);
}

// Names, so the picker can be searched by company as well as ticker — the same
// affordance the stock page's picker has.
const names = new Map();
try {
  for (const r of db.prepare('select symbol, name from names').all()) names.set(r.symbol, r.name);
} catch { /* names is optional; the picker falls back to the ticker */ }

// Which portfolios hold each symbol, so the sweep can be filtered down to one.
// Faded in particular is the whole point of having a sweep: a rule tested only
// on the winners is not tested.
const groups = new Map();
try {
  const pf = db.prepare(
    'select t.portfolio as name, t.symbol from portfolio_tickers t ' +
    'join portfolios p on p.name = t.portfolio order by p.position, t.position').all();
  for (const r of pf) {
    if (!groups.has(r.symbol)) groups.set(r.symbol, []);
    groups.get(r.symbol).push(r.name);
  }
} catch { /* portfolios are optional here too */ }

// Trimmed to each symbol's own listed life: `i` is where it starts on the shared
// axis, so the years before a listing cost nothing rather than a run of nulls.
// A null INSIDE the span is a missing print and is kept as one — the browser
// decides what to do with it, and /single applies the same bounded carry-forward
// /strategy does, for the reason recorded there (a five-year hole in GPS read as
// zero volatility and blew the position size up by six orders of magnitude).
const SCALE = 1e6;
const closes = {};
let kept = 0, holes = 0;
for (const [sym, arr] of bySym) {
  let lo = arr.findIndex((v) => v != null);
  let hi = arr.length - 1;
  while (hi >= 0 && arr[hi] == null) hi--;
  if (lo < 0 || hi < lo) continue;
  const span = arr.slice(lo, hi + 1);
  let prev = 0;
  const d = span.map((v) => {
    if (v == null) { holes++; return null; }
    const c = Math.round(v * SCALE);
    const step = c - prev;
    prev = c;
    return step;
  });
  closes[sym] = { i: lo, n: span.length, v: d, name: names.get(sym) || sym, p: groups.get(sym) || [] };
  kept += span.length - d.filter((x) => x == null).length;
}

const payload = { builtAt: new Date().toISOString(), from: FROM, scale: SCALE, dates, closes };
const body = JSON.stringify(payload);

console.log(`${rows.length.toLocaleString()} bars, ${Object.keys(closes).length} symbols, ` +
  `${dates.length.toLocaleString()} sessions ${dates[0]} → ${dates[dates.length - 1]}`);
console.log(`${kept.toLocaleString()} closes kept, ${holes.toLocaleString()} missing prints inside a listed life`);

// The shortest histories are the ones that will quietly produce no signal at
// all, so name them here rather than leaving it to be discovered on the page.
const short = Object.entries(closes).map(([s, c]) => ({ s, n: c.n }))
  .sort((a, b) => a.n - b.n).slice(0, 5);
console.log(`shortest: ${short.map((x) => `${x.s} ${x.n}`).join(', ')} ` +
  `— a 252-day lookback plus a 21-day skip needs 273 sessions before a first signal`);

if (STATS) { console.log('\n--stats: nothing written'); process.exit(0); }

fs.writeFileSync(OUT, body);
const gz = require('zlib').gzipSync(Buffer.from(body), { level: 9 }).length;
console.log(`\nwrote ${OUT} (${(body.length / 1024 / 1024).toFixed(2)} MB raw, ` +
  `${(gz / 1024).toFixed(0)} KB gzipped — what the browser downloads) ` +
  `in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
