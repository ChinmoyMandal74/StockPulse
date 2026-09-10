// Every strategy variant, over every universe, run offline.
//
//   node --no-warnings strategy-runs.js            # rebuild public/strategy-runs.json
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

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const S = require('./public/strategy.js');

const QUICK = process.argv.includes('--quick');
const DB = path.resolve('analysis.db');
const OUT = path.resolve('public/strategy-runs.json');
const FROM = '2008-01-01';

// The knobs that change the RULE. Anything that merely scales the result —
// target volatility, transaction cost — is left to the page.
const GRID = QUICK
  ? { lookback: [252], longOnly: [false, true], sma: [false] }
  : {
    lookback: [21, 63, 126, 252],   // 1, 3, 6, 12 months
    longOnly: [false, true],
    sma: [false, true],             // the 200-day dual-confirmation filter
  };
const FIXED = { skip: 21, volWindow: 60, rebalance: 21, targetVol: 10, maxWeight: 3 };

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
// A gap inside a listed life is carried forward; a symbol simply not listed yet
// stays null and contributes nothing. Without this a single missing print would
// read as a 100% loss and back again.
for (const [, arr] of bySym) {
  let last = null, started = false;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] != null) { last = arr[i]; started = true; }
    else if (started) arr[i] = last;
  }
}
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
    for (const sma of GRID.sma) variants.push({ ...FIXED, lookback, longOnly, sma });
  }
}
console.log(`${variants.length} variants x ${universes.length} universes = ` +
  `${variants.length * universes.length} runs`);

const r4 = (x) => Math.round(x * 1e5) / 1e5;
const hold = {}, runs = [];
let months = null;
let done = 0;
for (const u of universes) {
  const series = seriesFor(u);
  const bh = S.toMonthly(dates, S.buyHold(series, dates), null);
  months = bh.months;
  hold[u.id] = bh.ret.map(r4);
  for (let vi = 0; vi < variants.length; vi++) {
    const res = S.run(series, dates, variants[vi]);
    const m = S.toMonthly(dates, res.ret, res.turnover);
    runs.push({ u: u.id, v: vi, r: m.ret.map(r4), t: m.turn.map(r4) });
    process.stdout.write(`\r  ${++done}/${variants.length * universes.length}`);
  }
}
console.log('');

const payload = {
  builtAt: new Date().toISOString(),
  from: FROM,
  fixed: FIXED,
  months,
  universes: universes.map((u) => ({ id: u.id, label: u.label, n: u.symbols.length })),
  variants,
  hold,
  runs,
};
fs.writeFileSync(OUT, JSON.stringify(payload));
console.log(`\nwrote ${OUT}  (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// What it found, at the defaults, so a run that produced nothing says so here
// rather than leaving it to be discovered in the UI.
const pc = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%');
const label = (v) => `${v.lookback}d${v.longOnly ? ' long-only' : ' long/short'}${v.sma ? ' +200D' : ''}`;
const all = universes[0].id;
const bh = S.summarise(hold[all], null, 0);
console.log(`\nAll (${universes[0].symbols.length} symbols), no costs — buy and hold: ` +
  `${pc(bh.cagr)} a year, max drawdown ${pc(bh.maxDD)}, Sharpe ${bh.sharpe == null ? '—' : bh.sharpe.toFixed(2)}`);
console.log(`\n${'variant'.padEnd(26)}${'CAGR'.padStart(9)}${'Sharpe'.padStart(9)}${'max DD'.padStart(10)}${'vs hold'.padStart(10)}`);
const mine = runs.filter((r) => r.u === all)
  .map((r) => ({ v: variants[r.v], s: S.summarise(r.r, r.t, 0), corr: S.correlation(r.r, hold[all]) }))
  .sort((a, b) => (b.s.sharpe || -9) - (a.s.sharpe || -9));
for (const x of mine.slice(0, 8)) {
  console.log(label(x.v).padEnd(26) + pc(x.s.cagr).padStart(9) +
    (x.s.sharpe == null ? '—' : x.s.sharpe.toFixed(2)).padStart(9) +
    pc(x.s.maxDD).padStart(10) + (x.corr == null ? '—' : x.corr.toFixed(2)).padStart(10));
}
console.log('\nvs hold is the correlation of monthly returns with simply owning the universe.');
