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

function shiftDay(day, n) {
  const t = new Date(day + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

module.exports = { TECH, DROP, MIN_GROWTH, WINDOWS, DEFAULT_DAYS, WATCH, AI_THEMES, PLACE, GROUP_ORDER, releaseGrowth, guidanceOf, passesRelease, reaction, fields, candidates, screen, watch, shiftDay };
