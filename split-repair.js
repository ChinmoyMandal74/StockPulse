// Applies splits the provider never applied to the bar archive (2026-11-08).
//
// The archive holds Twelve Data's split-adjusted series, and learns of a split
// only when Twelve Data re-prices its history. Sometimes it never does: IESC's
// two-for-one of 2026-08-24 was still unadjusted there in November, so the
// stored closes fell 54% overnight and every reading built on them (from high,
// one year, the moving averages, the Signal) was wrong for ten weeks.
//
// This finds every split held in `splits` between two dates whose stored
// closes still show the cliff, and scales the bars before the cliff by 1/f
// (volume by f). It multiplies; it never deletes. The nightly splits step does
// the same for the last 45 days on its own (barsplit.js repairStored); this is
// for older ones, and for checking.
//
// ALSO RUN IT AFTER `backfill-bars.js --only SYM` for a symbol the provider
// serves unadjusted: the backfill re-downloads the provider's series and puts
// the cliff back.
//
//   node --use-system-ca split-repair.js                       dry run, splits since 2023-01-01
//   node --use-system-ca split-repair.js --since 2026-01-01 --only IESC
//   node --use-system-ca split-repair.js --only IESC --commit
'use strict';
require('dotenv').config();
const store = require('./db.js');
const BarSplit = require('./barsplit.js');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const COMMIT = process.argv.includes('--commit');
const since = arg('--since', '2023-01-01');
const only = arg('--only', null) ? arg('--only').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : null;

(async () => {
  const found = await BarSplit.repairStored(store, { since, only, commit: COMMIT });
  if (!found.length) console.log(`No unadjusted split in the archive since ${since}${only ? ' for ' + only.join(',') : ''}.`);
  for (const f of found) {
    console.log(`${f.symbol.padEnd(6)} split ${f.split} x${f.f}: stored close ${f.pre.close} on ${f.pre.d}, then ${f.post.close} on ${f.post.d}`
      + ` — bars before ${f.at} ${COMMIT ? `scaled by ${f.k.toFixed(4)} (${f.scaled} rows)` : `would be scaled by ${f.k.toFixed(4)}`}`);
  }
  if (found.length && !COMMIT) console.log('Dry run. Add --commit to apply.');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
