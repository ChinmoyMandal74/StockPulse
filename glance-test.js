// glance.js on fixtures. No server, no network.   node glance-test.js
const G = require('./private/glance.js');
let ran = 0, failed = 0;
const check = (name, ok, extra) => { ran++; if (!ok) { failed++; console.log('FAIL', name, extra || ''); } };

// Twelve semiconductor makers with a spread of figures, a bank, a fund.
const semis = Array.from({ length: 12 }, (_, i) => ({
  symbol: 'S' + i, industry: 'Semiconductors', sector: 'Technology',
  revenueGrowthYoY: i * 10, profitMargin: i * 3, forwardPe: 10 + i * 4, shortPctFloat: 1 + i,
}));
const mu = Object.assign({}, semis[11], {
  symbol: 'MU', todayPct: -3.9, oneWeekPct: -7, oneMonthPct: 1.4, vs50ma: 1, rsi: 45,
  oneYearPct: 414, vs200ma: 40, pctFromHigh: -21, ddState: 'Bear market',
  earningsGrowthYoY: 1077, netCash: 38e9, currency: 'USD', shortRatio: 1.1, shortBuild: -7,
  shortBuildTo: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10),
  insiderBuyers: 0, insiderSellers: 3, insiderNet: -0.001, lastSurprise: 5, nextEarningsDate: '2026-12-30',
  action: 'Neutral', actionFlag: 'Neutral: No clean entry',
});
const bank = { symbol: 'JPM', industry: 'Banks', sector: 'Financial Services', netCash: 183e9, debtToEquity: 3.6, forwardPe: 13 };
const fund = { symbol: 'SPY', instrumentType: 'ETF', industry: 'Semiconductors', revenueGrowthYoY: 9999 };
const all = semis.concat([mu, bank, fund]);

const g = G.build(mu, all);
const card = (id) => g.cards.find((c) => c.id === id);
check('ten cards for a full row', g.cards.length === 10, g.cards.map((c) => c.id).join(','));
check('price cards carry the price tone, the rest do not',
  g.cards.every((c) => (c.tone === 'price') === (c.id === 'short' || c.id === 'long') || c.id === 'signal'));
check('short-term arrow follows the month (+1.4% is level)', card('short').arrow === 'flat', card('short').arrow);
check('long-term arrow up on +414%', card('long').arrow === 'up');
check('top of its industry on growth reads up, and names the industry',
  card('growth').arrow === 'up' && /three quarters of Semiconductors/.test(card('growth').text), card('growth').text);
check('a fund is never in the comparison', !/9999/.test(JSON.stringify(G.standing(mu, all, 'revenueGrowthYoY'))) && G.standing(mu, all, 'revenueGrowthYoY').n === 13);   // the twelve and MU itself
check('short position arrow follows the latest change (down 7%)', card('shortpos').arrow === 'down');
check('a fresh short report is not flagged', !card('shortpos').stale);
const old = G.build(Object.assign({}, mu, { shortBuildTo: '2026-01-01' }), all);
check('an old short report is flagged', !!old.cards.find((c) => c.id === 'shortpos').stale);
check('insiders selling reads down', card('owners').arrow === 'down');
check('the Signal card has no arrow', card('signal').arrow === null && /No clean entry/.test(card('signal').text));

// A lender: no net cash line, no arrow from it.
const gb = G.build(bank, all);
const bal = gb.cards.find((c) => c.id === 'balance');
check('a bank gets no net cash', bal && !/cash/i.test(bal.text) && bal.arrow === null, bal && bal.text);
// A thin industry falls back to every company, and says so.
check('thin industry falls back to every company', /every company tracked/.test(gb.cards.find((c) => c.id === 'value').text));

// A loss: no multiple, and no standing on one.
const loss = G.build(Object.assign({}, mu, { forwardPe: -5, trailingPe: null }), all);
check('a loss reads "No P/E", with no arrow', /No P\/E/.test(loss.cards.find((c) => c.id === 'value').text) && loss.cards.find((c) => c.id === 'value').arrow === null);

// Null is not zero: an empty row draws nothing rather than zeros.
const empty = G.build({ symbol: 'X' }, all);
check('an empty row has no cards', empty.cards.length === 0, empty.cards.map((c) => c.id).join(','));
check('an empty row renders nothing', G.render(empty) === '');

// With the insider file read and no trades, it says so, with the date.
const quiet = G.build(Object.assign({}, mu, { insiderBuyers: undefined, insiderSellers: undefined, insiderNet: null, insiderSince: '2026-07-17' }), all);
check('no trades is said only when the file was read', /since Jul 17/.test(quiet.cards.find((c) => c.id === 'owners').text));

// Volatility (2026-10-19): against the industry, lately against the year, beta.
{
  const vs = semis.map((r, i) => Object.assign({}, r, { vol1y: 30 + i * 3 }));
  const wild = Object.assign({}, mu, { vol1y: 80, vol3m: 110, beta: 2.4, badDay: -5.2 });
  const gv = G.build(wild, vs.concat([wild, bank, fund]));
  const c = gv.cards.find((x) => x.id === 'vol');
  check('the volatility card appears when the figures are there', !!c);
  check('most volatile in its industry reads up, worded as volatility', c.arrow === 'up' && /more volatile than three quarters of Semiconductors/.test(c.text), c.text);
  check('three months well above the year reads wilder lately', /Wilder lately: 110%/.test(c.text), c.text);
  check('beta is explained in plain terms', /Beta 2\.40: on a day the S&P 500 moved 1%, it has tended to move 2\.4%\./.test(c.text), c.text);
  check('the bad day is stated as a fall', /One day in twenty fell 5\.2% or more/.test(c.text), c.text);
  const calm = G.build(Object.assign({}, wild, { vol1y: 31, vol3m: 20, beta: -0.3 }), vs.concat([bank]));
  const cc = calm.cards.find((x) => x.id === 'vol');
  check('three months well below reads calmer lately, and a low one reads down', /Calmer lately/.test(cc.text) && cc.arrow === 'down', cc.text + ' ' + cc.arrow);
  check('a negative beta says it moved the other way', /the other way\./.test(cc.text), cc.text);
  const fundCard = G.build(Object.assign({}, fund, { vol1y: 13, beta: 1 }), vs).cards.find((x) => x.id === 'vol');
  check('a fund gets the figures but no comparison arrow', !!fundCard && fundCard.arrow === null, JSON.stringify(fundCard));
  check('no volatility figures, no card', !G.build(mu, all).cards.some((x) => x.id === 'vol'));
}

// The words never advise.
const html = G.render(g) + G.render(gb) + G.render(loss);
check('no NaN or undefined drawn', !/NaN|undefined/.test(html));
check('no trading words', !/\b(buy|sell|hold|cheap|expensive|bullish|bearish|good|bad)\b/i.test(html.replace(/<[^>]+>/g, ' ')),
  (html.replace(/<[^>]+>/g, ' ').match(/\b(buy|sell|hold|cheap|expensive|bullish|bearish|good|bad)\b/gi) || []).join(','));
check('text is escaped', !G.render({ cards: [{ id: 'x', title: '<b>', text: '<script>', jump: 'p' }] }).includes('<script>'));

console.log(ran + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
