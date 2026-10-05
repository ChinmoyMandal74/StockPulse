// Does a clustering-aware volatility make Cushion order the downside better?
//
//   node --no-warnings cushion-vol-study.js [--every 5] [--limit N] [--lambda 0.94]
//
// CUSHION IS DISTANCE-TO-EXIT MEASURED IN THE STOCK'S OWN VOLATILITY, and
// today that volatility is a flat 126-session average. The one thing a
// volatility MODEL adds over an average is the thing an average cannot know:
// volatility clusters. A stock that had a shock last week is riskier than its
// 126-day mean says, and a stock quiet for six months is less risky than a
// window still carrying one old shock.
//
// THE QUESTION IS NOT WHETHER VOLATILITY CLUSTERS -- that is textbook and not
// in doubt. It is whether a clustering-aware Cushion SEPARATES THE REALISED
// TAILS any better than today's does. If it does not, the honest outcome is
// to leave Cushion alone and record the measurement, which is what the
// backlog entry this came from says.
//
// THE ESTIMATOR IS EWMA, NOT A FITTED GARCH(1,1), deliberately. EWMA is
// RiskMetrics' lambda = 0.94 recursion -- one line, no maximum-likelihood
// step, and it captures the clustering that matters. GARCH adds mean
// reversion in variance on top; if EWMA buys nothing here, a fitted model
// almost certainly does not either, and this is the cheap way to find out.
//
// PRE-REGISTERED, so this cannot turn into a fishing trip. The test is:
// inside a tier, split at the MEDIAN cushion and take p10(thick) - p10(thin).
// A positive gap means the measure orders the downside correctly -- a thicker
// cushion really does come with a shallower bad case. The better estimator is
// the one with the bigger gap, IN MOST CELLS, not in the one that is quoted.
// Both horizons, three eras, every tier printed.
//
// It reuses the REAL engine (Action.evaluate, Action.exitDistance) and the
// REAL row builder (techrow.js) against the local analysis copy. A row with
// no fundamentals classifies as ETF and the ETF list IS the technical
// skeleton, which is what action-backtest.js relies on too.
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const Action = require('./private/action.js');
const TechRow = require('./techrow.js');

const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const DB = path.resolve(argOf('--db', 'analysis.db'));
const FROM = '2008-01-01';
const EVERY = Number(argOf('--every', 5));       // subsample: overlapping days carry little extra
const LIMIT = Number(argOf('--limit', 0));       // symbols, for a trial run
const LAMBDA = Number(argOf('--lambda', 0.94));
const SEED_N = 126;                              // the window today's Cushion uses

const { cfg } = Action.resolve(null, 'Balanced');
cfg.__resolved = true;

// --- the two estimators, both annualised percent, both on LOG returns ------
// TRAILING is byte-for-byte what barmath.realisedVol does, so "today's
// Cushion" in this study really is today's.
function volSeries(closes) {
  const n = closes.length;
  const r = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const a = closes[i - 1], b = closes[i];
    r[i] = a > 0 && b > 0 ? Math.log(b / a) : null;
  }
  const trail = new Array(n).fill(null);
  const ewma = new Array(n).fill(null);
  let s2 = null;
  for (let i = 1; i < n; i++) {
    // trailing: sample variance of the last SEED_N returns
    if (i >= SEED_N) {
      let s = 0, m = 0, k = 0;
      for (let j = i - SEED_N + 1; j <= i; j++) if (r[j] != null) { m += r[j]; k++; }
      if (k >= 20) {
        m /= k;
        for (let j = i - SEED_N + 1; j <= i; j++) if (r[j] != null) s += (r[j] - m) ** 2;
        trail[i] = Math.sqrt((s / (k - 1)) * 252) * 100;
      }
    }
    // EWMA: seeded from the same window, then recursive. RiskMetrics assumes
    // a zero mean and uses r^2 rather than deviations.
    if (r[i] != null) {
      if (s2 == null && i >= SEED_N) {
        let s = 0, k = 0;
        for (let j = i - SEED_N + 1; j <= i; j++) if (r[j] != null) { s += r[j] * r[j]; k++; }
        if (k >= 20) s2 = s / k;
      } else if (s2 != null) {
        s2 = LAMBDA * s2 + (1 - LAMBDA) * r[i] * r[i];
      }
    }
    if (s2 != null) ewma[i] = Math.sqrt(s2 * 252) * 100;
  }
  return { trail, ewma };
}

