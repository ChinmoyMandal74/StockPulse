// First fill of `sec_segments`: where each tracked company's revenue comes
// from, read out of its newest annual report.
//
// THE REFRESH KEEPS THIS CURRENT BY ITSELF. secFetchOne in server.js reads a
// company's newest annual report the first time it sees one it has not read
// (segments.js `collect`), which is once a year a company. This is the
// backfill, so the stock page and the card are not empty until then.
//
// THREE REQUESTS A COMPANY: its list of filings, the report's instance
// document and its label file. The instance is the large one (about 1MB to
// 15MB unpacked, a few hundred KB on the wire). Sequential and slow on
// purpose, to an address that has throttled this project before; a 429 stops
// the run, and running it again resumes, since a report already on file is
// not fetched twice. Dry run by default -- and a dry run still downloads,
// because that is the only way to see what is there.
//
//   node --use-system-ca sec-segments-load.js --limit 20         # report, write nothing
//   node --use-system-ca sec-segments-load.js --commit
//   node --use-system-ca sec-segments-load.js --commit --only AAPL,MSFT
//   node --use-system-ca sec-segments-load.js --commit --redo     # re-read reports already on file
require('dotenv').config();
const store = require('./db.js');
const Segments = require('./segments.js');

const COMMIT = process.argv.includes('--commit');
const REDO = process.argv.includes('--redo');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const ONLY = arg('--only') ? new Set(String(arg('--only')).toUpperCase().split(',').filter(Boolean)) : null;
const LIMIT = Number(arg('--limit')) || 0;
const GAP_MS = 300;

const UA = process.env.SEC_UA
  || `Tickr Lab (${process.env.REPORT_TO || process.env.MAIL_FROM || 'owner@example.com'})`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getText = async (u) => {
  const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(90000) });
  const text = r.ok ? await r.text() : '';
  await sleep(GAP_MS);
  return { status: r.status, text };
};

(async () => {
  const state = await store.readSecState();
  const universe = await store.readUniverse();
  let syms = universe.map((s) => String(s).toUpperCase())
    .filter((s) => state[s] && state[s].cik)
    .filter((s) => !ONLY || ONLY.has(s));
  if (LIMIT) syms = syms.slice(0, LIMIT);
  console.log(`${syms.length} companies to read; ` + (COMMIT ? 'COMMIT: writing sec_segments' : 'DRY RUN: nothing will be written'));

  const t0 = Date.now();
  let ok = 0, withAny = 0, none = 0, same = 0, failed = 0, noAnnual = 0;
  const kinds = { product: 0, segment: 0, geo: 0 }, complete = { product: 0, segment: 0, geo: 0 };
  const samples = [];
  for (let i = 0; i < syms.length; i++) {
    const sym = syms[i];
    const cik = Number(state[sym].cik);
    // Fetch AND write inside one try, per symbol: a blip costs one company.
    try {
      const r = await fetch(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`,
        { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(60000) });
      if (r.status === 429) { console.log(`  ${sym}: HTTP 429 -- the SEC is throttling this address. Stopping; run again later to resume.`); break; }
      if (!r.ok) { failed++; await sleep(GAP_MS); continue; }
      const j = await r.json();
      await sleep(GAP_MS);
      const recent = j.filings && j.filings.recent;
      if (!Segments.latestAnnual(recent)) { noAnnual++; if (noAnnual <= 12) console.log(`  ${sym}: no annual report among its ${recent && recent.form ? recent.form.length : 0} most recent filings`); continue; }
      const have = REDO ? null : await store.readSecSegmentAccn(sym);
      const got = await Segments.collect({ cik, recent, haveAccn: have, getText });
      if (got && got.throttled) { console.log(`  ${sym}: HTTP 429 on a document. Stopping; run again later to resume.`); break; }
      if (!got) { same++; continue; }
      ok++;
      if (got.data) {
        withAny++;
        for (const k of Object.keys(got.data.kinds)) { kinds[k]++; if (got.data.kinds[k].complete) complete[k]++; }
        if (samples.length < 10) {
          const k = Object.keys(got.data.kinds)[0], K = got.data.kinds[k];
          samples.push(`${sym} ${got.data.fyEnd} ${k}${K.complete ? '' : ' (partial)'}: ` + K.members.filter((m) => !m.subtotal).slice(0, 4)
            .map((m) => m.name + ' ' + Math.round(m.v / (K.total || got.data.total) * 100) + '%').join(', '));
        }
      } else none++;
      if (COMMIT) await store.writeSecSegments(sym, got);
    } catch (err) {
      failed++;
      console.log(`  ${sym}: ${String(err.message).slice(0, 90)}`);
    }
    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${syms.length} -- ${withAny} with a breakdown, ${none} with none, ${same} already on file, ${failed} failed, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    }
  }
  console.log(`\nread ${ok} reports: ${withAny} with a breakdown, ${none} with none; ${same} already on file; ${noAnnual} companies with no annual report in their list; ${failed} failed; ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  console.log('breakdowns: ' + Object.keys(kinds).map((k) => `${k} ${kinds[k]} (${complete[k]} add up to the total)`).join(' | '));
  for (const s of samples) console.log('  ' + s.slice(0, 200));
  if (!COMMIT) console.log('DRY RUN: nothing written. Re-run with --commit.');
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
