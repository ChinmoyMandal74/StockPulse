// Reads new earnings releases (releases.js): every results 8-K (item 2.02) the
// daily SEC read has recorded and this table has not, its press release
// fetched from the SEC and read by Claude Haiku 5.5 into earnings_releases.
//
//   node --use-system-ca release-load.js                 dry run, the last 4 days
//   node --use-system-ca release-load.js --commit        write
//   node --use-system-ca release-load.js --days 31       further back (the first fill)
//   node --use-system-ca release-load.js --symbol META   one company
//   ... --commit --mail     and email the owner the new results (the scheduled runs)
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
const SourceRule = require('./sourcerule.js');

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
// --column-only: rebuild the screener's column (the stored figure) and stop;
// no SEC fetch, no model call. Every committed run rebuilds it at its end too.
const COLUMN_ONLY = flag('--column-only');
// THE EARNINGS RESULTS MAILING (2026-10-23): after the MORNING run only (the
// owner: once each weekday morning), ask the app to send everyone on the
// `results` list everything read since the last mailing, a batch a call,
// looping while any are left. Whether this run read anything new does not
// matter: the evening run's finds go out now. Never fails the run.
// The weekday morning run: the one that sends the mailing and Reporting today.
function weekdayMorning() {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(new Date())) % 24;
  if (hour >= 12) return false;
  // WEEKDAYS ONLY: the Saturday 05:00 run (2026-10-25) reads Friday's
  // releases, and they go out in Monday's mailing, as before.
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date());
  return wd !== 'Sat' && wd !== 'Sun';
}
async function mailList() {
  if (!MAIL || !weekdayMorning()) return;
  const secret = process.env.CRON_SECRET, base = (process.env.APP_URL || 'https://www.tickrlab.com').replace(/\/+$/, '');
  if (!secret) return;
  let sent = 0, failed = 0, total = 0, companies = 0;
  try {
    for (let i = 0; i < 60; i++) {
      const r = await fetch(base + '/api/cron/release-digest', { method: 'POST', signal: AbortSignal.timeout(120000),
        headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + secret }, body: JSON.stringify({ list: true }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { console.log('  mailing: stopped (' + (d.error || r.status) + ')'); break; }
      sent += d.sent || 0; failed += d.failed || 0; total = d.total || total; companies = d.companies || companies;
      if (!d.remaining) break;
      if (!d.sent && !d.deferred) { console.log('  mailing: no progress, stopping'); break; }
    }
    console.log('  mailing: ' + (companies ? sent + ' of ' + total + ' subscribers sent ' + companies + ' companies' + (failed ? ', ' + failed + ' failed' : '') : 'nothing read since the last one'));
  } catch (e) { console.log('  mailing: not sent (' + String(e.message).slice(0, 80) + ')'); }
}
// REPORTING TODAY (2026-10-28, the owner: "schedule it right after the
// earning results email and send it to admin"): straight after the mailing,
// ask the app to email the operator the tracked companies the earnings
// calendar lists for today. The app sends it once a day. Never fails the run.
async function mailToday() {
  if (!MAIL || !weekdayMorning()) return;
  const secret = process.env.CRON_SECRET, base = (process.env.APP_URL || 'https://www.tickrlab.com').replace(/\/+$/, '');
  if (!secret) return;
  try {
    const r = await fetch(base + '/api/cron/earnings-today', { method: 'POST', signal: AbortSignal.timeout(120000),
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + secret }, body: '{}' });
    const d = await r.json().catch(() => ({}));
    console.log('  reporting today: ' + (!r.ok ? 'not sent (' + (d.error || r.status) + ')' : d.sent ? 'sent, ' + d.companies + ' companies' : d.already ? 'already sent today' : 'nobody listed for today'));
  } catch (e) { console.log('  reporting today: not sent (' + String(e.message).slice(0, 80) + ')'); }
}
// --guidance (with --commit): read again the stored results releases in the
// window whose guidance items were never read (before 2026-10-23), and write
// ONLY the four guidance columns (writeReleaseGuidance). The reading itself,
// its figures, summary and 10-Q check, is left exactly as stored.
const GUIDANCE = flag('--guidance');
// --drivers (with --commit): the same for what helped and what weighed
// (2026-10-23): read again the stored results releases that lack them and
// write ONLY that column (writeReleaseDrivers).
const DRIVERS = flag('--drivers');
// THE CASH FLOW PASS (--cashflow, 2026-10-29): read again the results releases
// filed on or after --since (default 2026-04-01) that were read before free
// cash flow was asked for, and set beside each reading the stated free cash
// flow and the cash flow statement's two lines, nothing else. Then work out
// free cash flow (releases.js deriveFcf) for every release in the window,
// oldest first, as the year-to-date subtraction needs the release before.
// --derive-only does the second step alone: no SEC fetch, no model call.
// Model calls run --parallel at a time (default 8); SEC fetches stay one at a time.
// --statements (2026-10-29): the same pass for the rest of the statements
// (income lines, balance sheet) as well: it reads every release in the window
// not yet read for them (default since 2025-07-01), writes those columns, and
// the cash flow columns only where they were never read.
// --reshares: with the share-count rescale (releases.js, 2026-10-29), read again
// only the releases read for the statements whose diluted shares are blank, and
// write the share counts alone (the rest of the stored reading is kept).
const RESHARES = flag('--reshares');
// --restmt: after the comparison's two fixes (cost of revenue stored positive;
// the twelve months' revenue as the scale reference when the quarter's is not
// kept), read the statements again for the releases they touch: a negative
// cost of revenue, or no revenue kept. Statement columns only.
const RESTMT = flag('--restmt');
const STATEMENTS = flag('--statements') || RESHARES || RESTMT;
const CASHFLOW = flag('--cashflow') || STATEMENTS;
const DERIVE_ONLY = flag('--derive-only');
const SINCE = /^\d{4}-\d{2}-\d{2}$/.test(opt('--since', '')) ? opt('--since', '') : STATEMENTS ? '2025-07-01' : '2026-04-01';
const PARALLEL = Math.max(1, Math.min(12, Number(opt('--parallel', 8)) || 8));
// The previous full year's GAAP diluted EPS from the 10-K, for a release whose
// full-year GAAP EPS guidance prints no prior figure (releases.js priorFyEps).
// One per-symbol seek on sec_facts.
async function epsGuidePrior(row) {
  const it = (row.guides || []).find((g) => g.metric === 'eps_gaap' && g.periodType === 'full_year' && g.prior == null);
  if (!it) return null;
  const y = Rel.guideYear(it.periodLabel);
  if (!y) return null;
  try {
    const facts = (await store.readSecFactsSince([row.symbol], (y - 2) + '-01-01')).get(row.symbol) || [];
    return Rel.priorFyEps(it, facts);
  } catch (e) { return null; }
}
// --mail (with --commit; the scheduled task passes it): when the run wrote new
// results releases, ask the deployed app to email the owner a digest of them
// (POST /api/cron/release-digest, kind 'release-digest'). The app holds the
// mail settings and every send goes through its one send path and mail log.
// A run that wrote nothing new sends nothing; a re-read (--reread, --force)
// never mails. Bookkeeping: a failure here never fails the run.
const MAIL = flag('--mail') && COMMIT && !REREAD && !FORCE;
const mailed = [];
async function mailDigest() {
  if (!MAIL || !mailed.length) return;
  const secret = process.env.CRON_SECRET, base = (process.env.APP_URL || 'https://www.tickrlab.com').replace(/\/+$/, '');
  if (!secret) { console.log('  email: CRON_SECRET is not set, not sent'); return; }
  try {
    const r = await fetch(base + '/api/cron/release-digest', { method: 'POST', signal: AbortSignal.timeout(120000),
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + secret }, body: JSON.stringify({ accns: mailed }) });
    const d = await r.json().catch(() => ({}));
    console.log('  email: ' + (r.ok && d.sent ? 'sent, ' + d.companies + ' companies' : 'not sent (' + (d.error || r.status) + ')'));
  } catch (e) { console.log('  email: not sent (' + String(e.message).slice(0, 80) + ')'); }
}
// SAME-DAY RESULTS 8-Ks (2026-10-27, the owner, after SoFi's 07:03 filing
// waited for the next day): before looking, ask the deployed app to read the
// SEC's live 8-K feed and record the results 8-Ks filed since the previous
// business day (POST /api/sec/today), looping while any company is left. The
// daily SEC read only sees a day once its index is published that night.
// Committed runs only (it writes sec_events); never fails the run.
async function secToday() {
  if (!COMMIT) return;
  const secret = process.env.CRON_SECRET, base = (process.env.APP_URL || 'https://www.tickrlab.com').replace(/\/+$/, '');
  if (!secret) { console.log('  same-day 8-Ks: CRON_SECRET is not set, skipped'); return; }
  let body = {}, read = 0, found = null;
  try {
    for (let i = 0; i < 40; i++) {
      const r = await fetch(base + '/api/sec/today', { method: 'POST', signal: AbortSignal.timeout(240000),
        headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + secret }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { console.log('  same-day 8-Ks: stopped (' + (d.error || r.status) + ')'); break; }
      if (d.found) found = d.found;
      read += (d.read || []).length;
      if (d.throttled) { console.log('  same-day 8-Ks: the SEC asked us to slow down; the rest wait for the daily read'); break; }
      if (d.done || !(d.pending || []).length) break;
      if (!(d.read || []).length && body.pending && body.pending.length === d.pending.length) { console.log('  same-day 8-Ks: no progress, stopping'); break; }
      body = { pending: d.pending };
    }
    console.log('  same-day 8-Ks: ' + (found ? found.results + ' tracked results filings since ' + found.since + ', ' + found.new + ' new, ' + read + ' companies recorded' : read + ' companies recorded'));
  } catch (e) { console.log('  same-day 8-Ks: not read (' + String(e.message).slice(0, 80) + ')'); }
}
// The window the column covers: a quarter and a month, so a company that
// reported early last season still shows until it reports again.
const COLUMN_DAYS = 130;
async function writeColumn() {
  const since = etDay(Date.now() - COLUMN_DAYS * 86400000);
  const rel = await store.readEarningsReleasesSince(since);
  const syms = [...new Set(rel.map((r) => r.symbol))];
  const earnBy = {};
  for (const s of syms) earnBy[s] = await store.readEarnings(s).catch(() => []);
  const rows = Rel.columnRows(rel, earnBy);
  await store.writeFigures({ releaseColumn: { at: Date.now(), days: COLUMN_DAYS, rows } });
  console.log('  screener column: ' + Object.keys(rows).length + ' companies written');
}
// THE SOURCE RULE (sourcerule.js) for the companies that just reported: a
// release filed in the last four days is the newest quarter they have, and
// the screener's display columns take it the same day rather than at the
// next daily filings pass, which rebuilds every company.
const SOURCED_DAYS = 4;
async function writeSourced() {
  const rel = await store.readReleaseFiguresSince(etDay(Date.now() - SOURCED_DAYS * 86400000));
  const symbols = [...new Set(rel.map((r) => String(r.symbol).toUpperCase()))];
  if (!symbols.length) return;
  const out = await SourceRule.build(store, { symbols });
  console.log('  source rule: ' + out.built + ' of ' + symbols.length + ' companies that just reported rebuilt (' + out.companies + ' held)');
}
// THE SIGNAL-INPUT RECON (/recon): each S&P 500 member's newest results
// release beside Twelve Data's figures as they stand, one row per company
// per season from the 2026 Q3 season on (the owner: 'starting this current
// quarter'). db.js freezes Twelve Data's side once it is on the same report.
const RECON_FROM = '2026-Q3';
async function writeRecon() {
  const st = await store.fundNewest('spy');
  const held = st && st.asOf ? await store.readFundHoldings('spy', st.asOf) : null;
  const sp = new Set(((held && held.holdings) || []).map((h) => String(h.symbol).toUpperCase()));
  if (!sp.size) { console.log('  recon: no S&P 500 list on file, skipped'); return; }
  const snap = await store.readSnapshot();
  const td = new Map(((snap && snap.stocks) || []).filter((r) => r && r.symbol).map((r) => [r.symbol, r]));
  const rel = await store.readEarningsReleasesSince(etDay(Date.now() - COLUMN_DAYS * 86400000));
  const latest = {};
  for (const r of rel) if (sp.has(r.symbol) && (!latest[r.symbol] || r.filed > latest[r.symbol].filed)) latest[r.symbol] = r;
  const rows = Object.values(latest).map((r) => Rel.reconRow(r, td.get(r.symbol))).filter((x) => x.season && x.season >= RECON_FROM);
  const n = await store.writeRecon(rows);
  console.log('  recon: ' + n + ' S&P 500 rows written (' + rows.filter((x) => x.tdCurrent).length + ' with Twelve Data on the same report)');
}
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
// `build`: the request maker, the main reading's by default; Rel.cfRequest for
// the cash flow reading.
async function ask(text, build) {
  for (let a = 0; a < 3; a++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify((build || Rel.request)(text, MODEL)), signal: AbortSignal.timeout(180000) });
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
// THE GUIDANCE PASS (--guidance). Same fetch and model call as a reading;
// only the guidance is kept. Stops at --max-usd and --max-minutes like a run.
async function guidancePass() {
  if (!KEY) throw new Stop('ANTHROPIC_API_KEY is not set');
  if (!UA) throw new Stop('no SEC user agent: set SEC_UA, REPORT_TO or MAIL_FROM');
  const since = etDay(Date.now() - DAYS * 86400000);
  const rows = (await store.readEarningsReleasesSince(since)).filter((r) => r.isResults && r.guides == null && r.url && (!ONLY || r.symbol === ONLY))
    .sort((a, b) => (a.filed < b.filed ? 1 : -1));
  console.log(`[${new Date().toISOString()}] guidance re-read since ${since}: ${rows.length} releases; ` + (COMMIT ? 'COMMIT (guidance columns only)' : 'DRY RUN'));
  let done = 0, withItems = 0, changes = 0, priors = 0, failed = 0;
  for (const r of rows) {
    if (spent >= MAX_USD) { console.log('  stopping: the dollar limit'); break; }
    if (Date.now() - t0 > MAX_MIN * 60000) { console.log('  stopping: the time limit'); break; }
    try {
      const html = await sec(r.url);
      if (!html) { console.log(`  ${r.symbol} ${r.filed}: the exhibit did not load; next run`); failed++; continue; }
      const text = Rel.toText(html);
      const got = await ask(text);
      const { row, problems } = Rel.toRow(got.ans, text, { accn: r.accn, symbol: r.symbol, filed: r.filed, url: r.url });
      const g = { guides: row.isResults ? row.guides || [] : [], guideChange: row.guideChange, guideChangeQuote: row.guideChangeQuote };
      g.epsGuidePrior = await epsGuidePrior(Object.assign({ symbol: r.symbol }, g));
      if (!g.guideChange) {
        try { const h = Rel.changeFromHistory(Object.assign({}, r, { guides: g.guides, guideChange: null }), await store.readEarningsReleases(r.symbol, 160)); if (h) { g.guideChange = h.change; g.guideChangeQuote = h.quote; } } catch (err) { /* left as no change stated */ }
      }
      const gp = problems.filter((p) => /^guidance/.test(p));
      console.log(`  ${r.symbol} ${r.filed}: ${g.guides.length} item(s)` + (g.guideChange ? `, ${g.guideChange}` : '') + (g.epsGuidePrior != null ? `, prior FY EPS ${g.epsGuidePrior} (10-K)` : '') + (gp.length ? ' | ' + gp.join('; ') : '') + ` | $${got.usd.toFixed(4)}`);
      if (COMMIT) await store.writeReleaseGuidance(r.accn, g);
      done++; if (g.guides.length) withItems++; if (g.guideChange) changes++; if (g.epsGuidePrior != null) priors++;
    } catch (err) {
      if (err instanceof Stop) throw err;
      failed++;
      console.log(`  ${r.symbol} ${r.filed}: failed (${String(err.message).slice(0, 120)}); next run`);
    }
  }
  if (COMMIT) { try { await writeColumn(); } catch (err) { console.log('  screener column failed: ' + String(err.message).slice(0, 120)); } }
  console.log(`  done: ${done} re-read, ${withItems} with guidance, ${changes} with a stated change, ${priors} prior-year EPS from the 10-K, ${failed} to retry; $${spent.toFixed(4)}; ${Math.round((Date.now() - t0) / 1000)}s`);
}
// THE DRIVERS PASS (--drivers): as the guidance pass, for the drivers column.
async function driversPass() {
  if (!KEY) throw new Stop('ANTHROPIC_API_KEY is not set');
  if (!UA) throw new Stop('no SEC user agent: set SEC_UA, REPORT_TO or MAIL_FROM');
  const since = etDay(Date.now() - DAYS * 86400000);
  const rows = (await store.readEarningsReleasesSince(since)).filter((r) => r.isResults && r.drivers == null && r.url && (!ONLY || r.symbol === ONLY))
    .sort((a, b) => (a.filed < b.filed ? 1 : -1));
  console.log(`[${new Date().toISOString()}] drivers re-read since ${since}: ${rows.length} releases; ` + (COMMIT ? 'COMMIT (drivers column only)' : 'DRY RUN'));
  let done = 0, withAny = 0, failed = 0, refused = 0;
  for (const r of rows) {
    if (spent >= MAX_USD) { console.log('  stopping: the dollar limit'); break; }
    if (Date.now() - t0 > MAX_MIN * 60000) { console.log('  stopping: the time limit'); break; }
    try {
      const html = await sec(r.url);
      if (!html) { console.log(`  ${r.symbol} ${r.filed}: the exhibit did not load; next run`); failed++; continue; }
      const text = Rel.toText(html);
      const got = await ask(text);
      const { row, problems } = Rel.toRow(got.ans, text, { accn: r.accn, symbol: r.symbol, filed: r.filed, url: r.url });
      const d = row.drivers || { helped: [], weighed: [] };
      const dp = problems.filter((p) => /^(helped|weighed)/.test(p));
      refused += dp.length;
      console.log(`  ${r.symbol} ${r.filed}: ${d.helped.length} helped, ${d.weighed.length} weighed` + (dp.length ? ' | ' + dp.join('; ') : '') + ` | $${got.usd.toFixed(4)}`);
      if (COMMIT) await store.writeReleaseDrivers(r.accn, d);
      done++; if (d.helped.length || d.weighed.length) withAny++;
    } catch (err) {
      if (err instanceof Stop) throw err;
      failed++;
      console.log(`  ${r.symbol} ${r.filed}: failed (${String(err.message).slice(0, 120)}); next run`);
    }
  }
  console.log(`  done: ${done} re-read, ${withAny} with reasons, ${refused} points refused by the checks, ${failed} to retry; $${spent.toFixed(4)}; ${Math.round((Date.now() - t0) / 1000)}s`);
}
async function cashflowPass() {
  const snap = await store.readSnapshot();
  const sector = new Map(((snap && snap.stocks) || []).filter((r) => r && r.symbol).map((r) => [r.symbol, r.sector]));
  // The company's size, for the share-count guard (as the reading's meta.ref).
  const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const refOf = new Map(((snap && snap.stocks) || []).filter((r) => r && r.symbol).map((t) => { const cap = num(t.marketCap), px = num(t.price); return [t.symbol, { shares: cap > 0 && px > 0 ? cap / px : num(t.sharesOutstanding), revenueTtm: num(t.revenueTtm) }]; }));
  const all = (await store.readEarningsReleasesSince(SINCE)).filter((r) => r.isResults && (!ONLY || r.symbol === ONLY));
  if (!DERIVE_ONLY) {
    if (!KEY) throw new Stop('ANTHROPIC_API_KEY is not set');
    if (!UA) throw new Stop('no SEC user agent: set SEC_UA, REPORT_TO or MAIL_FROM');
    const todo = all.filter((r) => (RESHARES ? r.stmtRead === 1 && r.dilShares == null && r.dilSharesPrior == null : RESTMT ? r.stmtRead === 1 && (r.costRev < 0 || r.costRevPrior < 0 || r.revenue == null) : STATEMENTS ? r.stmtRead == null : r.fcfLabel == null) && r.url).sort((a, b) => (a.filed < b.filed ? 1 : -1));
    console.log(`[${new Date().toISOString()}] ${STATEMENTS ? 'statements' : 'cash flow'} re-read since ${SINCE}: ${todo.length} of ${all.length} releases; ${PARALLEL} at a time; stop at ${MAX_USD.toFixed(2)} or ${MAX_MIN} min; ` + (COMMIT ? (STATEMENTS ? 'COMMIT (statement columns, and cash flow where never read)' : 'COMMIT (cash flow columns only)') : 'DRY RUN'));
    let done = 0, stated = 0, lines = 0, sheets = 0, failed = 0, stop = null;
    const inflight = new Set();
    const one = async (r, text) => {
      try {
        const got = await ask(text, Rel.cfRequest);
        // The stored reading already says it is a results release.
        const { row, problems } = Rel.toRow(Object.assign({ is_results_release: true }, got.ans), text, { accn: r.accn, symbol: r.symbol, filed: r.filed, url: r.url, ref: refOf.get(r.symbol) });
        const cp = problems.filter((p) => /cash flow|capital expenditures|income lines|gross profit|cost of revenue|EBITDA|diluted shares|balance sheet|total assets/.test(p));
        const b = (v) => (v == null ? '—' : (v / 1e9).toFixed(3) + 'B');
        console.log(`  ${r.symbol} ${r.filed}: fcf ${b(row.fcf)}` + (row.cfMonths ? ` | ${row.cfMonths}m ocf ${b(row.ocf)} capex ${b(row.capex)}` : ' | no cash flow lines') + (STATEMENTS ? ` | gp ${b(row.grossProfit)} assets ${b(row.bsAssets)} equity ${b(row.bsEquity)}` : '') + (cp.length ? ' | ' + cp.join('; ') : '') + ` | ${got.usd.toFixed(4)}`);
        const freshCf = !STATEMENTS || r.fcfLabel == null;
        if (COMMIT && freshCf) await store.writeReleaseCashFlow(r.accn, row);
        if (COMMIT && STATEMENTS) await store.writeReleaseStatements(r.accn, RESHARES ? Object.assign({}, r, { dilShares: row.dilShares, dilSharesPrior: row.dilSharesPrior }) : row);
        if (STATEMENTS && row.bsAssets != null) sheets++;
        if (freshCf) Object.assign(r, { fcf: row.fcf, fcfPrior: row.fcfPrior, fcfLabel: row.fcfLabel, cfMonths: row.cfMonths, ocf: row.ocf, ocfPrior: row.ocfPrior, capex: row.capex, capexPrior: row.capexPrior, capexLabel: row.capexLabel });
        done++; if (row.fcf != null) stated++; if (row.cfMonths) lines++;
      } catch (err) {
        if (err instanceof Stop) stop = stop || err;
        failed++;
        console.log(`  ${r.symbol} ${r.filed}: failed (${String(err.message).slice(0, 120)}); next run`);
      }
    };
    for (const r of todo) {
      if (stop) break;
      if (spent >= MAX_USD) { console.log('  stopping: the dollar limit'); break; }
      if (Date.now() - t0 > MAX_MIN * 60000) { console.log('  stopping: the time limit'); break; }
      const html = await sec(r.url);
      if (!html) { console.log(`  ${r.symbol} ${r.filed}: the exhibit did not load; next run`); failed++; continue; }
      const p = one(r, Rel.toText(html)).finally(() => inflight.delete(p));
      inflight.add(p);
      while (inflight.size >= PARALLEL) await Promise.race(inflight);
    }
    await Promise.all(inflight);
    if (stop) throw stop;
    console.log(`  re-read: ${done} done, ${stated} state a free cash flow, ${lines} with cash flow lines${STATEMENTS ? ', ' + sheets + ' with a balance sheet' : ''}, ${failed} to retry; ${spent.toFixed(4)}; ${secCalls} SEC fetches; ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  // WORK IT OUT, oldest first per company, from the readings as they now stand.
  // The release before the window's first is read from the table when needed.
  const bySym = new Map();
  for (const r of all) { if (!bySym.has(r.symbol)) bySym.set(r.symbol, []); bySym.get(r.symbol).push(r); }
  let worked = 0, quarter = 0, ytd = 0, changed = 0;
  for (const [sym, list] of bySym) {
    let hist = list;
    if (list.some((r) => r.cfMonths && r.cfMonths > 3)) { try { const more = await store.readEarningsReleases(sym, list.length + 4); hist = list.concat(more.filter((m) => !list.some((r) => r.accn === m.accn))); } catch (err) { /* the window alone */ } }
    for (const r of list) {
      const d = Rel.deriveFcf(r, Rel.prevRelease(r, hist), { financial: Rel.isFinancial(sector.get(sym)) });
      if (d.fcfCalc != null || d.fcfCalcPrior != null) { worked++; if (d.fcfCalcFrom === 'quarter') quarter++; else ytd++; }
      if (d.fcfCalc === (r.fcfCalc ?? null) && d.fcfCalcPrior === (r.fcfCalcPrior ?? null) && d.fcfCalcFrom === (r.fcfCalcFrom ?? null)) continue;
      changed++;
      if (COMMIT) await store.writeReleaseFcfCalc(r.accn, d);
    }
  }
  console.log(`  worked out: ${worked} of ${all.length} releases (${quarter} from a quarter's statement, ${ytd} from the year to date less the release before); ${changed} ${COMMIT ? 'written' : 'would change'}`);
}
const etDay = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);

(async () => {
  if (COLUMN_ONLY) { await writeColumn(); await writeSourced().catch((err) => console.log('  source rule failed: ' + String(err.message).slice(0, 120))); await writeRecon(); process.exit(0); }
  if (GUIDANCE) { await guidancePass(); process.exit(0); }
  if (DRIVERS) { await driversPass(); process.exit(0); }
  if (CASHFLOW || DERIVE_ONLY) { await cashflowPass(); process.exit(0); }
  if (!KEY) throw new Stop('ANTHROPIC_API_KEY is not set');
  if (!UA) throw new Stop('no SEC user agent: set SEC_UA, REPORT_TO or MAIL_FROM');
  await secToday();
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
        // The company's size, for the reader's scale guard (releases.js toRow).
        { const t = tracked.get(e.symbol) || {}; const n = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v)); const cap = n(t.marketCap), px = n(t.price); meta.ref = { shares: cap > 0 && px > 0 ? cap / px : n(t.sharesOutstanding), revenueTtm: n(t.revenueTtm) }; }
        const html = await sec(meta.url);
        if (!html) { console.log(`  ${e.symbol} ${e.filed}: the exhibit did not load; next run`); failed++; continue; }
        const text = Rel.toText(html);
        const got = await ask(text);
        cost = got;
        // THE CASH FLOW READING, a second small call for a results release
        // (releases.js cfRequest). Its failure never fails the reading: the
        // free cash flow is then left unread (null), and the --cashflow pass
        // takes it up.
        if (got.ans && got.ans.is_results_release === true) {
          try {
            const cf = await ask(text, Rel.cfRequest);
            got.ans.free_cash_flow = cf.ans.free_cash_flow; got.ans.cash_flow = cf.ans.cash_flow;
            cost = { inTok: got.inTok + cf.inTok, outTok: got.outTok + cf.outTok, usd: got.usd + cf.usd };
          } catch (err) {
            if (err instanceof Stop) throw err;
            console.log(`  ${e.symbol} ${e.filed}: the cash flow reading failed (${String(err.message).slice(0, 80)}); left for --cashflow`);
          }
        }
        ({ row, problems } = Rel.toRow(got.ans, text, meta));
      }
      read++;
      if (row.isResults) results++; else notResults++;
      if (problems.length) flagged++;
      delete row.ref;
      if (row.isResults) row.epsGuidePrior = await epsGuidePrior(row);
      // INITIATED, FROM THE HISTORY (2026-10-24): the first full-year guidance
      // on file for a year, from the company's earlier readings.
      if (row.isResults && !row.guideChange) {
        try { const h = Rel.changeFromHistory(row, await store.readEarningsReleases(e.symbol, 160)); if (h) { row.guideChange = h.change; row.guideChangeQuote = h.quote; } } catch (err) { /* left as no change stated */ }
      }
      // FREE CASH FLOW WORKED OUT, where the release states none, from the
      // release before for a year-to-date statement (releases.js deriveFcf).
      if (row.isResults && row.cfMonths) {
        try { Object.assign(row, Rel.deriveFcf(row, Rel.prevRelease(row, await store.readEarningsReleases(e.symbol, 8)), { financial: Rel.isFinancial((tracked.get(e.symbol) || {}).sector) })); } catch (err) { /* left unworked */ }
      }
      const out = Object.assign(row, { problems, model: ex ? MODEL : null, inTok: cost.inTok, outTok: cost.outTok, usd: cost.usd, readAt: Date.now() });
      const b = (v) => (v == null ? '—' : (v / 1e9).toFixed(2) + 'B');
      console.log(`  ${e.symbol} ${e.filed}: ` + (row.isResults
        ? `${row.periodLabel || ''} revenue ${b(row.revenue)} GAAP EPS ${row.epsGaap == null ? '—' : row.epsGaap}` + (row.epsAdj != null ? ` adj ${row.epsAdj}` : '') + (row.guideKind ? ` guidance ${row.guideKind}` : '') + (row.fcf != null ? ` fcf ${b(row.fcf)}` : row.fcfCalc != null ? ` fcf ${b(row.fcfCalc)} worked out` : '')
        : 'not a results release') + (problems.length ? ' | ' + problems.join('; ') : '') + (cost.usd != null ? ` | $${cost.usd.toFixed(4)}` : ''));
      if (COMMIT) {
        const n = await store.writeEarningsRelease(out, { replace: redo.has(e.accn) });
        written += n;
        if (n && row.isResults) mailed.push(e.accn);
      }
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
  if (COMMIT) { try { await writeColumn(); } catch (err) { console.log('  screener column failed: ' + String(err.message).slice(0, 120)); } }
  if (COMMIT) { try { await writeSourced(); } catch (err) { console.log('  source rule failed: ' + String(err.message).slice(0, 120)); } }
  if (COMMIT) { try { await writeRecon(); } catch (err) { console.log('  recon failed: ' + String(err.message).slice(0, 120)); } }
  console.log(`  done: ${read} read (${results} results, ${notResults} not), ${flagged} with a figure refused, ${failed} to retry; `
    + `${COMMIT ? written + ' written' : 'nothing written'}; $${spent.toFixed(4)}; ${secCalls} SEC fetches; ${Math.round((Date.now() - t0) / 1000)}s`);
  await recordRun();
  await mailDigest();
  await mailList();
  await mailToday();
  process.exit(0);
})().catch(async (e) => {
  console.log(`  STOPPED: ${e instanceof Stop ? e.message : e.stack}; $${spent.toFixed(4)} spent`);
  RUN.stop = 'error'; RUN.error = String(e.message || e).slice(0, 300);
  await recordRun();
  process.exit(e instanceof Stop ? 3 : 1);
});