const db = new DatabaseSync(DB);
let syms = db.prepare('select distinct symbol from bars order by symbol').all().map((r) => r.symbol);
if (LIMIT) syms = syms.slice(0, LIMIT);
console.log('cushion: trailing ' + SEED_N + 'd vs EWMA lambda=' + LAMBDA
  + '   every ' + EVERY + 'th session   ' + syms.length + ' symbols\n');

const HZ = [21, 63];
const rowsOut = [];          // { action, era, ct, ce, f21, f63 }
let days = 0, bothOk = 0;
const t0 = Date.now();

for (const sym of syms) {
  const b = db.prepare('select d, high, close, volume from bars where symbol = ? and d >= ? order by d')
    .all(sym, '2006-01-01');
  if (b.length < 400) continue;
  const dates = b.map((r) => r.d);
  const closes = b.map((r) => Number(r.close));
  const highs = b.map((r) => Number(r.high) || Number(r.close));
  const vols = b.map((r) => Number(r.volume) || 0);
  const rsi = TechRow.rsiSeries(closes);
  const { trail, ewma } = volSeries(closes);

  for (let i = TechRow.MIN_SESSIONS; i < closes.length; i += EVERY) {
    if (dates[i] < FROM) continue;
    const tech = TechRow.rowAt(closes, highs, vols, i);
    if (!tech) continue;
    const row = { symbol: sym, ...tech, rsi: rsi[i] };
    const r = Action.evaluate(row, cfg);
    days++;
    const vt = trail[i], ve = ewma[i];
    if (!(vt > 0) || !(ve > 0)) continue;
    // The SAME distance for both: only the denominator differs, which is what
    // makes this a test of the estimator rather than of two different ideas.
    const risk = Action.exitDistance({
      v200: row.vs200ma, v50: row.vs50ma, rsi: row.rsi,
      m1: row.oneMonthPct, m3: row.threeMonthPct, fh: row.pctFromHigh,
      vol: row.volTrend, hist: row.historyDays,
    }, cfg);
    if (!risk || risk.drop == null) continue;
    const f21 = i + 21 < closes.length ? closes[i + 21] / closes[i] - 1 : null;
    const f63 = i + 63 < closes.length ? closes[i + 63] / closes[i] - 1 : null;
    if (f21 == null && f63 == null) continue;
    bothOk++;
    rowsOut.push({
      action: r.action,
      era: dates[i] < '2020-01-01' ? 'pre2020' : 'post2020',
      ct: risk.drop / (vt / Math.sqrt(12)),
      ce: risk.drop / (ve / Math.sqrt(12)),
      f21, f63,
    });
  }
}
console.log('scored ' + days.toLocaleString() + ' stock-days, '
  + bothOk.toLocaleString() + ' with both cushions and a forward return   ('
  + ((Date.now() - t0) / 1000).toFixed(0) + 's)\n');

