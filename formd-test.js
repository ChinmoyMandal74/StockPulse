// Form D: the rules (formd.js), the local archive (formdarchive.js) and,
// above all, the loader's care with sec.gov (formd-load.js): the pause
// between requests and its floor, a 429 or 403 stopping the run with nothing
// retried, a file never fetched twice, the 24-hour cap, and a dry run that
// downloads nothing. No network: fetch, the clock and the files are stubbed.
// The fixture rows are real lines from the 2026 Q3 data set.
//   node formd-test.js
'use strict';
const F = require('./formd.js');
const Archive = require('./formdarchive.js');
const L = require('./formd-load.js');

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('FAIL', what); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---- real lines, 2026 Q3 ----
const H_SUB = 'ACCESSIONNUMBER\tFILE_NUM\tFILING_DATE\tSIC_CODE\tSCHEMAVERSION\tSUBMISSIONTYPE\tTESTORLIVE\tOVER100PERSONSFLAG\tOVER100ISSUERFLAG';
const SUB = [
  '0000904454-26-000500\t021-599302               \t29-SEP-2026\t\tX0708\tD\tLIVE\t\t',
  '0002133337-26-000002\t021-582945               \t28-SEP-2026\t\tX0708\tD/A\tLIVE\t\t',
  '0002134925-26-000002\t021-585269               \t28-SEP-2026\t\tX0708\tD/A\tLIVE\t\t',
];
const H_ISS = 'ACCESSIONNUMBER\tIS_PRIMARYISSUER_FLAG\tISSUER_SEQ_KEY\tCIK\tENTITYNAME\tSTREET1\tSTREET2\tCITY\tSTATEORCOUNTRY\tSTATEORCOUNTRYDESCRIPTION\tZIPCODE\tISSUERPHONENUMBER\tJURISDICTIONOFINC\tISSUER_PREVIOUSNAME_1\tISSUER_PREVIOUSNAME_2\tISSUER_PREVIOUSNAME_3\tEDGAR_PREVIOUSNAME_1\tEDGAR_PREVIOUSNAME_2\tEDGAR_PREVIOUSNAME_3\tENTITYTYPE\tENTITYTYPEOTHERDESC\tYEAROFINC_TIMESPAN_CHOICE\tYEAROFINC_VALUE_ENTERED';
const ISS = [
  '0000904454-26-000500\tNO\t102\t0002140160\tASPF (Offshore Sidecar) III - Credit Secondaries, L.P.\tC/O ALPINVEST US HOLDINGS, LLC\tONE VANDERBILT AVENUE, SUITE 3400\tNEW YORK\tNY\tNEW YORK\t10017\t646-735-4293\tCAYMAN ISLANDS\t\t\t\t\t\t\tOther\tCAYMAN ISLANDS EXEMPTED LIMITED PARTNERSHIP\twithinFiveYears\t2026',
  '0000904454-26-000500\tYES\t101\t0002140155\tASPF (Onshore Sidecar) III - Credit Secondaries, L.P.\tC/O ALPINVEST US HOLDINGS, LLC\tONE VANDERBILT AVENUE, SUITE 3400\tNEW YORK\tNY\tNEW YORK\t10017\t646-735-4293\tDELAWARE\t\t\t\t\t\t\tLimited Partnership\t\twithinFiveYears\t2026',
  '0002133337-26-000002\tYES\t101\t0002133337\tSGP - RSTRS Davidson, LLC\t4521 SHARON ROAD SUITE 275\t\tCHARLOTTE\tNC\tNORTH CAROLINA\t28211\t704-909-4500\tNORTH CAROLINA\t\t\t\t\t\t\tLimited Liability Company\t\twithinFiveYears\t2026',
  '0002134925-26-000002\tYES\t101\t0002134925\tKavia AI, Inc.\t2618 SUTTER ST\t\tSAN FRANCISCO\tCA\tCALIFORNIA\t94115-2925\t650-576-4089\tDELAWARE\t\t\t\t\t\t\tCorporation\t\twithinFiveYears\t2025',
];
const H_OFF = 'ACCESSIONNUMBER\tINDUSTRYGROUPTYPE\tINVESTMENTFUNDTYPE\tIS40ACT\tREVENUERANGE\tAGGREGATENETASSETVALUERANGE\tFEDERALEXEMPTIONS_ITEMS_LIST\tISAMENDMENT\tPREVIOUSACCESSIONNUMBER\tSALE_DATE\tYETTOOCCUR\tMORETHANONEYEAR\tISEQUITYTYPE\tISDEBTTYPE\tISOPTIONTOACQUIRETYPE\tISSECURITYTOBEACQUIREDTYPE\tISPOOLEDINVESTMENTFUNDTYPE\tISTENANTINCOMMONTYPE\tISMINERALPROPERTYTYPE\tISOTHERTYPE\tDESCRIPTIONOFOTHERTYPE\tISBUSINESSCOMBINATIONTRANS\tBUSCOMBCLARIFICATIONOFRESP\tMINIMUMINVESTMENTACCEPTED\tOVER100RECIPIENTFLAG\tTOTALOFFERINGAMOUNT\tTOTALAMOUNTSOLD\tTOTALREMAINING\tSALESAMTCLARIFICATIONOFRESP\tHASNONACCREDITEDINVESTORS\tNUMBERNONACCREDITEDINVESTORS\tTOTALNUMBERALREADYINVESTED\tSALESCOMM_DOLLARAMOUNT\tSALESCOMM_ISESTIMATE\tFINDERSFEE_DOLLARAMOUNT\tFINDERSFEE_ISESTIMATE\tFINDERFEECLARIFICATIONOFRESP\tGROSSPROCEEDSUSED_DOLLARAMOUNT\tGROSSPROCEEDSUSED_ISESTIMATE\tGROSSPROCEEDSUSED_CLAROFRESP\tAUTHORIZEDREPRESENTATIVE';
const OFF = [
  '0000904454-26-000500\tPooled Investment Fund\tPrivate Equity Fund\tfalse\tDecline to Disclose\t\t06b, 3C, 3C.7\tfalse\t\t\ttrue\ttrue\t\t\t\t\ttrue\t\t\t\t\tfalse\t\t0\t\tIndefinite\t0\tIndefinite\t\tfalse\t\t0\t0\t\t0\t\t\t0\t\t\tfalse',
  '0002133337-26-000002\tCommercial\t\t\t$1,000,001 - $5,000,000\t\t06b\ttrue\t0002133337-26-000001\t2026-06-22\t\tfalse\ttrue\t\t\t\t\t\t\t\t\tfalse\t\t25000\t\t2220750\t2100000\t120750\t\ttrue\t31\t31\t0\ttrue\t0\ttrue\t\t150000\ttrue\t\tfalse',
  '0002134925-26-000002\tOther Technology\t\t\tDecline to Disclose\t\t06b\ttrue\t0002134925-26-000001\t2026-05-13\t\tfalse\ttrue\t\t\t\t\t\t\ttrue\tSeries Seed Preferred Stock\tfalse\t\t0\t\t3050003\t3050003\t0\t"""Total amount sold"" includes $1,525,000.00 of Series Seed Preferred Stock issued upon conversion of SAFEs."\tfalse\t\t10\t0\t\t0\t\t\t0\t\t\tfalse',
];
const tsv = (h, rows) => [h, ...rows].join('\n') + '\n';

