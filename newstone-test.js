// Article tone (newstone.js), held to its brief. Pure: no network, no
// database, no model calls.
//
//   node newstone-test.js
//
// Each guard is probed on both sides of its line: the label bands, the
// wording rule (a banned word refused, a fact that merely contains one of
// its letters passed), robots.txt, the extractor's choice between an
// <article> element and the page, the "names the company" filter, and the
// seven-day line's refusal to count a missing reading as zero. And the
// boundary: the Signal gives the same verdict whatever tone fields a row
// carries.
const NT = require('./newstone.js');
const A = require('./private/action.js');

let n = 0, failed = 0;
function check(label, got, want) {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
  else console.log(`  ok    ${label}`);
}

console.log('the label bands');
check('+0.25 is Positive (on the line)', NT.label(0.25), 'Positive');
check('+0.24 is Neutral (just inside)', NT.label(0.24), 'Neutral');
check('-0.25 is Negative (on the line)', NT.label(-0.25), 'Negative');
check('-0.24 is Neutral (just inside)', NT.label(-0.24), 'Neutral');
check('0 is Neutral', NT.label(0), 'Neutral');
check('null has no label, not Neutral', NT.label(null), null);
check('NaN has no label', NT.label(NaN), null);

console.log('the feed');
const FEED = `<rss><channel>
  <item><title><![CDATA[Micron &amp; the memory cycle]]></title><link>https://finance.yahoo.com/news/micron-123.html?.tsrc=rss</link><pubDate>Sun, 18 Oct 2026 10:56:02 +0000</pubDate></item>
  <item><title>No date</title><link>https://www.fool.com/a/</link></item>
  <item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>Sun, 18 Oct 2026 10:56:02 +0000</pubDate></item>
  <item><title>Fool piece</title><link>https://www.fool.com/investing/2026/10/18/x/?.tsrc=rss</link><pubDate>Sat, 17 Oct 2026 09:30:00 +0000</pubDate></item>
</channel></rss>`;
const items = NT.parseFeed(FEED);
check('two items survive: a missing date and a non-http link are dropped', items.length, 2);
check('CDATA and entities decoded', items[0].headline, 'Micron & the memory cycle');
check('the tracking query is dropped', items[0].url, 'https://finance.yahoo.com/news/micron-123.html');
check('an empty query leaves no trailing ?', items[1].url, 'https://www.fool.com/investing/2026/10/18/x/');
check('date stored as ISO', items[0].published_at, '2026-10-18T10:56:02.000Z');
check('a real query parameter is kept', NT.canonUrl('https://x.com/a?id=7&.tsrc=rss'), 'https://x.com/a?id=7');
check('publisher named from the host', NT.sourceOf('https://www.fool.com/investing/x'), 'The Motley Fool');
check('an unknown host is its own name', NT.sourceOf('https://news.example.org/x'), 'news.example.org');

console.log('robots.txt');
const ROBOTS = `User-agent: *
Disallow: /private/
Allow: /private/open/

User-agent: TickrLab
Disallow: /news/

User-agent: ClaudeBot
User-agent: GPTBot
Disallow: /`;
const ours = NT.robotsRules(ROBOTS, 'TickrLab');
check('our own group is used when a site names us', NT.robotsAllows(ours, '/news/story'), false);
check('...and only its rules apply', NT.robotsAllows(ours, '/private/x'), true);
const star = NT.robotsRules(ROBOTS, 'SomeoneElse');
check('* group: a disallowed prefix is refused', NT.robotsAllows(star, '/private/x'), false);
check('* group: the longer Allow wins', NT.robotsAllows(star, '/private/open/x'), true);
check('* group: an unlisted path is allowed', NT.robotsAllows(star, '/news/x'), true);
check('two agents sharing one group are both bound', NT.robotsAllows(NT.robotsRules(ROBOTS, 'GPTBot'), '/anything'), false);
const google = NT.robotsRules('User-agent: *\nDisallow: /\nAllow: /$\nAllow: /home/\n', 'TickrLab');
check("Google News's own file refuses its article links", NT.robotsAllows(google, '/rss/articles/CBMi'), false);
check('...and allows its home page, which "/$" names', NT.robotsAllows(google, '/'), true);
check('...and allows what an Allow prefix names', NT.robotsAllows(google, '/home/x'), true);
check('a * wildcard matches inside a path', NT.robotsAllows(NT.robotsRules('User-agent: *\nDisallow: /*.pdf$\n', 'x'), '/a/b.pdf'), false);
check('...and the $ anchor stops it matching a longer path', NT.robotsAllows(NT.robotsRules('User-agent: *\nDisallow: /*.pdf$\n', 'x'), '/a/b.pdf?x=1'), true);
check('no robots file means no rules', NT.robotsAllows(NT.robotsRules('', 'TickrLab'), '/a'), true);

