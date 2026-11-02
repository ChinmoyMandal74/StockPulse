// First fill of the IPO pipeline (ipos.js, /ipos): every S-1, F-1, final
// prospectus, effectiveness notice and withdrawal in the SEC's daily indexes
// since a start day (2025-01-02 by default), queued and read through the same
// step the morning filings check runs, so the page opens with the companies
// already in registration (Anthropic, PBC among them) rather than only the
// ones that file from now on.
//
// THE MORNING CHECK KEEPS THIS CURRENT BY ITSELF (/api/sec/daily queues each
// day's lines and works the queue). This is only the backfill.
//
// One request at a time to an address that has throttled this project before
// (a 429, then a 403): sequential, a gap between requests, and a 429 stops
// the run with the queue kept in app_meta, so running it again resumes.
// Dry run by default: reads the indexes and reports, writes nothing.
//
//   node --use-system-ca ipo-load.js                       # report only
//   node --use-system-ca ipo-load.js --commit
//   node --use-system-ca ipo-load.js --commit --from 2025-06-01
//   node --use-system-ca ipo-load.js --commit --resume     # skip the indexes, work the stored queue
//   node --use-system-ca ipo-load.js --commit --recheck    # judge every company again from scratch
//   node --use-system-ca ipo-load.js --restatus [--commit] # each kept company's status again, from what is stored (no SEC requests)
//
// --recheck (2026-11-02): the first fill judged a company on its first
// registration statement and read only the recent filing list; the rule is
// now "no annual or quarterly report before the S-1 that brought it here",
// with the older filing files read when the recent list is too short. It
// re-reads the indexes, ignores what is stored, and writes every verdict over
// the old one (a company left out now is marked so; its filings stay stored).
require('dotenv').config();
const store = require('./db.js');
const Ipos = require('./ipos.js');
const SecDaily = require('./secdaily.js');

const COMMIT = process.argv.includes('--commit');
const RESUME = process.argv.includes('--resume');
const RECHECK = process.argv.includes('--recheck');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const FROM = /^\d{4}-\d{2}-\d{2}$/.test(arg('--from') || '') ? arg('--from') : '2025-01-02';
const GAP_MS = 400;
const COVER_BYTES = 600000;

// The server's declaration, with the address lifted out of a mail header.
const contact = (s) => (/<([^>]+)>/.exec(String(s || '')) || [, s])[1] || '';
const UA = process.env.SEC_UA || `Tickr Lab (${contact(process.env.REPORT_TO || process.env.MAIL_FROM || '').trim()})`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url, accept) => fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate', Accept: accept || '*/*' }, signal: AbortSignal.timeout(60000) });
async function head(url, limit) {
  const r = await get(url);
  if (!r.ok || !r.body) return { status: r.status, text: '' };
  const reader = r.body.getReader(), parts = [];
  let n = 0;
  while (n < limit) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; }
  reader.cancel().catch(() => {});
  return { status: r.status, text: Buffer.concat(parts.map((p) => Buffer.from(p))).toString('latin1') };
}

let FRESH = null;
(async () => {
  if (process.argv.includes('--restatus')) {
    const list = await store.readIpoCompanies();
    const moved = {};
    for (const c of list) {
      const s = Ipos.status({ tickers: c.ticker ? [c.ticker] : [] }, c.filings);
      if (s === c.status) continue;
      moved[c.status + ' -> ' + s] = (moved[c.status + ' -> ' + s] || 0) + 1;
      if (COMMIT) await store.writeIpoCompany(Object.assign({}, c, { status: s }), []);
    }
    console.log(list.length + ' kept companies; ' + (COMMIT ? 'written: ' : 'DRY RUN, would change: ') + (JSON.stringify(moved) || 'nothing'));
    if (COMMIT) await store.writeIpoState(Object.assign((await store.readIpoState()) || { queue: [] }, { at: Date.now() }));
    return;
  }
  if (!/@/.test(UA)) { console.log('No contact address for the SEC (SEC_UA, REPORT_TO or MAIL_FROM).'); process.exit(1); }
  const today = SecDaily.todayET();
  let lines = [];
  if (!RESUME) {
    const days = [];
    for (let d = FROM; d < today; d = SecDaily.addDays(d, 1)) if (![0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())) days.push(d);
    console.log(`${days.length} business days of the SEC's index from ${FROM}; ` + (COMMIT ? 'COMMIT: writing ipo_companies and ipo_filings' : 'DRY RUN: nothing will be written'));
    for (let i = 0; i < days.length; i++) {
      let r;
      try { r = await get(SecDaily.indexUrl(days[i])); } catch (e) { console.log(`  ${days[i]}: ${e.message}`); await sleep(GAP_MS); continue; }
      if (r.status === 429) { console.log(`  ${days[i]}: HTTP 429 -- the SEC is throttling this address. Stopping; nothing queued.`); process.exit(1); }
      if (r.ok) lines = lines.concat(Ipos.parseIndex(await r.text()));
      if ((i + 1) % 50 === 0) console.log(`  ${days[i]}: ${lines.length} filing lines so far`);
      await sleep(GAP_MS);
    }
    const ciks = new Set(lines.map((l) => l.cik));
    const by = {}; for (const l of lines) by[l.form] = (by[l.form] || 0) + 1;
    console.log(`${lines.length} filing lines from ${ciks.size} companies: ` + Object.entries(by).map(([k, v]) => k + ' ' + v).join(', '));
    if (!COMMIT) { console.log('Dry run: run again with --commit to read each company and write.'); return; }
    if (RECHECK) FRESH = new Set(lines.map((l) => l.cik));
    const q = Ipos.enqueue(await store.readIpoState(), lines);
    await store.writeIpoState(q.state);
    console.log(`${q.added} queued (${q.state.queue.length} in the queue)`);
  } else if (!COMMIT) { console.log('--resume needs --commit.'); return; }

  const t0 = Date.now();
  let kept = 0, skipped = 0, calls = 0;
  for (;;) {
    const out = await Ipos.step({
      n: 10,
      readState: () => store.readIpoState(),
      writeState: (st) => store.writeIpoState(st),
      readCompany: (cik) => store.readIpoCompany(cik),
      fetchSubs: async (cik) => { await sleep(GAP_MS); const r = await get(Ipos.subsUrl(cik), 'application/json'); return { status: r.status, json: r.ok ? await r.json() : null }; },
      fetchOlder: async (name) => { await sleep(GAP_MS); const r = await get(Ipos.olderUrl(name), 'application/json'); return { status: r.status, json: r.ok ? await r.json() : null }; },
      fetchCover: async (url) => { await sleep(GAP_MS); return head(url, COVER_BYTES); },
      saveCompany: (row, hist) => store.writeIpoCompany(row, hist),
      skipCompany: (cik, name, reason) => store.skipIpoCompany(cik, name, reason, !!FRESH),
      fresh: FRESH,
    });
    kept += out.kept.length; skipped += out.skipped.length; calls++;
    for (const n of out.notes) console.log('  ' + n);
    if (calls % 5 === 0 || out.done) console.log(`  ${kept} kept, ${skipped} left out, ${out.remaining} filings still queued (${Math.round((Date.now() - t0) / 1000)}s)`);
    if (out.blocked) { console.log('Stopped: the SEC asked us to slow down. Run again with --commit --resume.'); process.exit(1); }
    if (out.done) break;
  }
  console.log(`Done: ${kept} companies kept, ${skipped} left out.`);
})().catch((e) => { console.error(e); process.exit(1); });
