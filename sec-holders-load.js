// First fill of `sec_holders`: the Schedule 13D and 13G filings about every
// tracked company over the past 400 days.
//
// THE REFRESH KEEPS THIS CURRENT BY ITSELF. secFetchOne in server.js reads up
// to three new filings a company each time it re-reads that company, through
// the same function this uses (holders13.js `collect`). This is the backfill,
// which reads them ALL so the stock page and the column are not partial for
// the weeks a three-at-a-time catch-up would take.
//
// TWO KINDS OF REQUEST: one list per company, then one small document (about
// 5KB) per filing not already stored. Sequential and slow on purpose, to an
// address that has throttled this project before; a 429 stops the run rather
// than being retried, and running it again resumes, since a stored filing is
// never fetched twice. Dry run by default -- and a dry run still fetches the
// documents, because that is the only way to count what is there.
//
//   node --use-system-ca sec-holders-load.js --limit 20          # report, write nothing
//   node --use-system-ca sec-holders-load.js --commit
//   node --use-system-ca sec-holders-load.js --commit --only GME,AAPL
require('dotenv').config();
const store = require('./db.js');
const Holders13 = require('./holders13.js');

const COMMIT = process.argv.includes('--commit');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const ONLY = arg('--only') ? new Set(String(arg('--only')).toUpperCase().split(',').filter(Boolean)) : null;
const LIMIT = Number(arg('--limit')) || 0;
const GAP_MS = 250;

const UA = process.env.SEC_UA
  || `Tickr Lab (${process.env.REPORT_TO || process.env.MAIL_FROM || 'owner@example.com'})`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getDoc = async (u) => {
  const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(30000) });
  return { status: r.status, text: r.ok ? await r.text() : '' };
};

(async () => {
  const state = await store.readSecState();
  const universe = await store.readUniverse();
  let syms = universe.map((s) => String(s).toUpperCase())
    .filter((s) => state[s] && state[s].cik)
    .filter((s) => !ONLY || ONLY.has(s));
  if (LIMIT) syms = syms.slice(0, LIMIT);
  console.log(`${syms.length} companies to read; ` + (COMMIT ? 'COMMIT: writing sec_holders' : 'DRY RUN: nothing will be written'));

  const since = Holders13.sinceDate();
  const t0 = Date.now();
  let ok = 0, docs = 0, d13 = 0, g13 = 0, notAbout = 0, withAny = 0, failed = 0, stopped = false;
  const samples = [];
  for (let i = 0; i < syms.length && !stopped; i++) {
    const sym = syms[i];
    const cik = Number(state[sym].cik);
    try {
      const r = await fetch(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`,
        { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(60000) });
      if (r.status === 429) { console.log(`  ${sym}: HTTP 429 -- the SEC is throttling this address. Stopping; run again later to resume.`); break; }
      if (!r.ok) { failed++; await sleep(GAP_MS); continue; }
      const j = await r.json();
      const have = await store.readSecHolderAccns(sym);
      const got = await Holders13.collect({ cik, recent: j.filings && j.filings.recent, since, have, max: 200, getDoc, gap: GAP_MS });
      ok++;
      docs += got.rows.length;
      let any = false;
      for (const x of got.rows) {
        if (x.kind === 'D') { d13++; any = true; } else if (x.kind === 'G') { g13++; any = true; } else notAbout++;
        if (x.kind === 'D' && samples.length < 8) samples.push(`${sym} ${x.filed} ${Holders13.label(x.kind, x.holder, x.pct, 40)}`);
      }
      if (any) withAny++;
      if (COMMIT && got.rows.length) await store.writeSecHolders(sym, got.rows, since);
      if (got.throttled) { console.log(`  ${sym}: HTTP 429 on a document. Stopping; run again later to resume.`); stopped = true; }
    } catch (err) {
      failed++;
      console.log(`  ${sym}: ${String(err.message).slice(0, 90)}`);
    }
    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${syms.length} -- ${docs} documents (${d13} 13D, ${g13} 13G, ${notAbout} not about the company), ${failed} failed, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    }
    await sleep(GAP_MS);
  }
  console.log(`\nread ${ok} of ${syms.length} companies; ${docs} documents since ${since}: ${d13} 13D, ${g13} 13G, ${notAbout} not about the company; `
    + `${withAny} companies with at least one; ${failed} failed; ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  for (const s of samples) console.log('  ' + s);
  if (!COMMIT) console.log('DRY RUN: nothing written. Re-run with --commit.');
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
