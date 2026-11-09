// The Form D viewer: its filters (formdquery.js), what it hands the page and
// its door (formd-view.js). No network, no formd.db: an archive in memory.
//   node formd-view-test.js
'use strict';
process.env.ADMIN_PASSWORD = 'pw-test';
const Q = require('./formdquery.js');
const V = require('./formd-view.js');
const Archive = require('./formdarchive.js');

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('FAIL', what); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const sp = (s) => new URLSearchParams(s);
const NOW = new Date('2026-11-09T12:00:00');

// ---- filters ----
const d = Q.filters(sp(''), NOW);
eq([d.kind, d.sort, d.dir, d.page, d.every], ['company', 'filed', 'desc', 0, false], 'defaults: companies, newest first, latest filing of each offering');
eq(Q.filters(sp('sort=sold;drop table formd'), NOW).sort, 'filed', 'a sort not on the list falls back');
eq(Q.filters(sp('sort=__proto__'), NOW).sort, 'filed', 'an inherited key is not a sort');
eq(Q.filters(sp('from=2007&to=2027'), NOW).from, null, 'a year before the archive is dropped');
eq(Q.filters(sp('to=2027'), NOW).to, null, 'a year after this one is dropped');
eq(Q.filters(sp('minSold=-5'), NOW).minSold, null, 'a negative amount is dropped');
eq(Q.filters(sp('minSold=0'), NOW).minSold, null, 'zero sets no floor');
eq(Q.filters(sp('state=ca'), NOW).state, 'CA', 'state upper-cased');
eq(Q.filters(sp('state=Calif'), NOW).state, '', 'not a state code');
eq(Q.filters(sp('person=al'), NOW).person, '', 'a person search needs three letters');
eq(Q.filters(sp('person=  elon   musk '), NOW).person, 'elon musk', 'spaces folded');
eq(Q.filters(sp('kind=everything'), NOW).kind, 'company', 'unknown kind falls back');

// ---- where ----
const w1 = Q.where(Q.filters(sp('q=50%_off'), NOW));
ok(w1.where.includes("like ? escape '\\'") && w1.params.includes('%50\\%\\_off%'), 'name search: % and _ are literal');
ok(/cik = ?/.test(Q.where(Q.filters(sp('q=0001924674'), NOW)).where) && Q.where(Q.filters(sp('q=0001924674'), NOW)).params[0] === '1924674', 'digits search the CIK, leading zeros dropped');
ok(/accn = ?/.test(Q.where(Q.filters(sp('q=0001924674-26-000002'), NOW)).where) && Q.where(Q.filters(sp('q=0001924674-26-000002'), NOW)).params[0] === '0001924674-26-000002', 'an accession number finds the filing');
ok(!Q.where(Q.filters(sp('every=1&kind=all'), NOW)).where.includes('superseded'), 'every filing: no superseded filter');
ok(Q.where(Q.filters(sp(''), NOW)).where.includes('superseded = 0'), 'default: superseded filings left out');
const ls = Q.listSql(Q.filters(sp('sort=sold&dir=asc&page=2'), NOW));
ok(/order by \(sold is null\), sold asc, accn desc limit 50 offset 100$/.test(ls.sql), 'nulls last, then the sort, paged: ' + ls.sql.slice(-70));
ok(!/drop|;/i.test(Q.listSql(Q.filters(sp('sort=x;drop&dir=x;drop'), NOW)).sql), 'nothing from the request is built into the statement');

// ---- doubtful, links ----
ok(Q.doubtful({ sold: 999999750000, investors: 1 }), '$1T from one investor is marked');
ok(!Q.doubtful({ sold: 999999750000, investors: 3 }), 'three investors is not');
ok(!Q.doubtful({ sold: 5e8, investors: 1 }), 'under a billion is not');
ok(!Q.doubtful({ sold: 5e9, investors: null }), 'investors unknown is not marked (null is not zero)');
eq(Q.secUrl('1924674', '0001924674-26-000002'), 'https://www.sec.gov/Archives/edgar/data/1924674/000192467426000002/', 'the filing on sec.gov');
eq(Q.secUrl('x', '0001924674-26-000002'), null, 'no link from a bad CIK');

// ---- the api, on an archive in memory ----
const A = Archive.open(':memory:');
const db = A.db;
ok(db.prepare('pragma table_info(formd)').all().some((c) => c.name === 'superseded'), 'a new archive has the superseded column');
const put = db.prepare(`insert into formd (accn, quarter, filed, form, cik, name, city, state, industry, fund_type, revenue_range, amendment, previous_accn, offered, offered_indefinite, sold, investors, superseded)
  values (?, '2026Q3', ?, ?, ?, ?, 'San Francisco', 'CA', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`);
