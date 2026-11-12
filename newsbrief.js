// THE TWO EVENING NEWS BRIEFS (2026-11-12, the owner: "I need two daily brief
// of the news .. this should be extracted AI outputs .. one should tell me a
// summary of what happened today .. just one or two lines per news sorted by
// importance and the other should be what is important for the next trading
// day. These email should come around 5:40 pm everyday New York time").
//
// Both are built from the article readings the tone loader already stores
// (newstone.js: each article's kind, whether it is about the company, its
// summary, and the importance rule):
//   Today      (since the same day, the owner: "I want AI to re-read all the
//              news of the day and then summarize .. news should not be
//              repeated") one model call over every article since the last
//              brief that is mainly about its company, written up as at most
//              25 high and 35 medium lines, one an event; no article may back
//              two lines and no company gets the same line twice. If the call
//              fails, the line-a-story list below goes instead: every high and
//              medium story, its lead article's summary, high first, then by
//              how many outlets told it, then by market value.
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

// ---- which builds the public page shows ------------------------------------------
// THE EVENING EDITION ONLY (2026-11-12, the owner, of a page built that morning:
// "This is fine to show yesterday evening not today morning"): a day's brief
// is shown once a build made at 17:00 Eastern or later on that day exists (the
// 17:40 send, or an edition made as of 17:40, which carries that time). Earlier
// builds, a sample's or a test's, stay stored and are not shown, so in the
// morning the page shows last evening's edition.
const EVENING_MIN = 17 * 60;
const eveningBuild = (day, at) => Number.isFinite(at) && etDay(at) === day && etMinute(new Date(at).toISOString()) >= EVENING_MIN;
// UPDATES THROUGH THE DAY (same day, the owner: "May be refresh the news 3 or
// 4 times a day"): the page is also published at these Eastern times on
// weekdays, each covering the news since the last evening brief. A build at
// one of them (up to 20 minutes late, as a slow run may be) is shown as well;
// one at any other time (a sample, a test) is not.
const PAGE_SLOTS = ['08:40', '11:40', '14:40', '17:40'].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
function shownBuild(day, at) {
  if (eveningBuild(day, at)) return true;
  if (!Number.isFinite(at) || etDay(at) !== day) return false;
  const m = etMinute(new Date(at).toISOString());
  return PAGE_SLOTS.some((s) => m >= s - 2 && m <= s + 20);
}
// The session a build looks ahead to: on a trading day before the 9:30 open,
// that day's own; otherwise the next trading day.
function nextSession(today, now) {
  return isTradingDay(today) && etMinute(new Date(now).toISOString()) < 9 * 60 + 30 ? today : nextTradingDay(today);
}
// 17:40 Eastern on a day, for an edition made afterwards as of that evening.
function eveningOf(day) {
  for (const off of ['-05:00', '-04:00']) { const t = Date.parse(day + 'T17:40:00' + off); if (etDay(t) === day && etMinute(new Date(t).toISOString()) === 17 * 60 + 40) return t; }
  return null;
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
  'Describe; do not advise or forecast. Never say a share price will rise or fall, never use buy, sell, hold, bullish, bearish, outperform, underperform, overweight, underweight or price target; name days by their weekday (Thursday, the Friday open), never today, tonight or tomorrow, since the note is read the next morning too; never name a newspaper, website or other news outlet (say "a report"); write "acquire" for a purchase of a company, and leave out analysts\' price targets and lists of picks, and never rank stocks as picks.',
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
// Beyond the site's words: an analyst's list of picks and a moved price
// target, which the first preview let through ("named it a top pick",
// "Mizuho and Bernstein raised targets"). A company's own target (a debt
// target, a margin target) is a fact and passes.
const PICKS = /\btop picks?\b|\b(?:raise[sd]?|raising|cut|cuts|cutting|lower(?:s|ed|ing)?|trim(?:s|med|ming)?|boost(?:s|ed|ing)?|lift(?:s|ed|ing)?|hike[sd]?|slash(?:es|ed|ing)?|reiterat(?:es|ed|ing)?) (?:its |their |the )?(?:price )?targets?\b/i;
// NO OUTLET NAMED (2026-11-12, the briefs went public on /briefs): the site
// names no news service to anyone but the admin, so a line that names a
// publication is dropped. The well-known ones, and each day's own outlet names
// (`outlets`, the readings' sources that are names rather than web addresses).
// Matched as written, since a name like Proactive is also a word.
const OUTLETS = ['Yahoo', 'Motley Fool', '24/7 Wall St', 'TIKR', 'Trefis', 'Stocktwits', 'Proactive', 'Reuters', 'Bloomberg', 'CNBC', 'Wall Street Journal', 'WSJ',
  'Financial Times', 'Barron\'s', 'Barrons', 'MarketWatch', 'Seeking Alpha', 'Benzinga', 'Zacks', 'Investor\'s Business Daily', 'Kiplinger', 'Business Insider', 'Fox Business',
  'CBS News', 'USA Today', 'Forbes', 'Axios', 'Nikkei', 'TipRanks', 'Insider Monkey', 'GuruFocus', 'Simply Wall St', 'InvestorPlace', 'TheStreet',
  'Decrypt', 'CoinDesk', 'IBTimes', 'Associated Press', 'New York Times', 'Washington Post', 'The Information', 'Investing.com', 'Nasdaq.com', 'Finviz', 'Briefing.com', 'Stock Titan', 'GlobeNewswire', 'Business Wire', 'PR Newswire', 'Accesswire'];
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
function outletIn(text, outlets) {
  const names = OUTLETS.concat((outlets || []).filter((o) => o && !/\.[a-z]{2,}$/i.test(o) && o.length >= 4));
  for (const n of names) if (new RegExp('(^|[^A-Za-z0-9])' + escRe(n) + '(?![A-Za-z])').test(text)) return n;
  return null;
}
// One line against the inputs it cites: null when it passes, else why not.
function lineProblem(text, ids, cited, symbols, extra, outlets) {
  if (!text) return 'empty';
  if (!cited.length || cited.length !== ids.length) return 'cites an input that does not exist';
  if (text.length > MAX_LINE) return 'too long';
  if (NewsTone.BANNED.test(text)) return 'a word the site does not use (' + text.match(NewsTone.BANNED)[0] + ')';
  if (PICKS.test(text)) return 'a ranking or target (' + text.match(PICKS)[0] + ')';
  const outlet = outletIn(text, outlets);
  if (outlet) return 'names a news outlet (' + outlet + ')';
  const src = cited.map((c) => c.name + ' ' + c.text).join(' ') + ' ' + (extra || '');
  const bad = numbers(text).find((n) => !hasNumber(n, src));
  if (bad) return 'a figure not in its inputs (' + bad + ')';
  const own = new Set(cited.map((c) => c.symbol));
  const inBrackets = (text.match(/\(([A-Z][A-Z.]{0,5})\)/g) || []).map((w) => w.slice(1, -1));
  const bare = (text.match(/\b[A-Z]{2,5}\b/g) || []).filter((w) => !COMMON.has(w));
  const stray = inBrackets.concat(bare).find((w) => symbols.has(w) && !own.has(w));
  if (stray) return 'names a company its inputs do not (' + stray + ')';
  return null;
}
const lineOf = (it) => String(it && it.line || '').replace(/\s+/g, ' ').trim();
const idsOf = (it) => [...new Set((it && Array.isArray(it.ids) ? it.ids : []).map(String))];
function check(ans, cands, symbols, extra, outlets) {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const dropped = [];
  const items = [];
  if (!ans || typeof ans !== 'object' || !Array.isArray(ans.items)) return { ok: false, intro: '', items: [], dropped: ['no answer'] };
  for (const it of ans.items.slice(0, MAX_ITEMS + 5)) {
    const text = lineOf(it), ids = idsOf(it);
    const cited = ids.map((id) => byId.get(id)).filter(Boolean);
    const why = lineProblem(text, ids, cited, symbols, extra, outlets);
    if (why) { dropped.push(why); continue; }
    if (items.length < MAX_ITEMS) items.push({ line: text, symbols: [...new Set(cited.map((c) => c.symbol))], ids });
  }
  let intro = String(ans.intro || '').replace(/\s+/g, ' ').trim();
  if (intro && (intro.length > MAX_INTRO || NewsTone.BANNED.test(intro) || outletIn(intro, outlets) || numbers(intro).some((n) => !hasNumber(n, cands.map((c) => c.name + ' ' + c.text).join(' ') + ' ' + (extra || ''))))) { dropped.push('intro'); intro = ''; }
  return { ok: items.length > 0, intro, items, dropped };
}
// ---- today's summary, re-read by the model (2026-11-12, the owner: "I want AI
// to re-read all the news of the day and then summarize .. news should not be
// repeated") ------------------------------------------------------------------
// Every article in the window that is mainly about its company (about 950 a
// weekday, some 66,000 tokens of summaries; the thousand that only mention a
// company are left out), each with the site's importance and how many outlets
// told its story, most important first. The model merges what is one event
// into one line; the checks make sure no article backs two lines and no
// company gets the same line twice.
const MAX_TODAY = 60, MAX_TODAY_IN = 1400;
function dayInputs(rows, info, prevAt, now) {
  const use = (rows || []).filter((r) => r && r.symbol && r.about === 'primary' && r.summary && inWindow(r, prevAt, now));
  const nameOf = (s) => ((info(s) || {}).name || '');
  const groups = NewsTone.storyGroups(use, nameOf);
  const outlets = new Map();
  use.forEach((r, i) => { const g = groups[i]; if (!outlets.has(g)) outlets.set(g, new Set()); outlets.get(g).add(String(r.source || r.url)); });
  const list = use.map((r, i) => {
    const x = info(r.symbol) || {};
    const coverage = outlets.get(groups[i]).size;
    return { symbol: r.symbol, name: x.name || r.symbol, cap: Number.isFinite(x.cap) ? x.cap : null, kind: r.kind, importance: NewsTone.importance(r, coverage),
      coverage, publishedAt: r.published_at, source: r.source || '', text: String(r.summary).replace(/\s+/g, ' ').trim() };
  });
  list.sort((a, b) => RANK[b.importance] - RANK[a.importance] || b.coverage - a.coverage || (b.cap || 0) - (a.cap || 0) || (a.publishedAt < b.publishedAt ? -1 : 1));
  return list.slice(0, MAX_TODAY_IN).map((x, i) => Object.assign({ id: 'r' + (i + 1) }, x));
}
const SYSTEM_TODAY = [
  'You write the evening news summary for the owner of a stock screener: what happened today at the companies it covers.',
  'You are given every article read today that is mainly about one company, numbered, each with the company, its market value, the kind of news, an importance level set by the site\'s rule, how many outlets told the same story, and a summary of the article.',
  'Read them all, then write the day\'s news as separate lines. Many articles tell the same story: every article about one event goes into one line, never two. Never repeat a piece of news in a second line, even in other words; a company with two different events gets two lines.',
  'Put each line in "high" (results, guidance, deals, legal or regulatory decisions, leadership changes, and other events that change a company\'s position) or "medium" (analyst actions, products and customers, dividends and buybacks, insider trades, notable moves with a stated reason). Leave out opinion pieces, price recaps with no reason and passing mentions unless they carry news found nowhere else.',
  'At most 25 high lines and 35 medium lines, most important first within each: weigh the event, the size of the company, and how many outlets carried it. Each line is one or two plain sentences, under 240 characters, naming the company, and cites the ids of every article it uses.',
  'Use only facts in the summaries: no figure, company or date that is not in the articles a line cites, and no outside knowledge. Describe; do not advise or forecast. Never say a share price will rise or fall, never use buy, sell, hold, bullish, bearish, outperform, underperform, overweight, underweight or price target; name days by their weekday (Thursday, the Friday open), never today, tonight or tomorrow, since the note is read the next morning too; never name a newspaper, website or other news outlet (say "a report"); write "acquire" for a purchase of a company, and leave out analysts\' price targets and lists of picks.',
  'The intro is one sentence on the day as a whole, under 300 characters, from the articles only.',
].join(' ');
const SCHEMA_TODAY = {
  type: 'object', additionalProperties: false, required: ['intro', 'items'],
  properties: {
    intro: { type: 'string' },
    items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['importance', 'ids', 'line'],
      properties: { importance: { type: 'string', enum: ['high', 'medium'] }, ids: { type: 'array', items: { type: 'string' } }, line: { type: 'string' } } } },
  },
};
function todayPrompt(inputs, today) {
  const t = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  return `Today is ${dayName(today)}. ${inputs.length} articles:\n` + inputs.map((c) =>
    `${c.id} | ${c.symbol} ${c.name} | value ${capText(c.cap)} | ${c.kind}, ${c.importance}, ${c.coverage} outlet${c.coverage === 1 ? '' : 's'}, ${t(c.publishedAt)} | ${c.text}`).join('\n');
}
function todayRequest(inputs, today) {
  return { model: MODEL, max_tokens: 9000, system: SYSTEM_TODAY, output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA_TODAY } },
    messages: [{ role: 'user', content: todayPrompt(inputs, today) }] };
}
// The same story twice: a later line about the same companies sharing most of
// its words with an earlier one (Jaccard 0.5 on words of four letters or more).
const wordSet = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9%$ ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4));
function sameStory(a, b) {
  if (a.symbols.join() !== b.symbols.join()) return false;
  const p = wordSet(a.line), q = wordSet(b.line);
  let both = 0; for (const w of p) if (q.has(w)) both++;
  return p.size + q.size - both > 0 && both / (p.size + q.size - both) >= 0.5;
}
function checkToday(ans, inputs, symbols, extra, outlets) {
  const byId = new Map(inputs.map((c) => [c.id, c]));
  const dropped = [], items = [], used = new Set();
  if (!ans || typeof ans !== 'object' || !Array.isArray(ans.items)) return { ok: false, intro: '', items: [], dropped: ['no answer'] };
  for (const it of ans.items.slice(0, MAX_TODAY + 20)) {
    const text = lineOf(it), ids = idsOf(it);
    const cited = ids.map((id) => byId.get(id)).filter(Boolean);
    let why = lineProblem(text, ids, cited, symbols, extra, outlets);
    if (!why && !['high', 'medium'].includes(it.importance)) why = 'no importance';
    const x = { importance: it.importance, line: text, symbols: [...new Set(cited.map((c) => c.symbol))].sort(), ids, articles: ids.length };
    if (!why && ids.some((id) => used.has(id))) why = 'repeats an article an earlier line used';
    if (!why && items.some((y) => sameStory(x, y))) why = 'repeats an earlier line';
    if (why) { dropped.push(why); continue; }
    if (items.length >= MAX_TODAY) break;
    ids.forEach((id) => used.add(id));
    items.push(x);
  }
  // High before medium; the model's order within each.
  items.sort((a, b) => RANK[b.importance] - RANK[a.importance]);
  let intro = String(ans.intro || '').replace(/\s+/g, ' ').trim();
  if (intro && (intro.length > MAX_INTRO || NewsTone.BANNED.test(intro) || outletIn(intro, outlets) || numbers(intro).some((n) => !hasNumber(n, inputs.map((c) => c.name + ' ' + c.text).join(' ') + ' ' + (extra || ''))))) { dropped.push('intro'); intro = ''; }
  return { ok: items.length > 0, intro, items, dropped, read: inputs.length };
}

// The money one call cost, at the model's list price.
const PRICE = { in: 2 / 1e6, out: 10 / 1e6 };
const spend = (usage) => (usage ? (Number(usage.input_tokens) || 0) * PRICE.in + (Number(usage.output_tokens) || 0) * PRICE.out : 0);

module.exports = {
  isTradingDay, nextTradingDay, holidays, easter, addDays, dayName, etDay,
  inWindow, stories, line, calendar, outletIn, OUTLETS, eveningBuild, eveningOf, shownBuild, nextSession, PAGE_SLOTS, candidates, request, userPrompt, check, spend, capText,
  dayInputs, todayRequest, todayPrompt, checkToday, sameStory,
  SYSTEM, SCHEMA, SYSTEM_TODAY, SCHEMA_TODAY, MODEL, MAX_ITEMS, MAX_TODAY, RANK,
};