const q = (a, p) => { const v = a.slice().sort((x, y) => x - y); return v.length ? v[Math.floor(p * (v.length - 1))] : null; };
const pc = (v) => (v == null ? '    —' : ((v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%').padStart(6));
const med = (a) => q(a, 0.5);

// --- how different are the two rankings at all? ----------------------------
// IF THEY RANK THE SAME, NOTHING DOWNSTREAM CAN DIFFER, and that is the first
// thing to know rather than the last.
function spearman(a, b) {
  const n = a.length;
  const rank = (v) => {
    const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[idx[i][1]] = i;
    return out;
  };
  const ra = rank(a), rb = rank(b);
  let s = 0;
  for (let i = 0; i < n; i++) s += (ra[i] - rb[i]) ** 2;
  return 1 - (6 * s) / (n * (n * n - 1));
}
const SAMPLE = rowsOut.length > 200000
  ? rowsOut.filter((_, i) => i % Math.ceil(rowsOut.length / 200000) === 0) : rowsOut;
console.log('agreement between the two cushions (Spearman, n=' + SAMPLE.length.toLocaleString() + '): '
  + spearman(SAMPLE.map((x) => x.ct), SAMPLE.map((x) => x.ce)).toFixed(4));
// THE DIRECTLY RELEVANT DISAGREEMENT: the test splits each tier at the
// median, so what matters is how often the two estimators put a stock-day on
// DIFFERENT SIDES of that line. Spearman over the whole range can look low
// while the median split is identical, and vice versa.
{
  const live = rowsOut.filter((x) => x.ct > 0);
  const kt = med(live.map((x) => x.ct)), ke = med(live.map((x) => x.ce));
  const flip = live.filter((x) => (x.ct >= kt) !== (x.ce >= ke)).length;
  console.log('stock-days the two put on DIFFERENT sides of the median: '
    + flip.toLocaleString() + ' of ' + live.length.toLocaleString()
    + '  (' + ((100 * flip) / live.length).toFixed(1) + '% of those with a cushion above zero)');
}


// --- the pre-registered test ------------------------------------------------
const ERAS = ['all', 'pre2020', 'post2020'];
const TIERS = Action.ACTIONS.slice().reverse();
const wins = { ewma: 0, trail: 0, tie: 0 };

for (const era of ERAS) {
  const pool = rowsOut.filter((x) => era === 'all' || x.era === era);
  console.log('\n' + (era === 'all' ? 'ALL YEARS' : era === 'pre2020'
    ? 'PRE-2020 — the half where every finding here has gone to die' : '2020 ONWARD'));
  console.log('  tier'.padEnd(20) + 'obs'.padStart(9) + '~indep'.padStart(8)
    + '  |  1M  gap(trail)'.padStart(20) + ' gap(ewma)'.padStart(11) + '  better'.padStart(9)
    + '  |  3M  gap(trail)'.padStart(20) + ' gap(ewma)'.padStart(11) + '  better'.padStart(9));
  for (const tier of TIERS) {
    const t = pool.filter((x) => x.action === tier);
    if (t.length < 400) continue;
    const line = [];
    for (const h of HZ) {
      const key = h === 21 ? 'f21' : 'f63';
      const got = t.filter((x) => x[key] != null);
      if (got.length < 400) { line.push(['    —', '    —', '   —']); continue; }
      const out = {};
      let degenerate = false;
      for (const m of ['ct', 'ce']) {
        const cut = med(got.map((x) => x[m]));
        const thick = got.filter((x) => x[m] >= cut).map((x) => x[key]);
        const thin = got.filter((x) => x[m] < cut).map((x) => x[key]);
        // A DEGENERATE SPLIT IS NOT A GAP. In Avoid and Sell Immediately the
        // technicals are ALREADY at or past the exit, so exitDistance returns
        // a drop of 0 and every cushion in the tier is 0 -- the median split
        // then puts everyone on the thick side and nobody on the thin one.
        // The first run of this script printed p10(everyone) as the gap for
        // those two tiers, which is how both estimators came out BYTE
        // IDENTICAL there and why that was worth looking at rather than
        // reading as agreement.
        if (thin.length < 100 || thick.length < 100) { degenerate = true; break; }
        out[m] = q(thick, 0.1) - q(thin, 0.1);     // >0 == orders the tail correctly
      }
      if (degenerate) { line.push(['  flat', '  flat', '   —']); continue; }
      // A WINNER NEEDS A MARGIN. Two estimators that agree to a tenth of a
      // point have not been told apart by 18 years of data.
      const d = out.ce - out.ct;
      const better = Math.abs(d) < 0.001 ? '   =' : (d > 0 ? 'ewma' : 'trail');
      if (tier === 'Strong Buy' || tier === 'Buy') {
        if (better === 'ewma') wins.ewma++; else if (better === 'trail') wins.trail++; else wins.tie++;
      }
      line.push([pc(out.ct), pc(out.ce), better.padStart(6)]);
    }
    console.log('  ' + tier.padEnd(18) + t.length.toLocaleString().padStart(9)
      + Math.round(t.length / 63).toLocaleString().padStart(8)
      + '  |' + line[0][0].padStart(13) + line[0][1].padStart(11) + line[0][2].padStart(9)
      + '  |' + line[1][0].padStart(13) + line[1][1].padStart(11) + line[1][2].padStart(9));
  }
}

console.log('\nGAP = p10(thick cushion half) - p10(thin half). POSITIVE means the measure');
console.log('orders the downside correctly: a thicker cushion really does come with a');
console.log('shallower bad case. The better estimator is the one with the BIGGER gap.');
console.log('\nAcross the Strong Buy and Buy cells (2 tiers x 2 horizons x 3 eras = 12): '
  + 'ewma better in ' + wins.ewma + ', trailing better in ' + wins.trail
  + ', indistinguishable in ' + wins.tie + '.');
console.log('\nSurvivorship: ' + syms.length + ' symbols that all still trade, no bankruptcies,');
console.log('and daily observations of an N-day return overlap heavily — the ~indep column');
console.log('divides by the horizon, the same discount every study here applies.');