put.run('0000000001-26-000001', '2026-03-01', 'D', '1', 'Kavia AI, Inc.', 'Other Technology', null, 'Decline to Disclose', 0, null, 3000000, 1000000, 4, 1);
put.run('0000000001-26-000002', '2026-09-28', 'D/A', '1', 'Kavia AI, Inc.', 'Other Technology', null, 'Decline to Disclose', 1, '0000000001-26-000001', 3050003, 3050003, 10, 0);
put.run('0000000002-26-000001', '2026-09-29', 'D', '2', 'ASPF III, L.P.', 'Pooled Investment Fund', 'Private Equity Fund', null, 0, null, null, 0, null, 0);
put.run('0000000003-24-000001', '2024-12-30', 'D', '3', 'LOWE INTERNATIONAL HOLDING CO', 'Business Services', null, null, 0, null, 999999750000, 999999750000, 1, 0);
db.exec(`create table fd_offering (quarter text, ACCESSIONNUMBER text primary key, MORETHANONEYEAR text, ISEQUITYTYPE text);
  create table fd_issuers (quarter text, ACCESSIONNUMBER text, ISSUER_SEQ_KEY text, IS_PRIMARYISSUER_FLAG text, CIK text, ENTITYNAME text, STREET1 text, STREET2 text, CITY text,
    STATEORCOUNTRYDESCRIPTION text, ZIPCODE text, ISSUERPHONENUMBER text, JURISDICTIONOFINC text, ENTITYTYPE text, ISSUER_PREVIOUSNAME_1 text, EDGAR_PREVIOUSNAME_1 text);
  create table fd_persons (quarter text, ACCESSIONNUMBER text, RELATEDPERSON_SEQ_KEY text, FIRSTNAME text, MIDDLENAME text, LASTNAME text, STREET1 text, STREET2 text, CITY text,
    STATEORCOUNTRY text, STATEORCOUNTRYDESCRIPTION text, ZIPCODE text, RELATIONSHIP_1 text, RELATIONSHIP_2 text, RELATIONSHIP_3 text, RELATIONSHIPCLARIFICATION text);
  create table fd_recipients (quarter text, ACCESSIONNUMBER text, RECIPIENT_SEQ_KEY text, RECIPIENTNAME text, RECIPIENTCRDNUMBER text, ASSOCIATEDBDNAME text,
    ASSOCIATEDBDCRDNUMBER text, STREET1 text, CITY text, ZIPCODE text, STATES_OR_VALUE_LIST text, FOREIGNSOLICITATION text);
  create table fd_signatures (quarter text, ACCESSIONNUMBER text, SIGNATURE_SEQ_KEY text, ISSUERNAME text, NAMEOFSIGNER text, SIGNATURETITLE text, SIGNATUREDATE text);
  insert into fd_offering values ('2026Q3', '0000000001-26-000002', 'false', 'true');
  insert into fd_issuers values ('2026Q3', '0000000001-26-000002', '101', 'YES', '0000000001', 'Kavia AI, Inc.', '2618 SUTTER ST', 'UNIT 9', 'SAN FRANCISCO', 'CALIFORNIA', '94115-2925', '650-576-4089', 'DELAWARE', 'Corporation', 'None', 'KAVIA LABS INC');
  insert into fd_persons values ('2026Q3', '0000000001-26-000002', '2', 'Ada', '', 'Quill', '77 ELM ROAD', 'APT 4', 'PALO ALTO', 'CA', 'CALIFORNIA', '94301', 'Director', null, null, null);
  insert into fd_persons values ('2026Q3', '0000000001-26-000002', '1', 'Ben', 'J', 'Ortiz', '12 PINE LANE', null, 'OAKLAND', 'CA', 'CALIFORNIA', '94612', 'Executive Officer', 'Director', null, 'CEO');
  insert into fd_recipients values ('2026Q3', '0000000001-26-000002', '1', 'Acme Securities', '12345', 'Acme Securities', '12345', '1 BROKER PLAZA', 'NEW YORK', '10001', 'CA, NY', 'false');
  insert into fd_signatures values ('2026Q3', '0000000001-26-000002', '1', 'Kavia AI, Inc.', 'Ben J Ortiz', 'CEO', '2026-09-28');`);

