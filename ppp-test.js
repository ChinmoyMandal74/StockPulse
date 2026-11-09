// PPP loans (backlog 61, E6): the row rules (pppload-read.js), the read step
// over a file made here, and the download's care (ppp-load.js). No network.
//   node ppp-test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./pppload-read.js');
const L = require('./ppp-load.js');

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('FAIL', what); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---- the match key ----
eq(R.nameKey('Continental Electrical Construction Co., LLC'), 'CONTINENTAL ELECTRICAL CONSTRUCTION', 'suffixes and punctuation dropped');
eq(R.nameKey('CONTINENTAL ELECTRICAL CONSTRUCTION CO LLC'), 'CONTINENTAL ELECTRICAL CONSTRUCTION', 'the plan filing spelling meets the loan spelling');
eq(R.nameKey('Smith & Sons, Inc.'), 'SMITH SONS', '& read as AND, then dropped');
eq(R.nameKey('Co.'), null, 'nothing left is no key');

// ---- one row (the real header, real-shaped lines) ----
const H = 'LoanNumber,DateApproved,SBAOfficeCode,ProcessingMethod,BorrowerName,BorrowerAddress,BorrowerCity,BorrowerState,BorrowerZip,LoanStatusDate,LoanStatus,Term,SBAGuarantyPercentage,InitialApprovalAmount,CurrentApprovalAmount,UndisbursedAmount,FranchiseName,ServicingLenderLocationID,ServicingLenderName,ServicingLenderAddress,ServicingLenderCity,ServicingLenderState,ServicingLenderZip,RuralUrbanIndicator,HubzoneIndicator,LMIIndicator,BusinessAgeDescription,ProjectCity,ProjectCountyName,ProjectState,ProjectZip,CD,JobsReported,NAICSCode,Race,Ethnicity,UTILITIES_PROCEED,PAYROLL_PROCEED,MORTGAGE_INTEREST_PROCEED,RENT_PROCEED,REFINANCE_EIDL_PROCEED,HEALTH_CARE_PROCEED,DEBT_INTEREST_PROCEED,BusinessType,OriginatingLenderLocationID,OriginatingLender,OriginatingLenderCity,OriginatingLenderState,Gender,Veteran,NonProfit,ForgivenessAmount,ForgivenessDate';
const BIZ = '9547507704,05/01/2020,0464,PPP,"SUMTER COATINGS, INC.",2410 Highway 15 South,Sumter,,29150-9662,12/18/2020,Paid in Full,24,100,769358.78,769358.78,0,,19248,Synovus Bank,1148 Broadway,COLUMBUS,GA,31901-2429,U,N,N,Existing or more than 2 years old,Sumter,SUMTER,SC,29150-9662,SC-05,62,325510,White,Not Hispanic,,769358.78,,,,,,Corporation,19248,Synovus Bank,COLUMBUS,GA,Male Owned,Non-Veteran,,773553.37,11/20/2020';
const WITHHELD = BIZ.replace('9547507704', '3509338307').replace('"SUMTER COATINGS, INC."', 'Exemption 6');
const PERSON = BIZ.replace('9547507704', '1111111111').replace('"SUMTER COATINGS, INC."', '"JANE DOE"').replace(',Corporation,', ',Sole Proprietorship,');
const SECOND = BIZ.replace('9547507704', '2222222222').replace(',PPP,', ',PPS,').replace(',62,325510,', ',,325510,');
const head = H.split(',');
const at = Object.fromEntries(head.map((h, i) => [h, i]));
const split = (l) => require('./f5500.js').splitCsv(l);
const r = R.rowOf(split(BIZ), at);
eq([r.loan, r.approved, r.draw, r.name, r.name_key, r.city, r.state, r.zip], ['9547507704', '2020-05-01', 1, 'SUMTER COATINGS, INC.', 'SUMTER COATINGS', 'Sumter', 'SC', '29150'], 'the row; the state from the project when the borrower state is blank');
eq([r.jobs, r.naics, r.amount, r.forgiven, r.business_type], [62, '325510', 769358.78, 773553.37, 'Corporation'], 'jobs, industry code, amounts');
const blob = JSON.stringify(r);
ok(!/Highway|White|Hispanic|Male|Veteran|Synovus/.test(blob), 'no street, no demographics, no lender kept');
eq(R.rowOf(split(WITHHELD), at).skip, 'withheld', 'a withheld name is not kept');
eq(R.rowOf(split(PERSON), at).skip, 'person', 'a person is not kept');
const s2 = R.rowOf(split(SECOND), at);
eq([s2.draw, s2.jobs], [2, null], 'a second draw; jobs not reported is null, not 0');

// ---- the read step, over a file made here ----
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-test-'));
process.env.FORMD_DB = path.join(TMP, 'formd.db');
fs.writeFileSync(path.join(TMP, L.FILES[0]), [H, BIZ, WITHHELD, PERSON, SECOND, '"broken,row'].join('\r\n') + '\r\n');
(async () => {
  const logs = [];
  const deps = { log: (s) => logs.push(s), onDisk: (f) => fs.existsSync(path.join(TMP, f)), pathOf: (f) => path.join(TMP, f) };
  const dry = await R.load({ commit: false }, deps);
  eq(dry.todo, 1, 'a dry run counts the file and reads nothing');
  const r1 = await R.load({ commit: true }, deps);
  eq(r1.loans, 2, 'two named businesses kept');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(process.env.FORMD_DB);
  eq(db.prepare('select read, kept, withheld, people from ppp_files').get(), { read: 4, kept: 2, withheld: 1, people: 1 }, 'the file\'s counts (the open quote at the end never closes a record)');
  db.close();
  const r2 = await R.load({ commit: true }, deps);
  eq(r2.loans, 2, 'a file read once is not read again');

  // ---- the download's care ----
  function harness(status) {
    const calls = [], logs2 = [], log = [];
    let t = 1e12;
    return { calls, logs2, log, deps: {
      log: (s) => logs2.push(s), now: () => t, sleep: async (ms) => { t += ms; },
      fetch: async (url) => { calls.push(url); return { status, body: { cancel: async () => {} } }; },
      onDisk: () => false, readLog: () => log, noteRequest: (u, s) => log.push({ at: t, url: u, status: s }),
      save: async () => 1000,
    } };
  }
  let h = harness(200);
  await L.download({ commit: false, gapS: 60 }, h.deps);
  eq(h.calls.length, 0, 'a dry run makes no request');
  h = harness(403);
  const d403 = await L.download({ commit: true, gapS: 60 }, h.deps);
  ok(!d403.ok && h.calls.length === 1, '403: stopped at once, nothing retried');
  h = harness(200);
  for (let i = 0; i < 20; i++) h.log.push({ at: 1e12, url: 'u', status: 200 });
  const capped = await L.download({ commit: true, gapS: 60 }, h.deps);
  ok(!capped.ok && h.calls.length === 0, 'the 24-hour cap stops it before a request');
  eq(L.options(['--gap', '5']).gapS, 30, 'never under 30 seconds apart');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`ppp-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
