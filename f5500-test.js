// Form 5500 (backlog 61, E2): the rules (f5500.js), the archive
// (f5500archive.js) and the loader's care (f5500-load.js). No network: the
// fetches are fakes, the ZIPs made here.
//   node f5500-test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('./f5500.js');
const Archive = require('./f5500archive.js');
const L = require('./f5500-load.js');
const NAICS = require('./naics.json').codes;

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('FAIL', what); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---- CSV ----
eq(P.splitCsv('"a","b,c",,"d ""q"" e",5'), ['a', 'b,c', '', 'd "q" e', '5'], 'quoted, commas inside, empty, doubled quotes, bare number');
eq(P.splitCsv('"open field'), null, 'an open quote is not a record yet');
eq(P.splitCsv('"open\nfield",x'), ['open\nfield', 'x'], 'joined across a line break');

// ---- one short-form row (the real header's columns, a real-shaped line) ----
const H = ['ACK_ID', 'SF_PLAN_YEAR_BEGIN_DATE', 'SF_PLAN_NAME', 'SF_PLAN_NUM', 'SF_SPONSOR_NAME', 'SF_SPONSOR_DFE_DBA_NAME', 'SF_SPONS_US_ADDRESS1', 'SF_SPONS_US_CITY',
  'SF_SPONS_US_STATE', 'SF_SPONS_US_ZIP', 'SF_SPONS_EIN', 'SF_SPONS_PHONE_NUM', 'SF_BUSINESS_CODE', 'SF_TOT_PARTCP_BOY_CNT', 'SF_NET_ASSETS_EOY_AMT',
  'SF_TYPE_PENSION_BNFT_CODE', 'SF_TYPE_WELFARE_BNFT_CODE', 'SF_TOT_ACT_PARTCP_BOY_CNT', 'SF_TOT_ACT_PARTCP_EOY_CNT', 'SF_SIGNED_NAME'];
const LINE = '"20250103134059NAL0003739905003","2024-01-01","NORTH TEXAS COMPRESSION, INC. 401(K) PROFIT SHARING AND TRUST","001","NORTH TEXAS COMPRESSION, INC.",,"101 TURKEY CREEK TRAIL, SUITE 1","BRIDGEPORT","TX","76426","470871940","9406835025","211120",15,334587,"2E2J2K2F2G3D3H",,15,0,"DWAYNE GARRETT"';
const row = P.reader(H, 'sf')(P.splitCsv(LINE));
eq([row.ack_id, row.form, row.ein, row.sponsor, row.plan_year, row.business_code], ['20250103134059NAL0003739905003', '5500-SF', '470871940', 'NORTH TEXAS COMPRESSION, INC.', '2024-01-01', '211120'], 'the row');
eq([row.participants, row.active, row.active_boy, row.net_assets], [15, 0, 15, 334587], 'counts and assets; a real 0 stays 0');
eq([row.city, row.state, row.dba], ['BRIDGEPORT', 'TX', null], 'city, state; a blank is null');
const blob = JSON.stringify(row);
ok(!blob.includes('TURKEY CREEK') && !blob.includes('76426') && !blob.includes('9406835025') && !blob.includes('DWAYNE'), 'no street, zip, telephone or signer kept');
const blanks = P.reader(H, 'sf')(P.splitCsv(LINE.replace(',15,334587,', ',,,')));
eq([blanks.participants, blanks.net_assets], [null, null], 'a blank count is null, not 0');
eq(P.reader(H, 'sf')(P.splitCsv(LINE.replace('"470871940"', '"000000000"'))).ein, null, 'a zero EIN is none');
let threw = false; try { P.reader(['X', 'Y'], 'sf'); } catch (_) { threw = true; }
ok(threw, 'a header without ACK_ID or the EIN is refused');
const full = P.reader(['ACK_ID', 'SPONS_DFE_EIN', 'BUSINESS_CODE', 'TOT_PARTCP_BOY_CNT', 'TOT_ACTIVE_PARTCP_CNT'], 'full')(['A1', '123456789', '541511', '250', '240']);
eq([full.form, full.ein, full.participants, full.active, full.net_assets], ['5500', '123456789', 250, 240, null], 'the full form; no assets column read from it');

