// Health: one number from 0 to 100 for a stock, from everything the row
// already carries (the owner, 2026-11-07: "one field that gives one score
// based on everything that we know about the stock ... short term price move
// is acceptable, long term is good on annualized basis, the growth is good,
// the valuation reasonable compared to its history and peers, short interest
// is acceptable, its earning is above, guidance raised, recent news positive
// ... it should get a score of 100").
//
// THE OWNER'S SHAPE, AGREED THE SAME DAY. Five pillars with weights set by
// judgement, not fitted to past returns (ten of eleven backtests found
// nothing that predicts a month or two ahead, so a fit would learn noise);
// the checks inside a pillar share its weight, so adding a check does not make
// its topic heavier. A pass is 1, a middling reading a half, a miss 0. A
// check with no data is left out and the rest rescaled -- null is not zero --
// and under MIN_WEIGHT of the weight scored there is no number at all. Three
// deal-breakers cap the score however good the rest reads (the Signal's own
// shape: the warning rules sit above the strong ones).
//
// A DESCRIPTION, NOT A RATING OR A RECOMMENDATION. Everyone sees the number;
// only an admin sees the workings (the owner, "like Signal"). This file sits
// at the repository root, not in private/, so its thresholds are never sent
// to a browser: the admin panel asks /api/stock-health for one stock's
// breakdown. Health reads the Signal (one of the caps) and NOTHING in the
// Signal reads Health (health-test.js proves it with the verdicts).
'use strict';

const Filters = require('./private/filters.js');
const Action = require('./private/action.js');

const PILLARS = [
  { id: 'business', label: 'Business', weight: 30, checks: ['growth', 'profit', 'balance', 'dilution'] },
  { id: 'results', label: 'Results', weight: 25, checks: ['earnings', 'guidance'] },
  { id: 'value', label: 'Valuation', weight: 20, checks: ['history', 'peers'] },
  { id: 'price', label: 'Price', weight: 15, checks: ['short', 'long', 'trend'] },
  { id: 'sentiment', label: 'Sentiment', weight: 10, checks: ['shortint', 'tone'] },
];
const MIN_WEIGHT = 60;      // of 100: less scored than this and Health is a dash
const TONE_BAND = 0.25;     // Tone 7D's own band (newstone.js BAND)

const ok = (v) => v != null && v !== '' && isFinite(Number(v));
const num = (v) => (ok(v) ? Number(v) : null);
const sgn = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
// Three levels, highest first: `at` or better is 1, `mid` or better a half.
const ladder = (v, at, mid, up = true) => (up ? (v >= at ? 1 : v >= mid ? 0.5 : 0) : (v <= at ? 1 : v <= mid ? 0.5 : 0));

