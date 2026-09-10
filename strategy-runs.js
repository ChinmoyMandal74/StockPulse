// Every strategy variant, over every universe, run offline.
//
//   node --no-warnings strategy-runs.js            # rebuild private/strategy-*.json
//   node --no-warnings strategy-runs.js --quick    # a couple of variants, for a smoke test
//
// A backtest across 116 symbols and 4,700 sessions cannot run in the browser
// (that is ~30 MB of bars) or per request on Vercel (reading every bar is the
// 82-second query). So it runs here, against the local SQLite copy, and the page
// gets the results.
//
// WHAT IS SHIPPED IS DELIBERATELY NOT FINISHED STATISTICS. Each run stores its
// MONTHLY returns and monthly turnover, and the page computes the equity curve,
// Sharpe, drawdown and the rest itself. That is what makes transaction cost and
// target volatility into sliders rather than assumptions: cost is charged
// against real turnover, and vol scaling is linear in the returns, so both can
// be applied after the fact. For a rule rebalancing monthly across a hundred
// names, cost is frequently the difference between a positive and a negative
// result and has no business being baked in.
//
// Monthly rather than daily is what keeps the file small enough to ship — 225
// months against 4,700 days. A monthly-rebalanced strategy has nothing to say
// between rebalances anyway. The one thing it costs is drawdown resolution: a
// max drawdown measured on month-ends understates the intra-month low, and the
// page says so.
//
// AVERAGE EXPOSURE IS STORED BESIDE THE RETURNS, and it is not decoration. A
// long-only rule with a 200-day filter sits in cash for much of its life, and
// cash pays. Charging it nothing understates the strategy by whatever bills
// yielded, which over the last few years was several points a year. The page
// turns that into a slider for the same reason cost is one: it is an assumption,
// so it should be visible rather than baked in at zero.
//
// ONE FILE PER UNIVERSE, plus an index. The grid is 192 variants now, and
// shipping every universe's copy of it would be a multi-megabyte download to
// look at one entry in a dropdown. The page fetches the index, then a universe.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const S = require('./private/strategy.js');

const QUICK = process.argv.includes('--quick');
const DB = path.resolve('analysis.db');
const OUT = path.resolve('private/strategy-index.json');
const FROM = '2008-01-01';

// The knobs that change the RULE. Anything that merely scales the result —
// target volatility, transaction cost, the yield on idle cash — is left to the
// page, because those are assumptions rather than rules and belong on a dial.
const GRID = QUICK
  ? { lookback: [252], longOnly: [false, true], sma: [false], maxWeight: [3], rebalance: [21], volWindow: [60] }
  : {
    lookback: [21, 63, 126, 252],   // 1, 3, 6, 12 months
    longOnly: [false, true],
    sma: [false, true],             // the 200-day dual-confirmation filter
    // A cap of 1 is the published long-only formulation: vol targeting may only
    // size a position DOWN, and the alternative to a full position is cash, not
    // leverage. 3 lets the sizing lever a quiet name up, which is where a good
    // deal of the vol-targeting literature's extra return actually comes from.
    maxWeight: [1, 3],
    // Daily is what the research specifies; monthly is what the turnover can
    // bear. Both are here so the trade can be read off rather than argued about.
    rebalance: [1, 5, 21],
    // 20 sessions reacts to a vol spike within a fortnight; 60 barely notices it.
    volWindow: [20, 60],
  };
const FIXED = { skip: 21, targetVol: 10 };

if (!fs.existsSync(DB)) {
  console.error(`no local copy at ${DB} — run: node --use-system-ca analysis-db.js --full`);
  process.exit(1);
}
const db = new DatabaseSync(DB);
const t0 = Date.now();

