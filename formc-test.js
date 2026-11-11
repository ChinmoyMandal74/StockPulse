// Form C (backlog 61, E3): the rules (formc.js), the archive (formcarchive.js)
// and the loader's care with sec.gov (formc-load.js): the pause and its floor, a
// refusal stopping the run with nothing retried, a file never fetched twice, the
// 24-hour cap counted together with the other SEC loaders, a dry run that
// downloads nothing. No network: fetch, the clock and the files are stubbed.
//   node formc-test.js
'use strict';
const FC = require('./formc.js');
const Archive = require('./formdarchive.js');
const CArchive = require('./formcarchive.js');
const L = require('./formc-load.js');

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('FAIL', what); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---- the rules ----
eq(FC.quarterOf('https://www.sec.gov/files/dera/data/crowdfunding-offerings-data-sets/2026q2_cf.zip'), '2026Q2', 'quarter from address');
eq(FC.quarterOf('https://www.sec.gov/files/x/2016q2_cf_0.zip'), '2016Q2', 'the _0 variant');
eq(FC.quarterOf('https://www.sec.gov/files/x/2026q2_d.zip'), null, 'a Form D set is not a Form C set');
const page = '<a href="/files/dera/data/crowdfunding-offerings-data-sets/2026q1_cf.zip">a</a>'
  + '<a href="/files/dera/data/crowdfunding-offerings-data-sets/2026q2_cf.zip">b</a>'
  + '<a href="/files/dera/data/crowdfunding-offerings-data-sets/2026q2_cf.zip">dup</a>'
  + '<a href="/files/structureddata/data/form-d-data-sets/2026q3_d.zip">d</a>';
const links = FC.zipLinks(page);
eq(links.map((l) => l.quarter), ['2026Q2', '2026Q1'], 'zipLinks: newest first, de-duplicated, crowdfunding only');
eq(links[0].url, 'https://www.sec.gov/files/dera/data/crowdfunding-offerings-data-sets/2026q2_cf.zip', 'zipLinks: absolute address');
// Regulation A (E4): the same loader, its own links (two SEC folder names over the years).
const RA = FC.SETS.rega;
eq(FC.quarterOf('https://www.sec.gov/files/structureddata/data/regulation-data-sets/2026q1_rega.zip', RA), '2026Q1', 'a Reg A quarter');
eq(FC.quarterOf('https://www.sec.gov/files/x/2026q1_cf.zip', RA), null, 'a Form C set is not a Reg A set');
const raPage = '<a href="/files/datastandardsinnovation/data/regulation-data-sets/2026q3_rega.zip">a</a>'
  + '<a href="/files/structureddata/data/regulation-a-data-sets/2023q4_rega.zip">b</a>'
  + '<a href="/files/dera/data/crowdfunding-offerings-data-sets/2026q2_cf.zip">c</a>';
eq(FC.zipLinks(raPage, RA).map((l) => l.quarter), ['2026Q3', '2023Q4'], 'Reg A links from both folders, not the Form C one');
eq(FC.zipLinks(raPage).map((l) => l.quarter), ['2026Q2'], 'and Form C still only its own');
{
  const A0 = Archive.open(':memory:');
  const R = CArchive.open(A0.db, RA);
  R.loadQuarter('2026Q1', 'u', { SUBMISSION: FC.parseTsv('ACCESSION_NUMBER\tFORM\n0001-26-1\t1-A\n') }, 1);
  ok(A0.db.prepare("select 1 from sqlite_master where name = 'ra_submission'").get() && A0.db.prepare("select 1 from sqlite_master where name = 'ra_loads'").get(), 'Reg A tables under ra_');
  ok(!CArchive.open(A0.db).loaded().has('2026Q1'), 'a Reg A quarter is not a Form C quarter');
}
eq(FC.tableOf('2026q2_cf/FORM_C_DISCLOSURE.tsv'), 'DISCLOSURE', 'table name, prefix dropped');
eq(FC.tableOf('FORM_C_ISSUER_INFORMATION.tsv'), 'ISSUER_INFORMATION', 'table name with underscores');
eq(FC.tableOf('readme.htm'), null, 'not a table');
eq(FC.accnCol(['X', 'ACCESSION_NUMBER']), 'ACCESSION_NUMBER', 'accession column found');
eq(FC.accnCol(['ACCESSIONNUMBER']), 'ACCESSIONNUMBER', 'accession column without the underscore');

