// The history behind a number on the screener: what a click on a cell shows.
//
// (2026-10-13, the owner: "drill down on numbers on the screener wherever
// possible ... only where there is a history available ... not for any price
// data but surely for fundamental data such as revenue, P/E ratio". On click,
// a chart and a small table, members only. And: "do not provide for thin
// vendor only columns" -- forward P/E, PEG, ROE and the rest have six weeks of
// recorded history and are left out until that is worth drawing.)
//
// WHERE EACH HISTORY COMES FROM. The number in a cell is the price provider's;
// the history behind it is not, because the provider only ever gives today's
// figure. So:
//   money and margins   the company's own filings (sec_facts), the trailing
//                       year at each quarter end and the quarter itself
//   valuation           market value at each calendar quarter end over the
//                       filings' trailing year -- trendSeries, the function
//                       the peer chart and the Lines card already use
//   short interest      FINRA's twice-monthly counts
//   announcements       the provider's own record of each earnings release
// THE PANEL SAYS WHICH, every time, and where the filings' newest figure is
// not the cell's it says that too. Two sources agreeing 88% of the time is a
// reason to show both, not to pick one quietly.
//
// PURE. No fetch, no clock and no database: the route hands over rows it has
// read. Nothing here is stored, stamped on a snapshot row or read by the
// Signal.
const SecFacts = require('./secfacts');
const Adjusted = require('./adjusted.js');

const DAY = 86400000;
const TABLE_ROWS = 8;
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const span = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

// WHAT CAN BE DRILLED, keyed by the screener header's data-key. `src` picks
// the builder and the rows the route must read. A key not here has no drill.
const FIELDS = {
  revenueTtm:           { src: 'filings', key: 'revenue', kind: 'money', title: 'Revenue' },
  grossProfitTtm:       { src: 'filings', key: 'grossProfit', kind: 'money', title: 'Gross profit' },
  netIncomeTtm:         { src: 'filings', key: 'netIncome', kind: 'money', title: 'Net income' },
  operatingCashFlowTtm: { src: 'filings', key: 'operatingCashFlow', kind: 'money', title: 'Operating cash flow' },
  fcfTtm:               { src: 'filings', key: 'freeCashFlow', kind: 'money', title: 'Free cash flow',
    say: 'Operating cash flow less capital spending, as filed. The cell is the price provider’s levered figure, which is defined differently and is usually lower.' },
  buybackYield:         { src: 'filings', key: 'buybacks', kind: 'money', title: 'Spent on buybacks',
    say: 'Cash spent buying back shares, in dollars. The cell divides the latest trailing year by today’s market value.' },
  grossMargin:          { src: 'filings', over: 'grossProfit', kind: 'pct', title: 'Gross margin' },
  operatingMargin:      { src: 'filings', over: 'operatingIncome', kind: 'pct', title: 'Operating margin' },
  profitMargin:         { src: 'filings', over: 'netIncome', kind: 'pct', title: 'Profit margin' },
  netMarginChg:         { src: 'filings', over: 'netIncome', kind: 'pct', title: 'Profit margin',
    say: 'The cell is the latest point less the one four quarters before it.' },
  fcfMargin:            { src: 'filings', over: 'freeCashFlow', kind: 'pct', title: 'Free cash flow margin' },
  // The Long run group (longrun.js): a growth rate is the trailing year now
  // against the same year three or five back, so the history behind it is
  // that trailing year at every quarter end.
  revGrowth3y:          { src: 'filings', key: 'revenue', kind: 'money', title: 'Revenue',
    say: 'The cell is the yearly rate from the trailing year three years back to the latest one. A foreign filer is measured on its annual reports, in its own currency.' },
  revGrowth5y:          { src: 'filings', key: 'revenue', kind: 'money', title: 'Revenue',
    say: 'The cell is the yearly rate from the trailing year five years back to the latest one. A foreign filer is measured on its annual reports, in its own currency.' },
  niGrowth3y:           { src: 'filings', key: 'netIncome', kind: 'money', title: 'Net income',
    say: 'The cell is the yearly rate from the trailing year three years back to the latest one, and is blank where either end is a loss.' },
  niGrowth5y:           { src: 'filings', key: 'netIncome', kind: 'money', title: 'Net income',
    say: 'The cell is the yearly rate from the trailing year five years back to the latest one, and is blank where either end is a loss.' },
  dilutedEpsTtm:        { src: 'eps', kind: 'eps', title: 'Diluted earnings per share' },
  trailingPe:           { src: 'value', series: 'pe', kind: 'ratio', title: 'Price to earnings' },
  peLive:               { src: 'value', series: 'pe', kind: 'ratio', title: 'Price to earnings' },
  priceToSales:         { src: 'value', series: 'ps', kind: 'ratio', title: 'Price to sales' },
  priceToBook:          { src: 'value', series: 'pb', kind: 'ratio', title: 'Price to book' },
  shortPctFloat:        { src: 'short', key: 'shares', kind: 'shares', title: 'Shares sold short' },
  shortPctOutstanding:  { src: 'short', key: 'shares', kind: 'shares', title: 'Shares sold short' },
  shortRatio:           { src: 'short', key: 'dtc', kind: 'days', title: 'Days to cover' },
  lastEarningsDate:     { src: 'earnings', kind: 'pct', title: 'Earnings against the estimate' },
};

