// Regulation A (backlog 61, E4): small and mid-sized companies raising up to $75
// million from the public (Tier 2; $20 million Tier 1) under an offering statement
// the SEC qualifies (Form 1-A), then reporting yearly (1-K) and on exit (1-Z).
// The SEC's quarterly Regulation A data sets, loaded by formc-load.js --set rega
// into the LOCAL formd.db (tables ra_*, formcarchive.js); this builds the summary.
// Notes: docs/context/reg-a.md.
//
// WHAT FORM D AND FORM C DO NOT GIVE: each 1-A carries the company's latest
// balance sheet and income figures (cash, total assets and liabilities, equity,
// revenue, costs, net income), its auditor, full- and part-time staff and SIC
// code, and the offering (tier, size, price, fees); each 1-K and 1-Z what was
// actually sold and the net proceeds.
//
//   rega              one row a filing (accn primary key)
//   rega_companies    one row a company: its newest filing with figures, and counts
// Both refreshed by `insert or replace`; nothing is removed. No street, zip or telephone.
'use strict';
const F = require('./formd.js');
const FC = require('./formc.js');

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
// '30-SEP-2026', '18-NOV-25' (a two-digit year is 20xx), '2026-09-30'.
function raDate(s) {
  const t = String(s == null ? '' : s).trim();
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(t);
  if (m && MONTHS[m[2].toUpperCase()]) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}`;
  return FC.fcDate(t);
}
const text = (v) => { const t = v == null ? '' : String(v).trim(); return t || null; };
const cikOf = (v) => { const t = text(v); return t && /^\d+$/.test(t) ? String(Number(t)) : t; };
const num = (v) => F.amount(v);

const COLS = ['accn', 'quarter', 'filed', 'form', 'cik', 'file_number', 'name', 'city', 'state', 'industry_group', 'sic', 'jurisdiction', 'year_inc',
  'employees_ft', 'employees_pt', 'tier', 'audited', 'offering_total', 'price', 'cash', 'assets', 'liabilities', 'equity', 'revenue', 'costs',
  'net_income', 'auditor', 'fiscal_year_end', 'sold_securities', 'net_proceeds'];
const NUM = new Set(['audited', 'year_inc', 'employees_ft', 'employees_pt', 'offering_total', 'price', 'cash', 'assets', 'liabilities', 'equity', 'revenue', 'costs',
  'net_income', 'sold_securities', 'net_proceeds']);

// One filing's row from its rows in each table (any may be missing: a 1-K has
// no offering statement figures; a 1-A POS often only its cover).
// t: { sub, emp, iss, sum, kz, infoK, kzSum: [rows] }
function summaryRow(accn, quarter, t) {
  const s = t.sub || {}, e = t.emp || {}, i = t.iss || {}, o = t.sum || {}, kz = t.kz || {}, ik = t.infoK || {};
  const sold = (t.kzSum || []).map((r) => num(r.OFFERINGSECURITIESSOLD)).filter((v) => v != null);
  const proceeds = (t.kzSum || []).map((r) => num(r.ISSUERNETPROCEEDS)).filter((v) => v != null);
  const audit = text(o.FINANCIALSTATEMENTAUDITSTATUS);
  return {
    accn, quarter, filed: raDate(s.FILING_DATE), form: text(s.SUBMISSIONTYPE), cik: cikOf(s.ISSUERCIK || e.CIK || ik.CIK), file_number: text(s.FILE_NUMBER),
    name: text(e.ISSUERNAME) || text(ik.ISSUERNAME) || text(kz.ISSUERNAME),
    city: text(i.CITY) || text(kz.CITY), state: text(i.STATEORCOUNTRY) || text(kz.STATEORCOUNTRY),
    industry_group: text(i.INDUSTRYGROUP), sic: text(e.SICCODE), jurisdiction: text(e.JURISDICTIONORGANIZATION) || text(ik.JURISDICTIONORGANIZATION),
    year_inc: num(e.YEARINCORPORATION), employees_ft: num(e.FULLTIMEEMPLOYEES), employees_pt: num(e.PARTTIMEEMPLOYEES),
    tier: text(o.INDICATETIER1TIER2OFFERING), audited: audit ? (/^audited$/i.test(audit) ? 1 : /unaudited/i.test(audit) ? 0 : null) : null,
    offering_total: num(o.TOTALAGGREGATEOFFERING), price: num(o.PRICEPERSECURITY),
    cash: num(i.CASHEQUIVALENTS), assets: num(i.TOTALASSETS), liabilities: num(i.TOTALLIABILITIES), equity: num(i.TOTALSTOCKHOLDEREQUITY),
    revenue: num(i.TOTALREVENUES), costs: num(i.COSTANDEXPENSESAPPLTOREVENUES), net_income: num(i.NETINCOME), auditor: text(i.NAMEAUDITOR),
    fiscal_year_end: raDate(kz.FISCALYEAREND),
    sold_securities: sold.length ? sold.reduce((a, b) => a + b, 0) : null, net_proceeds: proceeds.length ? proceeds.reduce((a, b) => a + b, 0) : null,
  };
}

const ident = (s) => '"' + String(s).replace(/[^A-Za-z0-9_]/g, '_') + '"';

// The rega and rega_companies tables from the stored ra_* tables (no requests).
function summarise(db, opts = {}, deps = {}) {
  const log = deps.log || console.log;
  const have = new Set(db.prepare("select name from sqlite_master where type = 'table'").all().map((r) => r.name));
  const T = (n) => 'ra_reg_a_' + n;
  const first = (n) => {
    const m = new Map();
    if (!have.has(T(n))) return m;
    for (const r of db.prepare(`select * from ${ident(T(n))}`).iterate()) if (r.ACCESSION_NUMBER && !m.has(r.ACCESSION_NUMBER)) m.set(r.ACCESSION_NUMBER, r);
    return m;
  };
  const many = (n) => {
    const m = new Map();
    if (!have.has(T(n))) return m;
    for (const r of db.prepare(`select * from ${ident(T(n))}`).iterate()) { if (!r.ACCESSION_NUMBER) continue; if (!m.has(r.ACCESSION_NUMBER)) m.set(r.ACCESSION_NUMBER, []); m.get(r.ACCESSION_NUMBER).push(r); }
    return m;
  };
  const sub = first('submission'), emp = first('employees_info'), iss = first('issuer_info'), sum = first('summary_info'), kz = first('item_kz'), infoK = first('item_info_k'), kzSum = many('summary_info_kz');
  const rows = [];
  for (const [accn, s] of sub) rows.push(summaryRow(accn, s.quarter, { sub: s, emp: emp.get(accn), iss: iss.get(accn), sum: sum.get(accn), kz: kz.get(accn), infoK: infoK.get(accn), kzSum: kzSum.get(accn) }));
  const withFigures = rows.filter((r) => r.assets != null || r.revenue != null).length;
  log(`rega summary: ${rows.length} filings, ${withFigures} with the company's figures, ${new Set(rows.map((r) => r.cik).filter(Boolean)).size} companies`);
  if (!opts.commit) { log('DRY RUN: add --commit to write the summary.'); return { ok: true, rows: rows.length }; }
  db.exec(`create table if not exists rega (${COLS.map((c) => `${c} ${c === 'accn' ? 'text primary key' : NUM.has(c) ? 'real' : 'text'}`).join(', ')});
    create index if not exists idx_rega_cik on rega (cik);
    create index if not exists idx_rega_filed on rega (filed);
    create table if not exists rega_companies (cik text primary key, name text, city text, state text, sic text, industry_group text, year_inc real,
      accn text, filed text, form text, employees_ft real, employees_pt real, cash real, assets real, liabilities real, equity real, revenue real,
      costs real, net_income real, auditor text, tier text, offering_total real, first_filed text, last_filed text, filings integer, offerings integer, reports integer);`);
  const ins = db.prepare(`insert or replace into rega (${COLS.join(', ')}) values (${COLS.map(() => '?').join(', ')})`);
  db.exec('begin');
  try {
    for (const r of rows) ins.run(...COLS.map((c) => r[c] ?? null));
    // A company: its newest filing that gives its figures (a 1-A or its amendment), and its counts.
    db.exec(`insert or replace into rega_companies
      select l.cik, l.name, l.city, l.state, l.sic, l.industry_group, l.year_inc, l.accn, l.filed, l.form, l.employees_ft, l.employees_pt,
        l.cash, l.assets, l.liabilities, l.equity, l.revenue, l.costs, l.net_income, l.auditor, l.tier, l.offering_total,
        a.first_filed, a.last_filed, a.filings, a.offerings, a.reports
      from (select r.*, row_number() over (partition by cik order by (assets is null and revenue is null), filed desc, accn desc) rn
            from rega r where cik is not null) l
      join (select cik, min(filed) first_filed, max(filed) last_filed, count(*) filings,
              sum(form = '1-A') offerings, sum(form in ('1-K', '1-K/A')) reports
            from rega where cik is not null group by cik) a on a.cik = l.cik
      where l.rn = 1`);
    db.exec('commit');
  } catch (e) { try { db.exec('rollback'); } catch (_) { /* gone */ } throw e; }
  const n = db.prepare('select count(*) n from rega_companies').get().n;
  log(`rega summary written: ${rows.length} rows; ${n} companies.`);
  return { ok: true, rows: rows.length, companies: n };
}

module.exports = { raDate, summaryRow, summarise, COLS };
