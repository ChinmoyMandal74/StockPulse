// Form D: private companies (and funds) raising money under Regulation D.
// The rules for reading the SEC's quarterly Form D data sets; pure, no I/O.
// The loader is formd-load.js, the local store formdarchive.js, the plan
// backlog entry 61, the notes docs/context/form-d.md.
//
// THE DATA SET. One ZIP a quarter since 2008, six tab-separated tables keyed
// on the filing's accession number: FORMDSUBMISSION (one row a filing: date,
// D or D/A), ISSUERS (the company or companies; one is primary), OFFERING
// (one row a filing: industry, revenue range, amounts, investors),
// RELATEDPERSONS (executives, directors, promoters), RECIPIENTS (brokers paid
// to sell) and SIGNATURES. Measured on 2026 Q3: 15,953 filings, two thirds of
// them pooled investment funds, a third amendments; revenue range "Decline to
// Disclose" or blank on 89%.
//
// THE TRAPS, each found in the real file:
//   - A field holding a quote is CSV-quoted inside the TSV ("text ""x"" more")
//     and must be unquoted; there are no tabs or line breaks inside fields.
//   - Dates are DD-MON-YYYY on the submission, YYYY-MM-DD on the sale date.
//   - "Indefinite" is a real answer for the offering amount and the amount
//     remaining (funds open without a cap): it is not zero and not a number.
//   - The amount sold is a number on every row, and 0 is a real answer.
//   - Column names in the file header and in the metadata JSON differ
//     (YEAROFINC_VALUE_ENTERED against YEAROFINCALUE_ENTERED); the header wins.
'use strict';

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

// The six tables, each with the key the SEC's metadata declares.
const TABLES = {
  FORMDSUBMISSION: { table: 'fd_submissions', key: ['ACCESSIONNUMBER'] },
  ISSUERS: { table: 'fd_issuers', key: ['ACCESSIONNUMBER', 'ISSUER_SEQ_KEY'] },
  OFFERING: { table: 'fd_offering', key: ['ACCESSIONNUMBER'] },
  RELATEDPERSONS: { table: 'fd_persons', key: ['ACCESSIONNUMBER', 'RELATEDPERSON_SEQ_KEY'] },
  RECIPIENTS: { table: 'fd_recipients', key: ['ACCESSIONNUMBER', 'RECIPIENT_SEQ_KEY'] },
  SIGNATURES: { table: 'fd_signatures', key: ['ACCESSIONNUMBER', 'SIGNATURE_SEQ_KEY'] },
};

// "2026Q3_d/OFFERING.tsv" -> 'OFFERING'; anything else -> null.
function tableOf(entryName) {
  const m = /([A-Z]+)\.tsv$/i.exec(String(entryName || ''));
  return m && TABLES[m[1].toUpperCase()] ? m[1].toUpperCase() : null;
}

// One field: the CSV-style quoting undone, surrounding space trimmed, empty -> null.
function unquote(f) {
  let s = String(f == null ? '' : f);
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') s = s.slice(1, -1).replace(/""/g, '"');
  s = s.trim();
  return s === '' ? null : s;
}

// A TSV table as { header, rows, bad }: rows are objects keyed by the header;
// a line with the wrong number of fields is counted in `bad` and skipped.
function parseTsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const header = (lines[0] || '').split('\t').map((h) => h.trim());
  const rows = [];
  let bad = 0;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    const f = l.split('\t');
    if (f.length !== header.length) { bad++; continue; }
    const o = {};
    for (let j = 0; j < header.length; j++) o[header[j]] = unquote(f[j]);
    rows.push(o);
  }
  return { header, rows, bad };
}

// '30-SEP-2026' -> '2026-09-30'; '2026-09-30' passes; anything else -> null.
function isoDate(s) {
  if (s == null) return null;
  const t = String(s).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return t;
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(t);
  if (m && MONTHS[m[2].toUpperCase()]) return `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}`;
  return null;
}

// An amount: a number, or null. "Indefinite", blank and junk are null; the
// caller asks `indefinite()` to tell the first from the others.
function amount(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}
const indefinite = (s) => /^\s*indefinite\s*$/i.test(String(s == null ? '' : s));
const flag = (s) => (s == null ? null : /^(true|yes|y)$/i.test(String(s).trim()) ? 1 : /^(false|no|n)$/i.test(String(s).trim()) ? 0 : null);

