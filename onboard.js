#!/usr/bin/env node
// Finish setting up newly added stocks: EVERYTHING a new stock needs, in one
// run. Dry run by default.
//
//   node --use-system-ca onboard.js                 what is waiting, and what it would run
//   node --use-system-ca onboard.js --commit        run it, then mark those stocks finished
//   node --use-system-ca onboard.js --commit --only MU,NVDA    these symbols, whether waiting or not
//   node --use-system-ca onboard.js --commit --force            run inside a nightly window anyway
//   node --use-system-ca onboard.js --commit --auto             the task: quiet when nothing waits
//
// ONE CLICK (2026-11-04, the owner: "This should all be one one click of a
// button somehow"). The click is the add on /themes. The laptop task
// 'TickrLab onboard' (onboard-task.ps1) runs this with --auto every half hour,
// 07:05 to 22:05; a stock added since the last run is loaded by the next.
// Until then this did the four history loaders only, and the rest was a
// checklist of eleven steps (docs/context/adding-a-stock.md).
//
// WHAT IT RUNS, in this order, each for exactly the symbols named:
//   prices      backfill-bars.js, backfill-ath.js (after the bars, which it
//               reads), shortint-load.js, backfill-splits.js
//   profile     POST /api/admin/refresh-stock, one stock at a time (about 80
//               credits each), with the cron secret
//   filings     POST /api/sec/refresh?mode=missing until nothing is left (it
//               resolves the CIK everything after needs)
//   SEC history sec-events-load.js, sec-holders-load.js, sec-segments-load.js,
//               drawdown-load.js, options-load.js
//   releases    release-history-load.js (Claude Haiku, capped at $2)
//   local copy  analysis-add.js, then release-archive-load.js and
//               build-tech-history.js, which read the copy
//   source rule POST /api/sources/build?symbols=
// It adds no logic of its own: each step is the existing loader or route.
//
// TWELVE DATA (the price loaders and the profiles): never inside a nightly
// window or an intraday slot (schedule.js busyAt). A run that starts inside a
// nightly window stops (--force overrides); a slot is waited out.
//
// A STEP THAT FAILS DOES NOT STOP THE REST, and the stocks are still marked
// finished only if the price history landed -- judged by the bars actually
// stored, never by an exit code (a loader here has succeeded and exited 1).
// One run at a time: onboard.lock beside this file holds the running pid.
require('dotenv').config();
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const store = require('./db.js');
const Schedule = require('./schedule.js');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FORCE = args.includes('--force');
const AUTO = args.includes('--auto');
const onlyAt = args.indexOf('--only');
const ONLY = onlyAt > -1 && args[onlyAt + 1]
  ? args[onlyAt + 1].split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
// Must match ONBOARD_SINCE in server.js.
const SINCE = Number(process.env.ONBOARD_SINCE) || Date.UTC(2026, 9, 8, 23, 0, 0);
const BASE = (process.env.APP_URL || 'https://www.tickrlab.com').replace(/\/+$/, '');
const SECRET = process.env.CRON_SECRET || '';
const LOCK = path.join(__dirname, 'onboard.lock');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });

// [name, kind, script or route, arguments]. kind: 'twelve' spends Twelve Data
// credits, 'local' runs a loader, 'remote' calls the deployed app.
const STEPS = [
  ['price history', 'twelve', 'backfill-bars.js', (list) => ['--commit', '--rate', '100', '--only', list]],
  ['record close', 'local', 'backfill-ath.js', (list) => ['--commit', '--only', list]],
  ['short interest', 'local', 'shortint-load.js', (list) => ['--commit', '--only', list]],
  ['split history', 'twelve', 'backfill-splits.js', (list) => ['--commit', '--only', list]],
  ['profile', 'remote', 'profiles'],
  ['SEC filings', 'remote', 'filings'],
  ['8-K events', 'local', 'sec-events-load.js', (list) => ['--commit', '--only', list]],
  ['13D/13G holders', 'local', 'sec-holders-load.js', (list) => ['--commit', '--only', list]],
  ['revenue segments', 'local', 'sec-segments-load.js', (list) => ['--commit', '--only', list]],
  ['drawdowns', 'local', 'drawdown-load.js', (list) => ['--commit', '--only', list]],
  ['options', 'local', 'options-load.js', (list) => ['--commit', '--only', list]],
  ['earnings releases', 'local', 'release-history-load.js', (list) => ['--commit', '--max-usd', '2', '--symbols', list]],
  ['local copy', 'local', 'analysis-add.js', (list) => ['--commit', '--only', list]],
  ['release text', 'local', 'release-archive-load.js', () => ['--limit', '400']],
  ['tech history', 'local', 'build-tech-history.js', (list) => ['--commit', '--only', list]],
  ['source rule', 'remote', 'sources'],
];

async function waitForCredits() {
  for (let busy = Schedule.busyAt(new Date()); busy; busy = Schedule.busyAt(new Date())) {
    console.log('  waiting: ' + busy + ' (' + stamp() + ')');
    await sleep(60000);
  }
}

async function call(method, route) {
  const r = await fetch(BASE + route, { method, headers: { authorization: 'Bearer ' + SECRET }, signal: AbortSignal.timeout(330000) });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body: body || {} };
}

// The remote steps. Each answers a short outcome for the record.
const REMOTE = {
  // One stock at a time. 429: another job had the minute; 503: a refresh is
  // running and the route stood aside. Both are waited out, five tries each.
  async profiles(symbols) {
    const got = [];
    for (const s of symbols) {
      for (let tries = 1; tries <= 5; tries++) {
        await waitForCredits();
        const r = await call('POST', '/api/admin/refresh-stock?symbol=' + encodeURIComponent(s));
        console.log('  ' + s.padEnd(8) + r.status + ' fundamentals ' + (r.body.fundamentals || '-') + ', price ' + (r.body.price || '-') + (r.body.error ? ' (' + r.body.error + ')' : ''));
        if (r.status === 200 && r.body.fundamentals === 'refreshed') { got.push(s); break; }
        if (r.status === 401 || r.status === 404) break;
        await sleep(70000);
      }
    }
    return got.length + ' of ' + symbols.length;
  },
  async filings() {
    for (let round = 1; round <= 40; round++) {
      const r = await call('POST', '/api/sec/refresh?mode=missing');
      console.log('  round ' + round + ': ' + r.status + ' fetched ' + (r.body.fetched ?? '-') + ', remaining ' + (r.body.remaining ?? '-') + (r.body.error ? ' (' + r.body.error + ')' : ''));
      if (r.status === 200 && (r.body.done || !r.body.remaining)) return 'done';
      if (r.status === 401 || r.status === 400) return 'refused ' + r.status;
      if (r.status !== 200) await sleep(60000);
    }
    return 'stopped after 40 rounds';
  },
  async sources(symbols) {
    for (let tries = 1; tries <= 5; tries++) {
      const r = await call('POST', '/api/sources/build?symbols=' + encodeURIComponent(symbols.join(',')));
      console.log('  ' + r.status + (r.body.error ? ' (' + r.body.error + ')' : ''));
      if (r.status === 200) return 'built';
      if (r.status === 401) return 'refused';
      await sleep(120000);
    }
    return 'not built';
  },
};

function takeLock() {
  try {
    const held = Number(fs.readFileSync(LOCK, 'utf8'));
    if (held && held !== process.pid) {
      try { process.kill(held, 0); return false; } catch {}
    }
  } catch {}
  fs.writeFileSync(LOCK, String(process.pid));
  return true;
}
const dropLock = () => { try { if (Number(fs.readFileSync(LOCK, 'utf8')) === process.pid) fs.unlinkSync(LOCK); } catch {} };