console.log('the article text');
const para = (s) => `<p>${s}</p>`;
const LONG = 'Micron reported record revenue for the quarter as demand for memory used in data centres rose sharply again. ';
const body = Array.from({ length: 20 }, (_, i) => para(LONG + i)).join('');
const card = '<article>' + para('Related: another story about a different company that is not this one at all, honestly.') + '</article>';
const fool = `<html><nav><p>Home Membership Discussion Board and other menu entries that are long enough</p></nav>${card}<div class="article-body">${body}</div></html>`;
const t1 = NT.articleText(fool);
check('a small <article> card loses to the page body', t1.includes('record revenue') && t1.length > 2000, true);
check('the nav is stripped', t1.includes('Membership'), false);
const proper = `<html><div>${para('Sidebar text about markets that is long enough to count as a paragraph here.')}</div><article>${body}</article></html>`;
check('a real <article> is preferred to the page', NT.articleText(proper).includes('Sidebar'), false);
const ld = `<script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'NewsArticle', articleBody: LONG.repeat(10) }] })}</script><p>teaser text that is long enough to be kept as a paragraph by the scraper</p>`;
check('structured articleBody is used when present', NT.articleText(ld).startsWith('Micron reported'), true);
check('repeated paragraphs kept once', NT.articleText(para(LONG) + para(LONG)).length, LONG.trim().length);
check('entities decoded', NT.articleText(para('AT&amp;T and S&amp;P 500 moved &mdash; a sentence long enough to be kept.')).includes('AT&T and S&P 500 moved —'), true);

console.log('an out-of-range character code never throws (backlog 45g)');
let threw = false;
try { NT.articleText(para('A paragraph long enough to keep, with &#99999999; in it and &#233; too.')); } catch (e) { threw = true; }
check('articleText survives a code past U+10FFFF', threw, false);
check('and keeps the valid one', NT.articleText(para('A paragraph long enough to keep, with &#99999999; in it and &#233; too.')).includes('é'), true);
const News = require('./news.js');
threw = false;
let decoded = null;
try { decoded = News.decodeEntities('Bad &#99999999; and good &#233;'); } catch (e) { threw = true; }
check('the headline decoder survives it too', threw, false);
check('dropping only the bad reference', decoded, 'Bad  and good é');

console.log('does the page name the company');
check('the ticker as a word', NT.namesCompany('Shares of MU fell', 'MU', 'Micron Technology, Inc.'), true);
check('the ticker inside a word does not count', NT.namesCompany('MUCH ado about nothing', 'MU', ''), false);
check('the first word of the name, any case', NT.namesCompany('micron said', 'MU', 'Micron Technology, Inc.'), true);
check('a short stem is not used ("ON" relies on its ticker)', NT.namesCompany('turned on the lights', 'ON', 'ON Semiconductor'), false);
check('...and the ticker still finds it', NT.namesCompany('ON Semiconductor (ON) rose', 'ON', 'ON Semiconductor'), true);
check('absent entirely', NT.namesCompany('NASA wants a new space station', 'NVDA', 'NVIDIA Corporation'), false);

