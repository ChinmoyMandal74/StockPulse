// SEC EDGAR XBRL company facts -> normalised statement rows.
//
// PURE: no database, no network, no universe. Hand it the JSON that
// data.sec.gov/api/xbrl/companyfacts/CIK##########.json returns and it gives
// back one row per (filing, period), with the concepts as columns. The
// orchestration — who to fetch, what to store, when — lives in server.js, the
// shape news.js already follows.
//
// WHY THIS DATA AND NOT A VENDOR'S: every observation carries `filed`, the
// date the figure was actually published, and `accn`, the filing it came
// from. Nothing else we can buy has either. That is also why the restatement
// trail is kept rather than collapsed: the same period is reported again in
// later filings, and the EARLIEST `filed` for a period is as-first-reported,
// which cannot be recovered once it has been thrown away.
//
// IT IS FOR DISPLAY. Nothing here may reach the Advice engine — see the
// `/stock` SEC EDGAR section in CLAUDE.md for why that boundary exists and
// how it is enforced.
'use strict';

// ---- the concepts, and the tags that have carried them --------------------
//
// TAGS DRIFT, and a single name does not span a company's filed life.
// Measured on MSFT: revenue needs three of these to reach 2007 —
// `Revenues` (2007-2010), `SalesRevenueNet` (2009-2018) and
// `RevenueFromContractWithCustomerExcludingAssessedTax` (2016-2026, after the
// ASC 606 adoption). They OVERLAP, which is the good news: a stitch can be
// checked on the overlap rather than trusted.
//
// Order is preference: the first tag that has a value for a period wins, so
// the modern tag beats the legacy one where both exist.
const CONCEPTS = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues', 'SalesRevenueNet', 'SalesRevenueGoodsNet'],
  costOfRevenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfServices'],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncomeLoss'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  epsDiluted: ['EarningsPerShareDiluted', 'IncomeLossFromContinuingOperationsPerDilutedShare'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities',
    'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  assets: ['Assets'],
  liabilities: ['Liabilities'],
  equity: ['StockholdersEquity',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  cash: ['CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  debt: ['LongTermDebtNoncurrent', 'LongTermDebt'],
  sharesDiluted: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
};
const CONCEPT_KEYS = Object.keys(CONCEPTS);

// A balance-sheet fact is an INSTANT — a position as at one date, with no
// start — where an income or cash-flow fact covers a span. They live in the
// same filing and belong on the same row, so the instants are matched to the
// duration row whose period ends on the same day.
const INSTANT = new Set(['assets', 'liabilities', 'equity', 'cash', 'debt']);

// ---- how long is a period -------------------------------------------------
//
// CLASSIFY BY SPAN, NEVER BY `fp`. A 10-Q carries the quarter AND the
// year-to-date figure, and both are labelled with the same `fp` — measured on
// RBLX: 28 quarterly observations, 10 six-month and 8 nine-month, all under
// fp Q2/Q3. Reading `fp` would report a Q2 at roughly double its real size,
// which is the sort of wrong number that looks perfectly plausible.
function periodType(start, end) {
  if (!start) return 'I';                       // instant: a balance-sheet date
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
  if (!Number.isFinite(days) || days < 0) return null;
  if (days <= 110) return 'Q';
  if (days <= 200) return 'H';
  if (days <= 290) return '9M';
  if (days <= 400) return 'FY';
  return null;                                  // multi-year: not a statement period
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---- the normaliser -------------------------------------------------------
//
// One row per (accn, period), because within a single filing every concept is
// drawn from the same document — so a row can never mix a revenue from one
// filing with a net income from another.
function normalise(facts, symbol) {
  const sym = String(symbol || '').toUpperCase();
  const cik = facts && facts.cik != null ? Number(facts.cik) : null;
  const g = (facts && facts.facts && facts.facts['us-gaap']) || {};
  const rows = new Map();           // accn|start|end -> row
  const instants = new Map();       // accn|end -> {concept: value}

  const keyOf = (accn, start, end) => accn + '|' + (start || '') + '|' + end;

  for (const concept of CONCEPT_KEYS) {
    // First tag with anything to say wins, per observation — not per concept,
    // so a stitch can hand over mid-history without leaving a hole.
    for (const tag of CONCEPTS[concept]) {
      const f = g[tag];
      if (!f || !f.units) continue;
      for (const unit of Object.keys(f.units)) {
        for (const x of f.units[unit]) {
          if (!x || !x.end || !x.accn || !x.filed) continue;
          const v = num(x.val);
          if (v == null) continue;
          const pt = periodType(x.start, x.end);
          if (!pt) continue;
          if (pt === 'I') {
            if (!INSTANT.has(concept)) continue;
            const k = x.accn + '|' + x.end;
            const bag = instants.get(k) || instants.set(k, {}).get(k);
            if (bag[concept] == null) bag[concept] = v;
            continue;
          }
          if (INSTANT.has(concept)) continue;     // a duration reading of a position
          const k = keyOf(x.accn, x.start, x.end);
          let row = rows.get(k);
          if (!row) {
            row = {
              symbol: sym, cik, accn: x.accn, form: x.form || null, filed: x.filed,
              fy: x.fy == null ? null : Number(x.fy), fp: x.fp || null,
              periodStart: x.start, periodEnd: x.end, periodType: pt, derived: 0,
            };
            for (const c of CONCEPT_KEYS) row[c] = null;
            rows.set(k, row);
          }
          if (row[concept] == null) row[concept] = v;
        }
      }
    }
  }

  const out = [...rows.values()];
  // Attach each filing's balance sheet to the period it closes.
  for (const r of out) {
    const bag = instants.get(r.accn + '|' + r.periodEnd);
    if (bag) for (const c of Object.keys(bag)) if (r[c] == null) r[c] = bag[c];
  }
  relabel(out);
  for (const r of out) fill(r);
  const all = out.concat(deriveQuarters(out));
  relabel(all);          // again, so a derived quarter is labelled the same way
  for (const r of all) fill(r);
  all.sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : a.periodEnd > b.periodEnd ? -1
    : (a.filed < b.filed ? 1 : -1)));
  return all;
}

// Two figures every reader expects that are not always filed as their own tag.
// Derived only where BOTH inputs are present on the same row — never across
// filings, and never from a partial pair.
function fill(r) {
  if (r.grossProfit == null && r.revenue != null && r.costOfRevenue != null) {
    r.grossProfit = r.revenue - r.costOfRevenue;
  }
  r.freeCashFlow = (r.operatingCashFlow != null && r.capex != null)
    ? r.operatingCashFlow - r.capex : null;
  return r;
}

// ---- the quarters nobody files --------------------------------------------
//
// TWO SEPARATE HOLES, both filled by the same subtraction.
//
// 1. THERE IS NO Q4. Measured on RBLX, the only quarter-ends that exist are
//    March, June and September: a company files Q1, Q2, Q3 and then a FULL
//    YEAR. A "quarterly" table without this loses one quarter in four.
//
// 2. A CASH-FLOW STATEMENT IS YEAR-TO-DATE, NOT QUARTERLY. Measured: revenue
//    reaches 86-99% of rows while operating cash flow reaches 56-67%, and the
//    tags are not the problem — `PaymentsToAcquirePropertyPlantAndEquipment`
//    is right there in both filers. A 10-Q simply reports the cash flow for
//    the nine months to date, so Q2 and Q3 have no quarterly figure at all.
//    Showing the YTD number in a column headed Q3 is the cumulative trap this
//    module's `periodType` exists to avoid, met again one statement over.
//
// Both are consecutive differences down one fiscal year's cumulative ladder —
// Q1(3M), H(6M), 9M, FY, which all share a periodStart — so it is one pass:
// Q2 = H − Q1, Q3 = 9M − H, Q4 = FY − 9M.
//
// Where the quarter WAS filed (income-statement lines usually are) the filed
// row stands and only its missing flows are filled in; `derivedFields` names
// exactly which, so the page can mark them rather than passing arithmetic off
// as a filing.

// A POSITION is not a flow: assets at year end are assets at year end, and
// subtracting the nine-month balance sheet would be arithmetic on two
// snapshots. A weighted-average share count does not subtract either, and
// neither does a per-share figure computed on a different denominator each
// quarter — those stay blank rather than being invented.
const NO_DIFF = new Set([...INSTANT, 'sharesDiluted', 'epsDiluted']);

function deriveQuarters(rows) {
  // The filing that speaks for each distinct (start, end) — a restatement
  // should feed the subtraction, but a proxy that mentions one number must
  // not displace the 10-K that carries the statement. See `outranks`.
  const best = new Map();
  for (const r of rows) {
    if (!r.periodStart || r.derived) continue;
    const k = r.periodStart + '|' + r.periodEnd;
    if (outranks(r, best.get(k))) best.set(k, r);
  }
  // One cumulative ladder per fiscal-year start.
  const chains = new Map();
  for (const r of best.values()) {
    const c = chains.get(r.periodStart) || chains.set(r.periodStart, []).get(r.periodStart);
    c.push(r);
  }
  const filedQ = new Map();
  for (const r of rows) {
    if (r.periodType !== 'Q' || r.derived) continue;
    const prev = filedQ.get(r.periodEnd);
    if (!prev || r.filed > prev.filed) filedQ.set(r.periodEnd, r);
  }

  const made = [];
  for (const chain of chains.values()) {
    chain.sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1));
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1], cur = chain[i];
      const gap = Math.round((Date.parse(cur.periodEnd) - Date.parse(prev.periodEnd)) / 86400000);
      if (gap < 60 || gap > 110) continue;          // not one quarter apart
      const target = filedQ.get(cur.periodEnd);
      const diff = {};
      for (const c of CONCEPT_KEYS) {
        if (NO_DIFF.has(c)) continue;
        if (cur[c] != null && prev[c] != null) diff[c] = cur[c] - prev[c];
      }
      if (!Object.keys(diff).length) continue;

      if (target) {
        // The quarter was filed; only its holes are filled, and named.
        const added = [];
        for (const c of Object.keys(diff)) {
          if (target[c] == null) { target[c] = diff[c]; added.push(c); }
        }
        if (added.length) {
          target.derivedFields = [...new Set((target.derivedFields || '').split(',')
            .filter(Boolean).concat(added))].join(',');
        }
      } else {
        const q = {
          symbol: cur.symbol, cik: cur.cik, accn: cur.accn, form: cur.form,
          filed: cur.filed, fy: cur.fy, fp: quarterLabel(chain, i),
          periodStart: prev.periodEnd, periodEnd: cur.periodEnd,
          periodType: 'Q', derived: 1, derivedFields: Object.keys(diff).join(','),
        };
        for (const c of CONCEPT_KEYS) q[c] = NO_DIFF.has(c) ? (INSTANT.has(c) ? cur[c] : null) : (diff[c] ?? null);
        made.push(q);
      }
    }
  }
  return made;
}

