// What a company did with its cash: shares bought back, dividends paid, pay
// given in stock, and what happened to the share count. The arithmetic only.
// Pure: no network, no database. Hand it one company's statement rows as
// secfacts.js `latestFilled` returns them.
//
// (2026-10-11, the owner, choosing from a list of public data not yet read:
// "lets work on capital returns".) Every figure is from the cash-flow
// statement the company filed, read out of the SEC company facts the filings
// refresh already downloads; nothing here is a vendor's number.
//
// FOUR THINGS THIS IS CAREFUL ABOUT:
//
//   A LINE THAT IS NOT FILED IS NOT A ZERO. Tesla files no buyback line and
//   no dividend line. That very probably means it paid neither, and it is
//   still shown as not reported: a dash, not $0.
//
//   THE MOST RECENT TWELVE MONTHS ARE FOUR QUARTERS, and only where all four
//   are there and consecutive. A cash-flow quarter is itself derived (the
//   statement is year-to-date), so one can be missing; then the latest
//   fiscal year stands in, and `basis` says which was used.
//
//   BOUGHT BACK IS NOT NET. A company that buys back ten billion and hands
//   out twelve in stock pay has more shares at the end, not fewer. So the
//   share count is shown beside the buybacks rather than left to be assumed.
//
//   A SPLIT IS NOT A CHANGE IN THE SHARE COUNT. Older filings are not
//   restated for a later split, so a year-on-year change outside a plausible
//   range is taken as a split and withheld.
//
// DISPLAY ONLY. Nothing here reaches the Signal, and nothing here says
// whether returning cash was the right thing to do with it.
(function (root) {
  'use strict';

  const DAY = 86400000;
  const days = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  // An amount PAID is filed as a positive number. A negative one is a sign
  // the filer got wrong or a different thing under the same tag; withheld.
  const paid = (v) => (num(v) != null && v >= 0 ? v : null);
  const FIELDS = ['buybacks', 'dividends', 'stockComp'];
  const MAX_AGE = 550;          // a newest period older than this is not "latest"
  const YEARS = 6;

  // One statement row -> the figures this module speaks of.
  function pick(r) {
    return { end: r.periodEnd, buybacks: paid(r.buybacks), dividends: paid(r.dividendsPaid), stockComp: paid(r.stockComp),
      fcf: num(r.freeCashFlow), revenue: num(r.revenue), netIncome: num(r.netIncome),
      shares: num(r.sharesDiluted) > 0 ? r.sharesDiluted : null };
  }
  // Cash handed to shareholders: whichever of the two lines was filed. Null
  // only where neither was.
  const returned = (p) => (p.buybacks == null && p.dividends == null ? null : (p.buybacks || 0) + (p.dividends || 0));

  // The change in the diluted share count between two periods a year apart,
  // in percent; null where either is missing or the move is a split's.
  function shareChange(now, prev) {
    if (!now || !prev || !(now.shares > 0) || !(prev.shares > 0)) return null;
    const ratio = now.shares / prev.shares;
    if (ratio > 1.4 || ratio < 0.7) return null;
    return (ratio - 1) * 100;
  }

  // rows: latestFilled rows of one company. today: 'YYYY-MM-DD'.
  // -> { basis: 'TTM'|'FY', last, years: [...newest first], sharesChange, currency } or null
  function build(rows, today) {
    const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.periodEnd);
    const byEnd = (a, b) => (a.periodEnd < b.periodEnd ? 1 : a.periodEnd > b.periodEnd ? -1 : 0);
    const fy = list.filter((r) => r.periodType === 'FY').sort(byEnd);
    const q = list.filter((r) => r.periodType === 'Q').sort(byEnd);
    const years = fy.slice(0, YEARS).map(pick);
    const any = (p) => FIELDS.some((f) => p[f] != null);

    // The four newest quarters, where they are four in a row and at least as
    // recent as the newest fiscal year.
    let ttm = null;
    const four = q.slice(0, 4);
    const inRow = four.length === 4 && four.every((r, i) => !i || (days(r.periodEnd, four[i - 1].periodEnd) >= 60 && days(r.periodEnd, four[i - 1].periodEnd) <= 110));
    if (inRow && (!fy[0] || four[0].periodEnd >= fy[0].periodEnd)) {
      const p = four.map(pick);
      const all = (f) => (p.every((x) => x[f] != null) ? p.reduce((s, x) => s + x[f], 0) : null);
      ttm = { end: four[0].periodEnd, buybacks: all('buybacks'), dividends: all('dividends'), stockComp: all('stockComp'),
        fcf: all('fcf'), revenue: all('revenue'), netIncome: all('netIncome'), shares: p[0].shares };
      // Four quarters that lose a line the fiscal year has are worse than
      // the fiscal year: a derived quarter was missing. Then the year stands.
      if (years[0] && FIELDS.some((f) => years[0][f] != null && ttm[f] == null)) ttm = null;
    }
    const last = ttm || years[0] || null;
    if (!last || !any(last) && !years.some(any)) return null;
    if (today && days(last.end, today) > MAX_AGE) return null;
    const out = Object.assign({}, last, { returned: returned(last) });
    return {
      basis: ttm ? 'TTM' : 'FY',
      last: out,
      years: years.map((y, i) => Object.assign({}, y, { returned: returned(y), sharesChange: shareChange(y, years[i + 1]) })),
      // Year on year, from the two newest fiscal years: a weighted average
      // count does not have a twelve-month figure of its own.
      sharesChange: shareChange(years[0], years[1]),
      currency: (fy[0] && fy[0].currency) || (q[0] && q[0].currency) || null,
    };
  }

  // The ratios, which need the company's market value. All in percent; each
  // null where either side is missing or not positive.
  function ratios(last, marketCap) {
    const cap = num(marketCap) > 0 ? marketCap : null;
    const over = (a, b) => (a != null && b > 0 ? a / b * 100 : null);
    return {
      buybackYield: over(last.buybacks, cap),
      dividendYield: over(last.dividends, cap),
      totalYield: over(last.returned, cap),
      // How much of the cash the business generated was handed back. Over a
      // hundred means it returned more than it made, from savings or debt.
      ofFcf: over(last.returned, last.fcf),
      stockCompOfRevenue: over(last.stockComp, last.revenue),
    };
  }

  const api = { build, ratios, shareChange, returned, pick, MAX_AGE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CapReturns = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
