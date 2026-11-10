// SBA 7(a) and 504 loans (backlog 61, E13): the row rules and the read step
// (sbaload-read.js) over files made here, and that the loader asks the shared
// SBA download for its own files. No network.
//   node sba-test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sba-test-'));
process.env.FORMD_DB = path.join(tmp, 'formd.db');
const R = require('./sbaload-read.js');
const S = require('./sba-load.js');
const P = require('./ppp-load.js');
const { splitCsv } = require('./f5500.js');

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('FAIL', what); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const H7 = ['AsOfDate', 'Program', 'BorrName', 'BorrStreet', 'BorrCity', 'BorrState', 'BorrZip', 'BankName', 'BankStreet', 'GrossApproval', 'SBAGuaranteedApproval', 'ApprovalDate', 'ApprovalFY',
  'TermInMonths', 'NaicsCode', 'FranchiseName', 'BusinessType', 'BusinessAge', 'LoanStatus', 'PaidInFullDate', 'ChargeOffDate', 'GrossChargeOffAmount', 'JobsSupported'];
const csv = (h, o) => h.map((k) => '"' + String(o[k] ?? '').replace(/"/g, '""') + '"').join(',');
const base = { AsOfDate: '20260930', Program: '7A', BorrName: 'Pump & Process Equipment Co., Inc.', BorrStreet: '1 MAIN ST', BorrCity: 'Birmingham', BorrState: 'AL', BorrZip: '35203-1234',
  BankName: 'Regions Bank', BankStreet: '1900 5TH AVE', GrossApproval: '350000', SBAGuaranteedApproval: '262500', ApprovalDate: '03/15/2012', ApprovalFY: '2012', TermInMonths: '120',
  NaicsCode: '423830', FranchiseName: '', BusinessType: 'CORPORATION', BusinessAge: 'Existing or more than 2 years old', LoanStatus: 'PIF', PaidInFullDate: '2019-06-30', ChargeOffDate: '', GrossChargeOffAmount: '0', JobsSupported: '14' };
const at7 = Object.fromEntries(R.NEED.map((k) => [k, H7.indexOf(k)]));
const r = R.rowOf(splitCsv(csv(H7, base)), at7);
eq([r.program, r.name_key, r.city, r.state, r.zip, r.approved, r.fy, r.amount, r.guaranteed, r.naics, r.jobs, r.lender, r.status, r.paid, r.charged_off],
  ['7A', 'PUMP PROCESS EQUIPMENT', 'Birmingham', 'AL', '35203', '2012-03-15', 2012, 350000, 262500, '423830', 14, 'Regions Bank', 'PIF', '2019-06-30', null], 'a 7(a) loan');
ok(!JSON.stringify(r).includes('MAIN ST') && !JSON.stringify(r).includes('5TH AVE'), 'no street, the borrower\'s or the lender\'s');
eq(R.rowOf(splitCsv(csv(H7, { ...base, BusinessType: 'INDIVIDUAL' })), at7), { skip: 'person' }, 'a loan to an individual is left out');
eq(R.rowOf(splitCsv(csv(H7, { ...base, BorrName: '' })), at7), { skip: 'no name' }, 'no name: left out');
eq(R.rowOf(splitCsv(csv(H7, { ...base, LoanStatus: 'P I F' })), at7).status, 'PIF', 'older loans\' "P I F" read as PIF');
eq(r.loan, R.rowOf(splitCsv(csv(H7, { ...base, LoanStatus: 'CHGOFF' })), at7).loan, 'the key does not move when a loan\'s status does');
ok(r.loan !== R.rowOf(splitCsv(csv(H7, { ...base, GrossApproval: '360000' })), at7).loan, 'another amount is another loan');
eq([R.day('3/5/2012'), R.day('2012-03-05 00:00:00'), R.day(''), R.day('03/2012')], ['2012-03-05', '2012-03-05', null, null], 'dates in both forms, nothing invented');
eq(R.rowOf(splitCsv(csv(H7, { ...base, JobsSupported: '', GrossApproval: '$1,250,000' })), at7).jobs, null, 'no jobs figure is blank, not zero');
eq(R.rowOf(splitCsv(csv(H7, { ...base, GrossApproval: '$1,250,000' })), at7).amount, 1250000, 'an amount written with $ and commas');

const H5 = ['AsOfDate', 'Program', 'BorrName', 'BorrStreet', 'BorrCity', 'BorrState', 'BorrZip', 'CDC_Name', 'CDC_Street', 'ThirdPartyLender_Name', 'ThirdPartyDollars', 'GrossApproval', 'ApprovalDate',
  'ApprovalFY', 'TermInMonths', 'NaicsCode', 'BusinessType', 'LoanStatus', 'JobsSupported'];
const at5 = Object.fromEntries(R.NEED.map((k) => [k, H5.indexOf(k)]));
const r5 = R.rowOf(splitCsv(csv(H5, { Program: '504', BorrName: 'Aulick Chemical Solutions', BorrCity: 'Nicholasville', BorrState: 'KY', CDC_Name: 'Kentucky Business Finance', CDC_Street: '9 ELM',
  ThirdPartyDollars: '500000', GrossApproval: '400000', ApprovalDate: '06/01/2018', ApprovalFY: '2018', TermInMonths: '240', NaicsCode: '424690', BusinessType: 'CORPORATION', LoanStatus: 'EXEMPT', JobsSupported: '25' })), at5);
eq([r5.program, r5.third_party, r5.guaranteed, r5.lender, r5.jobs], ['504', 500000, null, 'Kentucky Business Finance', 25], 'a 504 loan: the CDC is the lender, the bank\'s part kept');

// The loader's own files and the shared download's rules.
eq(S.FILES.length, 6, 'six files: four 7(a), two 504');
ok(S.FILES.every((f) => /_asof_\d{6}\.csv$/.test(f)), 'each names its quarterly release');

(async () => {
  // The read step over two files made here: all or nothing each, read once.
  const dir = path.join(tmp, 'files');
  fs.mkdirSync(dir);
  const f1 = S.FILES[0], f2 = S.FILES[4];
  fs.writeFileSync(path.join(dir, f1), '﻿' + H7.join(',') + '\n' + csv(H7, base) + '\n' + csv(H7, { ...base, BusinessType: 'INDIVIDUAL' }) + '\n' + csv(H7, { ...base, BorrName: 'Second Co', GrossApproval: '90000' }) + '\n' + '"short","row"\n');
  fs.writeFileSync(path.join(dir, f2), H5.join(',') + '\n' + csv(H5, { Program: '504', BorrName: 'Third LLC', BorrCity: 'X', BorrState: 'KY', GrossApproval: '1000', ApprovalDate: '01/02/2015' }) + '\n');
  const logs = [];
  const deps = { log: (s) => logs.push(s), files: [f1, f2], pathOf: (f) => path.join(dir, f), onDisk: (f) => fs.existsSync(path.join(dir, f)) };
  const dry = await R.load({ commit: false }, deps);
  eq(dry.todo, 2, 'a dry run counts the files and reads nothing');
  const a = await R.load({ commit: true }, deps);
  eq(a.loans, 3, 'three loans to businesses kept; the individual and the broken row left out');
  const again = await R.load({ commit: true }, deps);
  eq(again.loans, 3, 'a file read once is not read again');
  ok(logs.some((s) => /1 to individuals left out, 1 unreadable/.test(s)), 'the log says what was left out');
  // The download is the PPP loader's, pointed at this loader's files and address.
  const calls = [];
  const h = { log: () => {}, now: () => 1e12, sleep: async () => {}, onDisk: () => false, readLog: () => [], noteRequest: () => {}, files: S.FILES, base: S.BASE,
    fetch: async (url) => { calls.push(url); return { status: 404, body: { cancel: async () => {} } }; }, save: async () => 1 };
  const d = await P.download({ commit: true, gapS: 60 }, h);
  ok(!d.ok && calls.length === 1 && calls[0] === S.BASE + S.FILES[0], 'the shared download fetches this loader\'s first file and stops at a refusal');
  console.log(`sba-test: ${pass} passed, ${fail} failed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
