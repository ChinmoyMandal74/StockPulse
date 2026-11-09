// The contact list (contactsdb.js): people by name within a state, companies
// with telephone and city (no street), brokers by their regulatory number,
// each deal counted once. An archive in memory; no network.
//   node contacts-test.js
'use strict';
const C = require('./contactsdb.js');
const Archive = require('./formdarchive.js');

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('FAIL', what); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const A = Archive.open(':memory:');
const db = A.db;
db.exec(`
  create table fd_persons (quarter text, ACCESSIONNUMBER text, RELATEDPERSON_SEQ_KEY text, FIRSTNAME text, MIDDLENAME text, LASTNAME text, STREET1 text, STREET2 text, CITY text,
    STATEORCOUNTRY text, STATEORCOUNTRYDESCRIPTION text, ZIPCODE text, RELATIONSHIP_1 text, RELATIONSHIP_2 text, RELATIONSHIP_3 text, RELATIONSHIPCLARIFICATION text);
  create table fd_issuers (quarter text, ACCESSIONNUMBER text, ISSUER_SEQ_KEY text, IS_PRIMARYISSUER_FLAG text, CIK text, ENTITYNAME text, STREET1 text, STREET2 text, CITY text,
    STATEORCOUNTRY text, ZIPCODE text, ISSUERPHONENUMBER text);
  create table fd_recipients (quarter text, ACCESSIONNUMBER text, RECIPIENT_SEQ_KEY text, RECIPIENTNAME text, RECIPIENTCRDNUMBER text, ASSOCIATEDBDNAME text,
    ASSOCIATEDBDCRDNUMBER text, STREET1 text, CITY text, ZIPCODE text, STATES_OR_VALUE_LIST text, FOREIGNSOLICITATION text);
`);
const f = db.prepare(`insert into formd (accn, quarter, filed, form, cik, name, city, state, industry, fund_type, amendment, previous_accn, offered, offered_indefinite, sold, investors, pooled, superseded)
  values (?, 'q', ?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?, 0, ?, ?, ?, ?)`);
f.run('A1', '2024-01-10', 'D', '10', 'Acme Robotics, Inc.', 'Austin', 'TX', 'Other Technology', 0, null, 5e6, 2e6, 10, 0, 1);
f.run('A2', '2024-09-10', 'D/A', '10', 'Acme Robotics, Inc.', 'Austin', 'TX', 'Other Technology', 1, 'A1', 5e6, 4e6, 20, 0, 0);
f.run('B1', '2025-03-01', 'D', '20', 'Beta Fund LP', 'New York', 'NY', 'Pooled Investment Fund', 0, null, null, 9e6, 30, 1, 0);
f.run('C1', '2025-05-01', 'D', '30', 'Gamma Bio LLC', 'Boston', 'MA', 'Biotechnology', 0, null, 2e6, 2e6, 5, 0, 0);
const p = db.prepare(`insert into fd_persons values ('q', ?, ?, ?, ?, ?, '1 PRIVATE LANE', null, 'HOMETOWN', ?, null, '99999', ?, ?, null, ?)`);
p.run('A1', '1', 'Jane', 'Q', 'Smith', 'TX', 'Executive Officer', null, 'CEO');
p.run('A2', '1', 'Jane', 'Q', 'Smith', 'TX', 'Executive Officer', 'Director', 'Chief Executive Officer');
p.run('B1', '1', 'JANE', null, 'SMITH', 'TX', 'Director', null, null);          // same name, same state: the same person
p.run('C1', '1', 'Jane', null, 'Smith', 'MA', 'Promoter', null, null);          // same name, other state: another person
p.run('B1', '2', 'N/A', null, 'Beta GP, LLC', 'NY', 'Executive Officer', null, 'General Partner of the Issuer');
p.run('C1', '2', '-', null, 'N/A', 'MA', 'Director', null, null);               // no name at all: left out
p.run('B1', '3', 'llc', null, 'Fund GP,', 'NY', 'Executive Officer', null, null);  // a firm across both fields
p.run('C1', '3', 'Richard', 'llc', 'Thoms', 'MA', 'Executive Officer', null, null); // a person with a company word for a middle name
p.run('C1', '4', 'Banks', null, 'Fundora', 'MA', 'Director', null, null);         // company words only inside other words: a person
const i = db.prepare(`insert into fd_issuers values ('q', ?, ?, ?, ?, ?, '5 COMPANY ST', null, ?, ?, '78701', ?)`);
i.run('A1', '101', 'YES', '10', 'Acme Robotics, Inc.', 'AUSTIN', 'TX', '512-555-0100');
i.run('A2', '101', 'YES', '10', 'Acme Robotics, Inc.', 'AUSTIN', 'TX', '(512) 555-0199');
i.run('A2', '102', 'NO', '11', 'Acme Sub LLC', 'AUSTIN', 'TX', '000-000-0000');
i.run('B1', '101', 'YES', '20', 'Beta Fund LP', 'NEW YORK', 'NY', '212-555-0000');
const r = db.prepare(`insert into fd_recipients values ('q', ?, ?, ?, ?, ?, ?, '9 BROKER WAY', 'NYC', '10001', 'TX, NY', 'false')`);
r.run('A2', '1', 'Pat Broker', '1234567', 'Big Securities LLC', '777');
r.run('A2', '2', 'Pat Broker', '1234567', 'Big Securities LLC', '777');      // the same broker twice on one filing
r.run('B1', '1', 'Pat Broker', '1234567', 'Big Securities LLC', '777');
r.run('C1', '1', 'Finder Co', 'None', 'None', 'None');

