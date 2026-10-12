// Read every tracked stock's options open interest from the Options Clearing
// Corporation and store it. LOCAL: run from the owner's machine.
//
// WHY THERE IS A LOCAL LOADER AS WELL AS A ROUTE. The deployed app has
// /api/options/refresh, which the nightly ping drives a batch at a time. The
// OCC's site sits behind a service that challenges some data-centre
// addresses, so that route may be refused where this machine is not; this
// does the same work from here, and was the first fill (2026-10-11).
//
// ONE REQUEST A STOCK, sequential, a pause between. An HTML page where a
// report should be is the OCC refusing: the run stops, and running it again
// resumes, since a stock read in the last twenty hours is skipped. Dry run
// by default -- and a dry run still downloads, the only way to see what is
// there.
//
//   node --use-system-ca options-load.js --limit 20          # report, write nothing
//   node --use-system-ca options-load.js --commit
//   node --use-system-ca options-load.js --commit --only AAPL,SPY
//   node --use-system-ca options-load.js --commit --all       # re-read even the fresh ones
require('dotenv').config();
const store = require('./db.js');
const OptionsOI = require('./optionsoi.js');

const COMMIT = process.argv.includes('--commit');
const ALL = process.argv.includes('--all');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const ONLY = arg('--only') ? new Set(String(arg('--only')).toUpperCase().split(',').filter(Boolean)) : null;
const LIMIT = Number(arg('--limit')) || 0;
const GAP_MS = 300;
const FRESH_MS = 20 * 60 * 60 * 1000;
const UA = process.env.SEC_UA || `Tickr Lab (${process.env.REPORT_TO || process.env.MAIL_FROM || 'owner@example.com'})`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const universe = (await store.readUniverse()).map((s) => String(s).toUpperCase());
  const state = await store.readOptionsAll();
  const date = OptionsOI.asOf();
  let syms = universe.filter((s) => !ONLY || ONLY.has(s))
    .filter((s) => ALL || ONLY || !state[s] || (Date.now() - state[s].at > FRESH_MS && state[s].d !== date));
  if (LIMIT) syms = syms.slice(0, LIMIT);
  console.log(`${syms.length} stocks to read (of ${universe.length}), as of ${date}; ` + (COMMIT ? 'COMMIT: writing options_state and options_oi' : 'DRY RUN: nothing will be written'));
  const t0 = Date.now();
  let ok = 0, none = 0, failed = 0, calls = 0, puts = 0;
  const samples = [];
  for (let i = 0; i < syms.length; i++) {
    const sym = syms[i];
    try {
      const r = await fetch(OptionsOI.url(sym), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(40000) });
      if (r.status === 429 || r.status === 403) { console.log(`  ${sym}: HTTP ${r.status} -- the OCC is refusing this address. Stopping; run again later to resume.`); break; }
      if (!r.ok) { failed++; await sleep(GAP_MS); continue; }
      const got = OptionsOI.parse(await r.text(), sym);
      await sleep(GAP_MS);
      if (got.status === 'blocked') { console.log(`  ${sym}: a web page came back instead of the report. Stopping; run again later to resume.`); break; }
      if (got.status === 'unread') { failed++; continue; }
      if (got.status !== 'ok') { none++; if (COMMIT) await store.writeOptions(sym, { status: 'none' }); continue; }
      const s = OptionsOI.summarise(got.series, date);
      ok++; calls += s.call; puts += s.put;
      if (samples.length < 8) samples.push(`${sym} calls ${s.call.toLocaleString('en-US')} puts ${s.put.toLocaleString('en-US')} put/call ${OptionsOI.pcr(s.call, s.put) == null ? 'n/a' : OptionsOI.pcr(s.call, s.put).toFixed(2)} over ${s.expiryCount} expiries`);
      if (COMMIT) {
        await store.writeOptions(sym, { status: 'ok', d: date, call: s.call, put: s.put,
          data: { expiries: s.expiries, expiryCount: s.expiryCount, seriesCount: s.seriesCount, topCalls: s.topCalls, topPuts: s.topPuts } });
      }
    } catch (err) {
      failed++;
      console.log(`  ${sym}: ${String(err.message).slice(0, 90)}`);
    }
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${syms.length} -- ${ok} with options, ${none} with none, ${failed} failed, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  }
  console.log(`\n${ok} with options, ${none} with none, ${failed} failed; ${calls.toLocaleString('en-US')} calls and ${puts.toLocaleString('en-US')} puts open between them; ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  for (const s of samples) console.log('  ' + s);
  if (!COMMIT) console.log('DRY RUN: nothing written. Re-run with --commit.');
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
