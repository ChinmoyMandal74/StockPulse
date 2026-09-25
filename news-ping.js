#!/usr/bin/env node
// Ask production to top up the headlines, from a machine with a scheduler on
// it. Nothing more: these are small HTTP calls, NOT a refresh.
//
// IT MUST NOT BE `node server.js`. The work lives behind GET /api/cron/news on
// the deployed app; booting a local server against the production database to
// do the same job is the documented way to fight the live instance for the
// same rows.
//
// ONE SLOT IS MANY BATCHES, because one call cannot cover the universe. A
// serverless function must not be asked to hold a thousand network fetches, so
// the route does ONE batch of the stalest stocks and reports how many are
// left; this loops until nothing is stale. The admin button on /news-runs
// loops in exactly the same way -- the laptop is simply a second caller.
//
// THE SERVER DECIDES WHETHER TO ACT. There is no market-hours gate here, and
// deliberately so: headlines are published at weekends and in the evening, the
// provider is free and keyless, and none of this costs an API credit. The one
// thing that stops a slot is nothing being stale, which is the schedule
// working rather than failing.
//
//   node news-ping.js              top up the headlines
//   node news-ping.js --dry        ask what it WOULD do, and change nothing
//   node news-ping.js --hours 4    treat anything older than 4h as stale
//
// Exit code is for the scheduler's "last run result" column: 0 when the server
// answered, whether it fetched anything or found nothing to do, and 1 only
// when it could not be reached, refused the secret, or failed a batch. A task
// that goes red for a quiet afternoon teaches you to ignore it.
'use strict';
const fs = require('fs');
const path = require('path');

const ARGV = process.argv.slice(2);
const DRY = ARGV.includes('--dry');
const argOf = (name, fallback) => {
  const i = ARGV.indexOf(name);
  const v = i >= 0 ? Number(ARGV[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
};
const ROOT = __dirname;
const LOG = path.join(ROOT, 'news-ping.log');

// Forty is the route's own ceiling, and forty RSS fetches is a comfortable
// single request. Asking for fewer would only mean more round trips for the
// same work.
const BATCH = 40;
// Polite rather than necessary: the provider is a free, unofficial feed and
// there is no reason to be the fastest thing hitting it.
const GAP_MS = 2000;
// A lap of the universe is about thirty batches. This is the guard against a
// loop that never terminates -- if it ever trips, the count is wrong, not the
// universe.
const MAX_BATCHES = 80;
// Forty fetches with their own timeouts, plus the writes. Well under the
// platform's ~300s ceiling, and above anything a healthy batch takes.
const CALL_MS = 120000;

// Read .env directly rather than depending on the process environment: a
// scheduled task starts with almost none of the shell's, and the secret has no
// business on a command line where it would land in the task definition and in
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

(async () => {
  const secret = fromEnvFile('CRON_SECRET');
  const base = (fromEnvFile('APP_URL') || 'https://www.tickrlab.com').replace(/\/+$/, '');
  if (!secret) {
    say('FAILED  CRON_SECRET is not in .env -- copy it from the Vercel project settings.');
    process.exit(1);
  }
  // Four hours, not the app's six. The slots are 8 AM, 1 PM and 5 PM, which is
  // five and four hours apart, so at six hours the middle one would find
  // nothing stale and quietly do nothing.
  const hours = argOf('--hours', 4);

  async function call(q) {
    const url = `${base}/api/cron/news?${q}`;
    const signal = AbortSignal.timeout(CALL_MS);
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
    if (res.status === 401) {
      say('FAILED  the server refused the secret (401) -- CRON_SECRET does not match production.');
      process.exit(1);
    }
    if (!res.ok || !j) {
      say(`FAILED  HTTP ${res.status} in ${secs}s -- ${String(body).slice(0, 120)}`);
      process.exit(1);
    }
    return { j, secs };
  }

  const plan = await call(`dry=1&hours=${hours}&n=${BATCH}`);
  if (DRY) {
    say(plan.j.wouldRun
      ? `would run  ${plan.j.stale} of ${plan.j.universe} stale past ${hours}h -- about ${plan.j.batches} batch(es), dry`
      : `skipped    nothing fetched longer ago than ${hours}h (${plan.j.universe} stocks), dry`);
    process.exit(0);
  }
  if (!plan.j.wouldRun) {
    say(`skipped    nothing fetched longer ago than ${hours}h (${plan.j.universe} stocks)`);
    process.exit(0);
  }
  say(`starting   ${plan.j.stale} of ${plan.j.universe} stale past ${hours}h, about ${plan.j.batches} batch(es)`);

  const t0 = Date.now();
  let fetched = 0, added = 0, n = 0;
  for (; n < MAX_BATCHES; n++) {
    const { j, secs } = await call(`hours=${hours}&n=${BATCH}`);
    if (j.ran === false) break;              // nothing stale left
    fetched += Number(j.fetched) || 0;
    added += Number(j.added) || 0;
    say(`batch ${String(n + 1).padStart(2)}   ${j.served}/${j.fetched} served in ${secs}s, `
      + `${j.added} new, ${j.remaining} left`);
    if (j.done) { n++; break; }
    await sleep(GAP_MS);
  }
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  if (n >= MAX_BATCHES) {
    // Not a failure -- the work done is kept and the next slot carries on --
    // but it should be visible rather than look like a clean finish.
    say(`STOPPED    at the ${MAX_BATCHES}-batch ceiling after ${mins} min -- ${fetched} fetched, ${added} new`);
    process.exit(0);
  }
  say(`DONE       ${n} batch(es) in ${mins} min -- ${fetched} fetched, ${added} new headlines`);
  process.exit(0);
})();
