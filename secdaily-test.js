// secdaily-test.js: the daily index reader. node secdaily-test.js
'use strict';
const D = require('./secdaily.js');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL', m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b));

// ---- dates ----
// Monday 2026-10-19, Tuesday 20th: Tuesday morning reads Monday only.
eq(D.datesToRead('2026-10-16', '2026-10-20', 3), ['2026-10-19'], 'Tue reads Mon (Fri done)');
// Friday done, run on Monday: the weekend is skipped, nothing to read yet.
eq(D.datesToRead('2026-10-16', '2026-10-19', 3), [], 'Mon morning: weekend skipped, today not asked');
// Never today; capped at max; oldest first.
eq(D.datesToRead('2026-10-12', '2026-10-20', 3), ['2026-10-13', '2026-10-14', '2026-10-15'], 'capped at three, oldest first');
eq(D.datesToRead('2026-10-12', '2026-10-20', 10), ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19'], 'all weekdays up to yesterday');
eq(D.datesToRead('2026-10-19', '2026-10-20', 3), [], 'up to date');
// First run: four business days back, so three days are read.
eq(D.startThrough('2026-10-20'), '2026-10-14', 'start through (Tue)');
eq(D.datesToRead(D.startThrough('2026-10-20'), '2026-10-20', 3), ['2026-10-15', '2026-10-16', '2026-10-19'], 'first run reads three');
// Month and year edges.
eq(D.addDays('2026-12-31', 1), '2027-01-01', 'year edge');
eq(D.datesToRead('2026-12-31', '2027-01-05', 5), ['2027-01-01', '2027-01-04'], 'across new year (1 Jan is a weekday; its missing index is a holiday)');
// Today in New York, whatever the machine's zone: 03:00 UTC on the 20th is
// still the 19th in New York.
eq(D.todayET(new Date('2026-10-20T03:00:00Z')), '2026-10-19', 'today ET before midnight ET');
eq(D.todayET(new Date('2026-10-20T15:00:00Z')), '2026-10-20', 'today ET in the day');
// A missing index: recent means not published yet, old means a holiday.
eq(D.missingMeans('2026-10-19', '2026-10-20'), 'not yet', 'yesterday missing: not yet');
eq(D.missingMeans('2026-10-13', '2026-10-20'), 'holiday', 'a week back missing: holiday');
eq(D.missingMeans('2026-10-16', '2026-10-19'), 'not yet', 'Friday missing on Monday: not yet');

// ---- the index's address ----
eq(D.indexUrl('2026-10-19'), 'https://www.sec.gov/Archives/edgar/daily-index/2026/QTR4/master.20261019.idx', 'Q4 url');
eq(D.indexUrl('2026-03-31'), 'https://www.sec.gov/Archives/edgar/daily-index/2026/QTR1/master.20260331.idx', 'Q1 edge');
eq(D.indexUrl('2026-04-01'), 'https://www.sec.gov/Archives/edgar/daily-index/2026/QTR2/master.20260401.idx', 'Q2 start');

// ---- parsing (the real file's shape: a preamble, dashes, pipe rows) ----
const IDX = [
  'Description:           Daily Index of EDGAR Dissemination Feed by Company Name',
  'Last Data Received:    October 19, 2026',
  'Comments:              webmaster@sec.gov',
  '',
  'CIK|Company Name|Form Type|Date Filed|File Name',
  '--------------------------------------------------------------------------------',
  '320193|Apple Inc.|8-K|20261019|edgar/data/320193/0000320193-26-000101.txt',
  '320193|Apple Inc.|4|20261019|edgar/data/320193/0000320193-26-000102.txt',
  '1045810|NVIDIA CORP|SCHEDULE 13G/A|20261019|edgar/data/1045810/0000102909-26-001.txt',
  '102909|VANGUARD GROUP INC|SCHEDULE 13G/A|20261019|edgar/data/102909/0000102909-26-001.txt',
  '1652044|Alphabet Inc.|SCHEDULE 13D|20261019|edgar/data/1652044/0001-26-1.txt',
  '999999|SOMEBODY ELSE|8-K|20261019|edgar/data/999999/x.txt',
  '1018724|AMAZON COM INC|10-Q|20261019|edgar/data/1018724/y.txt',
  '1018724|AMAZON COM INC|8-K/A|20261019|edgar/data/1018724/z.txt',
  'garbage line without pipes',
  '|empty cik|8-K|20261019|x',
].join('\r\n');
const lines = D.parseIndex(IDX);
eq(lines.map((l) => l.cik + ' ' + l.form), ['320193 8-K', '1045810 SCHEDULE 13G/A', '102909 SCHEDULE 13G/A', '1652044 SCHEDULE 13D', '999999 8-K', '1018724 8-K/A'], 'only the forms that matter, header and junk skipped');
eq(lines.map((l) => l.kind), ['8-K', '13G', '13G', '13D', '8-K', '8-K'], 'kinds');
eq(D.parseIndex('no dashes here\n320193|Apple|8-K|20261019|f'), [], 'no header line, nothing read');
eq(D.parseIndex(''), [], 'empty');

// ---- matching against the tracked companies ----
const state = { AAPL: { cik: 320193 }, NVDA: { cik: 1045810 }, GOOGL: { cik: 1652044 }, GOOG: { cik: 1652044 }, AMZN: { cik: 1018724 },
  SPY: { cik: null }, OLD: { cik: 999999 } };
const ciks = D.cikMap(state, ['AAPL', 'NVDA', 'GOOGL', 'GOOG', 'AMZN', 'SPY']);
ok(!ciks.has(999999), 'a symbol outside the universe is not matched (OLD is retired)');
ok(ciks.get(1652044).join() === 'GOOGL,GOOG', 'two share classes, one CIK');
const m = D.match(lines, ciks);
eq(m.symbols, ['AAPL', 'NVDA', 'GOOGL', 'GOOG', 'AMZN'], 'symbols once each, first seen first');
ok(!m.hits.some((h) => h.symbol === 'VGD'), 'the 13G filer (Vanguard) is not a tracked company');
eq(m.hits.filter((h) => h.symbol === 'NVDA').map((h) => h.kind), ['13G'], 'the 13G about NVIDIA is matched by its subject');
eq(D.match(lines, new Map()).symbols, [], 'nothing tracked, nothing matched');


// ---- the whole step, with stand-ins for the network and the database ----
// REAL_DAY is an excerpt of the SEC's own master index for 2026-10-19 (read
// once on 2026-10-20): its header, the 13G lines about Universal Health,
// TeraWulf and CleanSpark (three for CleanSpark), and some lines about
// companies we do not track. The filer's own lines are not in the excerpt;
// the subject's lines are what the match relies on.
const REAL_DAY = "Description:           Daily Index of EDGAR Dissemination Feed\nLast Data Received:    Oct 19, 2026\nComments:              webmaster@sec.gov\nAnonymous FTP:         ftp://ftp.sec.gov/edgar/\n \nCIK|Company Name|Form Type|Date Filed|File Name\n--------------------------------------------------------------------------------\n1083301|TERAWULF INC.|SCHEDULE 13G/A|20261019|edgar/data/1083301/0000009631-26-000037.txt\n352915|UNIVERSAL HEALTH SERVICES INC|SCHEDULE 13G|20261019|edgar/data/352915/0001027796-26-000057.txt\n827876|CLEANSPARK, INC.|SCHEDULE 13G/A|20261019|edgar/data/827876/0000009631-26-000028.txt\n827876|CLEANSPARK, INC.|SCHEDULE 13G/A|20261019|edgar/data/827876/0000009631-26-000029.txt\n827876|CLEANSPARK, INC.|SCHEDULE 13G/A|20261019|edgar/data/827876/0000009631-26-000030.txt\n1000209|MEDALLION FINANCIAL CORP|8-K|20261019|edgar/data/1000209/0001140361-26-040112.txt\n1001907|ASTROTECH Corp|8-K|20261019|edgar/data/1001907/0001437749-26-032941.txt\n10048|BARNWELL INDUSTRIES INC|8-K|20261019|edgar/data/10048/0001140361-26-039979.txt\n1015328|WINTRUST FINANCIAL CORP|8-K|20261019|edgar/data/1015328/0001015328-26-000026.txt\n1022671|STEEL DYNAMICS INC|8-K|20261019|edgar/data/1022671/0001104659-26-116898.txt\n1038773|SMARTFINANCIAL INC.|8-K|20261019|edgar/data/1038773/0001104659-26-116936.txt\n1504678|Loop Industries, Inc.|10-Q|20261015|edgar/data/1504678/0001437749-26-032746.txt\n1616262|Rocky Mountain Chocolate Factory, Inc.|10-Q|20261019|edgar/data/1616262/0001193125-26-425389.txt\n1500541|OLDRIDGE PHILLIP|SCHEDULE 13D|20261019|edgar/data/1500541/0000919574-26-007073.txt\n1991261|Rantizo|SCHEDULE 13D|20261019|edgar/data/1991261/0000919574-26-007073.txt";
const TRACKED = { UHS: { cik: 352915 }, WULF: { cik: 1083301 }, CLSK: { cik: 827876 }, STLD: { cik: 1022671 }, AAPL: { cik: 320193 }, NOCIK: { cik: null } };
function rig(opts) {
  const o = opts || {};
  const calls = { index: [], one: [] };
  let stored = o.state === undefined ? null : JSON.parse(JSON.stringify(o.state));
  const deps = {
    today: o.today || '2026-10-20', dates: 2, n: o.n || 6, now: 1,
    readState: async () => (stored ? JSON.parse(JSON.stringify(stored)) : null),
    writeState: async (st) => { stored = JSON.parse(JSON.stringify(st)); },
    loadCiks: async () => ({ ciks: D.cikMap(TRACKED, Object.keys(TRACKED)), cikOf: (s) => Number(TRACKED[s] && TRACKED[s].cik) }),
    fetchIndex: async (d) => { calls.index.push(d); const f = (o.index || {})[d]; if (f instanceof Error) throw f; return f || { status: 404, text: '' }; },
    readOne: async (s, c) => { calls.one.push(s); return (o.one && o.one(s, c, calls.one.length)) || { ok: true }; },
  };
  return { deps, calls, state: () => stored };
}
(async () => {
  // A normal morning: Friday was read, Tuesday reads Monday's index.
  {
    const r = rig({ state: { through: '2026-10-16', pending: [] }, index: { '2026-10-19': { status: 200, text: REAL_DAY } } });
    const a = await D.step(r.deps);
    eq(r.calls.index, ['2026-10-19'], 'reads Monday only');
    eq(a.read[0], { date: '2026-10-19', companies: 4, filings: { '13G': 5, '8-K': 1 } }, 'four tracked companies: three 13G subjects and Steel Dynamics 8-K');
    eq(r.calls.one, ['WULF', 'UHS', 'CLSK', 'STLD'], 'each company read once, CleanSpark once for its three 13Gs');
    ok(a.done && a.remaining === 0 && a.through === '2026-10-19', 'done, nothing left, through Monday');
    eq(r.state().through, '2026-10-19', 'state remembers Monday');
    const b = await D.step(r.deps);
    ok(b.done && !b.read.length && !b.fetched && r.calls.index.length === 1, 'a second call the same day reads nothing again');
  }
  // The queue spans calls when there are more companies than one call takes.
  {
    const r = rig({ state: { through: '2026-10-16', pending: [] }, n: 3, index: { '2026-10-19': { status: 200, text: REAL_DAY } } });
    const a = await D.step(r.deps);
    ok(!a.done && a.fetched === 3 && a.remaining === 1, 'three of four, one left');
    eq(r.state().pending, [['STLD', 1022671]], 'the queue is stored with its CIK');
    const b = await D.step(r.deps);
    ok(b.done && b.fetched === 1 && r.calls.index.length === 1, 'the next call finishes the queue without rereading the index');
  }
  // First run: no state, starts four business days back, reads two days a call.
  {
    const r = rig({ state: null, index: { '2026-10-15': { status: 200, text: REAL_DAY.replace(/20261019/g, '20261015') }, '2026-10-16': { status: 200, text: '' }, '2026-10-19': { status: 200, text: REAL_DAY } } });
    const a = await D.step(r.deps);
    eq(r.calls.index, ['2026-10-15', '2026-10-16'], 'first call reads the two oldest');
    ok(!a.done && a.through === '2026-10-16', 'not done: Monday still to read');
    const b = await D.step(r.deps);
    eq(r.calls.index, ['2026-10-15', '2026-10-16', '2026-10-19'], 'second call reads Monday');
    ok(b.done && b.through === '2026-10-19', 'then done');
  }
  // Yesterday's index not published yet: stop, keep the day, try next run.
  {
    const r = rig({ state: { through: '2026-10-16', pending: [] }, index: {} });
    const a = await D.step(r.deps);
    ok(a.done && a.through === '2026-10-16' && /not published/.test(a.notes.join()), 'not yet: done for now, through unchanged');
  }
  // A day long past with no index is a holiday: stepped over.
  {
    const r = rig({ state: { through: '2026-10-08', pending: [] }, index: { '2026-10-12': { status: 200, text: REAL_DAY } } });
    const a = await D.step(r.deps);
    eq(a.read.map((x) => x.holiday ? x.date + ' holiday' : x.date), ['2026-10-09 holiday', '2026-10-12'], 'holiday stepped over, next day read');
    ok(a.through === '2026-10-12', 'through moves past the holiday');
  }
  // The SEC slows us down, on the index or on a company: stop, keep the queue.
  {
    const r = rig({ state: { through: '2026-10-16', pending: [] }, index: { '2026-10-19': { status: 429, text: '' } } });
    const a = await D.step(r.deps);
    ok(a.done && a.through === '2026-10-16' && !r.calls.one.length, 'index 429: stop, nothing read, day kept');
    const r2 = rig({ state: { through: '2026-10-16', pending: [] }, index: { '2026-10-19': { status: 200, text: REAL_DAY } }, one: (s, c, k) => (k === 2 ? { throttled: true } : null) });
    const b = await D.step(r2.deps);
    ok(b.done && b.fetched === 1 && b.remaining === 3, 'company 429: done for now, three still queued');
    eq(r2.state().pending.map((p) => p[0]), ['UHS', 'CLSK', 'STLD'], 'the throttled company stays first in the queue');
  }
  // A network failure on the index, and a company whose list fails.
  {
    const r = rig({ state: { through: '2026-10-16', pending: [] }, index: { '2026-10-19': new Error('socket hang up') } });
    const a = await D.step(r.deps);
    ok(a.done && a.through === '2026-10-16' && /could not be read/.test(a.notes.join()), 'index unreadable: done for now, day kept');
    const r2 = rig({ state: { through: '2026-10-16', pending: [] }, index: { '2026-10-19': { status: 200, text: REAL_DAY } }, one: (s) => (s === 'UHS' ? { status: 500 } : null) });
    const b = await D.step(r2.deps);
    ok(b.done && b.fetched === 3 && b.remaining === 0 && !b.symbols.includes('UHS'), 'a failed company leaves the queue (the rotation still reaches it)');
  }
  // A queued symbol without a CIK is dropped without a request.
  {
    const r = rig({ state: { through: '2026-10-19', pending: [['NOCIK', 0], ['AAPL', 320193]] } });
    const a = await D.step(r.deps);
    eq(r.calls.one, ['AAPL'], 'no request for a symbol with no CIK');
    ok(a.done, 'done');
  }
  // SAME-DAY RESULTS 8-Ks: the live feed, as the SEC printed it on 2026-10-27.
  {
    const entry = (title, cik, filed, accn, items, form) => `<entry>
<title>${form || '8-K'} - ${title} (${cik}) (Filer)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1/x-index.htm"/>
<summary type="html">
 &lt;b&gt;Filed:&lt;/b&gt; ${filed} &lt;b&gt;AccNo:&lt;/b&gt; ${accn} &lt;b&gt;Size:&lt;/b&gt; 2 MB
${items.map((i) => '&lt;br&gt;Item ' + i + ': Something').join('\n')}
</summary>
<updated>${filed}T07:03:00-04:00</updated>
<category scheme="https://www.sec.gov/" label="form type" term="${form || '8-K'}"/>
<id>urn:tag:sec.gov,2008:accession-number=${accn}</id>
</entry>`;
    const FEED = '<?xml version="1.0"?><feed><title>Latest Filings</title>'
      + entry('SoFi Technologies, Inc.', '0001818874', '2026-10-27', '0001818874-26-000065', ['2.02', '9.01'])
      + entry('Federal Home Loan Bank of Indianapolis', '0001331754', '2026-10-27', '0001331754-26-000209', ['2.02', '9.01'])
      + entry('Alphabet Inc.', '0001652044', '2026-10-27', '0001652044-26-000099', ['5.02'])
      + entry('Travel &amp; Leisure Co.', '0001361658', '2026-10-26', '0001361658-26-000050', ['2.02', '7.01', '9.01'], '8-K/A')
      + entry('Alphabet Inc.', '0001652044', '2026-10-24', '0001652044-26-000090', ['2.02', '9.01'])
      + '</feed>';
    const es = D.parseCurrent(FEED);
    eq(es.length, 5, 'feed: five entries read');
    eq(es[0], { cik: 1818874, form: '8-K', filed: '2026-10-27', accn: '0001818874-26-000065', items: '2.02,9.01' }, 'feed: SoFi read whole');
    eq(es[3].form, '8-K/A', 'feed: an amendment keeps its form');
    const ciks = new Map([[1818874, ['SOFI']], [1652044, ['GOOGL', 'GOOG']], [1361658, ['TNL']]]);
    const hits = D.resultsFiled(es, ciks, '2026-10-26');
    eq(hits.map((h) => h.symbol), ['SOFI', 'TNL'], 'results since the day before: tracked, item 2.02 only (Alphabet 5.02 out, the untracked bank out)');
    eq(hits[0].accns, ['0001818874-26-000065'], 'the accession number travels with it');
    eq(D.resultsFiled(es, ciks, '2026-10-24').map((h) => h.symbol), ['SOFI', 'TNL', 'GOOGL', 'GOOG'], 'further back: both share classes, each once');
    eq(D.prevBusinessDay('2026-10-27'), '2026-10-26', 'previous business day: Tuesday -> Monday');
    eq(D.prevBusinessDay('2026-10-26'), '2026-10-23', 'Monday -> Friday');
    eq(D.prevBusinessDay('2026-10-31'), '2026-10-30', 'Saturday -> Friday');
    eq(D.parseCurrent('<feed><entry><title>garbage</title></entry></feed>'), [], 'an entry without the fields is dropped');
    ok(/getcurrent&type=8-K.*start=200&count=100&output=atom/.test(D.currentUrl(200)), 'feed url pages by a hundred');
  }
  console.log(n + ' checks, ' + bad + ' failed');
  process.exit(bad ? 1 : 0);
})();
