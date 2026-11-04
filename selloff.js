// SELLOFF WATCH (2026-11-03, the owner: three tables sent by email, made a
// page). Members, at /selloff. Three views of companies whose shares fell, each
// row the same ten readings off the screener's own served row:
//
//   tech     Technology and Communication Services companies whose newest
//            results release showed revenue up 10% or more on the year, a net
//            profit and guidance, and whose shares fell 7% or more on the
//            reaction day.
//   nontech  Everyone else meeting the same release test, reading Growing,
//            profitable and Below industry or In line on value, that fell 5%
//            or more.
//   watch    A fixed list of 25 AI-linked names from an Instagram carousel
//            (@stockswithpawan, seen 2026-11-02), in its five groups.
//
// THE REACTION DAY is the worse of two moves, since a release can land before
// the open or after the close: the filing day (the previous close to the
// filing day's close) and the day after (the filing day's close to the next).
// A release filed on a day with no trading has no filing-day move. "Since"
// runs from the reaction day's close to the latest price.
//
// DESCRIPTIVE ONLY: no rule reads any of this, nothing here ranks, and the
// page says what each list is. Untested as a pattern (backlog entry 56).
// Pure: no I/O. server.js feeds it rows, releases and bars; selloff-test.js.
'use strict';

const TECH = new Set(['Technology', 'Communication Services']);
const DROP = { tech: -7, nontech: -5 };
const MIN_GROWTH = 10;
// How far back a release counts, in days; the page offers these.
const WINDOWS = [30, 45, 60, 90];
const DEFAULT_DAYS = 45;

const WATCH = {
  source: '@stockswithpawan on Instagram, "25 quality stocks I’m watching now", seen 2026-11-02',
  groups: [
    ['Memory', ['MU', 'SNDK', 'WDC', 'STX', 'NTAP']],
    ['Power', ['GEV', 'VRT', 'VST', 'CEG', 'CCJ']],
    ['Networking', ['ANET', 'CRDO', 'LITE', 'CSCO', 'CIEN']],
    ['Semicap', ['ASML', 'KLAC', 'LRCX', 'AMAT', 'TER']],
    ['Compute', ['NVDA', 'AMD', 'AVGO', 'TSM', 'MRVL']],
  ],
};

// THE AI WATCHLIST (owner, 2026-11-03: "there are many more AI related stocks
// in my theme ... combine logically into one big list"). The 25 above, joined
// by every company in the owner's AI themes, each company once, in one of the
// groups below. Read live from the rows' themes: a name added to a theme
// appears here on the next load. ETFs are left out, as the screens leave them.
//
// Where a company goes, first rule that applies:
//   1. On the 25: the group it was published in.
//   2. PLACE, by hand: the foundries beside TSMC in Compute, and Intel.
//   3. Industry Semiconductor Equipment & Materials: Semicap.
//   4. Its first theme in AI_THEMES order, mapped to a group. Neoclouds comes
//      before Cloud Infra so CoreWeave reads as a neocloud.
const AI_THEMES = [
  ['Memory', 'Memory'],
  ['AI - Power Generation', 'Power'],
  ['AI - Optical Networking', 'Networking'],
  ['Neoclouds', 'Neoclouds'],
  ['Hyperscalers', 'Hyperscalers'],
  ['Cloud Infra, Hardware & Networking', 'Servers & data centres'],
];
const PLACE = { GFS: 'Compute', TSEM: 'Compute', UMC: 'Compute', INTC: 'Compute' };
const GROUP_ORDER = ['Memory', 'Power', 'Networking', 'Semicap', 'Compute', 'Neoclouds', 'Hyperscalers', 'Servers & data centres'];

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const pos = (v) => (num(v) > 0 ? num(v) : null);

// The release's own revenue growth on the year, in percent.
function releaseGrowth(rel) {
  const a = num(rel && rel.revenue), b = num(rel && rel.revenuePrior);
  return a != null && b > 0 ? (a / b - 1) * 100 : null;
}
// Guidance: the release's change key when it has one (raised, lowered, mixed,
// initiated, reaffirmed, withdrawn; the page draws ReleaseView.changeTag),
// 'given' when it guides without one, else null.
function guidanceOf(rel) {
  if (!rel) return null;
  const c = rel.guideChange || (rel.guideRead && rel.guideRead.change) || null;
  if (c) return String(c).toLowerCase();
  return rel.guideKind ? 'given' : null;
}
// The release test both screens share. Withdrawn guidance is no guidance.
function passesRelease(rel) {
  if (!rel || !rel.isResults || !rel.filed) return false;
  const g = releaseGrowth(rel), gd = guidanceOf(rel);
  return g != null && g >= MIN_GROWTH && num(rel.netIncome) > 0 && !!gd && gd !== 'withdrawn';
}