// A period end as a reader says it: "Jun 2026".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthOf = (d) => (/^\d{4}-\d{2}/.test(String(d)) ? MONTHS[Number(String(d).slice(5, 7)) - 1] + ' ' + String(d).slice(0, 4) : String(d || ''));
const dayOf = (d) => (/^\d{4}-\d{2}-\d{2}/.test(String(d)) ? Number(String(d).slice(8, 10)) + ' ' + monthOf(d) : String(d || ''));

// The company's quarters, newest first, one a period.
function quartersOf(rows) {
  return SecFacts.latestFilled(Array.isArray(rows) ? rows : []).filter((r) => r.periodType === 'Q')
    .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : a.periodEnd > b.periodEnd ? -1 : 0));
}

// The trailing year ending at quarter i: four CONSECUTIVE quarters with the
// figure in every one, or nothing. SecFacts.ttm's own refusal, for any key.
function rolled(q, i, key) {
  if (i + 4 > q.length) return null;
  const days = span(q[i + 3].periodStart || q[i + 3].periodEnd, q[i].periodEnd);
  if (!Number.isFinite(days) || days < 300 || days > 430) return null;
  let t = 0;
  for (let k = i; k < i + 4; k++) { const v = num(q[k][key]); if (v == null) return null; t += v; }
  return t;
}
// A margin off no revenue is a division, not a margin.
const ratio = (a, b) => (a == null || b == null || !(b > 0) ? null : Math.round((a / b) * 10000) / 100);

// Money and margins from the filings. The chart is the trailing year at each
// quarter end, to match the cell; the table gives the quarter beside it.
function filings(F, rows) {
  const q = quartersOf(rows);
  const points = [], table = [];
  for (let i = 0; i < q.length; i++) {
    const inQ = F.over ? ratio(num(q[i][F.over]), num(q[i].revenue)) : num(q[i][F.key]);
    const year = F.over ? ratio(rolled(q, i, F.over), rolled(q, i, 'revenue')) : rolled(q, i, F.key);
    if (year != null) points.push({ d: q[i].periodEnd, v: year });
    if (table.length < TABLE_ROWS && (inQ != null || year != null)) table.push([monthOf(q[i].periodEnd), inQ, year]);
  }
  points.reverse();
  // Ten years is the most a panel this size can show as a line.
  if (points.length > 40) points.splice(0, points.length - 40);
  const cur = (Array.isArray(rows) ? rows : []).find((r) => r && r.currency);
  return {
    source: 'SEC filings', basis: 'Trailing year at each quarter end',
    points, cols: ['Quarter to', 'In the quarter', 'Trailing year'], colKinds: ['text', F.kind, F.kind], rows: table,
    note: (F.say ? F.say + ' ' : '')
      + (cur ? 'Filed in ' + cur.currency + ' and converted to US dollars at each period’s rate. ' : '')
      + 'A trailing year needs four consecutive quarters on file.',
    filed: q.length ? q[0].filed || null : null,
  };
}

