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
// THE THEMES ARE THE GROUPS (owner, 2026-11-05: "cleanup themes based on the
// list ... rename all AI related themes to prefix with AI -"). One AI theme per
// group, each company in one of them, so a company's group is its AI theme:
// moving it between themes moves it here. Before, the groups were worked out
// from six overlapping themes, a hand list and the industry; that placement
// became the themes' membership on 2026-11-05.
//   1. Its first AI theme, in AI_THEMES order.
//   2. Else, on the 25: the group it was published in.
const AI_THEMES = [
  ['AI - Memory', 'Memory'],
  ['AI - Power Generation', 'Power'],
  ['AI - Optical Networking', 'Networking'],
  ['AI - Semicap', 'Semicap'],
  ['AI - Compute', 'Compute'],
  ['AI - Neoclouds', 'Neoclouds'],
  ['AI - Hyperscalers', 'Hyperscalers'],
  ['AI - Servers & Data Centres', 'Servers & data centres'],
];
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
    // The three long-run and insider tabs (2026-11-05): the screener's own
    // Long run and Insider net readings, as stampFlows lays them on.
    crChecks: num(row.crChecks), fScore: num(row.fScore), crNow: row.crNow || null,
    divStreak: num(row.divStreak), divSince: row.divSince || null, divGrowth5y: num(row.divGrowth5y),
    divYield: num(row.divYield), payoutRatio: num(row.payoutRatio),
    insBuyers: num(row.insiderBuyers), insSellers: num(row.insiderSellers), insNet: num(row.insiderNet),
    // The quiet tab (2026-11-05): the screener's 3Y, YTD and 1Y.
    y3: num(row.threeYearPct), ytd: num(row.ytdPct), y1: num(row.oneYearPct),
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
  const listed = new Set(WATCH.groups.flatMap(([, syms]) => syms));
  for (const [theme, group] of AI_THEMES) {
    for (const row of by.values()) {
      if (placed.has(row.symbol) || row.instrumentType === 'ETF' || row.error) continue;
      if (!(row.portfolios || []).includes(theme)) continue;
      placed.set(row.symbol, { group, from: listed.has(row.symbol) ? 'list' : theme });
    }
  }
  for (const [group, syms] of WATCH.groups) for (const s of syms) if (!placed.has(s)) placed.set(s, { group, from: 'list' });
  const out = [];
  for (const [s, p] of placed) {
    const row = by.get(s);
    const themes = row ? AI_THEMES.map((t) => t[0]).filter((t) => (row.portfolios || []).includes(t)) : [];
    out.push(row ? Object.assign(fields(row, rels && rels[s]), p, { themes }) : { symbol: s, group: p.group, from: p.from, themes, missing: true });
  }
  const gi = (g) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? GROUP_ORDER.length : i; };
  return out.sort((a, b) => (gi(a.group) - gi(b.group)) || ((b.cap == null ? -1 : b.cap) - (a.cap == null ? -1 : a.cap)) || (a.symbol < b.symbol ? -1 : 1));
}

