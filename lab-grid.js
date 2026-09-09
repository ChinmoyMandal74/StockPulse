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
// Runs against the local SQLite copy (analysis-db.js), never Turso — 144
// parameter sets each needing every symbol's history is exactly the workload
// that pushed a Turso response past its timeout.
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

const GRID = QUICK
  ? { lookback: [5, 10, 20], skip: [0], volWindow: [60], smooth: [1] }
  : {
    lookback: [3, 5, 10, 15, 20, 30],
    skip: [0, 1, 3, 5],
    volWindow: [20, 60, 126],
    smooth: [1, 5],
  };

const FWD = 21;                 // one month forward, the owner's horizon
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

// Bars once, and the forward return once: neither depends on the parameters.
const rows = db.prepare('select symbol, d, close from bars order by symbol, d').all();
const syms = new Map();
for (const r of rows) {
  if (!syms.has(r.symbol)) syms.set(r.symbol, { d: [], c: [] });
  const s = syms.get(r.symbol);
  s.d.push(r.d); s.c.push(Number(r.close));
}
for (const s of syms.values()) {
  s.fwd = s.c.map((c, i) => (i + FWD < s.c.length ? (s.c[i + FWD] - c) / c * 100 : null));
}
console.log(`${rows.length.toLocaleString()} bars, ${syms.size} symbols, ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Volatility depends only on its own window, so compute each once rather than
// once per parameter set — it is the expensive half and there are only three.
const volCache = new Map();
for (const w of GRID.volWindow) {
  const m = new Map();
  for (const [sym, s] of syms) m.set(sym, I.realisedVolSeries(s.c, w));
  volCache.set(w, m);
}
console.log(`volatility cached for windows ${GRID.volWindow.join(', ')}\n`);

// One parameter set: rank within each day, measure excess over that day's
// universe, and report the top decile and the top-minus-bottom-third spread.
function evaluate(p) {
  const vol = volCache.get(p.volWindow);
  const days = new Map();
  for (const [sym, s] of syms) {
    const ret = I.windowReturn(s.c, p.lookback, p.skip);
    const v = vol.get(sym);
    let raw = s.c.map((_, i) =>
      (ret[i] == null || v[i] == null || !(v[i] > 0) ? null : ret[i] / v[i]));
    if (p.smooth > 1) raw = I.ema(raw, p.smooth);
    for (let i = 0; i < s.c.length; i++) {
      if (raw[i] == null || s.fwd[i] == null || s.d[i] < FROM) continue;
      if (!days.has(s.d[i])) days.set(s.d[i], []);
      days.get(s.d[i]).push({ x: raw[i], y: s.fwd[i] });
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
    ...p,
    days: td.length,
    top: { all: stat(td, FROM, '2099'), pre: stat(td, FROM, SPLIT), post: stat(td, SPLIT, '2099') },
    spread: { all: stat(ls, FROM, '2099'), pre: stat(ls, FROM, SPLIT), post: stat(ls, SPLIT, '2099') },
  };
}

const combos = [];
for (const lookback of GRID.lookback) {
  for (const skip of GRID.skip) {
    for (const volWindow of GRID.volWindow) {
      for (const smooth of GRID.smooth) combos.push({ lookback, skip, volWindow, smooth });
    }
  }
}
console.log(`evaluating ${combos.length} parameter sets...`);
const out = [];
for (let i = 0; i < combos.length; i++) {
  out.push(evaluate(combos[i]));
  process.stdout.write(`\r  ${i + 1}/${combos.length}`);
}
console.log('');

const payload = {
  indicator: 'velocity',
  builtAt: new Date().toISOString(),
  horizonDays: FWD,
  from: FROM,
  split: SPLIT,
  symbols: syms.size,
  grid: GRID,
  results: out,
};
fs.writeFileSync(OUT, JSON.stringify(payload));
console.log(`\nwrote ${OUT}  (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

// What the grid found, so a run that produced nothing says so rather than
// leaving it to be discovered in the UI.
const ranked = out.filter((r) => r.top.all).sort((a, b) => b.top.all.t - a.top.all.t);
console.log('strongest settings by top-decile t over the full period:');
console.log(`  ${'lookback skip vol smooth'.padEnd(26)}${'full'.padStart(16)}${'pre-2020'.padStart(16)}${'2020+'.padStart(16)}`);
const cell = (s) => (s ? `${(s.m >= 0 ? '+' : '') + s.m.toFixed(2)}% t${s.t.toFixed(1).padStart(6)}` : '—');
for (const r of ranked.slice(0, 8)) {
  console.log(`  ${String(r.lookback).padStart(5)}${String(r.skip).padStart(6)}${String(r.volWindow).padStart(5)}` +
    `${String(r.smooth).padStart(7)}     ${cell(r.top.all).padStart(15)}${cell(r.top.pre).padStart(16)}${cell(r.top.post).padStart(16)}`);
}
const best = ranked[0];
console.log(`\nbest |t| anywhere on the grid: ${best ? best.top.all.t.toFixed(2) : 'n/a'}` +
  ` — with ${out.length} settings tested, anything under about 3 is what noise looks like.`);