// Diluted EPS. A per-share figure does not add across quarters (the share
// count differs in each), so no trailing year is worked out: the chart is the
// fiscal years as filed and the table the quarters as filed.
// ON TODAY'S SHARE BASIS (2026-10-25, the owner: "make the adjustments so
// that it's accurate"): each filed figure times its split factor
// (Adjusted.epsFactors -- snapped to the splits since the period ended, so a
// figure a later filing already restated is not divided twice). A figure whose
// count cannot be reconciled is left blank. Where no split history is held the
// panel stays as filed and says so.
function eps(rows, splits) {
  const filled = SecFacts.latestFilled(Array.isArray(rows) ? rows : []);
  const F = Adjusted.epsFactors(SecFacts, rows, splits);
  const adj = (r) => { const v = num(r.epsDiluted); if (v == null) return null; if (!F) return v; const f = F[r.periodType + '|' + r.periodEnd]; return f == null ? null : Math.round(v * f * 10000) / 10000; };
  const years = filled.filter((r) => r.periodType === 'FY' && adj(r) != null)
    .sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1));
  const q = quartersOf(rows);
  const yearAt = new Map(years.map((r) => [r.periodEnd, adj(r)]));
  const table = [];
  for (const r of q) {
    const v = adj(r), y = yearAt.has(r.periodEnd) ? yearAt.get(r.periodEnd) : null;
    if (table.length < TABLE_ROWS && (v != null || y != null)) table.push([monthOf(r.periodEnd), v, y]);
  }
  return {
    source: 'SEC filings', basis: F ? 'Each fiscal year, on today’s share basis' : 'Each fiscal year, as filed',
    points: years.slice(-12).map((r) => ({ d: r.periodEnd, v: adj(r) })),
    cols: ['Period to', 'In the quarter', 'Fiscal year'], colKinds: ['text', 'eps', 'eps'], rows: table,
    note: 'Diluted earnings per share under the accounting rules, not the adjusted figure in a press release. '
      + 'A company files three quarters and a year, and per-share figures do not add up across quarters, so the fourth quarter has no figure of its own. '
      + (F ? 'Restated to today\u2019s share basis: every figure from before a split (or reverse split) is put on the share count after it, from the split history, so the line has no false step. A figure whose share count cannot be reconciled is left blank.'
        : 'As filed, not restated for share splits: no split history is held for this company.'),
    filed: q.length ? q[0].filed || null : null,
  };
}

// Valuation at each calendar quarter end. `series` is trendSeries' answer for
// this one company; `quarters` its dates, oldest first. Price to book is
// worked out here: market value over the equity on the latest balance sheet
// that had been drawn up by then.
function value(F, quarters, series, rows, carryDays) {
  const qs = Array.isArray(quarters) ? quarters : [];
  const S = series || {};
  const cap = S.cap || [];
  let vals, under, underName;
  if (F.series === 'pb') {
    const q = quartersOf(rows).filter((r) => num(r.equity) != null);
    under = qs.map((d) => {
      const hit = q.find((r) => r.periodEnd <= d);
      return hit && span(hit.periodEnd, d) <= (carryDays || 200) ? num(hit.equity) : null;
    });
    // A multiple off negative equity is arithmetic, not a multiple.
    vals = qs.map((d, i) => (cap[i] != null && under[i] != null && under[i] > 0 ? Math.round((cap[i] / under[i]) * 100) / 100 : null));
    underName = 'Shareholders’ equity';
  } else {
    vals = (S[F.series] || []).slice();
    under = (F.series === 'pe' ? S.ni : S.rev) || [];
    underName = F.series === 'pe' ? 'Earnings, trailing year' : 'Revenue, trailing year';
  }
  const points = [], table = [];
  qs.forEach((d, i) => { if (num(vals[i]) != null) points.push({ d, v: num(vals[i]) }); });
  for (let i = qs.length - 1; i >= 0 && table.length < TABLE_ROWS; i--) {
    if (num(vals[i]) == null && num(cap[i]) == null) continue;
    table.push([monthOf(qs[i]), num(vals[i]), num(cap[i]), num(under[i])]);
  }
  return {
    source: 'SEC filings and the price archive', basis: 'At each calendar quarter end',
    points, cols: ['Quarter end', F.title, 'Market value', underName], colKinds: ['text', 'ratio', 'money', 'money'], rows: table,
    note: 'Market value at the quarter’s last close, over the company’s own filed figures. '
      + (F.series === 'pe' ? 'Blank where the trailing year was a loss: a multiple of a loss is not shown. ' : '')
      + (F.series === 'pb' ? 'Blank where equity was not positive. ' : '')
      + 'The cell is today’s price over the price provider’s figure, so its last step differs from the last point here.',
    filed: null,
  };
}

