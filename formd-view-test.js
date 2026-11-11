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

// The SEC's profiles (E1): Kavia now listed as KAVI.A (tracked as KAVI-A),
// with a 10-K and a former name; LOWE with only Form D; an older profile of
// Kavia that the newest replaces.
const profileRow = { name: 'Kavia AI, Inc.', ein: '123456789', state_inc: 'DE', fiscal_year_end: '1231', tickers: 'KAVI.A', exchanges: 'Nasdaq', biz_city: 'SAN FRANCISCO', biz_state: 'CA',
  former_names: JSON.stringify([{ name: 'KAVIA LABS INC', from: '2024-01-01', to: '2025-06-30' }]), filings: 5, first_filed: '2024-01-01', last_filed: '2026-09-28',
  forms: JSON.stringify({ formD: { n: 2, first: '2026-03-01', last: '2026-09-28' }, annual: { n: 1, first: '2026-03-30', last: '2026-03-30' } }) };
A.writeProfiles([{ ...profileRow, cik: '1', tickers: null, forms: '{}' }], '2026-10-01', 'old.zip');
A.writeProfiles([{ ...profileRow, cik: '1' }, { cik: '3', name: 'LOWE INTERNATIONAL HOLDING CO', forms: JSON.stringify({ formD: { n: 1 } }), filings: 1 }], '2026-11-09', 'new.zip');

// Kavia's plans (E2): a 401(k) on the short form for two years (2023 with
// only a start count; 2024 with active counts), and a welfare plan in 2024.
// LOWE has no EIN, so no plans can be matched.
const plan = db.prepare(`insert into f5500_plans (ack_id, form, form_year, ein, sponsor, plan, plan_num, plan_year, business_code, participants, active, active_boy, net_assets, pension, welfare, city, state, file)
  values (?, ?, ?, '123456789', 'KAVIA AI INC', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SAN FRANCISCO', 'CA', 'f.zip')`);
plan.run('K23', '5500-SF', 2023, 'KAVIA 401(K) PLAN', '001', '2023-01-01', '541511', 8, null, null, 51000, '2E2J', null);
plan.run('K24', '5500-SF', 2024, 'KAVIA 401(K) PLAN', '001', '2024-01-01', '541511', 12, 15, 11, 98000, '2E2J', null);
plan.run('K24W', '5500', 2024, 'KAVIA HEALTH PLAN', '501', '2024-01-01', '511210', 0, 9, null, null, null, '4A4B');

const NAICS_T = { 54: 'Professional, Scientific, and Technical Services', 541: 'Professional, Scientific, and Technical Services', 5415: 'Computer Systems Design and Related Services',
  541511: 'Custom Computer Programming Services', 51: 'Information', 511210: 'Software Publishers' };
const api = V.makeApi(db, { tracked: new Set(['KAVI-A']), naics: NAICS_T });
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

// ---- plans (E2) ----
const kv = L.rows.find((r) => r.cik === '1');
eq([kv.business_code, kv.business_title, kv.staff, kv.staff_year], ['541511', 'Custom Computer Programming Services', 15, '2024'],
  'the list: the newest code and title, and the largest headcount among the newest year\'s plans');
eq([L.rows.find((r) => r.cik === '3').staff, L.rows.find((r) => r.cik === '3').business_code], [null, null], 'no plans: blank, not 0');
eq(api.list(sp('naics=5415')).rows.map((r) => r.cik), ['1'], 'filter: a business code\'s start');
eq(api.list(sp('naics=3254')).total.n, 0, 'filter: a code nobody has');
eq(Q.filters(sp('naics=54x'), NOW).naics, '', 'a code that is not 2 to 6 digits is dropped');
eq(api.list(sp('minStaff=10')).rows.map((r) => r.cik), ['1'], 'filter: staff at least 10');
eq(api.list(sp('minStaff=100')).total.n, 0, 'filter: staff at least 100, none');
eq(api.list(sp('sort=staff')).rows.map((r) => r.cik), ['1', '3'], 'sort by staff, blanks last');
const FP = api.filing('0000000001-26-000002');
eq(FP.plans.map((p) => [p.ack_id, p.staff, p.kind]), [['K24', 15, 'retirement savings (defined contribution)'], ['K24W', 9, 'welfare (health, life or disability)'], ['K23', 8, 'retirement savings (defined contribution)']],
  'the panel: every plan filing, newest first, with its headcount and kind');
eq(FP.business.chain.map((c) => c.code), ['54', '5415', '541511'], 'the code with its parents, a repeated title once');
eq(FP.businessOthers.map((b) => b.title), ['Software Publishers'], 'another code a filing gave');
eq(api.filing('0000000003-24-000001').plans, [], 'no EIN, no plans');
ok(!JSON.stringify(FP.plans).includes('SUTTER'), 'no street in the plans');

