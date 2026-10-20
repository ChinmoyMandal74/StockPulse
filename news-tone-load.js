// Read the articles in the semiconductor stocks' Yahoo Finance feeds and
// store a model's reading of each: what kind of article, whether it is about
// the company, how its content leans, and two sentences of summary. LOCAL:
// run from the owner's machine. See newstone.js for what is kept and why,
// and for why the feed is Yahoo's and not the stored Google headlines.
//
// WHY LOCAL. Publishers refuse many data-centre addresses, and a lap is a
// few hundred page fetches plus a model call each: neither fits a 300-second
// function. Same shape as options-load.js.
//
// POLITE BY CONSTRUCTION: one request at a time, a pause between requests to
// the same site, robots.txt obeyed, and an honest user agent. A site that
// refuses (401/403/451, or a robots rule) is recorded as unreadable and that
// article is never asked for again.
//
// COST: Claude Sonnet 5.5 at $2 / $10 per million tokens in / out, about a
// cent an article. Every run prints what it spent and stops at --max-usd.
// A DRY RUN STILL CALLS THE MODEL (the only way to see a reading) but writes
// nothing, and reads 5 articles unless --limit says otherwise.
//
//   node news-tone-load.js                          # 5 articles, report, write nothing
//   node news-tone-load.js --commit                 # the last 7 days, every semiconductor stock
//   node news-tone-load.js --commit --max-usd 3
//   node news-tone-load.js --commit --only NVDA,MU --limit 30
//
// Yahoo's pages send more header bytes than Node accepts by default, so the
// script re-launches itself with a larger limit (and the system CA store).
const { spawnSync } = require('child_process');
if (!process.execArgv.some((a) => a.startsWith('--max-http-header-size'))) {
  const r = spawnSync(process.execPath, ['--use-system-ca', '--max-http-header-size=262144', __filename, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status == null ? 1 : r.status);
}

require('dotenv').config();
const crypto = require('crypto');
const store = require('./db.js');
const NewsTone = require('./newstone.js');

const COMMIT = process.argv.includes('--commit');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const ONLY = arg('--only') ? new Set(String(arg('--only')).toUpperCase().split(',').filter(Boolean)) : null;
const DAYS = Math.max(1, Number(arg('--days')) || 7);
const LIMIT = Number(arg('--limit')) || (COMMIT ? 0 : 5);
const MAX_USD = Number(arg('--max-usd')) || 8;
const MODEL = process.env.NEWS_TONE_MODEL || NewsTone.MODEL;
// Per token, in and out, by model (published rates, 2026-10-19). Haiku 5.5's
// is its rate for a prompt of 100K tokens or fewer, which an article always is.
const PRICES = {
  'claude-sonnet-5-5': { in: 2 / 1e6, out: 10 / 1e6 },
  'claude-haiku-5-5': { in: 0.10 / 1e6, out: 0.50 / 1e6 },
};
const priceOf = (m) => PRICES[m] || PRICES['claude-sonnet-5-5'];
// A SHADOW MODEL (2026-10-19, the owner: "try using a lower model and observe
// for a few days and compare costs"). Every article the main model reads is
// also sent to this one, the same instructions and the same fetched text, and
// both answers are appended side by side to news-tone-shadow.jsonl (local,
// gitignored). The shadow's answer is NEVER written to the database: members
// see the main model's reading only. news-tone-compare.js reads the file.
const SHADOW = arg('--shadow') || null;
const SHADOW_MAX_USD = Number(arg('--shadow-max-usd')) || 1;
const SHADOW_FILE = require('path').join(__dirname, 'news-tone-shadow.jsonl');
const KEY = process.env.ANTHROPIC_API_KEY || '';
const UA = 'Mozilla/5.0 (compatible; TickrLab/1.0; +https://www.tickrlab.com)';
const SITE_GAP_MS = 3000;
const FEED_GAP_MS = 600;
const RETRY_AFTER_MS = 6 * 3600 * 1000;
const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idOf = (symbol, url) => crypto.createHash('sha256').update(symbol + '|' + url).digest('hex').slice(0, 32);

// One clock per host, so two articles from the same site are spaced out
// while a different site can go straight away.
const lastAt = new Map();
async function politeFetch(url, opts) {
  const host = new URL(url).hostname;
  const wait = (lastAt.get(host) || 0) + (host.startsWith('feeds.') ? FEED_GAP_MS : SITE_GAP_MS) - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt.set(host, Date.now());
  return fetch(url, Object.assign({ redirect: 'follow', signal: AbortSignal.timeout(15000) }, opts,
    { headers: Object.assign({ 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8' }, (opts && opts.headers) || {}) }));
}

const robotsCache = new Map();
async function robotsOk(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.host)) {
    let rules = { allow: [], disallow: [] };
    try {
      const r = await politeFetch(`${u.protocol}//${u.host}/robots.txt`);
      // No robots file (404) means no rules. A refused one (401/403) is
      // treated as "keep out", which is how crawlers read it.
      if (r.ok) rules = NewsTone.robotsRules(await r.text(), 'TickrLab');
      else if (r.status === 401 || r.status === 403) rules = { allow: [], disallow: ['/'] };
    } catch (e) { /* unreachable robots file: no rules learned */ }
    robotsCache.set(u.host, rules);
  }
  return NewsTone.robotsAllows(robotsCache.get(u.host), u.pathname + u.search);
}

// The page text for an article, once per run however many stocks' feeds
// carry it: {text} or {status, reason}.
const pageCache = new Map();
async function readPage(url) {
  if (pageCache.has(url)) return pageCache.get(url);
  let out;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (!(await robotsOk(url))) out = { status: 'unreadable', reason: 'robots.txt', host };
    else {
      const res = await politeFetch(url, { headers: { Accept: 'text/html,application/xhtml+xml' } });
      if ([401, 402, 403, 451].includes(res.status)) out = { status: 'unreadable', reason: 'refused ' + res.status, host };
      else if (res.status === 404 || res.status === 410) out = { status: 'unreadable', reason: 'gone ' + res.status, host };
      else if (!res.ok || res.status === 202) out = { status: 'failed', reason: 'http ' + res.status, host };
      else {
        const text = NewsTone.articleText(await res.text());
        out = text.length < NewsTone.MIN_CHARS ? { status: 'unreadable', reason: 'no article text', host, chars: text.length } : { text, host };
      }
    }
  } catch (err) {
    out = { status: 'failed', reason: String(err.cause && err.cause.code || err.message).slice(0, 80) };
  }
  pageCache.set(url, out);
  return out;
}

class Stop extends Error {}
let spent = 0, shadowSpent = 0, shadowN = 0, shadowFail = 0, shadowOff = false;
// `shadow` puts the cost on the shadow's account, not the main budget's.
async function askModel(body, shadow) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 429 || r.status === 529) { await sleep((Number(r.headers.get('retry-after')) || 20) * 1000); continue; }
    if (!r.ok) {
      const type = data && data.error && data.error.type;
      // Credit, key or request faults will not fix themselves on the next
      // article: stop the run rather than fail every one.
      if ([400, 401, 403, 404].includes(r.status)) throw new Stop(`Anthropic answered ${r.status} ${type || ''}: ${String((data.error && data.error.message) || '').slice(0, 160)}`);
      throw new Error(`Anthropic ${r.status} ${type || ''}`);
    }
    const u = data.usage || {};
    const P = priceOf(body.model);
    const inTok = Number(u.input_tokens) || 0, outTok = Number(u.output_tokens) || 0;
    const usd = inTok * P.in + outTok * P.out;
    if (shadow) shadowSpent += usd; else spent += usd;
    const cost = { inTok, outTok, usd };
    if (data.stop_reason === 'refusal') return { refused: true, cost };
    if (data.stop_reason === 'max_tokens') throw new Error('answer cut off at max_tokens');
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { answer: JSON.parse(text), cost };
  }
  throw new Error('Anthropic kept answering 429');
}