// ---- codes ----
eq(P.naicsTitle('541511', NAICS), { code: '541511', title: 'Custom Computer Programming Services', exact: true }, 'an exact code');
eq(P.naicsTitle('523900', NAICS).code, '5239', 'padding zeros dropped (523900 is NAICS 5239)');
eq(P.naicsTitle('523900', NAICS).exact, true, 'which is the same code');
eq(P.naicsTitle('511210', NAICS).title, 'Software Publishers', 'a code 2022 retired, from the 2017 list');
eq(P.naicsTitle('999999', NAICS), null, 'an unknown code is null');
eq(P.naicsTitle('x', NAICS), null, 'junk is null');
eq(P.planKind('2E2J2K2F2G3D3H', null), 'retirement savings (defined contribution)', 'a 401(k)');
eq(P.planKind('1A1I', null), 'pension (defined benefit)', 'a pension');
eq(P.planKind(null, '4A4B'), 'welfare (health, life or disability)', 'a welfare plan');
eq(P.planKind(null, null), null, 'no types');
eq(P.fileUrl(2024, 'sf'), 'https://www.askebsa.dol.gov/FOIA%20Files/2024/Latest/F_5500_SF_2024_Latest.zip', 'the short form file');
eq(P.fileUrl(2015, 'full'), 'https://www.askebsa.dol.gov/FOIA%20Files/2015/Latest/F_5500_2015_Latest.zip', 'the full form file');

// ---- a ZIP made here, read by the loader ----
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'f5500-test-'));
const other = LINE.replace('20250103134059NAL0003739905003', 'B2').replace('"470871940"', '"111111111"');
const broken = LINE.replace('20250103134059NAL0003739905003', 'B3').replace('"NORTH TEXAS COMPRESSION, INC. 401(K)', '"NORTH TEXAS\nCOMPRESSION 401(K)');
const short = '"B4","2024-01-01"';
const CSV = [H.map((h) => '"' + h + '"').join(','), LINE, other, broken, short].join('\r\n') + '\r\n';
const ZIPBUF = makeZip({ 'f_5500_sf_2024_latest.csv': CSV, 'f_5500_sf_2024_latest_layout.txt': 'x' });
const FULLBUF = makeZip({ 'f_5500_2024_latest.csv': 'ACK_ID,SPONS_DFE_EIN,BUSINESS_CODE,TOT_PARTCP_BOY_CNT\r\n"F1","470871940","541511",250\r\n' });