// ---- every employer (the Employers page) ----
const E = require('./employerquery.js');
db.exec(`insert into f5500_employers (ein, year, name, dba, city, state, business_code, staff, participants, active, net_assets, filings) values
  ('010750002', 2019, 'CONTINENTAL ELECTRICAL CONSTRUCTION CO LLC', null, 'OAK BROOK', 'IL', '238210', 94, 94, 87, 33346509, 1),
  ('010750002', 2024, 'FOURGEN HOLDINGS INC.', null, 'OAK BROOK', 'IL', '238210', 168, 168, 140, null, 2),
  ('123456789', 2024, 'KAVIA AI INC', 'KAVIA', 'SAN FRANCISCO', 'CA', '541511', 15, 12, 15, 98000, 1),
  ('555555555', 2012, 'GONE ELECTRIC INC', null, 'PEORIA', 'IL', '238210', 40, 40, null, 100, 1);
  insert into f5500_latest (ein, year, name, dba, city, state, business_code, staff, first_year, first_staff, y2019, years) values
  ('010750002', 2024, 'FOURGEN HOLDINGS INC.', null, 'OAK BROOK', 'IL', '238210', 168, 2019, 94, 94, 2),
  ('123456789', 2024, 'KAVIA AI INC', 'KAVIA', 'SAN FRANCISCO', 'CA', '541511', 15, 2024, 15, null, 1),
  ('555555555', 2012, 'GONE ELECTRIC INC', null, 'PEORIA', 'IL', '238210', 40, 2012, 40, null, 1);`);
const EL = api.employers(sp(''));
eq(EL.rows.map((r) => r.ein), ['010750002', '555555555', '123456789'], 'every employer, largest first');
eq([EL.total.n, EL.total.staff], [3, 223], 'counted');
eq(EL.rows[0].growth.toFixed(3), (168 / 94 - 1).toFixed(3), 'growth since 2019');
eq(EL.rows.find((r) => r.ein === '123456789').growth, null, 'no 2019 year, no growth');
eq(EL.rows.find((r) => r.ein === '123456789').formd_cik, '1', 'a Form D issuer is marked, by its EIN');
eq(api.employers(sp('naics=2382&state=il')).rows.map((r) => r.ein), ['010750002', '555555555'], 'business code start and state, any case');
eq(api.employers(sp('naics=2382&current=1')).rows.map((r) => r.ein), ['010750002'], 'still filing');
db.exec("insert into f5500_names (ein, name) select ein, name from f5500_employers union select ein, dba from f5500_employers where dba is not null");
eq(api.employers(sp('q=continental')).rows.map((r) => r.ein), ['010750002'], 'found by a name it once filed under');
eq(api.employers(sp('q=continental')).rows[0].matched, { name: 'CONTINENTAL ELECTRICAL CONSTRUCTION CO LLC', from: 2019, to: 2019 }, 'and the row says which name matched, and when');
eq(api.employers(sp('q=fourgen')).rows[0].matched, null, 'a match on the present name says nothing more');
eq(api.employers(sp('q=fourgen')).rows.map((r) => r.ein), ['010750002'], 'by name');
eq(api.employers(sp('q=01-0750002')).rows.map((r) => r.ein), ['010750002'], 'by tax ID with its dash');
eq(api.employers(sp('q=kavia')).rows.length, 1, 'by trading name too');
eq(api.employers(sp('formd=1')).rows.map((r) => r.ein), ['123456789'], 'only those that raised money by Form D');
eq(api.employers(sp('sort=growth')).rows[0].ein, '010750002', 'sort by growth, blanks last');
eq(E.filters(sp('sort=x;drop')).sort, 'staff', 'a sort not on the list falls back');
const EM = api.employer('010750002');
eq(EM.years.map((y) => [y.year, y.name, y.staff]), [[2019, 'CONTINENTAL ELECTRICAL CONSTRUCTION CO LLC', 94], [2024, 'FOURGEN HOLDINGS INC.', 168]], 'the employer, year by year, with the name each year');
eq(EM.names, ['CONTINENTAL ELECTRICAL CONSTRUCTION CO LLC', 'FOURGEN HOLDINGS INC.'], 'every name it filed under');
eq(EM.formd, null, 'no Form D under this tax ID');
eq(api.employer('123456789').formd.raises.length, 2, 'Form D raises under the same tax ID');
eq(api.employer('12345'), null, 'a malformed tax ID is refused');

