// Does the Action model's technical skeleton actually avoid large losses?
//
//   node --no-warnings action-backtest.js [--preset Conservative]
//
// Replays every stock-day since 2008 through the TECHNICAL rules — breakdown,
// downtrend, below-200D, extended, clean entry — and reports what price did
// next, per Action. The fundamentals buckets cannot be replayed: the API only
// ever returns today's numbers and fundamentals_history began on 2026-08-30,
// so this measures the safety rails, not the whole model, and says so.
//
// HOW IT REUSES THE REAL ENGINE rather than reimplementing it: a row carrying
// only technicals classifies as ETF (no Quality, no P/E), and the ETF rule
// list IS the technical skeleton, evaluated by the same evaluate() the site
// runs. One implementation, zero drift.
//
// WHAT TO READ: the 10th-percentile forward return per Action. The owner's
// goal is avoiding large losses, so the question is not whether Buy beats
// Sell on average — it is how bad the bad cases are in each bucket. Daily
// observations of an N-day return overlap heavily; the effective-n column
// divides by the horizon, the same discount every study here applies.
//
// The usual caveats apply and are printed: 93 survivors, no bankruptcies, and
// the technical thresholds came from a brief, not from fitting — which is
// exactly why an honest replay is worth having before anyone trusts a tier.

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const Action = require('./private/action.js');
const TechRow = require('./techrow.js');

const DB = path.resolve('analysis.db');
const FROM = '2008-01-01';
const preset = (() => {
  const i = process.argv.indexOf('--preset');
  return i > 0 ? process.argv[i + 1] : 'Balanced';
})();

const { cfg } = Action.resolve(null, preset);
cfg.__resolved = true;
console.log(`preset: ${preset}   (technical skeleton only — fundamentals cannot be replayed)\n`);

const db = new DatabaseSync(DB);
const syms = db.prepare('select distinct symbol from theme_tickers order by symbol').all()
  .map((r) => r.symbol);

const HORIZONS = [21, 63];
// action -> horizon -> era -> forward returns
const acc = new Map();
const eras = ['all', 'pre2020', 'post2020'];
const bump = (action, h, era, v) => {
  const k = action + '|' + h + '|' + era;
  if (!acc.has(k)) acc.set(k, []);
  acc.get(k).push(v);
};

let days = 0;
for (const sym of syms) {
  // highs and volume as well as closes: the row builder reads the INTRADAY
  // high for the 52-week window and the 20-day average volume for volTrend.
  // This script used to build its own row from closes alone, which reported
  // every stock as nearer its high than the app does and left `distribution`
  // unable to fire in eighteen years. See techrow.js.
  const rows = db.prepare('select d, high, close, volume from bars where symbol = ? and d >= ? order by d')
    .all(sym, '2006-01-01');            // run-up before FROM so the 200D exists at the start
  if (rows.length < 260) continue;
  const dates = rows.map((r) => r.d);
  const closes = rows.map((r) => Number(r.close));
  const highs = rows.map((r) => Number(r.high) || Number(r.close));
  const vols = rows.map((r) => Number(r.volume) || 0);
  const rsi = TechRow.rsiSeries(closes);

  for (let i = TechRow.MIN_SESSIONS; i < closes.length; i++) {
    if (dates[i] < FROM) continue;
    const tech = TechRow.rowAt(closes, highs, vols, i);
    if (!tech) continue;
    const c = closes[i];
    // No fundamentals, no Quality, no P/E -> classify() answers ETF -> the
    // all-technical rules. That is what makes this the real engine, not a fork.
    const row = { symbol: sym, ...tech, rsi: rsi[i] };
    const r = Action.evaluate(row, cfg);
    days++;
    const era = dates[i] < '2020-01-01' ? 'pre2020' : 'post2020';
    for (const h of HORIZONS) {
      if (i + h >= closes.length) continue;
      const fwd = closes[i + h] / c - 1;
      bump(r.action, h, 'all', fwd);
      bump(r.action, h, era, fwd);
    }
  }
}

const q = (a, p) => { const v = a.slice().sort((x, y) => x - y); return v[Math.floor(p * (v.length - 1))]; };
const pc = (v) => (v == null ? '     —' : ((v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%').padStart(6));

for (const era of eras) {
  console.log(era === 'all' ? `ALL YEARS (${FROM} on), ${days.toLocaleString()} stock-days` :
    era === 'pre2020' ? 'PRE-2020 — the half where every finding here has gone to die' : '2020 ONWARD');
  console.log('  action'.padEnd(20) + 'obs'.padStart(9) + '~indep'.padStart(8) +
    ' | 1M med'.padStart(10) + 'p10'.padStart(7) + 'hit'.padStart(6) +
    ' | 3M med'.padStart(10) + 'p10'.padStart(7) + 'hit'.padStart(6));
  for (const action of Action.ACTIONS.slice().reverse()) {
    const a21 = acc.get(action + '|21|' + era) || [];
    const a63 = acc.get(action + '|63|' + era) || [];
    if (!a21.length) continue;
    const hit = (a) => Math.round(100 * a.filter((x) => x > 0).length / a.length) + '%';
    console.log('  ' + action.padEnd(18) + a21.length.toLocaleString().padStart(9) +
      Math.round(a21.length / 21).toLocaleString().padStart(8) +
      ' |' + pc(q(a21, 0.5)).padStart(8) + pc(q(a21, 0.1)).padStart(7) + hit(a21).padStart(6) +
      ' |' + pc(q(a63, 0.5)).padStart(8) + pc(q(a63, 0.1)).padStart(7) + hit(a63).padStart(6));
  }
  console.log('');
}

console.log('Read the p10 columns: the model earns its keep if the bad cases in the Buy tiers');
console.log('are materially shallower than in Avoid/Sell. Survivorship caveat: these 93 all');
console.log('still trade; the names a stop-loss rule would have saved you from most are absent.');