// The moves around a filing from a symbol's bars, oldest first or not:
// [{ datetime | d, close }].
function reaction(bars, filed) {
  const b = (bars || []).map((x) => ({ d: String(x.d || x.datetime).slice(0, 10), c: num(x.close) }))
    .filter((x) => x.d && x.c > 0).sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
  const i = b.findIndex((x) => x.d === filed);
  const before = b.filter((x) => x.d < filed).pop() || null;
  const after = b.find((x) => x.d > filed) || null;
  if (i >= 0) {
    const on = b[i], prev = i > 0 ? b[i - 1] : null;
    const fday = prev ? (on.c / prev.c - 1) * 100 : null;
    const day = after ? (after.c / on.c - 1) * 100 : null;
    if (fday == null && day == null) return null;
    const useFday = day == null || (fday != null && fday < day);
    return { fday, day, worst: useFday ? fday : day, base: useFday ? on.c : after.c, on: useFday ? on.d : after.d };
  }
  // Filed on a day with no trading: the move is the last close before to the
  // first close after.
  if (!before || !after) return null;
  const day = (after.c / before.c - 1) * 100;
  return { fday: null, day, worst: day, base: after.c, on: after.d };
}

// The ten readings, off a served screener row (every stamp applied).
function fields(row, rel) {
  return {
    symbol: row.symbol, name: row.shortName || row.name || row.symbol, sector: row.sector || null, industry: row.industry || null,
    // A company with no results 8-K on file (a foreign filer) shows the
    // provider's last report date.
    filed: (rel && rel.filed) || (row.lastEarningsDate ? String(row.lastEarningsDate).slice(0, 10) : null), guidance: guidanceOf(rel),
    fromHigh: num(row.pctFromHigh), rsi: num(row.rsi), pe: pos(row.trailingPe), fpe: pos(row.forwardPe),
    valueVsIndustry: row.valueVsIndustry || null, revGrowth: num(row.revenueGrowthYoY), profitMargin: num(row.profitMargin),
    growthProfile: row.growthProfile || null,
    // Market value, the one money figure reliably in dollars; shown as the screener shows it.
    cap: num(row.marketCap), currency: row.currency || null,
    // The latest session's move, as the screener's Today column has it.
    today: num(row.todayPct),
    // The Signal and the rule that fired, always together (never one alone).
    signal: row.action || null, signalWhy: row.action ? (row.actionFlag || null) : null,
    // What the Bouncing off the lows screen reads: where the price sits in its
    // 52-week range (0 the low, 100 the high) and the two short moves.
    range52: num(row.range52Pos), w2: num(row.twoWeekPct), m1: num(row.oneMonthPct),
  };
}

// Which symbols a screen needs bars for: release test, sector, the words, and
// a release inside the window. `today` is an Eastern YYYY-MM-DD.
function candidates(view, rows, rels, days, today) {
  const since = shiftDay(today, -days);
  const out = [];
  for (const row of rows || []) {
    if (!row || !row.symbol || row.error || row.instrumentType === 'ETF') continue;
    const rel = rels && rels[row.symbol];
    if (!passesRelease(rel) || rel.filed < since || rel.filed > today) continue;
    const tech = TECH.has(row.sector);
    if (view === 'tech' ? !tech : (tech || !row.sector || row.growthProfile !== 'Growing, profitable'
      || !['Below industry', 'In line'].includes(row.valueVsIndustry))) continue;
    out.push(row.symbol);
  }
  return out;
}

// One screen: the candidates whose reaction day fell at least the view's drop,
// worst first.
function screen(view, rows, rels, barsBy, days, today) {
  const want = new Set(candidates(view, rows, rels, days, today));
  const out = [];
  for (const row of rows || []) {
    if (!want.has(row.symbol)) continue;
    const rel = rels[row.symbol];
    const rx = reaction(barsBy && barsBy[row.symbol], rel.filed);
    if (!rx || rx.worst == null || rx.worst > DROP[view]) continue;
    const px = pos(row.price);
    out.push(Object.assign(fields(row, rel), {
      fday: rx.fday, day: rx.day, reaction: rx.worst, reactionOn: rx.on,
      since: px && rx.base ? (px / rx.base - 1) * 100 : null,
    }));
  }
  return out.sort((a, b) => a.reaction - b.reaction);
}

