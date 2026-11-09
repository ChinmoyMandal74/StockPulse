// PPP loans, the read step (ppp-load.js --load): the SBA's CSVs already on
// disk into the LOCAL formd.db (table ppp_loans), no request. Backlog 61, E6;
// docs/context/ppp-loans.md.
//
// KEPT: named businesses only, one row a loan: number, approval date, first or
// second draw, business name and its match key, city, state, 5-digit ZIP,
// jobs reported, industry code, loan amount, forgiven amount, business type,
// business age, non-profit flag. NOT KEPT: street addresses, lender details,
// and the borrower demographics the files carry (race, ethnicity, gender,
// veteran status); nor any loan whose name was withheld ("Exemption 6") or
// whose borrower is a person (sole proprietor, self-employed individual,
// independent contractor). No EIN is published, so a business is matched to
// the plan sponsors and the Form D issuers by `nameKey` and state: inexact,
// and shown as such.
'use strict';
const fs = require('fs');
const readline = require('readline');
const { splitCsv } = require('./f5500.js');

const PEOPLE = /^(sole proprietorship|self-employed individuals|independent contractors|single member llc)$/i;
const SUFFIX = /\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LIMITED|LTD|LLC|L L C|LLP|LP|PLLC|PC|PA|THE|AND|OF)\b/g;

// A name reduced for matching: capitals, '&' as AND, punctuation and the
// legal suffixes dropped. "Continental Electrical Construction Co., LLC" and
// "CONTINENTAL ELECTRICAL CONSTRUCTION CO LLC" both give
// "CONTINENTAL ELECTRICAL CONSTRUCTION".
function nameKey(name) {
  const s = String(name || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]+/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
  return s.length >= 3 ? s : null;
}

const num = (s) => { const t = String(s == null ? '' : s).trim(); return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
const day = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim()); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };
const text = (s) => { const t = String(s == null ? '' : s).trim(); return t && !/^(N\/A|NA|NOT AVAILABLE)$/i.test(t) ? t : null; };

// One CSV record into a row, or null when it is not kept (and why).
function rowOf(f, at) {
  const g = (k) => (at[k] >= 0 ? f[at[k]] : null);
  const name = text(g('BorrowerName'));
  if (!name || /^exemption\s*\d/i.test(name)) return { skip: 'withheld' };
  const type = text(g('BusinessType'));
  if (type && PEOPLE.test(type)) return { skip: 'person' };
  const key = nameKey(name);
  if (!key) return { skip: 'no name' };
  const zip = String(g('BorrowerZip') || g('ProjectZip') || '').trim().slice(0, 5);
  return {
    loan: text(g('LoanNumber')),
    approved: day(g('DateApproved')),
    draw: g('ProcessingMethod') === 'PPS' ? 2 : 1,
    name, name_key: key,
    city: text(g('BorrowerCity')) || text(g('ProjectCity')),
    state: text(g('BorrowerState')) || text(g('ProjectState')),
    zip: /^\d{5}$/.test(zip) ? zip : null,
    jobs: num(g('JobsReported')),
    naics: /^\d{2,6}$/.test(String(g('NAICSCode') || '').trim()) ? String(g('NAICSCode')).trim() : null,
    amount: num(g('CurrentApprovalAmount')),
    forgiven: num(g('ForgivenessAmount')),
    business_type: type,
    business_age: text(g('BusinessAgeDescription')),
    nonprofit: g('NonProfit') === 'Y' ? 1 : 0,
  };
}

const COLS = ['loan', 'approved', 'draw', 'name', 'name_key', 'city', 'state', 'zip', 'jobs', 'naics', 'amount', 'forgiven', 'business_type', 'business_age', 'nonprofit', 'file'];

function ensureSchema(db) {
  db.exec(`
    create table if not exists ppp_loans (
      loan text primary key, approved text, draw integer, name text, name_key text, city text, state text, zip text,
      jobs real, naics text, amount real, forgiven real, business_type text, business_age text, nonprofit integer, file text
    );
    create index if not exists idx_ppp_key on ppp_loans (name_key, state);
    create table if not exists ppp_files (file text primary key, read integer, kept integer, withheld integer, people integer, bad integer, at integer not null);
  `);
}