// ---- the rules ----
eq(F.unquote('"""Total amount sold"" includes x."'), '"Total amount sold" includes x.', 'unquote undoes CSV quoting inside TSV');
eq(F.unquote('  plain '), 'plain', 'unquote trims');
eq(F.unquote(''), null, 'empty field is null');
eq(F.isoDate('29-SEP-2026'), '2026-09-29', 'DD-MON-YYYY');
eq(F.isoDate('2026-06-22'), '2026-06-22', 'ISO passes');
eq(F.isoDate('5-jan-2010'), '2010-01-05', 'one-digit day, lower case month');
eq(F.isoDate('Indefinite'), null, 'junk date is null');
eq(F.isoDate('2019-12-31 17:25:33'), '2019-12-31', 'date and time (quarters to 2020 Q2): the date');
eq(F.isoDate('2019-12-31 25'), null, 'a date with junk after it is null');
eq(F.amount('Indefinite'), null, 'Indefinite is not a number');
ok(F.indefinite('Indefinite') && !F.indefinite('0') && !F.indefinite(null), 'indefinite tells Indefinite from 0 and blank');
eq(F.amount('0'), 0, 'zero sold is zero, not blank');
eq(F.amount(''), null, 'blank amount is null, not zero');
eq(F.amount(null), null, 'null amount is null');
eq(F.amount('2,220,750'), 2220750, 'commas');
eq(F.quarterOf('https://www.sec.gov/files/structureddata/data/form-d-data-sets/2013q4_d_0.zip'), '2013Q4', 'the _0 variant');
eq(F.quarterOf('https://www.sec.gov/files/x/2026q3_d.zip'), '2026Q3', 'quarter from address');
eq(F.tableOf('2026Q3_d/RELATEDPERSONS.tsv'), 'RELATEDPERSONS', 'table from entry name');
eq(F.tableOf('2026Q3_d/FormD_readme.html'), null, 'readme is not a table');