// The watchlist, in its groups and order; a symbol not on the screener is
// listed as such rather than dropped.
// Every company once, grouped as above; within a group, largest market value
// first (a blank last). `from` says why it is here: 'list' for the 25, else
// the theme. `themes` names every AI theme it is in.
function watch(rows, rels) {
  const by = new Map((rows || []).filter((r) => r && r.symbol).map((r) => [r.symbol, r]));
  const placed = new Map();
  for (const [group, syms] of WATCH.groups) for (const s of syms) placed.set(s, { group, from: 'list' });
  for (const [theme, group] of AI_THEMES) {
    for (const row of by.values()) {
      if (placed.has(row.symbol) || row.instrumentType === 'ETF' || row.error) continue;
      if (!(row.portfolios || []).includes(theme)) continue;
      const g = PLACE[row.symbol] || (row.industry === 'Semiconductor Equipment & Materials' ? 'Semicap' : group);
      placed.set(row.symbol, { group: g, from: theme });
    }
  }
  const out = [];
  for (const [s, p] of placed) {
    const row = by.get(s);
    const themes = row ? AI_THEMES.map((t) => t[0]).filter((t) => (row.portfolios || []).includes(t)) : [];
    out.push(row ? Object.assign(fields(row, rels && rels[s]), p, { themes }) : { symbol: s, group: p.group, from: p.from, themes, missing: true });
  }
  const gi = (g) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? GROUP_ORDER.length : i; };
  return out.sort((a, b) => (gi(a.group) - gi(b.group)) || ((b.cap == null ? -1 : b.cap) - (a.cap == null ? -1 : a.cap)) || (a.symbol < b.symbol ? -1 : 1));
}

