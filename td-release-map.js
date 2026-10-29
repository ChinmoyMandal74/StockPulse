// Every screener column fed by Twelve Data, set beside the same figure from
// the companies' results releases: is there an equivalent, where is it shown,
// how well do they agree, and what to know. Builds td-release-map.json, which
// the admin page /sources draws (2026-10-29, the owner: "Create a new page
// showing 1) Twelve Data Column in screener 2) Is there a equivalent Field in
// Earning Release 3) Equivalent Column from Earning Release 4) Data quality
// 5) Any other comments").
//
//   node --use-system-ca --no-warnings td-release-map.js
//
// OFFLINE, like the other builders: one Turso read (the snapshot) and the
// local research copy (analysis-db.js --sec) for the releases; it runs
// release-compare.js for the agreement with the 10-Q. No API calls. Re-run
// after a season to refresh the figures; the page shows when it was built.
//
// DATA QUALITY, three measures a row:
//   vs 10-Q   the release figure underneath against the quarter's first filing
//             (release-compare.js): share of pairs within 0.5%
//   vs TD     the release-based column against Twelve Data's, for companies
//             whose Twelve Data figures are on the same report (its last report
//             date within five days of the release): share within 2% (money and
//             multiples) or 1 point (percentages), and the median gap
//   coverage  companies with a Twelve Data value, and with a release-based one
// Twelve months (TTM) are four releases in a row summed (each period 75 to 105
// days after the one before), the newest within 130 days.

require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./db.js');

const OUT = path.join(__dirname, 'td-release-map.json');
const DAY = 86400000;
const t = (d) => Date.parse(String(d).slice(0, 10) + 'T12:00:00Z');
const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const pos = (v) => (v != null && v > 0 ? v : null);
const div = (a, b) => (a == null || b == null || !(b !== 0) ? null : a / b);

// What each company's releases give, worked out once.
function context(list) {
  if (!list.length) return null;
  const last = list[list.length - 1];
  if ((Date.now() - t(last.filed)) / DAY > 130) return null;
  const c = { r: last, ttm: {} };
  const five = list.slice(-5);
  const gapOk = (a, b) => { const g = (t(b.period_end) - t(a.period_end)) / DAY; return g >= 75 && g <= 105; };
  // The quarter's operating cash flow: a three-month statement directly, a
  // year to date less the release before (three months shorter, a quarter back).
  const qOcf = (i) => { const x = five[i]; if (!x || x.ocf == null || !x.cf_months) return null; if (x.cf_months === 3) return x.ocf;
    const p = five[i - 1]; return p && p.ocf != null && p.cf_months === x.cf_months - 3 && gapOk(p, x) ? x.ocf - p.ocf : null; };
  const four = five.slice(-4);
  let chain = four.length === 4;
  for (let k = 1; chain && k < 4; k++) if (!gapOk(four[k - 1], four[k])) chain = false;
  if (chain) {
    const off = five.length - 4;
    const sum = (f) => { let s = 0; for (let k = 0; k < 4; k++) { const v = f(four[k], k + off); if (v == null) return null; s += v; } return s; };
    c.ttm = {
      revenue: sum((x) => x.revenue), netIncome: sum((x) => x.net_income), opIncome: sum((x) => x.op_income),
      grossProfit: sum((x) => (x.gross_profit != null ? x.gross_profit : x.cost_rev != null && x.revenue != null ? x.revenue - Math.abs(x.cost_rev) : null)),
      ocf: sum((x, i) => qOcf(i)), fcf: sum((x) => (x.fcf != null ? x.fcf : x.fcf_calc)), eps: sum((x) => x.eps_gaap), ebitda: sum((x) => x.ebitda),
    };
  }
  const cash = last.bs_cash == null && last.bs_sti == null ? null : (last.bs_cash || 0) + (last.bs_sti || 0);
  const debt = last.bs_debt_cur == null && last.bs_debt_lt == null ? null : (last.bs_debt_cur || 0) + (last.bs_debt_lt || 0);
  Object.assign(c, { cash, debt, equity: last.bs_equity, assets: last.bs_assets, curA: last.bs_cur_assets, curL: last.bs_cur_liab, shares: last.dil_shares });
  return c;
}

