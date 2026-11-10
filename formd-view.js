// The Form D viewer: the LOCAL formd.db in the browser, for the owner only
// (backlog 61; docs/context/form-d.md). The owner, 2026-11-09: "create a front
// end to show the private company data .. form D .. give it access only to
// admin", and chose the laptop over the site: the archive never goes to Turso
// before phase 6, so tickrlab.com cannot read it.
//
// A small server on this machine only:
//   - listens on 127.0.0.1 (FORMD_VIEW_PORT, 4100), never another address;
//   - asks for ADMIN_PASSWORD (any user name) and will not start without one;
//   - opens formd.db READ ONLY and makes no request to sec.gov or anywhere else
//     (the filing links on the page are for the owner to click);
//   - shows people by name and role only, never their addresses (the owner,
//     2026-11-09: "people data is also important but not their addresses").
//
//   node --use-system-ca formd-view.js          then open http://localhost:4100
'use strict';
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Q = require('./formdquery.js');
const E = require('./employerquery.js');
const CQ = require('./contactquery.js');
const CF = require('./crowdquery.js');
const T = require('./targets.js');
const P5 = require('./f5500.js');

const PORT = Number(process.env.FORMD_VIEW_PORT) || 4100;
const HOST = '127.0.0.1';
const DB_PATH = process.env.FORMD_DB || path.join(__dirname, 'formd.db');
const PASSWORD = process.env.ADMIN_PASSWORD || '';

const STATIC = {
  '/': [path.join(__dirname, 'formd-view.html'), 'text/html; charset=utf-8'],
  '/employers': [path.join(__dirname, 'employers-view.html'), 'text/html; charset=utf-8'],
  '/factsheet.js': [path.join(__dirname, 'factsheet.js'), 'text/javascript; charset=utf-8'],
  '/contacts': [path.join(__dirname, 'contacts-view.html'), 'text/html; charset=utf-8'],
  '/crowdfunding': [path.join(__dirname, 'crowdfunding-view.html'), 'text/html; charset=utf-8'],
  '/targets': [path.join(__dirname, 'targets-view.html'), 'text/html; charset=utf-8'],
  '/data-sources': [path.join(__dirname, 'sources-view.html'), 'text/html; charset=utf-8'],
  '/app.css': [path.join(__dirname, 'public', 'app.css'), 'text/css; charset=utf-8'],
  '/theme.js': [path.join(__dirname, 'public', 'theme.js'), 'text/javascript; charset=utf-8'],
  '/favicon.svg': [path.join(__dirname, 'public', 'favicon.svg'), 'image/svg+xml'],
};