// One article through the shadow model, and one line in the local file with
// both readings. The main model's FIRST answer is the one compared (before any
// re-ask), since the shadow is asked once too.
const pick = (g, model) => {
  if (!g) return null;
  if (g.error) return { model, error: g.error };
  if (g.refused) return { model, refused: true, cost: g.cost };
  const a = g.answer || {};
  const chk = NewsTone.check(a);
  return { model, readable: a.readable, about: a.about, kind: a.kind, tone: a.tone, complete: a.complete,
    summary: a.summary, problems: chk.ok ? [] : chk.problems, cost: g.cost };
};
async function shadowRead(h, input, main) {
  let sh;
  try { sh = await askModel(NewsTone.request(input, SHADOW), true); shadowN++; }
  catch (err) {
    sh = { error: String(err.message).slice(0, 120) }; shadowFail++;
    // A fault that will not fix itself (a 400, an unknown model) stops the
    // shadow for the rest of the run, never the main reading.
    if (err instanceof Stop) { shadowOff = true; console.log('  shadow stopped: ' + err.message); }
  }
  const line = { at: new Date().toISOString(), id: h.id, symbol: h.symbol, url: h.url, headline: h.headline,
    chars: input.text.length, main: main && main.answer ? pick(main, MODEL) : main, shadow: pick(sh, SHADOW) };
  try { require('fs').appendFileSync(SHADOW_FILE, JSON.stringify(line) + '\n'); } catch (e) { /* the file is a convenience */ }
  // Kept on the article for write(), which stores it in the row's shadow
  // columns once the main reading is written (the stock page shows it to the
  // admin). Only a reading that answered and kept the rules.
  const s = line.shadow;
  if (s && !s.error && !s.refused && typeof s.tone === 'number' && s.readable !== false) {
    h.__shadow = { model: SHADOW, about: s.about, kind: s.kind, tone: Math.round(s.tone * 100) / 100,
      summary: (s.problems || []).some((p) => /^summary/.test(p)) ? null : s.summary };
  }
}

