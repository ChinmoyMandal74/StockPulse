// First fill of `sec_events`: every tracked company's 8-K filings of the past
// 400 days, from the SEC's submissions feed.
//
// THE REFRESH KEEPS THIS CURRENT BY ITSELF. secFetchOne in server.js reads the
// same feed for every company it re-reads and writes its events through the
// same function this uses (events8k.js, store.writeSecEvents). This is only
// the backfill, so the screener's column and the stock page's list are not
// empty until the rotation has been round once.
//
// ONE REQUEST PER COMPANY to an address that has throttled this project
// before (a 429, then a 403), so it is sequential and slow on purpose, a 429
// stops the run rather than being retried, and --missing resumes it.
// Dry run by default.
//
//   node --use-system-ca sec-events-load.js                    # report, write nothing
//   node --use-system-ca sec-events-load.js --commit
//   node --use-system-ca sec-events-load.js --commit --only AAPL,MSFT
//   node --use-system-ca sec-events-load.js --commit --limit 50
require('dotenv').config();
const store = require('./db.js');
const Events8k = require('./events8k.js');

const COMMIT = process.argv.includes('--commit');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const ONLY = arg('--only') ? new Set(String(arg('--only')).toUpperCase().split(',').filter(Boolean)) : null;
const LIMIT = Number(arg('--limit')) || 0;
const GAP_MS = 350;

// The server's own declaration: the SEC refuses a client that does not say who it is.
const UA = process.env.SEC_UA
  || `Tickr Lab (${process.env.REPORT_TO || process.env.MAIL_FROM || 'owner@example.com'})`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const state = await store.readSecState();
  const universe = await store.readUniverse();
  let syms = universe.map((s) => String(s).toUpperCase())
    .filter((s) => state[s] && state[s].cik)
    .filter((s) => !ONLY || ONLY.has(s));
  if (LIMIT) syms = syms.slice(0, LIMIT);
  console.log(`${syms.length} companies to read; ` + (COMMIT ? 'COMMIT: writing sec_events' : 'DRY RUN: nothing will be written'));

  const since = Events8k.sinceDate();
  const t0 = Date.now();
  let ok = 0, events = 0, none = 0, failed = 0;
  const kinds = {};
  const samples = [];
  for (let i = 0; i < syms.length; i++) {
    const sym = syms[i];
    const cik = String(state[sym].cik).padStart(10, '0');
    // Fetch AND write inside one try, per symbol: a blip costs one company,
    // never the run (the short-interest loader's lesson).
    try {
      const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`,
        { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(60000) });
      if (r.status === 429) { console.log(`  ${sym}: HTTP 429 -- the SEC is throttling this address. Stopping; re-run later.`); break; }
      if (!r.ok) { failed++; continue; }
      const j = await r.json();
      const list = Events8k.parse(j.filings && j.filings.recent, since);
      ok++;
      if (!list.length) none++;
      events += list.length;
      for (const e of list) for (const c of Events8k.codesOf(e.items)) kinds[c] = (kinds[c] || 0) + 1;
      if (COMMIT) await store.writeSecEvents(sym, list, since);
      if (samples.length < 6 && list.length) samples.push(`${sym} ${list[0].filed} ${Events8k.label(list[0].items, 2)}`);
    } catch (err) {
      failed++;
      console.log(`  ${sym}: ${String(err.message).slice(0, 90)}`);
    }
    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${syms.length} -- ${events} events, ${none} with none, ${failed} failed, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    }
    await sleep(GAP_MS);
  }
  console.log(`\nread ${ok} of ${syms.length}; ${events} events since ${since}; ${none} companies with none; ${failed} failed; ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  console.log('by item: ' + Object.keys(kinds).sort((a, b) => kinds[b] - kinds[a]).slice(0, 14)
    .map((c) => `${c} ${(Events8k.ITEMS[c] || ['?'])[0]} ${kinds[c]}`).join(' | '));
  for (const s of samples) console.log('  ' + s);
  if (!COMMIT) console.log('DRY RUN: nothing written. Re-run with --commit.');
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