// Every file on disk not yet read; each one all or nothing.
async function load(opts, deps) {
  const log = deps.log || console.log;
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(process.env.FORMD_DB || require('path').join(__dirname, 'formd.db'));
  db.exec('pragma busy_timeout = 10000; pragma journal_mode = wal;');
  ensureSchema(db);
  // The file list comes in deps: ppp-load.js, run as the main script, has
  // not finished defining its exports when it calls this.
  const FILES = deps.files || require('./ppp-load.js').FILES;
  const done = new Set(db.prepare('select file from ppp_files').all().map((r) => r.file));
  const todo = FILES.filter((f) => deps.onDisk(f) && !done.has(f));
  log(`${todo.length} file(s) on disk to read${opts.commit ? '' : ' (DRY RUN: add --commit)'}`);
  if (!opts.commit) { db.close(); return { ok: true, todo: todo.length }; }
  const ins = db.prepare(`insert or ignore into ppp_loans (${COLS.join(', ')}) values (${COLS.map(() => '?').join(', ')})`);
  for (const f of todo) {
    const t0 = Date.now();
    const rl = readline.createInterface({ input: fs.createReadStream(deps.pathOf(f), { highWaterMark: 1 << 20 }), crlfDelay: Infinity });
    let header = null, at = null, pending = '', read = 0, kept = 0, bad = 0;
    const skip = { withheld: 0, person: 0, 'no name': 0 };
    db.exec('begin');
    try {
      for await (const line of rl) {
        const t = pending ? pending + '\n' + line : line;
        const fl = splitCsv(t);
        if (!fl) { pending = t; continue; }
        pending = '';
        if (!header) {
          header = fl.map((h) => h.replace(/^﻿/, '').trim());
          at = Object.fromEntries(['LoanNumber', 'DateApproved', 'ProcessingMethod', 'BorrowerName', 'BorrowerCity', 'BorrowerState', 'BorrowerZip', 'ProjectCity', 'ProjectState', 'ProjectZip',
            'JobsReported', 'NAICSCode', 'CurrentApprovalAmount', 'ForgivenessAmount', 'BusinessType', 'BusinessAgeDescription', 'NonProfit'].map((k) => [k, header.indexOf(k)]));
          if (at.LoanNumber < 0 || at.BorrowerName < 0) throw new Error(f + ': the header lacks LoanNumber or BorrowerName; the layout may have changed');
          continue;
        }
        read++;
        if (fl.length !== header.length) { bad++; continue; }
        const r = rowOf(fl, at);
        if (r.skip) { skip[r.skip]++; continue; }
        if (!r.loan) { bad++; continue; }
        ins.run(...COLS.map((c) => (c === 'file' ? f : r[c] ?? null)));
        kept++;
      }
      db.prepare('insert into ppp_files (file, read, kept, withheld, people, bad, at) values (?, ?, ?, ?, ?, ?, ?)').run(f, read, kept, skip.withheld, skip.person, bad, Date.now());
      db.exec('commit');
    } catch (e) { try { db.exec('rollback'); } catch (_) { /* already */ } db.close(); log(`${f}: ${e.message}`); return { ok: false, stopped: e.message }; }
    log(`${f}: ${read.toLocaleString('en-US')} loans read, ${kept.toLocaleString('en-US')} businesses kept (${skip.withheld.toLocaleString('en-US')} names withheld, ${skip.person.toLocaleString('en-US')} people left out${bad ? ', ' + bad + ' unreadable' : ''}), ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const n = db.prepare('select count(*) n from ppp_loans').get().n;
  db.close();
  log(`ppp_loans: ${n.toLocaleString('en-US')} loans to named businesses.`);
  return { ok: true, loans: n };
}

module.exports = { load, rowOf, nameKey, ensureSchema, COLS };