const n = C.build(db);
eq(n, { people: 6, roles: 7, companies: 3, brokers: 2 }, 'six entries (two Janes, Beta GP, the llc Fund GP firm, Richard Thoms, Banks Fundora), three companies, two brokers');
eq(db.prepare("select kind, name from ct_people where name like '%Fund GP%'").get(), { kind: 'organization', name: 'llc Fund GP,' }, 'a firm across both name fields is a firm, both parts kept');
eq(db.prepare("select kind, name from ct_people where name like '%Thoms'").get(), { kind: 'person', name: 'Richard Thoms' }, 'a company word as a middle name is dropped, the person kept');
eq(db.prepare("select kind from ct_people where name = 'Banks Fundora'").get(), { kind: 'person' }, 'company words inside other words do not make a firm');
const tx = db.prepare("select * from ct_people where k = 'JANE SMITH|TX'").get();
eq([tx.name, tx.kind, tx.companies, tx.filings, tx.exec, tx.dir, tx.funds], ['Jane Q Smith', 'person', 2, 3, 2, 2, 1], 'one person within a state, across companies and filings; roles counted');
ok(!!db.prepare("select 1 from ct_people where k = 'JANE SMITH|MA'").get(), 'the same name in another state is another person');
eq(db.prepare("select kind, name from ct_people where k like 'BETA GP%'").get(), { kind: 'organization', name: 'Beta GP, LLC' }, 'a firm in the person fields is an organization');
const role = db.prepare("select * from ct_roles where k = 'JANE SMITH|TX' and cik = '10'").get();
eq([role.exec, role.dir, role.title, role.first_filed, role.last_filed, role.filings], [1, 1, 'Chief Executive Officer', '2024-01-10', '2024-09-10', 2], 'roles at one company: both roles, the newest title, first and last filing');
const co = db.prepare("select * from ct_companies where cik = '10'").get();
eq([co.name, co.city, co.state, co.phone, co.offerings, co.raised, co.people], ['Acme Robotics, Inc.', 'Austin', 'TX', '512-555-0199', 1, 4e6, 1], 'company: newest name and place, the primary issuer\'s newest telephone, each offering once');
const all = JSON.stringify(db.prepare('select * from ct_people').all()) + JSON.stringify(db.prepare('select * from ct_companies').all()) + JSON.stringify(db.prepare('select * from ct_brokers').all()) + JSON.stringify(db.prepare('select * from ct_roles').all());
ok(!/PRIVATE LANE|HOMETOWN|99999|COMPANY ST|78701|BROKER WAY/.test(all), 'no street, home town or ZIP anywhere in the contact tables');
const br = db.prepare("select * from ct_brokers where k = 'CRD 1234567'").get();
eq([br.name, br.firm, br.firm_crd, br.deals, br.companies, br.raised], ['Pat Broker', 'Big Securities LLC', '777', 2, 2, 4e6 + 9e6], 'a broker by CRD: two deals, each once; raised at the latest filing of each');
eq(db.prepare("select crd, firm from ct_brokers where k = 'NAME FINDER CO'").get(), { crd: null, firm: null }, 'no CRD: by name, and "None" is no firm');
eq(C.build(db).people, 6, 'rebuilt whole: the same again');
eq(['7027956484', '(512) 555-0199', '1-800-555-0100', '+1 (212) 555 0000 ext. 12', '44 20 7946 0958', '000-000-0000', 'N/A'].map(C.usPhone),
  ['702-795-6484', '512-555-0199', '800-555-0100', '212-555-0000 x12', '44 20 7946 0958', null, null], 'telephones: US numbers in one form, others as filed, placeholders none');

console.log(`contacts-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
