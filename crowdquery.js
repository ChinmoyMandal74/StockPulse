// The viewer's Crowdfunding page: every company that has filed a Form C
// (formc_companies, formcarchive.js; backlog 61, E3), with the figures it filed
// for its last two fiscal years. Pure: a query string in, a parameterised
// statement out. Every value is bound; the sort column comes from SORTS.
'use strict';

const PAGE = 50;
// Revenue growth over the two years a filing gives, when the earlier year had
// $50,000 or more (a small base makes a large percentage of nothing).
const GROWTH = 'case when revenue_prior >= 50000 and revenue is not null then revenue / revenue_prior - 1 end';
const SORTS = {
  revenue: 'revenue', name: 'name collate nocase', state: 'state', employees: 'employees',
  net_income: 'net_income', growth: 'growth', filed: 'last_filed', reports: 'reports',
};
const REVENUE_FLOORS = [100000, 1000000, 5000000, 25000000];
const clean = (s, max = 120) => (s == null ? '' : String(s).trim().slice(0, max));

function filters(sp) {
  const get = (k) => clean(sp.get(k));
  const sort = Object.prototype.hasOwnProperty.call(SORTS, get('sort')) ? get('sort') : 'revenue';
  const minRev = Number(get('minRevenue'));
  return {
    q: get('q'),
    state: /^[A-Z]{2}$/.test(get('state').toUpperCase()) ? get('state').toUpperCase() : '',
    minRevenue: REVENUE_FLOORS.includes(minRev) ? minRev : null,
    profit: get('profit') === '1',             // net income above zero in its newest figures
    reports: get('reports') === '1',           // has filed an annual report (C-AR)
    recent: get('recent') === '1',             // filed anything in 2024 or later
    formd: get('formd') === '1',               // also a Form D issuer
    sort,
    dir: get('dir') === 'asc' ? 'asc' : 'desc',
    page: /^\d{1,6}$/.test(get('page')) ? Number(get('page')) : 0,
  };
}

function where(f) {
  const w = [], p = [];
  if (f.q) {
    if (/^\d{1,10}$/.test(f.q)) { w.push('cik = ?'); p.push(String(Number(f.q))); }
    else { w.push("cik in (select cik from formc where name like ? escape '\\' collate nocase)"); p.push('%' + f.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%'); }
  }
  if (f.state) { w.push('state = ?'); p.push(f.state); }
  if (f.minRevenue != null) { w.push('revenue >= ?'); p.push(f.minRevenue); }
  if (f.profit) w.push('net_income > 0');
  if (f.reports) w.push('reports > 0');
  if (f.recent) w.push("last_filed >= '2024'");
  if (f.formd) w.push('cik in (select cik from formd)');
  return { where: w.length ? 'where ' + w.join(' and ') : '', params: p };
}

const COLS = `cik, name, city, state, website, portal, accn, filed, form, period, employees, revenue, revenue_prior, net_income,
  net_income_prior, assets, cash, debt_short, debt_long, maximum, first_filed, last_filed, filings, offerings, reports, ${GROWTH} growth`;

function listSql(f) {
  const { where: w, params } = where(f);
  const col = SORTS[f.sort];
  const bare = col.split(' ')[0];
  return {
    sql: `select * from (select ${COLS} from formc_companies) ${w} order by (${bare} is null), ${col} ${f.dir}, cik limit ${PAGE} offset ${f.page * PAGE}`,
    params,
  };
}
function countSql(f) {
  const { where: w, params } = where(f);
  return { sql: `select count(*) n, sum(revenue) revenue, sum(employees) employees from (select ${COLS} from formc_companies) ${w}`, params };
}

// A company's figures by fiscal year, from its annual reports (C-AR), the only
// filings that say which year they cover (`period`, the year end). Each report
// gives its year and the one before; a newer report's figure for a year wins,
// and a prior-year figure fills only a year no report covers as its own.
const SERIES = ['revenue', 'net_income', 'assets', 'cash', 'employees'];
function fiscalYears(filings) {
  const own = new Map(), prior = new Map();
  const reports = filings.filter((x) => /^C-AR/.test(x.form || '') && /^\d{4}-\d{2}-\d{2}$/.test(x.period || ''))
    .sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0));
  for (const r of reports) {
    const y = Number(r.period.slice(0, 4));
    if (!own.has(y)) own.set(y, { year: y, from: r.accn, ...Object.fromEntries(SERIES.map((k) => [k, r[k] ?? null])) });
    if (!prior.has(y - 1)) prior.set(y - 1, { year: y - 1, from: r.accn, prior: true, ...Object.fromEntries(SERIES.map((k) => [k, k === 'employees' ? null : r[k + '_prior'] ?? null])) });
  }
  for (const [y, v] of prior) if (!own.has(y)) own.set(y, v);
  return [...own.values()].sort((a, b) => a.year - b.year);
}

module.exports = { PAGE, SORTS, GROWTH, REVENUE_FLOORS, filters, where, listSql, countSql, fiscalYears };