console.log('checks on the answer');
const good = { readable: true, about: 'primary', kind: 'results', tone: 0.4, summary: 'Revenue rose 20% on data centre demand.', complete: true };
check('a well-formed answer passes', NT.check(good).ok, true);
check('"Buy rating" is refused', NT.check(Object.assign({}, good, { summary: 'An analyst kept a Buy rating.' })).ok, false);
check('"price target" is refused', NT.check(Object.assign({}, good, { summary: 'The price target went to $200.' })).ok, false);
check('"bullish" is refused', NT.check(Object.assign({}, good, { summary: 'Writers were bullish on it.' })).ok, false);
check('"buyback" passes (not the word buy)', NT.check(Object.assign({}, good, { summary: 'It announced a $10 billion buyback.' })).ok, true);
check('"holdings" passes (not the word hold)', NT.check(Object.assign({}, good, { summary: 'A fund trimmed its holdings by 5%.' })).ok, true);
check('"selling a unit" passes (not the word sell)', NT.check(Object.assign({}, good, { summary: 'It is selling a unit to a rival.' })).ok, true);
check('tone +1 passes (on the line)', NT.check(Object.assign({}, good, { tone: 1 })).ok, true);
check('tone 1.01 is refused', NT.check(Object.assign({}, good, { tone: 1.01 })).ok, false);
check('tone -1.01 is refused', NT.check(Object.assign({}, good, { tone: -1.01 })).ok, false);
check('an invented kind is refused', NT.check(Object.assign({}, good, { kind: 'rumour' })).ok, false);
check('480 characters pass', NT.check(Object.assign({}, good, { summary: 'a'.repeat(480) })).ok, true);
check('481 characters are refused', NT.check(Object.assign({}, good, { summary: 'a'.repeat(481) })).ok, false);
check('an empty summary on a readable article is refused', NT.check(Object.assign({}, good, { summary: ' ' })).ok, false);
check('an empty summary on an unreadable page passes', NT.check(Object.assign({}, good, { readable: false, summary: '' })).ok, true);
check('only-summary problems are labelled as such', NT.check(Object.assign({}, good, { summary: 'Hold it.' })).problems.every((p) => /^summary/.test(p)), true);

console.log('the request');
const req = NT.request({ symbol: 'MU', name: 'Micron', headline: 'H', source: 'S', text: 'x'.repeat(NT.MAX_CHARS + 50) });
check('the model is Haiku 5.5 (since 2026-10-20)', req.model, 'claude-haiku-5-5');
check('JSON schema output', req.output_config.format.type, 'json_schema');
check('every schema object forbids extra keys', req.output_config.format.schema.additionalProperties, false);
check('text past the ceiling is cut, and the model is told', req.messages[0].content.includes('was cut to its first') && !req.messages[0].content.includes('x'.repeat(NT.MAX_CHARS + 1)), true);
check('the article sits inside tags', /<article>\n[\s\S]*\n<\/article>$/.test(req.messages[0].content), true);

console.log('the seven-day line');
check('nothing read is null, not zero', NT.summarise([]), null);
check('only unreadable rows is null', NT.summarise([{ status: 'unreadable', tone: null }]), null);
const rows = [
  { status: 'scored', about: 'primary', tone: 0.6 },
  { status: 'scored', about: 'mentioned', tone: -0.4 },        // a passing mention: left out, counted apart
  { status: 'scored', about: 'mentioned', tone: -0.3 },
  { status: 'scored', about: 'primary', tone: 0.1 },
  { status: 'scored', about: 'primary', tone: -0.3 },
  { status: 'scored', about: 'not_about', tone: 0.9 },       // off-topic: left out
  { status: 'skipped', about: null, tone: null },              // never read: left out
  { status: 'scored', about: 'primary', tone: null },          // no tone: left out, not counted as 0
];
const w = NT.summarise(rows);
check('count is the articles mainly about the company only', w.count, 3);
check('average over those three', Math.round(w.avg * 100) / 100, 0.13);
check('split by band', [w.positive, w.neutral, w.negative], [1, 1, 1]);
check('passing mentions counted apart', w.mentioned, 2);
check('only passing mentions is null, not zero', NT.summarise([{ status: 'scored', about: 'mentioned', tone: -0.5 }]), null);

