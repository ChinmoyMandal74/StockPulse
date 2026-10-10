// Fill or rebuild `drawdown_stats`, the figures behind the screener's
// "Corr. 5Y" and "Median recov." columns.
//
// The server rebuilds a slice a night on its daily check, so every symbol is
// redone about once a week without this. This is for the FIRST fill, which
// would otherwise take a week to cover the universe, and for a rebuild by
// hand after the analysis changes.
//
// Reads five years of closes per symbol from the archive: about 1.6 million
// rows for the whole universe, once. Dry run by default.
//
//   node --use-system-ca drawdown-load.js                  # report, write nothing
//   node --use-system-ca drawdown-load.js --commit
//   node --use-system-ca drawdown-load.js --commit --only NVDA,SPY
require('dotenv').config();
globalThis.ActionRules = require('./private/action.js');
globalThis.Filters = require('./private/filters.js');
require('./private/cards.js');
const Cards = globalThis.Cards;
const store = require('./db.js');
const Drawdowns = require('./drawdowns.js');

const COMMIT = process.argv.includes('--commit');
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > 0 ? String(process.argv[onlyArg + 1] || '').toUpperCase().split(',').filter(Boolean) : null;

(async () => {
  const tally = { withCount: 0, tooShort: 0, noneRecovered: 0, zero: 0 };
  const sample = [];
  const backs = [];
  const r = await Drawdowns.slice(store, Cards, {
    limit: 100000, budgetMs: 30 * 60 * 1000, dry: !COMMIT, only: ONLY,
    onChunk: (rows) => {
      for (const x of rows) {
        if (x.n == null) { tally.tooShort++; continue; }
        tally.withCount++;
        if (x.n === 0) tally.zero++;
        else if (x.medBack == null) tally.noneRecovered++;
        else backs.push(x.medBack);
        if (ONLY || sample.length < 8) sample.push(x);
      }
      process.stdout.write('.');
    },
  });
  console.log('\n' + (COMMIT ? 'written' : 'computed') + ': ' + r.done + ' of ' + r.asked + ' asked (' + r.universe + ' in the universe)');
  console.log('with a count: ' + tally.withCount + ' · under two years of history: ' + tally.tooShort
    + ' · no drawdown of 10%: ' + tally.zero + ' · none recovered yet: ' + tally.noneRecovered);
  backs.sort((a, b) => a - b);
  if (backs.length) console.log('median recovery across stocks: ' + backs[Math.floor(backs.length / 2)] + ' days (p10 '
    + backs[Math.floor(backs.length * 0.1)] + ', p90 ' + backs[Math.floor(backs.length * 0.9)] + ')');
  for (const x of sample) console.log('  ' + x.symbol.padEnd(6) + ' corrections ' + x.n + ' · recovered ' + x.nBack
    + ' · median back ' + (x.medBack == null ? '—' : x.medBack + 'd') + ' · window ' + x.from + ' to ' + x.through);
  if (!COMMIT) console.log('DRY RUN: nothing written. Re-run with --commit.');
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