function authorised(req) {
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return false;
  const pass = Buffer.from(m[1], 'base64').toString('utf8').replace(/^[^:]*:/, '');
  const a = crypto.createHash('sha256').update(pass).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function makeApi(db, opts = {}) {
  // The tickers this app tracks, from the local analysis copy, so a company
  // that now trades links to its stock page. Empty when there is no copy.
  const tracked = opts.tracked || new Set();
  const all = (q) => db.prepare(q.sql).all(...q.params);
  const one = (q) => db.prepare(q.sql).get(...q.params);
  const cols = (table) => new Set(db.prepare(`pragma table_info("${table}")`).all().map((c) => c.name));
  if (!cols('formd').has('superseded')) throw new Error('formd.db has no superseded column yet: run  node --use-system-ca formd-load.js --stats  once');

  // The choices for the filter menus, once: they change only with a new quarter.
  const distinct = (col, extra = '') => db.prepare(`select ${col} v, count(*) n from formd where ${col} is not null ${extra} group by ${col} order by n desc`).all();
  const options = {
    industries: distinct('industry'),
    groups: Q.GROUPS,
    fundTypes: distinct('fund_type'),
    states: distinct('state').filter((r) => /^[A-Z0-9]{2}$/.test(r.v)),
    revenues: distinct('revenue_range'),
    years: db.prepare('select min(substr(filed, 1, 4)) a, max(substr(filed, 1, 4)) b from formd').get(),
    quarters: db.prepare('select count(*) n, min(quarter) a, max(quarter) b, max(loaded_at) at from loads').get(),
    filings: db.prepare('select count(*) n from formd').get().n,
  };

  // The totals scan every matching filing (2 to 4 seconds on the whole
  // archive), and turning a page or a sort does not change them: kept per
  // set of filters for as long as the viewer runs (the archive only changes
  // when a quarter is loaded, and the viewer opens it read only).
  const totalsCache = new Map();
  function totals(f) {
    const t = Q.totalsSql(f);
    const key = JSON.stringify([t.total.sql, t.total.params]);
    if (totalsCache.has(key)) return totalsCache.get(key);
    const total = one(t.total);
    total.median = total.priced ? one(t.median(total.priced)).v : null;
    const v = { total, years: all(t.years), industries: all(t.industries) };
    if (totalsCache.size >= 200) totalsCache.delete(totalsCache.keys().next().value);
    totalsCache.set(key, v);
    return v;
  }

  // A business code's title and its parents (sector, subsector, industry
  // group), from the NAICS lists in naics.json (E2).
  const naics = opts.naics || {};
  function business(code) {
    const t = P5.naicsTitle(code, naics);
    if (!t) return null;
    const chain = [];
    for (const n of [2, 3, 4, 5, 6]) {
      const k = t.code.slice(0, n);
      if (k.length === n && naics[k] && !chain.some((c) => c.title === naics[k])) chain.push({ code: k, title: naics[k] });
    }
    return { code, title: t.title, chain };
  }

  function list(sp) {
    const f = Q.filters(sp);
    const rows = all(Q.listSql(f)).map((r) => {
      const b = r.business_code ? business(r.business_code) : null;
      return { ...r, sec: Q.secUrl(r.cik, r.accn), doubt: Q.doubtful(r), business_title: b ? b.title : null };
    });
    return { filters: f, page: f.page, pageSize: Q.PAGE, rows, ...totals(f) };
  }

  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o ? o[k] ?? null : null]));
  function filing(accn) {
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accn)) return null;
    const s = db.prepare('select * from formd where accn = ?').get(accn);
    if (!s) return null;
    const off = db.prepare('select * from fd_offering where ACCESSIONNUMBER = ?').get(accn);
    const issuers = db.prepare('select * from fd_issuers where ACCESSIONNUMBER = ? order by IS_PRIMARYISSUER_FLAG desc, ISSUER_SEQ_KEY').all(accn)
      .map((r) => ({
        // A company's city and state, never its street, zip or telephone.
        ...pick(r, ['ENTITYNAME', 'CIK', 'CITY', 'STATEORCOUNTRYDESCRIPTION', 'JURISDICTIONOFINC', 'ENTITYTYPE', 'ENTITYTYPEOTHERDESC', 'YEAROFINC_VALUE_ENTERED', 'YEAROFINC_TIMESPAN_CHOICE']),
        primary: r.IS_PRIMARYISSUER_FLAG === 'YES',
        previousNames: [1, 2, 3].flatMap((i) => [r['ISSUER_PREVIOUSNAME_' + i], r['EDGAR_PREVIOUSNAME_' + i]]).filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i && !/^none$/i.test(v)),
      }));
    // People: name and role only. No street, city, state or zip.
    const persons = db.prepare('select FIRSTNAME, MIDDLENAME, LASTNAME, RELATIONSHIP_1, RELATIONSHIP_2, RELATIONSHIP_3, RELATIONSHIPCLARIFICATION from fd_persons where ACCESSIONNUMBER = ? order by cast(RELATEDPERSON_SEQ_KEY as integer)').all(accn)
      .map((r) => ({ name: [r.FIRSTNAME, r.MIDDLENAME, r.LASTNAME].filter((x) => x && x !== '-' && !/^n\/?a$/i.test(x)).join(' '),
        roles: [r.RELATIONSHIP_1, r.RELATIONSHIP_2, r.RELATIONSHIP_3].filter(Boolean), note: r.RELATIONSHIPCLARIFICATION || null }));
    const recipients = db.prepare('select RECIPIENTNAME, RECIPIENTCRDNUMBER, ASSOCIATEDBDNAME, ASSOCIATEDBDCRDNUMBER, STATES_OR_VALUE_LIST, FOREIGNSOLICITATION from fd_recipients where ACCESSIONNUMBER = ? order by cast(RECIPIENT_SEQ_KEY as integer)').all(accn);
    const signatures = db.prepare('select ISSUERNAME, NAMEOFSIGNER, SIGNATURETITLE, SIGNATUREDATE from fd_signatures where ACCESSIONNUMBER = ? order by cast(SIGNATURE_SEQ_KEY as integer)').all(accn);
    // The SEC's profile (E1): the newest one on file, with the date of the bulk
    // file it came from. The street and telephone were never kept.
    const pr = s.cik ? db.prepare('select * from fd_profiles where cik = ? order by as_of desc limit 1').get(s.cik) : null;
    let profile = null;
    if (pr) {
      const parse = (t, d) => { try { return t ? JSON.parse(t) : d; } catch (_) { return d; } };
      const tickers = pr.tickers ? pr.tickers.split(',') : [];
      profile = { ...pr, former_names: parse(pr.former_names, []), forms: parse(pr.forms, {}), tickers,
        tracked: tickers.filter((t) => tracked.has(String(t).toUpperCase().replace(/\./g, '-'))) };
    }
    const history = s.cik ? db.prepare(`select ${Q.LIST_COLS} from formd where cik = ? order by filed, accn`).all(s.cik) : [];
    // Its retirement and welfare plans (E2), by the EIN in its profile: each
    // plan year's filings, newest first, with the headcount proxy.
    const plans = pr && pr.ein
      ? db.prepare(`select ack_id, form, form_year, plan, plan_num, plan_year, business_code, participants, active, active_boy, net_assets, pension, welfare, city, state,
          ${Q.HEAD_SQL('p')} staff from f5500_plans p where ein = ? order by plan_year desc, staff desc, plan_num`).all(pr.ein)
        .map((p) => ({ ...p, kind: P5.planKind(p.pension, p.welfare) }))
      : [];
    const codes = [...new Set(plans.map((p) => p.business_code).filter(Boolean))];
    const businessNow = codes.length ? business(codes[0]) : null;
    return {
      summary: { ...s, sec: Q.secUrl(s.cik, s.accn) },
      offering: pick(off, ['FEDERALEXEMPTIONS_ITEMS_LIST', 'MORETHANONEYEAR', 'ISEQUITYTYPE', 'ISDEBTTYPE', 'ISOPTIONTOACQUIRETYPE', 'ISSECURITYTOBEACQUIREDTYPE',
        'ISPOOLEDINVESTMENTFUNDTYPE', 'ISTENANTINCOMMONTYPE', 'ISMINERALPROPERTYTYPE', 'ISOTHERTYPE', 'DESCRIPTIONOFOTHERTYPE', 'ISBUSINESSCOMBINATIONTRANS',
        'BUSCOMBCLARIFICATIONOFRESP', 'SALESAMTCLARIFICATIONOFRESP', 'HASNONACCREDITEDINVESTORS', 'NUMBERNONACCREDITEDINVESTORS', 'SALESCOMM_DOLLARAMOUNT',
        'SALESCOMM_ISESTIMATE', 'FINDERSFEE_DOLLARAMOUNT', 'FINDERSFEE_ISESTIMATE', 'FINDERFEECLARIFICATIONOFRESP', 'GROSSPROCEEDSUSED_DOLLARAMOUNT',
        'GROSSPROCEEDSUSED_ISESTIMATE', 'GROSSPROCEEDSUSED_CLAROFRESP']),
      issuers, persons, recipients, signatures, history, profile, plans, business: businessNow,
      facts: facts({ ein: pr && pr.ein, cik: s.cik, names: [s.name], state: s.state }),
      businessOthers: codes.slice(1).map(business).filter(Boolean),
    };
  }

  // ---- the fact sheet: everything held on one company, from either side ----
  // Keyed by the tax ID where there is one (plans, the SEC profile), the Form
  // D issuer's CIK, and names with a state for the PPP loans (no tax ID there,
  // so a name match, marked so). Every part is null when nothing is held.
  const NK = require('./pppload-read.js').nameKey;
  const hasTable = (t) => !!db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(t);
  const pppReady = hasTable('ppp_loans'), sbaReady = hasTable('sba_loans');
  function facts({ ein, cik, names = [], state }) {
    const pr = cik ? db.prepare('select * from fd_profiles where cik = ? order by as_of desc limit 1').get(cik)
      : ein ? db.prepare('select * from fd_profiles where ein = ? order by as_of desc limit 1').get(ein) : null;
    const tax = ein || (pr && pr.ein) || null;
    const issuer = cik || (pr && pr.cik) || null;
    const yrs = tax ? db.prepare('select year, name, city, state, business_code, staff, net_assets from f5500_employers where ein = ? order by year').all(tax) : [];
    const allNames = [...new Set([...names, ...(pr ? [pr.name] : []), ...yrs.map((y) => y.name)].filter(Boolean))];
    const st = state || (yrs.length ? yrs[yrs.length - 1].state : null) || (pr ? pr.biz_state : null);
    // Money raised: each offering once, at its latest filing.
    const raised = issuer ? db.prepare(`select count(*) n, sum(case when ${'sold >= 1e9 and investors is not null and investors <= 2'} then null else sold end) sold,
        min(filed) first, max(filed) last from formd where cik = ? and superseded = 0`).get(issuer) : null;
    let ppp = [];
    if (pppReady && st) {
      const keys = [...new Set(allNames.map(NK).filter(Boolean))];
      const q = db.prepare('select loan, approved, draw, name, city, state, jobs, naics, amount, forgiven, business_type from ppp_loans where name_key = ? and state = ? order by approved');
      for (const k of keys) ppp.push(...q.all(k, st));
      ppp = ppp.filter((x, i, a) => a.findIndex((y) => y.loan === x.loan) === i);
    }
    // SBA 7(a) and 504 loans (E13), matched the same way as PPP: name and state.
    let sba = [];
    if (sbaReady && st) {
      const keys = [...new Set(allNames.map(NK).filter(Boolean))];
      const q = db.prepare('select loan, program, approved, fy, name, city, state, jobs, naics, amount, lender, status, charged_off from sba_loans where name_key = ? and state = ? order by approved');
      for (const k of keys) sba.push(...q.all(k, st));
      sba = sba.filter((x, i, a) => a.findIndex((y) => y.loan === x.loan) === i);
    }
    // Federal contracts (E7): the recipients matched by name and state, or by
    // the company's own filed telephone (a contract record carries the
    // recipient's). Summed by fiscal year over every matched recipient.
    let fed = null;
    if (hasTable('fed_contracts')) {
      const keys = [...new Set(allNames.map(NK).filter(Boolean))];
      // A telephone more than three companies have filed is a switchboard (a
      // fund manager's main line: a REIT filing Goldman Sachs' matched its
      // contracts), so it does not match.
      const phones = issuer && hasTable('ct_companies')
        ? db.prepare('select phone from ct_companies c where cik = ? and phone is not null and (select count(*) from ct_companies d where d.phone = c.phone) <= 3').all(issuer).map((r) => r.phone)
        : [];
      const conds = [], ps = [];
      if (st && keys.length) { conds.push(`(name_key in (${keys.map(() => '?').join(', ')}) and state = ?)`); ps.push(...keys, st); }
      if (phones.length) { conds.push(`phone in (${phones.map(() => '?').join(', ')})`); ps.push(...phones); }
      if (conds.length) {
        const rs = db.prepare(`select rkey, fy, name, state, phone, obligations, actions, top_agency, naics from fed_contracts where ${conds.join(' or ')} order by fy`).all(...ps);
        if (rs.length) {
          const byYear = new Map();
          for (const r of rs) { const y = byYear.get(r.fy) || { fy: r.fy, obligations: 0, actions: 0 }; y.obligations += r.obligations; y.actions += r.actions; byYear.set(r.fy, y); }
          const ag = new Map(); for (const r of rs) if (r.top_agency) ag.set(r.top_agency, (ag.get(r.top_agency) || 0) + Math.abs(r.obligations));
          fed = { years: [...byYear.values()], total: rs.reduce((a, r) => a + r.obligations, 0), recipients: [...new Set(rs.map((r) => r.name + ' (' + (r.state || '?') + ')'))],
            agency: [...ag.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0])[0] || null, byPhone: phones.length > 0 && rs.some((r) => phones.includes(r.phone)) };
        }
      }
    }
    // Its own website (E17), found by guessing and confirmed by its name and
    // its city or telephone; what the pages say, read and checked.
    let web = null;
    if (tax && hasTable('web_sites')) {
      const s = db.prepare("select domain, url, verdict, name_hit, city_hit, phone_hit, checked_at from web_sites where ein = ? and verdict in ('confirmed', 'given', 'name only')").get(tax);
      if (s) {
        const r = hasTable('web_reads') ? db.prepare('select read from web_reads where ein = ?').get(tax) : null;
        web = { ...s, read: r ? JSON.parse(r.read) : null };
      }
    }
    // Crowdfunding (E3): the figures from its newest Form C that carries any,
    // by the issuer's CIK (the same number Form D files under).
    const crowd = issuer && hasTable('formc_companies')
      ? db.prepare('select cik, name, filed, form, period, employees, revenue, net_income, assets, filings, reports from formc_companies where cik = ?').get(issuer) || null
      : null;
    const last = yrs.length ? yrs[yrs.length - 1] : null;
    const y2019 = yrs.find((y) => y.year === 2019);
    const code = (yrs.slice().reverse().find((y) => y.business_code) || {}).business_code || (ppp.find((x) => x.naics) || {}).naics || null;
    const tickers = pr && pr.tickers ? pr.tickers.split(',') : [];
    return {
      names: allNames, ein: tax, cik: issuer, state: st,
      incorporated: pr ? pr.state_inc : null, fiscalYearEnd: pr ? pr.fiscal_year_end : null,
      place: last ? [last.city, last.state].filter(Boolean).join(', ') : pr ? [pr.biz_city, pr.biz_state].filter(Boolean).join(', ') : null,
      business: code ? business(code) || { code, title: 'Industry code ' + code, chain: [] } : null,
      businessFrom: code && yrs.some((y) => y.business_code) ? 'plans' : code ? 'ppp' : null,
      staff: last && last.staff != null ? { now: last.staff, year: last.year, y2019: y2019 ? y2019.staff : null, first: yrs[0].staff, firstYear: yrs[0].year, years: yrs.length } : null,
      raised: raised && raised.n ? raised : null,
      ppp: ppp.length ? { loans: ppp, jobs: Math.max(...ppp.map((x) => x.jobs || 0)) || null, amount: ppp.reduce((a, x) => a + (x.amount || 0), 0), forgiven: ppp.reduce((a, x) => a + (x.forgiven || 0), 0) } : null,
      tickers, tracked: tickers.filter((t) => tracked.has(String(t).toUpperCase().replace(/\./g, '-'))),
      fed, web, crowd,
      sba: sba.length ? { loans: sba, amount: sba.reduce((a, x) => a + (x.amount || 0), 0), jobs: Math.max(...sba.map((x) => x.jobs || 0)) || null, chargedOff: sba.filter((x) => x.status === 'CHGOFF').length } : null,
    };
  }

  // ---- every employer with its own plan (the Employers page) ----
  const empCount = new Map();
  function employers(sp) {
    const f = E.filters(sp);
    const c = E.countSql(f);
    const key = JSON.stringify([c.sql, c.params]);
    if (!empCount.has(key)) { if (empCount.size >= 200) empCount.delete(empCount.keys().next().value); empCount.set(key, one(c)); }
    const ix = db.prepare('select ein, cik from fd_profiles where ein is not null and as_of = (select max(as_of) from fd_profiles) and ein = ?');
    // A row found by a name it no longer files under says so: the name that
    // matched, and the years it was used.
    const was = f.q && !/^\d{2}-?\d{7}$/.test(f.q)
      ? db.prepare(`select n.name, min(e.year) a, max(e.year) b from f5500_names n left join f5500_employers e on e.ein = n.ein and (e.name = n.name or e.dba = n.name)
          where n.ein = ? and n.name like ? escape '\\' collate nocase group by n.name order by b desc limit 1`) : null;
    const like = f.q ? '%' + f.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%' : null;
    const rows = all(E.listSql(f)).map((r) => {
      const b = r.business_code ? business(r.business_code) : null;
      const fd = ix.get(r.ein);
      const m = was ? was.get(r.ein, like) : null;
      const matched = m && m.name !== r.name && m.name !== r.dba ? { name: m.name, from: m.a, to: m.b } : null;
      return { ...r, business_title: b ? b.title : null, formd_cik: fd ? fd.cik : null, matched };
    });
    return { filters: f, page: f.page, pageSize: E.PAGE, rows, total: empCount.get(key) };
  }
  function employer(ein) {
    if (!/^\d{9}$/.test(ein)) return null;
    const years = db.prepare('select year, name, dba, city, state, business_code, staff, participants, active, net_assets, filings from f5500_employers where ein = ? order by year').all(ein);
    if (!years.length) return null;
    const last = years[years.length - 1];
    const codes = [...new Set(years.slice().reverse().map((y) => y.business_code).filter(Boolean))];
    const names = [...new Set(years.map((y) => y.name).filter(Boolean))];
    // The same EIN among the Form D issuers: its raises.
    const pr = db.prepare('select cik, name from fd_profiles where ein = ? order by as_of desc limit 1').get(ein);
    const raises = pr ? db.prepare(`select ${Q.LIST_COLS} from formd where cik = ? order by filed desc`).all(pr.cik) : [];
    return { ein, last, years, names, facts: facts({ ein, names, state: last.state }), business: codes.length ? business(codes[0]) : null, businessOthers: codes.slice(1).map(business).filter(Boolean),
      formd: pr ? { cik: pr.cik, name: pr.name, raises: raises.map((r) => ({ ...r, sec: Q.secUrl(r.cik, r.accn) })) } : null };
  }

  // ---- the contact list (contactsdb.js builds it) ----
  const ctReady = () => hasTable('ct_people');
  const ctCount = new Map();
  function contacts(sp) {
    if (!ctReady()) return { missing: true, rows: [], total: { n: 0 } };
    const f = CQ.filters(sp);
    const c = CQ.countSql(f), key = JSON.stringify([c.sql, c.params]);
    if (!ctCount.has(key)) { if (ctCount.size >= 300) ctCount.delete(ctCount.keys().next().value); ctCount.set(key, one(c)); }
    return { filters: f, page: f.page, pageSize: CQ.PAGE, rows: all(CQ.listSql(f)), total: ctCount.get(key) };
  }
  function contactsCsv(sp) {
    if (!ctReady()) return null;
    const f = CQ.filters(sp);
    return { tab: f.tab, csv: CQ.toCsv(all(CQ.listSql(f, { csv: true })), CQ.TABS[f.tab].csv) };
  }
  function contact(tab, key) {
    if (!ctReady() || !key || key.length > 300) return null;
    if (tab === 'people') {
      const p = db.prepare('select * from ct_people where k = ?').get(key);
      if (!p) return null;
      const roles = db.prepare(`select r.*, c.name company, c.city, c.state, c.phone, c.industry, c.fund_type, c.pooled, c.raised, c.last_filed company_last
        from ct_roles r join ct_companies c on c.cik = r.cik where r.k = ? order by r.last_filed desc limit 500`).all(key);
      return { tab, person: p, roles };
    }
    if (tab === 'companies') {
      const c = db.prepare('select * from ct_companies where cik = ?').get(key);
      if (!c) return null;
      const people = db.prepare(`select r.*, p.name, p.kind, p.state person_state, p.companies from ct_roles r join ct_people p on p.k = r.k
        where r.cik = ? order by r.last_filed desc, p.name limit 500`).all(key);
      const brokers = db.prepare(`select r.RECIPIENTNAME name, nullif(r.RECIPIENTCRDNUMBER, 'None') crd, nullif(r.ASSOCIATEDBDNAME, 'None') firm, count(distinct r.ACCESSIONNUMBER) deals, max(f.filed) last
        from fd_recipients r join formd f on f.accn = r.ACCESSIONNUMBER where f.cik = ? group by r.RECIPIENTNAME, r.RECIPIENTCRDNUMBER order by last desc limit 100`).all(key);
      return { tab, company: c, people, brokers, facts: facts({ cik: key, names: [c.name], state: c.state }) };
    }
    if (tab === 'brokers') {
      const b = db.prepare('select * from ct_brokers where k = ?').get(key);
      if (!b) return null;
      const byCrd = key.startsWith('CRD ');
      const deals = db.prepare(`select f.accn, f.filed, f.cik, f.name company, f.state, f.industry, f.sold, f.superseded, r.STATES_OR_VALUE_LIST states
        from fd_recipients r join formd f on f.accn = r.ACCESSIONNUMBER
        where ${byCrd ? 'trim(r.RECIPIENTCRDNUMBER) = ?' : 'upper(trim(r.RECIPIENTNAME)) = ?'} group by f.accn order by f.filed desc limit 500`).all(key.replace(/^(CRD|NAME) /, ''));
      return { tab, broker: b, deals };
    }
    return null;
  }

  // ---- every company that has filed a Form C (the Crowdfunding page) ----
  const cfCount = new Map();
  function crowd(sp) {
    if (!hasTable('formc_companies')) return { missing: true, rows: [], total: { n: 0 } };
    const f = CF.filters(sp);
    const c = CF.countSql(f), key = JSON.stringify([c.sql, c.params]);
    if (!cfCount.has(key)) { if (cfCount.size >= 200) cfCount.delete(cfCount.keys().next().value); cfCount.set(key, one(c)); }
    const inFormd = db.prepare('select 1 from formd where cik = ? limit 1');
    const rows = all(CF.listSql(f)).map((r) => ({ ...r, formd: !!inFormd.get(r.cik) }));
    return { filters: f, page: f.page, pageSize: CF.PAGE, rows, total: cfCount.get(key) };
  }
  function crowdCompany(cik) {
    if (!/^\d{1,10}$/.test(cik) || !hasTable('formc_companies')) return null;
    cik = String(Number(cik));
    const co = db.prepare('select * from formc_companies where cik = ?').get(cik);
    if (!co) return null;
    const filings = db.prepare('select * from formc where cik = ? order by filed desc, accn desc').all(cik)
      .map((r) => ({ ...r, sec: Q.secUrl(r.cik, r.accn) }));
    const raises = db.prepare(`select ${Q.LIST_COLS} from formd where cik = ? order by filed desc`).all(cik)
      .map((r) => ({ ...r, sec: Q.secUrl(r.cik, r.accn) }));
    const names = [...new Set(filings.map((r) => r.name).filter(Boolean))];
    return { company: co, filings, years: CF.fiscalYears(filings), names, raises,
      facts: facts({ cik, names, state: co.state }) };
  }

  // ---- acquisition targets (targets.js): candidates for a buyer's profile ----
  // From the plan filings (business code, size, years filing, staff history)
  // and, for companies with no plan, the payroll loans (the exact six-digit
  // code and jobs). Each is checked against its own website where the website
  // reader has been, and scored with its reasons. A result is kept per set of
  // filters while the viewer runs (the archive only changes on a load).
  const web = opts.web || null;   // web-archive.db, read only: the pages' text
  const planByName = new Map();   // state -> Map(name key -> ein), built when first needed
  function planKeys(st) {
    if (!planByName.has(st)) {
      const m = new Map();
      for (const r of db.prepare('select ein, name, dba from f5500_latest where state = ?').iterate(st)) {
        for (const n of [r.name, r.dba]) { const k = NK(n); if (k && !m.has(k)) m.set(k, r.ein); }
      }
      planByName.set(st, m);
    }
    return planByName.get(st);
  }
  const targetCache = new Map();
  function targetRows(f) {
    const key = JSON.stringify({ ...f, page: 0 });
    if (targetCache.has(key)) return targetCache.get(key);
    const inStates = f.states ? ` and state in (${f.states.map(() => '?').join(', ')})` : '';
    const stP = f.states || [];
    // A code's start as a range, so the index on business_code serves it (a like does not).
    const codeW = f.planCodes.length ? '(' + f.planCodes.map(() => '(business_code >= ? and business_code < ?)').join(' or ') + ')' : '0';
    const codeP = f.planCodes.flatMap((c) => [c, c.slice(0, -1) + String.fromCharCode(c.charCodeAt(c.length - 1) + 1)]);
    const plan = db.prepare(`select ein, year, name, dba, city, state, business_code, staff, first_year, y2019, years from f5500_latest indexed by idx_f5500_latest_code
      where ${codeW} and staff between ? and ? and year >= 2022 and years >= ?${inStates}`)
      .all(...codeP, f.minStaff, f.maxStaff, f.minYears, ...stP);
    const series = db.prepare('select year, staff from f5500_employers where ein = ? and year >= 2000 order by year');
    const prof = db.prepare('select cik, tickers from fd_profiles where ein = ? order by as_of desc limit 1');
    const loans = db.prepare('select loan, name, jobs, naics, amount, city from ppp_loans where name_key = ? and state = ?');
    const siteQ = hasTable('web_sites') ? db.prepare('select domain, verdict from web_sites where ein = ?') : null;
    const pagesQ = web ? web.prepare('select text from pages where ein = ?') : null;
    const siteOf = (ein) => {
      const s = siteQ ? siteQ.get(ein) : null;
      if (!s) return { status: 'not tried', hits: [] };
      if (s.verdict !== 'confirmed' && s.verdict !== 'given') return { status: s.verdict, domain: s.domain, hits: [] };
      const text = pagesQ ? pagesQ.all(ein).map((p) => p.text).join('\n') : '';
      return text ? { status: 'read', domain: s.domain, hits: T.keywordHits(text, f.keywords) } : { status: 'found, not read', domain: s.domain, hits: [] };
    };
    const out = [];
    const seenLoans = new Set();
    for (const r of plan) {
      const pr = prof.get(r.ein);
      if (pr && pr.tickers) continue;   // listed: not a private target
      const ppp = [];
      for (const n of [r.name, r.dba]) { const k = NK(n); if (k) for (const l of loans.all(k, r.state)) if (!ppp.some((x) => x.loan === l.loan)) ppp.push(l); }
      ppp.forEach((l) => seenLoans.add(l.loan));
      const hist = series.all(r.ein);
      const c = { key: r.ein, source: 'plan', ein: r.ein, name: r.name, dba: r.dba, city: r.city, state: r.state, planCode: r.business_code,
        staff: r.staff, staffYear: r.year, y2019: r.y2019, firstYear: r.first_year, years: r.years,
        growth: r.y2019 >= 10 && r.year > 2019 ? r.staff / r.y2019 - 1 : null,
        pattern: T.pattern(hist), history: hist.map((h) => [h.year, h.staff]),
        pppCodes: [...new Set(ppp.map((l) => l.naics).filter(Boolean))], pppJobs: ppp.length ? Math.max(...ppp.map((l) => l.jobs || 0)) || null : null,
        pppAmount: ppp.reduce((a, l) => a + (l.amount || 0), 0) || null,
        formd: !!pr, vehicle: T.VEHICLE.test(r.name || ''), site: siteOf(r.ein) };
      out.push(c);
    }
    if (f.pppOnly && f.pppCodes.length) {
      const pq = db.prepare(`select loan, name, name_key, city, state, jobs, naics, amount from ppp_loans
        where naics in (${f.pppCodes.map(() => '?').join(', ')}) and jobs between ? and ?${inStates} order by jobs desc`)
        .all(...f.pppCodes, f.minStaff, f.maxStaff, ...stP);
      const seenKey = new Set();
      for (const l of pq) {
        if (seenLoans.has(l.loan) || seenKey.has(l.name_key + '|' + l.state)) continue;
        seenKey.add(l.name_key + '|' + l.state);
        if (planKeys(l.state).has(l.name_key)) continue;   // it has a plan, under another code or size: not "loan only"
        out.push({ key: 'P' + l.loan, source: 'ppp', ein: null, name: l.name, dba: null, city: l.city, state: l.state, planCode: null,
          staff: null, staffYear: null, y2019: null, firstYear: null, years: 0, growth: null, pattern: { kind: 'short' }, history: [],
          pppCodes: [l.naics], pppJobs: l.jobs, pppAmount: l.amount, formd: false, vehicle: T.VEHICLE.test(l.name || ''), site: { status: 'no tax ID', hits: [] } });
      }
    }
    for (const c of out) Object.assign(c, T.fit(c, f));
    out.sort((a, b) => b.score - a.score || (b.staff ?? b.pppJobs ?? 0) - (a.staff ?? a.pppJobs ?? 0) || String(a.name).localeCompare(String(b.name)));
    if (targetCache.size >= 50) targetCache.delete(targetCache.keys().next().value);
    targetCache.set(key, out);
    return out;
  }
  function targets(sp) {
    const f = T.filters(sp);
    let rows = targetRows(f);
    const all = rows;
    if (f.hideBacked) rows = rows.filter((r) => !r.backed);
    if (f.confirmedOnly) rows = rows.filter((r) => r.site.status === 'read' && r.site.hits.length);
    const totals = {
      n: rows.length, plan: rows.filter((r) => r.source === 'plan').length, ppp: rows.filter((r) => r.source === 'ppp').length,
      confirmed: all.filter((r) => r.site.status === 'read' && r.site.hits.length).length,
      siteOther: all.filter((r) => r.site.status === 'read' && !r.site.hits.length).length,
      notTried: all.filter((r) => r.source === 'plan' && r.site.status === 'not tried').length,
      backed: all.filter((r) => r.backed).length,
    };
    return { filters: f, totals, page: f.page, pageSize: 50, rows: rows.slice(f.page * 50, f.page * 50 + 50), all: rows, presets: T.PRESETS,
      divisions: Object.keys(T.DIVISIONS), regions: Object.keys(T.REGIONS), states: T.STATES };
  }

  return { options, list, filing, employers, employer, contacts, contactsCsv, contact, crowd, crowdCompany, targets };
}

