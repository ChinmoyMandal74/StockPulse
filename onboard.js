#!/usr/bin/env node
// Finish setting up newly added stocks: load the four pieces of HISTORY that
// do not arrive on their own. Dry run by default.
//
//   node --use-system-ca onboard.js                 what is waiting, and what it would run
//   node --use-system-ca onboard.js --commit        run it, then mark those stocks finished
//   node --use-system-ca onboard.js --commit --only MU,NVDA    these symbols, whether waiting or not
//   node --use-system-ca onboard.js --commit --force            run inside a nightly window anyway
//
// WHAT IT RUNS, in this order, each for exactly the symbols named:
//   1. backfill-bars.js      the full price history (1 credit a symbol)
//   2. backfill-ath.js       the record close -- AFTER the bars, which it reads
//   3. shortint-load.js      short-interest history back to 2017 (FINRA, no credits)
//   4. backfill-splits.js    split history (20 credits a symbol)
// It adds no logic of its own: each step is the existing loader, started with
// --only. Company data, filings and news are NOT here -- the nightly run pulls
// those for a new stock first, and Fill missing does it on demand.
//
// "WAITING" is a stock added to the universe after the server's ONBOARD_SINCE
// with no row in onboard_state. The page at /onboarding shows the same list.
//
// IT REFUSES TO START INSIDE A NIGHTLY WINDOW (07:25-08:20 and 19:25-20:20
// Eastern, weekdays). A nightly round uses ~561 of the 610 credits a minute,
// so anything charged alongside it can get the ROUND refused rather than this.
//
// A STEP THAT FAILS DOES NOT STOP THE REST, and the stocks are still marked
// finished only if the price history landed -- judged by the bars actually
// stored, never by an exit code (a loader here has succeeded and exited 1).
require('dotenv').config();
const { spawnSync } = require('child_process');
const path = require('path');
const store = require('./db.js');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FORCE = args.includes('--force');
const onlyAt = args.indexOf('--only');
const ONLY = onlyAt > -1 && args[onlyAt + 1]
  ? args[onlyAt + 1].split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
// Must match ONBOARD_SINCE in server.js.
const SINCE = Number(process.env.ONBOARD_SINCE) || Date.UTC(2026, 9, 8, 23, 0, 0);

function inNightlyWindow(now) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(now || new Date());
  const get = (t) => (p.find((x) => x.type === t) || {}).value;
  if (['Sat', 'Sun'].includes(get('weekday'))) return false;
  const m = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  return (m >= 7 * 60 + 25 && m <= 8 * 60 + 20) || (m >= 19 * 60 + 25 && m <= 20 * 60 + 20);
}

const STEPS = [
  ['price history', 'backfill-bars.js', (list) => ['--commit', '--rate', '100', '--only', list]],
  ['record close', 'backfill-ath.js', (list) => ['--commit', '--only', list]],
  ['short interest', 'shortint-load.js', (list) => ['--commit', '--only', list]],
  ['split history', 'backfill-splits.js', (list) => ['--commit', '--only', list]],
];

(async () => {
  if (store.init) await store.init();
  let symbols = ONLY;
  if (!symbols) symbols = (await store.readOnboardPending(SINCE)).map((x) => x.symbol);
  if (!symbols.length) { console.log('Nothing is waiting. Every stock added since this was built has been finished.'); return; }
  // A symbol named with --only must be one the screener tracks: every loader
  // below would otherwise write history for a stock that is not there.
  const universe = new Set(await store.readUniverse());
  const stray = symbols.filter((s) => !universe.has(s));
  if (stray.length) { console.log('Not in the screener, so nothing to finish: ' + stray.join(', ') + '. Add them first.'); process.exitCode = 1; return; }

  const list = symbols.join(',');
  console.log(symbols.length + (symbols.length === 1 ? ' stock: ' : ' stocks: ') + list);
  console.log('Credits: about ' + symbols.length * 21 + ' (1 for prices and 20 for splits, per stock).');
  for (const [name, script, mk] of STEPS) console.log('  ' + name.padEnd(15) + 'node --use-system-ca ' + script + ' ' + mk(list).join(' '));
  if (!COMMIT) { console.log('\nDry run: nothing fetched, nothing written. Add --commit.'); return; }
  if (inNightlyWindow() && !FORCE) {
    console.log('\nNot started: the nightly run is due or under way (7:30 AM and 7:30 PM Eastern), and both would be'
      + '\ncompeting for the same API credits. Run this again after 8:20, or add --force.');
    process.exitCode = 1; return;
  }

  const ran = [];
  for (const [name, script, mk] of STEPS) {
    console.log('\n== ' + name + ' ==');
    const r = spawnSync(process.execPath, ['--use-system-ca', path.join(__dirname, script), ...mk(list)], { stdio: 'inherit', cwd: __dirname });
    ran.push(name + (r.status === 0 ? '' : ' (exit ' + r.status + ')'));
  }

  // Judged by what is stored. A stock with no bars at all did not land.
  const span = await store.barsSpan(symbols);
  const landed = symbols.filter((s) => span[s]);
  const missed = symbols.filter((s) => !span[s]);
  if (landed.length) await store.noteOnboarded(landed, ran.join(', '));
  console.log('\nFinished: ' + (landed.length ? landed.join(', ') : 'none'));
  for (const s of landed) console.log('  ' + s.padEnd(8) + 'prices ' + span[s].first + ' to ' + span[s].last);
  if (missed.length) {
    console.log('NOT finished, no price history stored: ' + missed.join(', ') + '. They stay on the list; run this again.');
    process.exitCode = 1;
  }
  console.log('Company data, filings and news arrive with the next nightly run, or press Fill missing now.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