// ---- the archive ----
const tsv = (h, rows) => [h, ...rows].join('\n') + '\n';
const H_SUB = 'ACCESSION_NUMBER\tSUBMISSION_TYPE\tFILING_DATE\tCIK';
const SUB = ['0001670254-26-000101\tC\t20260403\t0001900001', '0001670254-26-000102\tC-AR\t20260410\t0001900002'];
const H_DIS = 'ACCESSION_NUMBER\tCURRENTEMPLOYEES\tREVENUEMOSTRECENTFISCALYEAR';
const DIS = ['0001670254-26-000101\t12\t450000', '0001670254-26-000102\t3\t0'];
const T = () => ({ SUBMISSION: FC.parseTsv(tsv(H_SUB, SUB)), DISCLOSURE: FC.parseTsv(tsv(H_DIS, DIS)) });
{
  const A = Archive.open(':memory:');
  const C = CArchive.open(A.db);
  const c = C.loadQuarter('2026Q2', 'u', T(), 10);
  eq([c.filings, c.rows, c.bad], [2, 4, 0], 'a quarter: filings and rows counted');
  eq(C.loadQuarter('2026Q2', 'u', T(), 10), { skipped: true }, 'a quarter is never loaded twice');
  eq(A.db.prepare('select REVENUEMOSTRECENTFISCALYEAR r from fc_disclosure where ACCESSION_NUMBER = ?').get('0001670254-26-000102').r, '0', 'stored as published: a 0 stays a 0');
  // A later quarter with an extra column adds it; nothing dropped.
  const t2 = { DISCLOSURE: FC.parseTsv(tsv(H_DIS + '\tNEWCOL', ['0001670254-26-000201\t5\t1\tx'])) };
  C.loadQuarter('2026Q3', 'u', t2, 10);
  ok(A.db.prepare('pragma table_info(fc_disclosure)').all().some((x) => x.name === 'NEWCOL'), 'a new column is added');
  // A failure inside a quarter rolls it all back, and the next quarter still loads.
  const bad = { DISCLOSURE: { header: H_DIS.split('\t').concat('OTHER'), rows: [{ get ACCESSION_NUMBER() { throw new Error('boom'); } }] } };
  let threw = false;
  try { C.loadQuarter('2026Q4', 'u', bad, 1); } catch (_) { threw = true; }
  ok(threw && !C.loaded().has('2026Q4'), 'a failed quarter is not marked loaded');
  ok(!A.db.prepare('pragma table_info(fc_disclosure)').all().some((x) => x.name === 'OTHER'), 'its new column rolled back too');
  eq(C.loadQuarter('2027Q1', 'u', T(), 1).rows, 4, 'the next quarter after a rollback still loads');
}

