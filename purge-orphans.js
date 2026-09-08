// Remove data for symbols that are in no portfolio.
//
//   node --use-system-ca purge-orphans.js            # dry run
//   node --use-system-ca purge-orphans.js --commit   # delete
//   node --use-system-ca purge-orphans.js --commit --only SPY
//
// Dropping a ticker now purges it as it goes, so this is a sweep for what was
// left behind before that existed — and a safety net for a purge that failed
// mid-edit, which is deliberately non-fatal there.
//
// THIS IS NOT REVERSIBLE FOR ALL OF IT. Bars come back for one API credit at
// any depth and momentum is recomputed from bars, but fundamentals history
// cannot be rebuilt: the API only ever returns today's numbers, so a deleted
// row is gone and re-adding the ticker starts that series from zero. The dry
// run prints exactly what would go, per table, so the trade is visible before
// it is made.

require('dotenv').config();
const store = require('./db.js');

const COMMIT = process.argv.includes('--commit');
const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : '';
};
const ONLY = argOf('--only').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);

// Counted the same way the purge deletes, so the dry run cannot promise one
// thing and the commit do another.
async function countFor(symbol) {
  const rows = {};
  let total = 0;
  for (const table of store.SYMBOL_TABLES) {
    const n = await store.countSymbolRows(table, symbol);
    if (n) rows[table] = n;
    total += n;
  }
  return { rows, total };
}

(async () => {
  const portfolios = await store.readPortfolios();
  const universe = new Set(Object.values(portfolios).flat());
  const stored = await store.symbolsWithData();
  let orphans = stored.filter((s) => !universe.has(s));
  if (ONLY.length) orphans = orphans.filter((s) => ONLY.includes(s));

  console.log(`portfolios hold        : ${universe.size} symbols`);
  console.log(`database holds data for: ${stored.length} symbols`);
  console.log(`orphaned               : ${orphans.length}` +
    (ONLY.length ? ` (filtered to ${ONLY.join(', ')})` : ''));
  console.log(`mode                   : ${COMMIT ? 'COMMIT - this deletes' : 'DRY RUN - nothing will be deleted'}`);
  console.log('');

  if (!orphans.length) {
    console.log('Nothing to do.');
    process.exit(0);
  }

  let grand = 0;
  for (const symbol of orphans) {
    if (COMMIT) {
      const r = await store.purgeSymbol(symbol);
      grand += r.total;
      console.log(`  ${symbol.padEnd(8)} deleted ${String(r.total).padStart(7)} rows  ` +
        Object.entries(r.removed).map(([t, n]) => `${t} ${n}`).join(', '));
    } else {
      const c = await countFor(symbol);
      grand += c.total;
      console.log(`  ${symbol.padEnd(8)} would delete ${String(c.total).padStart(7)} rows  ` +
        (Object.entries(c.rows).map(([t, n]) => `${t} ${n}`).join(', ') || '(none)'));
      if (c.rows.fundamentals_history) {
        console.log(`  ${' '.repeat(8)} ^ ${c.rows.fundamentals_history} of those cannot be rebuilt`);
      }
    }
  }

  console.log(`\n${grand.toLocaleString()} rows ${COMMIT ? 'deleted' : 'would be deleted'} across ${orphans.length} symbols`);
  if (!COMMIT) console.log('Re-run with --commit to delete.');
  process.exit(0);
})();
