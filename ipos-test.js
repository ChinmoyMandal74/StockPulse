// ipos-test.js — the IPO pipeline's rules (ipos.js), with no network and no
// database: the fetches and the storage are handed in as fakes.
//   node ipos-test.js
'use strict';
const I = require('./ipos.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('FAIL ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + ' -- got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b));

// A submissions file in the SEC's shape.
const sub = (o) => {
  const f = o.filings || [];
  return { name: o.name || 'Co', sic: o.sic || '7372', sicDescription: 'Services-Prepackaged Software', stateOfIncorporation: 'DE',
    tickers: o.tickers || [], exchanges: o.exchanges || [],
    filings: { recent: { form: f.map((x) => x[0]), filingDate: f.map((x) => x[1]), accessionNumber: f.map((x, i) => x[2] || ('0000000000-26-' + String(100000 + i))), primaryDocument: f.map((x) => x[3] || 'doc.htm') } } };
};

// ---- the daily index ----
{
  const idx = 'Description: Daily Index\n\nCIK|Company Name|Form Type|Date Filed|Filename\n'
    + '--------------------------------------------------------------------------------\n'
    + '2130357|Anthropic, PBC|S-1/A|20261102|edgar/data/2130357/0001628280-26-068676.txt\n'
    + '1130598|Traws Pharma, Inc.|S-1|20261026|edgar/data/1130598/0001104659-26-118813.txt\n'
    + '320193|Apple Inc.|8-K|20261102|edgar/data/320193/0000320193-26-000101.txt\n'
    + '1579878|Figma, Inc.|424B4|2025-07-31|edgar/data/1579878/0001628280-25-037014.txt\n'
    + '1084937|Green Rain Energy|1-A POS|20261026|edgar/data/1084937/0001683168-26-008084.txt\n'
    + 'garbage line\n';
  const L = I.parseIndex(idx);
  eq(L.map((l) => l.form), ['S-1/A', 'S-1', '424B4'], 'parseIndex keeps only the registration forms');
  eq(L[0], { cik: 2130357, name: 'Anthropic, PBC', form: 'S-1/A', filed: '2026-11-02', accn: '0001628280-26-068676' }, 'parseIndex reads a line');
  eq(L[2].filed, '2025-07-31', 'parseIndex takes a dashed date as well');
  eq(I.parseIndex(''), [], 'parseIndex of nothing');
}

// ---- who is going public for the first time ----
{
  const anth = sub({ filings: [['DRS', '2026-06-01'], ['DRS/A', '2026-07-13'], ['S-1', '2026-10-26'], ['S-1/A', '2026-11-02']] });
  eq(I.judge(anth, '2026-11-02').keep, true, 'a company with only drafts and an S-1 is kept');
  eq(I.judge(sub({ sic: '6770', filings: [['S-1', '2026-01-06']] }), '2026-01-06').keep, false, 'a SPAC is left out');
  const follow = sub({ filings: [['10-K', '2024-03-01'], ['10-Q', '2026-08-10'], ['S-1', '2026-10-26']] });
  eq(I.judge(follow, '2026-10-26'), { keep: false, reason: 'already public: 10-K filed 2024-03-01' }, 'a follow-on by a reporting company is left out');
  // Listed since: reports after the first S-1 do not make it a follow-on.
  const fig = sub({ tickers: ['FIG'], filings: [['DRS', '2025-04-15'], ['S-1', '2025-07-01'], ['424B4', '2025-07-31'], ['10-Q', '2025-09-05']] });
  eq(I.judge(fig, '2025-07-01').keep, true, 'a company that listed later is still judged on its first registration');
  eq(I.judge(sub({ filings: [['10-Q', '2026-01-01']] }), '2026-02-01').keep, false, 'no registration on the list: judged on the trigger day');
  eq(I.judge(null).keep, false, 'no list, not kept');
  // Listed before the period read, registering more shares inside it.
  const before = sub({ tickers: ['GCDT'], filings: [['S-1', '2022-05-26'], ['424B4', '2022-07-01'], ['10-Q', '2022-08-10'], ['S-1', '2025-05-01']] });
  eq(I.judge(before, '2025-05-01').keep, false, 'a company that listed before the S-1 that brought it here is left out');
  // The older filings.
  const busy = sub({ filings: [['4', '2025-08-29'], ['10-Q', '2025-11-13']] });
  busy.filings.files = [{ name: 'old-001.json', filingFrom: '2019-03-11', filingTo: '2025-08-27' }, { name: 'old-000.json', filingFrom: '2010-01-01', filingTo: '2019-03-10' }];
  eq(I.olderFiles(busy, '2024-03-03'), ['old-001.json'], 'olderFiles: only the files reaching the day asked');
  eq(I.olderFiles(busy, '2025-09-01'), [], 'olderFiles: none when the recent list reaches the day');
  const merged = I.mergeOlder(busy, [{ form: ['S-1'], filingDate: ['2025-03-03'], accessionNumber: ['x-1'], primaryDocument: ['s1.htm'] }]);
  eq(I.history(merged).map((x) => x.filed + ' ' + x.form), ['2025-03-03 S-1'], 'mergeOlder adds the older filings');

}

// ---- where a company stands ----
{
  const st = (o) => { const s = sub(o); return I.status(s, I.history(s)); };
  eq(st({ filings: [['DRS', '2026-06-01']] }), 'confidential', 'drafts only');
  eq(st({ filings: [['DRS', '2026-06-01'], ['S-1', '2026-10-26']] }), 'filed', 'a public S-1');
  eq(st({ filings: [['S-1', '2026-01-01'], ['RW', '2026-03-01']] }), 'withdrawn', 'withdrawn after its S-1');
  eq(st({ filings: [['S-1', '2025-01-01'], ['RW', '2025-03-01'], ['S-1', '2026-03-01']] }), 'filed', 'filed again after a withdrawal');
  eq(st({ filings: [['S-1', '2026-01-01'], ['EFFECT', '2026-02-01'], ['424B4', '2026-02-02']] }), 'priced', 'a final prospectus');
  eq(st({ tickers: ['FIG'], filings: [['S-1', '2025-07-01'], ['424B4', '2025-07-31']] }), 'listed', 'a ticker listed');
  eq(st({ tickers: ['TRCX'], filings: [['F-1', '2026-04-24'], ['EFFECT', '2026-06-01'], ['F-1/A', '2026-10-29']] }), 'filed', 'a ticker held while still amending is not listed');
  eq(st({ tickers: ['FIG'], filings: [['S-1', '2025-07-01'], ['424B4', '2025-07-31'], ['S-1', '2026-02-01']] }), 'listed', 'a resale S-1 after listing does not undo it');
  eq(st({ tickers: ['DL'], filings: [['S-1', '2026-01-01'], ['EFFECT', '2026-02-01']] }), 'listed', 'a direct listing: effective, with a ticker');
  eq(I.history(sub({ filings: [['S-1', '2026-01-01'], ['8-K', '2026-01-02'], ['10-Q', '2026-02-01']] })).map((x) => x.form), ['S-1'], 'history keeps registration forms only');
}

// ---- the cover page ----
{
  const anth = '<p>We intend to list our Class A common stock on the <b>Nasdaq&#160;Global Select Market</b> under the symbol &#8220;ANT.&#8221; '
    + 'We anticipate that the initial public offering price per share will be between $ and $ .</p>';
  eq(I.parseCover(anth), { symbol: 'ANT', exchange: 'Nasdaq', market: 'Nasdaq Global Select Market', low: null, high: null, price: null, shares: null }, 'blank range, symbol and market');
  const rng = 'We are offering 20,000,000 shares of our common stock. The price will be between $17.00 and $19.00 per share. '
    + 'We have applied to list on the New York Stock Exchange under the symbol "ABCD".';
  const c = I.parseCover(rng);
  eq([c.symbol, c.exchange, c.low, c.high, c.shares], ['ABCD', 'NYSE', 17, 19, 20000000], 'a printed range');
  const fig = 'The initial public offering price per share of our Class A common stock is $33.00 . We have been approved to list our Class A common stock on the New York Stock Exchange (&ldquo;NYSE&rdquo;) under the symbol &ldquo;FIG.&rdquo;';
  eq([I.parseCover(fig).price, I.parseCover(fig).symbol, I.parseCover(fig).exchange], [33, 'FIG', 'NYSE'], 'the final price');
  eq(I.parseCover('quoted on the OTCQB under the symbol "TINY"').exchange, 'OTC', 'an over-the-counter quote');
  // A market named far from the symbol is not taken for it.
  const far = 'The Nasdaq Global Select Market is mentioned here. ' + 'x'.repeat(600) + ' under the symbol "ZZZ"';
  eq([I.parseCover(far).symbol, I.parseCover(far).exchange], ['ZZZ', null], 'the market is read only next to the symbol');
  eq(I.parseCover('between $5.00 and $3.00').low, null, 'a range upside down is not a range');
  eq(I.parseCover('').symbol, null, 'an empty cover');
  eq(I.parseCover('listed on Nasdaq under the symbol “SPCX”').exchange, 'Nasdaq', 'a bare Nasdaq');
  eq([I.parseCover('the Nasdaq Capital Market under the symbol "AB"').market, I.parseCover('the NYSE American under the symbol "AB"').exchange], ['Nasdaq Capital Market', 'NYSE American'], 'the longer name wins where both start');
}

// ---- the queue ----
{
  const a = I.enqueue(null, [{ cik: 1, form: 'S-1', filed: '2026-01-01', accn: 'a' }, { cik: 1, form: 'S-1/A', filed: '2026-01-02', accn: 'b' }]);
  eq(a.added, 2, 'enqueue adds');
  const b = I.enqueue(a.state, [{ cik: 1, form: 'S-1', accn: 'a' }, { cik: 2, form: 'S-1', accn: 'c' }, { cik: 0, accn: 'd' }]);
  eq([b.added, b.state.queue.length], [1, 3], 'enqueue skips what is queued and what has no CIK');
  const rc = I.rechecks([{ cik: 5, tracked: 1, status: 'priced', ticker: null }, { cik: 6, tracked: 1, status: 'priced', ticker: 'X' }, { cik: 7, tracked: 1, status: 'filed' }], {}, '2026-11-03');
  eq(rc.map((x) => x.cik), [5], 'rechecks: priced and not yet listed');
  eq(I.rechecks([{ cik: 5, tracked: 1, status: 'priced' }], { recheckDay: '2026-11-03' }, '2026-11-03'), [], 'rechecks once a day');
}

// ---- one step, with fakes ----
async function steps() {
  const mk = (subs, opts) => {
    const db = { state: { queue: [] }, companies: new Map(), filings: new Map(), calls: [] };
    const o = {
      n: (opts && opts.n) || 4, now: 1,
      readState: async () => JSON.parse(JSON.stringify(db.state)),
      writeState: async (st) => { db.state = JSON.parse(JSON.stringify(st)); },
      readCompany: async (cik) => db.companies.get(cik) || null,
      fetchSubs: async (cik) => { db.calls.push('subs ' + cik); const s = subs[cik]; return s === 429 ? { status: 429 } : s ? { status: 200, json: s } : { status: 404 }; },
      fetchOlder: async (name) => { db.calls.push('older ' + name); const s = subs['old:' + name]; return s ? { status: 200, json: s } : { status: 404 }; },
      fetchCover: async (url) => { db.calls.push('cover ' + url.split('/').pop()); return { status: 200, text: (opts && opts.cover) || 'under the symbol "NEW" on the Nasdaq Global Market' }; },
      saveCompany: async (row, hist) => { db.companies.set(row.cik, row); db.filings.set(row.cik, hist.map((h) => h.accn)); },
      skipCompany: async (cik, name, reason) => { db.companies.set(cik, { cik, name, tracked: 0, reason }); },
    };
    return { db, o };
  };
  const subs = {
    10: sub({ name: 'New Co', filings: [['DRS', '2026-06-01', 'd1'], ['S-1', '2026-10-26', 's1', 'news1.htm']] }),
    11: sub({ name: 'Old Co', filings: [['10-K', '2020-03-01'], ['S-1', '2026-10-26']] }),
    12: 429,
  };
  {
    const { db, o } = mk(subs);
    db.state.queue = [{ cik: 10, form: 'EFFECT', accn: 'q1', filed: '2026-10-26' }, { cik: 10, form: 'S-1', accn: 'q2', filed: '2026-10-27' }, { cik: 11, form: 'S-1', accn: 'q3' }];
    const out = await I.step(o);
    eq([out.kept, out.skipped, out.remaining, out.done], [['New Co'], ['Old Co'], 0, true], 'a step keeps one, leaves one out, empties the queue');
    eq(db.companies.get(10).symbol, 'NEW', 'the cover is read for a kept company');
    eq(db.filings.get(10), ['d1', 's1'], 'its whole registration history is stored, drafts included');
    eq(db.companies.get(11).tracked, 0, 'the one left out is remembered');
    // Again: the one left out costs nothing; the kept one with an unchanged cover reads no cover.
    db.calls = [];
    db.state.queue = [{ cik: 11, accn: 'q4' }, { cik: 10, accn: 'q5' }];
    await I.step(o);
    eq(db.calls, ['subs 10'], 'a remembered company costs no request; an unchanged cover is not read again');
  }
  {
    const { db, o } = mk(subs);
    db.state.queue = [{ cik: 12, form: 'S-1', accn: 'q1' }, { cik: 10, form: 'S-1', accn: 'q2' }];
    const out = await I.step(o);
    eq([out.blocked, out.done, out.remaining], [true, true, 2], 'a 429 stops the step and keeps the queue');
  }
  {
    const { db, o } = mk(subs, { n: 1 });
    db.state.queue = [{ cik: 10, form: 'S-1/A', accn: 'q1' }, { cik: 11, form: 'F-1', accn: 'q2' }];
    const out = await I.step(o);
    eq([out.done, out.remaining], [false, 1], 'a step stops at n companies and says it is not done');
  }
  {
    // CoreWeave: its S-1 pushed out of the recent list by trading reports.
    const cw = sub({ name: 'Busy Co', tickers: ['BUSY'], filings: [['4', '2025-08-29'], ['10-Q', '2025-11-13']] });
    cw.filings.files = [{ name: 'cw-001.json', filingFrom: '2019-03-11', filingTo: '2025-08-27' }];
    const { db, o } = mk({ 20: cw, 'old:cw-001.json': { form: ['DRS', 'S-1', '424B4'], filingDate: ['2024-12-01', '2025-03-03', '2025-03-28'], accessionNumber: ['c1', 'c2', 'c3'], primaryDocument: ['d.htm', 's.htm', 'p.htm'] } });
    db.state.queue = [{ cik: 20, form: 'S-1', filed: '2025-03-03', accn: 'c2' }];
    await I.step(o);
    const c = db.companies.get(20);
    eq([c && c.tracked, c && c.status, db.filings.get(20)], [1, 'listed', ['c1', 'c2', 'c3']], 'a busy list: the older file is read and the whole history kept');
  }
  {
    // A long-public company whose recent list is all trading reports: the older file shows its 10-Q.
    const big = sub({ name: 'Big Co', tickers: ['BIG'], filings: [['4', '2025-08-29'], ['S-1', '2025-09-10']] });
    big.filings.files = [{ name: 'big-001.json', filingFrom: '2001-01-01', filingTo: '2025-08-27' }];
    const { db, o } = mk({ 21: big, 'old:big-001.json': { form: ['10-Q'], filingDate: ['2025-05-05'], accessionNumber: ['b1'], primaryDocument: ['q.htm'] } });
    db.state.queue = [{ cik: 21, form: 'S-1', filed: '2025-09-10', accn: 'b2' }];
    await I.step(o);
    eq([db.companies.get(21).tracked, db.calls], [0, ['subs 21', 'older big-001.json']], 'a busy list: a 10-Q in the older file leaves the company out');
  }
  {
    // A company never seen, named only by notices that go out for any registration.
    const { db, o } = mk(subs);
    db.state.queue = [{ cik: 11, form: 'EFFECT', accn: 'e1' }, { cik: 10, form: 'RW', accn: 'e2' }, { cik: 10, form: '424B4', accn: 'e3' }];
    const out = await I.step(o);
    eq([db.calls, out.remaining, db.companies.size], [[], 0, 0], 'EFFECT, RW and 424B alone bring in no new company and cost no request');
  }
  {
    // A range printed earlier stays when a newer cover prints none.
    const { db, o } = mk({ 10: subs[10] }, { cover: 'under the symbol "NEW" on the Nasdaq Global Market' });
    db.companies.set(10, { cik: 10, tracked: 1, status: 'filed', priceLow: 17, priceHigh: 19, coverAccn: 'older', symbol: 'NEW' });
    db.state.queue = [{ cik: 10, accn: 'q1' }];
    await I.step(o);
    eq([db.companies.get(10).priceLow, db.companies.get(10).priceHigh], [17, 19], 'a cover without a range does not blank the stored one');
  }
  {
    const { db, o } = mk({ 10: subs[10] });
    db.companies.set(10, { cik: 10, tracked: 1, status: 'listed' });
    db.state.queue = [{ cik: 10, accn: 'q1' }];
    await I.step(o);
    eq(db.calls, [], 'a listed company is not read again');
  }
}

steps().then(() => {
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail || pass < 49) { if (pass < 49) console.log('FEWER CHECKS RAN THAN EXPECTED'); process.exit(1); }
}).catch((e) => { console.error(e); process.exit(1); });