// ---- the summary (the data set's own column names, values as filed) ----
eq(FC.fcDate('20260930'), '2026-09-30', 'a filing date as the data set writes it');
eq(FC.fcDate('2026-10-27'), '2026-10-27', 'a deadline as the data set writes it');
eq(FC.fcDate(''), null, 'a blank date is null');
{
  const A = Archive.open(':memory:');
  const C = CArchive.open(A.db);
  const H_ISS = 'ACCESSION_NUMBER\tNAMEOFISSUER\tLEGALSTATUSFORM\tLEGALSTATUSOTHERDESC\tSTREET1\tZIPCODE\tCITY\tSTATEORCOUNTRY\tISSUERWEBSITE\tCOMPANYNAME\tCOMMISSIONCIK';
  const ISS = ['0001670254-26-000101\tGoSun Inc.\tCorporation\t\t1 Main St\t45202\tCincinnati\tOH\thttps://www.gosun.co\tStartEngine Primary, LLC\t0001661779',
    '0001670254-26-000102\tCGB Green Liberty Notes LLC\tOther\tSeries LLC\t2 Elm St\t06103\tHARTFORD\tCT\tinvest.ctgreenbank.com\t\t'];
  const H_D = 'ACCESSION_NUMBER\tSECURITYOFFEREDTYPE\tSECURITYOFFEREDOTHERDESC\tPRICE\tOFFERINGAMOUNT\tMAXIMUMOFFERINGAMOUNT\tDEADLINEDATE\tOVERSUBSCRIPTIONACCEPTED\tCURRENTEMPLOYEES\tREVENUEMOSTRECENTFISCALYEAR\tREVENUEPRIORFISCALYEAR\tNETINCOMEMOSTRECENTFISCALYEAR\tTOTALASSETMOSTRECENTFISCALYEAR';
  const D = ['0001670254-26-000101\tCommon Stock\t\t4.0\t20000.0\t3741608.0\t2026-12-29\tY\t12\t987762\t\t-1124120\t2423162',
    '0001670254-26-000102\tOther\tNotes\t\t\t\t\t\t1\t0\t237030\t232788\t8127713'];
  const SUB3 = SUB.concat('0001670254-26-000103\tC-TR\t20260420\t0001900003');
  C.loadQuarter('2026Q2', 'u', { SUBMISSION: FC.parseTsv(tsv(H_SUB, SUB3)), ISSUER_INFORMATION: FC.parseTsv(tsv(H_ISS, ISS)), DISCLOSURE: FC.parseTsv(tsv(H_D, D)) }, 10);
  const logs = [];
  eq(CArchive.summarise(A.db, {}, { log: (l) => logs.push(l) }).rows, 3, 'dry run counts every filing');
  ok(!A.db.prepare("select 1 from sqlite_master where name = 'formc'").get(), 'a dry run writes nothing');
  CArchive.summarise(A.db, { commit: true }, { log: () => {} });
  const get = (a) => A.db.prepare('select * from formc where accn = ?').get(a);
  const g = get('0001670254-26-000101');
  eq([g.form, g.filed, g.cik, g.name, g.city, g.state, g.portal, g.portal_cik], ['C', '2026-04-03', '1900001', 'GoSun Inc.', 'Cincinnati', 'OH', 'StartEngine Primary, LLC', '1661779'], 'the filing, the company and its portal');
  eq([g.security, g.price, g.target, g.maximum, g.deadline, g.oversubscription, g.employees], ['Common Stock', 4, 20000, 3741608, '2026-12-29', 1, 12], 'the offering');
  eq([g.revenue, g.revenue_prior, g.net_income, g.assets], [987762, null, -1124120, 2423162], 'the figures as filed: a loss stays negative, a blank stays blank');
  const n = get('0001670254-26-000102');
  eq([n.form, n.legal_form, n.security, n.revenue, n.revenue_prior], ['C-AR', 'Series LLC', 'Notes', 0, 237030], 'an annual report: Other spelled out, a 0 revenue stays 0, not blank');
  const t = get('0001670254-26-000103');
  eq([t.form, t.name, t.revenue], ['C-TR', null, null], 'a termination with no offering tables still gets its row');
  const cols = A.db.prepare('pragma table_info(formc)').all().map((x) => x.name);
  ok(!cols.some((c) => /street|zip/i.test(c)), 'the summary keeps no street or zip');
  CArchive.summarise(A.db, { commit: true }, { log: () => {} });
  eq(A.db.prepare('select count(*) n from formc').get().n, 3, 'a rebuild refreshes rows, never doubles them');
}

// ---- the loader's care with sec.gov ----
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
const ZIP = makeZip({ 'q/FORM_C_SUBMISSION.tsv': tsv(H_SUB, SUB), 'q/FORM_C_DISCLOSURE.tsv': tsv(H_DIS, DIS), 'q/readme.htm': '<html>' });
const NOACCN = makeZip({ 'q/OTHER.tsv': 'A\tB\n1\t2\n' });
const PAGE = ['2026q2', '2026q1', '2025q4', '2025q3'].map((q) => `<a href="/files/dera/data/crowdfunding-offerings-data-sets/${q}_cf.zip">`).join('');

function harness({ statuses = {}, cachedUrls = [], pageCached = false, archive, otherSec = 0, zip = ZIP } = {}) {
  let clock = 1e12;
  const calls = [], writes = [], lines = [];
  const A = archive || Archive.open(':memory:');
  const deps = {
    archive: A,
    formc: CArchive.open(A.db),
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetch: async (url) => {
      calls.push({ url, at: clock });
      clock += 500;
      const status = statuses[url.split('/').pop()] || 200;
      const body = /\.zip$/.test(url) ? zip : Buffer.from(PAGE);
      return { status, arrayBuffer: async () => body, body: { cancel: async () => {} } };
    },
    cachePath: (url) => 'cache/' + url.split('/').pop(),
    cached: (url) => (cachedUrls.includes(url.split('/').pop()) ? ZIP : null),
    readCache: () => (pageCached ? PAGE : null),
    writeCache: (file) => writes.push(file),
    secRequestsSince: (ms) => A.requestsSince(ms) + otherSec,
    log: (s) => lines.push(s),
  };
  return { deps, calls, writes, lines };
}
const run = (argv, h) => L.run(L.options(['node', 'x', ...argv]), h.deps);

