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
// OVERRIDABLE SO THIS DRIVER CAN BE TESTED AT ALL, the way SEC_MAX_BATCHES
// already is. A stall takes STAGNANT_LIMIT rounds, so at 65s the one thing
// worth asserting here -- that a stalled rotation still runs the tail phases
// -- costs three and a half minutes a case, and the alternative is to test a
// PATCHED COPY, which proves something about a file nobody runs.
const GAP_MS = Number(process.env.NIGHTLY_GAP_MS) || 65000;
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
// 30 BATCHES OF 5, NOT 20 (2026-10-08). Twenty is 100 companies a run and
// 1,000 a week over ten weekday runs, against 1,274 to cover -- so the
// rotation could not finish a lap inside its own 7-day cutoff and 481
// companies sat 7 to 14 days unchecked, measured. Thirty is 1,500 a week.
// It adds about 45 seconds to a run and stays inside what the SEC asks.
const SEC_MAX_BATCHES = Number(process.env.SEC_MAX_BATCHES) || 30;
const SEC_GAP_MS = Number(process.env.NIGHTLY_SEC_GAP_MS) || 1500;
// Split history: at most this many calls a run, 20 symbols a call, a minute
// apart -- each call is up to 400 of the 610 credits a minute.
const SPLIT_MAX_CALLS = Number(process.env.SPLIT_MAX_CALLS) || 5;
const SPLIT_GAP_MS = Number(process.env.NIGHTLY_SPLIT_GAP_MS) || 65000;
// Insider filings: one day of the SEC daily index per call, at most this many a run.
const INSIDER_MAX_DAYS = Number(process.env.INSIDER_MAX_DAYS) || 6;

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