// ---- the fact sheet ----
db.exec(`insert into ppp_loans (loan, approved, draw, name, name_key, city, state, zip, jobs, naics, amount, forgiven, business_type, nonprofit, file) values
  ('L1', '2020-04-15', 1, 'KAVIA AI, INC.', 'KAVIA AI', 'San Francisco', 'CA', '94115', 9, '541511', 120000, 121000, 'Corporation', 0, 'f'),
  ('L2', '2021-02-01', 2, 'Kavia AI Inc', 'KAVIA AI', 'San Francisco', 'CA', '94115', 11, '541511', 150000, null, 'Corporation', 0, 'f'),
  ('L3', '2020-05-01', 1, 'KAVIA AI LLC', 'KAVIA AI', 'Austin', 'TX', '78701', 2, '722511', 5000, 5000, 'Limited  Liability Company(LLC)', 0, 'f'),
  ('L4', '2020-05-01', 1, 'GONE ELECTRIC INC', 'GONE ELECTRIC', 'Peoria', 'IL', '61602', 38, '238210', 400000, 400000, 'Corporation', 0, 'f');`);
db.exec(`insert into sba_loans (loan, program, name, name_key, city, state, approved, fy, amount, jobs, lender, status, file) values
  ('S1', '7A', 'Kavia AI Inc', 'KAVIA AI', 'San Francisco', 'CA', '2019-06-01', 2019, 250000, 6, 'First Bank', 'PIF', 'f'),
  ('S2', '504', 'KAVIA AI LLC', 'KAVIA AI', 'Austin', 'TX', '2018-01-01', 2018, 900000, 40, 'Texas CDC', 'CHGOFF', 'f');`);
const api2 = V.makeApi(db, { tracked: new Set(['KAVI-A']), naics: NAICS_T });
const FK = api2.filing('0000000001-26-000002').facts;
eq([FK.ein, FK.cik, FK.incorporated, FK.state], ['123456789', '1', 'DE', 'CA'], 'from Form D: tax ID, CIK, incorporation, state');
eq(FK.ppp.loans.map((x) => x.loan), ['L1', 'L2'], 'PPP loans by name and state: the Texas namesake left out');
eq([FK.ppp.jobs, FK.ppp.amount, FK.ppp.forgiven], [11, 270000, 121000], 'PPP: most jobs reported, amounts summed');
eq([FK.sba.loans.map((x) => x.loan), FK.sba.amount, FK.sba.jobs, FK.sba.chargedOff], [['S1'], 250000, 6, 0], 'SBA loans by name and state: the Texas namesake left out');
eq([FK.staff.now, FK.staff.year], [15, 2024], 'staff from the plans, by tax ID');
eq([FK.raised.n, FK.raised.sold], [1, 3050003], 'money raised: each offering once, at its latest filing');
eq(FK.tracked, ['KAVI.A'], 'a ticker we track');
const FE = api2.employer('010750002').facts;
eq(FE.sba, null, 'no SBA loan, no SBA part');
eq([FE.cik, FE.raised, FE.ppp, FE.staff.y2019], [null, null, null, 94], 'from the Employers side: nothing raised, no loan, 2019 staff for growth');
eq(FE.names, ['CONTINENTAL ELECTRICAL CONSTRUCTION CO LLC', 'FOURGEN HOLDINGS INC.'], 'every name on file');
const FG = api2.employer('555555555').facts;
eq([FG.ppp && FG.ppp.loans.length, FG.business.code], [1, '238210'], 'an old employer: its PPP loan by name and state');
const FS = require('./factsheet.js');
const card = FS.html(FK);
ok(/Known facts/.test(card) && /PPP loans/.test(card) && /matched by name and state/.test(card), 'the card draws, and says how the loans were matched');
ok(/SBA loans/.test(card) && /7\(a\)/.test(card) && /paid in full/.test(card) && /lender’s estimate/.test(card), 'the card draws the SBA loans, their status, and that jobs are the lender’s estimate');
ok(!/SUTTER/.test(card), 'no street on the card');
eq(FS.html(null), '', 'no facts, no card');
// Its own website (E17): a confirmed site and its checked facts; a name-only
// site shown as such and not read; none, no part.
eq(FK.web, null, 'no website tried, no website part');
require('./website-load.js').ensureSchema(db);
db.exec(`insert into web_sites (ein, name, domain, url, verdict, name_hit, city_hit, phone_hit, checked_at) values
  ('123456789', 'KAVIA AI, INC.', 'kavia.ai', 'https://kavia.ai/', 'confirmed', 1, 1, 0, 1),
  ('010750002', 'FOURGEN', 'fourgen.com', 'https://fourgen.com/', 'name only', 1, 0, 0, 1),
  ('555555555', 'GONE', 'gone.com', null, 'none found', 0, 0, 0, 1)`);
db.prepare('insert into web_reads (ein, domain, model, read, at) values (?, ?, ?, ?, 1)').run('123456789', 'kavia.ai', 'm',
  JSON.stringify({ what_they_do: 'Kavia builds AI agents for software teams.', founded: 2021, services: ['AI agents'], markets: [], locations: ['San Francisco, CA'], leaders: [{ name: 'Ada Quill', role: 'CEO' }], clients: [], history: [], open_jobs: 3, hiring_quote: null, employees_quote: null }));
