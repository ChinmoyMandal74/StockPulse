// THE HISTORY BACKFILL of earnings releases (2026-10-23, the owner: "Let's
// backfill first ... we will have the earning and guidance data along with
// price movement"). Every results 8-K (item 2.02) each tracked company has
// filed since --since, read by the same reader as the daily loader
// (release-load.js, releases.js) into earnings_releases. For research against
// price: it never feeds the Signal (CLAUDE.md, the Signal engine is sacrosanct).
//
//   node --use-system-ca release-history-load.js --limit 3            dry run, three companies
//   node --use-system-ca release-history-load.js --commit --max-usd 10
//   ... --symbols NVDA,GE      those companies only
//   ... --since 2017-01-01     the first filing date read (the default)
//   ... --skip 900             start at the 900th company by market value
//   ... --list-only            count the filings, call no model (SEC fetches only)
//   ... --rechange             read again the stored results releases that gave an
//                              outlook but have no stated change, writing ONLY the
//                              guidance columns, then work out Initiated from the
//                              history for every company (2026-10-24)
//   ... --initiated            the Initiated rule over every company, no model:
//                              stored "initiated" kept or cleared, blanks filled
//   ... --force --symbols NVDA read those companies' filings again, replacing
//                              the stored readings (after a reader fix)
//
// WHY NOT sec_events: it keeps about 400 days a company. The list comes from
// the SEC submissions feed itself: filings.recent plus the older pages it
// names (filings.files), one to three fetches a company.
//
// ORDER: largest companies first (market value in the snapshot), each company
// finished before the next. RESUMABLE: a filing already in the table is never
// fetched or read again (insert or ignore, as the daily loader), so a stopped
// run carries on where it stopped. A model failure writes nothing.
//
// SEC: sequential, declared user agent, paced 400 ms. A 429 or 403 stops the
// run. The model calls run up to --conc at once (default 4) while the next
// filing is fetched; the SEC side stays one request at a time.
//
// THE SCALE GUARD AT THE TIME. The daily loader checks a figure against the
// company's size today (market value over price, twelve months' revenue).
// Years back that is wrong by any split or growth since (NVIDIA's shares are
// forty times 2017's), so here the reference is the company's own filed
// quarter nearest before the release (sec_facts): shares implied by its net
// income over diluted EPS, a quarter's revenue. No quarter on file, no guard;
// the 10-Q check, run here on every reading, still compares the figures.
//
// WHAT IS WRITTEN: one row per filing, as release-load.js writes it, with
// readAt now. The mailings pick by filing date (the last four days), so an old
// release is never mailed. The screener column takes each company's newest in
// 130 days, so old releases do not touch it.
require('dotenv').config({ override: true });
const store = require('./db.js');
const Rel = require('./releases.js');

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const COMMIT = flag('--commit');
const LIST_ONLY = flag('--list-only');
const SINCE = /^\d{4}-\d{2}-\d{2}$/.test(opt('--since', '')) ? opt('--since') : '2017-01-01';
const SYMBOLS = (opt('--symbols', '') || '').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT = Math.max(0, Number(opt('--limit', 0)) || 0);
// --skip N: start at the Nth company by market value (a run resumed after
// the companies already done, rather than listing them again).
const SKIP = Math.max(0, Number(opt('--skip', 0)) || 0);
const FORCE = flag('--force') && SYMBOLS.length > 0;
const RECHANGE = flag('--rechange');
// --initiated: the history rule over every company, nothing read again
// (no model, no SEC): stored "initiated" checked, blanks filled.
const INITIATED = flag('--initiated');
const CONC = Math.max(1, Math.min(8, Number(opt('--conc', 4)) || 4));
const MAX_USD = Number(opt('--max-usd', 2)) || 2;
const MAX_MIN = Number(opt('--max-minutes', 600)) || 600;
const KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.RELEASE_MODEL || Rel.MODEL;
const PRICES = { 'claude-haiku-5-5': { in: 0.10 / 1e6, out: 0.50 / 1e6 }, 'claude-sonnet-5-5': { in: 2 / 1e6, out: 10 / 1e6 } };
const P = PRICES[MODEL] || PRICES['claude-sonnet-5-5'];
const contact = (process.env.REPORT_TO || process.env.MAIL_FROM || '').replace(/.*</, '').replace(/>.*/, '').trim();
const UA = String(process.env.SEC_UA || (contact ? 'Tickr Lab (' + contact + ')' : '')).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();

