// Reads new earnings releases (releases.js): every results 8-K (item 2.02) the
// daily SEC read has recorded and this table has not, its press release
// fetched from the SEC and read by Claude Haiku 5.5 into earnings_releases.
//
//   node --use-system-ca release-load.js                 dry run, the last 4 days
//   node --use-system-ca release-load.js --commit        write
//   node --use-system-ca release-load.js --days 31       further back (the first fill)
//   node --use-system-ca release-load.js --symbol META   one company
//
// LOCAL, like the tone loader (news-tone-load.js): it spends Anthropic credit,
// about $0.002 a release (measured on 20, 2026-10-22), and a busy earnings day
// is ~150 releases, so it runs from this machine and not on Vercel's clock.
// release-task.ps1 schedules it. It never starts server.js.
//
// A DRY RUN STILL CALLS THE MODEL (the only way to see a reading) but writes
// nothing. --max-usd and --max-minutes stop a run; what is left is read next time.
//
// SEC: sequential, declared user agent, paced. A 429 or 403 stops the run.
// Two fetches a filing: the index headers (to find Exhibit 99.1) and the exhibit.
//
// WHAT IS WRITTEN: one row per filing, never replaced. A filing whose exhibit
// is not a results release, or that has no exhibit, is written as such so it
// is not fetched again. A model failure writes nothing: it is tried next run.
require('dotenv').config({ override: true });
const store = require('./db.js');
const Rel = require('./releases.js');

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const COMMIT = flag('--commit');
const DAYS = Math.max(1, Math.min(45, Number(opt('--days', 4)) || 4));
const ONLY = (opt('--symbol', '') || '').toUpperCase();
// --reread: also read again the filings in the window whose stored reading was
// 'not a results release' or had a figure refused, replacing only those rows.
// For after a correction to the reader (the first fill, 2026-10-22: Tesla's
// quarterly 'Update' judged not a release; figures printed '16.3 billion').
const REREAD = flag('--reread');
// --force (with --symbol): read that company's filings in the window again,
// replacing even clean readings. For a fault the checks could not see (a scale).
const FORCE = flag('--force') && !!ONLY;
const MAX_USD = Number(opt('--max-usd', 2)) || 2;
const MAX_MIN = Number(opt('--max-minutes', 40)) || 40;
const KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.RELEASE_MODEL || Rel.MODEL;
const PRICES = { 'claude-haiku-5-5': { in: 0.10 / 1e6, out: 0.50 / 1e6 }, 'claude-sonnet-5-5': { in: 2 / 1e6, out: 10 / 1e6 } };
const P = PRICES[MODEL] || PRICES['claude-sonnet-5-5'];
// The same address server.js declares (secAddress of REPORT_TO or MAIL_FROM).
const contact = (process.env.REPORT_TO || process.env.MAIL_FROM || '').replace(/.*</, '').replace(/>.*/, '').trim();
const UA = String(process.env.SEC_UA || (contact ? 'Tickr Lab (' + contact + ')' : '')).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();