// THE COLUMNS. group and label as the screener's FIELD_SPEC names them; td: the
// row's field and where Twelve Data's figure comes from; status Yes / Partly /
// No; rel: the release equivalent; shown: where it is drawn today; kind for
// the tolerance (money, mult, pct); td(s) and rel(s, c) the two values when
// measured; q10: the release-compare.js figure underneath; note: comments.
const usd = (s) => !s.currency || s.currency === 'USD';
const COLS = [
  { group: 'Info', label: 'Market Cap', field: 'marketCap', src: '/statistics valuations_metrics.market_capitalization', status: 'Partly', kind: 'money',
    rel: 'Diluted shares (weighted average) × price', shown: 'Not shown',
    td: (s) => n(s.marketCap), relv: (s, c) => (usd(s) && pos(n(s.price)) && c.shares ? n(s.price) * c.shares : null), q10: 'Diluted shares',
    note: 'The release gives the quarter’s weighted-average diluted shares, not shares outstanding today, so this is near, not equal. Market value is the one money figure reliably in dollars; the Signal reads it.' },
  { group: 'Scale', label: 'Revenue TTM', field: 'revenueTtm', src: '/statistics income_statement.revenue_ttm', status: 'Yes', kind: 'money',
    rel: 'Revenue, four releases summed', shown: 'Quarter only: Last Earning AI Extracted › Revenue',
    td: (s) => n(s.revenueTtm), relv: (s, c) => c.ttm.revenue, q10: 'Revenue',
    note: 'Banks and insurers headline net revenue where the filings and Twelve Data total it: most of the disagreement.' },
  { group: 'Scale', label: 'Gross profit', field: 'grossProfitTtm', src: '/statistics income_statement.gross_profit_ttm', status: 'Yes', kind: 'money',
    rel: 'Gross profit as printed, else revenue less cost of revenue, four releases summed', shown: 'Quarter margin: Last Earning AI Extracted › Gross margin; stock page strip',
    td: (s) => n(s.grossProfitTtm), relv: (s, c) => c.ttm.grossProfit, q10: 'Gross profit',
    note: 'Only about 44% of releases print gross profit as a line; with cost of revenue it reaches more. Banks have none.' },
  { group: 'Scale', label: 'Net income', field: 'netIncomeTtm', src: '/statistics income_statement.net_income_to_common_ttm', status: 'Yes', kind: 'money',
    rel: 'Net income attributable to the company, four releases summed', shown: 'Quarter only: Last Earning AI Extracted › Net income',
    td: (s) => n(s.netIncomeTtm), relv: (s, c) => c.ttm.netIncome, q10: 'Net income',
    note: 'A Signal input. Gaps are mostly non-controlling interests or preferred dividends in or out.' },
  { group: 'Scale', label: 'FCF TTM', field: 'fcfTtm', src: '/statistics cash_flow.levered_free_cash_flow_ttm', status: 'Partly', kind: 'money',
    rel: 'Free cash flow: the company’s own, else operating cash flow less capex, four releases summed', shown: 'Quarter only: Last Earning AI Extracted › FCF; stock page card',
    td: (s) => n(s.fcfTtm), relv: (s, c) => c.ttm.fcf, q10: 'FCF worked out (ours)',
    note: 'A different measure: Twelve Data’s is LEVERED free cash flow, computed by the provider after interest. Microsoft $16.5B against $60.0B from its releases ($67.0B in its 10-K). A Signal input.' },
  { group: 'Scale', label: 'EBITDA', field: 'ebitda', src: '/statistics income_statement.ebitda', status: 'Partly', kind: 'money',
    rel: 'EBITDA as the company prints it (usually adjusted), four releases summed', shown: 'Not shown (stored)',
    td: (s) => n(s.ebitda), relv: (s, c) => c.ttm.ebitda, q10: null,
    note: 'Only where the release prints it, and then usually the company’s ADJUSTED EBITDA under its own name. No filing figure to check against.' },
  { group: 'Scale', label: 'Operating cash', field: 'operatingCashFlowTtm', src: '/statistics cash_flow.operating_cash_flow_ttm', status: 'Yes', kind: 'money',
    rel: 'Net cash from operating activities, the quarter (or the year to date less the release before), four summed', shown: 'Not shown (stored)',
    td: (s) => n(s.operatingCashFlowTtm), relv: (s, c) => c.ttm.ocf, q10: 'Operating cash flow',
    note: 'Fewer releases print a cash flow statement (about 40% read for it), so coverage is the limit, not accuracy.' },
  { group: 'Scale', label: 'Revenue / employee', field: 'revenuePerEmployee', src: '/profile employees, with revenue TTM', status: 'No', kind: 'money',
    rel: 'Revenue yes; employees no', shown: '—', td: null, relv: null, q10: null,
    note: 'Releases do not give a head count; the 10-K does, once a year.' },
  { group: 'Scale', label: 'Enterprise value', field: 'enterpriseValue', src: '/statistics valuations_metrics.enterprise_value', status: 'Partly', kind: 'money',
    rel: 'Market value + debt lines − cash and short-term investments', shown: 'Not shown',
    td: (s) => n(s.enterpriseValue), relv: (s, c) => (usd(s) && n(s.marketCap) != null && c.debt != null && c.cash != null ? n(s.marketCap) + c.debt - c.cash : null), q10: 'Debt (current + long-term)',
    note: 'Rides on the debt definition, which differs (leases, commercial paper, other borrowings).' },
  { group: 'Valuation', label: 'Fwd P/E', field: 'forwardPe', src: '/statistics valuations_metrics.forward_pe', status: 'No', kind: 'mult',
    rel: 'None: needs analysts’ estimates', shown: '—', td: null, relv: null, q10: null,
    note: 'Analysts’ forecasts are sold by data vendors; no filing has them. A Signal input (company type).' },
  { group: 'Valuation', label: 'Trailing P/E', field: 'trailingPe', src: '/statistics valuations_metrics.trailing_pe', status: 'Yes', kind: 'mult',
    rel: 'Price / GAAP diluted EPS of four releases', shown: 'Quarter EPS: Last Earning AI Extracted › EPS GAAP',
    td: (s) => pos(n(s.trailingPe)), relv: (s, c) => (pos(n(s.price)) && pos(c.ttm.eps) ? n(s.price) / c.ttm.eps : null), q10: 'Diluted EPS',
    note: 'Twelve Data computes it at the price of its own last pull, up to a week old (within 6% of today’s for 80% of companies): most of the gap is the price, not the EPS (Live P/E, on today’s price, agrees far better). A split inside the four quarters breaks the EPS sum.' },
  { group: 'Valuation', label: 'Live P/E', field: 'peLive', src: 'today’s price / Twelve Data diluted EPS TTM', status: 'Yes', kind: 'mult',
    rel: 'Today’s price / GAAP diluted EPS of four releases', shown: 'Not shown',
    td: (s) => (pos(n(s.price)) && pos(n(s.dilutedEpsTtm)) ? n(s.price) / n(s.dilutedEpsTtm) : null), relv: (s, c) => (pos(n(s.price)) && pos(c.ttm.eps) ? n(s.price) / c.ttm.eps : null), q10: 'Diluted EPS',
    note: 'As Trailing P/E: the price is the same on both sides, so the gap is the EPS.' },
  { group: 'Valuation', label: 'P/E vs peers', field: 'peerPe', src: 'forward P/E against the industry’s', status: 'No', kind: 'mult',
    rel: 'None: built on forward P/E', shown: '—', td: null, relv: null, q10: null, note: 'Follows forward P/E.' },
  { group: 'Valuation', label: 'PEG', field: 'peg', src: '/statistics valuations_metrics.peg_ratio', status: 'No', kind: 'mult',
    rel: 'None: needs forecast growth', shown: '—', td: null, relv: null, q10: null, note: 'Analysts’ growth forecasts.' },
  { group: 'Valuation', label: 'P/B', field: 'priceToBook', src: '/statistics valuations_metrics.price_to_book_mrq', status: 'Yes', kind: 'mult',
    rel: 'Market value / equity at the quarter’s end', shown: 'Equity: stock page strip',
    td: (s) => pos(n(s.priceToBook)), relv: (s, c) => (usd(s) && pos(n(s.marketCap)) && pos(c.equity) ? n(s.marketCap) / c.equity : null), q10: 'Equity',
    note: 'Equity in the release is the company’s share (non-controlling interests apart); the market value comes from Twelve Data either way.' },
  { group: 'Valuation', label: 'P/S', field: 'priceToSales', src: '/statistics valuations_metrics.price_to_sales_ttm', status: 'Yes', kind: 'mult',
    rel: 'Market value / revenue of four releases', shown: 'Not shown',
    td: (s) => pos(n(s.priceToSales)), relv: (s, c) => (usd(s) && pos(n(s.marketCap)) && pos(c.ttm.revenue) ? n(s.marketCap) / c.ttm.revenue : null), q10: 'Revenue', note: 'As Revenue TTM.' },
  { group: 'Valuation', label: 'EV / sales', field: 'evToSales', src: 'enterprise value / revenue TTM', status: 'Partly', kind: 'mult',
    rel: 'As Enterprise value, over revenue of four releases', shown: 'Not shown',
    td: (s) => (usd(s) && pos(n(s.enterpriseValue)) && pos(n(s.revenueTtm)) ? n(s.enterpriseValue) / n(s.revenueTtm) : null),
    relv: (s, c) => (usd(s) && n(s.marketCap) != null && c.debt != null && c.cash != null && pos(c.ttm.revenue) ? (n(s.marketCap) + c.debt - c.cash) / c.ttm.revenue : null), q10: 'Debt (current + long-term)',
    note: 'Carries the debt definition.' },
  { group: 'Valuation', label: 'EV/EBITDA', field: 'evToEbitda', src: '/statistics valuations_metrics.enterprise_to_ebitda', status: 'Partly', kind: 'mult',
    rel: 'Enterprise value over the company’s EBITDA, where printed', shown: 'Not shown',
    td: (s) => pos(n(s.evToEbitda)), relv: (s, c) => (usd(s) && n(s.marketCap) != null && c.debt != null && c.cash != null && pos(c.ttm.ebitda) ? (n(s.marketCap) + c.debt - c.cash) / c.ttm.ebitda : null), q10: null,
    note: 'Two definitions in one: debt, and the company’s adjusted EBITDA.' },
  { group: 'Valuation', label: 'P / op cash', field: 'priceToOcf', src: 'market value / operating cash flow TTM', status: 'Yes', kind: 'mult',
    rel: 'Market value / operating cash flow of four releases', shown: 'Not shown',
    td: (s) => (usd(s) && pos(n(s.marketCap)) && pos(n(s.operatingCashFlowTtm)) ? n(s.marketCap) / n(s.operatingCashFlowTtm) : null),
    relv: (s, c) => (usd(s) && pos(n(s.marketCap)) && pos(c.ttm.ocf) ? n(s.marketCap) / c.ttm.ocf : null), q10: 'Operating cash flow', note: 'As Operating cash.' },
  { group: 'Valuation', label: 'Earnings yield', field: 'earningsYield', src: 'Twelve Data EPS TTM / price', status: 'Yes', kind: 'pct',
    rel: 'GAAP EPS of four releases / price', shown: 'Not shown',
    td: (s) => (pos(n(s.price)) && n(s.dilutedEpsTtm) != null ? n(s.dilutedEpsTtm) / n(s.price) * 100 : null), relv: (s, c) => (pos(n(s.price)) && c.ttm.eps != null ? c.ttm.eps / n(s.price) * 100 : null), q10: 'Diluted EPS', note: 'As Trailing P/E.' },
  { group: 'Valuation', label: 'FCF yield', field: 'fcfYield', src: 'levered FCF TTM / market value', status: 'Partly', kind: 'pct',
    rel: 'Free cash flow of four releases / market value', shown: 'Not shown',
    td: (s) => n(s.fcfYield), relv: (s, c) => (usd(s) && pos(n(s.marketCap)) && c.ttm.fcf != null ? c.ttm.fcf / n(s.marketCap) * 100 : null), q10: 'FCF worked out (ours)',
    note: 'Levered against unlevered: a different measure, as FCF TTM.' },
  { group: 'Profitability', label: 'Gross margin', field: 'grossMargin', src: 'gross profit TTM / revenue TTM', status: 'Yes', kind: 'pct',
    rel: 'Gross profit / revenue, four releases', shown: 'Quarter: Last Earning AI Extracted › Gross margin; stock page strip',
    td: (s) => n(s.grossMargin), relv: (s, c) => (pos(c.ttm.revenue) && c.ttm.grossProfit != null ? c.ttm.grossProfit / c.ttm.revenue * 100 : null), q10: 'Gross profit', note: 'A Signal input.' },
  { group: 'Profitability', label: 'Operating margin', field: 'operatingMargin', src: '/statistics financials.operating_margin', status: 'Yes', kind: 'pct',
    rel: 'Income from operations / revenue, four releases', shown: 'Quarter: Last Earning AI Extracted › Op. margin; stock page strip',
    td: (s) => n(s.operatingMargin), relv: (s, c) => (pos(c.ttm.revenue) && c.ttm.opIncome != null ? c.ttm.opIncome / c.ttm.revenue * 100 : null), q10: 'Operating income',
    note: 'Twelve Data’s is mostly the latest QUARTER’s, not twelve months’: it is within a point of the release’s quarter margin for 62% (2026-10-29) against 27% for the twelve months. Banks print no operating income.' },
  { group: 'Profitability', label: 'Profit margin', field: 'profitMargin', src: 'net income TTM / revenue TTM', status: 'Yes', kind: 'pct',
    rel: 'Net income / revenue, four releases', shown: 'Not shown as twelve months',
    td: (s) => n(s.profitMargin), relv: (s, c) => (pos(c.ttm.revenue) && c.ttm.netIncome != null ? c.ttm.netIncome / c.ttm.revenue * 100 : null), q10: 'Net income', note: 'A Signal input.' },
  { group: 'Profitability', label: 'FCF margin', field: 'fcfMargin', src: 'levered FCF TTM / revenue TTM', status: 'Partly', kind: 'pct',
    rel: 'Free cash flow / revenue, four releases', shown: 'Not shown',
    td: (s) => n(s.fcfMargin), relv: (s, c) => (pos(c.ttm.revenue) && c.ttm.fcf != null ? c.ttm.fcf / c.ttm.revenue * 100 : null), q10: 'FCF worked out (ours)',
    note: 'Levered against unlevered. A Signal input.' },
  { group: 'Profitability', label: 'ROE', field: 'roe', src: '/statistics financials.return_on_equity_ttm', status: 'Yes', kind: 'pct',
    rel: 'Net income of four releases / equity at the quarter’s end', shown: 'Not shown',
    td: (s) => n(s.roe), relv: (s, c) => (pos(c.equity) && c.ttm.netIncome != null ? c.ttm.netIncome / c.equity * 100 : null), q10: 'Equity',
    note: 'Twelve Data divides by average equity; the release gives only the quarter-end figure, so expect a gap where equity moved. A Signal input (company type).' },
  { group: 'Profitability', label: 'ROA', field: 'roa', src: '/statistics financials.return_on_assets_ttm', status: 'Yes', kind: 'pct',
    rel: 'Net income of four releases / total assets at the quarter’s end', shown: 'Total assets: stock page strip',
    td: (s) => n(s.roa), relv: (s, c) => (pos(c.assets) && c.ttm.netIncome != null ? c.ttm.netIncome / c.assets * 100 : null), q10: 'Total assets',
    note: 'Average against quarter-end assets, as ROE.' },
  { group: 'Growth', label: 'Rev grth Q YoY', field: 'revenueGrowthYoY', src: '/statistics income_statement.quarterly_revenue_growth', status: 'Yes', kind: 'pct',
    rel: 'Revenue against the same quarter a year earlier, both printed in the release', shown: 'Last Earning AI Extracted › Rev YoY',
    td: (s) => n(s.revenueGrowthYoY), relv: (s, c) => (c.r.revenue != null && pos(c.r.revenue_prior) ? (c.r.revenue / c.r.revenue_prior - 1) * 100 : null), q10: 'Revenue',
    note: 'The same definition on both sides. A Signal input.' },
  { group: 'Growth', label: 'Earn grth Q YoY', field: 'earningsGrowthYoY', src: '/statistics income_statement.quarterly_earnings_growth_yoy', status: 'Yes', kind: 'pct',
    rel: 'Net income against the same quarter a year earlier', shown: 'Last Earning AI Extracted › Net income YoY',
    td: (s) => n(s.earningsGrowthYoY), relv: (s, c) => (c.r.net_income != null && pos(c.r.net_income_prior) ? (c.r.net_income / c.r.net_income_prior - 1) * 100 : null), q10: 'Net income',
    note: 'Off a loss there is no rate on our side; Twelve Data sometimes gives one. A Signal input.' },
  { group: 'Growth', label: 'EPS TTM', field: 'dilutedEpsTtm', src: '/statistics income_statement.diluted_eps_ttm', status: 'Yes', kind: 'mult',
    rel: 'GAAP diluted EPS, four releases summed', shown: 'Quarter: Last Earning AI Extracted › EPS GAAP',
    td: (s) => n(s.dilutedEpsTtm), relv: (s, c) => c.ttm.eps, q10: 'Diluted EPS', note: 'A split inside the four quarters breaks the sum; quarter EPS do not add exactly.' },
  { group: 'Financial position', label: 'Cash', field: 'totalCash', src: '/statistics balance_sheet.total_cash_mrq', status: 'Yes', kind: 'money',
    rel: 'Cash and equivalents with short-term investments, quarter end', shown: 'Last Earning AI Extracted › Cash; stock page strip',
    td: (s) => n(s.totalCash), relv: (s, c) => c.cash, q10: 'Cash', note: 'Restricted cash and long-dated investments sit in or out depending on the company.' },
  { group: 'Financial position', label: 'Debt', field: 'totalDebt', src: '/statistics balance_sheet.total_debt_mrq', status: 'Partly', kind: 'money',
    rel: 'The current and long-term debt lines as printed', shown: 'Stock page strip',
    td: (s) => n(s.totalDebt), relv: (s, c) => c.debt, q10: 'Debt (current + long-term)',
    note: 'Definitions differ a lot (leases, commercial paper, other borrowings): it agreed with the filings’ total in only about 38%. Not a reliable swap.' },
  { group: 'Financial position', label: 'Net cash', field: 'netCash', src: 'total cash − total debt', status: 'Partly', kind: 'money',
    rel: 'Cash and short-term investments − the debt lines', shown: 'Not shown',
    td: (s) => n(s.netCash), relv: (s, c) => (c.cash != null && c.debt != null ? c.cash - c.debt : null), q10: 'Debt (current + long-term)', note: 'Carries the debt definition.' },
  { group: 'Financial position', label: 'Net cash / share', field: 'netCashPerShare', src: 'net cash / shares outstanding', status: 'Partly', kind: 'money',
    rel: 'As Net cash, over diluted shares', shown: 'Not shown',
    td: (s) => (usd(s) && n(s.netCash) != null && pos(n(s.sharesOutstanding)) ? n(s.netCash) / n(s.sharesOutstanding) : null), relv: (s, c) => (usd(s) && c.cash != null && c.debt != null && pos(c.shares) ? (c.cash - c.debt) / c.shares : null), q10: 'Debt (current + long-term)',
    note: 'Debt definition and diluted against outstanding shares.' },
  { group: 'Financial position', label: 'Debt / equity', field: 'debtToEquity', src: '/statistics balance_sheet.total_debt_to_equity_mrq', status: 'Partly', kind: 'mult',
    rel: 'Debt lines / equity at the quarter’s end', shown: 'Not shown',
    td: (s) => (n(s.debtToEquity) == null ? null : n(s.debtToEquity) / 100), relv: (s, c) => (c.debt != null && pos(c.equity) ? c.debt / c.equity : null), q10: 'Debt (current + long-term)',
    note: 'Twelve Data states it in percent (78 for 0.78); compared as a ratio here. Carries the debt definition.' },
  { group: 'Financial position', label: 'Current ratio', field: 'currentRatio', src: '/statistics balance_sheet.current_ratio_mrq', status: 'Yes', kind: 'mult',
    rel: 'Current assets / current liabilities at the quarter’s end', shown: 'Not shown',
    td: (s) => pos(n(s.currentRatio)), relv: (s, c) => (pos(c.curA) && pos(c.curL) ? c.curA / c.curL : null), q10: null,
    note: 'Banks and insurers do not split current from long-term.' },
  { group: 'Financial position', label: 'Net cash %', field: 'netCashPct', src: 'net cash / market value', status: 'Partly', kind: 'pct',
    rel: 'As Net cash, over market value', shown: 'Not shown',
    td: (s) => n(s.netCashPct), relv: (s, c) => (usd(s) && pos(n(s.marketCap)) && c.cash != null && c.debt != null ? (c.cash - c.debt) / n(s.marketCap) * 100 : null), q10: 'Debt (current + long-term)', note: 'Carries the debt definition.' },
  { group: 'Dividends and returns', label: 'Dividend yield', field: 'divYield', src: '/statistics dividends_and_splits.forward_annual_dividend_yield', status: 'No', kind: 'pct',
    rel: 'Not read (some releases announce the dividend)', shown: '—', td: null, relv: null, q10: null,
    note: 'A forward rate. The dividend a release declares could be read; the reader does not ask for it today.' },
  { group: 'Dividends and returns', label: 'Payout ratio', field: 'payoutRatio', src: '/statistics dividends_and_splits.payout_ratio', status: 'No', kind: 'pct', rel: 'Not read', shown: '—', td: null, relv: null, q10: null, note: 'Would follow a dividend reading.' },
  { group: 'Dividends and returns', label: 'Shareholder yield', field: 'shareholderYield', src: 'Twelve Data dividend yield + buyback yield (filings)', status: 'No', kind: 'pct', rel: 'Buybacks from the filings already; dividend yield is Twelve Data’s', shown: '—', td: null, relv: null, q10: null, note: 'Half from the filings already.' },
  { group: 'Dividends and returns', label: 'Dividend rate', field: 'divRate', src: '/statistics dividends_and_splits.forward_annual_dividend_rate', status: 'No', kind: 'money', rel: 'Not read', shown: '—', td: null, relv: null, q10: null, note: 'As Dividend yield.' },
  { group: 'Dividends and returns', label: 'Ex-dividend', field: 'exDivDate', src: '/statistics dividends_and_splits.ex_dividend_date', status: 'No', kind: null, rel: 'Not read', shown: '—', td: null, relv: null, q10: null, note: 'Dividend declarations come in their own 8-Ks or the release; not read.' },
  { group: 'Dividends and returns', label: 'Dividend paid', field: 'divPayDate', src: '/statistics dividends_and_splits.dividend_date', status: 'No', kind: null, rel: 'Not read', shown: '—', td: null, relv: null, q10: null, note: 'As Ex-dividend.' },
  { group: 'Reporting', label: 'Period', field: 'mostRecentQuarter', src: '/statistics financials.most_recent_quarter', status: 'Yes', kind: null,
    rel: 'The quarter’s end, as the release states it', shown: 'Last Earning AI Extracted › Quarter end', td: null, relv: null, q10: null,
    note: 'The release names the newer quarter days before Twelve Data does: a median of 6 days in the measurement (90th percentile 16).' },
  { group: 'Reporting', label: 'Reported', field: 'lastEarningsDate', src: '/earnings (report dates)', status: 'Yes', kind: null,
    rel: 'The day the results 8-K was filed', shown: 'Last Earning AI Extracted › Reported', td: null, relv: null, q10: null,
    note: 'Ours is the SEC filing day. Not read by the Signal itself; it feeds the next-report estimate behind Earnings soon.' },
  { group: 'Reporting', label: 'Last split', field: 'lastSplitDate', src: '/statistics dividends_and_splits.last_split_date', status: 'No', kind: null, rel: 'None', shown: '—', td: null, relv: null, q10: null, note: 'Splits come from the price provider.' },
  { group: 'Ownership', label: 'Shares out', field: 'sharesOutstanding', src: '/statistics stock_statistics.shares_outstanding', status: 'Partly', kind: 'money',
    rel: 'Weighted-average diluted shares for the quarter', shown: 'Stock page strip',
    td: (s) => pos(n(s.sharesOutstanding)), relv: (s, c) => pos(c.shares), q10: 'Diluted shares',
    note: 'Weighted diluted for the quarter against outstanding today: near, not the same. The 10-Q cover page has the outstanding count.' },
  { group: 'Ownership', label: 'Book value/share', field: 'bookValuePerShare', src: '/statistics balance_sheet.book_value_per_share_mrq', status: 'Yes', kind: 'mult',
    rel: 'Equity / diluted shares', shown: 'Not shown',
    td: (s) => n(s.bookValuePerShare), relv: (s, c) => (pos(c.shares) && c.equity != null ? c.equity / c.shares : null), q10: 'Equity', note: 'Diluted against outstanding shares.' },
  { group: 'Ownership', label: 'Float', field: 'floatShares', src: '/statistics stock_statistics.float_shares', status: 'No', kind: 'money', rel: 'None', shown: '—', td: null, relv: null, q10: null, note: 'Filings give public float once a year (10-K cover), in dollars.' },
  { group: 'Ownership', label: 'Short ratio', field: 'shortRatio', src: '/statistics stock_statistics.short_ratio', status: 'No', kind: 'mult', rel: 'None', shown: '—', td: null, relv: null, q10: null, note: 'FINRA short interest is already read (Short build, days to cover); float is the missing half.' },
  { group: 'Ownership', label: 'Short % float', field: 'shortPctFloat', src: '/statistics stock_statistics.shares_short / float_shares', status: 'No', kind: 'pct', rel: 'None', shown: '—', td: null, relv: null, q10: null, note: 'A Signal input (a guard). Needs float.' },
  { group: 'Ownership', label: 'Short % out', field: 'shortPctOutstanding', src: '/statistics stock_statistics.short_percent_of_shares_outstanding', status: 'No', kind: 'pct', rel: 'None', shown: '—', td: null, relv: null, q10: null, note: 'FINRA short interest over shares outstanding could replace it.' },
  { group: 'Ownership', label: 'Insiders', field: 'insiderPct', src: '/statistics stock_statistics.percent_held_by_insiders', status: 'No', kind: 'pct', rel: 'None', shown: '—', td: null, relv: null, q10: null, note: 'The proxy statement has it once a year.' },
  { group: 'Ownership', label: 'Institutions', field: 'institutionPct', src: '/statistics stock_statistics.percent_held_by_institutions', status: 'No', kind: 'pct', rel: 'None', shown: '—', td: null, relv: null, q10: null, note: 'The 13F load already counts institutional holders; a percent needs shares outstanding.' },
  { group: 'Scores', label: 'Qual.', field: 'qualityRating', src: 'our score, built from Twelve Data’s fields', status: 'Partly', kind: null,
    rel: 'Its inputs: margins, growth, ROE, net cash, from the releases where they exist', shown: '—', td: null, relv: null, q10: null,
    note: 'Not a Twelve Data figure but made of them; it would move with its inputs. A Signal input.' },
];
// THE SIGNAL'S USE OF EACH (private/action.js, read 2026-10-29): which step
// reads the field. Company type is classify() (size, profitability, free cash
// flow, priced on earnings, quality or ROE); Fundamentals is fundamentals()
// (the strong / ok / weak bucket); the guard is definitions()' heavy short.
// lastEarningsDate is not read by action.js: it only feeds the next report
// estimate (earndate.js) behind Earnings soon, so it is marked indirect.
const SIGNAL = {
  marketCap: 'Company type (size)', forwardPe: 'Company type (priced on earnings; no P/E and no Quality reads as a fund)',
  netIncomeTtm: 'Company type (profitability); Fundamentals', profitMargin: 'Company type (profitability); Fundamentals',
  fcfTtm: 'Company type (free cash flow); Fundamentals', fcfMargin: 'Company type (free cash flow); Fundamentals',
  roe: 'Company type (the seventh point when Quality is off)', qualityRating: 'Company type (the seventh point); Fundamentals',
  revenueGrowthYoY: 'Fundamentals', earningsGrowthYoY: 'Fundamentals', grossMargin: 'Fundamentals',
  shortPctFloat: 'Fundamentals; the heavy-short guard',
};
const SIGNAL_INDIRECT = { lastEarningsDate: 'Indirect: the last report date feeds our next-report estimate (earndate.js), which the Earnings soon rule reads when no announced date is listed' };
// Columns that look like Twelve Data's but already come from the filings.
const FROM_FILINGS = ['Margin change (Profitability)', 'Working capital (Financial position)', 'Buyback yield (Dividends and returns)', 'Shares chg 1Y (Ownership)',
  'every Long run column', '13F holders and 13F shares chg', 'Insider net, Short build, Last 8-K and 5% filing'];