const api = V.makeApi(db);
eq(api.options.industries.map((r) => r.v).sort(), ['Business Services', 'Other Technology', 'Pooled Investment Fund'], 'options: the industries on file');
const L = api.list(sp(''));
eq(L.rows.map((r) => r.accn), ['0000000001-26-000002', '0000000003-24-000001'], 'companies, latest filing of each offering, newest first');
eq([L.total.n, L.total.issuers, L.total.sold], [2, 2, 3050003], 'totals count each offering once, the marked row left out of the amount');
eq([L.total.doubt_n, L.total.doubt_sold], [1, 999999750000], 'what was left out is counted apart');
eq(L.total.median, 3050003, 'median of the amounts kept');
eq(api.list(sp('kind=all&every=1')).total.median, 1000000, 'median of 0, 1,000,000 and 3,050,003, the marked row left out');
eq(L.years.find((y) => y.y === '2024').sold, null, 'the marked row is not in its year');
eq(L.rows.find((r) => r.cik === '3').doubt, true, 'the $1T row is marked');
eq(L.rows.find((r) => r.cik === '1').doubt, false, 'an ordinary row is not');
eq(api.list(sp('kind=all&every=1')).total.n, 4, 'every filing, both kinds');
eq(api.list(sp('kind=fund')).rows.map((r) => r.name), ['ASPF III, L.P.'], 'funds only');
eq(api.list(sp('kind=all&person=ortiz')).rows.map((r) => r.accn), ['0000000001-26-000002'], 'a person finds the filing naming them');
eq(api.list(sp('kind=all&person=nobody')).rows.length, 0, 'an unknown person finds nothing');
eq(api.list(sp('q=kavia')).rows.length, 1, 'name search');
eq(api.list(sp('minSold=1000000000')).rows.map((r) => r.cik), ['3'], 'sold at least');

const F = api.filing('0000000001-26-000002');
eq(F.persons.map((p) => p.name), ['Ben J Ortiz', 'Ada Quill'], 'people in filing order, by name');
eq(F.persons[0].roles, ['Executive Officer', 'Director'], 'roles');
const blob = JSON.stringify(F);
for (const s of ['77 ELM ROAD', 'APT 4', '94301', 'PALO ALTO', '12 PINE LANE', 'OAKLAND', '94612', '2618 SUTTER', '94115', '650-576-4089', '1 BROKER PLAZA', '10001'])
  ok(!blob.includes(s), 'no address reaches the page: ' + s);
eq(F.issuers[0].previousNames, ['KAVIA LABS INC'], 'previous names, "None" left out');
eq(F.history.map((h) => [h.form, h.superseded]), [['D', 1], ['D/A', 0]], 'the issuer\'s every Form D, oldest first');
eq(api.filing('not-an-accession'), null, 'a malformed accession is refused');
eq(api.filing('0000000009-26-000009'), null, 'an unknown filing is null');

// Read only: the viewer refuses an archive without the column rather than adding it.
const { DatabaseSync } = require('node:sqlite');
const bare = new DatabaseSync(':memory:');
bare.exec('create table formd (accn text, filed text, industry text)');
let threw = ''; try { V.makeApi(bare); } catch (e) { threw = e.message; }
ok(/superseded/.test(threw), 'an archive without the superseded column is refused with the fix named');

// ---- the door ----
const req = (auth, url = '/api/options') => ({ method: 'GET', url, headers: auth ? { authorization: 'Basic ' + Buffer.from(auth).toString('base64') } : {} });
function call(r) {
  const out = { status: 0, headers: {}, body: '' };
  const res = { writeHead(s, h) { out.status = s; out.headers = h || {}; }, end(b) { out.body = String(b || ''); } };
  V.handler(api)(r, res);
  return out;
}
eq(call(req(null)).status, 401, 'no password: refused');
ok(/Basic/.test(call(req(null)).headers['www-authenticate']), 'the browser is asked for one');
eq(call(req('admin:wrong')).status, 401, 'a wrong password: refused');
eq(call(req('admin:')).status, 401, 'an empty password: refused');
eq(call(req('anyone:pw-test')).status, 200, 'the admin password, any user name');
eq(call(req('anyone:pw-test', '/api/filing?accn=0000000001-26-000002')).status, 200, 'a filing');
eq(call(req('anyone:pw-test', '/api/filing?accn=x')).status, 404, 'a bad filing is a 404');
eq(call(req('anyone:pw-test', '/../.env')).status, 404, 'no file outside the four it serves');
eq(call(req('anyone:pw-test', '/formd.db')).status, 404, 'the archive itself is not served');
eq(call({ ...req('anyone:pw-test'), method: 'POST' }).status, 405, 'GET only');
const sec = call(req('anyone:pw-test')).headers;
ok(sec['cache-control'] === 'no-store' && sec['x-frame-options'] === 'DENY', 'not cached, not framed');

console.log(`formd-view-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
