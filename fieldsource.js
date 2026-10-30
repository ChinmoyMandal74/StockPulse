// Where each screener column's figure comes from, in a few words, for the
// Source column on /fields (2026-10-30). Keyed by the column's id (its
// data-key in index.html's header row, which is also the row's field).
//
// The company figures under the owner's source rule are NOT listed by hand:
// sourcerule.js's own FIELDS and NO_TD decide them, so a field joining or
// leaving the rule changes this page with it. Everything else is a group
// default with per-column exceptions. fieldsource-test.js requires a source
// for every column the screener has, so a new column without one fails there.
//
// Short phrases, not definitions: the definition beside it says how the
// figure is worked out. "Worked out here" means computed by Tickr Lab from
// the source named.

const SourceRule = require('./sourcerule.js');

const S = {
  prices: 'Daily prices (Twelve Data), worked out here',
  td: 'Twelve Data',
  tdProfile: 'Twelve Data company profile',
  rule: 'Results release while newest, then SEC filings, else Twelve Data',
  ruleNoTd: 'Results release while newest, then SEC filings',
  sec: 'SEC filings (the company’s 10-Q and 10-K)',
  secPrices: 'SEC filings and daily prices, worked out here',
  release: 'Results press release (8-K Exhibit 99.1), read by AI',
  here: 'Worked out here',
};

// A whole group from one place, unless a column says otherwise below.
const GROUP = {
  chart: S.prices, short: S.prices, long: S.prices, trend: S.prices, rel: S.prices, risk: S.prices, fwd: S.prices,
  act: 'Worked out here: the Signal rules, from prices and company figures',
  lrun: S.sec,
  aier: S.release,
};

const COLUMN = {
  // The stock
  symbol: 'The Tickr Lab universe, kept by hand',
  shortName: 'Twelve Data company profile, shortened here',
  // Info
  portfolios: 'Tickr Lab, kept by hand',
  sector: S.tdProfile, industry: S.tdProfile, exchange: S.tdProfile,
  instrumentType: 'Twelve Data reference list',
  filer: 'SEC filings',
  spMember: 'Index fund daily holdings files (SPY and QQQ)',
  marketCap: S.td,
  capBand: 'Worked out here from Market Cap',
  newsAge: 'News headlines (Google News, Yahoo Finance)',
  toneAvg: 'Yahoo Finance articles, each read by AI',
  nextEarningsDate: 'Earnings calendar (Alpha Vantage, else Nasdaq), else estimated here',
  // Scores
  qualityScore: 'Worked out here from the company figures',
  // Short-term
  pricedAt: 'Twelve Data (the time of the last price fetch)',
  price: 'Twelve Data',
  capChangeToday: 'Worked out here: Market Cap × today’s move',
  // Reactions
  chipSelloff: S.prices, marketSelloff: S.prices, marketRally: S.prices,
  shortBuild: 'FINRA short interest reports',
  insiderNet: 'SEC Form 4 insider filings',
  lastEvent: 'SEC Form 8-K filings',
  // Income statement, valuation, profitability
  ebitda: S.td,
  revenuePerEmployee: 'Revenue (as Revenue TTM) over Twelve Data’s employee count',
  forwardPe: 'Twelve Data (analysts’ estimate)',
  trailingPe: S.td,
  peLive: 'Worked out here: Price over EPS TTM',
  peerPe: 'Twelve Data forward P/E, against its industry, worked out here',
  peg: 'Twelve Data (analysts’ estimate)',
  evToSales: 'Worked out here: enterprise value (by the source rule) over Revenue TTM',
  priceToOcf: 'Worked out here from Market Cap and Op Cash TTM',
  earningsYield: 'Worked out here: EPS TTM over Price',
  netMarginChg: S.sec,
  roa: S.td,
  // Balance sheet
  netCashPerShare: 'Worked out here from Net Cash and Shares Out',
  workingCapital: S.sec,
  // Dividends and returns
  divYield: S.td,
  payoutRatio: S.td,
  buybackYield: 'SEC filings (cash flow statements), over Market Cap',
  shareholderYield: 'Worked out here: Div Yield plus Buyback yield',
  // Reporting
  mostRecentQuarter: 'The quarter the company figures run to, by the source rule',
  lastEarningsDate: S.td,
  secResults: 'SEC Form 8-K filings (Item 2.02)',
  staleIssues: 'Worked out here: Twelve Data’s dates against the SEC’s',
  // Long run
  peVsMed: S.secPrices,
  // Ownership
  sharesChg: S.sec,
  floatShares: S.td, shortRatio: S.td, shortPctFloat: S.td, shortPctOutstanding: S.td,
  insiderPct: S.td, institutionPct: S.td,
  insDays: 'Twelve Data holdings and daily volume, worked out here',
  instDays: 'Twelve Data holdings and daily volume, worked out here',
  instManagers: 'SEC Form 13F filings',
  instChange: 'SEC Form 13F filings',
  lastHolder: 'SEC Schedule 13D and 13G filings',
  optPcr: 'Options Clearing Corporation',
  // Latest quarter, from the release
  erFiled: 'SEC Form 8-K filing date',
  erFcf: 'Results press release, or worked out here from its cash flow lines',
  erEst: 'Twelve Data (analysts’ estimate)',
  erVsEstWord: 'Results press release against Twelve Data’s estimate',
  erVsEst: 'Results press release against Twelve Data’s estimate',
  erTenQ: 'Results press release against the SEC 10-Q',
  erSummary: 'Results press release, summarised by AI',
};

const RULE = new Set(SourceRule.FIELDS);

// The source of one column, or null when none is written down.
function sourceOf(id, group) {
  if (COLUMN[id]) return COLUMN[id];
  if (RULE.has(id)) return SourceRule.NO_TD.has(id) ? S.ruleNoTd : S.rule;
  return GROUP[group] || null;
}

module.exports = { sourceOf, S };