const W1 = api2.filing('0000000001-26-000002').facts.web, W2 = api2.employer('010750002').facts.web;
eq([W1.domain, W1.verdict, W1.read.founded, W2.verdict, W2.read, api2.employer('555555555').facts.web], ['kavia.ai', 'confirmed', 2021, 'name only', null, null], 'the site by tax ID: confirmed and read, name only and not, none found left out');
const wcard = FS.html({ ...FK, web: W1 });
ok(/From its own website/.test(wcard) && /Kavia builds AI agents/.test(wcard) && /Ada Quill/.test(wcard) && /name and city on its pages/.test(wcard) && /Open jobs/.test(wcard), 'the card draws the site, how it was matched, and what its pages say');
ok(/address given by hand; its filed name and city are not on its pages/.test(FS.html({ ...FK, web: { ...W1, verdict: 'given', name_hit: 0, city_hit: 0 } })), 'an address given by hand says so, and that the filed name is not on its pages');
ok(/name only on its pages; not read/.test(FS.html({ ...FK, web: W2 })) && !/From its own website/.test(FS.html({ ...FK, web: W2 })), 'a name-only site is marked so, with nothing read');

// ---- the contact list (contactsdb.js), through the viewer ----
eq(api2.contacts(sp('')).missing, true, 'not built: the page is told so');
require('./contactsdb.js').build(db);
const CT = api2.contacts(sp(''));
eq(CT.rows.map((r) => r.name), ['Ada Quill', 'Ben J Ortiz'], 'people: by companies, ties by name');
eq(api2.contacts(sp('tab=people&role=dir&state=CA')).total.n, 2, 'people: role and state');
eq(api2.contacts(sp('tab=people&role=exec')).rows.map((r) => r.name), ['Ben J Ortiz'], 'people: executive officers only');
eq(api2.contacts(sp('tab=companies')).rows.map((r) => r.name), ['Kavia AI, Inc.', 'LOWE INTERNATIONAL HOLDING CO'], 'companies, funds left out by default');
eq(api2.contacts(sp('tab=companies&kind=fund')).rows.map((r) => r.name), ['ASPF III, L.P.'], 'funds alone');
eq(api2.contacts(sp('tab=brokers')).rows.map((r) => [r.name, r.crd, r.deals]), [['Acme Securities', '12345', 1]], 'brokers by CRD');
const per = api2.contact('people', CT.rows.find((r) => r.name === 'Ben J Ortiz').k);
eq(per.roles.map((r) => [r.company, r.exec, r.dir, r.title]), [['Kavia AI, Inc.', 1, 1, 'CEO']], 'a person: companies, roles and title');
const com = api2.contact('companies', '1');
eq([com.people.length, com.brokers.length, !!com.facts], [2, 1, true], 'a company: its people, its brokers and the fact sheet');
const csv = api2.contactsCsv(sp('tab=people'));
ok(/^name,kind,state,states,companies/.test(csv.csv) && /"Ben J Ortiz","person","CA"/.test(csv.csv), 'the CSV: the columns of the tab, the rows as filtered');
const every = JSON.stringify([CT, per, com, csv, api2.contacts(sp('tab=brokers'))]);
ok(!/77 ELM|12 PINE|PALO ALTO|OAKLAND|94301|94612|2618 SUTTER|1 BROKER PLAZA/.test(every), 'no address anywhere in the contact list, its panels or its CSV');
eq(require('./contactquery.js').toCsv([{ a: '=1+1', b: 'say "hi"' }], ['a', 'b']), 'a,b\r\n"\'=1+1","say ""hi"""\r\n', 'CSV: quotes doubled; a formula is defused');
eq(api2.contact('people', 'x'.repeat(400)), null, 'an oversized key is refused');
// Federal contracts on the fact sheet: by the company's own telephone, but
// not by a switchboard more than three companies share.
require('./contracts-read.js').ensureSchema(db);
db.exec("insert into fed_contracts (rkey, fy, uei, name, name_key, state, phone, obligations, actions, top_agency, naics) values ('UEI K1', 2025, 'K1', 'KAVIA LABS INC', 'KAVIA LABS', 'CA', '650-576-4089', 750000, 3, 'Department of Defense', '541511'), ('UEI K1', 2026, 'K1', 'KAVIA LABS INC', 'KAVIA LABS', 'CA', '650-576-4089', 250000, 1, 'Department of Defense', '541511')");
const FF = api2.filing('0000000001-26-000002').facts.fed;
eq([FF.total, FF.years.length, FF.agency, FF.byPhone], [1000000, 2, 'Department of Defense', true], 'contracts matched by the company telephone, summed by fiscal year');
db.exec("insert into ct_companies (cik, name, phone) values ('91', 'a', '650-576-4089'), ('92', 'b', '650-576-4089'), ('93', 'c', '650-576-4089')");
eq(api2.filing('0000000001-26-000002').facts.fed, null, 'a telephone four companies share is a switchboard: no match');
db.exec("delete from ct_companies where cik in ('91', '92', '93')");

