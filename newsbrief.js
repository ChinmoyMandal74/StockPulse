// THE TWO EVENING NEWS BRIEFS (2026-11-12, the owner: "I need two daily brief
// of the news .. this should be extracted AI outputs .. one should tell me a
// summary of what happened today .. just one or two lines per news sorted by
// importance and the other should be what is important for the next trading
// day. These email should come around 5:40 pm everyday New York time").
//
// Both are built from the article readings the tone loader already stores
// (newstone.js: each article's kind, whether it is about the company, its
// summary, and the importance rule), so the first costs nothing:
//   Today      every high and medium story since the last brief, one line a
//              story (its lead article's summary), high first, then by how
//              many outlets told it, then by market value.
//   Next day   one model call over the day's important stories and the
//              companies reporting before the next open or after today's
//              close, asked for up to ten things that matter for the next
//              session; every line must cite the inputs it came from, and is
//              dropped if it names a number or a company those inputs do not
//              hold, or uses a word the site does not use. Below it, the two
//              calendar lists, drawn from the stored calendar, not the model.
// Pure: no database, no mail, no fetch. server.js reads, calls and sends.
// Display only, sent to the operator; never the Signal.
'use strict';
const NewsTone = require('./newstone.js');

// ---- the trading calendar ------------------------------------------------------
// The NYSE's full-day holidays by rule, so no list goes stale. A New Year's
// Day on a Saturday is not made up on the Friday before (the exchange's own
// rule); every other holiday on a weekend moves to the nearest weekday.
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
const at = (day) => Date.parse(day + 'T12:00:00Z');
const addDays = (day, n) => ymd(at(day) + n * 864e5);
const dow = (day) => new Date(at(day)).getUTCDay();
function nth(y, month, weekday, n) {          // the nth weekday of a month (n = -1: the last)
  if (n > 0) { const first = Date.UTC(y, month, 1, 12); const off = (weekday - new Date(first).getUTCDay() + 7) % 7; return ymd(first + (off + (n - 1) * 7) * 864e5); }
  const last = Date.UTC(y, month + 1, 0, 12); const back = (new Date(last).getUTCDay() - weekday + 7) % 7; return ymd(last - back * 864e5);
}
function easter(y) {                          // the Gregorian computus
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(Date.UTC(y, month - 1, day, 12));
}
function observed(day) { const w = dow(day); return w === 6 ? addDays(day, -1) : w === 0 ? addDays(day, 1) : day; }
const holidayCache = new Map();
function holidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const p = (m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const ny = p(1, 1);
  const set = new Set([
    dow(ny) === 6 ? null : observed(ny),
    nth(y, 0, 1, 3), nth(y, 1, 1, 3), addDays(easter(y), -2), nth(y, 4, 1, -1),
    y >= 2022 ? observed(p(6, 19)) : null, observed(p(7, 4)), nth(y, 8, 1, 1), nth(y, 10, 4, 4), observed(p(12, 25)),
  ].filter(Boolean));
  holidayCache.set(y, set);
  return set;
}
const isTradingDay = (day) => dow(day) !== 0 && dow(day) !== 6 && !holidays(Number(day.slice(0, 4))).has(day);
function nextTradingDay(day) { let d = addDays(day, 1); while (!isTradingDay(d)) d = addDays(d, 1); return d; }
const dayName = (day) => new Date(at(day)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });

// ---- today's stories -------------------------------------------------------------
const RANK = { high: 2, medium: 1, low: 0 };
// The window: everything published since the last brief went, and anything
// published in the day before it that was only read after it went (the tone
// runs are hourly, so an article from 17:30 is read at 18:26), so each story
// is in one brief and no story is in none. `prevAt` null on the first brief:
// the last 24 hours.
function inWindow(r, prevAt, now) {
  const p = Date.parse(r.published_at);
  if (!Number.isFinite(p) || p > now + 60e3) return false;
  const from = prevAt || now - 864e5;
  if (p > from) return true;
  return prevAt != null && Number(r.scored_at) > prevAt && p > prevAt - 864e5;
}
// rows: news_tone readings (scored, with scored_at). info(symbol): { name, cap }.
// Returns stories, most important first: { id, symbol, name, cap, kind,
// kindLabel, importance, coverage, publishedAt, summary, headline, url }.
function stories(rows, info, prevAt, now) {
  const use = (rows || []).filter((r) => r && r.symbol && inWindow(r, prevAt, now));
  const nameOf = (s) => ((info(s) || {}).name || '');
  const groups = NewsTone.storyGroups(use, nameOf);
  const outlets = new Map();
  use.forEach((r, i) => { const g = groups[i]; if (!outlets.has(g)) outlets.set(g, new Set()); outlets.get(g).add(String(r.source || r.url)); });
  const lead = new Map();
  use.forEach((r, i) => {
    const g = groups[i], cov = outlets.get(g).size, im = NewsTone.importance(r, cov);
    const cur = lead.get(g);
    // A story's lead: its most important article with a summary, then the earliest.
    if (!r.summary) return;
    if (!cur || RANK[im] > RANK[cur.importance] || (RANK[im] === RANK[cur.importance] && r.published_at < cur.r.published_at)) lead.set(g, { r, importance: im, coverage: cov });
  });
  const out = [];
  for (const [g, x] of lead) {
    const i = info(x.r.symbol) || {};
    out.push({ id: x.r.id || String(g), symbol: x.r.symbol, name: i.name || x.r.symbol, cap: Number.isFinite(i.cap) ? i.cap : null,
      kind: x.r.kind, kindLabel: NewsTone.KIND_LABEL[x.r.kind] || x.r.kind || '', importance: x.importance, coverage: x.coverage,
      publishedAt: x.r.published_at, summary: x.r.summary, headline: x.r.headline || '', url: x.r.url || '' });
  }
  out.sort((a, b) => RANK[b.importance] - RANK[a.importance] || b.coverage - a.coverage || (b.cap || 0) - (a.cap || 0) || (a.publishedAt < b.publishedAt ? 1 : -1));
  return out;
}
// "One or two lines": the summary's first sentence, both when the first is short.
function line(summary) {
  const s = String(summary || '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(\s+[A-Z(“"]|$)/.exec(s);
  const first = m ? m[1] : s;
  if (first.length >= 90 || first.length === s.length) return first.length > 260 ? first.slice(0, 257).replace(/\s+\S*$/, '') + '…' : first;
  return s.length > 260 ? s.slice(0, 257).replace(/\s+\S*$/, '') + '…' : s;
}

// ---- the next trading day ------------------------------------------------------
const AFTER_CLOSE_MIN = 16 * 60;
const etMinute = (iso) => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)); return Number(p.find((x) => x.type === 'hour').value) * 60 + Number(p.find((x) => x.type === 'minute').value); };
const etDay = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
// The calendar lists: who reports before the next open (or on that day at an
// unstated time) and who reported after today's close. cal: { SYM: { d, time } }
// (the stored calendar's next listed day per company, read from today on).
function calendar(cal, info, today, next) {
  const before = [], after = [];
  for (const [symbol, c] of Object.entries(cal || {})) {
    const i = info(symbol);
    if (!i || !c) continue;
    const row = { symbol, name: i.name || symbol, cap: Number.isFinite(i.cap) ? i.cap : null, time: c.time || null };
    if (c.d === today && c.time === 'post-market') after.push(row);
    else if (c.d === next && c.time !== 'post-market') before.push(row);
  }
  const byCap = (a, b) => (b.cap || 0) - (a.cap || 0) || a.symbol.localeCompare(b.symbol);
  return { before: before.sort(byCap), after: after.sort(byCap) };
}
// What the model is given: numbered items it must cite.
const MAX_STORIES_IN = 160, MAX_CAL_IN = 80, MAX_ITEMS = 10, MAX_LINE = 260, MAX_INTRO = 320;
function candidates(list, cal, today) {
  const c = [];
  const imp = list.filter((s) => s.importance === 'high').concat(list.filter((s) => s.importance === 'medium' && s.coverage >= 2)).slice(0, MAX_STORIES_IN);
  imp.forEach((s, i) => {
    const sameDay = etDay(s.publishedAt) === today;
    const m = etMinute(s.publishedAt);
    c.push({ id: 'n' + (i + 1), type: 'story', symbol: s.symbol, name: s.name, cap: s.cap, kind: s.kind, importance: s.importance, coverage: s.coverage,
      when: sameDay ? (m >= AFTER_CLOSE_MIN ? 'after the close' : m < 9 * 60 + 30 ? 'before the open' : 'during the session') : 'earlier', text: s.summary });
  });
  cal.before.slice(0, MAX_CAL_IN).forEach((r, i) => c.push({ id: 'b' + (i + 1), type: 'reports_next', symbol: r.symbol, name: r.name, cap: r.cap, text: r.name + ' (' + r.symbol + ') reports results ' + (r.time === 'pre-market' ? 'before the open' : 'that day, time not stated') + '.' }));
  cal.after.slice(0, MAX_CAL_IN).forEach((r, i) => c.push({ id: 'a' + (i + 1), type: 'reported_tonight', symbol: r.symbol, name: r.name, cap: r.cap, text: r.name + ' (' + r.symbol + ') was listed to report results after today\'s close.' }));
  return c;
}
const capText = (v) => (v == null ? 'n/a' : v >= 1e12 ? '$' + (v / 1e12).toFixed(1) + 'T' : v >= 1e9 ? '$' + Math.round(v / 1e9) + 'B' : '$' + Math.round(v / 1e6) + 'M');

