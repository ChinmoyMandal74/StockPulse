// RowCard.bands (the chart's Bollinger bands, the screener's 200-day z-score)
// and the boundary: the Signal never reads z200.
require('./private/rowcard.js');
require('./private/action.js');
const R = global.RowCard, A = global.ActionRules;
let ran = 0, failed = 0;
const near = (a, b, e = 1e-9) => a != null && b != null && Math.abs(a - b) < e;
const check = (name, ok, extra) => { ran++; if (!ok) { failed++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// By hand: 2, 4, 4, 4, 5, 5, 7, 9 has mean 5 and population s.d. 2.
const v = [2, 4, 4, 4, 5, 5, 7, 9];
const b = R.bands(v, 8, 2);
check('mean', near(b.mid[7], 5), b.mid[7]);
check('upper = mean + 2 s.d.', near(b.upper[7], 9), b.upper[7]);
check('lower = mean - 2 s.d.', near(b.lower[7], 1), b.lower[7]);
check('z of the last close (9 is two s.d. up)', near(b.z[7], 2), b.z[7]);
check('null until the window is full', b.mid.slice(0, 7).every((x) => x === null));
check('same length as the input', b.mid.length === v.length && b.z.length === v.length);
// Rolling: window of 3 over 1..5 -> means 2, 3, 4.
const r = R.bands([1, 2, 3, 4, 5], 3, 1);
check('rolling means', near(r.mid[2], 2) && near(r.mid[3], 3) && near(r.mid[4], 4), r.mid);
check('rolling s.d. sqrt(2/3)', near(r.upper[4] - r.mid[4], Math.sqrt(2 / 3)), r.upper[4] - r.mid[4]);
// A flat run has no spread: no z, band collapses onto the mean.
const f = R.bands([5, 5, 5, 5], 4, 2);
check('flat: z is null, not infinite', f.z[3] === null, f.z[3]);
check('flat: band on the mean', near(f.upper[3], 5) && near(f.lower[3], 5));
// A missing close voids its windows only.
const m = R.bands([1, 2, null, 4, 5, 6, 7], 3, 2);
check('a gap voids the windows that hold it', m.mid[2] === null && m.mid[3] === null && m.mid[4] === null, m.mid);
check('and the next full window is back', near(m.mid[5], 5) && near(m.mid[6], 6), m.mid);
check('NaN treated as missing', R.bands([1, NaN, 3], 3, 2).mid[2] === null);
// Against a two-pass reference on a long random walk (numerical stability at
// the price levels a stock trades at).
let s = 7, p = 900; const walk = [];
for (let i = 0; i < 400; i++) { s = (s * 16807) % 2147483647; p *= Math.exp((s / 2147483647 - 0.5) * 0.04); walk.push(p); }
const W = R.bands(walk, 200, 2);
const win = walk.slice(200, 400), mu = win.reduce((a, x) => a + x, 0) / 200;
const sd = Math.sqrt(win.reduce((a, x) => a + (x - mu) * (x - mu), 0) / 200);
check('200-day z matches a two-pass reference', near(W.z[399], (walk[399] - mu) / sd, 1e-6), [W.z[399], (walk[399] - mu) / sd]);

// THE BOUNDARY. Score real rows with z200 absent, present, and lying.
const snap = require(process.argv[2] || 'C:/Users/manda/AppData/Local/Temp/claude/c--Projects-StockPulse/c7fc780c-cf0d-4735-8592-474159410609/scratchpad/recon-snap.json');
const rows = (snap.stocks || snap).filter((x) => x && x.symbol);
const cfg = undefined;   // the live default, as the server scores
const verdicts = (rs) => {
  const out = A.apply(rs.map((x) => ({ ...x })), cfg);
  return out.map((x) => JSON.stringify(x));
};
const strip = (x) => { const y = { ...x }; delete y.z200; return y; };
const absent = verdicts(rows.map(strip));
const present = verdicts(rows.map((x, i) => ({ ...strip(x), z200: ((i % 9) - 4) / 2 })));
const lying = verdicts(rows.map((x, i) => ({ ...strip(x), z200: i % 2 ? 1e9 : -1e9 })));
check('rows scored', absent.length > 1000, absent.length);
const words = {}; for (const x of absent) { const o = JSON.parse(x); const w = o && (o.action || o.label || (Array.isArray(o) ? o[0] : null)); words[w] = (words[w] || 0) + 1; }
console.log('verdicts:', JSON.stringify(words));
check('verdicts are real, several words', Object.keys(words).filter((k) => k !== 'undefined' && k !== 'null').length >= 3, words);
check('verdicts identical with z200 present', absent.every((x, i) => x === present[i]), absent.findIndex((x, i) => x !== present[i]));
check('verdicts identical with z200 lying', absent.every((x, i) => x === lying[i]), absent.findIndex((x, i) => x !== lying[i]));

console.log(ran + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