// ---- industry groups ----
const allInd = Object.values(Q.GROUPS).flat();
eq(allInd.length, 35, 'the form lists 35 industries');
eq(new Set(allInd).size, 35, 'each industry in exactly one group');
eq([Q.GROUP_OF['Other Technology'], Q.GROUP_OF['Pooled Investment Fund'], Q.GROUP_OF.Commercial], ['Technology', 'Banking & financial services', 'Real estate'], 'groups of three industries');
eq(Q.filters(sp('group=Technology'), NOW).group, 'Technology', 'a group on the list');
eq(Q.filters(sp('group=Tech%27%20or%201=1'), NOW).group, '', 'a group not on the list is dropped');
eq(api.list(sp('group=Technology')).rows.map((r) => r.cik), ['1'], 'filter by group');
eq(api.list(sp('group=Business%20services')).rows.map((r) => r.cik), ['3'], 'a one-industry group');
eq(api.list(sp('group=Health%20care')).total.n, 0, 'a group with nothing on file');
eq(api.options.groups, Q.GROUPS, 'the page is given the groups');

// ---- the profile (E1) ----
eq(F.profile.as_of, '2026-11-09', 'the newest profile');
eq([F.profile.ein, F.profile.state_inc, F.profile.tickers, F.profile.tracked], ['123456789', 'DE', ['KAVI.A'], ['KAVI.A']], 'profile fields; a ticker we track is marked, dot and dash alike');
eq(F.profile.former_names, [{ name: 'KAVIA LABS INC', from: '2024-01-01', to: '2025-06-30' }], 'former names parsed');
eq(Object.keys(F.profile.forms).sort(), ['annual', 'formD'], 'forms parsed');
eq(api.filing('0000000002-26-000001').profile, null, 'no profile on file is null');
eq(L.rows.find((r) => r.cik === '1').tickers, 'KAVI.A', 'the list carries the newest ticker');
eq(api.list(sp('has=listed')).rows.map((r) => r.cik), ['1'], 'filter: now listed');
eq(api.list(sp('has=financials')).rows.map((r) => r.cik), ['1'], 'filter: files financial statements');
eq(api.list(sp('has=annual')).total.n, 1, 'filter: annual reports');
eq(api.list(sp('has=crowdfunding')).total.n, 0, 'filter: crowdfunding, none');
eq(api.list(sp('has=formerName')).rows.map((r) => r.cik), ['1'], 'filter: a former name');
eq(Q.filters(sp('has=1%20or%201=1'), NOW).has, '', 'a filter not on the list is dropped');
ok(!/or 1=1/.test(Q.where(Q.filters(sp('has=1 or 1=1'), NOW)).where), 'nothing from the request is built into the condition');

// Read only: the viewer refuses an archive without the column rather than adding it.
const { DatabaseSync } = require('node:sqlite');
const bare = new DatabaseSync(':memory:');
bare.exec('create table formd (accn text, filed text, industry text)');
let threw = ''; try { V.makeApi(bare); } catch (e) { threw = e.message; }
ok(/superseded/.test(threw), 'an archive without the superseded column is refused with the fix named');

