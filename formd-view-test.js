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
eq(api.employers(sp('q=continental')).rows.length, 0, 'the newest name is what the list searches');
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
const api2 = V.makeApi(db, { tracked: new Set(['KAVI-A']), naics: NAICS_T });
const FK = api2.filing('0000000001-26-000002').facts;
eq([FK.ein, FK.cik, FK.incorporated, FK.state], ['123456789', '1', 'DE', 'CA'], 'from Form D: tax ID, CIK, incorporation, state');
eq(FK.ppp.loans.map((x) => x.loan), ['L1', 'L2'], 'PPP loans by name and state: the Texas namesake left out');
eq([FK.ppp.jobs, FK.ppp.amount, FK.ppp.forgiven], [11, 270000, 121000], 'PPP: most jobs reported, amounts summed');
eq([FK.staff.now, FK.staff.year], [15, 2024], 'staff from the plans, by tax ID');
eq([FK.raised.n, FK.raised.sold], [1, 3050003], 'money raised: each offering once, at its latest filing');
eq(FK.tracked, ['KAVI.A'], 'a ticker we track');
const FE = api2.employer('010750002').facts;
eq([FE.cik, FE.raised, FE.ppp, FE.staff.y2019], [null, null, null, 94], 'from the Employers side: nothing raised, no loan, 2019 staff for growth');
eq(FE.names, ['CONTINENTAL ELECTRICAL CONSTRUCTION CO LLC', 'FOURGEN HOLDINGS INC.'], 'every name on file');
const FG = api2.employer('555555555').facts;
eq([FG.ppp && FG.ppp.loans.length, FG.business.code], [1, '238210'], 'an old employer: its PPP loan by name and state');
const FS = require('./factsheet.js');
const card = FS.html(FK);
ok(/Known facts/.test(card) && /PPP loans/.test(card) && /matched by name and state/.test(card), 'the card draws, and says how the loans were matched');
ok(!/SUTTER/.test(card), 'no street on the card');
eq(FS.html(null), '', 'no facts, no card');

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