class Stop extends Error {}
let secCalls = 0;
async function sec(url, json) {
  await sleep(400);
  secCalls++;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(60000) });
  if (r.status === 429 || r.status === 403) throw new Stop('the SEC answered ' + r.status + '; stopping (a 429 is a wait, not a retry)');
  if (!r.ok) return null;
  return json ? r.json() : r.text();
}
let spent = 0;
async function ask(text) {
  for (let a = 0; a < 4; a++) {
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

// One column-array block of the submissions feed: its 8-Ks with item 2.02
// filed on or after SINCE. Amendments (8-K/A) are left out: a results 8-K/A
// re-files the same quarter, usually to correct an exhibit.
function resultsFilings(block) {
  const out = [];
  if (!block || !Array.isArray(block.form)) return out;
  for (let i = 0; i < block.form.length; i++) {
    if (block.form[i] !== '8-K') continue;
    const filed = String((block.filingDate || [])[i] || '').slice(0, 10);
    const accn = String((block.accessionNumber || [])[i] || '');
    if (!accn || !/^\d{4}-\d{2}-\d{2}$/.test(filed) || filed < SINCE) continue;
    if (!/(^|,)\s*2\.02\s*(,|$)/.test(String((block.items || [])[i] || ''))) continue;
    out.push({ accn, filed });
  }
  return out;
}
async function listFilings(cik) {
  const pad = String(cik).padStart(10, '0');
  const j = await sec(`https://data.sec.gov/submissions/CIK${pad}.json`, true);
  if (!j || !j.filings) return null;
  let all = resultsFilings(j.filings.recent);
  // The older pages, only those reaching back past SINCE.
  for (const f of j.filings.files || []) {
    if (!f || !f.name || String(f.filingTo || '') < SINCE) continue;
    const page = await sec('https://data.sec.gov/submissions/' + f.name, true);
    if (page) all = all.concat(resultsFilings(page));
  }
  const seen = new Set();
  return all.filter((x) => (seen.has(x.accn) ? false : seen.add(x.accn))).sort((a, b) => (a.filed < b.filed ? 1 : -1));
}
// EACH QUARTER AS FIRST FILED. sec_facts keeps every filing's version of a
// quarter, and later ones are restated: NVIDIA's 2024 first quarter reads EPS
// 5.98 in that 10-Q and 0.60 a year later (the ten-for-one split); GE's 2017
// third quarter $33.5B first, $28.8B after units were moved to discontinued.
// A release printed the first version, so both the size reference and the
// 10-Q check use it: per quarter, each figure from the earliest filing that
// has it.
function asFiled(facts) {
  const by = new Map();
  const sorted = (facts || []).filter((f) => f && f.periodType === 'Q' && f.periodEnd).sort((a, b) => (String(a.filed) < String(b.filed) ? -1 : 1));
  for (const f of sorted) {
    const cur = by.get(f.periodEnd);
    if (!cur) { by.set(f.periodEnd, Object.assign({}, f)); continue; }
    for (const k of ['revenue', 'netIncome', 'epsDiluted']) if (cur[k] == null || cur[k] === '') cur[k] = f[k];
  }
  return [...by.values()];
}
// The size reference at the time: the filed quarter nearest before the
// release (period end at most 200 days back), else the nearest after.
function refAt(facts, filed) {
  const at = Date.parse(filed + 'T12:00:00Z');
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const qs = facts.filter((f) => f && f.periodType === 'Q' && f.periodEnd && n(f.revenue) > 0)
    .map((f) => ({ f, gap: at - Date.parse(f.periodEnd + 'T12:00:00Z') }));
  const before = qs.filter((x) => x.gap >= 0 && x.gap <= 200 * 86400000).sort((a, b) => a.gap - b.gap)[0];
  const after = qs.filter((x) => x.gap < 0 && -x.gap <= 200 * 86400000).sort((a, b) => b.gap - a.gap)[0];
  const q = (before || after || {}).f;
  if (!q) return null;
  const ni = n(q.netIncome), eps = n(q.epsDiluted);
  return { shares: ni != null && eps != null && Math.abs(eps) >= 0.005 ? Math.abs(ni / eps) : null, revenueTtm: n(q.revenue) * 4 };
}

// A small pool: at most CONC model calls in flight.
const inflight = new Set();
async function slot() { while (inflight.size >= CONC) await Promise.race(inflight); }
let stopErr = null;
const tally = { iniKept: 0, iniCleared: 0, rechanged: 0, kinds: {}, initiated: 0, companies: 0, listed: 0, known: 0, read: 0, results: 0, notResults: 0, flagged: 0, failed: 0, written: 0, checked: 0, differ: 0, noRef: 0 };
const logLine = (s) => console.log(s);
const b = (v) => (v == null ? '—' : (v / 1e9).toFixed(2) + 'B');

// INITIATED, FROM THE HISTORY (the owner's choice, 2026-10-24): each of the
// company's results releases with no stated change that gives the first
// full-year guidance on file for a year (Releases.initiatedFrom). Only that
// column and its quote are written.
// With `recheck` (--initiated, the owner's OK of 2026-10-24) a stored
// "initiated" from before the rule (the model's own word) is tested too: kept
// where the history agrees, cleared where it does not or cannot say.
async function initiatedPass(sym, recheck) {
  const rows = await store.readEarningsReleases(sym, 160).catch(() => []);
  for (const r of rows) {
    if (!r.isResults) continue;
    if (r.guideChange === 'initiated' && recheck) {
      const v = Rel.initiatedVerdict(r, rows).verdict;
      if (v === 'yes') { tally.iniKept++; continue; }
      // The history cannot say, or the company says in words it is starting
      // full-year guidance (again): its words stand.
      if (v === 'unknown' || Rel.saysFullYearStart(r.guideChangeQuote)) { tally.iniWords = (tally.iniWords || 0) + 1; continue; }
      tally.iniCleared++;
      if (COMMIT) await store.writeReleaseChange(r.accn, null, null);
      continue;
    }
    if (r.guideChange) continue;
    // Initiated first, else the change against the previous release (2026-10-25).
    const h = Rel.changeFromHistory(r, rows);
    if (!h) continue;
    if (h.change === 'initiated') tally.initiated++;
    else { tally.fromPrev = tally.fromPrev || {}; tally.fromPrev[h.change] = (tally.fromPrev[h.change] || 0) + 1; }
    if (COMMIT) await store.writeReleaseChange(r.accn, h.change, h.quote);
    r.guideChange = h.change;
  }
}
// THE CHANGE, READ AGAIN (--rechange): the same request as a reading, only the
// guidance kept. Guidance items the new reading lacks keep the stored ones.
async function rechangeOne(sym, x, text, facts) {
  try {
    const got = await ask(text);
    const { row, problems } = Rel.toRow(got.ans, text, { accn: x.accn, symbol: sym, filed: x.filed, url: x.url });
    if (!row.isResults) { logLine(`  ${sym} ${x.filed}: read as not results this time; left as stored | $${got.usd.toFixed(4)}`); return; }
    const guides = row.guides && row.guides.length ? row.guides : (x.guides || []);
    const it = guides.find((g) => g.metric === 'eps_gaap' && g.periodType === 'full_year' && g.prior == null);
    const g = { guides, guideChange: row.guideChange || null, guideChangeQuote: row.guideChangeQuote || null, epsGuidePrior: it ? Rel.priorFyEps(it, facts) : x.epsGuidePrior };
    tally.rechanged++;
    const k = g.guideChange || 'none'; tally.kinds[k] = (tally.kinds[k] || 0) + 1;
    const gp = problems.filter((p) => /^guidance change/.test(p));
    logLine(`  ${sym} ${x.filed}: ${g.guideChange || 'no change stated'}${g.guideChangeQuote ? ' "' + g.guideChangeQuote.slice(0, 90) + '"' : ''}${gp.length ? ' | ' + gp[0].slice(0, 120) : ''} | $${got.usd.toFixed(4)}`);
    if (COMMIT) await store.writeReleaseGuidance(x.accn, g);
  } catch (err) {
    if (err instanceof Stop) { stopErr = stopErr || err; return; }
    tally.failed++;
    logLine(`  ${sym} ${x.filed}: failed (${String(err.message).slice(0, 120)}); next run`);
  }
}
async function rechangeRun(rows) {
  let stop = 'done';
  outer:
  for (const r of rows) {
    const sym = r.symbol;
    const stored = await store.readEarningsReleases(sym, 160).catch(() => []);
    // Only the readings whose claimed change was refused: where the model said
    // none, the history alone decides Initiated (initiatedPass, below).
    const targets = stored.filter((x) => x.isResults && !x.guideChange && x.url && /\.htm/i.test(x.url)
      && ((Array.isArray(x.guides) && x.guides.length) || x.guideSentence || x.guideKind)
      && (x.problems || []).some((p) => /^guidance change/.test(p)));
    tally.companies++;
    if (targets.length) {
      console.log(`  ${sym}: ${targets.length} with an outlook and no stated change`);
      const facts = ((await store.readSecFactsSince([sym], (Number(SINCE.slice(0, 4)) - 2) + '-01-01').catch(() => new Map())).get(sym) || []).filter((f) => f && f.periodType !== 'Q');
      for (const x of targets) {
        if (stopErr) break outer;
        if (spent >= MAX_USD) { stop = 'the dollar limit'; break outer; }
        if (Date.now() - t0 > MAX_MIN * 60000) { stop = 'the time limit'; break outer; }
        try {
          const html = await sec(x.url);
          if (!html) { console.log(`  ${sym} ${x.filed}: the exhibit did not load; next run`); tally.failed++; continue; }
          const text = Rel.toText(html);
          await slot();
          const p = rechangeOne(sym, x, text, facts).finally(() => inflight.delete(p));
          inflight.add(p);
        } catch (err) { if (err instanceof Stop) throw err; tally.failed++; }
      }
      await Promise.all(inflight);
    }
    await initiatedPass(sym);
  }
  await Promise.all(inflight);
  if (stopErr) throw stopErr;
  if (stop !== 'done') console.log('  stopping: ' + stop);
}
async function readOne(sym, e, meta, text, facts) {
  try {
    const got = await ask(text);
    const { row, problems } = Rel.toRow(got.ans, text, meta);
    delete row.ref;
    if (row.isResults) {
      const it = (row.guides || []).find((g) => g.metric === 'eps_gaap' && g.periodType === 'full_year' && g.prior == null);
      row.epsGuidePrior = it ? Rel.priorFyEps(it, facts) : null;
    }
    const out = Object.assign(row, { problems, model: MODEL, inTok: got.inTok, outTok: got.outTok, usd: got.usd, readAt: Date.now() });
    tally.read++;
    if (row.isResults) tally.results++; else tally.notResults++;
    if (problems.length) tally.flagged++;
    const c = row.isResults ? Rel.tenQCheck(out, facts) : null;
    logLine(`  ${sym} ${e.filed}: ` + (row.isResults
      ? `${row.periodLabel || ''} revenue ${b(row.revenue)} EPS ${row.epsGaap == null ? '—' : row.epsGaap}` + (row.guideChange ? ` guidance ${row.guideChange}` : '') + ((row.guides || []).length ? ` ${row.guides.length} guide item(s)` : '')
        + (c ? ` 10-Q ${c.result}${c.differs.length ? ' (' + c.differs.join(', ') + ')' : ''}` : '')
      : 'not a results release') + (problems.length ? ' | ' + problems.join('; ') : '') + ` | $${got.usd.toFixed(4)}`);
    if (COMMIT) {
      tally.written += await store.writeEarningsRelease(out, { replace: FORCE });
      if (c) { await store.writeReleaseCheck(out.accn, c); tally.checked++; if (c.result === 'differs') tally.differ++; }
    }
  } catch (err) {
    if (err instanceof Stop) { stopErr = stopErr || err; return; }
    tally.failed++;
    logLine(`  ${sym} ${e.filed}: failed (${String(err.message).slice(0, 120)}); next run`);
  }
}

(async () => {
  if (!LIST_ONLY && !KEY) throw new Stop('ANTHROPIC_API_KEY is not set');
  if (!UA) throw new Stop('no SEC user agent: set SEC_UA, REPORT_TO or MAIL_FROM');
  const [snap, ids] = await Promise.all([store.readSnapshot(), store.readFilerIds()]);
  let rows = ((snap && snap.stocks) || []).filter((r) => r && r.symbol && r.instrumentType !== 'ETF' && ids[r.symbol]);
  if (SYMBOLS.length) rows = rows.filter((r) => SYMBOLS.includes(r.symbol));
  rows.sort((x, y) => (Number(y.marketCap) || 0) - (Number(x.marketCap) || 0));
  if (SKIP) rows = rows.slice(SKIP);
  if (LIMIT) rows = rows.slice(0, LIMIT);
  console.log(`[${new Date().toISOString()}] results releases filed since ${SINCE}: ${rows.length} companies; model ${MODEL}, ${CONC} at once; `
    + `stop at $${MAX_USD.toFixed(2)} or ${MAX_MIN} min. ` + (LIST_ONLY ? 'LIST ONLY' : COMMIT ? 'COMMIT' : 'DRY RUN: nothing will be written'));
  if (INITIATED) {
    console.log('  INITIATED: the history rule over every company; stored "initiated" checked against it');
    for (const r of rows) { await initiatedPass(r.symbol, true); tally.companies++; }
    console.log('  initiated: ' + tally.iniKept + ' kept (the history agrees), ' + (tally.iniWords || 0) + ' kept on the company’s words (the history cannot say),' + tally.iniCleared + ' cleared (the history says otherwise), ' + tally.initiated + ' newly marked; ' + (COMMIT ? 'written' : 'DRY RUN, nothing written'));
    console.log('  against the previous release: ' + JSON.stringify(tally.fromPrev || {}));
    process.exit(0);
  }
  if (RECHANGE) { console.log('  RECHANGE: the stored releases with an outlook and no stated change, read again; then Initiated from the history'); await rechangeRun(rows); finish(); process.exit(0); }
  let stop = 'done';
  outer:
  for (const r of rows) {
    const sym = r.symbol;
    const cik = ids[sym];
    let list;
    try { list = await listFilings(cik); }
    catch (err) { if (err instanceof Stop) throw err; console.log(`  ${sym}: the filing list failed (${String(err.message).slice(0, 80)})`); tally.failed++; continue; }
    if (!list) { console.log(`  ${sym}: no submissions feed`); continue; }
    tally.companies++;
    tally.listed += list.length;
    const known = list.length ? await store.readEarningsReleaseAccns(list.map((x) => x.accn)) : new Set();
    tally.known += known.size;
    const todo = FORCE ? list : list.filter((x) => !known.has(x.accn));
    console.log(`  ${sym}: ${list.length} results 8-Ks since ${SINCE}, ${todo.length} to read`);
    if (LIST_ONLY || !todo.length) continue;
    const allFacts = (await store.readSecFactsSince([sym], (Number(SINCE.slice(0, 4)) - 2) + '-01-01').catch(() => new Map())).get(sym) || [];
    // Quarters as first filed (the guard, the 10-Q check); the annual 10-K
    // figures as they are (the prior-year EPS behind a full-year guide).
    const facts = asFiled(allFacts).concat(allFacts.filter((f) => f && f.periodType !== 'Q'));
    for (const e of todo) {
      if (stopErr) break outer;
      if (spent >= MAX_USD) { stop = 'the dollar limit'; break outer; }
      if (Date.now() - t0 > MAX_MIN * 60000) { stop = 'the time limit'; break outer; }
      const meta = { accn: e.accn, symbol: sym, filed: e.filed };
      try {
        const base = Rel.archiveBase(cik, e.accn);
        const hdr = await sec(base + e.accn + '-index-headers.html');
        if (!hdr) { console.log(`  ${sym} ${e.filed}: the filing index did not load; next run`); tally.failed++; continue; }
        const ex = Rel.pickExhibit(hdr);
        if (!ex) {
          const row = Object.assign({}, meta, { isResults: false, url: base, exhibit: null, problems: ['the filing has no EX-99 exhibit'], model: null, inTok: null, outTok: null, usd: null, readAt: Date.now() });
          console.log(`  ${sym} ${e.filed}: no EX-99 exhibit`);
          tally.notResults++;
          if (COMMIT) tally.written += await store.writeEarningsRelease(row, { replace: FORCE });
          continue;
        }
        meta.url = base + ex.file; meta.exhibit = ex.type;
        const ref = refAt(facts, e.filed);
        if (ref) meta.ref = ref; else tally.noRef++;
        const html = await sec(meta.url);
        if (!html) { console.log(`  ${sym} ${e.filed}: the exhibit did not load; next run`); tally.failed++; continue; }
        const text = Rel.toText(html);
        await slot();
        const p = readOne(sym, e, meta, text, facts).finally(() => inflight.delete(p));
        inflight.add(p);
      } catch (err) {
        if (err instanceof Stop) throw err;
        tally.failed++;
        console.log(`  ${sym} ${e.filed}: failed (${String(err.message).slice(0, 120)}); next run`);
      }
    }
    // The company's readings all in: Initiated from its history.
    await Promise.all(inflight);
    await initiatedPass(sym);
  }
  await Promise.all(inflight);
  if (stopErr) throw stopErr;
  if (stop !== 'done') console.log('  stopping: ' + stop);
  finish();
  process.exit(0);
})().catch(async (e) => {
  await Promise.all(inflight).catch(() => {});
  console.log(`  STOPPED: ${e instanceof Stop ? e.message : e.stack}`);
  finish();
  process.exit(e instanceof Stop ? 3 : 1);
});
function finish() {
  const t = tally;
  if (RECHANGE || t.initiated) console.log(`  guidance change: ${t.rechanged} read again (${JSON.stringify(t.kinds)}); ${t.initiated} initiated from the history`);
  console.log(`  done: ${t.companies} companies, ${t.listed} results 8-Ks listed (${t.known} read before); ${t.read} read (${t.results} results, ${t.notResults} not), `
    + `${t.flagged} with a figure refused, ${t.failed} to retry, ${t.noRef} without a size reference; 10-Q ${t.checked} compared, ${t.differ} differ; `
    + `${COMMIT ? t.written + ' written' : 'nothing written'}; $${spent.toFixed(4)}; ${secCalls} SEC fetches; ${Math.round((Date.now() - t0) / 1000)}s`);
  if (t.read) console.log(`  per release: $${(spent / t.read).toFixed(4)}`);
}
