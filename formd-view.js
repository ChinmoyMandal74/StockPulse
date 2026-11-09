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

const PORT = Number(process.env.FORMD_VIEW_PORT) || 4100;
const HOST = '127.0.0.1';
const DB_PATH = process.env.FORMD_DB || path.join(__dirname, 'formd.db');
const PASSWORD = process.env.ADMIN_PASSWORD || '';

const STATIC = {
  '/': [path.join(__dirname, 'formd-view.html'), 'text/html; charset=utf-8'],
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

  function list(sp) {
    const f = Q.filters(sp);
    const rows = all(Q.listSql(f)).map((r) => ({ ...r, sec: Q.secUrl(r.cik, r.accn), doubt: Q.doubtful(r) }));
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
    return {
      summary: { ...s, sec: Q.secUrl(s.cik, s.accn) },
      offering: pick(off, ['FEDERALEXEMPTIONS_ITEMS_LIST', 'MORETHANONEYEAR', 'ISEQUITYTYPE', 'ISDEBTTYPE', 'ISOPTIONTOACQUIRETYPE', 'ISSECURITYTOBEACQUIREDTYPE',
        'ISPOOLEDINVESTMENTFUNDTYPE', 'ISTENANTINCOMMONTYPE', 'ISMINERALPROPERTYTYPE', 'ISOTHERTYPE', 'DESCRIPTIONOFOTHERTYPE', 'ISBUSINESSCOMBINATIONTRANS',
        'BUSCOMBCLARIFICATIONOFRESP', 'SALESAMTCLARIFICATIONOFRESP', 'HASNONACCREDITEDINVESTORS', 'NUMBERNONACCREDITEDINVESTORS', 'SALESCOMM_DOLLARAMOUNT',
        'SALESCOMM_ISESTIMATE', 'FINDERSFEE_DOLLARAMOUNT', 'FINDERSFEE_ISESTIMATE', 'FINDERFEECLARIFICATIONOFRESP', 'GROSSPROCEEDSUSED_DOLLARAMOUNT',
        'GROSSPROCEEDSUSED_ISESTIMATE', 'GROSSPROCEEDSUSED_CLAROFRESP']),
      issuers, persons, recipients, signatures, history, profile,
    };
  }

  return { options, list, filing };
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
  const api = makeApi(db, { tracked });
  http.createServer(handler(api)).listen(PORT, HOST, () => {
    console.log(`Form D viewer: http://localhost:${PORT}  (${api.options.filings.toLocaleString('en-US')} filings, ready in ${((Date.now() - t) / 1000).toFixed(1)}s; this machine only, admin password)`);
  });
}

module.exports = { makeApi, handler, authorised };