// Which quarter a rung of the ladder is: the second rung is Q2, and so on.
function quarterLabel(chain, i) { return 'Q' + Math.min(4, i + 1); }

// ---- the label, which `fp` also gets wrong --------------------------------
//
// `fp` BELONGS TO THE FILING, NOT TO THE OBSERVATION — the same trap as
// `periodType`, one level up, and it was caught by a screenshot rather than
// by an assertion. A 10-K is fp=FY and carries THREE-MONTH comparatives, so
// those quarters arrive labelled FY: on MSFT the quarterly table printed a
// column of rows reading "2020-06-30 FY" that were quarters all along.
//
// So the label is derived from the period itself. The fiscal year end is
// whichever month the company's own FY periods end in — asked of the data
// rather than assumed to be December, since MSFT's ends in June.
function relabel(rows) {
  const months = {};
  for (const r of rows) {
    if (r.periodType !== 'FY' || !r.periodEnd) continue;
    const m = Number(r.periodEnd.slice(5, 7));
    months[m] = (months[m] || 0) + 1;
  }
  const fyEnd = Number(Object.keys(months).sort((a, b) => months[b] - months[a])[0]);
  for (const r of rows) {
    if (r.periodType === 'FY') { r.fp = 'FY'; continue; }
    if (r.periodType !== 'Q' || !r.periodEnd) continue;
    if (!Number.isFinite(fyEnd)) { r.fp = null; continue; }
    const m = Number(r.periodEnd.slice(5, 7));
    r.fp = 'Q' + (Math.floor(((m - fyEnd + 11) % 12) / 3) + 1);
  }
  return rows;
}