// Every symbol on ONE date axis. Strategy.run() requires this and refuses to
// align internally, because a portfolio built from misaligned series is wrong
// in a way nothing would report.
const rows = db.prepare('select symbol, d, close from bars where d >= ? order by d, symbol').all(FROM);
const dates = [...new Set(rows.map((r) => r.d))].sort();
const at = new Map(dates.map((d, i) => [d, i]));
const bySym = new Map();
for (const r of rows) {
  if (!bySym.has(r.symbol)) bySym.set(r.symbol, new Array(dates.length).fill(null));
  bySym.get(r.symbol)[at.get(r.d)] = Number(r.close);
}
// A SHORT gap inside a listed life is carried forward; a symbol not listed yet,
// and a hole longer than MAX_CARRY, stay null and contribute nothing. Without
// any carry a single missing print reads as a 100% loss and back again. Without
// the bound, GPS — which has a 1,373-session hole between 2019-11 and 2025-03 —
// was held flat at $16.78 for five and a half years: realised volatility of
// exactly zero, so the position was sized at the leverage cap, earned nothing
// for the whole stretch, and then booked the entire re-listing as a single
// +33% day. A hole is absent data, not a quiet stock.
//
// 10 is chosen to clear a foreign listing's holiday calendar and nothing more:
// 005930 (Samsung) legitimately misses up to 6 consecutive US sessions over
// Chuseok, and it is the only other symbol in the archive with a gap over one.
const MAX_CARRY = 10;
let carried = 0, blanked = 0;
for (const [, arr] of bySym) {
  let last = null, run = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] != null) { last = arr[i]; run = 0; continue; }
    if (last == null) continue;                       // not listed yet
    if (++run <= MAX_CARRY) { arr[i] = last; carried++; }
    else { blanked++; }
  }
}
console.log(`gaps: ${carried} sessions carried forward, ${blanked} left blank ` +
  `(holes longer than ${MAX_CARRY} sessions)`);
console.log(`${rows.length.toLocaleString()} bars, ${bySym.size} symbols, ` +
  `${dates.length.toLocaleString()} sessions ${dates[0]} → ${dates[dates.length - 1]}`);

// The universes the page can choose between: everything, plus each portfolio.
// portfolio_tickers keys on the portfolio NAME, not an id — there is no id
// column. Ordered by the portfolios' own position so the dropdown reads in the
// order the screener's tabs do.
const pf = db.prepare(
  'select t.portfolio as name, t.symbol from portfolio_tickers t ' +
  'join portfolios p on p.name = t.portfolio order by p.position, t.position').all();
const groups = new Map();
for (const r of pf) {
  if (!groups.has(r.name)) groups.set(r.name, []);
  if (bySym.has(r.symbol)) groups.get(r.name).push(r.symbol);
}
const universes = [{ id: 'all', label: 'All', symbols: [...bySym.keys()].sort() }];
for (const [name, syms] of groups) {
  if (syms.length) universes.push({ id: name, label: name, symbols: syms.sort() });
}
console.log(`${universes.length} universes: ` +
  universes.map((u) => `${u.label} (${u.symbols.length})`).join(', ') + '\n');

const seriesFor = (u) => u.symbols.map((sym) => ({ symbol: sym, closes: bySym.get(sym) }));

const variants = [];
for (const lookback of GRID.lookback) {
  for (const longOnly of GRID.longOnly) {
    for (const sma of GRID.sma) {
      for (const maxWeight of GRID.maxWeight) {
        for (const rebalance of GRID.rebalance) {
          for (const volWindow of GRID.volWindow) {
            variants.push({ ...FIXED, lookback, longOnly, sma, maxWeight, rebalance, volWindow });
          }
        }
      }
    }
  }
}
console.log(`${variants.length} variants x ${universes.length} universes = ` +
  `${variants.length * universes.length} runs`);

const r4 = (x) => Math.round(x * 1e5) / 1e5;
const r3 = (x) => Math.round(x * 1e4) / 1e4;