function handler(api) {
  return (req, res) => {
    try {
      if (!authorised(req)) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="Tickr Lab Form D", charset="UTF-8"', 'content-type': 'text/plain' });
        return res.end('Admin only.');
      }
      if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
      const u = new URL(req.url, 'http://localhost');
      if (STATIC[u.pathname]) {
        const [file, type] = STATIC[u.pathname];
        return send(res, 200, fs.readFileSync(file), type);
      }
      if (u.pathname === '/api/options') return send(res, 200, api.options);
      if (u.pathname === '/api/list') return send(res, 200, api.list(u.searchParams));
      if (u.pathname === '/api/employers') return send(res, 200, api.employers(u.searchParams));
      if (u.pathname === '/api/contacts') return send(res, 200, api.contacts(u.searchParams));
      if (u.pathname === '/api/crowd') return send(res, 200, api.crowd(u.searchParams));
      if (u.pathname === '/api/targets') { const r = api.targets(u.searchParams); delete r.all; return send(res, 200, r); }
      if (u.pathname === '/api/targets.csv' || u.pathname === '/api/targets.txt') {
        const r = api.targets(u.searchParams);
        const day = new Date().toISOString().slice(0, 10);
        if (u.pathname.endsWith('.txt')) {
          // The tax IDs for the website reader: plan companies it has not tried, best fit first.
          const top = Math.min(1000, Math.max(1, Number(u.searchParams.get('top')) || 150));
          const eins = r.all.filter((x) => x.ein && x.site.status === 'not tried').slice(0, top).map((x) => x.ein);
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="targets-eins-${day}.txt"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          return res.end(eins.join('\n') + '\n');
        }
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="targets-${day}.csv"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return res.end(String.fromCharCode(0xFEFF) + T.toCsv(r.all));
      }
      if (u.pathname === '/api/crowd-company') {
        const r = api.crowdCompany(String(u.searchParams.get('cik') || ''));
        return r ? send(res, 200, r) : send(res, 404, { error: 'no such company' });
      }
      if (u.pathname === '/api/contacts.csv') {
        const r = api.contactsCsv(u.searchParams);
        if (!r) return send(res, 404, { error: 'the contact list is not built' });
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="contacts-${r.tab}-${new Date().toISOString().slice(0, 10)}.csv"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return res.end(String.fromCharCode(0xFEFF) + r.csv);   // a byte-order mark, so a spreadsheet reads the names as UTF-8
      }
      if (u.pathname === '/api/contact') {
        const r = api.contact(String(u.searchParams.get('tab') || ''), String(u.searchParams.get('key') || ''));
        return r ? send(res, 200, r) : send(res, 404, { error: 'not found' });
      }
      if (u.pathname === '/api/employer') {
        const r = api.employer(String(u.searchParams.get('ein') || '').replace('-', ''));
        return r ? send(res, 200, r) : send(res, 404, { error: 'no such employer' });
      }
      if (u.pathname === '/api/filing') {
        const r = api.filing(String(u.searchParams.get('accn') || ''));
        return r ? send(res, 200, r) : send(res, 404, { error: 'no such filing' });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      console.error(new Date().toISOString(), req.url, e.message);
      return send(res, 500, { error: 'failed' });
    }
  };
}