// THE EXCEL DOWNLOAD (2026-11-03): the answer /api/selloff serves, as sheets.
// Each sheet is { name, cols: [[heading, width, numeric]], rows }; a figure is
// a number (percent as a number of percent, market value in $ billions) so it
// sorts and filters in Excel, and a blank stays empty, never 0. server.js
// turns these into the file with xlsx.js.
const GUIDE_WORD = { raised: 'Raised', lowered: 'Lowered', mixed: 'Mixed', initiated: 'Initiated', reaffirmed: 'Reaffirmed', withdrawn: 'Withdrawn', given: 'Given' };
function workbookSheets(body) {
  const r1 = (v) => (num(v) == null ? null : Math.round(num(v) * 10) / 10);
  const r2 = (v) => (num(v) == null ? null : Math.round(num(v) * 100) / 100);
  const bn = (v) => (num(v) == null ? null : Math.round(num(v) / 1e7) / 100);
  const txt = (v) => (v == null || v === '' ? null : String(v));
  const guide = (g) => (g ? GUIDE_WORD[g] || String(g) : null);
  const readings = [
    ['From 52-week high (%)', 12, true, (r) => r1(r.fromHigh)],
    ['RSI (14-day)', 9, true, (r) => r1(r.rsi)],
    ['P/E (trailing)', 9, true, (r) => r2(r.pe)],
    ['Fwd P/E', 9, true, (r) => r2(r.fpe)],
    ['Value vs industry', 16, false, (r) => txt(r.valueVsIndustry)],
    ['Revenue growth (%)', 11, true, (r) => r1(r.revGrowth)],
    ['Profit margin (%)', 11, true, (r) => r1(r.profitMargin)],
    ['Growth & profit', 22, false, (r) => txt(r.growthProfile)],
    ['Signal', 22, false, (r) => txt(r.signal)],
    ['Signal: the rule that fired', 30, false, (r) => txt(r.signalWhy)],
  ];
  const company = [
    ['Symbol', 9, false, (r) => r.symbol],
    ['Company', 30, false, (r) => txt(r.name)],
  ];
  const where = [
    ['Sector', 20, false, (r) => txt(r.sector)],
    ['Industry', 30, false, (r) => txt(r.industry)],
    ['Market cap ($B)', 12, true, (r) => bn(r.cap)],
    ['Today (%)', 9, true, (r) => r2(r.today)],
  ];
  const release = [
    ['Reported', 11, false, (r) => txt(r.filed)],
    ['Guidance', 11, false, (r) => guide(r.guidance)],
  ];
  const screenCols = [...company, ...where, ...release,
    ['Reaction (%)', 10, true, (r) => r1(r.reaction)],
    ['Reaction day', 11, false, (r) => txt(r.reactionOn)],
    ['Since reaction (%)', 11, true, (r) => r1(r.since)],
    ...readings];
  const watchCols = [...company,
    ['Group', 20, false, (r) => r.group],
    ['Source', 30, false, (r) => (r.from === 'list' ? 'Published list' : txt(r.from))],
    ['AI themes', 40, false, (r) => (r.themes && r.themes.length ? r.themes.join('; ') : null)],
    ...where, ...release, ...readings];
  const sheet = (name, cols, rows) => ({
    name, cols: cols.map(([h, w, n]) => [h, w, n]),
    rows: rows.map((r) => (r.missing ? cols.map(([h], j) => (j === 0 ? r.symbol : h === 'Group' ? r.group : h === 'Company' ? 'Not on the screener' : null)) : cols.map((c) => c[3](r)))),
  });
  const v = (body && body.views) || {};
  const at = body && body.at ? new Date(body.at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' Eastern' : 'not known';
  const d = (body && body.drop) || DROP;
  const about = [
    ['Prices as of', at],
    ['Results releases filed in the past', (body && body.days) + ' days (the window chosen on the page)'],
    ['Tech', 'Technology and Communication Services companies whose newest results release showed revenue up ' + ((body && body.minGrowth) || MIN_GROWTH) + '% or more on the year, a net profit and guidance, and whose shares fell ' + Math.abs(d.tech) + '% or more on the reaction day. Worst reaction first.'],
    ['Non-tech', 'Every other sector, the same release test, reading Growing, profitable and Below industry or In line on value, with a fall of ' + Math.abs(d.nontech) + '% or more on the reaction day.'],
    ['AI watchlist', 'The 25 names published by ' + ((body && body.watchSource) || WATCH.source) + ', joined by every company in the AI themes (' + AI_THEMES.map((t) => t[0]).join(', ') + '), each company once, grouped; largest market value first within a group.'],
    ['Reaction', 'The worse of the filing day (previous close to that day’s close) and the day after (that close to the next one). Reaction day is that day.'],
    ['Since reaction', 'The reaction day’s close to the latest price.'],
    ['From 52-week high', 'The latest price against the highest close of the past year.'],
    ['P/E', 'Trailing twelve months as the data provider reports it; empty when its own earnings per share are a loss.'],
    ['Revenue growth, profit margin, the two descriptions', 'As the screener shows them: the results release while it is the newest report, then the SEC filings, else the data provider. Revenue growth is the latest quarter on the same quarter a year earlier.'],
    ['Market cap', 'Market value at the latest price, in billions of US dollars.'],
    ['Today', 'The latest session’s price change: the previous close to the latest price (during trading) or to the close.'],
    ['Signal', 'The screener’s mechanical reading of strength under its Balanced rules (Very Weak, Weak, Neutral, Strong – Elevated Risk, Strong, Very Strong), with the rule that fired. A description of where the stock stands on those rules, not an instruction to trade.'],
    ['Empty cells', 'A figure that is not known. Never a zero.'],
    ['', 'Descriptions of what happened, not a reading of what comes next. Nothing here is a recommendation to trade. Tickr Lab, tickrlab.com.'],
  ];
  const bounceCols = [...company, ...where, ...release,
    ['52-week range (0 low, 100 high)', 12, true, (r) => r1(r.range52)],
    ['2 weeks (%)', 9, true, (r) => r1(r.w2)],
    ['1 month (%)', 9, true, (r) => r1(r.m1)],
    ...readings];
  const bs = (body && body.bounceScreen) || null;
  if (bs) about.splice(5, 0, ['Bouncing off the lows', 'The screener’s screen of that name: ' + (bs.description || '') + ' (' + (bs.rule || '') + '). Lowest in the range first.']);
  return [
    sheet('Tech', screenCols, v.tech || []),
    sheet('Non-tech', screenCols, v.nontech || []),
    sheet('AI watchlist', watchCols, v.watch || []),
    sheet('Bouncing off the lows', bounceCols, v.bounce || []),
    { name: 'About', cols: [['Item', 34, false], ['What it means', 120, false]], rows: about },
  ];
}

// BOUNCING OFF THE LOWS (owner, 2026-11-03: "add this as a 4th option"). The
// screener's own stored screen `bouncelw`, run by server.js through
// Filters.screenRows exactly as the screener and the phone run it, so an edit
// to the screen shows here too. This only shapes the rows it picked, in the
// screen's own order.
const BOUNCE_ID = 'bouncelw';
function bounce(picked, rels) {
  return (picked || []).filter((r) => r && r.symbol && !r.error).map((r) => fields(r, rels && rels[r.symbol]));
}

function shiftDay(day, n) {
  const t = new Date(day + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

module.exports = { TECH, DROP, MIN_GROWTH, WINDOWS, DEFAULT_DAYS, WATCH, AI_THEMES, PLACE, GROUP_ORDER, workbookSheets, BOUNCE_ID, bounce, releaseGrowth, guidanceOf, passesRelease, reaction, fields, candidates, screen, watch, shiftDay };