console.log('the promo cards agree with this module');
require('./private/cards.js');
const C = globalThis.Cards;
check('the cards restate the same band', C.toneBand, NT.BAND);
// Every hundredth from -1 to +1: the card's label (read off a drawn chip)
// must be this module's. Drawn through the real card, not a copy.
let disagree = 0;
for (let i = -100; i <= 100; i++) {
  const t = i / 100;
  const html = C.build('tonestock', { stocks: [{ symbol: 'X', name: 'X Corp' }], size: { id: 'portrait', w: 1080, h: 1350 }, opts: { tnsSym: 'X' },
    getToneStock: () => ({ items: [{ headline: 'H', tone: t, published_at: '2026-10-18T00:00:00Z' }], week: null }) });
  const m = html.match(/class="tn-chip"[^>]*>([A-Za-z]+) /);
  if (!m || m[1] !== NT.label(t)) disagree++;
}
check('chip label matches label() at every hundredth from -1 to +1', disagree, 0);
check('an unknown group falls back to all', C.toneBoardNeed('indtone', { itnGroup: 'Banks' }).group, 'all');
check('an unknown window falls back to 7 days', C.toneBoardNeed('indtone', { itnWin: '365' }).days, 7);
check('other templates ask for nothing', [C.toneBoardNeed('optoi', {}), C.toneStockNeed('optoi', {})], [null, null]);
const bannedHead = C.build('tonestock', { stocks: [{ symbol: 'X', name: 'X Corp' }], size: { id: 'portrait', w: 1080, h: 1350 }, opts: { tnsSym: 'X' },
  getToneStock: () => ({ items: [{ headline: 'Should You Buy an Index Fund Now?', tone: 0.1 }, { headline: 'X ships its new chip', tone: 0.4 }], week: null }) });
check('a headline saying buy is passed over on the card', /Index Fund/.test(bannedHead), false);
check('...and the next article takes its place', /ships its new chip/.test(bannedHead), true);

console.log('the boundary: the Signal never reads a tone');
const base = {
  symbol: 'TEST', portfolios: ['Watchlist'], marketCap: 150e9, netIncomeTtm: 5e9, profitMargin: 20, fcfTtm: 4e9, fcfMargin: 12,
  forwardPe: 25, roe: 18, qualityRating: 9, earningsGrowthYoY: 20, revenueGrowthYoY: 15, grossMargin: 55, shortPctFloat: 2,
  vs200ma: 6, vs50ma: 4, rsi: 55, oneMonthPct: 3, threeMonthPct: 8, pctFromHigh: -8, volTrend: 2, historyDays: 400,
  nextEarningsDate: '2026-10-20', latestDate: '2026-09-11',
};
const cfg = A.resolve({}, undefined).cfg;
const verdict = (r) => { const v = A.evaluate(r, cfg); return [v.type, v.action, v.flag]; };
const plain = verdict(base);
for (const [what, extra] of [
  ['absent', {}],
  ['present and favourable', { tone: 0.9, toneAvg: 0.9, newsTone: { avg: 0.9, count: 12 } }],
  ['present and lying', { tone: -1, toneAvg: -1, newsTone: { avg: -1, count: 99, positive: 0, negative: 99 } }],
]) check(`same verdict with tone fields ${what}`, verdict(Object.assign({}, base, extra)), plain);