const page = '<a href="/files/structureddata/data/form-d-data-sets/2025q4_d.zip">x</a>'
  + '<a href="/files/datastandardsinnovation/data/form-d-data-sets/2026q3_d.zip">y</a>'
  + '<a href="/files/datastandardsinnovation/data/form-d-data-sets/2026q3_d.zip">dup</a>'
  + '<a href="/files/other/2026q3_form13f.zip">13f</a>';
const links = F.zipLinks(page);
eq(links.map((l) => l.quarter), ['2026Q3', '2025Q4'], 'zipLinks: newest first, de-duplicated, Form D only');
eq(links[0].url, 'https://www.sec.gov/files/datastandardsinnovation/data/form-d-data-sets/2026q3_d.zip', 'zipLinks: absolute address');

const T = { FORMDSUBMISSION: F.parseTsv(tsv(H_SUB, SUB)), ISSUERS: F.parseTsv(tsv(H_ISS, ISS)), OFFERING: F.parseTsv(tsv(H_OFF, OFF)) };
eq([T.FORMDSUBMISSION.rows.length, T.ISSUERS.rows.length, T.OFFERING.rows.length], [3, 4, 3], 'parseTsv row counts');
eq(T.OFFERING.bad, 0, 'no unreadable rows');
eq(F.parseTsv(tsv(H_SUB, ['too\tfew'])).bad, 1, 'a short row is counted bad, not padded');

const fund = F.summarise(T.FORMDSUBMISSION.rows[0], T.ISSUERS.rows.filter((r) => r.ACCESSIONNUMBER === '0000904454-26-000500'), T.OFFERING.rows[0], '2026Q3');
eq(fund.name, 'ASPF (Onshore Sidecar) III - Credit Secondaries, L.P.', 'the primary issuer, though listed second');
eq(fund.cik, '2140155', 'CIK without leading zeros');
eq([fund.offered, fund.offered_indefinite, fund.sold, fund.remaining], [null, 1, 0, null], 'fund: indefinite offering, zero sold');
eq(fund.issuers, 2, 'two issuers counted');
const re = F.summarise(T.FORMDSUBMISSION.rows[1], T.ISSUERS.rows.filter((r) => r.ACCESSIONNUMBER === '0002133337-26-000002'), T.OFFERING.rows[1], '2026Q3');
eq([re.form, re.filed, re.first_sale, re.amendment, re.previous_accn], ['D/A', '2026-09-28', '2026-06-22', 1, '0002133337-26-000001'], 'amendment fields');
eq([re.offered, re.sold, re.remaining, re.investors, re.revenue_range], [2220750, 2100000, 120750, 31, '$1,000,001 - $5,000,000'], 'operating company amounts');
eq(re.year_inc, 2026, 'year of incorporation from the file header name');

eq(F.verdict(200).go, true, '200 goes on');
for (const s of [429, 403, 500, 404, 301]) eq(F.verdict(s).go, false, `${s} stops`);

