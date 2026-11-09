// Acquired companies: the rules (acq.js), the local archive (acqarchive.js)
// and the loader's care with sec.gov and with money (acq-load.js): the pause
// between requests and its floor, a 429 or 403 stopping the run with nothing
// retried, a missing document recorded rather than stopping, the 24-hour cap,
// a stored exhibit never fetched twice, the dollar cap, and dry runs that
// fetch nothing. No network: fetch, the model and the clock are stubbed. The
// figures in the check fixtures are AMI TopCo's (Lattice's 8-K/A, 2026-10-13).
//   node acq-test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Q = require('./acq.js');
const Archive = require('./acqarchive.js');
const L = require('./acq-load.js');

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('FAIL', what); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---- the 8-K trail ----
const block = {
  accessionNumber: ['a-1', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6', 'a-7', 'a-8'],
  filingDate: ['2025-01-10', '2025-03-20', '2025-03-01', '2025-12-01', '2024-06-01', '2025-02-01', '2025-04-01', 'bad'],
  reportDate: ['2025-01-06', '2025-01-06', '', '', '', '', '', ''],
  form: ['8-K', '8-K/A', '10-Q', '8-K/A', '8-K/A', '8-K/A', '8-K', '8-K'],
  items: ['2.01,9.01', '9.01', '', '9.01', '9.01', '5.02', '2.01', '2.01'],
  primaryDocument: ['x.htm', 'y.htm', 'q.htm', 'z.htm', 'w.htm', 'v.htm', 'u.htm', 't.htm'],
};
const rows = Q.filingsOf(block);
eq(rows.map((r) => r.accn), ['a-1', 'a-2', 'a-4', 'a-5', 'a-6', 'a-7'], 'filingsOf keeps 8-K and 8-K/A with a real date');
const c = Q.candidates(rows);
eq(c.map((r) => r.accn + ':' + r.role + ':' + (r.closingAccn || '')), ['a-1:closing:', 'a-2:amendment:a-1', 'a-7:closing:'],
  'an amendment within the window is tied to its closing; one before any closing, one without 9.01 and one past the window are not');
ok(!c.some((r) => r.accn === 'a-4'), 'an 8-K/A 234 days after the closing is not a candidate');
const c2 = Q.candidates(Q.filingsOf({ accessionNumber: ['b-1', 'b-2', 'b-3'], filingDate: ['2025-01-01', '2025-02-01', '2025-03-01'], form: ['8-K', '8-K', '8-K/A'], items: ['2.01', '2.01', '9.01'] }));
eq(c2[2].closingAccn, 'b-2', 'an amendment is tied to the latest closing before it');
eq(Q.candidates(rows, '2025-03-01').map((r) => r.accn), ['a-7'], 'since leaves out earlier filings (and so the amendment loses its closing)');
ok(Q.has('2.01,9.01', '9.01') && !Q.has('2.011', '2.01') && !Q.has('12.01', '2.01'), 'item codes match whole');

// ---- the index and which exhibits are read ----
const headers = `<html><body><pre>
&lt;DOCUMENT&gt;
&lt;TYPE&gt;8-K/A
&lt;SEQUENCE&gt;1
&lt;FILENAME&gt;brc-20261016.htm
&lt;DESCRIPTION&gt;8-K/A
&lt;TEXT&gt;
&lt;DOCUMENT&gt;
&lt;TYPE&gt;EX-23.1
&lt;SEQUENCE&gt;2
&lt;FILENAME&gt;exhibit231-consent.htm
&lt;DESCRIPTION&gt;CONSENT OF DELOITTE &amp; TOUCHE LLP
&lt;TEXT&gt;
&lt;DOCUMENT&gt;
&lt;TYPE&gt;EX-99.3
&lt;SEQUENCE&gt;5
&lt;FILENAME&gt;exhibit993-unauditedprofor.htm
&lt;DESCRIPTION&gt;UNAUDITED PRO FORMA COMBINED FINANCIAL STATEMENTS
&lt;TEXT&gt;
&lt;DOCUMENT&gt;
&lt;TYPE&gt;EX-99.2
&lt;SEQUENCE&gt;4
&lt;FILENAME&gt;exhibit992-unauditedconden.htm
&lt;DESCRIPTION&gt;UNAUDITED COMBINED FINANCIAL STATEMENTS
&lt;TEXT&gt;
&lt;DOCUMENT&gt;
&lt;TYPE&gt;EX-99.1
&lt;SEQUENCE&gt;3
&lt;FILENAME&gt;exhibit991-auditedcombined.htm
&lt;DESCRIPTION&gt;AUDITED COMBINED FINANCIAL STATEMENTS
&lt;TEXT&gt;
&lt;DOCUMENT&gt;
&lt;TYPE&gt;EX-99.4
&lt;SEQUENCE&gt;6
&lt;FILENAME&gt;scan.pdf
&lt;DESCRIPTION&gt;FINANCIAL STATEMENTS
&lt;TEXT&gt;
</pre></body></html>`;
const docs = Q.parseIndex(headers);
eq(docs.length, 6, 'every document in the index');
eq(docs[1].description, 'CONSENT OF DELOITTE & TOUCHE LLP', 'descriptions unescaped');
eq(Q.pickDocs(docs).map((d) => d.file), ['exhibit991-auditedcombined.htm', 'exhibit992-unauditedconden.htm'],
  'the statements, in order; not the pro forma, the consent, the 8-K itself or a PDF');
eq(Q.pickDocs([{ type: 'EX-99.1', file: 'ex991.htm' }, { type: 'EX-99.2', file: 'ex992pr.htm', description: 'PRESS RELEASE' }]).map((d) => d.file), ['ex991.htm'],
  'an undescribed EX-99.1 is read; a press release is not');
eq(Q.pickDocs([1, 2, 3, 4, 5].map((i) => ({ type: 'EX-99.' + i, seq: i, file: 'ex99' + i + '.htm' }))).length, Q.MAX_DOCS, 'at most MAX_DOCS exhibits a filing');

// ---- the sign ----
const norm = 'Net loss $ (14,014,393 ) $ (11,526,625 ) Revenues 13 $ 194,702,004 $ 36,029,101 other 1,234 and (1,234 ) x -5.5';
ok(Q.signOk(norm, '(14,014,393)'), 'a loss printed in brackets is negative');
ok(!Q.signOk(norm, '14,014,393'), 'a loss copied as a profit is refused');
ok(Q.signOk(norm, '194,702,004'), 'a note number before the dollar sign is not a minus');
ok(!Q.signOk(norm, '(194,702,004)'), 'revenue copied as negative is refused');
ok(Q.signOk(norm, '1,234') && Q.signOk(norm, '(1,234)'), 'a figure printed both ways passes either way');
ok(Q.signOk(norm, '(5.5)') && !Q.signOk(norm, '5.5'), 'a leading minus is negative');

// ---- the check of an answer ----
const text = `AMI TopCo, Inc. and Subsidiaries
Consolidated Statements of Operations
Year ended December 31, 2025
Revenues 13 $ 194,702,004 $ 36,029,101
Net loss $ (14,014,393 ) $ (11,526,625 )
Total assets $ 678,304,885
Cash and cash equivalents 2(n) $ 37,775,933
AMI TopCo designs and sells embedded firmware.
REPORT OF INDEPENDENT AUDITORS ... /s/ Grant Thornton LLP`;
const period = (o) => ({ label: 'Year ended December 31, 2025', period_end: '2025-12-31', months: 12, audited: 'audited', unit: 'units',
  revenue: '', gross_profit: '', operating_income: '', net_income: '', total_assets: '', total_liabilities: '', total_equity: '', cash: '', operating_cash_flow: '', ...o });
const ans = { kind: 'business statements', business: 'AMI TopCo, Inc. and Subsidiaries', business_quote: 'AMI TopCo designs and sells embedded firmware.',
  currency: 'USD', basis: 'US GAAP', auditor: 'Grant Thornton LLP', opinion: 'unmodified',
  periods: [period({ revenue: '194,702,004', net_income: '(14,014,393)', total_assets: '678,304,885', cash: '37,775,933', total_equity: '999,999' })] };
let k = Q.check(ans, text);
eq([k.periods[0].revenue, k.periods[0].net_income, k.periods[0].total_assets, k.periods[0].cash], [194702004, -14014393, 678304885, 37775933], 'figures kept, a loss negative');
eq(k.periods[0].total_equity, null, 'a figure not in the text is dropped');
ok(k.problems.length === 1 && /total_equity "999,999" is not in the exhibit/.test(k.problems[0]), 'and named in the problems as not in the exhibit');
eq([k.read.business, k.read.auditor, k.read.is_business], ['AMI TopCo, Inc. and Subsidiaries', 'Grant Thornton LLP', true], 'names found in the text are kept');
k = Q.check({ ...ans, auditor: 'Ernst & Young LLP', business: 'AMI Holdings' }, text);
eq([k.read.auditor, k.read.business], [null, null], 'names not in the text are dropped');
ok(k.problems.some((p) => /no business name/.test(p)), 'statements with no business name found are flagged');
k = Q.check({ ...ans, periods: [period({ net_income: '14,014,393' })] }, text);
eq(k.periods.length, 0, 'a period left with nothing is dropped');
ok(k.problems.some((p) => /other sign/.test(p)), 'the wrong sign is named');
k = Q.check({ ...ans, periods: [period({ revenue: '194,702,004', unit: 'units' })] }, text + '\n(in thousands)');
eq(k.periods[0].revenue, 194702004000, '"units" takes the one scale the exhibit states');
k = Q.check({ ...ans, periods: [period({ revenue: '194,702,004', unit: 'units' })] }, text + '\n(in thousands) and (in millions)');
eq(k.periods[0].revenue, 194702004, 'stated several, "units" stands');
k = Q.check({ ...ans, periods: [period({ revenue: '194,702,004', period_end: 'December 2025' })] }, text);
eq(k.periods.length, 0, 'a period with no end date is dropped');
k = Q.check({ ...ans, kind: 'pro forma only' }, text);
eq([k.read.is_business, k.periods.length], [false, 0], 'pro forma figures are never kept as the business\'s');
k = Q.check({ ...ans, currency: 'US dollars' }, text);
eq(k.read.currency, null, 'a currency that is not a code is left blank');

// ---- the archive ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-test-'));
const A = Archive.open(path.join(tmp, 'acq.db'));
A.writeList([{ cik: '1', name: 'Lattice', tickers: 'LSCC', sic: '3674', in_universe: true, symbol: 'LSCC' }, { cik: '2', name: 'Other Co', in_universe: false }],
  [{ accn: '0001-26-000001', cik: '1', form: '8-K/A', filed: '2026-10-13', items: '9.01', role: 'amendment', closingAccn: '0001-26-000000' },
    { accn: '0001-26-000000', cik: '1', form: '8-K', filed: '2026-08-01', items: '2.01', role: 'closing' },
    { accn: '0002-26-000001', cik: '2', form: '8-K/A', filed: '2026-10-20', items: '9.01', role: 'amendment', closingAccn: 'x' }], 'submissions-2026-11-09.zip');
A.writeRead('0001-26-000001', 'f.htm', { kind: 'business statements', is_business: true, business: 'AMI', problems: [] }, [{ label: 'a', period_end: '2025-12-31', revenue: 1 }, { label: 'b', period_end: '2024-12-31', revenue: 2 }]);
A.writeRead('0001-26-000001', 'f.htm', { kind: 'business statements', is_business: true, business: 'AMI', problems: [] }, [{ label: 'a', period_end: '2025-12-31', revenue: 3 }]);
eq(A.db.prepare('select revenue from periods').all().map((r) => r.revenue), [3], 'a second reading replaces the first, periods and all');

// ---- the loader ----
eq(L.options(['--gap', '1']).gapS, L.MIN_GAP_S, 'the pause never goes under the floor');
eq(L.options([]).gapS, 10, 'the pause is 10s by default');
eq(L.options([]).maxUsd, 1, 'a dollar cap by default');
eq(L.queue(A, { all: false }, 'index').map((r) => r.accn), ['0001-26-000001'], 'the app\'s amendments only, by default');
eq(L.queue(A, { all: false, closings: true }, 'index').map((r) => r.accn), ['0001-26-000001', '0001-26-000000'], 'closings after amendments when asked');
eq(L.queue(A, { all: true }, 'index').map((r) => r.accn), ['0001-26-000001', '0002-26-000001'], 'the app\'s companies first when every filer is asked');

function harness(answers, opt = {}) {
  let t = 1_000_000;
  const calls = [], sleeps = [], logs = [], posts = [];
  const deps = {
    archive: opt.archive || A,
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    fetch: async (url) => { calls.push(url); t += 100; const a = answers.shift(); if (a instanceof Error) throw a;
      return { status: a.status, headers: { get: () => null }, arrayBuffer: async () => Buffer.from(a.body || ''), body: { cancel: async () => {} } }; },
    post: opt.post === null ? null : async (body) => { posts.push(body); const r = (opt.model || []).shift() || { status: 200, body: { stop_reason: 'end_turn', usage: { input_tokens: 10000, output_tokens: 1000 }, content: [{ type: 'text', text: JSON.stringify(ans) }] } }; return r; },
    log: (s) => logs.push(s),
    endRun: () => {},
    universe: new Set(),
    newestList: () => opt.list || null,
  };
  return { deps, calls, sleeps, logs, posts };
}

(async () => {
  // The getter: pauses, stops, never retries.
  let h = harness([{ status: 200, body: 'a' }, { status: 200, body: 'b' }, { status: 429 }]);
  let get = L.makeGetter(A, h.deps);
  await get('u1', 10000, 10); await get('u2', 10000, 10);
  ok(h.sleeps.length === 1 && h.sleeps[0] >= 9800, 'the second request waits out the pause');
  let err = await get('u3', 10000, 10).catch((e) => e);
  ok(err && err.stop && /429/.test(err.message), 'a 429 stops');
  eq(h.calls.length, 3, 'and is not retried');
  h = harness([{ status: 403 }]);
  err = await L.makeGetter(A, h.deps)('u', 0, 10).catch((e) => e);
  ok(err && err.stop && /403/.test(err.message), 'a 403 stops');
  h = harness([{ status: 404 }, { status: 404 }]);
  get = L.makeGetter(A, h.deps);
  eq(await get('u', 0, 10, { missingOk: true }), null, 'a 404 on one document is an answer, not a stop');
  err = await get('u', 0, 10).catch((e) => e);
  ok(err && err.stop, 'a 404 anywhere else stops');
  h = harness([new Error('ECONNRESET')]);
  err = await L.makeGetter(A, h.deps)('u', 0, 10).catch((e) => e);
  ok(err && err.stop && h.calls.length === 1, 'a dropped connection stops, not retried');
  h = harness([{ status: 200 }, { status: 200 }]);
  get = L.makeGetter(A, h.deps);
  await get('u', 0, 1);
  err = await get('u', 0, 1).catch((e) => e);
  ok(err && err.stop && h.calls.length === 1, 'the cap stops before the request');

  // --list: a dry run with no bulk file on disk fetches nothing.
  h = harness([]);
  await L.run({ list: true, commit: false, gapS: 10 }, h.deps);
  eq(h.calls.length, 0, '--list dry run fetches nothing');

  // --index
  h = harness([{ status: 200, body: headers }]);
  await L.run({ index: true, commit: false, max: 5, gapS: 10 }, h.deps);
  eq(h.calls.length, 0, '--index dry run fetches nothing');
  await L.run({ index: true, commit: true, max: 5, gapS: 10 }, h.deps);
  eq(h.calls, ['https://www.sec.gov/Archives/edgar/data/1/000126000001/0001-26-000001-index-headers.html'], 'one request: the index of the app\'s amendment');
  eq(A.docsOf('0001-26-000001').length, 6, 'its documents are stored');
  h = harness([]);
  await L.run({ index: true, commit: true, max: 5, gapS: 10 }, h.deps);
  eq(h.calls.length, 0, 'an indexed filing is never fetched again');

  // --read: the two statements exhibits; the first text is already stored.
  A.writeText('0001-26-000001', 'exhibit991-auditedcombined.htm', text);
  h = harness([{ status: 200, body: '<html><p>' + text.replace(/\n/g, '</p><p>') + '</p></html>' }]);
  await L.run({ read: true, commit: false, max: 5, gapS: 10, maxUsd: 1 }, h.deps);
  ok(h.calls.length === 0 && h.posts.length === 0, '--read dry run fetches and spends nothing');
  await L.run({ read: true, commit: true, max: 5, gapS: 10, maxUsd: 1 }, h.deps);
  eq(h.calls, ['https://www.sec.gov/Archives/edgar/data/1/000126000001/exhibit992-unauditedconden.htm'], 'a stored exhibit is not fetched again; the other is fetched once');
  eq(h.posts.length, 2, 'both read by the model');
  ok(A.textOf('0001-26-000001', 'exhibit992-unauditedconden.htm').includes('194,702,004'), 'the fetched exhibit is kept as text');
  const r1 = A.db.prepare("select * from reads where file = 'exhibit991-auditedcombined.htm'").get();
  eq([r1.business, r1.is_business, r1.auditor], ['AMI TopCo, Inc. and Subsidiaries', 1, 'Grant Thornton LLP'], 'the reading is stored');
  ok(r1.answer && JSON.parse(r1.answer).kind === 'business statements', 'with the model\'s own answer, for --recheck');
  h = harness([]);
  await L.run({ read: true, commit: true, max: 5, gapS: 10, maxUsd: 1 }, h.deps);
  ok(h.calls.length === 0 && h.posts.length === 0, 'a read exhibit is not read again');

  // The dollar cap: each answer costs $0.0015 here; a cap of $0.001 stops after one.
  A.db.exec('delete from reads; delete from periods');
  h = harness([{ status: 200, body: text }]);
  await L.run({ read: true, commit: true, max: 5, gapS: 10, maxUsd: 0.001 }, h.deps);
  eq(h.posts.length, 1, 'the dollar cap stops the reading');
  // A refused model call stops the run.
  A.db.exec('delete from reads; delete from periods');
  h = harness([], { model: [{ status: 401, body: { error: { message: 'bad key' } } }] });
  const rr = await L.run({ read: true, commit: true, max: 5, gapS: 10, maxUsd: 1 }, h.deps);
  ok(!rr.ok && /401/.test(rr.stopped) && h.posts.length === 1, 'a 401 from the model stops the run');
  eq(A.db.prepare('select count(*) n from reads').get().n, 0, 'and writes nothing');

  // --recheck spends nothing and fetches nothing.
  h = harness([]);
  await L.run({ read: true, commit: true, max: 5, gapS: 10, maxUsd: 1 }, h.deps);
  const h2 = harness([]);
  const rc = await L.run({ recheck: true, commit: true }, h2.deps);
  ok(rc.n === 2 && h2.calls.length === 0 && h2.posts.length === 0, '--recheck re-runs the checks with no request and no model');

  A.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
