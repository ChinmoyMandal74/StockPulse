// The backfill of `seg_periods`: where each tracked company's revenue comes
// from, year by year and quarter by quarter, read out of its own reports.
//
// THE REFRESH KEEPS THIS CURRENT BY ITSELF. secFetchOne in server.js reads
// each annual and quarterly report a company files after the last one read.
// This is the history behind that, so the stock page has several years and
// quarters from the start rather than growing one report at a time.
//
// WHICH REPORTS (segments.js `plan`): the newest annual report and the one
// three years older, and the six newest quarterly reports. Each carries its
// own period and its comparatives, so that is about six fiscal years and
// nine quarters from eight filings.
//
// REQUESTS: a company's list of filings, then one instance document a report
// (about 1MB to 15MB unpacked, a few hundred KB on the wire) and ONE label
// file a company, reused for its other reports. About ten requests a
// company. Sequential and slow on purpose, to an address that has throttled
// this project before; a 429 stops the run, and running it again resumes,
// since a report already read is not fetched twice. Dry run by default --
// and a dry run still downloads, because that is the only way to see what
// is there.
//
//   node --use-system-ca sec-segments-load.js --limit 20         # report, write nothing
//   node --use-system-ca sec-segments-load.js --commit
//   node --use-system-ca sec-segments-load.js --commit --only AAPL,MSFT
//   node --use-system-ca sec-segments-load.js --commit --redo     # re-read reports already read
require('dotenv').config();
const store = require('./db.js');
const Segments = require('./segments.js');

const COMMIT = process.argv.includes('--commit');
const REDO = process.argv.includes('--redo');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const ONLY = arg('--only') ? new Set(String(arg('--only')).toUpperCase().split(',').filter(Boolean)) : null;
const LIMIT = Number(arg('--limit')) || 0;
const GAP_MS = 250;

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
  console.log(`${syms.length} companies to read; ` + (COMMIT ? 'COMMIT: writing seg_periods' : 'DRY RUN: nothing will be written'));

  const t0 = Date.now();
  let read = 0, withAny = 0, none = 0, done = 0, failed = 0, noReport = 0, years = 0, quarters = 0, stop = false;
  const samples = [];
  for (let i = 0; i < syms.length && !stop; i++) {
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
      const want = Segments.plan(j.filings && j.filings.recent);
      if (!want.length) { noReport++; if (noReport <= 12) console.log(`  ${sym}: no annual or quarterly report among its recent filings`); continue; }
      const seen = REDO ? new Map() : await store.readSegAccns(sym);
      const todo = want.filter((w) => !seen.has(w.accn));
      if (!todo.length) { done++; continue; }
      let labels = '';
      const ends = { FY: new Set(), Q: new Set() };
      for (const report of todo) {
        const got = await Segments.readReport({ cik, report, getText, labelsFrom: labels });
        if (got && got.throttled) { console.log(`  ${sym}: HTTP 429 on a document. Stopping; run again later to resume.`); stop = true; break; }
        if (!got) { failed++; continue; }
        read++;
        if (got.labels) labels = got.labels;
        if (got.periods.length) withAny++; else none++;
        for (const p of got.periods) ends[p.ptype].add(p.end);
        if (COMMIT) await store.writeSegReport(sym, got);
        if (samples.length < 10 && got.periods.length && report === todo[0]) {
          const p = got.periods[0], k = Object.keys(p.kinds)[0], K = p.kinds[k];
          samples.push(`${sym} ${p.ptype} ${p.end} ${k}${K.complete ? '' : ' (partial)'}: ` + K.members.filter((m) => !m.subtotal).slice(0, 4)
            .map((m) => m.name + ' ' + Math.round(m.v / (K.total || p.total) * 100) + '%').join(', '));
        }
      }
      years += ends.FY.size; quarters += ends.Q.size;
    } catch (err) {
      failed++;
      console.log(`  ${sym}: ${String(err.message).slice(0, 90)}`);
    }
    if ((i + 1) % 50 === 0) {
      console.log(`  ${i + 1}/${syms.length} -- ${read} reports read (${withAny} with a breakdown, ${none} with none), ${years} years and ${quarters} quarters, ${done} companies already done, ${failed} failed, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    }
  }
  console.log(`\nread ${read} reports: ${withAny} with a breakdown, ${none} with none; ${years} fiscal years and ${quarters} quarters; ${done} companies already done; ${noReport} with no report in their list; ${failed} failed; ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  for (const s of samples) console.log('  ' + s.slice(0, 200));
  if (!COMMIT) console.log('DRY RUN: nothing written. Re-run with --commit.');
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