// ---- crowdfunding (E3): the Crowdfunding page and the fact sheet line ----
const CF = require('./crowdquery.js');
eq(CF.filters(sp('sort=revenue;drop table formc')).sort, 'revenue', 'a sort not on the list falls back');
eq(CF.filters(sp('sort=__proto__')).sort, 'revenue', 'an inherited key is not a sort');
eq(CF.filters(sp('minRevenue=12345')).minRevenue, null, 'only the offered revenue floors');
eq(CF.filters(sp('minRevenue=1000000')).minRevenue, 1000000, 'an offered floor');
ok(!/drop|;/i.test(CF.listSql(CF.filters(sp('sort=x;drop&dir=x;drop'))).sql), 'nothing from the request is built into the crowd statement');
eq(CF.where(CF.filters(sp('q=0001639406'))).params, ['1639406'], 'digits search the CIK, leading zeros dropped');
{
  const CArch = require('./formcarchive.js');
  const C3 = CArch.open(db);
  const T3 = (h, rows) => FC3.parseTsv([h, ...rows].join('\n') + '\n');
  const FC3 = require('./formc.js');
  C3.loadQuarter('2026Q2', 'u', {
    SUBMISSION: T3('ACCESSION_NUMBER\tSUBMISSION_TYPE\tFILING_DATE\tCIK\tPERIOD', [
      '0000000001-23-000001\tC\t20230301\t0000000001\t', '0000000001-25-000001\tC-AR\t20250420\t0000000001\t2024-12-31',
      '0000000001-26-000003\tC-AR\t20260420\t0000000001\t2025-12-31', '0000000077-26-000001\tC\t20260501\t0000000077\t']),
    ISSUER_INFORMATION: T3('ACCESSION_NUMBER\tNAMEOFISSUER\tSTREET1\tZIPCODE\tCITY\tSTATEORCOUNTRY\tISSUERWEBSITE\tCOMPANYNAME', [
      '0000000001-23-000001\tKavia AI, Inc.\t2618 SUTTER ST\t94115\tSan Francisco\tCA\tkavia.ai\tWefunder Portal LLC',
      '0000000001-25-000001\tKavia AI, Inc.\t2618 SUTTER ST\t94115\tSan Francisco\tCA\tkavia.ai\t',
      '0000000001-26-000003\tKavia AI, Inc.\t2618 SUTTER ST\t94115\tSan Francisco\tCA\tkavia.ai\t',
      '0000000077-26-000001\tTiny Bakery LLC\t9 OAK AVE\t30301\tAtlanta\tGA\t\tStartEngine Capital LLC']),
    DISCLOSURE: T3('ACCESSION_NUMBER\tMAXIMUMOFFERINGAMOUNT\tCURRENTEMPLOYEES\tREVENUEMOSTRECENTFISCALYEAR\tREVENUEPRIORFISCALYEAR\tNETINCOMEMOSTRECENTFISCALYEAR\tNETINCOMEPRIORFISCALYEAR\tTOTALASSETMOSTRECENTFISCALYEAR', [
      '0000000001-23-000001\t1235000\t4\t200000\t50000\t-90000\t-40000\t300000',
      '0000000001-25-000001\t\t9\t900000\t600000\t-10000\t-50000\t800000',
      '0000000001-26-000003\t\t12\t2100000\t950000\t120000\t-12000\t1500000',
      '0000000077-26-000001\t50000\t2\t40000\t30000\t1000\t500\t20000']),
  }, 10);
  CArch.summarise(db, { commit: true }, { log: () => {} });
  const api3 = V.makeApi(db, { naics: NAICS_T });
  const CL = api3.crowd(sp(''));
  eq(CL.rows.map((r) => [r.cik, r.revenue, r.formd]), [['1', 2100000, true], ['77', 40000, false]], 'one row a company, newest figures, largest first, Form D marked');
  eq([CL.total.n, CL.total.revenue], [2, 2140000], 'the totals');
  eq(Math.round(CL.rows[0].growth * 1000), 1211,'change: 2.1M against the 950K the same report gives for the year before');
  eq(CL.rows[1].growth, null, 'no change off a base under $50K');
  eq(CL.rows[0].portal, 'Wefunder Portal LLC', 'the portal from its newest offering that names one');
  eq(api3.crowd(sp('profit=1&state=ga')).rows.map((r) => r.cik), ['77'], 'profitable, in a state');
  eq(api3.crowd(sp('reports=1')).rows.map((r) => r.cik), ['1'], 'files annual reports');
  eq(api3.crowd(sp('formd=1')).rows.map((r) => r.cik), ['1'], 'also a Form D issuer');
  eq(api3.crowd(sp('minRevenue=1000000')).rows.map((r) => r.cik), ['1'], 'revenue at least');
  eq(api3.crowd(sp('q=bakery')).rows.map((r) => r.cik), ['77'], 'by name');
  eq(api3.crowd(sp('sort=name&dir=asc')).rows.map((r) => r.cik), ['1', '77'], 'by name, A first');
  const CC = api3.crowdCompany('0000000001');
  eq(CC.years.map((y) => [y.year, y.revenue, !!y.prior]), [[2023, 600000, true], [2024, 900000, false], [2025, 2100000, false]],
    'by fiscal year from the annual reports: each its own year, the earliest from the year before');
  eq(CC.years.find((y) => y.year === 2024).revenue, 900000, 'a year its own report gives is not overwritten by the next report’s year before (950K)');
  eq(CC.years[0].employees, null, 'staff is never carried back a year');
  eq(CC.filings.map((f) => f.form), ['C-AR', 'C-AR', 'C'], 'every filing, newest first');
  eq(CC.raises.length, 2, 'its Form D filings');
  const cblob = JSON.stringify(CC);
  ok(!/SUTTER|94115/.test(cblob), 'no street or zip reaches the page');
  eq(api3.crowdCompany('x1'), null, 'a malformed CIK is refused');
  eq(api3.crowdCompany('999'), null, 'an unknown company is null');
  const FKC = api3.filing('0000000001-26-000002').facts;
  eq([FKC.crowd.revenue, FKC.crowd.period], [2100000, '2025-12-31'], 'the Form D fact sheet carries its Form C figures by CIK');
  ok(/Own figures \(Form C\)/.test(require('./factsheet.js').html(FKC)) && /by year<\/a>/.test(require('./factsheet.js').html(FKC)), 'the card draws them, with a link to the year by year');
  ok(!/by year<\/a>/.test(require('./factsheet.js').html({ ...FKC, crowdLink: false })), 'no link back on the Crowdfunding page itself');
  eq(api3.employer('010750002').facts.crowd, null, 'no Form C, no line');
  // Reg A (E4) on the same fact sheet, by CIK.
  db.exec(`create table if not exists rega_companies (cik text primary key, name text, city text, state text, sic text, industry_group text, year_inc real,
      accn text, filed text, form text, employees_ft real, employees_pt real, cash real, assets real, liabilities real, equity real, revenue real,
      costs real, net_income real, auditor text, tier text, offering_total real, first_filed text, last_filed text, filings integer, offerings integer, reports integer);
    insert into rega_companies (cik, name, filed, form, employees_ft, revenue, net_income, assets, auditor, tier, offering_total, filings, reports)
      values ('1', 'Kavia AI, Inc.', '2026-06-01', '1-A', 14, 900000, -250000, 1200000, 'Alice.CPA LLC', 'Tier2', 20000000, 2, 0)`);
  const api4 = V.makeApi(db, { naics: NAICS_T });
  const FR = api4.filing('0000000001-26-000002').facts;
  eq([FR.rega && FR.rega.revenue, FR.rega && FR.rega.employees_ft], [900000, 14], 'the fact sheet carries the Reg A figures by CIK');
  ok(/Own figures \(Reg A\)/.test(require('./factsheet.js').html(FR)) && /audited by Alice/.test(require('./factsheet.js').html(FR)), 'and draws them with the auditor');
  eq(api4.employer('010750002').facts.rega, null, 'no Reg A, no line');
  const call3 = (url) => { const out = { status: 0 }; V.handler(api3)({ method: 'GET', url, headers: { authorization: 'Basic ' + Buffer.from('a:pw-test').toString('base64') } }, { writeHead(s) { out.status = s; }, end() {} }); return out.status; };
  eq([call3('/api/crowd'), call3('/api/crowd-company?cik=1'), call3('/api/crowd-company?cik=abc'), call3('/crowdfunding')], [200, 200, 404, 200], 'the routes and the page');
}

