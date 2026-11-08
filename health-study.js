// Studies over the kept Health history (health-replay.js, health-history.db). The starting point
// for any later Health test: copy a block, change the group, write it up in docs/research.md.
//
//   node --no-warnings health-study.js              # newest build
//   node --no-warnings health-study.js --build 1
//   node --no-warnings health-study.js --rescore    # today's health.js over the stored inputs
//
// Prints, by Health band, the next 21 and 42 sessions against the equal-weight average stock
// (research entry 27) and the equal-weight band basket against SPY (entry 28), before 2020 and
// from 2020. Intervals: moving blocks of three months, 1,000 draws.
const HR = require('./health-replay.js');
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const { build, rows, bench } = HR.load(arg('--build') ? Number(arg('--build')) : null);
if (process.argv.includes('--rescore')) { HR.scoreRows(rows); for (const r of rows) r.h = r.health ? r.health.score : null; }

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const q = (a, p) => { if (!a.length) return null; const v = Float64Array.from(a).sort(); return v[Math.floor(p * (v.length - 1))]; };
const pc = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(2));
function blockCI(vals, reps = 1000, blk = 3) {
  let seed = 4242; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const n = vals.length, out = [];
  if (n < blk) return [null, null];
  for (let b = 0; b < reps; b++) { let s = 0, c = 0; while (c < n) { const st = Math.floor(rnd() * (n - blk + 1)); for (let i = 0; i < blk && c < n; i++, c++) s += vals[st + i]; } out.push(s / n); }
  out.sort((a, b) => a - b); return [out[Math.floor(0.025 * reps)], out[Math.floor(0.975 * reps)]];
}
const ci = (c) => '[' + pc(c[0]) + ', ' + pc(c[1]) + ']';
const ERAS = [['2010–2019', '2010', '2020'], ['2020 on', '2020', '9999']];
const BANDS = [['90+', 90, 101], ['80+', 80, 101], ['70-79', 70, 80], ['50-69', 50, 70], ['<50', 0, 50], ['all', 0, 101]];
const HZ = [['21', 'r21', 'ew21', 'spy21'], ['42', 'r42', 'ew42', 'spy42']];

const scored = rows.filter((r) => r.h != null);
const months = [...new Set(scored.map((r) => r.d))].sort();
const byD = new Map(); for (const r of scored) { if (!byD.has(r.d)) byD.set(r.d, []); byD.get(r.d).push(r); }
console.log(`build ${build}: ${rows.length.toLocaleString()} stock-months, ${scored.length.toLocaleString()} with Health, months ${months[0]} to ${months[months.length - 1]}`);

for (const [h, rk, ek, sk] of HZ) {
  console.log(`\n== ${h} sessions ==   per stock against the average stock (mean · median · p10)   |   band basket against SPY (mean [95%] · median month)`);
  for (const e of ERAS) {
    console.log('  ' + e[0]);
    const ms = months.filter((d) => d >= e[1] && d < e[2] && bench.get(d) && bench.get(d)[sk] != null && bench.get(d)[ek] != null);
    for (const [nm, lo, hi] of BANDS) {
      const ex = [], bk = [];
      for (const d of ms) {
        const a = byD.get(d).filter((r) => r.h >= lo && r.h < hi && r[rk] != null);
        for (const r of a) ex.push(r[rk] - bench.get(d)[ek]);
        if (a.length >= 5) bk.push(mean(a.map((r) => r[rk])) - bench.get(d)[sk]);
      }
      console.log('    ' + nm.padEnd(6) + String(ex.length).padStart(7) + `  ${pc(mean(ex)).padStart(6)} · ${pc(q(ex, 0.5)).padStart(6)} · ${pc(q(ex, 0.1)).padStart(7)}   |   ${pc(mean(bk)).padStart(6)} ${ci(blockCI(bk))} · ${pc(q(bk, 0.5))}`);
    }
  }
}
