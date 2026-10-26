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

// Earnings, and Guidance beside it (2026-10-23 as one card; split 2026-10-26):
// the newest release's er- fields, as /api/stock adds them.
let relHtml = '';
{
  const base = Object.assign({}, mu, { nextEarningsDate: '2026-10-20', nextEarningsEstimated: true, lastSurprise: 10.3 });
  const withRel = Object.assign({}, base, { erFiled: '2026-10-22', erPeriodLabel: 'Third Quarter 2026', erRevYoY: 11.3, erEpsYoY: 14.7, erVsEstWord: 'Above',
    erGuideChange: 'Raised', erGuideChangeQuote: 'The company raised its 2026 outlook for sales, diluted EPS and free cash flow', erGuide: '2026 Financial Outlook: Sales ~$80,000 - $82,000', erEpsGuideVsFy: 26.4 });
  const cards = G.build(withRel, all).cards;
  const c = cards.find((x) => x.id === 'earn'), g = cards.find((x) => x.id === 'guide');
  check('earn: called Earnings, Guidance a card of its own right after it', c && c.title === 'Earnings' && g && g.title === 'Guidance' && cards.indexOf(g) === cards.indexOf(c) + 1, cards.map((x) => x.id));
  check('earn: reported, revenue and EPS on a year ago, and against the estimate', /Reported Third Quarter 2026 on Oct 22: revenue up 11\.3%, EPS up 14\.7% on a year ago\./.test(c.text) && /EPS came in above the estimate\./.test(c.text), c.text);
  check('earn: no guidance words on the Earnings card', !/Guidance|guide/.test(c.text), c.text);
  check('earn: a next date already past the report is left out', !/Next report Oct 20/.test(c.text), c.text);
  check('earn: Above is an up arrow and the headline, the card opens the releases', c.arrow === 'up' && c.key.v === 'Above' && /vs the estimate, Oct 22/.test(c.key.k) && c.jump === 'rels', JSON.stringify([c.arrow, c.key, c.jump]));
  check('guide: the stated change in the company’s words, and the guide reading', /Guidance raised: “The company raised its 2026 outlook/.test(g.text) && /Full-year EPS guide up 26\.4% on the year before\./.test(g.text), g.text);
  check('guide: raised is an up arrow and the headline, opening the releases', g.arrow === 'up' && g.key.v === 'Raised' && g.jump === 'rels', JSON.stringify([g.arrow, g.key]));
  const later = G.build(Object.assign({}, withRel, { nextEarningsDate: '2027-01-27' }), all).cards.find((x) => x.id === 'earn');
  check('earn: a next date after the report is kept', /Next report Jan 27 \(estimated\)\./.test(later.text), later.text);
  const low = G.build(Object.assign({}, withRel, { erGuideChange: 'Lowered', erVsEstWord: 'Below' }), all).cards;
  check('lowered guidance and a result below: both down arrows', low.find((x) => x.id === 'guide').arrow === 'down' && low.find((x) => x.id === 'earn').arrow === 'down');
  const plain = G.build(Object.assign({}, withRel, { erGuideChange: null, erGuideChangeQuote: null, erEpsGuideVsFy: null, erVsEstWord: null }), all).cards;
  const pg = plain.find((x) => x.id === 'guide'), pe = plain.find((x) => x.id === 'earn');
  check('guide: given with no stated change says so, no arrow, headline Given', /Guidance given, no change stated\./.test(pg.text) && pg.arrow === null && pg.key.v === 'Given', JSON.stringify([pg.text, pg.arrow, pg.key]));
  check('earn: no estimate word, the report day as headline', pe.key.v === 'Oct 22' && pe.arrow === null, pe.key);
  const noGuide = G.build(Object.assign({}, withRel, { erGuideChange: null, erGuide: null, erEpsGuideVsFy: null }), all).cards.find((x) => x.id === 'guide');
  check('guide: none in the release says so', noGuide && /No guidance in the latest results release\./.test(noGuide.text) && noGuide.key.v === 'None', noGuide && noGuide.text);
  const noneCards = G.build(base, all).cards;
  const none = noneCards.find((x) => x.id === 'earn');
  check('earn: no release, the old wording and the surprise arrow; no Guidance card', /Next report Oct 20 \(estimated\)\./.test(none.text) && /beat the estimate by 10\.3%/.test(none.text) && none.arrow === 'up' && none.jump === 'earn' && !noneCards.some((x) => x.id === 'guide'), none.text);
  relHtml = G.render({ cards: [c, g, pg] });
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

// Capital returns, Revenue mix, How it trades with the market (2026-10-26).
{
  const peers = [];
  for (let i = 0; i < 8; i++) peers.push({ symbol: 'Q' + i, industry: 'Tins', divYield: 1 + i * 0.2, buybackYield: 0.5, marketSelloff: -2 - i * 0.3, marketRally: 1.5 });
  const spy = { symbol: 'SPY', instrumentType: 'ETF', marketSelloff: -1.6, marketRally: 1.7 };
  const me = { symbol: 'ME', industry: 'Tins', divYield: 3.1, payoutRatio: 55, divStreak: 12, divSince: 2014, buybackYield: 2.4, sharesChg: -2.1,
    marketSelloff: -0.8, marketRally: 0.9, chipSelloff: -3,
    segMix: { title: 'By business segment', period: 'the fiscal year to Dec 2025', top: [{ name: 'Cans', pct: 61, change: 4.2, was: 52 }, { name: 'Lids', pct: 30, change: -1 }], more: 1, wasYears: 3 } };
  const g = G.build(me, peers.concat([spy, me]));
  const byId = (id) => g.cards.find((c) => c.id === id);
  const cr = byId('capret'), mx = byId('mix'), mk = byId('mkt');
  check('the three new cards come last, in order', g.cards.slice(-3).map((c) => c.id).join() === 'capret,mix,mkt', g.cards.map((c) => c.id));
  check('capital returns: dividend and record, buybacks, share count', cr && /Dividend yield 3\.1%, 55% of earnings paid out; raised 12 years in a row since 2014\./.test(cr.text)
    && /Buybacks worth 2\.4% of its market value/.test(cr.text) && /Share count down 2\.1% on a year earlier\./.test(cr.text), cr && cr.text);
  check('capital returns: shareholder yield against the industry, headline 5.5%, arrow down for a shrinking count', cr && /Shareholder yield is higher than three quarters of Tins/.test(cr.text) && cr.key.v === '5.5%' && cr.arrow === 'down', cr);
  const dil = G.build(Object.assign({}, me, { sharesChg: 3.4 }), peers.concat([spy])).cards.find((c) => c.id === 'capret');
  check('capital returns: a growing count is named dilution, arrow up', dil && /up 3\.4% on a year earlier \(dilution\)/.test(dil.text) && dil.arrow === 'up', dil && dil.text);
  check('revenue mix: the parts, the largest one years before, its change', mx && /By business segment, the fiscal year to Dec 2025: Cans 61%, Lids 30%, and 1 more\./.test(mx.text)
    && /Cans was 52% of revenue 3 years earlier\./.test(mx.text) && /Cans revenue up 4\.2%/.test(mx.text) && mx.key.v === '61%' && mx.arrow === null, mx && mx.text);
  check('how it trades: its move and the index’s on worst and best days', mk && /typically moved −0\.8% \(the index −1\.6%\), and on its best \+0\.9% \(the index \+1\.7%\)\./.test(mk.text), mk && mk.text);
  check('how it trades: held up better, standing worded for a fall (shallower)', mk && /held up better than the index/.test(mk.text) && /shallower than three quarters of Tins/.test(mk.text) && !/shalde/.test(mk.text), mk && mk.text);
  check('how it trades: no arrow, and no chip line outside semiconductors', mk && mk.arrow === null && !/chip/i.test(mk.text));
  check('no mix data, no mix card', !G.build(Object.assign({}, me, { segMix: null }), peers).cards.some((c) => c.id === 'mix'));
}

console.log(ran + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
