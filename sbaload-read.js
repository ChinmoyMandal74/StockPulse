// SBA 7(a) and 504 loans, the read step (sba-load.js --load): the SBA's FOIA
// CSVs already on disk into the LOCAL formd.db (table sba_loans), no request.
// Backlog 61, E13; docs/context/sba-loans.md.
//
// KEPT: loans to businesses, one row a loan: program, borrower name and its
// match key, city, state, 5-digit ZIP, approval date and fiscal year, the
// amount (and SBA's guaranteed part, or the third-party lender's part of a
// 504), term, industry code, franchise, business type and age, jobs
// supported, the lender's name, and how the loan stands (paid in full,
// charged off, with the dates and the amount charged off).
// NOT KEPT: street addresses (the borrower's and the lender's), and any loan
// to an individual, whose "business name" is a person's name.
// The files carry no loan number: a loan's key is a hash of its own fields.
// A later quarterly release adds the loans it does not already hold; the
// status of a loan already kept is left as first read.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const readline = require('readline');
const { splitCsv } = require('./f5500.js');
const { nameKey } = require('./pppload-read.js');

const num = (s) => { const t = String(s == null ? '' : s).replace(/[$,]/g, '').trim(); return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
// Dates come as MM/DD/YYYY or YYYY-MM-DD (with a time, sometimes).
const day = (s) => { const t = String(s || '').trim(); let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t); if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const text = (s) => { const t = String(s == null ? '' : s).trim(); return t && !/^(N\/A|NA|NULL|NOT AVAILABLE)$/i.test(t) ? t : null; };
const NEED = ['Program', 'BorrName', 'BorrCity', 'BorrState', 'BorrZip', 'BankName', 'CDC_Name', 'GrossApproval', 'SBAGuaranteedApproval', 'ThirdPartyDollars', 'ApprovalDate', 'ApprovalFY',
  'TermInMonths', 'NaicsCode', 'FranchiseName', 'BusinessType', 'BusinessAge', 'LoanStatus', 'PaidInFullDate', 'ChargeOffDate', 'GrossChargeOffAmount', 'JobsSupported'];

// One CSV record into a row, or { skip } when it is not kept.
function rowOf(f, at) {
  const g = (k) => (at[k] >= 0 ? f[at[k]] : null);
  const name = text(g('BorrName'));
  if (!name) return { skip: 'no name' };
  const type = text(g('BusinessType'));
  if (type && /^individual$/i.test(type)) return { skip: 'person' };
  const key = nameKey(name);
  if (!key) return { skip: 'no name' };
  const zip = String(g('BorrZip') || '').trim().slice(0, 5);
  const naics = String(g('NaicsCode') || '').trim();
  const r = {
    program: /504/.test(String(g('Program') || '')) ? '504' : '7A',
    name, name_key: key,
    city: text(g('BorrCity')), state: text(g('BorrState')), zip: /^\d{5}$/.test(zip) ? zip : null,
    approved: day(g('ApprovalDate')), fy: num(g('ApprovalFY')),
    amount: num(g('GrossApproval')), guaranteed: num(g('SBAGuaranteedApproval')), third_party: num(g('ThirdPartyDollars')),
    term: num(g('TermInMonths')), naics: /^\d{2,6}$/.test(naics) ? naics : null, franchise: text(g('FranchiseName')),
    business_type: type, business_age: text(g('BusinessAge')), jobs: num(g('JobsSupported')),
    lender: text(g('BankName')) || text(g('CDC_Name')),
    status: text(g('LoanStatus')), paid: day(g('PaidInFullDate')), charged_off: day(g('ChargeOffDate')), charged_off_amount: num(g('GrossChargeOffAmount')),
  };
  r.loan = crypto.createHash('sha1').update([r.program, r.name, r.city, r.state, r.zip, r.approved, r.amount, r.lender, r.term].join('|')).digest('hex').slice(0, 20);
  return r;
}

const COLS = ['loan', 'program', 'name', 'name_key', 'city', 'state', 'zip', 'approved', 'fy', 'amount', 'guaranteed', 'third_party', 'term', 'naics', 'franchise',
  'business_type', 'business_age', 'jobs', 'lender', 'status', 'paid', 'charged_off', 'charged_off_amount', 'file'];

function ensureSchema(db) {
  db.exec(`
    create table if not exists sba_loans (
      loan text primary key, program text, name text, name_key text, city text, state text, zip text, approved text, fy integer,
      amount real, guaranteed real, third_party real, term integer, naics text, franchise text, business_type text, business_age text,
      jobs real, lender text, status text, paid text, charged_off text, charged_off_amount real, file text
    );
    create index if not exists idx_sba_key on sba_loans (name_key, state);
    create table if not exists sba_files (file text primary key, read integer, kept integer, people integer, bad integer, at integer not null);
  `);
}

// Every file on disk not yet read; each one all or nothing.
async function load(opts, deps) {
  const log = deps.log || console.log;
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(process.env.FORMD_DB || require('path').join(__dirname, 'formd.db'));
  db.exec('pragma busy_timeout = 10000; pragma journal_mode = wal;');
  ensureSchema(db);
  const FILES = deps.files || require('./sba-load.js').FILES;
  const done = new Set(db.prepare('select file from sba_files').all().map((r) => r.file));
  const todo = FILES.filter((f) => deps.onDisk(f) && !done.has(f));
  log(`${todo.length} file(s) on disk to read${opts.commit ? '' : ' (DRY RUN: add --commit)'}`);
  if (!opts.commit) { db.close(); return { ok: true, todo: todo.length }; }
  const ins = db.prepare(`insert or ignore into sba_loans (${COLS.join(', ')}) values (${COLS.map(() => '?').join(', ')})`);
  for (const f of todo) {
    const t0 = Date.now();
    const rl = readline.createInterface({ input: fs.createReadStream(deps.pathOf(f), { highWaterMark: 1 << 20 }), crlfDelay: Infinity });
    let header = null, at = null, pending = '', read = 0, kept = 0, bad = 0;
    const skip = { person: 0, 'no name': 0 };
    db.exec('begin');
    try {
      for await (const line of rl) {
        const t = pending ? pending + '\n' + line : line;
        const fl = splitCsv(t);
        if (!fl) { pending = t; continue; }
        pending = '';
        if (!header) {
          header = fl.map((h) => h.replace(/^﻿/, '').trim());
          at = Object.fromEntries(NEED.map((k) => [k, header.indexOf(k)]));
          if (at.BorrName < 0 || at.GrossApproval < 0) throw new Error(f + ': the header lacks BorrName or GrossApproval; the layout may have changed');
          continue;
        }
        read++;
        if (fl.length !== header.length) { bad++; continue; }
        const r = rowOf(fl, at);
        if (r.skip) { skip[r.skip]++; continue; }
        ins.run(...COLS.map((c) => (c === 'file' ? f : r[c] ?? null)));
        kept++;
      }
      db.prepare('insert into sba_files (file, read, kept, people, bad, at) values (?, ?, ?, ?, ?, ?)').run(f, read, kept, skip.person, bad, Date.now());
      db.exec('commit');
    } catch (e) { try { db.exec('rollback'); } catch (_) { /* already */ } db.close(); log(`${f}: ${e.message}`); return { ok: false, stopped: e.message }; }
    log(`${f}: ${read.toLocaleString('en-US')} loans read, ${kept.toLocaleString('en-US')} to businesses kept (${skip.person.toLocaleString('en-US')} to individuals left out${bad ? ', ' + bad + ' unreadable' : ''}), ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const n = db.prepare('select count(*) n from sba_loans').get().n;
  db.close();
  log(`sba_loans: ${n.toLocaleString('en-US')} loans to businesses.`);
  return { ok: true, loans: n };
}

module.exports = { load, rowOf, ensureSchema, COLS, NEED, day };