// ARTICLE TONE (2026-11-04, the owner: "add article tone field at the end
// similar to what is shown on screener"): the screener's Tone 7D figure, laid
// onto the rows these views send (never onto a snapshot row) from the stored
// toneColumn rows, { SYM: [average, read, positive, negative] }. A company
// with nothing read in the seven days gets tone null, drawn as a dash.
function withTone(views, toneRows) {
  const t = toneRows || {};
  for (const list of Object.values(views || {})) {
    for (const r of list || []) {
      if (!r || r.missing) continue;
      const x = t[r.symbol];
      r.tone = Array.isArray(x) && num(x[0]) != null ? { avg: num(x[0]), n: num(x[1]), pos: num(x[2]), neg: num(x[3]) } : null;
    }
  }
  return views;
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
    ['Tone 7D (−1 to +1)', 11, true, (r) => (r.tone ? r2(r.tone.avg) : null)],
    ['Articles read (7D)', 10, true, (r) => (r.tone ? r.tone.n : null)],
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
    ['Tone 7D', 'Article tone over the last seven days, as on the screener: the average of an AI model’s reading of how each article mainly about the company leans, from −1 to +1, with the number read. A description of what was written, not a forecast, and never an input to the Signal.'],
    ['Empty cells', 'A figure that is not known. Never a zero.'],
    ['', 'Descriptions of what happened, not a reading of what comes next. Nothing here is a recommendation to trade. Tickr Lab, tickrlab.com.'],
  ];
  const bounceCols = [...company, ...where, ...release,
    ['52-week range (0 low, 100 high)', 12, true, (r) => r1(r.range52)],
    ['2 weeks (%)', 9, true, (r) => r1(r.w2)],
    ['1 month (%)', 9, true, (r) => r1(r.m1)],
    ...readings];
  const qualityCols = [...company, ...where, ...release,
    ['Compounding record (of 5)', 12, true, (r) => r.crChecks],
    ['F-score (of 9)', 9, true, (r) => r.fScore],
    ['Compounding now', 12, false, (r) => (r.crNow ? NOW_WORDS[r.crNow] || r.crNow : null)],
    ['1 month (%)', 9, true, (r) => r1(r.m1)],
    ...readings];
  const divCols = [...company, ...where, ...release,
    ['Dividend raised (years running)', 12, true, (r) => r.divStreak],
    ['Dividend growth /yr 5Y (%)', 11, true, (r) => r1(r.divGrowth5y)],
    ['Dividend yield (%)', 10, true, (r) => r2(r.divYield)],
    ['52-week range (0 low, 100 high)', 12, true, (r) => r1(r.range52)],
    ...readings];
  const insCols = [...company, ...where, ...release,
    ['Insiders buying', 9, true, (r) => r.insBuyers],
    ['Insiders selling', 9, true, (r) => r.insSellers],
    ['Insider net (% of market value)', 12, true, (r) => (num(r.insNet) == null ? null : Math.round(num(r.insNet) * 1000) / 1000)],
    ...readings];
  const quietCols = [...company, ...where, ...release,
    ['3 years (%)', 9, true, (r) => r1(r.y3)],
    ['This year (%)', 9, true, (r) => r1(r.ytd)],
    ['1 year (%)', 9, true, (r) => r1(r.y1)],
    ['Compounding now', 12, false, (r) => (r.crNow ? NOW_WORDS[r.crNow] || r.crNow : null)],
    ...readings];
  const ir = (body && body.ideaRules) || ideaRules();
  const bs = (body && body.bounceScreen) || null;
  if (bs) about.splice(5, 0, ['Bouncing off the lows', 'The screener’s screen of that name: ' + (bs.description || '') + ' (' + (bs.rule || '') + '). Lowest in the range first.']);
  about.splice(bs ? 6 : 5, 0,
    ['Quality compounders on a pullback', ir.quality],
    ['Dividend growers near their lows', ir.divlow],
    ['Insider buying clusters', ir.insider],
    ['Strong three years, quiet this year', ir.quiet],
    ['3 years', 'The last close at least three years ago to the latest price, from the stored price history. Price only, no dividends.'],
    ['Compounding record', 'The screener’s Long run reading over up to ten years of annual reports, how many of five checks hold: revenue rose in 80% of years, earnings per share grew 10% a year, the worst operating margin held 70% of the typical year’s, free cash flow was 80% of net income, and the share count grew no more than 0.5% a year. Blank when one cannot be scored (lenders).'],
    ['Compounding now', 'Whether the latest quarters are still growing, slowing or declining, as the screener reads them.'],
    ['F-score', 'Piotroski’s nine checks of profit, balance sheet and efficiency on the latest annual report; how many hold.'],
    ['Insider net', 'Open-market purchases less sales by the company’s insiders in the window (plan sales left out), as a percent of market value.']);
  return [
    sheet('Tech', screenCols, v.tech || []),
    sheet('Non-tech', screenCols, v.nontech || []),
    sheet('AI watchlist', watchCols, v.watch || []),
    sheet('Bouncing off the lows', bounceCols, v.bounce || []),
    sheet('Quality on a pullback', qualityCols, v.quality || []),
    sheet('Dividend growers, lows', divCols, v.divlow || []),
    sheet('Insider buying clusters', insCols, v.insider || []),
    sheet('Strong 3 years, quiet now', quietCols, v.quiet || []),
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

// THREE MORE TABS (owner, 2026-11-05: "add 3 more on the ideas page quality
// compounders on pullback and dividend growers near their lows and insider
// buying clusters"). Screens over the served rows with the screener's own
// readings; the thresholds live here, once, and the page and workbook say them.
//
//   quality   Compounding record 4 or 5 of its 5 checks over ten years of
//             annual reports, F-score 6 or more, and the price 10% to 30%
//             under its 52-week high, leaving out a company whose quarters
//             read Declining on Compounding now (the owner on Lululemon,
//             2026-10-26: a ten-year record cannot see a recent turn).
//             Furthest under the high first.
//   divlow    Dividend raised 5 or more years running, and the price in the
//             bottom quarter of its 52-week range. Lowest in the range first.
//   insider   3 or more insiders bought shares on the open market in the
//             screener's insider window (90 days), and the buying outweighed
//             the selling (Insider net above zero, which at the screener's
//             rounding leaves out token purchases at the very largest
//             companies). Most buyers first.
// A blank reading never passes: null is not zero.
const IDEAS = {
  quality: { minChecks: 4, minF: 6, fromHigh: [-30, -10] },
  divlow: { minStreak: 5, maxRange: 25 },
  insider: { minBuyers: 3 },
  quiet: { min3y: 50, ytd: [-5, 5] },
};
const NOW_WORDS = { grow: 'Still growing', slow: 'Slowing', decline: 'Declining' };
const usable = (r) => r && r.symbol && !r.error && r.instrumentType !== 'ETF';
function quality(rows, rels) {
  const q = IDEAS.quality;
  return (rows || []).filter((r) => {
    if (!usable(r)) return false;
    const c = num(r.crChecks), f = num(r.fScore), h = num(r.pctFromHigh);
    return c != null && c >= q.minChecks && f != null && f >= q.minF && h != null && h >= q.fromHigh[0] && h <= q.fromHigh[1] && r.crNow !== 'decline';
  }).map((r) => fields(r, rels && rels[r.symbol])).sort((a, b) => a.fromHigh - b.fromHigh || (a.symbol < b.symbol ? -1 : 1));
}
function divlow(rows, rels) {
  const q = IDEAS.divlow;
  return (rows || []).filter((r) => {
    if (!usable(r)) return false;
    const s = num(r.divStreak), p = num(r.range52Pos);
    return s != null && s >= q.minStreak && p != null && p <= q.maxRange;
  }).map((r) => fields(r, rels && rels[r.symbol])).sort((a, b) => a.range52 - b.range52 || (a.symbol < b.symbol ? -1 : 1));
}
function insider(rows, rels) {
  const q = IDEAS.insider;
  return (rows || []).filter((r) => {
    if (!usable(r)) return false;
    const b = num(r.insiderBuyers), n = num(r.insiderNet);
    return b != null && b >= q.minBuyers && n != null && n > 0;
  }).map((r) => fields(r, rels && rels[r.symbol])).sort((a, b) => b.insBuyers - a.insBuyers || b.insNet - a.insNet || (a.symbol < b.symbol ? -1 : 1));
}
// STRONG THREE YEARS, QUIET THIS YEAR (owner, 2026-11-05: "stocks that have
// generally had good returns over the previous 3 years but have not done much
// this year"; the 3Y column was added for it). Price up 50% or more over three
// years (about 15% a year), between -5% and +5% this calendar year, and the
// business still looking healthy: revenue up on the year in the latest quarter
// and not Declining on Compounding now, so a rolling-over name is not read as
// a resting one. Biggest three-year rise first.
function quiet(rows, rels) {
  const q = IDEAS.quiet;
  return (rows || []).filter((r) => {
    if (!usable(r)) return false;
    const y3 = num(r.threeYearPct), y = num(r.ytdPct), g = num(r.revenueGrowthYoY);
    return y3 != null && y3 >= q.min3y && y != null && y >= q.ytd[0] && y <= q.ytd[1] && g != null && g > 0 && r.crNow !== 'decline';
  }).map((r) => fields(r, rels && rels[r.symbol])).sort((a, b) => b.y3 - a.y3 || (a.symbol < b.symbol ? -1 : 1));
}
// Each rule in words, for the page's tooltips and the workbook's About sheet.
function ideaRules(insiderDays) {
  const q = IDEAS;
  return {
    quality: 'Compounding record ' + q.quality.minChecks + ' or more of its 5 checks over ten years of annual reports, F-score ' + q.quality.minF + ' or more of 9, and the price ' + Math.abs(q.quality.fromHigh[1]) + '% to ' + Math.abs(q.quality.fromHigh[0]) + '% under its 52-week high, leaving out companies whose recent quarters read Declining on Compounding now. Furthest under the high first.',
    divlow: 'Dividend raised ' + q.divlow.minStreak + ' or more years running, and the price in the bottom quarter of its 52-week range (' + q.divlow.maxRange + ' or lower, 0 being the low). Lowest in the range first.',
    quiet: 'Price up ' + q.quiet.min3y + '% or more over three years, between ' + q.quiet.ytd[0] + '% and +' + q.quiet.ytd[1] + '% this calendar year, revenue up on the year in the latest quarter, and not Declining on Compounding now. Biggest three-year rise first.',
    insider: q.insider.minBuyers + ' or more insiders bought shares on the open market in the past ' + (insiderDays || 90) + ' days (Form 4), and the buying outweighed the selling. Most buyers first.',
  };
}

function shiftDay(day, n) {
  const t = new Date(day + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

module.exports = { NOW_WORDS, IDEAS, quiet, quality, divlow, insider, ideaRules, TECH, DROP, MIN_GROWTH, WINDOWS, DEFAULT_DAYS, WATCH, AI_THEMES, GROUP_ORDER, workbookSheets, withTone, BOUNCE_ID, bounce, releaseGrowth, guidanceOf, passesRelease, reaction, fields, candidates, screen, watch, shiftDay };
