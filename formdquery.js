// The Form D viewer's questions, as SQL (backlog 61; docs/context/form-d.md).
// Pure: a query string in, a parameterised statement out. formd-view.js runs
// them against the LOCAL formd.db, read only.
//
// Every value reaches SQL as a bound parameter; the one piece of text built
// into the statement is the sort column, and that comes from SORTS, never
// from the request.
//
//   const Q = require('./formdquery.js');
//   const f = Q.filters(new URLSearchParams('q=acme&kind=company'));
//   const { where, params } = Q.where(f);
//   Q.listSql(f) -> { sql, params }        // one page of filings
'use strict';

const PAGE = 50;
const FUND = 'Pooled Investment Fund';
const YEAR_MIN = 2008;

// Column, and whether an empty value is possible (nulls always sort last).
const SORTS = { filed: 'filed', sold: 'sold', offered: 'offered', investors: 'investors', name: 'name collate nocase', first_sale: 'first_sale' };

const clean = (s, max = 120) => (s == null ? '' : String(s).trim().slice(0, max));
function intIn(s, lo, hi) {
  if (!/^\d{1,6}$/.test(clean(s))) return null;
  const n = Number(s);
  return n >= lo && n <= hi ? n : null;
}

// The request's filters, each checked; anything unreadable is dropped rather
// than guessed.
function filters(sp, now = new Date()) {
  const get = (k) => clean(sp.get(k));
  const yearMax = now.getFullYear();
  const minSold = /^\d{1,13}$/.test(get('minSold')) ? Number(get('minSold')) : null;
  const sort = Object.prototype.hasOwnProperty.call(SORTS, get('sort')) ? get('sort') : 'filed';
  return {
    q: get('q'),
    // A related person's name (an executive, director or promoter): at least
    // three letters, as it scans every related person.
    person: get('person').replace(/\s+/g, ' ').length >= 3 ? get('person').replace(/\s+/g, ' ') : '',
    from: intIn(get('from'), YEAR_MIN, yearMax),
    to: intIn(get('to'), YEAR_MIN, yearMax),
    kind: ['company', 'fund', 'all'].includes(get('kind')) ? get('kind') : 'company',
    industry: get('industry'),
    fundType: get('fundType'),
    state: /^[A-Z0-9]{2}$/.test(get('state').toUpperCase()) ? get('state').toUpperCase() : '',
    revenue: get('revenue'),
    minSold: minSold != null && minSold > 0 ? minSold : null,
    every: get('every') === '1',
    sort,
    dir: get('dir') === 'asc' ? 'asc' : 'desc',
    page: Math.max(0, intIn(get('page'), 0, 100000) || 0),
  };
}

function where(f) {
  const w = [], p = [];
  if (!f.every) w.push('superseded = 0');
  if (f.q) {
    if (/^\d{10}-\d{2}-\d{6}$/.test(f.q)) { w.push('accn = ?'); p.push(f.q); }
    else if (/^\d{1,10}$/.test(f.q)) { w.push('cik = ?'); p.push(String(Number(f.q))); }
    else { w.push("name like ? escape '\\' collate nocase"); p.push('%' + f.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%'); }
  }
  if (f.person) {
    w.push("accn in (select ACCESSIONNUMBER from fd_persons where (coalesce(FIRSTNAME, '') || ' ' || coalesce(LASTNAME, '')) like ? escape '\\' collate nocase)");
    p.push('%' + f.person.replace(/[\\%_]/g, (c) => '\\' + c) + '%');
  }
  if (f.from != null) { w.push('filed >= ?'); p.push(f.from + '-01-01'); }
  if (f.to != null) { w.push('filed <= ?'); p.push(f.to + '-12-31'); }
  if (f.kind === 'company') { w.push("coalesce(industry, '') <> ?"); p.push(FUND); }
  if (f.kind === 'fund') { w.push('industry = ?'); p.push(FUND); }
  if (f.industry) { w.push('industry = ?'); p.push(f.industry); }
  if (f.fundType) { w.push('fund_type = ?'); p.push(f.fundType); }
  if (f.state) { w.push('state = ?'); p.push(f.state); }
  if (f.revenue === 'disclosed') w.push("revenue_range is not null and revenue_range <> 'Decline to Disclose' and revenue_range <> 'Not Applicable'");
  else if (f.revenue) { w.push('revenue_range = ?'); p.push(f.revenue); }
  if (f.minSold != null) { w.push('sold >= ?'); p.push(f.minSold); }
  return { where: w.length ? 'where ' + w.join(' and ') : '', params: p };
}

const LIST_COLS = 'accn, filed, form, cik, name, city, state, industry, fund_type, revenue_range, entity_type, year_inc, offered, offered_indefinite, sold, remaining, investors, first_sale, superseded';

function listSql(f) {
  const { where: w, params } = where(f);
  const col = SORTS[f.sort];
  const bare = col.split(' ')[0];
  return {
    sql: `select ${LIST_COLS} from formd ${w} order by (${bare} is null), ${col} ${f.dir}, accn desc limit ${PAGE} offset ${f.page * PAGE}`,
    params,
  };
}

// The totals for the same filters: one row, then by year and by industry.
// The amounts leave out the doubtful rows (DOUBT_SQL), which are counted and
// summed apart so the page can say what was left out; the rows themselves
// stay in the list, marked. The median is the middle amount sold, read with
// `median` once `total.priced` is known.
const DOUBT_SQL = `(sold >= ${1e9} and investors is not null and investors <= 2)`;
const KEPT = `case when ${DOUBT_SQL} then null else sold end`;
function totalsSql(f) {
  const { where: w, params } = where(f);
  return {
    total: { sql: `select count(*) n, count(distinct cik) issuers, sum(${KEPT}) sold, count(${KEPT}) priced,
      sum(case when ${DOUBT_SQL} then 1 else 0 end) doubt_n, sum(case when ${DOUBT_SQL} then sold end) doubt_sold from formd ${w}`, params },
    years: { sql: `select substr(filed, 1, 4) y, count(*) n, sum(${KEPT}) sold from formd ${w} group by y order by y`, params },
    industries: { sql: `select industry, count(*) n, sum(${KEPT}) sold from formd ${w} group by industry order by sold desc limit 12`, params },
    median: (priced) => ({ sql: `select ${KEPT} v from formd ${w}${w ? ' and' : ' where'} ${KEPT} is not null order by v limit 1 offset ?`, params: [...params, Math.max(0, Math.floor((priced - 1) / 2))] }),
  };
}

// A figure to look at twice: a billion dollars or more sold to one or two
// investors. The archive holds what was filed (LOWE INTERNATIONAL HOLDING
// CO's $999,999,750,000 from one investor, 2024); the page marks such a row
// rather than leaving it out or changing it. Display only.
const DOUBT_SOLD = 1e9;   // the same test as DOUBT_SQL below
function doubtful(r) {
  return r != null && r.sold != null && Number(r.sold) >= DOUBT_SOLD && r.investors != null && Number(r.investors) <= 2;
}

// The SEC's page for one filing: a link the owner clicks, never fetched here.
function secUrl(cik, accn) {
  if (!/^\d+$/.test(String(cik)) || !/^\d{10}-\d{2}-\d{6}$/.test(String(accn))) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(accn).replace(/-/g, '')}/`;
}

module.exports = { PAGE, FUND, SORTS, DOUBT_SOLD, filters, where, listSql, totalsSql, doubtful, secUrl, LIST_COLS };