// ---- which filing speaks for a period ------------------------------------
//
// A PROXY IS NOT A FINANCIAL STATEMENT, and "the most recent filing wins" is
// not enough on its own. Measured on RBLX: FY2025 revenue and cash flow
// appear in the 10-K of 2026-02-11, while a **DEF 14A of 2026-04-16 carries
// NetIncomeLoss and nothing else** — so the newest filing for that period was
// a one-number row, and everything differenced from it lost its inputs. On
// the page that showed as a Q4 with a net income and eleven dashes.
//
// Found by a screenshot of the live card, not by an assertion.
//
// So a statement form outranks a mention, and only then does recency decide.
// The others are still STORED — an 8-K sometimes carries real preliminary
// results, and the trail is the point — they simply do not get to speak for
// a period while a real statement exists.
const STATEMENT_FORM = /^(10-K|10-Q|20-F|40-F)(\/A)?$/i;
const isStatement = (r) => STATEMENT_FORM.test(String((r && r.form) || ''));
function outranks(a, b) {
  if (!b) return true;
  const sa = isStatement(a); const sb = isStatement(b);
  if (sa !== sb) return sa;
  if (a.filed !== b.filed) return a.filed > b.filed;
  return !a.derived && !!b.derived;     // a filed period beats a computed one
}

