// The cross-sectional truth for every parameter setting the lab can dial to.
//
//   node --no-warnings lab-grid.js            # rebuild public/lab-grid.json
//   node --no-warnings lab-grid.js --quick    # a coarse grid, for a smoke test
//
// The lab lets you tune an indicator against one stock and watch the statistics
// move, which is a machine for finding patterns that are not there. This is the
// answer to that: for every point on the grid, what the indicator does across
// the WHOLE universe, split at 2020 so a setting that only works after that date
// says so on screen while you are dragging the slider.
//
// Runs against the local SQLite copy (analysis-db.js), never Turso — a couple of
// hundred parameter sets each needing every symbol's history is exactly the
// workload that pushed a Turso response past its timeout.
//
// This calls Indicators.compute() rather than composing the pieces itself. The
// first version inlined the composition so it could cache volatility across
// parameter sets, which was a second implementation of the indicator — the very
// thing indicators.js exists to prevent, and untenable the moment there were two
// indicators. The caching bought seconds in a script that runs offline.
//
// The output is committed. It is derived data, but it is small, it changes only
// when the archive meaningfully grows, and shipping it as a static file means
// the page costs the server nothing. Re-run it after a backfill; the page prints
// the date it was built so a stale grid is visible rather than silent.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const I = require('./public/indicators.js');

const QUICK = process.argv.includes('--quick');
const DB = path.resolve('analysis.db');
const OUT = path.resolve('public/lab-grid.json');

// One grid per indicator, over the knobs that indicator actually has.
const GRIDS = QUICK ? {
  velocity: { lookback: [5, 20], skip: [0], volWindow: [60], smooth: [1] },
  scoreSlope: { window: [10, 30], skip: [0], smooth: [1] },
  rsi: { period: [14], skip: [0], smooth: [1] },
} : {
  velocity: {
    lookback: [3, 5, 10, 15, 20, 30],
    skip: [0, 1, 3, 5],
    volWindow: [20, 60, 126],
    smooth: [1, 5],
  },
  scoreSlope: {
    window: [5, 10, 20, 30, 45, 60],
    skip: [0, 1, 3, 5],
    smooth: [1, 5],
  },
  rsi: {
    period: [5, 9, 14, 21, 30],
    skip: [0, 1, 3, 5],
    smooth: [1, 5],
  },
};

const MIN_PER_DAY = 20;
const FROM = '2008-01-01';
const SPLIT = '2020-01-01';

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((t, x) => t + (x - m) ** 2, 0) / (a.length - 1)); };

if (!fs.existsSync(DB)) {
  console.error(`no local copy at ${DB} — run: node --use-system-ca analysis-db.js --full`);
  process.exit(1);
}
const db = new DatabaseSync(DB);
const t0 = Date.now();

// Bars and scores once; neither depends on the parameters.
const bars = db.prepare('select symbol, d, close from bars order by symbol, d').all();
const scores = db.prepare('select symbol, d, score from momentum_history where model = 2').all();
const scoreAt = new Map();
for (const r of scores) scoreAt.set(r.symbol + '|' + r.d, Number(r.score));