// A DEATH OUTSIDE THE TRY LEAVES NO TRACE WITHOUT THIS, and it has happened:
// news-ping.js lost the 13:00 lap of 2026-10-01 that way -- twelve batches on
// the server, eleven in the log, exit 1, no FAILED line, no crash record. Task
// Scheduler discards stderr, so the log is the only record this job has, and
// every deliberate failure path below writes to it. These two handlers cannot
// prevent the death; they make it diagnosable. It matters most here: this run
// is unattended, ~37 minutes, and dozens of calls long.
//
// process.exit, against the rule directly above, and it is NOT optional here:
// registering either handler suppresses Node's own exit, so the process would
// survive the fault and run on to `DONE` and `throw new Stop(0)`, overwriting
// exitCode 1 with 0 -- a green task with DONE logged under FAILED. The log
// write is synchronous and already on disk by then, so even the Windows
// UV_HANDLE_CLOSING assertion leaves the evidence and a non-zero code, which
// is all that is asked of a run that has already failed.
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (err) => {
    const detail = err && err.stack ? err.stack : String(err);
    say(`FAILED  ${ev} -- ${detail.split('\n').slice(0, 4).join(' | ')}`);
    process.exit(1);
  });
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

    // FINRA short interest. ONE call, and on most nights it writes nothing:
    // the position is published twice a month, so the route asks FINRA for its
    // own newest settlement date and acts only when we do not hold it. No
    // batching and no cap, because there is nothing to pace -- a run is one
    // small read plus one POST, and twice a month one 2.75MB download.
    //
    // NON-FATAL, like secRotate, and for the same reasons: a 404 reads as an
    // older server so deploy order does not matter, and this data is already
    // eight business days old when it appears. Losing a night costs nothing
    // because the check is self-pacing -- tomorrow's run catches it.
    async function shortRotate() {
      let r; let text;
      try {
        r = await fetch(`${base}/api/cron/shortint`, {
          signal: AbortSignal.timeout(300000),
          headers: { Authorization: 'Bearer ' + secret },
        });
        text = await r.text();
      } catch (e) {
        say(`short      skipped -- ${e.name === 'TimeoutError' ? 'timed out' : e.message}`);
        return;
      }
      let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
      if (r.status === 404) { say('short      skipped -- older server, no route yet'); return; }
      if (!r.ok || !j) {
        say(`short      skipped -- HTTP ${r.status} ${String(text).slice(0, 120)}`);
        return;
      }
      if (j.readings) {
        say(`short      ${j.settlement} loaded -- ${j.readings} readings for ${j.symbols} symbols (was ${j.was})`);
      } else if (j.pending) {
        say(`short      ${j.pending} is dated but not published yet -- holding ${j.held}`);
      } else if (j.error) {
        say(`short      FINRA unreachable (${String(j.error).slice(0, 60)}) -- holding ${j.held}`);
      } else {
        say(`short      up to date at ${j.already || j.finra || 'unknown'}`);
      }
    }

    // Index membership from the issuer's daily holdings file. NON-FATAL and
    // its own phase, like secRotate and shortRotate above, and never in the
    // refresh tail: work put there has surfaced as "the refresh failed" over
    // perfectly good data three times on this project (news 2026-09-18,
    // techHistorySpan 2026-09-19, archiveStats 2026-09-20).
    //
    // A 404 reads as an older server, so deploy order never matters.
    //
    // One 54KB fetch, and on most days it writes nothing: the route compares
    // the file's own as-of date against what is stored and stands down.
    async function holdingsRotate() {
      let r; let text;
      try {
        r = await fetch(`${base}/api/cron/holdings`, {
          signal: AbortSignal.timeout(120000),
          headers: { Authorization: 'Bearer ' + secret },
        });
        text = await r.text();
      } catch (e) {
        say(`holdings   skipped -- ${e.name === 'TimeoutError' ? 'timed out' : e.message}`);
        return;
      }
      let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
      if (r.status === 404) { say('holdings   skipped -- older server, no route yet'); return; }
      if (!r.ok || !j) {
        say(`holdings   skipped -- HTTP ${r.status} ${String(text).slice(0, 120)}`);
        return;
      }
      if (j.holdings && j.asOf) {
        say(`holdings   ${j.index || j.fund} as of ${j.asOf} -- ${j.holdings} holdings `
          + `(was ${j.was || 'nothing'}), weights sum ${j.weightSum}`);
      } else if (j.refused) {
        // The floor, the HTML-body guard, or a layout change. Worth a line
        // that names it: nothing was written, so the stored membership is
        // intact but is now a day staler than it looks.
        say(`holdings   REFUSED the file -- ${String(j.refused).slice(0, 110)}`);
      } else if (j.error || j.reason) {
        say(`holdings   unreachable (${String(j.error || j.reason).slice(0, 60)}) -- holding ${j.held || 'nothing'}`);
      } else {
        say(`holdings   up to date at ${j.already || j.fileAsOf || 'unknown'}`);
      }
    }

    // THE TAIL PHASES ARE INDEPENDENT OF PROFILE COVERAGE, and gating them on
    // `j.done` meant one unservable ticker could switch all three off.
    //
    // Measured 2026-10-02: the rotation stalled at 1225/1302 behind twenty
    // tickers the provider cannot serve -- a refused pull leaves fetched_at at
    // 0, the retry sentinel, so the same twenty were re-picked every round and
    // blocked the sixty good ones behind them. SEC filings, FINRA short
    // interest and the index holdings import were therefore skipped on every
    // night it happened, for days, SILENTLY: the night reports itself failed
    // for the ROTATION's reason and nothing says the other three never ran. A
    // brand-new scheduled import would never have fired unattended.
    //
    // They run after `finish()`, which clears the refresh flag and lets the
    // server report what it gathered -- so nothing is competing for the
    // database by the time these start. That ordering is what makes this safe,
    // and it is why they are NOT run on the two exits where something else is,
    // or was deliberately put, in charge: a human Stop, and a skip because
    // another refresh is already in flight.
    //
    // The night still reports FAILED and still exits 1. The rotation really did
    // fail, and a green task would hide that. What changes is only that three
    // unrelated subsystems no longer fail with it.
    // INSIDER TRANSACTIONS, the days since the last walk. One day per call;
    // a weekend or holiday is a call that fetches nothing. A throttle or an
    // error stops it for this run -- the cursor has not moved, so the next
    // run resumes at the same day. A long gap still belongs to
    // insider-load.js on this machine.
    async function insiderRotate() {
      let days = 0; let rows = 0; let through = null;
      for (let i = 0; i < INSIDER_MAX_DAYS; i += 1) {
        let r; let text;
        try {
          r = await fetch(`${base}/api/insider/daily`, {
            method: 'POST', signal: AbortSignal.timeout(290000),
            headers: { Authorization: 'Bearer ' + secret },
          });
          text = await r.text();
        } catch (e) {
          say(`insider    stopped -- ${e.name === 'TimeoutError' ? 'timed out' : e.message}`);
          break;
        }
        let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
        if (r.status === 403 || r.status === 404) { say('insider    skipped -- older server'); return; }
        if (!r.ok || !j) { say(`insider    stopped -- HTTP ${r.status} ${String(text).slice(0, 110)}`); break; }
        if (j.throttled) { say('insider    stopped -- the SEC is rate-limiting; resumes next run'); break; }
        if (j.day) { days += 1; rows += Number(j.rows || 0); through = j.day; }
        if (j.skipped && !j.day) { say(`insider    ${j.skipped}`); break; }
        if (j.done || !j.day) break;
        await sleep(SEC_GAP_MS);
      }
      say(days ? `insider    ${days} day(s) walked through ${through}, ${rows} transactions` : 'insider    up to date');
    }

    // SPLIT HISTORY, kept current: a newly added stock, or one whose profile
    // now names a split newer than any stored. Usually nothing is due and this
    // is one call that fetches nothing. Non-fatal, and a 404 is an older server.
    async function splitRotate() {
      for (let i = 0; i < SPLIT_MAX_CALLS; i += 1) {
        let r; let text;
        try {
          r = await fetch(`${base}/api/cron/splits`, {
            signal: AbortSignal.timeout(240000),
            headers: { Authorization: 'Bearer ' + secret },
          });
          text = await r.text();
        } catch (e) {
          say(`splits     skipped -- ${e.name === 'TimeoutError' ? 'timed out' : e.message}`);
          return;
        }
        let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
        if (r.status === 404) { say('splits     skipped -- older server, no route yet'); return; }
        if (!r.ok || !j) { say(`splits     skipped -- HTTP ${r.status} ${String(text).slice(0, 120)}`); return; }
        if (j.skipped) { say(`splits     skipped -- ${j.skipped} (${j.due} due)`); return; }
        if (!j.due) { say('splits     up to date'); return; }
        const failed = (j.failed || []).length;
        say(`splits     ${j.fetched} fetched${failed ? ', ' + failed + ' failed (' + j.failed.slice(0, 6).join(',') + ')' : ''}`
          + `${(j.changed || []).length ? ', new split on ' + j.changed.join(',') : ''}, ${j.remaining} still due`);
        if (!j.remaining) return;
        await sleep(SPLIT_GAP_MS);
      }
    }

    let tailDone = false;
    async function tailPhases(why) {
      if (tailDone) return;
      tailDone = true;
      if (why) say(`tail       ${why} -- running SEC, short interest, holdings, insiders and splits anyway`);
      // EACH IS GUARDED SEPARATELY. One of them throwing must not cost the
      // other two their turn, which is the same mistake one level up that this
      // whole change exists to undo. All three are internally defensive today,
      // so reverting this loop currently fails nothing -- it is kept because
      // adding a FOURTH phase here is a one-line change, and a new phase is
      // exactly the thing likely to throw.
      for (const [name, fn] of [['sec', secRotate], ['short', shortRotate], ['holdings', holdingsRotate], ['insider', insiderRotate], ['splits', splitRotate]]) {
        try {
          await fn();
        } catch (e) {
          say(`${name.padEnd(10)} skipped -- ${(e && e.message) ? String(e.message).slice(0, 110) : String(e)}`);
        }
      }
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
          await tailPhases('the rotation gave up');
          throw new Stop(1);
        }
      } else {
        say(`round ${round}  ${j.loaded}/${j.total} profiles in ${resp.secs}s`);
        if (j.done) {
          say(`DONE       ${j.already ? 'already ' + j.already : 'complete'} -- the server has sent the report`);
          await tailPhases();
          throw new Stop(0);
        }
        stagnant = j.loaded === last ? stagnant + 1 : 0;
        if (stagnant >= STAGNANT_LIMIT) {
          say(`FAILED  giving up after ${stagnant} rounds with no progress at ${j.loaded}/${j.total}`);
          await finish();
          await tailPhases(`the rotation stalled at ${j.loaded}/${j.total}`);
          throw new Stop(1);
        }
        last = j.loaded;
      }

      await sleep(GAP_MS);
      resp = await call('');
    }

    say(`FAILED  hit the ${MAX_ROUNDS}-round ceiling without finishing`);
    await finish();
    await tailPhases(`the rotation hit the ${MAX_ROUNDS}-round ceiling`);
    throw new Stop(1);
  } catch (e) {
    if (e instanceof Stop) { process.exitCode = e.code; return; }
    say('FAILED  ' + (e && e.message ? e.message : String(e)));
    process.exitCode = 1;
  }
})();