// The current version of each period — what a reader expects to see, since
// it is the company's own latest statement of its own past.
function latestPerPeriod(rows) {
  const best = new Map();
  for (const r of rows) {
    const k = r.periodType + '|' + r.periodEnd;
    if (outranks(r, best.get(k))) best.set(k, r);
  }
  return [...best.values()].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1));
}

// ---- the ratios, rather than the dollars -----------------------------------
//
// The filings state dollars; the Advice rules read RATIOS — gross margin,
// profit margin, FCF margin, revenue growth, earnings growth. Every one is
// computable from concepts already stored, so this is a second reading of
// data in hand rather than anything new.
//
// IT IS STILL DISPLAY ONLY, and the boundary matters MORE here than it did
// for the dollars. A reader seeing "Gross margin 61.2%" beside a verdict will
// assume that is the number the verdict used, and it is not: the engine reads
// the vendor's figure, which is trailing-twelve-month, restated to today, and
// computed on a different basis. This file already records them differing by
// up to ~4 points on the same company. So the card shows BOTH and names the
// gap rather than quietly presenting one as the other.
//
// A MARGIN OFF A LOSS IS STILL A MARGIN — unlike a multiple off a loss, which
// is arithmetic rather than cheapness. A -30% profit margin is a true and
// useful statement, so negatives are kept. What is refused is a denominator
// that cannot carry one.
const MIN_REVENUE = 1; // dollars; a zero or absent revenue is not a divisor

function pct(part, whole) {
  if (part == null || whole == null) return null;
  const p = Number(part), w = Number(whole);
  if (!isFinite(p) || !isFinite(w) || w < MIN_REVENUE) return null;
  return (p / w) * 100;
}

// Year-on-year against the SAME period a year earlier, matched on the date
// rather than by counting rows back — a company with a gap in its filings,
// or a changed fiscal year end, would otherwise be compared against whatever
// happened to sit four rows away.
function yearAgo(rows, i) {
  const d = new Date(rows[i].periodEnd + 'T00:00:00Z');
  if (isNaN(d)) return null;
  const want = new Date(d);
  want.setUTCFullYear(want.getUTCFullYear() - 1);
  let best = null, bestGap = Infinity;
  for (let k = 0; k < rows.length; k++) {
    if (k === i) continue;
    const o = new Date(rows[k].periodEnd + 'T00:00:00Z');
    if (isNaN(o)) continue;
    const gap = Math.abs(o - want) / 86400000;
    if (gap < bestGap) { bestGap = gap; best = rows[k]; }
  }
  // Within six weeks of the anniversary. Wider than that and it is a
  // different period being passed off as a comparison.
  return bestGap <= 45 ? best : null;
}

// A growth rate needs a POSITIVE base. From a loss to a smaller loss is not
// "+40% earnings growth" in any sense a rule should read, and from a negative
// base the sign inverts — the same trap the refresh report words rather than
// percentages.
function growth(now, then) {
  if (now == null || then == null) return null;
  const a = Number(now), b = Number(then);
  if (!isFinite(a) || !isFinite(b) || b <= 0) return null;
  return ((a - b) / b) * 100;
}

