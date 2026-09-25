#!/usr/bin/env node
// Ask production to price the WHOLE universe, from a machine with a scheduler
// on it. Nothing more: these are small HTTP calls, NOT a refresh.
//
// IT MUST NOT BE `node server.js`. The whole job lives behind
// GET /api/cron/intraday on the deployed app; booting a local server against
// the production database to do the same work is the documented way to burn
// credits and fight the live instance for the same rows.
//
// ONE SLOT IS SEVERAL ROUNDS, because one round cannot price the universe.
// Prices cost 1 credit a symbol against a hard 610/minute ceiling, so a round
// takes PRICE_SLICE symbols and no more. The slot therefore runs
// `rounds - 1` LIGHT rounds -- next slice, archive it, move the cursor, no
// scoring and no snapshot -- and then ONE FULL round, which prices the last
// slice and rebuilds the table. The full round reads everything it did not
// price live off the archive, which by then holds the bars the light rounds
// just wrote, so the closing snapshot carries fresh prices for every stock.
//
// That ordering is the whole point. Three FULL rounds would price the same
// universe and pay the 470-day archive read three times instead of once.
//
// THE SERVER DECIDES WHETHER TO ACT, which is what makes a dumb scheduler
// safe. Every call refuses outside 9:38 AM - 4:00 PM New York, at weekends,
// when another refresh is running, and when the NYSE is shut for a holiday or
// an early close. So a schedule that is broad, slightly early, or firing on
// Christmas morning costs one credit and changes nothing. Daylight saving
// needs no thought at either end.
//
// THE SERVER ALSO PLANS THE SLOT. The dry call reports how many rounds a full
// lap takes, so the universe size and the slice width are not copied into a
// scheduler that would then go stale without saying so.
//
//   node intraday-ping.js          price the universe
//   node intraday-ping.js --dry    ask what it WOULD do, and change nothing
//
// Exit code is for the scheduler's "last run result" column: 0 when the server
// answered (whether it ran or skipped -- a skip is the design working), 1 only
// when it could not be reached, refused the secret, or failed a round. That
// distinction is the point: a task that goes red every weekend teaches you to
// ignore it.
'use strict';
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const ROOT = __dirname;
const LOG = path.join(ROOT, 'intraday-ping.log');
// The measured floor between rounds is 62 seconds -- two inside one minute
// returned "1128 API credits were used, with the current limit being 610".
// The few seconds on top are for clock skew, not caution.
const GAP_MS = 65000;
// A slot that somehow asks for more rounds than this has misread the universe;
// stop rather than spend the afternoon pricing.
const MAX_ROUNDS = 8;