// ---- the archive ----
const A0 = Archive.open(':memory:');
const c1 = A0.loadQuarter('2026Q3', 'u', T, 123);
eq([c1.filings, c1.bad], [3, 0], 'loadQuarter writes one summary a filing');
eq(A0.loadQuarter('2026Q3', 'u', T, 123).skipped, true, 'a loaded quarter is not loaded again');
eq(A0.search('kavia')[0].sold, 3050003, 'search by name');
eq(A0.db.prepare('select SALESAMTCLARIFICATIONOFRESP s from fd_offering where ACCESSIONNUMBER = ?').get('0002134925-26-000002').s.slice(0, 20), '"Total amount sold" ', 'raw table keeps the unquoted text');
// An older file with an extra column adds it; nothing is dropped.
const T2 = { FORMDSUBMISSION: F.parseTsv(tsv(H_SUB + '\tNEWCOL', ['0009999999-09-000001\t021-1\t01-JAN-2009\t\tX\tD\tLIVE\t\t\tz'])), ISSUERS: { header: [], rows: [] }, OFFERING: { header: [], rows: [] } };
A0.loadQuarter('2009Q1', 'u2', T2, 1);
eq(A0.db.prepare('select NEWCOL from fd_submissions where ACCESSIONNUMBER = ?').get('0009999999-09-000001').NEWCOL, 'z', 'a new column is added');
// ---- the SEC's profile of an issuer (E1) ----
const MAIN = { cik: '0001924674', name: 'Crusoe Inc.', ein: '881194382', stateOfIncorporation: 'DE', fiscalYearEnd: '1231', sic: '', sicDescription: '',
  tickers: [], exchanges: [], entityType: 'other', phone: '720-795-6484',
  addresses: { business: { street1: '255 FILLMORE STREET, #400', city: 'DENVER', stateOrCountry: 'CO', zipCode: '80206' } },
  formerNames: [{ name: 'Crusoe Energy Holdings Inc.', from: '2022-04-22T04:00:00.000Z', to: '2024-02-08T05:00:00.000Z' }],
  filings: { recent: { form: ['D', 'D/A', '10-K', 'C', '4'], filingDate: ['2026-09-17', '2025-10-23', '2024-03-01', '2023-05-05', '2022-06-01'] } } };
const prof = F.filerProfile(MAIN, [{ form: ['D', '1-K'], filingDate: ['2019-01-02', '2020-04-30'] }]);
eq([prof.cik, prof.ein, prof.state_inc, prof.fiscal_year_end, prof.sic, prof.tickers], ['1924674', '881194382', 'DE', '1231', null, null], 'profile: CIK without zeros, EIN, incorporation, year end; blanks are null');
eq(JSON.parse(prof.former_names), [{ name: 'Crusoe Energy Holdings Inc.', from: '2022-04-22', to: '2024-02-08' }], 'former names with their dates');
eq([prof.filings, prof.first_filed, prof.last_filed], [7, '2019-01-02', '2026-09-17'], 'older pages counted too');
eq(JSON.parse(prof.forms), { formD: { n: 3, first: '2019-01-02', last: '2026-09-17' }, annual: { n: 1, first: '2024-03-01', last: '2024-03-01' },
  crowdfunding: { n: 1, first: '2023-05-05', last: '2023-05-05' }, insider: { n: 1, first: '2022-06-01', last: '2022-06-01' },
  regA: { n: 1, first: '2020-04-30', last: '2020-04-30' } }, 'forms grouped, with first and last');
ok(!JSON.stringify(prof).includes('FILLMORE') && !JSON.stringify(prof).includes('80206') && !JSON.stringify(prof).includes('720-795'), 'no street, zip or telephone kept');
eq([prof.biz_city, prof.biz_state], ['DENVER', 'CO'], 'the business city and state');
eq(F.filerProfile({ ...MAIN, ein: '000000000' }).ein, null, 'a zero EIN is none');
eq(F.filerProfile({ ...MAIN, tickers: ['BRK.B', 'BRK.A'] }).tickers, 'BRK.B,BRK.A', 'tickers kept');
eq(F.filerProfile(null), null, 'no JSON, no profile');
eq(F.filerProfile({ ...MAIN, name: 'Cardinal Health, Inc.', formerNames: [{ name: 'CARDINAL HEALTH INC', from: '1994-08-19T00:00:00.000Z', to: '2026-11-05T00:00:00.000Z' }] }).former_names, null,
  'the present name, spelt otherwise, is not a former name');
const A2 = Archive.open(':memory:');
eq(A2.writeProfiles([prof], '2026-11-09', 'f.zip'), 1, 'profiles written');
A2.writeProfiles([{ ...prof, name: 'Crusoe Inc. (renamed)' }], '2026-12-01', 'g.zip');
eq(A2.db.prepare('select as_of, name from fd_profiles order by as_of').all().map((r) => [r.as_of, r.name]), [['2026-11-09', 'Crusoe Inc.'], ['2026-12-01', 'Crusoe Inc. (renamed)']], 'a newer file adds rows beside the old: history kept');