const syms = new Map();
for (const r of bars) {
  if (!syms.has(r.symbol)) syms.set(r.symbol, { dates: [], closes: [], score: [] });
  const s = syms.get(r.symbol);
  s.dates.push(r.d);
  s.closes.push(Number(r.close));
  // Aligned by lookup, not by position: a symbol has no score until MIN_BARS of
  // run-up, so the two tables do not line up row for row.
  const k = r.symbol + '|' + r.d;
  s.score.push(scoreAt.has(k) ? scoreAt.get(k) : null);
}
// One forward series per horizon, computed once — the parameters do not touch it.
for (const s of syms.values()) {
  s.fwdBy = {};
  for (const h of I.HORIZONS) s.fwdBy[h.days] = I.forwardReturn(s.closes, h.days);
}
console.log(`${bars.length.toLocaleString()} bars, ${scores.length.toLocaleString()} scored rows, ` +
  `${syms.size} symbols, ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

// One parameter set: rank within each day, measure excess over that day's
// universe, and report the top decile and the top-minus-bottom-third spread.
function evaluate(indId, p, FWD) {
  const days = new Map();
  for (const [, s] of syms) {
    const v = I.compute(s, p, indId);
    const fwd = s.fwdBy[FWD];
    for (let i = 0; i < v.length; i++) {
      if (v[i] == null || fwd[i] == null || s.dates[i] < FROM) continue;
      if (!days.has(s.dates[i])) days.set(s.dates[i], []);
      days.get(s.dates[i]).push({ x: v[i], y: fwd[i] });
    }
  }
  const td = [], ls = [];
  for (const [d, list] of days) {
    if (list.length < MIN_PER_DAY) continue;
    const dayMean = mean(list.map((r) => r.y));
    const by = list.sort((a, b) => a.x - b.x);
    const nd = Math.max(1, Math.round(by.length / 10));
    const k = Math.max(1, Math.floor(by.length / 3));
    td.push({ d, v: mean(by.slice(-nd).map((r) => r.y)) - dayMean });
    ls.push({ d, v: mean(by.slice(-k).map((r) => r.y)) - mean(by.slice(0, k).map((r) => r.y)) });
  }
  // Overlapping windows: a 21-day forward return sampled daily repeats 20 of its
  // 21 days, so the honest count is one per window length.
  const stat = (arr, from, to) => {
    const v = arr.filter((r) => r.d >= from && r.d < to).map((r) => r.v);
    if (v.length < FWD * 3) return null;
    const eff = Math.max(1, Math.floor(v.length / FWD));
    const m = mean(v);
    return { m: +m.toFixed(4), t: +(m / (sd(v) / Math.sqrt(eff))).toFixed(2), n: eff };
  };
  return {
    indicator: indId, horizon: FWD, ...p, days: td.length,
    top: { all: stat(td, FROM, '2099'), pre: stat(td, FROM, SPLIT), post: stat(td, SPLIT, '2099') },
    spread: { all: stat(ls, FROM, '2099'), pre: stat(ls, FROM, SPLIT), post: stat(ls, SPLIT, '2099') },
  };
}

const combos = [];
for (const ind of I.INDICATORS) {
  const g = GRIDS[ind.id];
  if (!g) continue;
  const keys = ind.params;
  const walk = (i, acc) => {
    if (i === keys.length) {
      for (const h of I.HORIZONS) combos.push({ ind: ind.id, p: { ...acc }, h: h.days });
      return;
    }
    for (const v of g[keys[i]]) walk(i + 1, { ...acc, [keys[i]]: v });
  };
  walk(0, {});
}
console.log(`evaluating ${combos.length} parameter sets across ${I.INDICATORS.length} indicators...`);
const out = [];
for (let i = 0; i < combos.length; i++) {
  out.push(evaluate(combos[i].ind, combos[i].p, combos[i].h));
  process.stdout.write(`\r  ${i + 1}/${combos.length}`);
}
console.log('');

const payload = {
  builtAt: new Date().toISOString(),
  horizons: I.HORIZONS,
  from: FROM,
  split: SPLIT,
  symbols: syms.size,
  grids: GRIDS,
  results: out,
};
fs.writeFileSync(OUT, JSON.stringify(payload));
console.log(`\nwrote ${OUT}  (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// What the grid found, per indicator, so a run that produced nothing says so
// rather than leaving it to be discovered in the UI.
const cell = (s) => (s ? `${(s.m >= 0 ? '+' : '') + s.m.toFixed(2)}% t${s.t.toFixed(1).padStart(6)}` : '—');
for (const ind of I.INDICATORS) {
  const mine = out.filter((r) => r.indicator === ind.id && r.horizon === 21 && r.top.all);
  if (!mine.length) continue;
  const ranked = [...mine].sort((a, b) => b.top.all.t - a.top.all.t);
  console.log(`\n${ind.label} — strongest by top-decile t, one month forward:`);
  console.log(`  ${'settings'.padEnd(34)}${'full'.padStart(15)}${'pre-2020'.padStart(16)}${'2020+'.padStart(16)}`);
  for (const r of ranked.slice(0, 5)) {
    const desc = ind.params.map((k) => `${k} ${r[k]}`).join(', ');
    console.log(`  ${desc.padEnd(34)}${cell(r.top.all).padStart(15)}${cell(r.top.pre).padStart(16)}${cell(r.top.post).padStart(16)}`);
  }
  const best = Math.max(...mine.map((r) => Math.abs(r.top.all.t)));
  console.log(`  best |t| across ${mine.length} settings: ${best.toFixed(2)}` +
    ` — at that many tests, under about 3 is what noise looks like.`);
}
