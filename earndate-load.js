// Re-estimates every stored next-earnings date that is OURS (flagged
// nextEarningsEstimated) with earndate.js, from the report dates already
// stored in earnings_history. No API calls. A date the provider confirmed is
// never touched.
//
// Dry run by default; --commit writes. Writes only `nextEarningsDate`, through
// mergeProfileFields, so fetched_at and every other field stay as they are.
//
//   node --use-system-ca earndate-load.js [--commit] [--only NFLX,AAPL]
require('dotenv').config();
const store = require('./db.js');
const EarnDate = require('./earndate.js');

const argv = process.argv.slice(2);
const commit = argv.includes('--commit');
const onlyAt = argv.indexOf('--only');
const only = onlyAt >= 0 ? new Set(String(argv[onlyAt + 1] || '').toUpperCase().split(',').filter(Boolean)) : null;

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const [profiles, dates] = await Promise.all([store.readProfiles(), store.readEarningsDates('2000-01-01', today)]);
  const patch = {};
  let estimated = 0, confirmed = 0, noLast = 0, same = 0;
  const byBasis = { year: 0, q91: 0 };
  const sample = [];
  for (const [sym, p] of Object.entries(profiles)) {
    if (only && !only.has(sym)) continue;
    if (!p || !p.nextEarningsDate) continue;
    if (!p.nextEarningsEstimated) { confirmed++; continue; }
    estimated++;
    const last = p.lastEarningsDate;
    if (!last) { noLast++; continue; }
    const est = EarnDate.estimateNext((dates[sym] || []).map((d) => String(d).slice(0, 10)), last);
    if (!est) { noLast++; continue; }
    byBasis[est.basis]++;
    if (est.date === p.nextEarningsDate) { same++; continue; }
    patch[sym] = { nextEarningsDate: est.date };
    if (sample.length < 15 || sym === 'NFLX') sample.push(`${sym} ${p.nextEarningsDate} -> ${est.date}`);
  }
  console.log(`confirmed by the provider (left alone): ${confirmed}`);
  console.log(`estimated: ${estimated} | year-ago basis ${byBasis.year}, +91 basis ${byBasis.q91}, no last report ${noLast}`);
  console.log(`unchanged: ${same} | to change: ${Object.keys(patch).length}`);
  if (sample.length) console.log('  ' + sample.join('\n  '));
  if (!commit) { console.log('\nDry run. --commit to write.'); process.exit(0); }
  const n = await store.mergeProfileFields(patch);
  console.log(`\nwrote ${n} profiles (nextEarningsDate only).`);
  process.exit(0);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