// Superseded: the original an amendment names, loaded after the amendment
// (an older quarter in a newest-first run), is marked; the amendment is not.
const orig = (line) => line.replace('0002133337-26-000002', '0002133337-26-000001').replace('\tD/A\t', '\tD\t');
const T3 = { FORMDSUBMISSION: F.parseTsv(tsv(H_SUB, [orig(SUB[1])])), ISSUERS: F.parseTsv(tsv(H_ISS, [orig(ISS[2])])), OFFERING: F.parseTsv(tsv(H_OFF, [orig(OFF[1])])) };
A0.loadQuarter('2026Q2', 'u3', T3, 1);
const sup = (a) => A0.db.prepare('select superseded s from formd where accn = ?').get(a).s;
eq([sup('0002133337-26-000001'), sup('0002133337-26-000002'), sup('0002134925-26-000002')], [1, 0, 0], 'the filing an amendment replaces is superseded, nothing else');
// All or nothing: a failure part-way leaves no rows and no loads entry.
const broken = { FORMDSUBMISSION: T.FORMDSUBMISSION, ISSUERS: { header: H_ISS.split('\t'), rows: [{ get ACCESSIONNUMBER() { throw new Error('boom'); } }] }, OFFERING: T.OFFERING };
const A1 = Archive.open(':memory:');
let threw = false; try { A1.loadQuarter('2026Q2', 'u', broken, 1); } catch (_) { threw = true; }
const n1 = A1.db.prepare("select count(*) n from sqlite_master where name = 'fd_submissions'").get().n
  ? A1.db.prepare('select count(*) n from fd_submissions').get().n : 0;
ok(threw && !A1.loaded().has('2026Q2') && n1 === 0, 'a failed quarter rolls back whole');
eq(A1.loadQuarter('2026Q3', 'u', T, 1).filings, 3, 'the next quarter after a rollback still loads');

