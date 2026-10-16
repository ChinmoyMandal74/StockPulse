// Bollinger band events against the average stock (research entry 17).
//
// The 20-day band, two standard deviations (RowCard.bands, the arithmetic the
// stock chart and the promo card draw). Three events:
//   lower  a close below the lower band, the first in 21 sessions for that stock
//   upper  a close above the upper band, the same
//   squeeze  the band's width (top to bottom, of the average) at its narrowest
//            in 126 sessions, the first in 21 sessions
// each split by the side of the 200-day average the stock was on.
//
// Entry at the NEXT session's close; held 21 and 42 sessions; compared with the
// equal-weight average of every stock over exactly those sessions. Before 2020
// and from 2020 apart. A t-figure from the monthly means (events in one month
// are not independent). Events within 20 sessions before or 42 after a
// one-day move past x2 or /2 (an unadjusted split, usually) are dropped.
//
// Reads the local copy (analysis-db.js), never Turso.
//   node bands-study.js
const { DatabaseSync } = require('node:sqlite');
require('./private/rowcard.js');
const R = global.RowCard;
const N = 20, K = 2, SQ = 126, GAP = 21, FROM = '2007-01-01';

// ---- the detector, proved on made-up shapes before any sweep ---------------
function events(c) {
  const b = R.bands(c, N, K);
  const s200 = R.sma(c, 200);
  const width = b.mid.map((m, i) => (m ? (b.upper[i] - b.lower[i]) / m : null));
  const out = [];
  const last = { lower: -1e9, upper: -1e9, squeeze: -1e9 };
  for (let i = 0; i < c.length; i++) {
    if (b.mid[i] == null) continue;
    const add = (kind) => { if (i - last[kind] >= GAP) { out.push({ i, kind, above200: s200[i] == null ? null : c[i] > s200[i] }); } last[kind] = i; };
    if (c[i] < b.lower[i]) add('lower');
    if (c[i] > b.upper[i]) add('upper');
    if (i >= SQ + N) {
      let min = Infinity;
      for (let j = i - SQ; j < i; j++) if (width[j] != null && width[j] < min) min = width[j];
      if (width[i] != null && width[i] < min) add('squeeze');
    }
  }
  return out;
}
(function prove() {
  const fail = (m) => { console.error('DETECTOR CHECK FAILED: ' + m); process.exit(1); };
  // A gentle wobble, then a sharp drop: one lower event at the drop, no upper.
  const wob = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 2));
  const drop = wob.concat([90]);
  const e1 = events(drop);
  if (!e1.some((e) => e.kind === 'lower' && e.i === 60)) fail('a sharp drop did not fire "lower"');
  if (e1.some((e) => e.kind === 'upper' && e.i === 60)) fail('a drop fired "upper"');
  // The mirror.
  const e2 = events(wob.concat([110]));
  if (!e2.some((e) => e.kind === 'upper' && e.i === 60)) fail('a sharp rise did not fire "upper"');
  // Counted once: a run of closes below the band is one event, not several.
  const run = wob.concat([90, 85, 80, 75]);
  if (events(run).filter((e) => e.kind === 'lower').length !== 1) fail('a run below the band counted more than once');
  // A squeeze: volatile for 200 sessions, then calm; it must fire, once, after the calm sets in.
  const sq = Array.from({ length: 200 }, (_, i) => 100 + 8 * Math.sin(i / 3)).concat(Array.from({ length: 40 }, (_, i) => 100 + 0.2 * Math.sin(i)));
  const e3 = events(sq).filter((e) => e.kind === 'squeeze');
  // (A wavy spell has narrow points of its own, so an earlier event is allowed;
  // what is required is one within the calm's first few weeks.)
  if (!e3.some((e) => e.i >= 200 && e.i < 225)) fail('a calm after a volatile spell did not fire "squeeze" after it began: ' + JSON.stringify(e3.map((e) => e.i)));
  // Steady volatility fires no squeeze after warm-up beyond noise: a pure sine has a constant band.
  const flatVol = Array.from({ length: 400 }, (_, i) => 100 + 5 * Math.sin(i * 2 * Math.PI / 20));
  if (events(flatVol).filter((e) => e.kind === 'squeeze').length > 2) fail('a constant-volatility series fired repeated squeezes');
  console.log('detector proved on six made-up shapes');
}());