// Each check: what it reads, the rule in words (admin only), and a function
// from the row to { v: 1 | 0.5 | 0, value } or null when it has no reading.
const CHECKS = {
  // Growth and profit through Growth & profit's own reading (filters.js), so
  // the two can never disagree about what Growing or Profitable means.
  growth: {
    label: 'Revenue growth',
    rule: 'Growing (+10% or more against a year earlier) 1; Steady ½; Shrinking (−5% or worse) 0. Pre-revenue: no reading.',
    read(r) {
      const x = Filters.growthProfileRead(r);
      if (!x || x.label === 'Pre-revenue' || x.g == null) return null;
      return { v: x.g >= Filters.GP_GROW ? 1 : x.g <= -Filters.GP_SHRINK ? 0 : 0.5, value: sgn(x.g) + '% (' + (x.gBasis === 'filings' ? 'latest quarters, filings' : 'latest quarter') + ')' };
    },
  },
  profit: {
    label: 'Profitability',
    rule: 'Profitable (net margin 10% or more, free cash flow not negative) 1; thin margin ½; loss-making 0.',
    read(r) {
      const x = Filters.growthProfileRead(r);
      if (!x || x.label === 'Pre-revenue') return null;
      const w = x.label.split(', ')[1];
      const m = x.basis === 'fcf' ? x.fm : x.pm;
      return { v: w === 'profitable' ? 1 : w === 'thin margin' ? 0.5 : 0, value: w + (m != null ? ' (' + (x.basis === 'fcf' ? 'FCF' : 'net') + ' margin ' + m.toFixed(1) + '%)' : '') };
    },
  },
  // A bank's or an insurer's net cash says nothing about its strength.
  balance: {
    label: 'Balance sheet',
    rule: 'Net cash 1; else interest covered 5× or more 1, 2× to 5× ½, under 2× 0. Financial Services: no reading.',
    read(r) {
      if (r.sector === 'Financial Services') return null;
      const nc = num(r.netCash), ic = num(r.intCover);
      if (nc != null && nc > 0) return { v: 1, value: 'net cash' };
      if (ic == null) return null;
      return { v: ladder(ic, 5, 2), value: (nc != null ? 'net debt, ' : '') + 'interest covered ' + ic.toFixed(1) + '×' };
    },
  },
  dilution: {
    label: 'Share count',
    rule: 'Diluted shares against the year before: up 1% or less 1; up to 3% ½; more 0.',
    read(r) {
      const c = num(r.sharesChg);
      if (c == null) return null;
      return { v: ladder(c, 1, 3, false), value: sgn(c) + '% in a year' };
    },
  },
  earnings: {
    label: 'Last quarter vs estimate',
    rule: 'Earnings per share above the estimate 1; in line ½; below 0. From the newest results release (last 130 days).',
    read(r) {
      const w = r.erVsEstWord;
      if (!w) return null;
      return { v: w === 'Above' ? 1 : w === 'In line' ? 0.5 : 0, value: w + (ok(r.erVsEst) ? ' (' + sgn(Number(r.erVsEst), 2) + ' a share)' : '') };
    },
  },
  guidance: {
    label: 'Guidance',
    rule: 'Raised 1; Reaffirmed, Initiated or Mixed ½; Lowered or Withdrawn 0. Nothing said: no reading.',
    read(r) {
      const g = r.erGuideChange;
      if (!g) return null;
      return { v: g === 'Raised' ? 1 : /^(Lowered|Withdrawn)$/.test(g) ? 0 : 0.5, value: g };
    },
  },
  history: {
    label: 'P/E vs its 10-year median',
    rule: 'At or below its own ten-year median P/E 1; up to 25% above ½; more 0. A loss has no P/E: no reading.',
    read(r) {
      const x = num(r.peVsMed);
      if (x == null) return null;
      return { v: ladder(x, 0, 25, false), value: sgn(x, 0) + '% against the median' };
    },
  },
  peers: {
    label: 'Value vs industry',
    rule: 'Below industry or In line 1; Above industry 0 (forward P/E, else price to sales, against the industry median).',
    read(r) {
      const x = Filters.valueVsIndustryRead(r);
      if (!x) return null;
      return { v: x.label === 'Above industry' ? 0 : 1, value: x.label + ' (' + x.x.toFixed(2) + '× by ' + x.basis + ')' };
    },
  },
  short: {
    label: 'One month',
    rule: 'Price over a month: down 5% or less 1; down 5% to 10% ½; more 0.',
    read(r) {
      const m = num(r.oneMonthPct);
      if (m == null) return null;
      return { v: ladder(m, -5, -10), value: sgn(m) + '%' };
    },
  },
  long: {
    label: 'Three years, a year',
    rule: 'The three-year return as a yearly rate: 10% or more 1; 0 to 10% ½; negative 0.',
    read(r) {
      const t = num(r.threeYearPct);
      if (t == null || t <= -100) return null;
      const a = (Math.pow(1 + t / 100, 1 / 3) - 1) * 100;
      return { v: ladder(a, 10, 0), value: sgn(a) + '% a year (' + sgn(t, 0) + '% in all)' };
    },
  },
  trend: {
    label: 'Trend',
    rule: 'Above the 200-day average and the 50-day above the 200-day 1; one of the two ½; neither 0.',
    read(r) {
      const v = num(r.vs200ma);
      if (v == null) return null;
      const n = (v > 0 ? 1 : 0) + (r.maBullish === true ? 1 : 0);
      return { v: n / 2, value: (v > 0 ? 'above' : 'below') + ' the 200-day (' + sgn(v) + '%)' + (r.maBullish === true ? ', 50-day above it' : r.maBullish === false ? ', 50-day below it' : '') };
    },
  },
  shortint: {
    label: 'Short interest',
    rule: 'Short % of float under 5% 1; 5% to 10% ½; 10% or more 0.',
    read(r) {
      const s = num(r.shortPctFloat);
      if (s == null) return null;
      return { v: s < 5 ? 1 : s < 10 ? 0.5 : 0, value: s.toFixed(1) + '% of float' };
    },
  },
  tone: {
    label: 'Article tone, 7 days',
    rule: 'Average tone +0.25 or more 1; between ½; −0.25 or less 0. No article read in the week: no reading.',
    read(r) {
      const t = num(r.toneAvg);
      if (t == null || !(num(r.toneN) > 0)) return null;
      return { v: t >= TONE_BAND ? 1 : t <= -TONE_BAND ? 0 : 0.5, value: sgn(t, 2) + ' over ' + r.toneN + ' article' + (Number(r.toneN) === 1 ? '' : 's') };
    },
  },
};

