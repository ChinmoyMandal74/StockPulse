// The viewer's Employers page: every employer with its own retirement or
// welfare plan (f5500_latest, f5500_employers; backlog 61, E2), not only the
// Form D issuers. Pure: a query string in, a parameterised statement out.
// Every value is bound; the sort column comes from SORTS, never the request.
'use strict';

const PAGE = 50;
const SORTS = {
  staff: 'staff', name: 'name collate nocase', year: 'year', growth: 'growth', state: 'state',
};
const clean = (s, max = 120) => (s == null ? '' : String(s).trim().slice(0, max));

function filters(sp) {
  const get = (k) => clean(sp.get(k));
  const sort = Object.prototype.hasOwnProperty.call(SORTS, get('sort')) ? get('sort') : 'staff';
  return {
    q: get('q'),
    state: /^[A-Z]{2}$/.test(get('state').toUpperCase()) ? get('state').toUpperCase() : '',
    naics: /^\d{2,6}$/.test(get('naics')) ? get('naics') : '',
    minStaff: /^\d{1,7}$/.test(get('minStaff')) && Number(get('minStaff')) > 0 ? Number(get('minStaff')) : null,
    current: get('current') === '1',          // filed for 2023 or later
    formd: get('formd') === '1',              // also raised money by Form D
    sort,
    dir: get('dir') === 'asc' ? 'asc' : 'desc',
    page: /^\d{1,6}$/.test(get('page')) ? Number(get('page')) : 0,
  };
}

// Growth: the newest year's headcount against 2019's, when both are on file
// and 2019 had ten or more (a small base makes a large percentage of nothing).
const GROWTH = 'case when y2019 >= 10 and staff is not null and year > 2019 then staff / y2019 - 1 end';

function where(f) {
  const w = [], p = [];
  if (f.q) {
    if (/^\d{2}-?\d{7}$/.test(f.q)) { w.push('ein = ?'); p.push(f.q.replace('-', '')); }
    // Any name it has filed under, not only the newest (f5500_names).
    else { w.push("ein in (select ein from f5500_names where name like ? escape '\\' collate nocase)"); p.push('%' + f.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%'); }
  }
  if (f.state) { w.push('state = ?'); p.push(f.state); }
  if (f.naics) { w.push('business_code like ?'); p.push(f.naics + '%'); }
  if (f.minStaff != null) { w.push('staff >= ?'); p.push(f.minStaff); }
  if (f.current) w.push('year >= 2023');
  if (f.formd) w.push('ein in (select ein from fd_profiles where ein is not null)');
  return { where: w.length ? 'where ' + w.join(' and ') : '', params: p };
}

const COLS = `ein, year, name, dba, city, state, business_code, staff, first_year, first_staff, y2019, years, ${GROWTH} growth`;

function listSql(f) {
  const { where: w, params } = where(f);
  const col = SORTS[f.sort];
  const bare = col.split(' ')[0];
  return {
    sql: `select * from (select ${COLS} from f5500_latest) ${w} order by (${bare} is null), ${col} ${f.dir}, ein limit ${PAGE} offset ${f.page * PAGE}`,
    params,
  };
}
function countSql(f) {
  const { where: w, params } = where(f);
  return { sql: `select count(*) n, sum(staff) staff from (select ${COLS} from f5500_latest) ${w}`, params };
}

module.exports = { PAGE, SORTS, GROWTH, filters, where, listSql, countSql };
