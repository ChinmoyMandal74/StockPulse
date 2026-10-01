#!/usr/bin/env node
// Drive the nightly fundamentals rotation from a machine with a scheduler on
// it. Nothing more: these are HTTP calls, NOT a refresh.
//
// IT MUST NOT BE `node server.js`. The whole job lives behind
// POST /api/cron/refresh on the deployed app; booting a local server against
// the production database to do the same work is the documented way to burn
// credits and fight the live instance for the same rows.
//
// WHY IT MOVED OFF GITHUB ACTIONS. On 2026-09-21 GitHub delivered exactly one
// firing all day, about two hours late, and the cron that should have run
// never fired at all. The job is otherwise identical -- it drives the same
// loop the browser drives from /refreshes -- so this is a change of host, not
// of behaviour. The workflow is KEPT with `workflow_dispatch` only, so the
// "Run workflow" button is still a one-click re-run from any browser.
//
// A ROUND IS SEVEN PROFILES AND THAT IS A HARD CEILING. A cold profile costs
// 80 credits against 610/minute, so 7 is all a minute affords -- an eighth
// would be 640 and get refused. Refreshing N profiles therefore takes N/7
// minutes whatever anyone builds. At the default 7-day rotation that is ~171
// profiles, ~27 rounds, ~37 minutes, measured over seven consecutive nights.
//
// THE SERVER DECIDES WHETHER TO ACT. `?start=1` stands aside when another
// refresh is already running -- a Fast refresh, a Fill missing, or the other
// scheduled run -- and answers `skipped`. That guard is what makes two
// scheduled runs a day safe, and it is on the SERVER because GitHub's own
// `concurrency` group can only see other GitHub runs.
//
// NOT GATED BY DAY OR HOUR, deliberately. The weekday restriction lives in
// the Task Scheduler trigger (nightly-task.ps1), so running this by hand at a
// weekend does what you asked. The route has no clock of its own either; the
// only thing that can refuse it is a run already in flight.
//
//   node nightly-ping.js          run the rotation
//   node nightly-ping.js --dry    check this machine can do the job, run nothing
//   node nightly-ping.js --full   re-pull EVERY profile (hours; see below)
//
// `--dry` answers the only two questions worth asking before a scheduled run:
// can this machine reach production, and is the secret right. It cannot ask
// THIS route, because every `?start=1` starts a run and a bare POST runs an
// ordinary round -- neither is free. `DELETE` is no good either: it would
// clear a refresh that happened to be in flight. So it asks the intraday
// route's own `?dry=1`, which is explicitly non-mutating and reads the SAME
// CRON_SECRET, which is the thing being verified.
//
// `--full` is the whole universe in one pass: ~1,192 profiles, ~171 rounds,
// about three hours and ~95,000 credits. Use /admin's Fast refresh instead
// unless you specifically want this driven from the laptop -- its rounds skip
// the per-round table rebuild and it finishes in roughly half the time.
//
// Exit code is for the scheduler's "last run result" column: 0 when the server
// answered -- including when it skipped, which is the design working -- and 1
// only when it could not be reached, refused the secret, or gave up mid-run.
'use strict';
const fs = require('fs');
const path = require('path');

