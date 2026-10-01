// When did each company ANNOUNCE results, according to the SEC?
//
// The newest 8-K carrying ITEM 2.02 -- "Results of Operations and Financial
// Condition" -- which is the earnings release. One date per symbol, written
// into sec_state.last_results.
//
// WHY THIS EXISTS. The vendor's earnings feed goes stale: measured 2026-10-01,
// Micron announced its quarter on 2026-09-30 and Twelve Data's /earnings still
// had 2026-06-24 eighteen hours later, with /statistics.most_recent_quarter
// also a quarter behind. VNO was the same shape in August. EDGAR knows: MU's
// 8-K of 2026-09-30 carries items "2.02,9.01". So this is a second, independent
// answer to "has this company reported", from the company itself.
//
// WHY NOT sec_facts, WHICH WE ALREADY HAVE. That table is built from
// companyfacts, which carries only XBRL-TAGGED facts, and an earnings 8-K
// generally has none -- MU's has zero. Measured across MU, NVDA, AAPL, VNO and
// JPM: not one 8-K row between them. The item number is not in companyfacts at
// any rate; it is in the submissions API, which is what this reads.
//
// WHY ITEM 2.02 RATHER THAN ANY 8-K. An 8-K is filed for officer changes,
// acquisitions, auditor changes and much else. Measured on MU: 10 8-Ks in the
// last year, exactly 4 carrying 2.02 -- one per quarter. A latest-any-8-K date
// would mostly report a director resignation. And it validates: MU's two most
// recent 2.02 dates are 2026-09-30 and 2026-06-24, the second being precisely
// what the vendor's lastEarningsDate says. The new source agrees with the old
// where both have data and holds the quarter the old one is missing.
//
// WHY LOCAL. ~1.15GB across the universe (most files are ~0.16MB but a
// prolific filer like JPM is 4.4MB), which has no business in a serverless
// request -- the backfill-bars.js and insider-load.js precedent. Paced at
// 130ms: the SEC asks for under ten requests a second and throttles sustained
// access below that, and this address has already earned a 429 and then a 403.
//
// ONLY `filings.recent` IS READ. The older archive lives in `filings.files[]`
// and is never fetched: the NEWEST 2.02 is always in the recent block, which
// halves the traffic.
//
//   node --use-system-ca sec-results-load.js                 dry run (default)
//   node --use-system-ca sec-results-load.js --commit
//   node --use-system-ca sec-results-load.js --commit --missing
//   node --use-system-ca sec-results-load.js --commit --only MU,NVDA
//   node --use-system-ca sec-results-load.js --commit --limit 200
'use strict';
require('dotenv').config();
const store = require('./db.js');
const SecFacts = require('./secfacts.js');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const COMMIT = has('--commit');
const MISSING = has('--missing');
// `indexOf` is -1 when the flag is absent, and argv[-1 + 1] is argv[0] -- the
// bug backfill-sec-filed.js shipped, where the node executable became the
// filter and matched nothing. `val` guards it; this is the reminder.
const ONLY = val('--only', '') ? new Set(val('--only', '').split(',').map((s) => s.trim().toUpperCase())) : null;
const LIMIT = Number(val('--limit', '0')) || 0;
const GAP_MS = Number(val('--rate', '130'));

const UA = process.env.SEC_UA
  || `Tickr Lab (${process.env.REPORT_TO || process.env.MAIL_FROM || 'owner@example.com'})`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The extraction lives in secfacts.js, shared with the live SEC refresh in
// server.js -- a second copy of "which 8-K counts" is exactly the drift that
// module exists to prevent. This file is now only the BACKFILL: the nightly
// rotation keeps the dates current by itself.
(async () => {
  const state = await store.readSecState();
  const universe = await store.readUniverse();
  let syms = universe
    .map((s) => String(s).toUpperCase())
    .filter((s) => state[s] && state[s].cik)
    .filter((s) => !ONLY || ONLY.has(s));
  if (MISSING) {
    const have = await store.readSecFiled().catch(() => ({}));
    syms = syms.filter((s) => !(have[s] && have[s].results));
  }
  if (LIMIT) syms = syms.slice(0, LIMIT);

  const noCik = universe.length - universe.filter((s) => state[String(s).toUpperCase()]
    && state[String(s).toUpperCase()].cik).length;
  console.log(`${syms.length} symbols to read (${noCik} have no CIK -- funds and unmapped tickers)`);
  console.log(COMMIT ? 'COMMIT: writing sec_state.last_results' : 'DRY RUN: nothing will be written');

  const t0 = Date.now();
  let ok = 0, wrote = 0, none = 0, failed = 0, bytes = 0;
  const samples = [];

  for (let i = 0; i < syms.length; i++) {
    const sym = syms[i];
    const cik = String(state[sym].cik).padStart(10, '0');
    // EVERY symbol gets its own try, fetch AND write inside it. shortint-load
    // guarded only the fetch, so one transient Turso 404 threw clean out of
    // the loop and abandoned 412 of 1,181 symbols while the receipt said it
    // had succeeded. A blip costs one symbol, never the run -- and the symbol
    // is left UNRECORDED rather than marked done, so --missing picks it up.
    try {
      const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`,
        { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' } });
      if (r.status === 429) {
        console.log(`  ${sym}: HTTP 429 -- the SEC is throttling this address. Stopping; re-run with --missing.`);
        break;
      }
      if (!r.ok) { failed++; continue; }
      const buf = await r.arrayBuffer();
      bytes += buf.byteLength;
      const j = JSON.parse(Buffer.from(buf).toString('utf8'));
      const best = SecFacts.newestResults(j.filings && j.filings.recent);
      ok++;
      if (!best) {
        // Left ALONE rather than written null: a company may simply not have
        // filed a 2.02 in its recent block (a fund never does), and a null
        // would read as "checked, and there is nothing" in a column that
        // cannot tell those apart.
        none++;
      } else {
        if (COMMIT) await store.setSecLastResults(sym, best.d);
        wrote++;                      // counted AFTER the write lands
        if (samples.length < 12) samples.push(`${sym} ${best.d}`);
      }
    } catch (err) {
      failed++;
      console.log(`  ${sym}: ${String(err.message).slice(0, 90)}`);
    }
    if ((i + 1) % 100 === 0) {
      const mins = ((Date.now() - t0) / 60000).toFixed(1);
      console.log(`  ${i + 1}/${syms.length} -- ${wrote} dated, ${none} none, ${failed} failed, `
        + `${(bytes / 1048576).toFixed(0)}MB, ${mins} min`);
    }
    await sleep(GAP_MS);
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\nread ${ok}, dated ${wrote}, no 2.02 ${none}, failed ${failed}`);
  console.log(`${(bytes / 1048576).toFixed(0)}MB in ${mins} min`);
  if (samples.length) console.log('samples: ' + samples.join(', '));
  if (!COMMIT) console.log('\nDRY RUN -- re-run with --commit to write.');
  // Judge this load by the rows it stored, never by how it exited: a piped
  // `| tail` reports tail's exit code, and a closing count over a big table
  // has dropped a socket and exited 1 over a run that worked.
  process.exitCode = 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
