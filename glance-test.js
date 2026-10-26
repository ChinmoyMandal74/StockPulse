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

// Earnings and guidance (2026-10-23): the newest release's er- fields, as /api/stock adds them.
let relHtml = '';
{
  const base = Object.assign({}, mu, { nextEarningsDate: '2026-10-20', nextEarningsEstimated: true, lastSurprise: 10.3 });
  const withRel = Object.assign({}, base, { erFiled: '2026-10-22', erPeriodLabel: 'Third Quarter 2026', erRevYoY: 11.3, erEpsYoY: 14.7,
    erGuideChange: 'Raised', erGuideChangeQuote: 'The company raised its 2026 outlook for sales, diluted EPS and free cash flow', erGuide: '2026 Financial Outlook: Sales ~$80,000 - $82,000', erEpsGuideVsFy: 26.4 });
  const c = G.build(withRel, all).cards.find((x) => x.id === 'earn');
  check('earn: called Earnings and guidance', c && c.title === 'Earnings and guidance', c && c.title);
  check('earn: reported, revenue and EPS on a year ago', /Reported Third Quarter 2026 on Oct 22: revenue up 11\.3%, EPS up 14\.7% on a year ago\./.test(c.text), c.text);
  check('earn: the stated change in the company’s words, and the guide reading', /Guidance raised: “The company raised its 2026 outlook/.test(c.text) && /Full-year EPS guide up 26\.4% on the year before\./.test(c.text), c.text);
  check('earn: a next date already past the report is left out', !/Next report Oct 20/.test(c.text), c.text);
  check('earn: raised is an up arrow, the headline is the change, the card opens the releases', c.arrow === 'up' && c.key.v === 'Raised' && /guidance, Oct 22/.test(c.key.k) && c.jump === 'rels', JSON.stringify([c.arrow, c.key, c.jump]));
  const later = G.build(Object.assign({}, withRel, { nextEarningsDate: '2027-01-27' }), all).cards.find((x) => x.id === 'earn');
  check('earn: a next date after the report is kept', /Next report Jan 27 \(estimated\)\./.test(later.text), later.text);
  const low = G.build(Object.assign({}, withRel, { erGuideChange: 'Lowered' }), all).cards.find((x) => x.id === 'earn');
  check('earn: lowered is a down arrow', low.arrow === 'down');
  const plain = G.build(Object.assign({}, withRel, { erGuideChange: null, erGuideChangeQuote: null, erEpsGuideVsFy: null }), all).cards.find((x) => x.id === 'earn');
  check('earn: guidance with no stated change says so, no arrow, the report day as headline', /Guidance given, no change stated\./.test(plain.text) && plain.arrow === null && plain.key.v === 'Oct 22', JSON.stringify([plain.text, plain.arrow, plain.key]));
  const none = G.build(base, all).cards.find((x) => x.id === 'earn');
  check('earn: no release, the old wording and the surprise arrow', /Next report Oct 20 \(estimated\)\./.test(none.text) && /beat the estimate by 10\.3%/.test(none.text) && none.arrow === 'up' && none.jump === 'earn', none.text);
  relHtml = G.render({ cards: [c, low, plain] });
}

// The words never advise.
const html = G.render(g) + G.render(gb) + G.render(loss) + relHtml;
check('no NaN or undefined drawn', !/NaN|undefined/.test(html));
check('no trading words', !/\b(buy|sell|hold|cheap|expensive|bullish|bearish|good|bad)\b/i.test(html.replace(/<[^>]+>/g, ' ')),
  (html.replace(/<[^>]+>/g, ' ').match(/\b(buy|sell|hold|cheap|expensive|bullish|bearish|good|bad)\b/gi) || []).join(','));
check('text is escaped', !G.render({ cards: [{ id: 'x', title: '<b>', text: '<script>', jump: 'p' }] }).includes('<script>'));

// Article tone, the 13th card (2026-10-26).
{
  const peers = [];
  for (let i = 0; i < 8; i++) peers.push({ symbol: 'P' + i, industry: 'Toolmaking', toneAvg: -0.2 + i * 0.1, toneN: 4, tonePos: 1, toneNeg: 1 });
  const me = { symbol: 'ME', industry: 'Toolmaking', toneAvg: 0.42, toneN: 7, tonePos: 5, toneNeg: 0, action: 'Neutral' };
  const g = G.build(me, peers.concat([me]));
  const t = g.cards.find((c) => c.id === 'tone');
  check('tone: the card is last, after the Signal', g.cards[g.cards.length - 1].id === 'tone' && g.cards[g.cards.length - 2].id === 'signal');
  check('tone: the counts, the average and the lean in words', t && /7 articles read in the last seven days: 5 positive, 0 negative\. Average \+0\.42 .* leaning positive/.test(t.text), t && t.text);
  check('tone: against its industry, and its arrow is its own lean', t && /than three quarters of Toolmaking/.test(t.text) && t.arrow === 'up', t);
  check('tone: the headline figure', t && t.key && t.key.v === '+0.42' && /7 articles, 7 days/.test(t.key.k), t && t.key);
  const flat = G.build(Object.assign({}, me, { toneAvg: 0.1 }), peers).cards.find((c) => c.id === 'tone');
  check('tone: inside +/-0.25 is about neutral, a level arrow', flat && flat.arrow === 'flat' && /about neutral/.test(flat.text));
  check('tone: no figures (a guest, or nothing read) means no card', !G.build({ symbol: 'ME', industry: 'Toolmaking' }, peers).cards.some((c) => c.id === 'tone'));
  check('tone: no trading words', t && !/\b(buy|sell|hold|bullish|bearish|good|bad)\b/i.test(t.text));
}

console.log(ran + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