if (require.main === module) {
  if (!PASSWORD) { console.error('ADMIN_PASSWORD is not set in .env; the viewer will not start without it.'); process.exit(1); }
  if (!fs.existsSync(DB_PATH)) { console.error('No archive at ' + DB_PATH); process.exit(1); }
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  let tracked = new Set();
  try {
    const a = new DatabaseSync(path.join(__dirname, 'analysis.db'), { readOnly: true });
    tracked = new Set(a.prepare('select symbol from names').all().map((r) => String(r.symbol).toUpperCase().replace(/\./g, '-')));
    a.close();
  } catch (_) { /* no local analysis copy: no links to stock pages */ }
  db.exec('pragma busy_timeout = 10000');
  const t = Date.now();
  let naics = {};
  try { naics = require('./naics.json').codes; } catch (_) { /* no titles: codes alone */ }
  let web = null;
  try { if (fs.existsSync(path.join(__dirname, 'web-archive.db'))) { web = new DatabaseSync(path.join(__dirname, 'web-archive.db'), { readOnly: true }); web.exec('pragma busy_timeout = 10000'); } } catch (_) { /* no page text: sites shown as found, not read */ }
  const api = makeApi(db, { tracked, naics, web });
  http.createServer(handler(api)).listen(PORT, HOST, () => {
    console.log(`Form D viewer: http://localhost:${PORT}  (${api.options.filings.toLocaleString('en-US')} filings, ready in ${((Date.now() - t) / 1000).toFixed(1)}s; this machine only, admin password)`);
  });
}

module.exports = { makeApi, handler, authorised };
