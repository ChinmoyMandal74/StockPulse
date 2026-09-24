#!/usr/bin/env node
// Ask production to run an intraday price refresh, from a machine with a
// scheduler on it. Nothing more: this is a 1KB HTTP call, NOT a refresh.
//
// IT MUST NOT BE `node server.js`. The whole job lives behind
// GET /api/cron/intraday on the deployed app; booting a local server against
// the production database to do the same work is the documented way to burn
// credits and fight the live instance for the same rows.
//
// THE SERVER DECIDES WHETHER TO ACT, which is what makes a dumb scheduler safe.
// The route refuses outside 9:38 AM - 4:00 PM New York, at weekends, when
// another refresh is already running, and when the NYSE is shut for a holiday
// or an early close. So a schedule that is broad, slightly early, or firing on
// Christmas morning costs one credit and changes nothing. Daylight saving needs
// no thought at either end.
//
//   node intraday-ping.js          ask it to run
//   node intraday-ping.js --dry    ask what it WOULD do, and change nothing
//
// Exit code is for the scheduler's "last run result" column: 0 when the server
// answered (whether it ran or skipped -- a skip is the design working), 1 only
// when it could not be reached or refused the secret. That distinction is the
// point: a task that goes red every weekend teaches you to ignore it.
'use strict';
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const ROOT = __dirname;
const LOG = path.join(ROOT, 'intraday-ping.log');

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

(async () => {
  const secret = fromEnvFile('CRON_SECRET');
  const base = (fromEnvFile('APP_URL') || 'https://www.tickrlab.com').replace(/\/+$/, '');
  if (!secret) {
    say('FAILED  CRON_SECRET is not in .env -- copy it from the Vercel project settings.');
    process.exit(1);
  }

  const url = `${base}/api/cron/intraday${DRY ? '?dry=1' : ''}`;
  // A refresh round is minutes of work, and the platform kills the function at
  // about 300s; a ceiling above that lets the scheduler's own next firing find
  // this one still waiting.
  const signal = AbortSignal.timeout(330000);
  const t0 = Date.now();
  let res, body;
  try {
    res = await fetch(url, { method: 'GET', signal, headers: { Authorization: 'Bearer ' + secret } });
    body = await res.text();
  } catch (e) {
    say(`FAILED  could not reach ${base} -- ${e.name === 'TimeoutError' ? 'timed out' : e.message}`);
    process.exit(1);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  let j = null;
  try { j = JSON.parse(body); } catch { /* an HTML gateway page is not JSON */ }
  if (res.status === 401) { say('FAILED  the server refused the secret (401) -- CRON_SECRET does not match production.'); process.exit(1); }
  if (!res.ok || !j) { say(`FAILED  HTTP ${res.status} in ${secs}s -- ${String(body).slice(0, 120)}`); process.exit(1); }

  if (j.ran === false && j.wouldRun) say(`would run  (${j.ny}) -- dry, nothing changed`);
  else if (j.ran === false) say(`skipped    ${j.reason}`);
  else say(`REFRESHED  in ${secs}s -- ${j.loaded != null ? j.loaded + ' loaded' : 'done'}${j.credits != null ? ', ' + j.credits + ' credits' : ''}`);
  process.exit(0);
})();