// Annotates each row with the ratios. `rows` newest-first, as
// latestPerPeriod returns them.
function withRatios(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((r, i) => {
    const prior = yearAgo(list, i);
    const gp = r.grossProfit != null ? r.grossProfit
      : (r.revenue != null && r.costOfRevenue != null ? r.revenue - r.costOfRevenue : null);
    return Object.assign({}, r, {
      grossMargin: pct(gp, r.revenue),
      operatingMargin: pct(r.operatingIncome, r.revenue),
      profitMargin: pct(r.netIncome, r.revenue),
      fcfMargin: pct(r.freeCashFlow, r.revenue),
      revenueGrowthYoY: prior ? growth(r.revenue, prior.revenue) : null,
      earningsGrowthYoY: prior ? growth(r.netIncome, prior.netIncome) : null,
      yoyAgainst: prior ? prior.periodEnd : null,
    });
  });
}

// ---- trailing twelve months, for a LIKE-FOR-LIKE comparison ---------------
//
// A QUARTER'S MARGIN IS NOT THE VENDOR'S MARGIN, and comparing them makes the
// vendor look wrong. Measured on MU the day this shipped: the filings' latest
// quarter gave an FCF margin of 42.4% against the vendor's 8.5% — a 33.9-point
// "gap" that is almost entirely period length, because MU's revenue is up
// 345% year on year and one quarter looks nothing like its trailing year.
//
// The vendor's MARGINS are trailing-twelve-month, so the comparison sums four
// filed quarters. Its GROWTH is last-quarter-year-on-year (see the screens
// section in CLAUDE.md), which is why those two lines already agreed to
// +0.0pt and are left on the quarterly basis.
const TTM_MIN_DAYS = 300;   // four quarters, with room for a short fiscal one
const TTM_MAX_DAYS = 430;

function ttm(quarterly) {
  const q = (Array.isArray(quarterly) ? quarterly : []).slice(0, 4);
  if (q.length < 4) return null;
  // They must actually BE four consecutive quarters. A gap in the filings
  // would otherwise be summed as though it were a year.
  const end = q[0].periodEnd;
  const start = q[3].periodStart || q[3].periodEnd;
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
  if (!isFinite(days) || days < TTM_MIN_DAYS || days > TTM_MAX_DAYS) return null;

  // A SUM IS ONLY A SUM IF EVERY PART IS THERE. One missing quarter would
  // understate the total and every margin off it — silently, since the
  // result still looks like a number.
  const add = (k) => {
    let t = 0;
    for (const r of q) {
      if (r[k] == null || !isFinite(Number(r[k]))) return null;
      t += Number(r[k]);
    }
    return t;
  };
  const revenue = add('revenue');
  if (revenue == null || revenue < MIN_REVENUE) return null;
  const grossProfit = add('grossProfit');
  const operatingIncome = add('operatingIncome');
  const netIncome = add('netIncome');
  const freeCashFlow = add('freeCashFlow');
  return {
    from: start, to: end, quarters: q.length, days,
    revenue, grossProfit, operatingIncome, netIncome, freeCashFlow,
    grossMargin: pct(grossProfit, revenue),
    operatingMargin: pct(operatingIncome, revenue),
    profitMargin: pct(netIncome, revenue),
    fcfMargin: pct(freeCashFlow, revenue),
  };
}

// sec.gov/Archives/edgar/data/<cik>/<accn without dashes>/<accn>-index.htm —
// verified 200. Every number on the page can therefore be opened at the
// document it was taken from, which is the whole argument for this source.
function filingUrl(cik, accn) {
  if (!cik || !accn) return null;
  return 'https://www.sec.gov/Archives/edgar/data/' + Number(cik) + '/' +
    String(accn).replace(/-/g, '') + '/' + accn + '-index.htm';
}

module.exports = {
  CONCEPTS, CONCEPT_KEYS, INSTANT, NO_DIFF,
  periodType, normalise, deriveQuarters, latestPerPeriod, filingUrl, isStatement,
  withRatios, ttm, MIN_REVENUE,
};
