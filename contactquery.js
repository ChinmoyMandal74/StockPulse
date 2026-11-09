// The Contacts page's questions, as SQL (contactsdb.js builds the tables).
// Pure: a query string in, a parameterised statement out. Every value is
// bound; the sort column and the fixed conditions come from lists here, never
// from the request.
'use strict';
const { GROUPS } = require('./formdquery.js');

const PAGE = 50;
const CSV_MAX = 50000;
const clean = (s, max = 120) => (s == null ? '' : String(s).trim().slice(0, max));
const like = (s) => '%' + s.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const TABS = {
  people: {
    table: 'ct_people',
    cols: 'k, name, kind, state, states, first_filed, last_filed, filings, companies, exec, dir, prom, funds',
    sorts: { companies: 'companies', last: 'last_filed', name: 'name collate nocase', filings: 'filings' },
    csv: ['name', 'kind', 'state', 'states', 'companies', 'funds', 'exec', 'dir', 'prom', 'filings', 'first_filed', 'last_filed'],
  },
  companies: {
    table: 'ct_companies',
    cols: 'cik, name, city, state, phone, industry, fund_type, pooled, first_filed, last_filed, offerings, raised, people',
    sorts: { raised: 'raised', last: 'last_filed', people: 'people', name: 'name collate nocase' },
    csv: ['name', 'city', 'state', 'phone', 'industry', 'fund_type', 'offerings', 'raised', 'people', 'first_filed', 'last_filed', 'cik'],
  },
  brokers: {
    table: 'ct_brokers',
    cols: 'k, name, crd, firm, firm_crd, deals, companies, raised, first_filed, last_filed',
    sorts: { deals: 'deals', raised: 'raised', last: 'last_filed', name: 'name collate nocase' },
    csv: ['name', 'crd', 'firm', 'firm_crd', 'deals', 'companies', 'raised', 'first_filed', 'last_filed'],
  },
};
const ROLES = { exec: 'exec > 0', dir: 'dir > 0', prom: 'prom > 0' };

function filters(sp, now = new Date()) {
  const get = (k) => clean(sp.get(k));
  const tab = has(TABS, get('tab')) ? get('tab') : 'people';
  const T = TABS[tab];
  const sort = has(T.sorts, get('sort')) ? get('sort') : Object.keys(T.sorts)[0];
  const year = /^\d{4}$/.test(get('since')) && Number(get('since')) >= 2008 && Number(get('since')) <= now.getFullYear() ? Number(get('since')) : null;
  return {
    tab, sort, dir: get('dir') === 'asc' ? 'asc' : 'desc',
    q: get('q'),
    company: get('company'),
    state: /^[A-Z0-9]{2}$/.test(get('state').toUpperCase()) ? get('state').toUpperCase() : '',
    role: has(ROLES, get('role')) ? get('role') : '',
    kind: ['person', 'organization', 'all', 'company', 'fund'].includes(get('kind')) ? get('kind') : (tab === 'people' ? 'person' : tab === 'companies' ? 'company' : 'all'),
    group: has(GROUPS, get('group')) ? get('group') : '',
    minCompanies: /^\d{1,4}$/.test(get('minCompanies')) && Number(get('minCompanies')) > 1 ? Number(get('minCompanies')) : null,
    minRaised: /^\d{1,13}$/.test(get('minRaised')) && Number(get('minRaised')) > 0 ? Number(get('minRaised')) : null,
    phone: get('phone') === '1',
    since: year,
    page: /^\d{1,6}$/.test(get('page')) ? Number(get('page')) : 0,
  };
}

function where(f) {
  const w = [], p = [];
  const T = f.tab;
  if (f.q) {
    if (T === 'brokers') { w.push("(name like ? escape '\\' collate nocase or firm like ? escape '\\' collate nocase or crd = ?)"); p.push(like(f.q), like(f.q), f.q); }
    else { w.push("name like ? escape '\\' collate nocase"); p.push(like(f.q)); }
  }
  if (f.state && T !== 'brokers') { w.push('state = ?'); p.push(f.state); }
  if (f.since != null) { w.push('last_filed >= ?'); p.push(f.since + '-01-01'); }
  if (T === 'people') {
    if (f.kind === 'person' || f.kind === 'organization') { w.push('kind = ?'); p.push(f.kind); }
    if (f.role) w.push(ROLES[f.role]);
    if (f.minCompanies != null) { w.push('companies >= ?'); p.push(f.minCompanies); }
    if (f.company) { w.push("k in (select r.k from ct_roles r join ct_companies c on c.cik = r.cik where c.name like ? escape '\\' collate nocase)"); p.push(like(f.company)); }
    if (f.group) { w.push(`k in (select r.k from ct_roles r join ct_companies c on c.cik = r.cik where c.industry in (${GROUPS[f.group].map(() => '?').join(', ')}))`); p.push(...GROUPS[f.group]); }
  }
  if (T === 'companies') {
    if (f.kind === 'company') w.push("coalesce(pooled, 0) <> 1 and coalesce(industry, '') <> 'Pooled Investment Fund'");
    if (f.kind === 'fund') w.push("(pooled = 1 or industry = 'Pooled Investment Fund')");
    if (f.group) { w.push(`industry in (${GROUPS[f.group].map(() => '?').join(', ')})`); p.push(...GROUPS[f.group]); }
    if (f.minRaised != null) { w.push('raised >= ?'); p.push(f.minRaised); }
    if (f.phone) w.push("phone is not null and phone <> ''");
  }
  if (T === 'brokers' && f.minRaised != null) { w.push('raised >= ?'); p.push(f.minRaised); }
  return { where: w.length ? 'where ' + w.join(' and ') : '', params: p };
}

function listSql(f, { csv = false } = {}) {
  const T = TABS[f.tab];
  const { where: w, params } = where(f);
  const col = T.sorts[f.sort], bare = col.split(' ')[0];
  const limit = csv ? `limit ${CSV_MAX}` : `limit ${PAGE} offset ${f.page * PAGE}`;
  // Ties broken by name, so a page and the CSV keep one order.
  return { sql: `select ${T.cols} from ${T.table} ${w} order by (${bare} is null), ${col} ${f.dir}, name collate nocase ${limit}`, params };
}
function countSql(f) {
  const { where: w, params } = where(f);
  return { sql: `select count(*) n from ${TABS[f.tab].table} ${w}`, params };
}

// CSV: the tab's columns, every value quoted, quotes doubled; a leading
// = + - @ is prefixed with a quote mark so a spreadsheet never runs it.
function toCsv(rows, cols) {
  const cell = (v) => { if (v == null) return ''; let s = String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

module.exports = { PAGE, CSV_MAX, TABS, ROLES, filters, where, listSql, countSql, toCsv };
