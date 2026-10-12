// Ask the DEPLOYED app to re-read every company's SEC filings once.
//
// WHEN THIS IS NEEDED: after a change to what the filings reader keeps (a
// new concept in secfacts.js, as with capital returns on 2026-10-11). A
// stored row predates the change and holds nothing for the new figure until
// its company is next re-read, which the nightly rotation would get to over
// about a week. This does the whole universe in one sitting.
//
// IT IS HTTP CALLS AND NOTHING ELSE, like the ping scripts: the deployed app
// does the fetching, at /api/sec/refresh?mode=all, a few companies a call.
// It must never become `node server.js`.
//
// PACED ON PURPOSE. The SEC has answered 429 and then 403 to this project
// before. One batch, a pause, the next; any refusal or error stops the run,
// and running it again with the printed --since carries on where it stopped
// (the app treats a company fetched after that moment as done).
//
//   node --use-system-ca sec-reread.js                 # says what it would do
//   node --use-system-ca sec-reread.js --commit
//   node --use-system-ca sec-reread.js --commit --since 1760227200000
const fs = require('fs');
const path = require('path');

const COMMIT = process.argv.includes('--commit');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const BATCH = 5;
const GAP_MS = 2500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fromEnvFile(key) {
  try {
    const m = new RegExp('^' + key + '\\s*=\\s*(.*)$', 'm').exec(fs.readFileSync(path.join(__dirname, '.env'), 'utf8'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch { return ''; }
}

(async () => {
  const secret = fromEnvFile('CRON_SECRET');
  const base = (fromEnvFile('APP_URL') || 'https://www.tickrlab.com').replace(/\/+$/, '');
  if (!secret) { console.log('CRON_SECRET is not in .env -- copy it from the Vercel project settings.'); process.exitCode = 1; return; }
  const since = Number(arg('--since')) || Date.now();
  console.log(`${base}: re-read every company's filings, ${BATCH} a call, ${GAP_MS / 1000}s apart. since=${since}`);
  if (!COMMIT) { console.log('DRY RUN: nothing asked. Re-run with --commit.'); return; }
  const t0 = Date.now();
  let fetched = 0, okN = 0, calls = 0;
  for (;;) {
    let r, text;
    try {
      r = await fetch(`${base}/api/sec/refresh?mode=all&n=${BATCH}&since=${since}`, {
        method: 'POST', signal: AbortSignal.timeout(300000), headers: { Authorization: 'Bearer ' + secret } });
      text = await r.text();
    } catch (e) { console.log(`stopped after ${calls} call(s): ${e.name === 'TimeoutError' ? 'timed out' : e.message}. Resume with --since ${since}`); process.exitCode = 1; return; }
    let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    if (!r.ok || !j) { console.log(`stopped after ${calls} call(s): HTTP ${r.status} ${String(text).slice(0, 120)}. Resume with --since ${since}`); process.exitCode = 1; return; }
    calls++; fetched += j.fetched || 0; okN += j.ok || 0;
    // A batch where EVERY company errored is the SEC refusing: stop, do not
    // push on. A batch of funds is not that: a fund has no CIK and answers
    // 'nocik', and five of them in a row stopped the first run 105 short.
    if (j.fetched && (j.results || []).length && (j.results || []).every((x) => x.status === 'error')) { console.log(`stopped after ${calls} call(s): a whole batch failed (${JSON.stringify((j.results || []).map((x) => x.status)).slice(0, 120)}). Resume with --since ${since}`); process.exitCode = 1; return; }
    if (calls % 20 === 0) console.log(`  ${fetched} re-read (${okN} ok), ${j.remaining} to go, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    if (j.done || !j.fetched) break;
    await sleep(GAP_MS);
  }
  console.log(`done: ${fetched} re-read, ${okN} ok, ${calls} calls, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
})();
