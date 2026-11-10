// Form C: small companies raising money from the public by crowdfunding
// (Regulation Crowdfunding). The rules for reading the SEC's quarterly Crowdfunding
// Offerings data sets; pure, no I/O. Backlog 61, E3; the loader is formc-load.js,
// the store formcarchive.js (in the LOCAL formd.db), the notes docs/context/form-c.md.
//
// THE DATA SET. One ZIP a quarter since 2016 Q2 ("2026q2_cf.zip"), tab-separated
// tables keyed on the filing's accession number, taken from the fillable part of
// every Form C, C/A (amendment), C-U (progress update), C-AR (annual report),
// C-AR/A and C-TR (termination). What Form D never gives: the company's own
// figures for its last two fiscal years (employees, total assets, cash, debt,
// revenue, cost of sales, taxes, net income), and its website. A C-AR repeats
// them every year the company stays in the regime.
//
// The table names and columns are read from the file itself, not assumed: every
// table is stored as published (formcarchive.js), and the summary reads its
// columns by the names the file's header gives.
'use strict';
const F = require('./formd.js');

// "2026Q2_cf/FORM_C_DISCLOSURE.tsv" -> 'DISCLOSURE'; a non-TSV entry -> null.
function tableOf(entryName) {
  const m = /([A-Za-z0-9_]+)\.tsv$/i.exec(String(entryName || '').split('/').pop());
  if (!m) return null;
  return m[1].toUpperCase().replace(/^FORM_?C_?/, '') || null;
}

// The quarter a data-set address is for: '.../2026q2_cf.zip' -> '2026Q2'.
function quarterOf(url) {
  const m = /(\d{4})q([1-4])_cf(?:_\d+)?\.zip$/i.exec(String(url || ''));
  return m ? `${m[1]}Q${m[2]}` : null;
}

// The data-set ZIPs linked from the SEC's page, newest quarter first.
function zipLinks(html) {
  const out = new Map();
  for (const m of String(html).matchAll(/href="([^"]+\.zip)"/gi)) {
    const url = m[1].startsWith('http') ? m[1] : 'https://www.sec.gov' + m[1];
    const q = quarterOf(url);
    if (q && /crowdfunding/i.test(url) && !out.has(q)) out.set(q, url);
  }
  return [...out].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([quarter, url]) => ({ quarter, url }));
}

// The accession-number column of a table, whatever the header calls it.
const accnCol = (header) => (header || []).find((h) => /^ACCESSION_?NUMBER$/i.test(h)) || null;

module.exports = { tableOf, quarterOf, zipLinks, accnCol, parseTsv: F.parseTsv, isoDate: F.isoDate, amount: F.amount, verdict: F.verdict };