// FINRA's counts, oldest first as stored. About two years on the chart.
function short(F, rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.d).sort((a, b) => (a.d < b.d ? -1 : 1));
  const points = list.slice(-52).map((r) => ({ d: r.d, v: num(r[F.key]) })).filter((p) => p.v != null);
  const table = list.slice(-TABLE_ROWS).reverse().map((r) => [dayOf(r.d), num(r.shares), num(r.changePct), num(r.dtc)]);
  return {
    source: 'FINRA', basis: 'Each settlement date, twice a month',
    points, cols: ['Settlement', 'Shares short', 'Change', 'Days to cover'], colKinds: ['text', 'shares', 'signed', 'days'], rows: table,
    note: F.key === 'shares'
      ? 'FINRA publishes a count of shares, not a percentage. The cell divides the latest count by today’s share count, which is why this is in shares.'
      : 'Shares sold short over the average daily volume at that settlement, as FINRA reports it.',
    filed: null,
  };
}

// Each announced quarter against the estimate, newest first as stored.
function earnings(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.date && num(r.epsActual) != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const pct = (r) => {
    const given = num(r.surprisePrc);
    if (given != null) return given;
    const e = num(r.epsEstimate), a = num(r.epsActual);
    // Off a zero or negative estimate the percentage is arithmetic and its sign can invert.
    return e != null && e > 0 && a != null ? Math.round(((a - e) / e) * 10000) / 100 : null;
  };
  const points = list.slice(-12).map((r) => ({ d: r.date, v: pct(r) })).filter((p) => p.v != null);
  const table = list.slice(-TABLE_ROWS).reverse().map((r) => [dayOf(r.date), num(r.epsEstimate), num(r.epsActual), pct(r)]);
  return {
    source: 'Price provider', basis: 'Each announcement, against the estimate',
    points, bars: true, cols: ['Announced', 'Estimate', 'Reported', 'Against it'], colKinds: ['text', 'eps', 'eps', 'signed'], rows: table,
    note: 'Earnings per share as announced, against the average estimate beforehand. These are usually the company’s adjusted figures, not the ones in its filings.',
    filed: null,
  };
}

// The one entry point. `data` carries whichever rows the field's source needs.
function build(field, data) {
  const F = FIELDS[field];
  if (!F) return null;
  const d = data || {};
  let out;
  if (F.src === 'filings') out = filings(F, d.facts);
  else if (F.src === 'eps') out = eps(d.facts, d.splits);
  else if (F.src === 'value') out = value(F, d.quarters, d.series, d.facts, d.carryDays);
  else if (F.src === 'short') out = short(F, d.short);
  else out = earnings(d.earnings);
  return Object.assign({ field, title: F.title, kind: F.kind, src: F.src }, out);
}

module.exports = { FIELDS, build, quartersOf, rolled, TABLE_ROWS };