// The quarter a data-set address is for: '.../2026q3_d.zip' -> '2026Q3'.
function quarterOf(url) {
  const m = /(\d{4})q([1-4])_d(?:_\d+)?\.zip$/i.exec(String(url || ''));
  return m ? `${m[1]}Q${m[2]}` : null;
}

// The Form D data-set ZIPs linked from the SEC's page, newest quarter first.
function zipLinks(html) {
  const out = new Map();
  for (const m of String(html).matchAll(/href="([^"]+\.zip)"/gi)) {
    const url = m[1].startsWith('http') ? m[1] : 'https://www.sec.gov' + m[1];
    const q = quarterOf(url);
    if (q && /form-d-data-sets/i.test(url) && !out.has(q)) out.set(q, url);
  }
  return [...out].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([quarter, url]) => ({ quarter, url }));
}

// One filing in one row, from its raw rows: the submission, the primary issuer
// (else the first) and the offering. What a reader needs to ask "who raised
// what, when"; the raw tables keep everything else.
function summarise(sub, issuers, off, quarter) {
  if (!sub || !sub.ACCESSIONNUMBER) return null;
  const list = issuers || [];
  const iss = list.find((r) => /^yes$/i.test(r.IS_PRIMARYISSUER_FLAG || '')) || list[0] || {};
  const o = off || {};
  return {
    accn: sub.ACCESSIONNUMBER,
    quarter,
    filed: isoDate(sub.FILING_DATE),
    form: sub.SUBMISSIONTYPE || null,
    cik: iss.CIK ? String(Number(iss.CIK)) : null,
    name: iss.ENTITYNAME || null,
    city: iss.CITY || null,
    state: iss.STATEORCOUNTRY || null,
    entity_type: iss.ENTITYTYPE || null,
    year_inc: /^\d{4}$/.test(iss.YEAROFINC_VALUE_ENTERED || '') ? Number(iss.YEAROFINC_VALUE_ENTERED) : null,
    issuers: list.length,
    industry: o.INDUSTRYGROUPTYPE || null,
    fund_type: o.INVESTMENTFUNDTYPE || null,
    revenue_range: o.REVENUERANGE || null,
    nav_range: o.AGGREGATENETASSETVALUERANGE || null,
    exemptions: o.FEDERALEXEMPTIONS_ITEMS_LIST || null,
    amendment: flag(o.ISAMENDMENT),
    previous_accn: o.PREVIOUSACCESSIONNUMBER || null,
    first_sale: isoDate(o.SALE_DATE),
    yet_to_occur: flag(o.YETTOOCCUR),
    offered: amount(o.TOTALOFFERINGAMOUNT),
    offered_indefinite: indefinite(o.TOTALOFFERINGAMOUNT) ? 1 : 0,
    sold: amount(o.TOTALAMOUNTSOLD),
    remaining: amount(o.TOTALREMAINING),
    investors: amount(o.TOTALNUMBERALREADYINVESTED),
    min_investment: amount(o.MINIMUMINVESTMENTACCEPTED),
    business_combination: flag(o.ISBUSINESSCOMBINATIONTRANS),
    equity: flag(o.ISEQUITYTYPE),
    debt: flag(o.ISDEBTTYPE),
    pooled: flag(o.ISPOOLEDINVESTMENTFUNDTYPE),
  };
}

// Whether the loader may carry on after an answer from sec.gov. Anything but
// a 200 stops the run: a 429 is the SEC asking us to slow down, and a 403 is
// what a blocked address gets. Neither is retried.
function verdict(status) {
  if (status === 200) return { go: true };
  if (status === 429) return { go: false, why: 'the SEC asked this address to slow down (429). Stopped; nothing retried. Wait a day before running again.' };
  if (status === 403) return { go: false, why: 'the SEC refused (403), which is also what a blocked address gets. Stopped; nothing retried. Check www.sec.gov in a browser before running again.' };
  return { go: false, why: `sec.gov answered ${status}. Stopped; nothing retried.` };
}

module.exports = { TABLES, tableOf, unquote, parseTsv, isoDate, amount, indefinite, flag, quarterOf, zipLinks, summarise, verdict };
