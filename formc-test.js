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
