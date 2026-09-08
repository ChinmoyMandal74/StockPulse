// One-off backfill of the momentum history, computed from the bar archive.
//
//   node --use-system-ca backfill-momentum.js                 # dry run
//   node --use-system-ca backfill-momentum.js --commit        # write
//   node --use-system-ca backfill-momentum.js --commit --only MU,DELL
//   node --use-system-ca backfill-momentum.js --commit --from 2020-01-01
//   node --use-system-ca backfill-momentum.js --commit --rebuild   # wipe first
//
// No API calls: every value is a pure function of bars already stored, which is
// what makes this table a cache. If the scoring model changes, bump
// MODEL_VERSION in momentum.js and re-run with --rebuild; nothing is lost,
// because nothing here was ever a measurement of its own.
//
// Measured on the live archive: ~0.31 ms per stock-day, so the whole thing —
// about 275,000 rows across 85 symbols — takes a couple of minutes. Recomputing
// each date from scratch is wasteful in principle and irrelevant in practice at
// this size, so the factors are left as the plain implementations the rest of
// the app uses rather than rolling variants that could drift from them.

require('dotenv').config();
const store = require('./db.js');
const M = require('./momentum.js');

const COMMIT = process.argv.includes('--commit');
const REBUILD = process.argv.includes('--rebuild');
const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const ONLY = argOf('--only', '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const FROM = argOf('--from', '');   // only write dates on or after this

(async () => {
  const before = await store.momentumStats(M.MODEL_VERSION);
  console.log(`momentum_history before : ${before.rows.toLocaleString()} rows, ` +
    `${before.symbols} symbols${before.rows ? `, ${before.from} → ${before.to}` : ''}`);
  if (before.stale) {
    console.log(`  ${before.stale.toLocaleString()} rows were written by an older model — ` +
      'use --rebuild so the table holds one scoring regime.');
  }
  console.log(`model version           : ${M.MODEL_VERSION}`);
  console.log(`mode                    : ${COMMIT ? 'COMMIT — this writes' : 'DRY RUN — nothing will be written'}`);
  if (FROM) console.log(`from                    : ${FROM}`);
  console.log('');

  if (REBUILD && COMMIT) {
    await store.clearMomentum();
    console.log('cleared momentum_history\n');
  }

  const all = await store.readSnapshot();
  let symbols = [...new Set(((all && all.stocks) || []).map((s) => s.symbol))];
  if (ONLY.length) symbols = symbols.filter((s) => ONLY.includes(s));
  if (!symbols.length) { console.error('no symbols'); process.exit(1); }

  let written = 0, skipped = 0;
  const t0 = Date.now();

  for (const symbol of symbols) {
    // Newest-first, the shape momentum.js expects. The whole series: this is a
    // one-off, and the deepest symbols are only ~5,000 bars.
    const bars = (await store.readBars(symbol, 6000))
      .map((b) => ({ d: b.datetime, high: b.high, close: b.close }));
    if (bars.length < M.MIN_BARS) {
      console.log(`  ${symbol.padEnd(8)} ${bars.length} bars — too short to score, skipped`);
      skipped++;
      continue;
    }

    const rows = [];
    // offset 0 is today; the last scoreable date is MIN_BARS from the start.
    for (let off = 0; off <= bars.length - M.MIN_BARS; off++) {
      const d = bars[off].d;
      if (FROM && d < FROM) break;          // dates descend, so we are done
      const r = M.scoreBars(bars.slice(off));
      if (!r) continue;
      rows.push({
        symbol, d, model: M.MODEL_VERSION, score: r.score,
        mom121: r.subs.mom121, ret6m: r.subs.ret6m, ret3m: r.subs.ret3m,
        from_high: r.subs.fromHigh, trend: r.subs.trend,
        consistency: r.subs.consistency, revers1m: r.subs.revers1m, rsi: r.subs.rsi,
      });
    }

    if (COMMIT && rows.length) await store.writeMomentum(rows);
    written += rows.length;
    const span = rows.length ? `${rows[rows.length - 1].d} → ${rows[0].d}` : '(none)';
    console.log(`  ${symbol.padEnd(8)} ${String(rows.length).padStart(5)} days  ${span}`);
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${symbols.length - skipped} symbols scored, ${skipped} too short, ` +
    `${written.toLocaleString()} rows ${COMMIT ? 'written' : 'would be written'} in ${secs}s`);
  if (COMMIT) {
    const after = await store.momentumStats(M.MODEL_VERSION);
    console.log(`momentum_history after  : ${after.rows.toLocaleString()} rows, ` +
      `${after.symbols} symbols, ${after.from} → ${after.to}`);
  } else {
    console.log('Re-run with --commit to write.');
  }
  process.exit(0);
})();