// The deal-breakers: whatever the rest reads, the score goes no higher.
const CAPS = [
  { id: 'guide', max: 60, label: 'Guidance lowered or withdrawn', test: (r) => /^(Lowered|Withdrawn)$/.test(r.erGuideChange || '') },
  { id: 'signal', max: 50, label: 'The Signal reads Very Weak', test: (r) => Action.canon(r.action) === 'Very Weak' },
  { id: 'dilution', max: 70, label: 'Shares up more than 10% in a year', test: (r) => num(r.sharesChg) != null && num(r.sharesChg) > 10 },
];

const isFund = (r) => r.instrumentType === 'ETF' || r.companyType === 'ETF';

// The whole working for one row. `score` is null for a fund, an error row, or
// too little data; everything else is there so the admin panel can show why.
function explain(r) {
  if (!r || r.error || isFund(r)) return null;
  let have = 0, sum = 0;
  const pillars = PILLARS.map((p) => {
    const checks = p.checks.map((id) => {
      const c = CHECKS[id];
      let x = null;
      try { x = c.read(r); } catch (e) { x = null; }
      return { id, label: c.label, rule: c.rule, v: x ? x.v : null, value: x ? x.value : null };
    });
    const got = checks.filter((c) => c.v != null);
    const mean = got.length ? got.reduce((a, c) => a + c.v, 0) / got.length : null;
    if (mean != null) { have += p.weight; sum += p.weight * mean; }
    return { id: p.id, label: p.label, weight: p.weight, points: mean == null ? null : Math.round(mean * 100), checks };
  });
  const raw = have ? Math.round((sum / have) * 100) : null;
  const caps = CAPS.filter((c) => { try { return c.test(r); } catch (e) { return false; } })
    .map((c) => ({ id: c.id, label: c.label, max: c.max }));
  const enough = have >= MIN_WEIGHT;
  let score = enough ? raw : null;
  for (const c of caps) if (score != null && score > c.max) score = c.max;
  return { score, raw, weighed: have, minWeight: MIN_WEIGHT, pillars, caps, capped: score != null && raw != null && score < raw };
}

const score = (r) => { const e = explain(r); return e ? e.score : null; };

module.exports = { PILLARS, CHECKS, CAPS, MIN_WEIGHT, explain, score };