const SYSTEM = [
  'You write the evening note for the owner of a stock screener: what in today\'s company news and the results calendar is most likely to matter for the next trading session.',
  'You are given numbered inputs: stories (each one a company\'s news today, with its kind, how many outlets carried it, when it was published, and a summary) and the results calendar (companies reporting before the next open, and companies listed to report after today\'s close).',
  'Pick at most ten things, most important first. Weigh results and guidance released after today\'s close or due before the next open, large companies, deals, legal or regulatory decisions, leadership changes, and stories many outlets carried. Join related inputs into one item (several companies in one industry reporting, one deal touching two companies).',
  'Each item is one or two plain sentences, under 240 characters, and cites the ids of every input it uses. Use only facts in the inputs: no figure, company or date that is not in them, and no outside knowledge.',
  'Describe; do not advise or forecast. Never say a share price will rise or fall, never use buy, sell, hold, bullish, bearish, outperform, underperform, overweight, underweight or price target, and never rank stocks as picks.',
  'The intro is one sentence on what the next session has in store, under 300 characters, from the inputs only.',
].join(' ');
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['intro', 'items'],
  properties: {
    intro: { type: 'string' },
    items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['ids', 'line'], properties: { ids: { type: 'array', items: { type: 'string' } }, line: { type: 'string' } } } },
  },
};
const MODEL = 'claude-sonnet-5-5';
function userPrompt(cands, next) {
  const rows = cands.map((c) => c.type === 'story'
    ? `${c.id} | ${c.symbol} ${c.name} | value ${capText(c.cap)} | ${c.kind}, ${c.importance}, ${c.coverage} outlet${c.coverage === 1 ? '' : 's'}, ${c.when} | ${c.text}`
    : `${c.id} | ${c.symbol} ${c.name} | value ${capText(c.cap)} | ${c.text}`);
  return `The next trading session is ${dayName(next)}.\n\nInputs:\n` + rows.join('\n');
}
function request(cands, next) {
  return { model: MODEL, max_tokens: 3000, system: SYSTEM, output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: userPrompt(cands, next) }] };
}
// The numbers a line states: each must be in an input it cites. "$1.2 billion"
// is checked as 1.2, "12%" as 12; a year or a day of the month too.
// A quarter's number (Q3) is a label, not a figure.
const numbers = (s) => (String(s).replace(/\b(?:Q[1-4]|[1-4]Q)\b/g, ' ').match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, ''));
const hasNumber = (n, text) => numbers(text).includes(n) || numbers(text).some((x) => Number(x) === Number(n));
// symbols: the whole universe's tickers, to catch a company named that no
// cited input holds: a ticker in brackets, or bare and not a common
// abbreviation that happens to be one (AI, CEO, ON). `extra`: text the model
// was also given (the session's date).
const COMMON = new Set(['AI', 'CEO', 'CFO', 'COO', 'CTO', 'IPO', 'FDA', 'SEC', 'FTC', 'DOJ', 'EU', 'UK', 'US', 'USA', 'EPS', 'GAAP', 'ET', 'ON', 'IT', 'ALL', 'ARE', 'NOW', 'CAN', 'ANY', 'ONE', 'BIG', 'KEY', 'NEW', 'OUT', 'FY', 'TV', 'PC', 'EV', 'GPU', 'CPU', 'LLC', 'INC', 'API', 'AM', 'PM']);
function check(ans, cands, symbols, extra) {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const dropped = [];
  const items = [];
  if (!ans || typeof ans !== 'object' || !Array.isArray(ans.items)) return { ok: false, intro: '', items: [], dropped: ['no answer'] };
  for (const it of ans.items.slice(0, MAX_ITEMS + 5)) {
    const text = String(it && it.line || '').replace(/\s+/g, ' ').trim();
    const ids = [...new Set((it && Array.isArray(it.ids) ? it.ids : []).map(String))];
    const cited = ids.map((id) => byId.get(id)).filter(Boolean);
    let why = null;
    if (!text) why = 'empty';
    else if (!cited.length || cited.length !== ids.length) why = 'cites an input that does not exist';
    else if (text.length > MAX_LINE) why = 'too long';
    else if (NewsTone.BANNED.test(text)) why = 'a word the site does not use (' + text.match(NewsTone.BANNED)[0] + ')';
    else {
      const src = cited.map((c) => c.name + ' ' + c.text).join(' ') + ' ' + (extra || '');
      const bad = numbers(text).find((n) => !hasNumber(n, src));
      if (bad) why = 'a figure not in its inputs (' + bad + ')';
      const own = new Set(cited.map((c) => c.symbol));
      const inBrackets = (text.match(/\(([A-Z][A-Z.]{0,5})\)/g) || []).map((w) => w.slice(1, -1));
      const bare = (text.match(/\b[A-Z]{2,5}\b/g) || []).filter((w) => !COMMON.has(w));
      const stray = inBrackets.concat(bare).find((w) => symbols.has(w) && !own.has(w));
      if (!why && stray) why = 'names a company its inputs do not (' + stray + ')';
    }
    if (why) { dropped.push(why); continue; }
    if (items.length < MAX_ITEMS) items.push({ line: text, symbols: [...new Set(cited.map((c) => c.symbol))], ids });
  }
  let intro = String(ans.intro || '').replace(/\s+/g, ' ').trim();
  if (intro && (intro.length > MAX_INTRO || NewsTone.BANNED.test(intro) || numbers(intro).some((n) => !hasNumber(n, cands.map((c) => c.name + ' ' + c.text).join(' ') + ' ' + (extra || ''))))) { dropped.push('intro'); intro = ''; }
  return { ok: items.length > 0, intro, items, dropped };
}
// The money one call cost, at the model's list price.
const PRICE = { in: 2 / 1e6, out: 10 / 1e6 };
const spend = (usage) => (usage ? (Number(usage.input_tokens) || 0) * PRICE.in + (Number(usage.output_tokens) || 0) * PRICE.out : 0);

module.exports = {
  isTradingDay, nextTradingDay, holidays, easter, addDays, dayName, etDay,
  inWindow, stories, line, calendar, candidates, request, userPrompt, check, spend, capText,
  SYSTEM, SCHEMA, MODEL, MAX_ITEMS, RANK,
};