// ---- the sweep ---------------------------------------------------------------
const d = new DatabaseSync(require('path').join(__dirname, 'analysis.db'), { readOnly: true });
const syms = d.prepare('select distinct symbol from bars').all().map((r) => r.symbol);
const q = d.prepare("select d, close from bars where symbol = ? and d >= '2005-06-01' order by d");
const series = [];
for (const s of syms) {
  const rows = q.all(s).filter((r) => r.close > 0);
  if (rows.length >= 260) series.push({ s, d: rows.map((r) => r.d), c: rows.map((r) => r.close) });
}
// The average stock: for each start date, the mean 21- and 42-session return
// over every stock that has both ends. Clean returns only.
const avg = new Map();
const okRet = (r, h) => r != null && isFinite(r) && Math.abs(r) < (h === 21 ? 3 : 4);
for (const x of series) {
  for (let j = 0; j < x.c.length; j++) {
    const o = avg.get(x.d[j]) || { n21: 0, s21: 0, a21: 0, n42: 0, s42: 0 };
    if (j + 21 < x.c.length) { const r = x.c[j + 21] / x.c[j] - 1; if (okRet(r, 21)) { o.n21++; o.s21 += r; o.a21 += Math.abs(r); } }
    if (j + 42 < x.c.length) { const r = x.c[j + 42] / x.c[j] - 1; if (okRet(r, 42)) { o.n42++; o.s42 += r; } }
    avg.set(x.d[j], o);
  }
}
const ev = [];
let dropped = 0;
for (const x of series) {
  const c = x.c;
  const jump = c.map((v, i) => i > 0 && (v / c[i - 1] > 2 || v / c[i - 1] < 0.5));
  for (const e of events(c)) {
    const j = e.i + 1;                                   // entered at the next close
    if (x.d[e.i] < FROM || j + 21 >= c.length) continue;
    let bad = false;
    for (let k = Math.max(1, e.i - 20); k <= Math.min(c.length - 1, j + 42); k++) if (jump[k]) { bad = true; break; }
    if (bad) { dropped++; continue; }
    const r21 = c[j + 21] / c[j] - 1, r42 = j + 42 < c.length ? c[j + 42] / c[j] - 1 : null;
    if (!okRet(r21, 21)) { dropped++; continue; }
    const a = avg.get(x.d[j]);
    if (!a || a.n21 < 50) continue;
    ev.push({ kind: e.kind, above200: e.above200, d: x.d[j], m: x.d[j].slice(0, 7),
      x21: r21 - a.s21 / a.n21, x42: r42 != null && okRet(r42, 42) && a.n42 >= 50 ? r42 - a.s42 / a.n42 : null,
      abs21: Math.abs(r21), avgAbs21: a.a21 / a.n21 });
  }
}

const pct = (v, dp = 2) => (v == null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(100 * v).toFixed(dp) + '%');
const med = (A) => { const s = A.slice().sort((p, q2) => p - q2); return s.length ? s[Math.floor(s.length / 2)] : null; };
const mean = (A) => (A.length ? A.reduce((p, v) => p + v, 0) / A.length : null);
// t from the monthly means: months are the independent unit.
function tOf(list, key) {
  const by = new Map();
  for (const e of list) if (e[key] != null) { const a = by.get(e.m) || []; a.push(e[key]); by.set(e.m, a); }
  const ms = [...by.values()].map(mean);
  if (ms.length < 10) return null;
  const mu = mean(ms), sd = Math.sqrt(ms.reduce((p, v) => p + (v - mu) * (v - mu), 0) / (ms.length - 1));
  return mu / (sd / Math.sqrt(ms.length));
}
const line = (label, L) => {
  const x21 = L.map((e) => e.x21), x42 = L.filter((e) => e.x42 != null).map((e) => e.x42);
  const t21 = tOf(L, 'x21'), t42 = tOf(L, 'x42');
  return '| ' + label + ' | ' + L.length.toLocaleString('en-US') + ' | ' + pct(mean(x21)) + ' / ' + pct(med(x21)) + ' | '
    + Math.round(100 * x21.filter((v) => v > 0).length / Math.max(1, x21.length)) + '% | ' + (t21 == null ? '—' : t21.toFixed(1)) + ' | '
    + pct(mean(x42)) + ' / ' + pct(med(x42)) + ' | ' + (t42 == null ? '—' : t42.toFixed(1)) + ' |';
};
console.log('events', ev.length.toLocaleString('en-US'), '| dropped near split-like jumps or bad prints', dropped.toLocaleString('en-US'), '| stocks', series.length);
console.log('\n| Event | Events | 1 month vs the average stock, mean / median | Beat it | t | 2 months, mean / median | t |');
console.log('|---|---|---|---|---|---|---|');
const PER = [['before 2020', (e) => e.d < '2020-01-01'], ['from 2020', (e) => e.d >= '2020-01-01']];
const GROUPS = [
  ['Lower band, above the 200-day', (e) => e.kind === 'lower' && e.above200 === true],
  ['Lower band, below the 200-day', (e) => e.kind === 'lower' && e.above200 === false],
  ['Upper band, above the 200-day', (e) => e.kind === 'upper' && e.above200 === true],
  ['Upper band, below the 200-day', (e) => e.kind === 'upper' && e.above200 === false],
  ['Squeeze, above the 200-day', (e) => e.kind === 'squeeze' && e.above200 === true],
  ['Squeeze, below the 200-day', (e) => e.kind === 'squeeze' && e.above200 === false],
];
for (const [g, f] of GROUPS) for (const [p, pf] of PER) console.log(line(g + ', ' + p, ev.filter((e) => f(e) && pf(e))));
// The squeeze's own claim: a BIGGER move follows, either way.
console.log('\nSqueeze: size of the next month\'s move, either direction, against the average stock\'s size that month');
for (const [p, pf] of PER) {
  const L = ev.filter((e) => e.kind === 'squeeze' && pf(e));
  const ratio = L.map((e) => e.abs21 / e.avgAbs21);
  console.log('  ' + p + ': events ' + L.length.toLocaleString('en-US') + ', median ratio ' + med(ratio).toFixed(2) + ', mean ' + mean(ratio).toFixed(2)
    + ', share moving more than the average stock ' + Math.round(100 * ratio.filter((v) => v > 1).length / ratio.length) + '%');
}
// For scale: every stock-month on the same terms (the first session of each month).
const base = [];
for (const x of series) { let lm = ''; for (let j = 0; j + 21 < x.c.length; j++) { const m = x.d[j].slice(0, 7); if (m === lm || x.d[j] < FROM) continue; lm = m; const a = avg.get(x.d[j]); const r = x.c[j + 21] / x.c[j] - 1; if (a && okRet(r, 21)) base.push(Math.abs(r) / (a.a21 / a.n21)); } }
console.log('  every stock-month, for scale: median ratio ' + med(base).toFixed(2) + ', share moving more than the average stock ' + Math.round(100 * base.filter((v) => v > 1).length / base.length) + '%');