// ---- the loader's care with sec.gov ----
// A stored ZIP (method 0) made here; zipread reads it like the SEC's.
function makeZip(files) {
  const parts = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const nb = Buffer.from(name), data = Buffer.from(text);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    parts.push(lh, nb, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nb);
    off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
const ZIP = makeZip({ 'q/FORMDSUBMISSION.tsv': tsv(H_SUB, SUB), 'q/ISSUERS.tsv': tsv(H_ISS, ISS), 'q/OFFERING.tsv': tsv(H_OFF, OFF), 'q/FormD_readme.html': '<html>' });
const PAGE = ['2026q3', '2026q2', '2026q1', '2025q4'].map((q) => `<a href="/files/datastandardsinnovation/data/form-d-data-sets/${q}_d.zip">`).join('');

function harness({ statuses = {}, cachedUrls = [], pageCached = false, archive } = {}) {
  let clock = 1e12;
  const calls = [], writes = [], lines = [];
  const deps = {
    archive: archive || Archive.open(':memory:'),
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetch: async (url) => {
      calls.push({ url, at: clock });
      clock += 500;
      const status = statuses[url.split('/').pop()] || 200;
      const body = /\.zip$/.test(url) ? ZIP : Buffer.from(PAGE);
      return { status, arrayBuffer: async () => body, body: { cancel: async () => {} } };
    },
    cachePath: (url) => 'cache/' + url.split('/').pop(),
    cached: (url) => (cachedUrls.includes(url.split('/').pop()) ? ZIP : null),
    readCache: () => (pageCached ? PAGE : null),
    writeCache: (file) => writes.push(file),
    log: (s) => lines.push(s),
  };
  return { deps, calls, writes, lines };
}
const run = (argv, h) => L.run(L.options(['node', 'x', ...argv]), h.deps);

(async () => {
  // Pause between requests, and its floor.
  let h = harness();
  let r = await run(['--commit', '--max', '3', '--gap', '30'], h);
  eq([r.ok, r.loaded, h.calls.length], [true, 3, 4], 'page + three ZIPs');
  const gaps = h.calls.slice(1).map((c, i) => c.at - h.calls[i].at);
  ok(gaps.every((g) => g >= 30000), 'every request at least 30s after the one before: ' + gaps.join(','));
  h = harness();
  await run(['--commit', '--max', '2', '--gap', '1'], h);
  ok(h.calls.slice(1).every((c, i) => c.at - h.calls[i].at >= L.MIN_GAP_S * 1000), 'a --gap under the floor is raised to 15s');
  eq(h.calls.map((c) => c.url.split('/').pop()), ['form-d-data-sets', '2026q3_d.zip', '2026q2_d.zip'], 'newest first');
  ok(h.writes.includes('cache/2026q3_d.zip'), 'a downloaded ZIP is kept on disk');

  // A 429 stops the run; nothing is retried; what landed stays.
  h = harness({ statuses: { '2026q2_d.zip': 429 } });
  r = await run(['--commit', '--max', '4'], h);
  eq([r.ok, r.loaded, h.calls.length], [false, 1, 3], '429: one quarter in, the run stopped at the refusal');
  ok(/slow down/.test(r.stopped), '429 is named');
  eq(h.calls.filter((c) => /2026q2/.test(c.url)).length, 1, '429: asked once, never again');
  ok(h.deps.archive.loaded().has('2026Q3') && !h.deps.archive.loaded().has('2026Q2'), '429: the earlier quarter is kept, the refused one is not marked done');
  ok(!h.writes.includes('cache/2026q2_d.zip'), '429: nothing cached for the refused file');
  eq(h.deps.archive.requestsSince(0), 3, 'every request is logged, the refused one too');

  // A 403 the same.
  h = harness({ statuses: { 'form-d-data-sets': 403 } });
  r = await run(['--commit'], h).catch((e) => ({ ok: false, threw: e.message }));
  eq(h.calls.length, 1, '403 on the page: one request, then nothing');
  ok(/403|refused/.test(r.threw || r.stopped || ''), '403 is named');

  // Never fetched twice: cached ZIPs and the cached page cost nothing.
  h = harness({ cachedUrls: ['2026q3_d.zip', '2026q2_d.zip'], pageCached: true });
  r = await run(['--commit', '--max', '2'], h);
  eq([r.loaded, h.calls.length], [2, 0], 'cached page and ZIPs: no requests');
  r = await run(['--commit', '--max', '2'], h);
  eq(h.calls.length, 2, 'loaded quarters are skipped; the next two are fetched');
  ok(h.calls.every((c) => /2026q1|2025q4/.test(c.url)), 'only the quarters not yet loaded');

  // Dry run downloads no ZIP.
  h = harness();
  r = await run([], h);
  ok(r.ok && h.calls.length === 1 && /form-d-data-sets$/.test(h.calls[0].url), 'dry run: at most the page, no ZIP');
  h = harness({ pageCached: true });
  await run([], h);
  eq(h.calls.length, 0, 'dry run with the page cached: no requests at all');

  // The 24-hour cap.
  const full = Archive.open(':memory:');
  for (let i = 0; i < L.DAY_CAP; i++) full.noteRequest('x', 200, 1, 1);
  full.db.prepare('update requests set at = ?').run(1e12 - 3600e3);
  h = harness({ archive: full });
  r = await run(['--commit'], h).catch((e) => ({ ok: false, threw: e.message }));
  eq(h.calls.length, 0, 'cap used up: no request made');
  ok(/cap/.test(r.threw || ''), 'cap is named');
  const nearly = Archive.open(':memory:');
  for (let i = 0; i < L.DAY_CAP - 2; i++) nearly.noteRequest('x', 200, 1, 1);
  nearly.db.prepare('update requests set at = ?').run(1e12 - 3600e3);
  h = harness({ archive: nearly });
  r = await run(['--commit', '--max', 'all'], h);
  eq([h.calls.length, r.ok], [2, false], 'two left under the cap: page and one ZIP, then it stops');
  const old = Archive.open(':memory:');
  for (let i = 0; i < L.DAY_CAP; i++) old.noteRequest('x', 200, 1, 1);
  old.db.prepare('update requests set at = ?').run(1e12 - 25 * 3600e3);
  h = harness({ archive: old });
  r = await run(['--commit', '--max', '1'], h);
  eq(r.loaded, 1, 'requests older than 24 hours do not count');

  // A network failure stops too, never retried.
  h = harness();
  h.deps.fetch = async (url) => { h.calls.push({ url, at: 0 }); throw new Error('ECONNRESET'); };
  r = await run(['--commit'], h).catch((e) => ({ ok: false, threw: e.message }));
  eq(h.calls.length, 1, 'network failure: one attempt');

  console.log(`formd-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