// A portfolio name becomes a filename, so it has to survive being one.
// Collisions are resolved rather than left to overwrite each other in silence.
const used = new Set();
function slug(id) {
  const base = String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'u';
  let out = base;
  let i = 2;
  while (used.has(out)) out = `${base}-${i++}`;
  used.add(out);
  return out;
}

const hold = {}, index = [];
let months = null;
let done = 0;
let bytes = 0, biggest = 0;
const total = variants.length * universes.length;
for (const u of universes) {
  const series = seriesFor(u);
  const bh = S.toMonthly(dates, S.buyHold(series, dates), null, null);
  months = bh.months;
  hold[u.id] = bh.ret.map(r4);
  const runs = [];
  for (let vi = 0; vi < variants.length; vi++) {
    const res = S.run(series, dates, variants[vi]);
    const m = S.toMonthly(dates, res.ret, res.turnover, res.exposure);
    // e is average gross exposure over the month, which is what decides how much
    // of the book sat in cash and was therefore earning the cash rate.
    runs.push({ v: vi, r: m.ret.map(r4), t: m.turn.map(r4), e: m.exp.map(r3) });
    process.stdout.write(`\r  ${++done}/${total}`);
  }
  const file = `strategy-u-${slug(u.id)}.json`;
  const body = JSON.stringify({ id: u.id, months, hold: hold[u.id], runs });
  fs.writeFileSync(path.resolve('private', file), body);
  bytes += Buffer.byteLength(body);
  biggest = Math.max(biggest, Buffer.byteLength(body));
  index.push({ id: u.id, label: u.label, n: u.symbols.length, file });
}
console.log('');

const payload = {
  builtAt: new Date().toISOString(),
  from: FROM,
  fixed: FIXED,
  grid: GRID,
  months,
  universes: index,
  variants,
};
fs.writeFileSync(OUT, JSON.stringify(payload));
console.log(`\nwrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB) + ${index.length} ` +
  `universe files (${(bytes / 1024 / 1024).toFixed(1)} MB total, ` +
  `${(biggest / 1024).toFixed(0)} KB the largest — and only one is ever fetched) ` +
  `in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// What it found, at the defaults, so a run that produced nothing says so here
// rather than leaving it to be discovered in the UI.
const pc = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%');
const label = (v) => `${v.lookback}d${v.longOnly ? ' L' : ' L/S'}${v.sma ? ' +200D' : ''}` +
  ` ${v.maxWeight}x r${v.rebalance} v${v.volWindow}`;
const all = universes[0].id;
const allRuns = JSON.parse(fs.readFileSync(path.resolve('private', index[0].file), 'utf-8')).runs;
const bh = S.summarise(hold[all], null, 0);
console.log(`\nAll (${universes[0].symbols.length} symbols), no costs — buy and hold: ` +
  `${pc(bh.cagr)} a year, max drawdown ${pc(bh.maxDD)}, Sharpe ${bh.sharpe == null ? '—' : bh.sharpe.toFixed(2)}`);
console.log(`\n${'variant (top 8 by Sharpe)'.padEnd(26)}${'CAGR'.padStart(9)}${'Sharpe'.padStart(9)}${'max DD'.padStart(10)}${'vs hold'.padStart(10)}`);
const mine = allRuns
  .map((r) => ({ v: variants[r.v], s: S.summarise(r.r, r.t, 0), corr: S.correlation(r.r, hold[all]) }))
  .sort((a, b) => (b.s.sharpe || -9) - (a.s.sharpe || -9));
for (const x of mine.slice(0, 8)) {
  console.log(label(x.v).padEnd(26) + pc(x.s.cagr).padStart(9) +
    (x.s.sharpe == null ? '—' : x.s.sharpe.toFixed(2)).padStart(9) +
    pc(x.s.maxDD).padStart(10) + (x.corr == null ? '—' : x.corr.toFixed(2)).padStart(10));
}
console.log('\nvs hold is the correlation of monthly returns with simply owning the universe.');