const FULL = process.argv.includes('--full');
const DRY = process.argv.includes('--dry');
const ROOT = __dirname;
const LOG = path.join(ROOT, 'nightly-ping.log');
// The measured floor between rounds is 62 seconds -- two inside one minute
// returned "1128 API credits were used, with the current limit being 610".
// The few seconds on top are for clock skew, not caution.
const GAP_MS = 65000;
// 60 covers ~2,800 symbols at the default rotation; a `--full` sweep of the
// present universe needs ~171. Past either, something has misread the
// universe and the right answer is to stop rather than run all night.
const MAX_ROUNDS = FULL ? 200 : 60;
// Rounds that return nothing usable before giving up. A rate limit, a cold
// start or a 504 is not a reason to abandon the night; three in a row is.
const STAGNANT_LIMIT = 3;
// SEC filings, refreshed after the rotation. 5 a batch matches the route's
// own default; 20 batches is 100 symbols a run, so the two daily runs cover
// ~200 and the universe turns over in under a week -- the same cadence the
// profile rotation keeps.
const SEC_BATCH = 5;
const SEC_MAX_BATCHES = Number(process.env.SEC_MAX_BATCHES) || 20;
const SEC_GAP_MS = 1500;

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
  // and a laptop that slept through a run leaves a gap you can see.
  try { fs.appendFileSync(LOG, row + '\n'); } catch { /* a log failure must not fail the ping */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// HOW THIS EXITS, because it bit the intraday ping once and the symptom was a
// lie. Calling process.exit() while a fetch's socket is still closing crashes
// Node on Windows -- "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"
// -- and the scheduler then records 127 for a run that did its work perfectly.
// So nothing here calls process.exit: `Stop` carries the code up to one catch,
// which sets process.exitCode and returns.
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

    let runId = null;

    // One call. An unreachable server or a refused secret is the same answer
    // whichever round hits it, so those end the run here.
    async function call(query) {
      const url = `${base}/api/cron/refresh${query}`;
      // `?start=1` does not merely start the run -- it falls through and
      // executes a whole round, and round ONE is the live price round, the
      // most expensive kind. Measured at 257s on 640 symbols against a 180s
      // limit, which is what broke the 2026-09-21 manual re-run. The platform
      // kills a function at about 300s, so 330 is the honest ceiling.
      const signal = AbortSignal.timeout(330000);
      const body = JSON.stringify(Object.assign(
        { actor: 'nightly job (laptop)', trigger: 'scheduled' },
        runId ? { runId } : {},
      ));
      const t0 = Date.now();
      let res; let text;
      try {
        res = await fetch(url, {
          method: 'POST',
          signal,
          headers: { Authorization: 'Bearer ' + secret, 'content-type': 'application/json' },
          body,
        });
        text = await res.text();
      } catch (e) {
        // NOT fatal on its own: the loop counts it as a stagnant round and
        // retries. Only STAGNANT_LIMIT of these in a row ends the night --
        // the `|| true` lesson from the workflow, where bash -e turned one
        // slow round into a stranded run with the refresh flag left up.
        return { err: e.name === 'TimeoutError' ? 'timed out' : e.message,
          secs: ((Date.now() - t0) / 1000).toFixed(1) };
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (res.status === 401) {
        say('FAILED  the server refused the secret (401) -- CRON_SECRET does not match production.');
        throw new Stop(1);
      }
      let j = null;
      try { j = JSON.parse(text); } catch { /* an HTML gateway page is not JSON */ }
      return { res, j, text, secs };
    }

    // Clear the flag and let the server report whatever was gathered. Only
    // reached when we give up; a run that finishes closes itself.
    async function finish() {
      try {
        await fetch(`${base}/api/cron/refresh`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(120000),
          headers: { Authorization: 'Bearer ' + secret },
        });
      } catch { /* the run is already over; a failed cleanup must not mask it */ }
    }

    if (DRY) {
      // The intraday route's own dry call: same secret, no mutation, and it
      // reports the clock it sees so a laptop in the wrong timezone shows up
      // here rather than as a run that fires at the wrong hour.
      let r; let body;
      try {
        r = await fetch(`${base}/api/cron/intraday?dry=1`, {
          signal: AbortSignal.timeout(60000),
          headers: { Authorization: 'Bearer ' + secret },
        });
        body = await r.text();
      } catch (e) {
        say(`FAILED  could not reach ${base} -- ${e.name === 'TimeoutError' ? 'timed out' : e.message}`);
        throw new Stop(1);
      }
      if (r.status === 401) {
        say('FAILED  the server refused the secret (401) -- CRON_SECRET does not match production.');
        throw new Stop(1);
      }
      let j = null; try { j = JSON.parse(body); } catch { /* not json */ }
      say(`dry        reachable, secret accepted (HTTP ${r.status})`
        + (j && j.ny ? ` -- the server reads the clock as ${j.ny}` : ''));
      say(`           would run the ${FULL ? 'FULL sweep' : 'rotation'} against ${base}`);
      throw new Stop(0);
    }

    // ---- SEC filings, AFTER the rotation and never inside it ----------
    //
    // A SEPARATE PHASE OF THE *PING*, not of the refresh. Three things have
    // been added to the refresh tail on this project -- the news top-up
    // (2026-09-18), techHistorySpan (2026-09-19) and archiveStats
    // (2026-09-20) -- and all three surfaced as "the refresh failed" over
    // data that was perfectly fine, because nothing may run after the
    // response on that platform and the tail has to finish inside the
    // request. So this is its own HTTP loop, exactly as /admin drives it,
    // and a failure here cannot touch the night's refresh.
    //
    // Why it is here at all: sec_state.last_filed is what tells the screener
    // the vendor's earnings feed has gone stale, and Twelve Data confirmed in
    // writing that a missed quarter has NO backfill SLA. A staleness check
    // that is itself stale is worse than none.
    //
    // CAPPED IN BATCHES, not run to completion. The SEC has already answered
    // 429 and then 403 to this address when a loop hammered it, and a
    // companyfacts file is 1-5MB. With the rotation cutoff doing the
    // selecting, ~34 batches a day is steady state across the two runs; the
    // cap is what stops the FIRST night, when everything is past the cutoff,
    // trying to fetch the whole universe in one go. It simply catches up
    // over the following nights.
    async function secRotate() {
      let fetched = 0;
      let batches = 0;
      for (; batches < SEC_MAX_BATCHES; batches += 1) {
        let r; let text;
        try {
          r = await fetch(`${base}/api/sec/refresh?mode=rotate&n=${SEC_BATCH}`, {
            method: 'POST',
            signal: AbortSignal.timeout(300000),
            headers: { Authorization: 'Bearer ' + secret },
          });
          text = await r.text();
        } catch (e) {
          say(`sec        stopped after ${batches} batch(es) -- ${e.name === 'TimeoutError' ? 'timed out' : e.message}`);
          return;
        }
        let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
        if (!r.ok || !j) {
          say(`sec        stopped after ${batches} batch(es) -- HTTP ${r.status} ${String(text).slice(0, 120)}`);
          return;
        }
        fetched += j.fetched || 0;
        if (j.done || !j.fetched) {
          say(`sec        up to date -- ${fetched} refetched in ${batches + 1} batch(es)`);
          return;
        }
        // The SEC asks for under ten requests a second and throttles
        // sustained access below that. A batch is already sequential inside
        // itself; this is the gap between batches.
        await sleep(SEC_GAP_MS);
      }
      say(`sec        ${fetched} refetched in ${batches} batch(es) (cap) -- more next run`);
    }

    say(`starting ${FULL ? 'FULL sweep' : 'rotation'} against ${base}`);
    let resp = await call(FULL ? '?start=1&full=1' : '?start=1');
    if (resp.j && resp.j.runId) runId = resp.j.runId;

    let last = -1;
    let stagnant = 0;

    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      const j = resp.j || {};

      // Stopped from /refreshes -- a person pressed Stop, so this is done.
      if (j.stopped) { say('stopped from the refresh runs page -- ending here'); throw new Stop(0); }

      // Another refresh was already in flight. A SKIP IS THE DESIGN WORKING,
      // not a failure: with two scheduled runs a day and a Fast refresh
      // available from /admin, the server is the only thing that can see all
      // of them. Exit 0 so the task does not go red for behaving correctly.
      if (j.skipped) { say(`skipped    ${j.reason || 'another refresh is running'}`); throw new Stop(0); }

      if (j.loaded === undefined || j.loaded === null) {
        const why = resp.err ? resp.err
          : `HTTP ${resp.res ? resp.res.status : '?'} ${String(resp.text || '').slice(0, 140)}`;
        say(`round ${round}  no usable response in ${resp.secs}s -- ${why}`);
        stagnant += 1;
        if (stagnant >= STAGNANT_LIMIT) {
          say(`FAILED  giving up after ${stagnant} rounds without a usable response`);
          await finish();
          throw new Stop(1);
        }
      } else {
        say(`round ${round}  ${j.loaded}/${j.total} profiles in ${resp.secs}s`);
        if (j.done) {
          say(`DONE       ${j.already ? 'already ' + j.already : 'complete'} -- the server has sent the report`);
          await secRotate();
          throw new Stop(0);
        }
        stagnant = j.loaded === last ? stagnant + 1 : 0;
        if (stagnant >= STAGNANT_LIMIT) {
          say(`FAILED  giving up after ${stagnant} rounds with no progress at ${j.loaded}/${j.total}`);
          await finish();
          throw new Stop(1);
        }
        last = j.loaded;
      }

      await sleep(GAP_MS);
      resp = await call('');
    }

    say(`FAILED  hit the ${MAX_ROUNDS}-round ceiling without finishing`);
    await finish();
    throw new Stop(1);
  } catch (e) {
    if (e instanceof Stop) { process.exitCode = e.code; return; }
    say('FAILED  ' + (e && e.message ? e.message : String(e)));
    process.exitCode = 1;
  }
})();