// What a run should look at: no row yet, or a transient failure that has
// waited long enough and has not been tried too often.
const due = (k) => !k
  || (k.status === 'failed' && k.attempts < MAX_ATTEMPTS && Date.now() - (k.scoredAt || 0) > RETRY_AFTER_MS);

// THE SHADOW'S CATCH-UP (--shadow-backfill): the readings already on file for
// the last DAYS that the shadow has not read. Each article is fetched again
// (politely, as always) and read by the shadow ONLY; the main reading stays as
// it is, and the shadow's goes in its own columns and the local file.
async function shadowBackfill(stocks) {
  const since = new Date(Date.now() - DAYS * 86400000).toISOString();
  let todo = [];
  for (const s of stocks) {
    for (const r of await store.readNewsToneUnshadowed(s.symbol, since)) todo.push(Object.assign({ symbol: s.symbol, name: s.name }, r));
  }
  if (LIMIT) todo = todo.slice(0, LIMIT);
  console.log(`[${new Date().toISOString()}] shadow catch-up: ${todo.length} readings on file from the last ${DAYS} days without a ${SHADOW} reading; stop at $${SHADOW_MAX_USD.toFixed(2)}. `
    + (COMMIT ? 'COMMIT: writing the shadow columns' : 'DRY RUN: nothing will be written'));
  let done = 0, gone = 0;
  for (const h of todo) {
    if (shadowOff || shadowSpent >= SHADOW_MAX_USD) break;
    const page = await readPage(h.url);
    if (!page.text) { gone++; continue; }
    const input = { symbol: h.symbol, name: h.name, headline: h.headline, source: h.source, text: page.text };
    // The main reading as stored, in the shape the file keeps.
    const main = { model: h.model || MODEL, readable: true, about: h.about, kind: h.kind, tone: h.tone, summary: h.summary, problems: [], cost: null, stored: true };
    await shadowRead(h, input, main);
    if (COMMIT && h.__shadow) await store.writeNewsToneShadow(h.id, h.__shadow).catch(() => {});
    if (h.__shadow) done++;
    if ((done + gone) % 25 === 0) console.log(`  ${done + gone}/${todo.length} -- ${done} read, ${gone} no longer readable, $${shadowSpent.toFixed(3)}`);
  }
  console.log(`\nshadow catch-up: ${done} read, ${gone} no longer readable, ${shadowFail} failed; $${shadowSpent.toFixed(3)} spent`);
}