// Read .env directly rather than depending on the process environment: a
// scheduled task starts with almost none of the shell's, and the secret has no
// business on a command line where it would land in a task definition and in
// shell history.
function fromEnvFile(key) {
  let raw;
  try { raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8'); } catch { return ''; }
  for (const line of raw.split(/\r?\n/)) {
    const m = new RegExp('^\\s*' + key + '\\s*=\\s*(.*)$').exec(line);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

function say(line) {
  const stamp = new Date().toLocaleString('en-CA', {
    timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).replace(',', '');
  const row = `${stamp} ET  ${line}`;
  console.log(row);
  // Append, never rewrite: the log IS the evidence that the schedule fired,
  // and a laptop that slept through a slot leaves a gap you can see.
  try { fs.appendFileSync(LOG, row + '\n'); } catch { /* a log failure must not fail the ping */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// HOW THIS EXITS, because it bit once and the symptom was a lie. Calling
// process.exit() while a fetch's socket is still closing crashes Node on
// Windows -- "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" -- and
// the scheduler then records 127 for a run that did its work perfectly. So
// nothing here calls process.exit: `Stop` carries the code up to one catch,
// which sets process.exitCode and returns. Measured: Node's keep-alive sockets
// do not hold the loop open, so the process still ends in well under a second.
class Stop extends Error {
  constructor(code) { super('stop'); this.code = code; }
}

(async () => {
  try {
    const secret = fromEnvFile('CRON_SECRET');
    const base = (fromEnvFile('APP_URL') || 'https://www.tickrlab.com').replace(/\/+$/, '');
    if (!secret) {
      say('FAILED  CRON_SECRET is not in .env -- copy it from the Vercel project settings.');
      throw new Stop(1);
    }

    // One call. Returns the parsed body, or exits -- an unreachable server or a
    // refused secret is the same answer whichever round hits it.
    async function call(query) {
      const url = `${base}/api/cron/intraday${query}`;
      // A round is minutes of work and the platform kills the function at about
      // 300s; a ceiling above that lets the scheduler's own next firing find
      // this one still waiting.
      const signal = AbortSignal.timeout(330000);
      const t0 = Date.now();
      let res, body;
      try {
        res = await fetch(url, { method: 'GET', signal, headers: { Authorization: 'Bearer ' + secret } });
        body = await res.text();
      } catch (e) {
        say(`FAILED  could not reach ${base} -- ${e.name === 'TimeoutError' ? 'timed out' : e.message}`);
        throw new Stop(1);
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      let j = null;
      try { j = JSON.parse(body); } catch { /* an HTML gateway page is not JSON */ }
      if (res.status === 401) {
        say('FAILED  the server refused the secret (401) -- CRON_SECRET does not match production.');
        throw new Stop(1);
      }
      return { res, j, body, secs };
    }

    // PLAN. The dry call runs every gate and reports how many rounds a lap takes.
    const plan = await call('?dry=1');
    if (!plan.res.ok || !plan.j) {
      say(`FAILED  HTTP ${plan.res.status} in ${plan.secs}s -- ${String(plan.body).slice(0, 120)}`);
      throw new Stop(1);
    }
    if (DRY) {
      if (plan.j.wouldRun) say(`would run  (${plan.j.ny}) -- ${plan.j.rounds} round(s) for ${plan.j.total} stocks, dry`);
      else say(`skipped    ${plan.j.reason}`);
      throw new Stop(0);
    }
    if (!plan.j.wouldRun) { say(`skipped    ${plan.j.reason}`); throw new Stop(0); }

    const rounds = Math.min(MAX_ROUNDS, Math.max(1, Number(plan.j.rounds) || 1));
    let runId = null;
    let served = 0;

    for (let i = 1; i <= rounds; i++) {
      // The FULL round is always last, so the snapshot it writes is built on top
      // of the bars every light round before it has already archived.
      const light = i < rounds;
      const q = `?${light ? 'light=1' : ''}${runId ? `${light ? '&' : ''}run=${runId}` : ''}`;
      const { res, j, body, secs } = await call(q.length > 1 ? q : '');
      if (!res.ok || !j) {
        say(`FAILED  round ${i}/${rounds} HTTP ${res.status} in ${secs}s -- ${String(body).slice(0, 120)}`);
        throw new Stop(1);
      }
      if (j.runId) runId = j.runId;
      if (j.ran === false) { say(`skipped    ${j.reason} (round ${i}/${rounds})`); throw new Stop(0); }
      if (light) {
        served += Number(j.served) || 0;
        say(`priced     round ${i}/${rounds} in ${secs}s -- ${j.served} symbols, ${j.priced}/${j.total} through the universe`);
        await sleep(GAP_MS);
      } else {
        say(`REFRESHED  round ${i}/${rounds} in ${secs}s -- rebuilt${served ? `, ${served} priced by the light rounds before it` : ''}`);
      }
    }
    throw new Stop(0);
  } catch (err) {
    if (err instanceof Stop) { process.exitCode = err.code; return; }
    // Anything unforeseen is still a failure the scheduler should show red.
    say('FAILED  ' + (err && err.message ? err.message : String(err)));
    process.exitCode = 1;
  }
})();