// Which stocks are read (2026-10-20): the two semiconductor industries, and every S&P 500 member.
const SP = new Set(['AAPL', 'JPM', 'NVDA']);
check('scope: a semiconductor stock outside the S&P 500', NewsTone.inScope({ symbol: 'ACLS', industry: 'Semiconductor Equipment & Materials' }, SP), true);
check('scope: an S&P 500 member in any industry', NewsTone.inScope({ symbol: 'JPM', industry: 'Banks - Diversified' }, SP), true);
check('scope: lower-case symbols match', NewsTone.inScope({ symbol: 'aapl', industry: 'Consumer Electronics' }, SP), true);
check('scope: neither, not read', NewsTone.inScope({ symbol: 'ROKU', industry: 'Entertainment' }, SP), false);
check('scope: no S&P file, the semiconductors still', NewsTone.inScope({ symbol: 'MU', industry: 'Semiconductors' }, null), true);
check('scope: no S&P file, nothing else', NewsTone.inScope({ symbol: 'JPM', industry: 'Banks - Diversified' }, null), false);
check('scope: no row', NewsTone.inScope(null, SP), false);


// ---- importance and the same story (2026-10-24) ------------------------------
{
  const imp = NewsTone.importance;
  check('importance: results about the company is high', imp({ about: 'primary', kind: 'results', event: true }), 'high');
  check('importance: a results preview (no new event) drops to medium', imp({ about: 'primary', kind: 'results', event: false }), 'medium');
  check('importance: an older reading with no answer keeps its kind', imp({ about: 'primary', kind: 'deal', event: null }), 'high');
  check('importance: an analyst action is medium', imp({ about: 'primary', kind: 'analyst', event: false }), 'medium');
  check('importance: opinion is low', imp({ about: 'primary', kind: 'opinion', event: false }), 'low');
  check('importance: an "other" article reporting an event rises to medium', imp({ about: 'primary', kind: 'other', event: true }), 'medium');
  check('importance: a passing mention is low whatever its kind', imp({ about: 'mentioned', kind: 'results', event: true }), 'low');
  check('importance: four articles on one story raise it a level', imp({ about: 'primary', kind: 'analyst', event: false }, 4), 'high');
  check('importance: three do not', imp({ about: 'primary', kind: 'analyst', event: false }, 3), 'medium');
  check('importance: a price recap told four times rises only to medium', imp({ about: 'primary', kind: 'price_move', event: false }, 6), 'medium');
  const g = NewsTone.storyGroups([
    { symbol: 'META', headline: 'Meta Platforms beats third-quarter revenue estimates, raises capex forecast' },
    { symbol: 'META', headline: 'Meta beats revenue estimates and raises capex forecast for 2026' },
    { symbol: 'META', headline: 'Why Meta stock is a long-term winner' },
    { symbol: 'AAPL', headline: 'Apple beats revenue estimates and raises capex forecast for 2026' },
  ]);
  check('story: two headlines on the same results are one story', g[0] === g[1], true);
  check('story: an unrelated piece is its own', g[2] !== g[0], true);
  check('story: another company is never the same story', g[3] !== g[1], true);
  const g2 = NewsTone.storyGroups([
    { symbol: 'AXP', about: 'primary', kind: 'results', headline: 'American Express Q3 Earnings Beat Estimates on Strong Card Fees' },
    { symbol: 'AXP', about: 'primary', kind: 'results', headline: 'American Express To Cut 5% Of Global Workforce; Raises 2026 EPS Outlook' },
    { symbol: 'AXP', about: 'primary', kind: 'opinion', headline: 'American Express: 3 Key Takeaways for Long-Term Investors' },
    { symbol: 'AXP', about: 'primary', kind: 'analyst', headline: 'American Express stock trades down, here is why' },
  ], () => 'American Express');
  check('story: one company’s results articles on a day are one story', g2[0] === g2[1], true);
  check('story: its name is not what makes two headlines alike', g2[2] !== g2[3] && g2[2] !== g2[0], true);
}

console.log(`\n${n - failed} of ${n} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exitCode = failed ? 1 : 0;