(async () => {
  if (!KEY) throw new Error('ANTHROPIC_API_KEY is not set in .env');
  const snap = await store.readSnapshot();
  const stocks = ((snap && snap.stocks) || []).filter((s) => NewsTone.INDUSTRIES.includes(s.industry))
    .filter((s) => !ONLY || ONLY.has(String(s.symbol).toUpperCase()));
  if (process.argv.includes('--shadow-backfill')) {
    if (!SHADOW) throw new Error('--shadow-backfill needs --shadow <model>');
    await shadowBackfill(stocks);
    return;
  }
  const sinceMs = Date.now() - DAYS * 86400000;
  const since = new Date(sinceMs).toISOString();
  let todo = [];
  let feedFail = 0;
  for (const s of stocks) {
    let items = [];
    try {
      const r = await politeFetch(NewsTone.feedUrl(s.symbol), { headers: { Accept: 'application/rss+xml,text/xml' } });
      if (!r.ok) throw new Error('http ' + r.status);
      items = NewsTone.parseFeed(await r.text());
    } catch (err) { feedFail++; console.log(`  ${s.symbol}: feed unavailable (${String(err.cause && err.cause.code || err.message).slice(0, 60)})`); continue; }
    const known = await store.readNewsToneKnown(s.symbol, since);
    for (const it of items) {
      if (Date.parse(it.published_at) < sinceMs) continue;
      const id = idOf(s.symbol, it.url);
      if (due(known[id])) todo.push(Object.assign({ id, symbol: s.symbol, name: s.name, source: NewsTone.sourceOf(it.url) }, it));
    }
  }
  // Newest first across all stocks, so a run cut short by the budget has
  // covered the most recent news everywhere rather than one stock in depth.
  todo.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  if (LIMIT) todo = todo.slice(0, LIMIT);
  // The run's start time, so the log says WHEN each run spent what it spent.
  console.log(`[${new Date().toISOString()}] ${stocks.length} semiconductor stocks (${feedFail} feeds unavailable), ${todo.length} articles to read from the last ${DAYS} days; `
    + `model ${MODEL}; stop at $${MAX_USD.toFixed(2)}. ` + (COMMIT ? 'COMMIT: writing news_tone' : 'DRY RUN: nothing will be written')
    + (SHADOW ? `; shadow ${SHADOW} (local file only, stop at $${SHADOW_MAX_USD.toFixed(2)})` : ''));

  const t0 = Date.now();
  const tally = { scored: 0, skipped: 0, unreadable: 0, failed: 0 };
  const why = {};
  let shown = 0;
  const write = async (h, row) => {
    tally[row.status]++;
    if (row.status !== 'scored') why[row.reason] = (why[row.reason] || 0) + 1;
    if (COMMIT) {
      await store.writeNewsTone(Object.assign({ id: h.id, symbol: h.symbol, published_at: h.published_at,
        headline: h.headline, source: h.source, url: h.url, model: MODEL }, row));
      if (h.__shadow) await store.writeNewsToneShadow(h.id, h.__shadow).catch(() => {});
    }
  };

  for (let i = 0; i < todo.length; i++) {
    const h = todo[i];
    if (spent >= MAX_USD) { console.log(`Stopping: $${spent.toFixed(2)} spent, the --max-usd ceiling.`); break; }
    try {
      const page = await readPage(h.url);
      if (!page.text) { await write(h, { status: page.status, reason: page.reason, host: page.host, chars: page.chars }); continue; }
      const base = { host: page.host, chars: page.text.length };
      if (!NewsTone.namesCompany(page.text, h.symbol, h.name)) { await write(h, Object.assign({ status: 'skipped', reason: 'company not named' }, base)); continue; }
      const input = { symbol: h.symbol, name: h.name, headline: h.headline, source: h.source, text: page.text };
      let got = await askModel(NewsTone.request(input, MODEL));
      // The shadow reads the same article now, from the same text: its own
      // budget, its own failures, and nothing it says reaches the database.
      if (SHADOW && !shadowOff && shadowSpent < SHADOW_MAX_USD) await shadowRead(h, input, got);
      if (got.refused) { await write(h, Object.assign({ status: 'unreadable', reason: 'model declined' }, base)); continue; }
      let chk = NewsTone.check(got.answer);
      // One second asking when the answer breaks a rule: the instruction is
      // restated with what went wrong.
      if (!chk.ok && got.answer && got.answer.readable) {
        const again = NewsTone.request(input, MODEL);
        again.messages[0].content += `\n\nA previous answer was refused for: ${chk.problems.join('; ')}. Answer again within the rules.`;
        got = await askModel(again);
        chk = got.refused ? { ok: false, problems: ['model declined'] } : NewsTone.check(got.answer);
      }
      const a = got.answer || {};
      if (a.readable === false) { await write(h, Object.assign({ status: 'unreadable', reason: 'not the article' }, base)); continue; }
      if (!chk.ok) {
        // The tone and kind are still a reading; only a summary that broke
        // the rules is withheld. Anything structurally wrong is a failure.
        if (!chk.problems.every((p) => /^summary/.test(p))) {
          await write(h, Object.assign({ status: 'failed', reason: 'answer invalid: ' + chk.problems.join('; ') }, base));
          continue;
        }
        a.summary = null;
      }
      await write(h, Object.assign({ status: 'scored', reason: chk.ok ? null : 'summary withheld: ' + chk.problems.join('; '),
        about: a.about, kind: a.kind, tone: Math.round(a.tone * 100) / 100, summary: a.summary, complete: !!a.complete }, base));
      if (!COMMIT || shown < 3) {
        shown++;
        console.log(`  ${h.symbol} ${NewsTone.label(a.tone)} ${a.tone >= 0 ? '+' : ''}${Number(a.tone).toFixed(2)} [${a.kind}, ${a.about}${a.complete ? '' : ', partial'}] ${page.host}`
          + `\n    ${String(h.headline).slice(0, 110)}\n    ${a.summary || '(summary withheld)'}`);
      }
    } catch (err) {
      if (err instanceof Stop) { console.log(err.message); break; }
      await write(h, { status: 'failed', reason: String(err.cause && err.cause.code || err.message).slice(0, 80) }).catch(() => {});
    }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${todo.length} -- ${tally.scored} scored, ${tally.unreadable} unreadable, ${tally.failed} failed, $${spent.toFixed(2)}, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  }
  console.log(`\n${tally.scored} scored, ${tally.skipped} skipped (company not named), ${tally.unreadable} unreadable, ${tally.failed} failed; $${spent.toFixed(2)} spent; ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`  ${n} x ${k}`);
  if (SHADOW) console.log(`  shadow ${SHADOW}: ${shadowN} read, ${shadowFail} failed, $${shadowSpent.toFixed(3)} spent (main ${MODEL}: $${spent.toFixed(3)})`);
  if (!COMMIT) console.log('DRY RUN: nothing written. Re-run with --commit.');
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