(async () => {
  let h = harness();
  let r = await run(['--commit', '--max', '3'], h);
  eq([r.ok, r.loaded, h.calls.length], [true, 3, 4], 'page + three ZIPs');
  ok(h.calls.slice(1).every((c, i) => c.at - h.calls[i].at >= 60000), 'every request at least 60s after the one before by default');
  eq(h.calls.map((c) => c.url.split('/').pop()), ['crowdfunding-offerings-data-sets', '2026q2_cf.zip', '2026q1_cf.zip', '2025q4_cf.zip'], 'newest first');
  ok(h.writes.includes('cache/2026q2_cf.zip'), 'a downloaded ZIP is kept on disk');
  h = harness();
  await run(['--commit', '--max', '2', '--gap', '1'], h);
  ok(h.calls.slice(1).every((c, i) => c.at - h.calls[i].at >= L.MIN_GAP_S * 1000), 'a --gap under the floor is raised to 15s');

  // A 429 or 503 stops the run; nothing is retried; what landed stays.
  for (const st of [429, 503]) {
    h = harness({ statuses: { '2026q1_cf.zip': st } });
    r = await run(['--commit', '--max', '4'], h);
    eq([r.ok, r.loaded, h.calls.length], [false, 1, 3], st + ': one quarter in, stopped at the refusal');
    eq(h.calls.filter((c) => /2026q1/.test(c.url)).length, 1, st + ': asked once, never again');
    ok(h.deps.formc.loaded().has('2026Q2') && !h.deps.formc.loaded().has('2026Q1'), st + ': the refused quarter is not marked done');
    ok(!h.writes.includes('cache/2026q1_cf.zip'), st + ': nothing cached for the refused file');
    eq(h.deps.archive.requestsSince(0), 3, st + ': every request is logged in the shared log, the refused one too');
  }
  h = harness({ statuses: { 'crowdfunding-offerings-data-sets': 403 } });
  r = await run(['--commit'], h).catch((e) => ({ ok: false, threw: e.message }));
  eq(h.calls.length, 1, '403 on the page: one request, then nothing');

  // A ZIP that is not what we expect stops the run and is not kept.
  h = harness({ zip: NOACCN });
  r = await run(['--commit', '--max', '2'], h);
  eq([r.ok, h.calls.length], [false, 2], 'an unexpected ZIP stops the run');
  ok(!h.writes.some((w) => /\.zip$/.test(w)), 'and is not kept as if good');

  // Never fetched twice.
  h = harness({ cachedUrls: ['2026q2_cf.zip', '2026q1_cf.zip'], pageCached: true });
  r = await run(['--commit', '--max', '2'], h);
  eq([r.loaded, h.calls.length], [2, 0], 'cached page and ZIPs: no requests');
  r = await run(['--commit', '--max', '2'], h);
  ok(h.calls.length === 2 && h.calls.every((c) => /2025q4|2025q3/.test(c.url)), 'loaded quarters skipped; only the next two fetched');

  // Dry run downloads no ZIP.
  h = harness();
  r = await run([], h);
  ok(r.ok && h.calls.length === 1 && /crowdfunding-offerings-data-sets$/.test(h.calls[0].url), 'dry run: at most the page');
  h = harness({ pageCached: true });
  await run([], h);
  eq(h.calls.length, 0, 'dry run with the page cached: no requests');

  // The cap counts the other SEC loaders' requests too.
  h = harness({ otherSec: L.DAY_CAP });
  r = await run(['--commit'], h).catch((e) => ({ ok: false, threw: e.message }));
  eq(h.calls.length, 0, 'cap used up by the other loaders: no request made');
  ok(/cap/.test(r.threw || ''), 'cap is named');
  h = harness({ otherSec: L.DAY_CAP - 2 });
  r = await run(['--commit', '--max', 'all'], h);
  eq([h.calls.length, r.ok], [2, false], 'two left under the shared cap: page and one ZIP, then it stops');

  console.log(`formc-test: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