(async () => {
  const db = new DatabaseSync(path.join(__dirname, 'analysis.db'), { readOnly: true });
  // The 10-Q agreement, from release-compare.js.
  const tmp = path.join(os.tmpdir(), 'release-compare-' + Date.now() + '.json');
  execFileSync(process.execPath, ['--no-warnings', path.join(__dirname, 'release-compare.js'), '--json', tmp], { cwd: __dirname, stdio: 'ignore', timeout: 600000 });
  const cmp = JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.unlinkSync(tmp);
  const snap = await store.readSnapshot();
  const rows = (snap.stocks || []).filter((s) => s && !s.error && s.symbol && s.instrumentType !== 'ETF');
  const rel = new Map();
  for (const r of db.prepare('select * from earnings_releases where is_results = 1 and period_end is not null order by symbol, period_end, filed').all()) {
    if (!rel.has(r.symbol)) rel.set(r.symbol, []);
    const l = rel.get(r.symbol);
    if (l.length && l[l.length - 1].period_end === r.period_end) l[l.length - 1] = r; else l.push(r);
  }
  const ctx = new Map();
  for (const s of rows) { const c = context(rel.get(s.symbol) || []); if (c) ctx.set(s.symbol, c); }
  const out = [];
  for (const col of COLS) {
    const o = { signal: SIGNAL[col.field] || null, signalIndirect: SIGNAL_INDIRECT[col.field] || null, group: col.group, label: col.label, field: col.field, source: col.src, status: col.status, equivalent: col.rel, shown: col.shown, note: col.note, kind: col.kind };
    if (col.td) {
      let tdN = 0, relN = 0; const gaps = [];
      for (const s of rows) {
        const a = col.td(s); if (a != null) tdN++;
        const c = ctx.get(s.symbol); if (!c) continue;
        const b = col.relv(s, c); if (b == null) continue;
        relN++;
        if (a == null) continue;
        const same = s.lastEarningsDate && Math.abs(t(c.r.filed) - t(s.lastEarningsDate)) <= 5 * DAY;
        if (!same) continue;
        gaps.push(col.kind === 'pct' ? Math.abs(b - a) : Math.abs(b - a) / Math.max(Math.abs(a), 1e-9) * 100);
      }
      gaps.sort((x, y) => x - y);
      const tol = col.kind === 'pct' ? 1 : 2;
      o.coverage = { td: tdN, rel: relN, of: rows.length };
      o.vsTd = gaps.length ? { n: gaps.length, close: Math.round(1000 * gaps.filter((g) => g <= tol).length / gaps.length) / 10, median: Math.round(gaps[gaps.length >> 1] * 10) / 10, unit: col.kind === 'pct' ? 'pts' : '%', tol } : null;
    }
    if (col.q10 && cmp.fields[col.q10]) {
      const f = cmp.fields[col.q10];
      o.vs10q = { figure: col.q10, pairs: f.pairs, within05: f.pairs ? Math.round(1000 * f.bands[1] / f.pairs) / 10 : null };
    }
    out.push(o);
  }
  const lags = (cmp.twelveData && cmp.twelveData.revenue || []).filter((x) => x.lag != null).map((x) => x.lag).sort((a, b) => a - b);
  const filingLag = (cmp.timing || []).map((x) => x.d).sort((a, b) => a - b);
  const doc = {
    builtAt: new Date().toISOString(), releasesSince: cmp.since, releases: cmp.releases, matched: cmp.matched, companies: rows.length, withReleases: ctx.size,
    timing: { tdMedianDays: lags.length ? lags[lags.length >> 1] : null, tdP90Days: lags.length ? lags[Math.floor(0.9 * lags.length)] : null, tdN: lags.length,
      filingSameDayPct: filingLag.length ? Math.round(1000 * filingLag.filter((d) => d === 0).length / filingLag.length) / 10 : null,
      filingMedianDays: filingLag.length ? filingLag[filingLag.length >> 1] : null, filingP90Days: filingLag.length ? filingLag[Math.floor(0.9 * filingLag.length)] : null },
    fromFilings: FROM_FILINGS, rows: out };
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1));
  const c = (st) => out.filter((r) => r.status === st).length;
  console.log(`written ${OUT}: ${out.length} columns (Yes ${c('Yes')}, Partly ${c('Partly')}, No ${c('No')}); ${ctx.size} of ${rows.length} companies with a release in the last 130 days`);
  process.exit(0);
})();
