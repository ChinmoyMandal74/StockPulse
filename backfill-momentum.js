// One-off backfill of the momentum history, computed from the bar archive.
//
//   node --use-system-ca backfill-momentum.js --check         # status only
//   node --use-system-ca backfill-momentum.js                 # dry run
//   node --use-system-ca backfill-momentum.js --commit        # write
//   node --use-system-ca backfill-momentum.js --commit --only MU,DELL
//   node --use-system-ca backfill-momentum.js --commit --from 2020-01-01
//   node --use-system-ca backfill-momentum.js --commit --rebuild   # wipe first
//
// CHANGED THE MODEL? Bump MODEL_VERSION in momentum.js, then run this with
// --commit and no other flags. That is the whole procedure.
//
//   - Nothing needs wiping. Rows are keyed on (symbol, d) and the write is an
//     upsert, so a plain re-run overwrites every date in place. --rebuild exists
//     to drop symbols that have left the universe, and it blanks the table for
//     the ten minutes the run takes, so it is the worse choice by default.
//   - The app stays up throughout. Reads filter on MODEL_VERSION, so once it is
//     bumped the charts show a series that fills in symbol by symbol rather than
//     one quietly mixing two models.
//   - The run stamps momentum_model only if it covered the whole universe. A
//     --only or --from run leaves the old stamp deliberately, so an interrupted
//     rebuild keeps reporting as out of date.
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
const CHECK = process.argv.includes('--check');
const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const ONLY = argOf('--only', '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const FROM = argOf('--from', '');   // only write dates on or after this

// What the stored rows are, against what this code would produce now.
async function report() {
  const st = await store.momentumModelStatus(M.MODEL_VERSION, M.MODEL_ID);
  console.log(`momentum_history        : ${st.rows.toLocaleString()} rows, ` +
    `${st.symbols} symbols${st.rows ? `, ${st.from} to ${st.to}` : ''}`);
  console.log(`running model           : version ${M.MODEL_VERSION}, fingerprint ${M.MODEL_ID}`);
  console.log(`stored history built by : ${st.stored
    ? `version ${st.stored.model}, fingerprint ${st.stored.fingerprint}` +
      ` on ${st.stored.computedAt.slice(0, 10)}`
    : 'unrecorded'}`);
  if (st.stale) console.log(`  ${st.stale.toLocaleString()} rows carry a different model version.`);

  const say = {
    current: 'the stored history is what this code produces.',
    empty: 'nothing stored yet. Run with --commit to build it.',
    unstamped: 'these rows predate the provenance check, or a run was interrupted. '
      + 'Re-run with --commit to recompute and stamp them.',
    drifted: st.versionBumped
      ? 'MODEL_VERSION was bumped and the history has not been rebuilt. Reads '
        + 'filter the old rows out, so charts stay short until you run --commit.'
      : 'THE SCORING CHANGED WITHOUT A VERSION BUMP. The stored rows no longer '
        + 'match this code and are still being served as current. Bump '
        + 'MODEL_VERSION in momentum.js, then re-run with --commit.',
  }[st.state];
  console.log(`status                  : ${st.state} - ${say}`);
  return st;
}

(async () => {
  const st = await report();
  if (CHECK) {
    process.exit(st.state === 'current' || st.state === 'empty' ? 0 : 1);
  }
  console.log(`mode                    : ${COMMIT ? 'COMMIT - this writes' : 'DRY RUN - nothing will be written'}`);
  if (FROM) console.log(`from                    : ${FROM}`);
  console.log('');

  if (REBUILD && COMMIT) {
    await store.clearMomentum();
    console.log('cleared momentum_history\n');
  }

  // The universe comes from the PORTFOLIOS, not from the snapshot. The snapshot
  // is a cache of the last refresh, so a ticker added since is invisible to it —
  // which silently skipped all 33 names the day they were added, and reported a
  // clean "80 symbols scored" while doing it. The portfolios are the definition
  // of what the screener covers; the snapshot is one rendering of it.
  const portfolios = await store.readPortfolios();
  let symbols = [...new Set(Object.values(portfolios).flat())].sort();
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
  if (!COMMIT) {
    console.log('Re-run with --commit to write.');
    process.exit(0);
  }

  // Stamp only a run that covered the whole universe from the start of the
  // archive. A --only or --from run has recomputed part of the table, and
  // claiming the whole of it is current would hide exactly what this check
  // exists to surface.
  const full = !ONLY.length && !FROM;
  if (full) {
    await store.recordMomentumModel(M.MODEL_VERSION, M.MODEL_ID);
    console.log(`stamped momentum_model  : version ${M.MODEL_VERSION}, fingerprint ${M.MODEL_ID}`);
  } else {
    console.log('partial run (--only/--from), so momentum_model was left alone - '
      + 're-run without those flags to mark the history current.');
  }
  console.log('');
  await report();
  process.exit(0);
})();