// ---- acquisition targets (targets.js), on the archive ----
{
  // A water company in West Virginia with a plan and a loan, the same in Ohio
  // with a ticker (left out), a plumbing supply house whose site says nothing
  // of water, and a well driller in Kentucky known only from its loan.
  db.exec(`insert into f5500_latest (ein, year, name, dba, city, state, business_code, staff, first_year, first_staff, y2019, years) values
    ('550421240', 2025, 'THE C. I. THORNBURG CO, INC.', null, 'HUNTINGTON', 'WV', '423700', 120, 2009, 96, 96, 17),
    ('660000001', 2025, 'LISTED PUMP CO', null, 'COLUMBUS', 'OH', '423700', 100, 2009, 90, 90, 17),
    ('660000002', 2025, 'VALLEY PLUMBING SUPPLY INC', null, 'CHARLESTON', 'WV', '423700', 80, 2010, 70, 75, 16),
    ('660000003', 2025, 'BIG SEWER BUILDERS INC', null, 'PITTSBURGH', 'PA', '237100', 900, 2009, 800, 850, 17);`);
  const hist = (ein, pairs) => db.exec(`insert into f5500_employers (ein, year, name, city, state, business_code, staff) values ${pairs.map(([y, s]) => `('${ein}', ${y}, 'X', 'C', 'WV', '423700', ${s})`).join(', ')}`);
  hist('550421240', [[2016, 117], [2017, 108], [2018, 96], [2019, 96], [2020, 91], [2021, 100], [2022, 102], [2023, 104], [2024, 118], [2025, 120]]);
  hist('660000002', [[2016, 70], [2017, 72], [2018, 74], [2019, 75], [2020, 76], [2021, 77], [2022, 78], [2023, 79], [2024, 80], [2025, 80]]);
  db.exec(`insert into fd_profiles (cik, as_of, ein, name, tickers) values ('9001', '2026-11-01', '660000001', 'LISTED PUMP CO', 'LPC')`);
  db.exec(`insert into ppp_loans (loan, approved, draw, name, name_key, city, state, zip, jobs, naics, amount, forgiven, business_type, nonprofit, file) values
    ('W1', '2020-04-20', 1, 'THE C. I. THORNBURG CO., INC.', 'C I THORNBURG', 'HUNTINGTON', 'WV', '25701', 95, '237110', 1729327, 1729327, 'Corporation', 0, 'f'),
    ('W2', '2020-04-20', 1, 'BLUEGRASS WELL DRILLING LLC', 'BLUEGRASS WELL DRILLING', 'LEXINGTON', 'KY', '40505', 40, '237110', 300000, 300000, 'LLC', 0, 'f'),
    ('W3', '2020-04-20', 1, 'TEXAS WELL DRILLING LLC', 'TEXAS WELL DRILLING', 'AUSTIN', 'TX', '78701', 40, '237110', 300000, 300000, 'LLC', 0, 'f'),
    ('W4', '2020-04-20', 1, 'VALLEY PLUMBING SUPPLY', 'VALLEY PLUMBING SUPPLY', 'CHARLESTON', 'WV', '25301', 20, '423720', 100000, 100000, 'Corporation', 0, 'f'),
    ('W5', '2020-04-20', 1, 'BIG SEWER BUILDERS, INC.', 'BIG SEWER BUILDERS', 'PITTSBURGH', 'PA', '15201', 150, '237110', 900000, 900000, 'Corporation', 0, 'f');`);
  db.exec(`insert into web_sites (ein, name, domain, url, verdict, name_hit, city_hit, phone_hit, checked_at) values
    ('550421240', 'THE C. I. THORNBURG CO, INC.', 'citcowater.com', 'https://citcowater.com/', 'given', 1, 1, 0, 1),
    ('660000002', 'VALLEY PLUMBING SUPPLY INC', 'valleyplumbing.com', 'https://valleyplumbing.com/', 'confirmed', 1, 1, 0, 1)`);
  const { DatabaseSync: DS } = require('node:sqlite');
  const webDb = new DS(':memory:');
  webDb.exec('create table pages (url text primary key, ein text, kind text, fetched_at integer not null, text text)');
  webDb.exec(`insert into pages values ('https://citcowater.com/', '550421240', 'home', 1, 'Water well drilling, well pumps and water treatment since 1931.'),
    ('https://valleyplumbing.com/', '660000002', 'home', 1, 'Faucets, fixtures and pumps for the trade.')`);
  const apiT = V.makeApi(db, { web: webDb });
  const R = apiT.targets(sp('buyer=addon&region=near:WV&minStaff=15&maxStaff=200'));
  const names = R.all.map((r) => r.name);
  ok(names.includes('THE C. I. THORNBURG CO, INC.') && names.includes('VALLEY PLUMBING SUPPLY INC'), 'plan companies in the region and band');
  ok(!names.includes('LISTED PUMP CO'), 'a listed company is never a target');
  ok(!names.includes('BIG SEWER BUILDERS INC'), 'outside the size band');
  ok(names.includes('BLUEGRASS WELL DRILLING LLC') && !names.includes('TEXAS WELL DRILLING LLC'), 'a loan-only company in a neighbouring state, not one outside the region');
  ok(!names.includes('VALLEY PLUMBING SUPPLY'), 'a loan to a company with a plan is not listed again as loan only');
  ok(!names.includes('BIG SEWER BUILDERS, INC.'), 'nor a loan to a company whose plan is outside the search (900 staff): it is not "loan only"');
  const ct = R.all.find((r) => r.ein === '550421240');
  eq([ct.pppCodes, ct.pppJobs, ct.site.status, ct.site.hits], [['237110'], 95, 'read', ['water well', 'well drilling', 'well pump', 'water treatment']], 'its loan matched by name and state, its site read for the words');
  const vp = R.all.find((r) => r.ein === '660000002');
  ok(vp.site.status === 'read' && !vp.site.hits.length && vp.flags.includes('site: other business'), 'a supply house whose site names no water work is marked so');
  ok(ct.score > vp.score, 'the water company ranks above the supply house');
  eq(R.all[0].ein, '550421240', 'and first');
  eq(apiT.targets(sp('buyer=addon&region=near:WV&minStaff=15&maxStaff=200&confirmed=1')).all.map((r) => r.ein), ['550421240'], 'only those their site bears out');
  eq(apiT.targets(sp('buyer=addon&region=near:WV&minStaff=15&maxStaff=200&pppOnly=0')).all.filter((r) => r.source === 'ppp').length, 0, 'loan-only companies can be left out');
  const csvT = require('./targets.js').toCsv(R.all);
  ok(csvT.split('\r\n').length === R.all.length + 2 && /55-0421240/.test(csvT), 'the spreadsheet: a row each');
  const call4 = (url) => { const out = { status: 0, body: '' }; V.handler(apiT)({ method: 'GET', url, headers: { authorization: 'Basic ' + Buffer.from('a:pw-test').toString('base64') } }, { writeHead(s) { out.status = s; }, end(b) { out.body = String(b || ''); } }); return out; };
  const tx = call4('/api/targets.txt?buyer=addon&region=near:WV&minStaff=15&maxStaff=200');
  eq(tx.body.trim(), '', 'the website reader\'s list: only plan companies not yet tried (both here have been)');
  eq([call4('/targets').status, call4('/api/targets').status, call4('/api/targets.csv').status], [200, 200, 200], 'the page and its routes');
  ok(!('all' in JSON.parse(call4('/api/targets').body)), 'the page gets one page of rows, not the whole list');
}

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