class Stop extends Error {}
let secCalls = 0;
async function sec(url) {
  await sleep(400);
  secCalls++;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(60000) });
  if (r.status === 429 || r.status === 403) throw new Stop('the SEC answered ' + r.status + '; stopping (a 429 is a wait, not a retry)');
  return r.ok ? r.text() : null;
}
let spent = 0;
async function ask(text) {
  for (let a = 0; a < 3; a++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(Rel.request(text, MODEL)), signal: AbortSignal.timeout(180000) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 429 || r.status === 529) { await sleep((Number(r.headers.get('retry-after')) || 20) * 1000); continue; }
    if ([400, 401, 403, 404].includes(r.status)) throw new Stop('Anthropic answered ' + r.status + ': ' + String((d.error && d.error.message) || '').slice(0, 160));
    if (!r.ok) throw new Error('Anthropic ' + r.status);
    const u = d.usage || {};
    const usd = (u.input_tokens || 0) * P.in + (u.output_tokens || 0) * P.out;
    spent += usd;
    if (d.stop_reason !== 'end_turn') throw new Error('the answer stopped: ' + d.stop_reason);
    return { ans: JSON.parse((d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')), inTok: u.input_tokens || 0, outTok: u.output_tokens || 0, usd };
  }
  throw new Error('Anthropic kept answering 429');
}
// THE RUN, recorded for the Earnings releases section of /news-runs (a run
// that writes, only; a dry run leaves no trace). Bookkeeping never fails the run.
const RUN = { startedAt: Date.now(), model: MODEL, days: DAYS, stop: 'done' };
async function recordRun() {
  if (!COMMIT) return;
  try { await store.writeReleaseRun(Object.assign(RUN, { endedAt: Date.now(), spent })); }
  catch (e) { console.log('  (the run could not be recorded: ' + String(e.message).slice(0, 80) + ')'); }
}
const etDay = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);

(async () => {
  if (!KEY) throw new Stop('ANTHROPIC_API_KEY is not set');
  if (!UA) throw new Stop('no SEC user agent: set SEC_UA, REPORT_TO or MAIL_FROM');
  const since = etDay(Date.now() - DAYS * 86400000);
  const [events, snap, ids] = await Promise.all([store.readSecEventsSince(since), store.readSnapshot(), store.readFilerIds()]);
  const tracked = new Map(((snap && snap.stocks) || []).filter((r) => r && r.symbol && r.instrumentType !== 'ETF').map((r) => [r.symbol, r]));
  let todo = events.filter((e) => e.accn && /(^|,)2\.02(,|$)/.test(e.items || '') && tracked.has(e.symbol) && (!ONLY || e.symbol === ONLY));
  const known = await store.readEarningsReleaseAccns(todo.map((e) => e.accn));
  const redo = new Set();
  if (FORCE) for (const e of todo) if (known.has(e.accn)) redo.add(e.accn);
  if (REREAD) {
    for (const day of [...new Set(todo.map((e) => e.filed))]) for (const r of await store.readEarningsReleasesOn(day)) if (!r.isResults || (r.problems || []).some((p) => !/^summary/.test(p))) redo.add(r.accn);
    console.log('  reread: ' + redo.size + ' earlier readings to replace');
  }
  todo = todo.filter((e) => !known.has(e.accn) || redo.has(e.accn)).sort((a, b) => (a.filed < b.filed ? 1 : -1));   // newest first
  console.log(`[${new Date().toISOString()}] earnings releases since ${since}: ${todo.length} to read (${known.size} read before); model ${MODEL}; `
    + `stop at $${MAX_USD.toFixed(2)} or ${MAX_MIN} min. ` + (COMMIT ? 'COMMIT' : 'DRY RUN: nothing will be written'));
  let read = 0, results = 0, notResults = 0, failed = 0, flagged = 0, written = 0;
  RUN.found = todo.length;
  for (const e of todo) {
    if (spent >= MAX_USD) { console.log('  stopping: the dollar limit'); RUN.stop = 'budget'; break; }
    if (Date.now() - t0 > MAX_MIN * 60000) { console.log('  stopping: the time limit'); RUN.stop = 'time'; break; }
    const meta = { accn: e.accn, symbol: e.symbol, filed: e.filed };
    try {
      const cik = ids[e.symbol];
      if (!cik) { console.log(`  ${e.symbol} ${e.filed}: no SEC id on file, skipped`); failed++; continue; }
      const base = Rel.archiveBase(cik, e.accn);
      const hdr = await sec(base + e.accn + '-index-headers.html');
      if (!hdr) { console.log(`  ${e.symbol} ${e.filed}: the filing index did not load; next run`); failed++; continue; }
      const ex = Rel.pickExhibit(hdr);
      let row, problems = [], cost = { inTok: null, outTok: null, usd: null };
      if (!ex) {
        row = Object.assign({}, meta, { isResults: false, url: base, exhibit: null });
        problems = ['the filing has no EX-99 exhibit'];
      } else {
        meta.url = base + ex.file; meta.exhibit = ex.type;
        const html = await sec(meta.url);
        if (!html) { console.log(`  ${e.symbol} ${e.filed}: the exhibit did not load; next run`); failed++; continue; }
        const text = Rel.toText(html);
        const got = await ask(text);
        cost = got;
        ({ row, problems } = Rel.toRow(got.ans, text, meta));
      }
      read++;
      if (row.isResults) results++; else notResults++;
      if (problems.length) flagged++;
      const out = Object.assign(row, { problems, model: ex ? MODEL : null, inTok: cost.inTok, outTok: cost.outTok, usd: cost.usd, readAt: Date.now() });
      const b = (v) => (v == null ? '—' : (v / 1e9).toFixed(2) + 'B');
      console.log(`  ${e.symbol} ${e.filed}: ` + (row.isResults
        ? `${row.periodLabel || ''} revenue ${b(row.revenue)} GAAP EPS ${row.epsGaap == null ? '—' : row.epsGaap}` + (row.epsAdj != null ? ` adj ${row.epsAdj}` : '') + (row.guideKind ? ` guidance ${row.guideKind}` : '')
        : 'not a results release') + (problems.length ? ' | ' + problems.join('; ') : '') + (cost.usd != null ? ` | $${cost.usd.toFixed(4)}` : ''));
      if (COMMIT) written += await store.writeEarningsRelease(out, { replace: redo.has(e.accn) });
    } catch (err) {
      if (err instanceof Stop) throw err;
      failed++;
      console.log(`  ${e.symbol} ${e.filed}: failed (${String(err.message).slice(0, 120)}); next run`);
    }
  }
  Object.assign(RUN, { read, results, notResults, refused: flagged, failed });
  // AGAINST THE 10-Q: every results reading of the last 120 days not yet
  // compared, once its quarter is in sec_facts (the filings refresh puts it
  // there within days of the 10-Q). One seek a company; no SEC fetch here.
  let checked = 0, differ = 0;
  if (COMMIT) {
    try {
      const open = await store.readReleasesToCheck(etDay(Date.now() - 120 * 86400000));
      if (open.length) {
        const ends = open.map((r) => r.periodEnd).filter(Boolean).sort();
        const facts = await store.readSecFactsSince([...new Set(open.map((r) => r.symbol))], ends.length ? ends[0] : etDay(Date.now() - 200 * 86400000));
        for (const r of open) {
          const c = Rel.tenQCheck(r, facts.get(r.symbol) || []);
          if (!c) continue;
          await store.writeReleaseCheck(r.accn, c);
          checked++;
          if (c.result === 'differs') { differ++; console.log(`  10-Q ${r.symbol} ${r.periodEnd}: differs on ${c.differs.join(', ')}`); }
        }
      }
      console.log(`  10-Q check: ${open.length} waiting, ${checked} compared, ${differ} differ`);
    } catch (err) { console.log('  10-Q check failed: ' + String(err.message).slice(0, 120)); }
  }
  Object.assign(RUN, { checked, differs: differ });
  console.log(`  done: ${read} read (${results} results, ${notResults} not), ${flagged} with a figure refused, ${failed} to retry; `
    + `${COMMIT ? written + ' written' : 'nothing written'}; $${spent.toFixed(4)}; ${secCalls} SEC fetches; ${Math.round((Date.now() - t0) / 1000)}s`);
  await recordRun();
  process.exit(0);
})().catch(async (e) => {
  console.log(`  STOPPED: ${e instanceof Stop ? e.message : e.stack}; $${spent.toFixed(4)} spent`);
  RUN.stop = 'error'; RUN.error = String(e.message || e).slice(0, 300);
  await recordRun();
  process.exit(e instanceof Stop ? 3 : 1);
});