(async () => {
  const zf = path.join(TMP, 'F_5500_SF_2024_Latest.zip');
  fs.writeFileSync(zf, ZIPBUF);
  const r = await L.readFile(zf, 'sf', new Set(['470871940']));
  eq([r.read, r.bad, r.rows.map((x) => x.ack_id)], [4, 1, ['20250103134059NAL0003739905003', 'B3']], 'kept: wanted EINs only; a line break inside a field joined; a short row counted bad');
  eq(r.rows[1].plan, 'NORTH TEXAS\nCOMPRESSION 401(K) PROFIT SHARING AND TRUST', 'the joined field');

  // ---- the archive ----
  const A = Archive.open(':memory:');
  eq(A.issuerEins().size, 0, 'no Form D profiles, no EINs');
  A.db.exec("create table fd_profiles (cik text, as_of text, ein text); insert into fd_profiles values ('1', '2026-11-09', '470871940'), ('2', '2026-11-09', null)");
  eq([...A.issuerEins()], ['470871940'], 'the issuers\' EINs');
  const meta = { file: 'F_5500_SF_2024_Latest.zip', year: 2024, kind: 'sf', bytes: 1, read: 4, bad: 1, eins: 1 };
  eq(A.loadFile(meta, r.rows), 2, 'rows written');
  eq(A.loadFile(meta, [{ ...r.rows[0], participants: 999 }]), 0, 'a filing already on file is not replaced');
  eq(A.db.prepare('select participants from f5500_plans where ack_id = ?').get('20250103134059NAL0003739905003').participants, 15, 'the first copy stands');
  ok(A.loaded().has('F_5500_SF_2024_Latest.zip'), 'the file is recorded');
  threw = false; try { A.loadFile({ ...meta, file: 'x' }, [{ ...r.rows[0], ack_id: 'X1' }, { get ack_id() { throw new Error('boom'); } }]); } catch (_) { threw = true; }
  ok(threw && !A.loaded().has('x') && !A.db.prepare("select 1 from f5500_plans where ack_id = 'X1'").get(), 'a failed file leaves no rows and no load record');

  // ---- the loader's care ----
  function harness({ status = 200, onDisk = [] } = {}) {
    const bodyOf = (name) => (/_SF_/.test(name) ? ZIPBUF : FULLBUF);
    const B = Archive.open(':memory:');
    B.db.exec("create table fd_profiles (cik text, as_of text, ein text); insert into fd_profiles values ('1', '2026-11-09', '470871940')");
    const calls = [], logs = [], waits = [];
    let t = 1e12;
    const disk = new Set(onDisk);
    const deps = {
      archive: B, log: (s) => logs.push(s), now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; },
      fetch: async (url) => { calls.push(url); t += 1000; return { status, body: null, url, cancel: async () => {} }; },
      pathOf: (name) => path.join(TMP, name),
      onDisk: (name) => disk.has(name),
      sizeOf: (name) => bodyOf(name).length,
      save: async (res, dest) => { const b = bodyOf(path.basename(dest)); fs.writeFileSync(dest, b); disk.add(path.basename(dest)); return b.length; },
    };
    return { B, calls, logs, waits, deps };
  }
  const NOW = new Date('2026-11-09T12:00:00');
  let h = harness();
  await L.run(L.options(['--years', '2024'], NOW), h.deps);
  eq(h.calls.length, 0, 'a dry run makes no request');
  h = harness();
  const ok1 = await L.run(L.options(['--commit', '--years', '2024'], NOW), h.deps);
  eq([ok1.ok, h.calls.length], [true, 2], 'two files a year, one request each');
  eq(h.waits, [60000], 'a minute between requests');
  eq(h.B.stats().plans.n, 3, 'the wanted plans kept, from both forms');
  // A file whose header does not fit its form stops the run, cleanly.
  fs.writeFileSync(path.join(TMP, 'F_5500_2023_Latest.zip'), ZIPBUF);
  threw = ''; try { await L.readFile(path.join(TMP, 'F_5500_2023_Latest.zip'), 'full', new Set()); } catch (e) { threw = e.message; }
  ok(/lacks ACK_ID or the EIN/.test(threw), 'a header that does not fit is an error, caught: ' + threw);
  h = harness({ status: 403 });
  const r403 = await L.run(L.options(['--commit', '--years', '2024'], NOW), h.deps);
  ok(!r403.ok && h.calls.length === 1 && /403/.test(r403.stopped), '403: stopped at once, nothing retried');
  eq(h.B.requestsSince(0), 1, 'the refused request is logged');
  h = harness({ onDisk: ['F_5500_SF_2024_Latest.zip'] });
  await L.run(L.options(['--commit', '--years', '2024', '--max', '1'], NOW), h.deps);
  eq(h.calls.length, 0, 'a file on disk is never fetched again');
  h = harness();
  await L.run(L.options(['--rematch', '--commit', '--years', '2024'], NOW), h.deps);
  eq(h.calls.length, 0, '--rematch makes no request');
  h = harness();
  for (let i = 0; i < 40; i++) h.B.noteRequest('u', 200, 1, 1);
  const capped = await L.run(L.options(['--commit', '--years', '2024'], NOW), h.deps);
  ok(!capped.ok && h.calls.length === 0 && /cap/.test(capped.stopped), 'the 24-hour cap stops it before a request');
  eq(L.options(['--gap', '5'], NOW).gapS, 30, 'the gap is never under 30s');
  eq(L.options([], NOW).years[0], 2025, 'newest year first');
  eq(L.options([], NOW).years.slice(-1)[0], 2009, 'back to 2009');
  eq(L.options([], NOW).max, 2, 'two files a run by default');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`f5500-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