(async () => {
  if (store.init) await store.init();
  let symbols = ONLY;
  if (!symbols) symbols = (await store.readOnboardPending(SINCE)).map((x) => x.symbol);
  if (!symbols.length) { if (!AUTO) console.log('Nothing is waiting. Every stock added since this was built has been finished.'); return; }
  // A symbol named with --only must be one the screener tracks: every loader
  // below would otherwise write history for a stock that is not there.
  const universe = new Set(await store.readUniverse());
  const stray = symbols.filter((s) => !universe.has(s));
  if (stray.length) { console.log('Not in the screener, so nothing to finish: ' + stray.join(', ') + '. Add them first.'); process.exitCode = 1; return; }

  const list = symbols.join(',');
  console.log('\n' + stamp() + '  ' + symbols.length + (symbols.length === 1 ? ' stock: ' : ' stocks: ') + list);
  console.log('Twelve Data credits: about ' + symbols.length * 101 + ' (1 for prices, 20 for splits, 80 for the profile, per stock).');
  for (const [name, kind, script, mk] of STEPS) {
    console.log('  ' + name.padEnd(18) + (kind === 'remote' ? BASE + ' (' + script + ')' : 'node --use-system-ca ' + script + ' ' + mk(list).join(' ')));
  }
  if (!COMMIT) { console.log('\nDry run: nothing fetched, nothing written. Add --commit.'); return; }
  if (!SECRET) { console.log('\nNot started: CRON_SECRET is not in .env, and the profile, filings and source rule steps need it.'); process.exitCode = 1; return; }
  if (Schedule.busyAt(new Date()) === 'the nightly refresh window' && !FORCE) {
    console.log('\nNot started: the nightly run is due or under way (4:00 AM and 4:00 PM Eastern), and both would be'
      + '\ncompeting for the same API credits. ' + (AUTO ? 'The next run will try again.' : 'Run this again after 4:50, or add --force.'));
    if (!AUTO) process.exitCode = 1;
    return;
  }
  if (!takeLock()) { console.log('Another onboard run is still going (onboard.lock); leaving it to finish.'); return; }

  const ran = [];
  try {
    for (const [name, kind, script, mk] of STEPS) {
      console.log('\n== ' + name + ' ==  ' + stamp());
      try {
        if (kind === 'remote') { ran.push(name + ' ' + await REMOTE[script](symbols)); continue; }
        if (kind === 'twelve') await waitForCredits();
        const r = spawnSync(process.execPath, ['--use-system-ca', path.join(__dirname, script), ...mk(list)], { stdio: 'inherit', cwd: __dirname });
        ran.push(name + (r.status === 0 ? '' : ' (exit ' + r.status + ')'));
      } catch (e) {
        console.log('  failed: ' + (e && e.message));
        ran.push(name + ' (failed)');
      }
    }
  } finally { dropLock(); }

  // Judged by what is stored. A stock with no bars at all did not land.
  const span = await store.barsSpan(symbols);
  const landed = symbols.filter((s) => span[s]);
  const missed = symbols.filter((s) => !span[s]);
  // The record holds what went wrong, or that nothing did (200 characters).
  const trouble = ran.filter((x) => /\(exit|\(failed|not built|refused|stopped|^profile 0 of /.test(x));
  if (landed.length) await store.noteOnboarded(landed, trouble.length ? 'all steps; trouble: ' + trouble.join(', ') : 'all ' + STEPS.length + ' steps');
  console.log('\n' + stamp() + '  Finished: ' + (landed.length ? landed.join(', ') : 'none'));
  for (const s of landed) console.log('  ' + s.padEnd(8) + 'prices ' + span[s].first + ' to ' + span[s].last);
  console.log('  ' + ran.join(' · '));
  if (missed.length) {
    console.log('NOT finished, no price history stored: ' + missed.join(', ') + '. They stay on the list; the next run tries again.');
    process.exitCode = 1;
  }
})().catch((e) => { console.error(e); process.exitCode = 1; dropLock(); });
