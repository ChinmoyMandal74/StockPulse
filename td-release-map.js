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
const SecFacts = require('./secfacts.js');
const finSector = (s) => /^financial/i.test(String((s && s.sector) || ''));

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
      ocf: sum((x, i) => qOcf(i)), fcf: sum((x) => x.fcf_calc), fcfStated: sum((x) => (x.fcf != null ? x.fcf : x.fcf_calc)), eps: sum((x) => x.eps_gaap), ebitda: sum((x) => x.ebitda),
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
  { group: 'Scale', label: 'FCF TTM', field: 'fcfTtm', src: '/statistics cash_flow.levered_free_cash_flow_ttm', status: 'Yes', kind: 'money',
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
  { group: 'Scale', label: 'Enterprise value', field: 'enterpriseValue', src: '/statistics valuations_metrics.enterprise_value', status: 'Yes', kind: 'money',
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
  { group: 'Valuation', label: 'EV / sales', field: 'evToSales', src: 'enterprise value / revenue TTM', status: 'Yes', kind: 'mult',
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
  { group: 'Valuation', label: 'FCF yield', field: 'fcfYield', src: 'levered FCF TTM / market value', status: 'Yes', kind: 'pct',
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
  { group: 'Profitability', label: 'FCF margin', field: 'fcfMargin', src: 'levered FCF TTM / revenue TTM', status: 'Yes', kind: 'pct',
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
  { group: 'Financial position', label: 'Debt', field: 'totalDebt', src: '/statistics balance_sheet.total_debt_mrq', status: 'Yes', kind: 'money',
    rel: 'The current and long-term debt lines as printed', shown: 'Stock page strip',
    td: (s) => n(s.totalDebt), relv: (s, c) => c.debt, q10: 'Debt (current + long-term)',
    note: 'Definitions differ a lot (leases, commercial paper, other borrowings): it agreed with the filings’ total in only about 38%. Not a reliable swap.' },
  { group: 'Financial position', label: 'Net cash', field: 'netCash', src: 'total cash − total debt', status: 'Yes', kind: 'money',
    rel: 'Cash and short-term investments − the debt lines', shown: 'Not shown',
    td: (s) => n(s.netCash), relv: (s, c) => (c.cash != null && c.debt != null ? c.cash - c.debt : null), q10: 'Debt (current + long-term)', note: 'Carries the debt definition.' },
  { group: 'Financial position', label: 'Net cash / share', field: 'netCashPerShare', src: 'net cash / shares outstanding', status: 'Yes', kind: 'money',
    rel: 'As Net cash, over diluted shares', shown: 'Not shown',
    td: (s) => (usd(s) && n(s.netCash) != null && pos(n(s.sharesOutstanding)) ? n(s.netCash) / n(s.sharesOutstanding) : null), relv: (s, c) => (usd(s) && c.cash != null && c.debt != null && pos(c.shares) ? (c.cash - c.debt) / c.shares : null), q10: 'Debt (current + long-term)',
    note: 'Debt definition and diluted against outstanding shares.' },
  { group: 'Financial position', label: 'Debt / equity', field: 'debtToEquity', src: '/statistics balance_sheet.total_debt_to_equity_mrq', status: 'Yes', kind: 'mult',
    rel: 'Debt lines / equity at the quarter’s end', shown: 'Not shown',
    td: (s) => (n(s.debtToEquity) == null ? null : n(s.debtToEquity) / 100), relv: (s, c) => (c.debt != null && pos(c.equity) ? c.debt / c.equity : null), q10: 'Debt (current + long-term)',
    note: 'Twelve Data states it in percent (78 for 0.78); compared as a ratio here. Carries the debt definition.' },
  { group: 'Financial position', label: 'Current ratio', field: 'currentRatio', src: '/statistics balance_sheet.current_ratio_mrq', status: 'Yes', kind: 'mult',
    rel: 'Current assets / current liabilities at the quarter’s end', shown: 'Not shown',
    td: (s) => pos(n(s.currentRatio)), relv: (s, c) => (pos(c.curA) && pos(c.curL) ? c.curA / c.curL : null), q10: null,
    note: 'Banks and insurers do not split current from long-term.' },
  { group: 'Financial position', label: 'Net cash %', field: 'netCashPct', src: 'net cash / market value', status: 'Yes', kind: 'pct',
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
// ---- THE SEC FILINGS SIDE (2026-10-29, the owner: "yes add and I like the
// best source") ---------------------------------------------------------------
// sec_facts, the companies' own 10-Q and 10-K data (secfacts.js), a quarter at
// a time. Each period's latest filing (a restatement replaces), quarters only;
// twelve months are four in a row summed, the newest within 200 days. The
// balance sheet is the newest quarter's.
// TWELVE MONTHS, two ways (traced 2026-10-29: the 10-K's worked-out fourth
// quarter carries no EPS, as EPS cannot be subtracted, and some banks give
// revenue only for the year). Four quarters in a row summed when all four
// carry the line; otherwise the year (when the newest quarter ends it), or
// last year plus this year to date less last year to date, as the providers
// work it.
function secContext(qs, others) {
  if (!qs || !qs.length) return null;
  const last = qs[qs.length - 1];
  if ((Date.now() - t(last.period_end)) / DAY > 200) return null;
  const x = { last, ttm: {} };
  const gapOk = (a, b) => { const g = (t(b.period_end) - t(a.period_end)) / DAY; return g >= 75 && g <= 105; };
  const four = qs.slice(-4);
  let chain = four.length === 4;
  for (let k = 1; chain && k < 4; k++) if (!gapOk(four[k - 1], four[k])) chain = false;
  const near = (a, b, d) => Math.abs(t(a) - t(b)) <= d * DAY;
  const O = others || [];
  const fyAt = O.find((r) => r.period_type === 'FY' && near(r.period_end, last.period_end, 7));
  const ytd = O.find((r) => (r.period_type === 'H' || r.period_type === '9M') && near(r.period_end, last.period_end, 7));
  const fyPrev = ytd ? O.filter((r) => r.period_type === 'FY' && t(r.period_end) < t(last.period_end) && (t(last.period_end) - t(r.period_end)) / DAY < 300).pop() : null;
  const ytdPrev = ytd ? O.find((r) => r.period_type === ytd.period_type && Math.abs((t(last.period_end) - t(r.period_end)) / DAY - 364) <= 14) : null;
  const ttmOf = (f) => {
    if (chain) { let v = 0, ok = true; for (const q of four) { const y = f(q); if (y == null) { ok = false; break; } v += y; } if (ok) return v; }
    if (fyAt) return f(fyAt);
    if (fyPrev && ytd && ytdPrev) { const a = f(fyPrev), b = f(ytd), c = f(ytdPrev); if (a != null && b != null && c != null) return a + b - c; }
    return null;
  };
  x.ttm = {
    revenue: ttmOf((q) => q.revenue), netIncome: ttmOf((q) => q.net_income), opIncome: ttmOf((q) => q.operating_income), eps: ttmOf((q) => q.eps_diluted),
    grossProfit: ttmOf((q) => (q.gross_profit != null ? q.gross_profit : q.cost_of_revenue != null && q.revenue != null ? q.revenue - Math.abs(q.cost_of_revenue) : null)),
    ocf: ttmOf((q) => q.operating_cash_flow), fcf: ttmOf((q) => (q.operating_cash_flow == null || q.capex == null ? null : q.operating_cash_flow - Math.abs(q.capex))),
    dps: ttmOf((q) => q.dividends_per_share), divPaid: ttmOf((q) => (q.dividends_paid == null ? null : Math.abs(q.dividends_paid))),
    ebitda: ttmOf((q) => (q.operating_income == null || q.depreciation == null ? null : q.operating_income + q.depreciation)),
    netRevenue: ttmOf((q) => q.net_revenue),
  };
  const yearAgo = qs.find((q) => { const g = (t(last.period_end) - t(q.period_end)) / DAY; return g >= 350 && g <= 380; });
  Object.assign(x, { yearAgo, assets: last.assets, equity: last.equity, cash: last.cash, debt: last.debt, curA: last.current_assets, curL: last.current_liabilities, shares: last.shares_diluted });
  // The new items (2026-10-29): total debt to the owner's definition, cash with short-term investments, the cover page.
  const dl = { debtCurrent: last.debt_current, ltdCurrent: last.ltd_current, ltdNoncurrent: last.ltd_noncurrent, ltdTotal: last.ltd_total, stBorrowings: last.st_borrowings, commercialPaper: last.commercial_paper, ltdLeaseNoncurrent: last.ltd_lease_noncurrent, ltdLeaseCurrent: last.ltd_lease_current };
  x.totalDebt = SecFacts.totalDebt(dl); x.debtLeases = SecFacts.debtWithLeases(dl);
  x.cashSti = last.cash == null && last.short_term_investments == null ? null : (last.cash || 0) + (last.short_term_investments || 0);
  x.sharesOut = last.shares_outstanding != null && last.shares_outstanding > 0 ? last.shares_outstanding : null;
  const emp = [...qs, ...(others || [])].filter((r) => r.employees != null && r.employees > 0).sort((a, b) => (a.period_end < b.period_end ? 1 : -1))[0];
  x.employees = emp ? emp.employees : null;
  x.yearAgoNet = yearAgo ? yearAgo.net_revenue : null;
  return x;
}
// Per column: status (Yes / Partly / No), the SEC line, and its value.
const SEC = {
  'Market Cap': { st: 'Yes', eq: 'Cover-page shares outstanding \u00d7 today\u2019s price', v: (s, x) => (usd(s) && pos(n(s.price)) && x.sharesOut ? n(s.price) * x.sharesOut : null) },
  'Revenue TTM': { st: 'Yes', eq: 'Revenue, four quarters (net revenue for banks and insurers where filed)', v: (s, x) => (finSector(s) && x.ttm.netRevenue != null ? x.ttm.netRevenue : x.ttm.revenue) },
  'Gross profit': { st: 'Yes', eq: 'Gross profit (or revenue less cost of revenue), four quarters', v: (s, x) => x.ttm.grossProfit },
  'Net income': { st: 'Yes', eq: 'Net income, four quarters', v: (s, x) => x.ttm.netIncome },
  'FCF TTM': { st: 'Yes', eq: 'Operating cash flow less capex, four quarters', v: (s, x) => x.ttm.fcf },
  'EBITDA': { st: 'Yes', eq: 'Operating income plus depreciation and amortization, four quarters', v: (s, x) => x.ttm.ebitda },
  'Operating cash': { st: 'Yes', eq: 'Net cash from operating activities, four quarters', v: (s, x) => x.ttm.ocf },
  'Revenue / employee': { st: 'Partly', eq: 'Revenue over employees, where the filer tags its head count (few do)', v: (s, x) => (x.employees && pos(x.ttm.revenue) ? x.ttm.revenue / x.employees : null) },
  'Enterprise value': { st: 'Yes', eq: 'Market value + total debt (borrowings) \u2212 cash and short-term investments', v: (s, x) => (usd(s) && n(s.marketCap) != null && (x.totalDebt) != null && (x.cashSti) != null ? n(s.marketCap) + (x.totalDebt) - (x.cashSti) : null) },
  'Fwd P/E': { st: 'No', eq: 'None: estimates' }, 'P/E vs peers': { st: 'No', eq: 'None' }, 'PEG': { st: 'No', eq: 'None: estimates' },
  'Trailing P/E': { st: 'Yes', eq: 'Price / diluted EPS of four quarters', v: (s, x) => (pos(n(s.price)) && pos(x.ttm.eps) ? n(s.price) / x.ttm.eps : null) },
  'Live P/E': { st: 'Yes', eq: 'Today\u2019s price / diluted EPS of four quarters', v: (s, x) => (pos(n(s.price)) && pos(x.ttm.eps) ? n(s.price) / x.ttm.eps : null) },
  'P/B': { st: 'Yes', eq: 'Market value / equity', v: (s, x) => (usd(s) && pos(n(s.marketCap)) && pos(x.equity) ? n(s.marketCap) / x.equity : null) },
  'P/S': { st: 'Yes', eq: 'Market value / revenue of four quarters', v: (s, x) => { const r = finSector(s) && x.ttm.netRevenue != null ? x.ttm.netRevenue : x.ttm.revenue; return usd(s) && pos(n(s.marketCap)) && pos(r) ? n(s.marketCap) / r : null; } },
  'EV / sales': { st: 'Yes', eq: 'Enterprise value over revenue of four quarters', v: (s, x) => (usd(s) && n(s.marketCap) != null && (x.totalDebt) != null && (x.cashSti) != null && pos(x.ttm.revenue) ? (n(s.marketCap) + (x.totalDebt) - (x.cashSti)) / x.ttm.revenue : null) },
  'EV/EBITDA': { st: 'Yes', eq: 'Enterprise value over EBITDA (operating income plus depreciation), four quarters', v: (s, x) => (usd(s) && n(s.marketCap) != null && (x.totalDebt) != null && (x.cashSti) != null && pos(x.ttm.ebitda) ? (n(s.marketCap) + (x.totalDebt) - (x.cashSti)) / x.ttm.ebitda : null) },
  'P / op cash': { st: 'Yes', eq: 'Market value / operating cash flow of four quarters', v: (s, x) => (usd(s) && pos(n(s.marketCap)) && pos(x.ttm.ocf) ? n(s.marketCap) / x.ttm.ocf : null) },
  'Earnings yield': { st: 'Yes', eq: 'Diluted EPS of four quarters / price', v: (s, x) => (pos(n(s.price)) && x.ttm.eps != null ? x.ttm.eps / n(s.price) * 100 : null) },
  'FCF yield': { st: 'Yes', eq: 'Operating cash flow less capex / market value', v: (s, x) => (usd(s) && pos(n(s.marketCap)) && x.ttm.fcf != null ? x.ttm.fcf / n(s.marketCap) * 100 : null) },
  'Gross margin': { st: 'Yes', eq: 'Gross profit / revenue, four quarters', v: (s, x) => (pos(x.ttm.revenue) && x.ttm.grossProfit != null ? x.ttm.grossProfit / x.ttm.revenue * 100 : null) },
  'Operating margin': { st: 'Yes', eq: 'Operating income / revenue, four quarters', v: (s, x) => (pos(x.ttm.revenue) && x.ttm.opIncome != null ? x.ttm.opIncome / x.ttm.revenue * 100 : null) },
  'Profit margin': { st: 'Yes', eq: 'Net income / revenue, four quarters', v: (s, x) => (pos(x.ttm.revenue) && x.ttm.netIncome != null ? x.ttm.netIncome / x.ttm.revenue * 100 : null) },
  'FCF margin': { st: 'Yes', eq: 'Operating cash flow less capex / revenue', v: (s, x) => (pos(x.ttm.revenue) && x.ttm.fcf != null ? x.ttm.fcf / x.ttm.revenue * 100 : null) },
  'ROE': { st: 'Yes', eq: 'Net income of four quarters / equity', v: (s, x) => (pos(x.equity) && x.ttm.netIncome != null ? x.ttm.netIncome / x.equity * 100 : null) },
  'ROA': { st: 'Yes', eq: 'Net income of four quarters / total assets', v: (s, x) => (pos(x.assets) && x.ttm.netIncome != null ? x.ttm.netIncome / x.assets * 100 : null) },
  'Rev grth Q YoY': { st: 'Yes', eq: 'The quarter\u2019s revenue against the same quarter a year earlier', v: (s, x) => (x.yearAgo && x.last.revenue != null && pos(x.yearAgo.revenue) ? (x.last.revenue / x.yearAgo.revenue - 1) * 100 : null) },
  'Earn grth Q YoY': { st: 'Yes', eq: 'The quarter\u2019s net income against the same quarter a year earlier', v: (s, x) => (x.yearAgo && x.last.net_income != null && pos(x.yearAgo.net_income) ? (x.last.net_income / x.yearAgo.net_income - 1) * 100 : null) },
  'EPS TTM': { st: 'Yes', eq: 'Diluted EPS, four quarters', v: (s, x) => x.ttm.eps },
  'Cash': { st: 'Yes', eq: 'Cash and equivalents plus short-term investments', v: (s, x) => (x.cashSti) },
  'Debt': { st: 'Yes', eq: 'Total debt, the owner\u2019s definition: borrowings, leases apart (secfacts.js totalDebt)', v: (s, x) => (x.totalDebt) },
  'Net cash': { st: 'Yes', eq: 'Cash and short-term investments \u2212 total debt', v: (s, x) => ((x.cashSti) != null && (x.totalDebt) != null ? (x.cashSti) - (x.totalDebt) : null) },
  'Net cash / share': { st: 'Yes', eq: 'Net cash over cover-page shares outstanding', v: (s, x) => (usd(s) && (x.cashSti) != null && (x.totalDebt) != null && x.sharesOut ? ((x.cashSti) - (x.totalDebt)) / x.sharesOut : null) },
  'Debt / equity': { st: 'Yes', eq: 'Total debt over equity', v: (s, x) => ((x.totalDebt) != null && pos(x.equity) ? (x.totalDebt) / x.equity : null) },
  'Current ratio': { st: 'Yes', eq: 'Current assets / current liabilities', v: (s, x) => (pos(x.curA) && pos(x.curL) ? x.curA / x.curL : null) },
  'Net cash %': { st: 'Yes', eq: 'Net cash over market value', v: (s, x) => (usd(s) && pos(n(s.marketCap)) && (x.cashSti) != null && (x.totalDebt) != null ? ((x.cashSti) - (x.totalDebt)) / n(s.marketCap) * 100 : null) },
  'Dividend yield': { st: 'Partly', eq: 'Dividends per share of four quarters / price (trailing, not forward)', v: (s, x) => (usd(s) && pos(n(s.price)) && x.ttm.dps != null ? x.ttm.dps / n(s.price) * 100 : null) },
  'Payout ratio': { st: 'Partly', eq: 'Dividends paid / net income, four quarters', v: (s, x) => (x.ttm.divPaid != null && pos(x.ttm.netIncome) ? x.ttm.divPaid / x.ttm.netIncome * 100 : null) },
  'Shareholder yield': { st: 'Partly', eq: 'Buybacks already from the filings; dividends from the filings too (trailing)' },
  'Dividend rate': { st: 'Partly', eq: 'Dividends per share, four quarters (trailing)', v: (s, x) => x.ttm.dps },
  'Ex-dividend': { st: 'No', eq: 'Not in the data' }, 'Dividend paid': { st: 'No', eq: 'Not in the data' },
  'Period': { st: 'Yes', eq: 'The quarter\u2019s end in the 10-Q or 10-K' },
  'Reported': { st: 'Partly', eq: 'The 10-Q\u2019s filing day, not the release\u2019s' },
  'Last split': { st: 'No', eq: 'None' },
  'Shares out': { st: 'Yes', eq: 'Shares outstanding from the 10-Q or 10-K cover page (share classes filed apart are missing: Alphabet)', v: (s, x) => x.sharesOut },
  'Book value/share': { st: 'Yes', eq: 'Equity over cover-page shares outstanding', v: (s, x) => (x.sharesOut && x.equity != null ? x.equity / x.sharesOut : null) },
  'Float': { st: 'No', eq: 'Once a year in dollars (10-K cover)' }, 'Short ratio': { st: 'No', eq: 'None' }, 'Short % float': { st: 'No', eq: 'None' }, 'Short % out': { st: 'No', eq: 'None (FINRA short interest is a separate source)' },
  'Insiders': { st: 'No', eq: 'None' }, 'Institutions': { st: 'No', eq: 'None (13F is a separate source)' },
  'Qual.': { st: 'Partly', eq: 'Its inputs, from the filings where they exist' },
};
// BEST SOURCE: worked out from the measures (bestOf below) except where the
// answer is a judgment, not a measurement. These say so in their reason.
const BEST = {

  'Dividend yield': ['Twelve Data', 'Forward, from the declared rate; the filings give trailing dividends.'], 'Dividend rate': ['Twelve Data', 'As Dividend yield.'],
  'Payout ratio': ['Twelve Data', 'Twelve Data\u2019s is on the declared dividend; the filings\u2019 is trailing. Either is defensible.'],
  'Shareholder yield': ['Twelve Data', 'Half is already from the filings (buybacks); the dividend half follows Dividend yield.'],
  'Period': ['Release', 'It names the newer quarter first: a median 1 day before the 10-Q and 6 days before Twelve Data.'],
  'Reported': ['Release', 'The day the results 8-K was filed is the report day.'],
  'Qual.': ['Follows its inputs', 'A score of ours; its source is whatever its inputs use.'],
};
// WHY TWELVE DATA PARTS FROM THE FILINGS, where it does, as traced while
// building this (the comments above say the same at more length): appended to
// the agreement figure so a reason names the cause, not just the number.
const DISAGREE = {
  'Revenue TTM': 'most of the rest is banks and insurers (net revenue against total)', 'Net income': 'non-controlling interests or preferred dividends in or out',
  'Gross profit': 'what each counts in cost of revenue', 'Gross margin': 'what each counts in cost of revenue', 'Profit margin': 'non-controlling interests in or out',
  'Trailing P/E': 'Twelve Data’s price is its own last pull, up to a week old', 'Live P/E': 'quarter EPS do not add exactly to a year’s',
  'EPS TTM': 'quarter EPS do not add exactly to a year’s', 'Earnings yield': 'quarter EPS do not add exactly to a year’s',
  'P/B': 'equity with or without non-controlling interests', 'P/S': 'as Revenue TTM', 'ROE': 'Twelve Data divides by average equity, the filings give the quarter end',
  'ROA': 'Twelve Data divides by average assets, the filings give the quarter end', 'Book value/share': 'diluted average against outstanding shares',
  'Rev grth Q YoY': 'restated year-earlier quarters, and banks’ revenue line', 'Earn grth Q YoY': 'no rate off a loss on our side; Twelve Data sometimes gives one',
  'Operating cash': 'restated cash flow statements', 'Cash': 'Twelve Data’s total includes short-term investments; the filing data’s cash line does not', 'P / op cash': 'as Operating cash', 'Current ratio': 'rounding',
};
// The timing the reasons quote, from release-compare.js (set before the loop).
let FILING = { median: null, p90: null };
const pctTxt = (m) => m.close + '% within ' + m.tol + (m.unit === 'pts' ? ' pt' : '%') + ' (median gap ' + m.median + (m.unit === 'pts' ? (m.median === 1 ? ' pt' : ' pts') : '%') + ')';
// The evidence, in words: the SEC data's coverage and its agreement with
// Twelve Data on the same quarter; the release's match with the 10-Q and how
// much sooner it comes.
function secEvidence(o) {
  if (o.sec.coverage == null) return '';
  return 'SEC filings carry it for ' + num(o.sec.coverage) + ' companies'
    + (o.sec.vsTd ? '; Twelve Data agrees on ' + pctTxt(o.sec.vsTd) + (DISAGREE[o.label] && o.sec.vsTd.close < 97 ? ', ' + DISAGREE[o.label] : '') : '') + '.';
}
function releaseEvidence(o) {
  if (o.status === 'No') return '';
  const parts = [];
  if (o.vs10q) parts.push('matches the 10-Q ' + o.vs10q.within05 + '% within 0.5%');
  if (FILING.median != null) parts.push('a median ' + FILING.median + ' day' + (FILING.median === 1 ? '' : 's') + ' before the 10-Q (' + FILING.p90 + ' for the slowest tenth)');
  return parts.length ? 'The release ' + parts.join(', ') + '.' : '';
}
function bestOf(o) {
  if (BEST[o.label]) {
    // A judgment, said in words, with the measures behind it where there are any.
    const ev = [];
    if (o.sec.vsTd) ev.push('SEC agrees with Twelve Data on ' + o.sec.vsTd.close + '%');
    if (o.vsTd) ev.push('the release on ' + o.vsTd.close + '%');
    return { source: BEST[o.label][0], why: BEST[o.label][1] + (ev.length ? ' Measured: ' + ev.join(', ') + '.' : '') };
  }
  // The owner's rule, where it applies: say what it would do today.
  if (o.rule) {
    const u = o.rule.used, a = o.rule.aside, tot = u.release + u.sec + u.td;
    const pc = (v) => (tot ? Math.round(100 * v / tot) : 0) + '%';
    const noTd = NO_TD_FALLBACK.has(o.label);
    const order = noTd ? 'Release → SEC' : o.status === 'Yes' && o.sec.status === 'Yes' ? 'Release → SEC → Twelve Data' : o.status === 'Yes' ? 'Release → Twelve Data' : 'SEC → Twelve Data';
    const out = (o.status === 'Yes' && o.sec.status !== 'Yes' ? ' The SEC line is on another definition, so it waits.' : '') + (o.sec.status === 'Yes' && o.status !== 'Yes' ? ' The release does not carry it on the same definition.' : '');
    const why = 'Today it would use the release for ' + num(u.release) + ' (' + pc(u.release) + '), the SEC data for ' + num(u.sec) + ' (' + pc(u.sec) + '), Twelve Data for ' + num(u.td) + ' (' + pc(u.td) + ').'
      + (a.waiting + a.scale + a.outvoted ? ' SEC set aside: ' + [a.waiting ? num(a.waiting) + ' not yet on the release’s quarter' : '', a.scale ? num(a.scale) + ' failed the scale check' : '', a.outvoted ? num(a.outvoted) + ' outvoted by the release and Twelve Data' : ''].filter(Boolean).join(', ') + '.' : '')
      + out + (noTd ? ' The owner chose operating cash flow less capex (2026-10-29); Twelve Data\u2019s levered figure is another measure, so it is no fallback and a company neither filing source covers is left blank (' + num(u.none) + ' today).' : '') + ' ' + (o.sec.vsTd && !noTd ? 'SEC and Twelve Data agree on ' + o.sec.vsTd.close + '% on the same quarter' + (DISAGREE[o.label] && o.sec.vsTd.close < 97 ? ' (' + DISAGREE[o.label] + ')' : '') + '. ' : '') + releaseEvidence(o);
    return { source: order, why: why.trim() };
  }
  const td = o.coverage ? o.coverage.td : null;
  const secOk = o.sec.status === 'Yes' && o.sec.coverage != null && td != null && o.sec.coverage >= 0.8 * td;
  const relOk = o.status === 'Yes' && o.coverage && td != null && o.coverage.rel >= 0.8 * td;
  if (secOk) return { source: o.status === 'Yes' ? 'SEC filings, release first' : 'SEC filings',
    why: 'The filing itself, so exact. ' + secEvidence(o) + (o.status === 'Yes' ? ' ' + releaseEvidence(o) + ' Use it until the 10-Q is in.' : '') };
  if (o.sec.status === 'Yes' && o.sec.coverage != null && td) return { source: 'SEC filings, Twelve Data where missing',
    why: 'The filing itself, so exact, but for ' + num(o.sec.coverage) + ' of ' + num(td) + ' companies; Twelve Data for the rest. ' + secEvidence(o).replace(/^SEC filings carry it for [\d,]+ companies; /, '') };
  if (relOk) return { source: 'Release', why: 'The release carries it for ' + num(o.coverage.rel) + ' companies. ' + releaseEvidence(o) };
  if (o.status === 'No' && o.sec.status === 'No') return { source: 'Twelve Data', why: 'The only source: neither the release nor the filing data has it.' };
  return { source: 'Twelve Data', why: 'The filing sources have it only in part or on another definition. ' + (secEvidence(o) || releaseEvidence(o)) };
}
const num = (v) => Number(v).toLocaleString('en-US');
const kindMoney = (k) => k === 'money' || k === 'mult';
// Twelve Data on another definition is no fallback: free cash flow (levered), and total debt and all built on it (its total counts leases; the owner chose borrowings, leases apart).
const NO_TD_FALLBACK = new Set(['FCF TTM', 'FCF margin', 'FCF yield', 'Debt', 'Net cash', 'Net cash / share', 'Debt / equity', 'Net cash %', 'Enterprise value', 'EV / sales', 'EV/EBITDA']);

// ---- THE PROPOSALS (2026-10-29, the owner: "I want you propose everything in
// this page ... If a new data item needs to be extracted highlight that also")
// --------------------------------------------------------------------------
// One period rule for the whole screener, then each column: the period it
// measures today, the period it should, the header text (DISPLAY ONLY: the
// FIELD_SPEC label is the stored group|label key of tiles and the phone and is
// never renamed), what to change, and any NEW DATA it would need extracted
// (`ex`, an id into EXTRACT below). Nothing here is done; it is a plan for the
// owner. Signal inputs say so: their source is the owner's decision.
const PERIOD = { ttm: 'Twelve months', q: 'Quarter, on a year earlier', qe: 'At quarter end', today: 'Today', fwd: 'Forward (next twelve months)', date: 'A date', latest: 'Latest reported', score: 'Our score', mixed: 'Mixed' };
const EXTRACT = {
  da: { item: 'Depreciation and amortization', from: 'SEC data: add the concept to secfacts.js (DepreciationDepletionAndAmortization, DepreciationAndAmortization), then one re-read of every company (sec-reread.js); the release\u2019s cash flow statement for the 10-Q gap', cost: 'No API credits: about 1,150 SEC fetches, one at a time. The release side adds a field to the second request (about $8 to backfill since July 2025).', unlocks: 'EBITDA, EV/EBITDA' },
  shout: { item: 'Shares outstanding (the 10-Q and 10-K cover page)', from: 'SEC data: dei:EntityCommonStockSharesOutstanding, added to secfacts.js, one re-read', cost: 'No API credits: one SEC re-read.', unlocks: 'Market cap, Shares out, Book value/share, Net cash / share, Short % out' },
  sti: { item: 'Short-term investments', from: 'SEC data: ShortTermInvestments, MarketableSecuritiesCurrent, AvailableForSaleSecuritiesDebtSecuritiesCurrent, added to secfacts.js, one re-read (the release already gives it)', cost: 'No API credits: one SEC re-read.', unlocks: 'Cash on the same footing as Twelve Data\u2019s total cash, Net cash' },
  debt: { item: 'The rest of the debt lines', from: 'SEC data: LongTermDebtCurrent, ShortTermBorrowings, CommercialPaper (and finance lease liabilities, kept apart), added to secfacts.js, one re-read. Today the stored debt is long-term debt only (LongTermDebtNoncurrent)', cost: 'No API credits: one SEC re-read.', unlocks: 'One defined total debt: Debt, Net cash, Debt / equity, Enterprise value and the multiples on it' },
  divdecl: { item: 'The dividend declared per share, with its record and payment dates', from: 'The release (many announce the next dividend), added to the second request; a separate dividend 8-K otherwise', cost: 'About $8 to backfill the releases since July 2025; a few cents a day after that.', unlocks: 'Forward Dividend yield and Dividend rate, Ex-dividend and Dividend paid dates' },
  emp: { item: 'Employees', from: 'SEC data: dei:EntityNumberOfEmployees where a filer tags it (few do); otherwise the 10-K text, once a year', cost: 'Coverage uncertain; measure before building.', unlocks: 'Revenue / employee' },
  banknet: { item: 'Banks\u2019 and insurers\u2019 net revenue', from: 'SEC data: RevenuesNetOfInterestExpense (and the banks\u2019 own net revenue tags), added to secfacts.js ahead of the total for financial companies, one re-read. The release already headlines it', cost: 'No API credits: one SEC re-read.', unlocks: 'Revenue TTM, P/S, Rev growth and the margins for banks and insurers, on the owner\u2019s definition (net revenue, 2026-10-29)' },
  float: { item: 'Public float', from: 'SEC data: dei:EntityPublicFloat on the 10-K cover, once a year, in dollars', cost: 'No API credits; but annual and in dollars, so a poor substitute.', unlocks: 'Float, Short % float (only roughly)' },
};
const P = (now, to, header, text, ex) => ({ now, to, header, text, ex: ex || null });
const SIG = ' A Signal input: changing its source is the owner\u2019s decision.';
const PROPOSE = {
  'Market Cap': P('today', 'today', 'Market cap', 'Keep Twelve Data until shares outstanding are extracted; then price \u00d7 the cover-page count is an exact alternative.' + SIG, 'shout'),
  'Revenue TTM': P('ttm', 'ttm', 'Revenue TTM', 'Banks and insurers: net revenue (the owner, 2026-10-29), which needs the SEC concept extracted. By the owner\u2019s rule: the release, then the SEC data once it has the quarter, Twelve Data as fallback.', 'banknet'),
  'Gross profit': P('ttm', 'ttm', 'Gross profit TTM', 'Say TTM in the header. By the owner\u2019s rule: the release, then the SEC data once it has the quarter, Twelve Data as fallback. Gross profit is printed in 44% of releases, so the SEC data and Twelve Data carry more of it.'),
  'Net income': P('ttm', 'ttm', 'Net income TTM', 'Say TTM in the header. By the owner\u2019s rule: the release, then the SEC data once it has the quarter, Twelve Data as fallback. Say \u201cattributable to the company\u201d in the hover.' + SIG),
  'FCF TTM': P('ttm', 'ttm', 'FCF TTM', 'Decided 2026-10-29: operating cash flow less capex, by the owner’s rule from the release and the SEC data. Twelve Data’s levered figure is another measure, so it is no fallback: a company neither covers (banks and insurers mostly) shows a dash.' + SIG),
  'EBITDA': P('ttm', 'ttm', 'EBITDA TTM', 'Build it as operating income plus depreciation and amortization from the filings, twelve months; until then keep Twelve Data. The companies\u2019 adjusted EBITDA stays a release-only figure, labelled as theirs.', 'da'),
  'Operating cash': P('ttm', 'ttm', 'Op. cash flow TTM', 'Say TTM. By the owner\u2019s rule: the release, then the SEC data once it has the quarter, Twelve Data as fallback. About 40% of releases print a cash flow statement, so the SEC data carries most of it.'),
  'Revenue / employee': P('ttm', 'ttm', 'Revenue / employee', 'Keep Twelve Data\u2019s head count unless a filing source covers enough companies.', 'emp'),
  'Enterprise value': P('today', 'today', 'Enterprise value', 'Keep Twelve Data until the debt lines are extracted; then market value + total debt \u2212 cash and short-term investments from the filings.', 'debt'),
  'Fwd P/E': P('fwd', 'fwd', 'Fwd P/E', 'Keep Twelve Data: analysts\u2019 estimates have no filing source. Say \u201cnext twelve months\u201d in the hover.' + SIG),
  'Trailing P/E': P('ttm', 'ttm', 'Trailing P/E', 'Merge with Live P/E or drop: Twelve Data\u2019s uses its own week-old price. Live P/E on the SEC\u2019s twelve-month EPS says the same thing better.'),
  'Live P/E': P('ttm', 'ttm', 'P/E (TTM, today\u2019s price)', 'Today\u2019s price over twelve-month diluted EPS. By the owner\u2019s rule: the release, then the SEC data once it has the quarter, Twelve Data as fallback.'),
  'P/E vs peers': P('fwd', 'fwd', 'Fwd P/E vs peers', 'Keep; say forward in the header, as it is built on forward P/E.'),
  'PEG': P('fwd', 'fwd', 'PEG', 'Keep Twelve Data: forecast growth.'),
  'P/B': P('qe', 'qe', 'P/B', 'Market value over equity at quarter end from the SEC (release first). Say \u201cbook at quarter end\u201d in the hover.'),
  'P/S': P('ttm', 'ttm', 'P/S (TTM)', 'Market value over SEC twelve-month revenue.'),
  'EV / sales': P('ttm', 'ttm', 'EV / sales (TTM)', 'After the debt lines: filing enterprise value over SEC twelve-month revenue.', 'debt'),
  'EV/EBITDA': P('ttm', 'ttm', 'EV / EBITDA (TTM)', 'After depreciation and the debt lines: both from the filings.', 'da'),
  'P / op cash': P('ttm', 'ttm', 'P / op cash (TTM)', 'Market value over SEC twelve-month operating cash flow.'),
  'Earnings yield': P('ttm', 'ttm', 'Earnings yield (TTM)', 'SEC twelve-month EPS over today\u2019s price.'),
  'FCF yield': P('ttm', 'ttm', 'FCF yield (TTM)', 'Decided 2026-10-29: operating cash flow less capex, by the owner’s rule from the release and the SEC data. Twelve Data’s levered figure is another measure, so it is no fallback: a company neither covers (banks and insurers mostly) shows a dash.'),
  'Gross margin': P('ttm', 'ttm', 'Gross margin TTM', 'Say TTM. SEC where it carries gross profit or cost of revenue; Twelve Data for the rest.' + SIG),
  'Operating margin': P('mixed', 'ttm', 'Op. margin TTM', 'FIX: Twelve Data\u2019s is mostly the latest quarter\u2019s, beside twelve-month gross and profit margins. Make it twelve months. By the owner\u2019s rule: the release, then the SEC data once it has the quarter, Twelve Data as fallback. The values will move. Not a Signal input.'),
  'Profit margin': P('ttm', 'ttm', 'Profit margin TTM', 'Say TTM. By the owner\u2019s rule: the release, then the SEC data once it has the quarter, Twelve Data as fallback.' + SIG),
  'FCF margin': P('ttm', 'ttm', 'FCF margin TTM', 'Decided 2026-10-29: operating cash flow less capex, by the owner’s rule from the release and the SEC data. Twelve Data’s levered figure is another measure, so it is no fallback: a company neither covers (banks and insurers mostly) shows a dash.' + SIG),
  'ROE': P('ttm', 'ttm', 'ROE (TTM, avg equity)', 'Twelve-month net income over AVERAGE equity (this quarter end and the same quarter a year earlier, both stored in the SEC data), to match the usual definition.' + SIG),
  'ROA': P('ttm', 'ttm', 'ROA (TTM, avg assets)', 'As ROE, over average total assets.'),
  'Rev grth Q YoY': P('q', 'q', 'Rev growth (Q on Q a year ago)', 'Keep the quarter. By the owner\u2019s rule: the release, then the SEC data once it has the quarter, Twelve Data as fallback. Growth from the release\u2019s own two columns, which share one basis.' + SIG),
  'Earn grth Q YoY': P('q', 'q', 'Net income growth (Q on Q a year ago)', 'Keep the quarter; name it net income growth, which is what both sides measure. By the owner\u2019s rule: the release, then the SEC data once it has the quarter, Twelve Data as fallback.' + SIG),
  'EPS TTM': P('ttm', 'ttm', 'EPS TTM (diluted)', 'By the owner\u2019s rule: the release, then the SEC data once it has the quarter, Twelve Data as fallback. The SEC side: four quarters, or the year, or last year plus this year to date less last year\u2019s.'),
  'Cash': P('qe', 'qe', 'Cash + ST inv. (Q end)', 'Say \u201cat quarter end\u201d and whether short-term investments are in. After extracting them, the SEC total; the release has it already.', 'sti'),
  'Debt': P('qe', 'qe', 'Total debt (Q end)', 'Define total debt once (current + long-term borrowings, leases apart), extract the missing lines, then take it from the filings everywhere.', 'debt'),
  'Net cash': P('qe', 'qe', 'Net cash (Q end)', 'Follows Cash and Debt.', 'debt'),
  'Net cash / share': P('qe', 'qe', 'Net cash / share (Q end)', 'Follows Cash and Debt, over cover-page shares.', 'shout'),
  'Debt / equity': P('qe', 'qe', 'Debt / equity (Q end)', 'Follows Debt; show it as a ratio (0.78), not Twelve Data\u2019s percent (78).', 'debt'),
  'Current ratio': P('qe', 'qe', 'Current ratio (Q end)', 'SEC current assets over current liabilities (96.8% already agree); Twelve Data for banks and insurers, which do not split them.'),
  'Net cash %': P('qe', 'qe', 'Net cash % of mkt cap', 'Follows Net cash.', 'debt'),
  'Dividend yield': P('fwd', 'fwd', 'Dividend yield (forward)', 'Keep Twelve Data\u2019s forward rate unless the declared dividend is extracted from the releases; a trailing yield from the SEC could sit beside it as its own column.', 'divdecl'),
  'Payout ratio': P('ttm', 'ttm', 'Payout ratio (TTM)', 'SEC dividends paid over net income, twelve months, or keep Twelve Data\u2019s; say which in the hover.'),
  'Shareholder yield': P('mixed', 'ttm', 'Shareholder yield (TTM)', 'Make both halves twelve months from the filings (dividends paid and buybacks), so it is one period, not forward plus trailing.'),
  'Dividend rate': P('fwd', 'fwd', 'Dividend rate (forward)', 'As Dividend yield.', 'divdecl'),
  'Ex-dividend': P('date', 'date', 'Ex-dividend', 'Keep Twelve Data unless the declared-dividend dates are extracted.', 'divdecl'),
  'Dividend paid': P('date', 'date', 'Dividend paid', 'As Ex-dividend.', 'divdecl'),
  'Period': P('date', 'date', 'Figures to', 'Take the newest quarter from the release; it names it first.'),
  'Reported': P('date', 'date', 'Last results out', 'The results 8-K\u2019s filing day. Not read by the Signal; its next-report estimate is fed by it.'),
  'Last split': P('date', 'date', 'Last split', 'Keep Twelve Data.'),
  'Shares out': P('latest', 'latest', 'Shares out', 'After extracting the cover-page count, take it from the filings; keep the quarter\u2019s diluted average apart.', 'shout'),
  'Book value/share': P('qe', 'qe', 'Book value / share (Q end)', 'Equity at quarter end over cover-page shares.', 'shout'),
  'Float': P('latest', 'latest', 'Float', 'Keep Twelve Data: the filings give float once a year in dollars.', 'float'),
  'Short ratio': P('latest', 'latest', 'Short ratio', 'Keep Twelve Data, or use FINRA short interest (already read) over average volume.'),
  'Short % float': P('latest', 'latest', 'Short % float', 'Keep Twelve Data: needs float.' + SIG),
  'Short % out': P('latest', 'latest', 'Short % out', 'FINRA short interest (already read) over cover-page shares outstanding.', 'shout'),
  'Insiders': P('latest', 'latest', 'Insiders %', 'Keep Twelve Data.'),
  'Institutions': P('latest', 'latest', 'Institutions %', 'Keep Twelve Data, or 13F shares (already loaded) over cover-page shares, quarterly.', 'shout'),
  'Qual.': P('score', 'score', 'Qual.', 'Moves with its inputs; no change of its own.' + SIG),
};
// The plan in order, for the panel above the table.

// ---- REFINED AFTER TRADINGVIEW (2026-10-29, the owner: "look at what Trading
// view has done ... and refine your thoughts", "May be we should regroup the
// columns too") ------------------------------------------------------------
// What was read: TradingView's help page on the stock screener (twelve column
// sets) and its screener's field list (scanner.tradingview.com metainfo, 3,786
// fields, read 2026-10-29), where every financial field carries its period.
const TRADINGVIEW = [
  { t: 'Columns grouped by statement', d: 'Twelve column sets: Overview, Performance, Technicals, Extended hours, Forecasts, Valuation, Dividends, Profitability, Income statement, Balance sheet, Cash flow, Per share. A reader finds a figure where the financial statements put it.' },
  { t: 'Every financial column carries its period', d: 'Fields are named by period (total_revenue_ttm, _fq for the fiscal quarter, _fh for the fiscal half, _fy for the year, price_earnings_current, dividend_amount_upcoming), and each screener column has a period selector: TTM, quarterly, semiannual, annual.' },
  { t: 'Half-yearly reporters are first-class', d: 'The _fh fields keep companies that report twice a year (foreign filers such as Rio Tinto) on a period they actually report, rather than a quarter they do not have.' },
  { t: 'Forecasts are a set of their own', d: 'Estimates (EPS, revenue, EBITDA, free cash flow, next twelve months) sit apart from reported figures, so a forward number is never read as a reported one.' },
  { t: 'More of each statement', d: 'Operating income, EBITDA and its margin, capex, ROIC, interest cover and per-share and per-employee versions sit beside the headline lines.' },
];
// What we take from it: our columns keep ONE period each (a selector per
// column is a larger build and splits the stored keys), stated in the header.
const PERIOD_TAG = { ttm: 'TTM', q: 'Q YoY', qe: 'Q end', today: 'Now', fwd: 'Fwd', date: '', latest: '', score: '', mixed: 'TTM' };
// THE GROUPS, proposed: by statement, as TradingView sets them, keeping our
// group ids where a group survives (ids are stored keys and never renamed)
// and adding new ids only where a group is new. Moving a field between groups
// changes its group|label key: every move goes into FIELD_KEY_MOVED
// (server.js), as the 2026-10 split of the fundamentals group did for 48 keys.
const GROUPS = [
  { id: 'info', name: 'Overview', period: 'Now', from: 'Info, unchanged (Market cap stays here)', note: 'Name, price, classification, size band, news, next report.' },
  { id: 'act', name: 'Signal', period: '', from: 'Signal and Scores (Qual.) together', note: 'The verdict and the score it reads, side by side.' },
  { id: 'short', name: 'Performance', period: 'Price', from: 'Short-term %, Long-term % and Forward, kept as three ids side by side', note: 'Returns over every horizon in one run.' },
  { id: 'trend', name: 'Technicals', period: 'Price', from: 'Trend, Range and level, Risk, side by side', note: 'Moving averages, oscillators, range, volatility and drawdown.' },
  { id: 'value', name: 'Valuation', period: 'Now (price) over TTM', from: 'Valuation, plus Enterprise value from Scale', note: 'Every multiple: price over a twelve-month figure, or book at quarter end.' },
  { id: 'size', name: 'Income statement \u00b7 TTM', period: 'TTM', from: 'Scale, less Enterprise value and the cash flow lines; plus EPS TTM from Growth; plus Operating income TTM (new column)', note: 'Revenue, gross profit, operating income, EBITDA, net income, diluted EPS, revenue per employee.' },
  { id: 'profit', name: 'Profitability \u00b7 TTM', period: 'TTM', from: 'Profitability, Operating margin made twelve months', note: 'Margins, ROE and ROA on average equity and assets, margin change.' },
  { id: 'growth', name: 'Growth \u00b7 Q YoY', period: 'Q YoY', from: 'Growth, less EPS TTM', note: 'The quarter against the same quarter a year earlier (the half for half-yearly reporters).' },
  { id: 'finpos', name: 'Balance sheet \u00b7 Q end', period: 'Q end', from: 'Financial position, plus Book value/share from Ownership and Interest cover from Long run', note: 'Cash and short-term investments, total debt, net cash, working capital, ratios, book value per share.' },
  { id: 'cflow', name: 'Cash flow \u00b7 TTM (new id)', period: 'TTM', from: 'Operating cash and FCF TTM from Scale; FCF margin and FCF yield stay where they are; plus Capex TTM (new column)', note: 'Operating cash flow, capex, free cash flow. A new group id: ids are never renamed, new ones may be added.' },
  { id: 'divs', name: 'Dividends and returns', period: 'Fwd and TTM, each said', from: 'Unchanged', note: 'Forward yield and rate (or the declared dividend from the releases), trailing payout, buyback and shareholder yield.' },
  { id: 'aier', name: 'Latest quarter \u00b7 from the release', period: 'Q (and Q YoY)', from: 'Last Earning AI Extracted, renamed in the banner only', note: 'The newest quarter as the company reported it, the day it reports: the one group that is a single quarter by design.' },
  { id: 'fwd', name: 'Forecasts (Forward, Fwd P/E, PEG)', period: 'Fwd', from: 'Fwd P/E, PEG and P/E vs peers could sit together here, as TradingView sets estimates apart', note: 'Optional: today they sit in Valuation, labelled Fwd.' },
  { id: 'report', name: 'Reporting', period: 'Dates', from: 'Unchanged', note: 'Which quarter the figures describe, when results came out, what is stale.' },
  { id: 'own', name: 'Ownership', period: 'Latest', from: 'Ownership, less Book value/share', note: 'Shares, float, short interest, insiders, institutions, 13F, options.' },
  { id: 'lrun', name: 'Long run', period: '3, 5, 10 years', from: 'Unchanged, less Interest cover', note: 'Growth and records over years, from the filings.' },
  { id: 'react', name: 'Reactions', period: 'Events', from: 'Unchanged', note: 'Selloffs, rallies, short build, insiders, 8-Ks.' },
];
// Where each Twelve Data column would sit (by FIELD_SPEC label).
const GROUP_OF = {
  'Market Cap': 'Overview', 'Revenue TTM': 'Income statement', 'Gross profit': 'Income statement', 'Net income': 'Income statement', 'EBITDA': 'Income statement', 'Revenue / employee': 'Income statement', 'EPS TTM': 'Income statement',
  'FCF TTM': 'Cash flow', 'Operating cash': 'Cash flow', 'Enterprise value': 'Valuation', 'Book value/share': 'Balance sheet',
};
const MOVED = new Set(['FCF TTM', 'Operating cash', 'EPS TTM', 'Enterprise value', 'Book value/share']);   // done 2026-10-29, the screener table
const groupFor = (label, group) => GROUP_OF[label] || ({ Valuation: 'Valuation', Profitability: 'Profitability', Growth: 'Growth', 'Financial position': 'Balance sheet', 'Dividends and returns': 'Dividends and returns', Reporting: 'Reporting', Ownership: 'Ownership', Scores: 'Signal', Info: 'Overview', Scale: 'Income statement' })[group] || group;
// Columns TradingView has and the screener does not, worth adding.
const ADDITIONS = [
  { label: 'Operating income \u00b7 TTM', group: 'Income statement', from: 'SEC data four quarters, the release first; stored already', extract: null },
  { label: 'Capex \u00b7 TTM', group: 'Cash flow', from: 'SEC data four quarters (stored already); the release where its cash flow statement has it', extract: null },
  { label: 'EBITDA margin \u00b7 TTM', group: 'Profitability', from: 'Operating income plus depreciation over revenue', extract: 'da' },
  { label: 'ROIC \u00b7 TTM', group: 'Profitability', from: 'Operating income after tax over debt plus equity less cash', extract: 'debt' },
  { label: 'Interest cover \u00b7 TTM', group: 'Balance sheet', from: 'Operating income over interest expense, four quarters (the Long run column is ten years of annual reports)', extract: null },
  { label: 'FCF per share \u00b7 TTM', group: 'Cash flow', from: 'Free cash flow over cover-page shares', extract: 'shout' },
];
const PLAN = [
  { t: 'Regroup the stock page, hover card, phone and tiles the same way', d: 'The field catalogue (FIELD_SPEC) into the same groups as the screener, saved tile and phone setups carried to the new keys through FIELD_KEY_MOVED.', status: 'done', note: 'Done 2026-10-29: FIELD_SPEC regrouped (Cash flow group; EPS TTM into Income statement; Enterprise value into Valuation; Book value/share into Balance sheet; Trend beside Range and level). Saved tile and phone setups carried through FIELD_KEY_MOVED, five new entries.' },
  { t: 'Banks\u2019 revenue on one line', d: 'Net revenue for banks and insurers, from the release and, once extracted, the SEC data\u2019s net revenue concept.', status: 'decided', note: 'Decided 2026-10-29: net revenue.' },
  { t: 'Regroup the screener by statement', d: 'As TradingView does: Overview, Signal, Performance, Technicals, Valuation, Income statement, Profitability, Growth, Balance sheet, a new Cash flow group, Dividends, Latest quarter (the release group), Reporting, Ownership, Long run, Reactions. Group ids stay; moved fields go into FIELD_KEY_MOVED so saved tiles and phone setups follow them.', status: 'done', note: 'Done 2026-10-29 in the screener table: Trend beside Range and level, Income statement \u00b7 TTM (EPS TTM moved in), a new Cash flow \u00b7 TTM group (Op cash and FCF TTM moved in), Growth \u00b7 Q YoY, Balance sheet \u00b7 Q end, Latest quarter \u00b7 from the release. Not yet: the stock page and hover-card catalogue (FIELD_SPEC, whose keys back saved tiles and phone setups), Qual. into Signal, a Forecasts group.' },
  { t: 'One period a column, said in its header', d: 'A period tag on every header, TradingView-style: TTM, Q YoY, Q end, Now, Fwd. The group banner says the group\u2019s period too (Income statement \u00b7 TTM). Display text only; stored keys keep their names. A per-column period selector, as TradingView has, is a larger build and is left out.', status: 'done', note: 'Done 2026-10-29: a period tag under the name of all 39 company-figure columns (Op margin says latest Q until it is fixed), and the period in the group banners. Header text only; no stored key changed.' },
  { t: 'Half-yearly reporters on their own period', d: 'Twelve months from the halves (the SEC data\u2019s H and FY rows already allow it) and growth on the half a year earlier, marked as half-yearly in the hover, instead of a quarter they do not report.', status: 'open' },
  { t: 'Fix Operating margin', d: 'Twelve months, by the owner’s rule; Twelve Data’s is mostly one quarter’s. Not a Signal input.', status: 'done', note: 'Done 2026-10-29 with the display columns (sourcerule.js): operating income over revenue, four quarters, for 900 companies; Twelve Data’s quarter where neither the release nor the filings give four quarters. The header says TTM.' },
  { t: 'Statement figures by the owner\u2019s rule', d: 'The release while it is the newest, the SEC data once it has the quarter and is dependable (restatements included), Twelve Data where neither is (docs/context/data-sources.md). Each row shows what the rule would use today. Display first; Signal inputs wait for the owner.', status: 'done', note: 'Built 2026-10-29 for the display columns the Signal does not read (sourcerule.js; the cell’s hover names the source and gives Twelve Data’s figure). Next, with the owner: the Signal inputs (net income, free cash flow, margins, ROE, growth).' },
  { t: 'Decide the free cash flow measure', d: 'Levered (Twelve Data) or operating cash flow less capex (the filings). Three columns and two Signal inputs follow it.', status: 'decided', note: 'Decided 2026-10-29: operating cash flow less capex.' },
  { t: 'Define total debt once', d: 'Current and long-term borrowings, leases apart, from the filings. Needs the missing debt lines extracted.', status: 'decided', note: 'Decided 2026-10-29: borrowings, leases apart; waits for the SEC debt lines.' },
  { t: 'Add the missing statement columns', d: 'Operating income, capex, interest cover (from data already stored); EBITDA margin, ROIC and FCF per share once their new data is extracted. Listed below.', status: 'open' },
  { t: 'Extract the new data items', d: 'Highlighted in the table and listed below: most are SEC concepts (no API credits), one is a release field.', status: 'done', note: 'SEC items done 2026-10-29 (secfacts.js, one re-read of every company): depreciation, cover-page shares outstanding, short-term investments, the debt lines, banks’ net revenue, employees, public float. Open: the declared dividend from the releases.' },
];

// THE DECISIONS, dated, newest first (the owner, 2026-10-29: "Always keep the
// HTML updated in future when it comes of these decisions or changes"). Every
// decision or change to the data sources, the periods, the groups or the
// definitions adds a line here in the same commit, and its PLAN step's status.
const DECISIONS = [
  { d: '2026-10-29', who: 'Built', t: 'The display columns on the owner’s rule', x: 'Revenue, gross profit, operating cash flow and EPS (twelve months, a quarter at a time), operating margin (now twelve months), cash, debt, net cash, debt to equity, current ratio, book value per share, shares outstanding, P/S, P/B, enterprise value, EV/EBITDA, net cash %; and what follows from them (live P/E, earnings yield, EV/sales, P/op cash, net cash per share). 1,153 companies; the hover says which source and what Twelve Data said. Dependable, as built: a quarter more than a tenth off its release is disputed and Twelve Data settles which; a later filing (a restatement) wins; an unconfirmed figure more than half again or under two thirds of Twelve Data’s is not used; twenty times off is a unit, never used. Same quarter as Twelve Data: revenue agrees 91.5%, operating cash flow 98.5%, current ratio 99%, shares 93%. The Signal inputs stay on Twelve Data; EBITDA too (another definition). The debt family is blank where neither source gives the lines (235 to 300 companies).' },
  { d: '2026-10-29', who: 'Built', t: 'Banks’ net revenue: the second re-read', x: 'Net revenue built from net interest income plus non-interest income where the direct tag is missing; every company re-read again, no API credits. Now 49 of 153 financial companies: every one that files both lines (Wells Fargo Q3 $21.87B, as released). The rest (insurers, card networks, asset managers, exchanges, Citi, Berkshire, Schwab) headline total revenue, which the rule uses for them.' },
  { d: '2026-10-29', who: 'Built', t: 'The new SEC data items extracted', x: 'Depreciation and amortization, banks’ net revenue, short-term investments, the debt lines (total debt to the owner’s definition, leases apart), and from the cover page shares outstanding, employees and public float; every company re-read once, no API credits. Debt and all built on it, cash, EBITDA, shares outstanding and market cap now follow the owner’s rule on this page. Open: the declared dividend.' },
  { d: '2026-10-29', who: 'Built', t: 'The stock page, hover card, phone and tiles regrouped', x: 'The same groups as the screener. Five field keys moved (size|FCF TTM, size|Operating cash, growth|EPS TTM, size|Enterprise value, own|Book value/share); saved tile and phone setups follow them through FIELD_KEY_MOVED. Neither saved setup in production used a moved key.' },
  { d: '2026-10-29', who: 'Owner', t: 'Free cash flow is operating cash flow less capex', x: 'Not Twelve Data\u2019s levered figure. The FCF columns run release \u2192 SEC; Twelve Data\u2019s figure is another measure, so it is no fallback. The Signal\u2019s two free cash flow inputs stay on Twelve Data until the owner decides the Signal separately.' },
  { d: '2026-10-29', who: 'Owner', t: 'Total debt is borrowings, leases apart', x: 'Short-term borrowings, commercial paper, current and long-term debt; lease liabilities excluded. Needs the missing SEC debt lines extracted.' },
  { d: '2026-10-29', who: 'Owner', t: 'Banks\u2019 revenue is net revenue', x: 'What banks and insurers headline. The release has it; the SEC data needs its net revenue concept extracted.' },
  { d: '2026-10-29', who: 'Owner', t: 'Regroup the stock page, hover card, phone and tiles too', x: 'One grouping everywhere. Their groups are part of stored keys, so saved tile and phone setups are carried to the new keys through the key-move list.' },
  { d: '2026-10-29', who: 'Owner', t: 'Step 1 approved and built: the period tags and the regrouping', x: 'In the screener table. The stock page and hover-card catalogue keep the earlier groups for now: moving them changes the stored keys of saved tiles and phone setups.' },
  { d: '2026-10-29', who: 'Owner', t: 'The source rule', x: 'The release while it is the newest; the SEC data once it has the quarter and is dependable (restatements included); Twelve Data where neither is. docs/context/data-sources.md.' },
  { d: '2026-10-29', who: 'Owner', t: 'Keep this page current', x: 'Every decision or change to the data sources updates this page in the same piece of work.' },
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
  // The SEC quarters: each period's latest filing, quarters only, from mid-2024.
  const secBy = new Map(), secOther = new Map();
  for (const q of db.prepare("select * from sec_facts where period_type in ('Q', 'FY', 'H', '9M') and period_end >= '2024-01-01' and form in ('10-Q', '10-K', '10-Q/A', '10-K/A') order by symbol, period_end, filed").all()) {
    const into = q.period_type === 'Q' ? secBy : secOther;
    if (!into.has(q.symbol)) into.set(q.symbol, []);
    const l = into.get(q.symbol);
    const prev = l[l.length - 1];
    if (prev && prev.period_type === q.period_type && Math.abs(t(prev.period_end) - t(q.period_end)) <= 7 * DAY) l[l.length - 1] = q; else l.push(q);
  }
  const sctx = new Map();
  for (const s of rows) { const x = secContext(secBy.get(s.symbol), secOther.get(s.symbol)); if (x) sctx.set(s.symbol, x); }
  // How far each new SEC item reaches (2026-10-29): companies with a value in their newest quarter (twelve months for EBITDA; the newest 10-K for the float).
  const fin = rows.filter((s) => finSector(s) && sctx.has(s.symbol));
  const COVERED = {
    da: [...sctx.values()].filter((x) => x.ttm.ebitda != null).length,
    shout: [...sctx.values()].filter((x) => x.sharesOut).length,
    sti: [...sctx.values()].filter((x) => x.last.short_term_investments != null).length,
    debt: [...sctx.values()].filter((x) => x.totalDebt != null).length,
    banknet: fin.filter((s) => sctx.get(s.symbol).ttm.netRevenue != null).length + ' of ' + fin.length + ' financial companies (every bank filing both lines; the rest headline total revenue)',
    emp: [...sctx.values()].filter((x) => x.employees).length,
    float: [...secOther.values()].filter((l) => l.some((r) => r.period_type === 'FY' && r.public_float != null && (Date.now() - t(r.period_end)) / DAY < 450)).length,
  };
  const ctx = new Map();
  for (const s of rows) { const c = context(rel.get(s.symbol) || []); if (c) ctx.set(s.symbol, c); }
  { const d = (cmp.timing || []).map((x) => x.d).sort((a, b) => a - b); if (d.length) FILING = { median: d[d.length >> 1], p90: d[Math.floor(0.9 * d.length)] }; }
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
    // The SEC side: coverage, and against Twelve Data where Twelve Data's
    // newest quarter is the filings' (its most recent quarter within a week).
    const sm = SEC[col.label] || { st: 'No', eq: 'None' };
    o.sec = { status: sm.st, equivalent: sm.eq, coverage: null, vsTd: null };
    if (sm.v) {
      let secN = 0; const gaps = [];
      for (const s of rows) {
        const x = sctx.get(s.symbol); if (!x) continue;
        const b = sm.v(s, x); if (b == null) continue;
        secN++;
        const a = col.td ? col.td(s) : null; if (a == null) continue;
        if (!s.mostRecentQuarter || Math.abs(t(x.last.period_end) - t(s.mostRecentQuarter)) > 7 * DAY) continue;
        gaps.push(col.kind === 'pct' ? Math.abs(b - a) : Math.abs(b - a) / Math.max(Math.abs(a), 1e-9) * 100);
      }
      gaps.sort((x, y) => x - y);
      const tol = col.kind === 'pct' ? 1 : 2;
      o.sec.coverage = secN;
      // Against the release on the same quarter: the fair test where Twelve
      // Data's definition differs (debt: it counts leases).
      if (col.relv) {
        const g2 = [];
        for (const s of rows) { const x = sctx.get(s.symbol), c = ctx.get(s.symbol); if (!x || !c) continue; if (Math.abs(t(x.last.period_end) - t(c.r.period_end)) > 7 * DAY) continue; const a = col.relv(s, c), b = sm.v(s, x); if (a == null || b == null) continue; g2.push(col.kind === 'pct' ? Math.abs(b - a) : Math.abs(b - a) / Math.max(Math.abs(a), 1e-9) * 100); }
        g2.sort((p, q) => p - q);
        o.sec.vsRel = g2.length ? { n: g2.length, close: Math.round(1000 * g2.filter((g) => g <= tol).length / g2.length) / 10, median: Math.round(g2[g2.length >> 1] * 10) / 10, unit: col.kind === 'pct' ? 'pts' : '%', tol } : null;
      }
      o.sec.vsTd = gaps.length ? { n: gaps.length, close: Math.round(1000 * gaps.filter((g) => g <= tol).length / gaps.length) / 10, median: Math.round(gaps[gaps.length >> 1] * 10) / 10, unit: col.kind === 'pct' ? 'pts' : '%', tol } : null;
    }
    if (col.q10 && cmp.fields[col.q10]) {
      const f = cmp.fields[col.q10];
      o.vs10q = { figure: col.q10, pairs: f.pairs, within05: f.pairs ? Math.round(1000 * f.bands[1] / f.pairs) / 10 : null };
    }
    // THE OWNER'S RULE, SIMULATED (2026-10-29, docs/context/data-sources.md):
    // for each company, which source the rule would use for this column. Only
    // sources on the same definition take part (status Yes); Twelve Data is
    // the fallback. SEC is set aside when it is not yet on the release's
    // quarter, fails the scale check (over twenty times off the release or
    // Twelve Data, whichever exist: all of them, so one near-zero figure cannot
    // condemn it), or is outvoted (the release and Twelve Data agree with
    // each other and it agrees with neither). Measured at the level of the
    // column's figure; the build would apply it a quarter at a time.
    o.rule = null;
    if (!BEST[col.label] && col.td && (o.status === 'Yes' || o.sec.status === 'Yes')) {
      const relIn = o.status === 'Yes', secIn = o.sec.status === 'Yes';
      // Twelve Data takes part only on the same definition (free cash flow: the owner chose operating cash flow less capex, 2026-10-29; Twelve Data's is levered).
      const tdIn = !NO_TD_FALLBACK.has(col.label);
      const tol = col.kind === 'pct' ? 1 : 0.02;
      const close = (p, q) => (col.kind === 'pct' ? Math.abs(p - q) <= tol : Math.abs(p - q) <= Math.abs(q) * tol + 1e-9);
      const off20 = (p, q) => p != null && q != null && q !== 0 && p !== 0 && (Math.abs(p / q) > 20 || Math.abs(p / q) < 1 / 20);
      const u = { release: 0, sec: 0, td: 0, none: 0 }, aside = { waiting: 0, scale: 0, outvoted: 0 }, eg = { scale: [], outvoted: [] };
      const big = (v) => (Math.abs(v) >= 1e6 ? (v / 1e9).toFixed(2) + 'B' : String(Math.round(v * 100) / 100));
      for (const s of rows) {
        const c = ctx.get(s.symbol), x = sctx.get(s.symbol);
        const rv = relIn && c ? col.relv(s, c) : null;
        const sv = secIn && x && sm.v ? sm.v(s, x) : null;
        // Twelve Data on another definition is no fallback, but it still votes:
        // where the release and it agree and the SEC agrees with neither, the
        // SEC figure is set aside (NXP's debt: release and Twelve Data $10.98B).
        const tvVote = col.td(s);
        const tv = tdIn ? tvVote : null;
        let use = null;
        if (sv != null) {
          const sameQ = !c || Math.abs(t(x.last.period_end) - t(c.r.period_end)) <= 7 * DAY || t(x.last.period_end) > t(c.r.period_end);
          if (!sameQ && rv != null) { aside.waiting++; use = 'release'; }
          else if (kindMoney(col.kind) && (rv != null || tv != null) && (rv == null || off20(sv, rv)) && (tv == null || off20(sv, tv))) { aside.scale++; if (eg.scale.length < 5) eg.scale.push(s.symbol + ' SEC ' + big(sv) + ', release ' + (rv == null ? '—' : big(rv)) + ', Twelve Data ' + (tv == null ? '—' : big(tv))); use = rv != null ? 'release' : tv != null ? 'td' : null; }
          else if (rv != null && tvVote != null && close(rv, tvVote) && !close(sv, rv) && !close(sv, tvVote)) { aside.outvoted++; if (eg.outvoted.length < 5) eg.outvoted.push(s.symbol + ' SEC ' + big(sv) + ', release ' + big(rv) + ', Twelve Data ' + big(tvVote)); use = 'release'; }
          else use = 'sec';
        } else if (rv != null) use = 'release';
        else if (tv != null) use = 'td';
        u[use || 'none']++;
      }
      o.rule = { used: u, aside, examples: eg, sources: (relIn ? 'release, ' : '') + (secIn ? 'SEC, ' : '') + 'Twelve Data' };
    }
    o.best = bestOf(o);
    const pr = PROPOSE[col.label];
    const tag = pr ? PERIOD_TAG[pr.to] : '';
    const hdr = pr ? pr.header.replace(/\s*\((TTM|Q end|forward|TTM, today\u2019s price|TTM, avg equity|TTM, avg assets|diluted|Q on Q a year ago)\)$/, '').replace(/\s+TTM$/, '') + (tag && !/^Fwd/.test(pr.header) ? ' \u00b7 ' + tag : '') : '';
    o.proposal = pr ? { now: PERIOD[pr.now], to: PERIOD[pr.to], periodChange: pr.now !== pr.to, header: hdr, text: pr.text, extract: pr.ex, group: groupFor(col.label, col.group), moved: MOVED.has(col.label), groupMoves: groupFor(col.label, col.group) !== ({ Info: 'Overview', 'Financial position': 'Balance sheet', Scale: 'Income statement' }[col.group] || col.group) } : null;
    out.push(o);
  }
  // How current the filings are: of the companies with a release in the last
  // 130 days, how many have that same quarter in the SEC data already.
  let fresh = 0, both = 0;
  for (const [sym, c] of ctx) { const x = sctx.get(sym); if (!x) continue; both++; if (Math.abs(t(x.last.period_end) - t(c.r.period_end)) <= 7 * DAY) fresh++; }
  const lags = (cmp.twelveData && cmp.twelveData.revenue || []).filter((x) => x.lag != null).map((x) => x.lag).sort((a, b) => a - b);
  const filingLag = (cmp.timing || []).map((x) => x.d).sort((a, b) => a - b);
  const doc = {
    builtAt: new Date().toISOString(), secCompanies: sctx.size, secSameQuarter: both ? Math.round(1000 * fresh / both) / 10 : null, secSameQuarterN: both, releasesSince: cmp.since, releases: cmp.releases, matched: cmp.matched, companies: rows.length, withReleases: ctx.size,
    timing: { tdMedianDays: lags.length ? lags[lags.length >> 1] : null, tdP90Days: lags.length ? lags[Math.floor(0.9 * lags.length)] : null, tdN: lags.length,
      filingSameDayPct: filingLag.length ? Math.round(1000 * filingLag.filter((d) => d === 0).length / filingLag.length) / 10 : null,
      filingMedianDays: filingLag.length ? filingLag[filingLag.length >> 1] : null, filingP90Days: filingLag.length ? filingLag[Math.floor(0.9 * filingLag.length)] : null },
    fromFilings: FROM_FILINGS, decisions: DECISIONS, plan: PLAN, tradingview: TRADINGVIEW, groups: GROUPS, additions: ADDITIONS,
    extracts: Object.entries(EXTRACT).map(([id, e]) => Object.assign({ id, status: id === 'divdecl' ? 'open' : 'done', coverage: COVERED[id] == null ? null : (typeof COVERED[id] === 'number' ? COVERED[id] + ' of ' + sctx.size + ' companies with SEC data' : COVERED[id]), columns: out.filter((r) => r.proposal && r.proposal.extract === id).map((r) => r.label) }, e)), rows: out };
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1));
  const c = (st) => out.filter((r) => r.status === st).length;
  console.log(`written ${OUT}: ${out.length} columns (Yes ${c('Yes')}, Partly ${c('Partly')}, No ${c('No')}); ${ctx.size} of ${rows.length} companies with a release in the last 130 days`);
  process.exit(0);
})();
