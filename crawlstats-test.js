// The website crawl in figures (crawlstats.js), the morning report's body
// (crawl-report.js) and the viewer's Crawl page route. Databases in memory.
//   node crawlstats-test.js
'use strict';
process.env.ADMIN_PASSWORD = 'pw-test';
const { DatabaseSync } = require('node:sqlite');
const CS = require('./crawlstats.js');
const CR = require('./crawl-report.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const ET = (s) => new Date(s + '-05:00').getTime();   // Eastern standard time in November

// ---- nights ----
eq(CS.nightOf(ET('2026-11-11T01:05:00')), '2026-11-10', 'a run at 01:05 on the 11th is the night of the 10th');
eq(CS.nightOf(ET('2026-11-11T06:40:00')), '2026-11-10', 'and so is its end at 06:40');
eq(CS.nightOf(ET('2026-11-11T13:00:00')), '2026-11-11', 'an afternoon run is that day\'s');

// ---- the figures ----
const db = new DatabaseSync(':memory:');
db.exec(`create table f5500_latest (ein text primary key, year integer, name text, city text, state text, staff real);
  create table web_sites (ein text primary key, name text, city text, state text, domain text, url text, verdict text, checked_at integer not null);
  create table web_reads (ein text primary key, usd real, at integer not null);
  create table web_requests (at integer not null, url text not null, status integer, bytes integer, ms integer);`);
const putE = db.prepare('insert into f5500_latest values (?, ?, ?, ?, ?, ?)');
for (let i = 0; i < 10; i++) putE.run('E' + i, 2024, 'CO ' + i, 'X', 'OH', 150);
putE.run('SMALL', 2024, 'SMALL CO', 'X', 'OH', 40);     // under 100 staff: not on the list
putE.run('OLD', 2021, 'OLD CO', 'X', 'OH', 500);         // last filed 2021: not on the list
const site = db.prepare('insert into web_sites values (?, ?, ?, ?, ?, ?, ?, ?)');
const n1 = ET('2026-11-10T01:30:00'), n2 = ET('2026-11-11T02:00:00');
site.run('E0', 'CO 0', 'X', 'OH', 'co0.com', 'https://co0.com/', 'confirmed', n1);
site.run('E1', 'CO 1', 'X', 'OH', null, null, 'none found', n1);
site.run('E2', 'CO 2', 'X', 'OH', 'co2.com', 'https://co2.com/', 'confirmed', n2);
site.run('E3', 'CO 3', 'X', 'OH', 'co3.com', null, 'name only', n2 + 60000);
site.run('SMALL', 'SMALL CO', 'X', 'OH', null, null, 'none found', n2);   // tried by an earlier pilot
db.exec(`insert into web_reads values ('E0', 0.002, ${n1}), ('E2', 0.003, ${n2})`);
db.exec(`insert into web_requests values (${n2}, 'u', 200, 1, 1), (${n2 + 1000}, 'u', 200, 1, 1)`);
const web = new DatabaseSync(':memory:');
require('./website-load.js').archiveSchema(web);
web.exec(`insert into crawls values ('E2', 'co2.com', ${n2}, ${n2 + 120000}, 12, 50000, null)`);
web.exec(`insert into pages (url, ein, kind, fetched_at, text) values ('https://co2.com/', 'E2', 'home', ${n2}, 'hello world')`);

const now = ET('2026-11-11T06:50:00');
const f = CS.figures(db, web, { now, archiveBytes: 5e6 });
eq([f.target, f.triedInList, f.left, f.tried], [10, 4, 6, 5], 'the list is 100+ staff filing 2023 on; a pilot company off the list is tried but not counted toward it');
eq([f.confirmed, f.nameOnly, f.none, f.read, f.kept, f.keptPages, f.pages], [2, 1, 2, 2, 1, 12, 1], 'the totals');
eq(f.nights.map((x) => [x.night, x.tried, x.confirmed, x.kept, x.pages, x.requests]), [['2026-11-10', 3, 1, 1, 12, 2], ['2026-11-09', 2, 1, 0, 0, 0]], 'night by night, newest first');
eq([f.pace, f.nightsLeft], [3, 2], 'the pace over the nights that worked, and the nights left (6 at about 3 a night)');
eq(f.finish, '2026-11-13', 'and when that is');
eq(CS.figures(db, web, { now, target: 999 }).target, 999, 'a kept list size is used as given');

// ---- the run's own words ----
const log = 'X (Y, OH): none found\n345 minutes up; the next run carries on\ndone: 1400 companies; 420 confirmed (30%)\n2026-11-11 06:46:01 ET  crawl report sent\n';
eq(CS.lastRun(log), { done: 'done: 1400 companies; 420 confirmed (30%)', stop: '345 minutes up; the next run carries on' }, 'the last done line and why it stopped');
eq(CS.lastRun('done: 3 companies\n'), { done: 'done: 3 companies', stop: null }, 'no stop line, none given');
eq(CS.lastRun('nothing'), null, 'no run in the log');

// ---- the report's body ----
const r = CR.report(db, web, now, { archiveBytes: 5e6, log });
eq([r.night.night, r.night.tried, r.total.tried, r.total.target, r.run.stop !== null], ['2026-11-10', 3, 4, 10, true], 'the night just run, the list, the run');
ok(!JSON.stringify(r).includes('co2.com') && !JSON.stringify(r).includes('CO 2'), 'no company or address in what is sent');
const quiet = CR.report(db, web, ET('2026-11-13T06:50:00'), {});
eq(quiet.night.tried, 0, 'a night nothing ran reports zero');

// ---- the viewer's Crawl page ----
// website-load.js loads .env with override; the viewer reads the password when loaded.
process.env.ADMIN_PASSWORD = 'pw-test';
const V = require('./formd-view.js');
const Archive = require('./formdarchive.js');
const A = Archive.open(':memory:');
const api = V.makeApi(A.db, { web, archiveBytes: () => 7e6, readLog: () => log });
const c = api.crawl();
eq([c.target, c.archiveBytes, c.lastRun && c.lastRun.stop], [0, 7e6, '345 minutes up; the next run carries on'], 'the page\'s figures on an empty archive, the size and the log');
const call = (url) => { const out = { status: 0 }; V.handler(api)({ method: 'GET', url, headers: { authorization: 'Basic ' + Buffer.from('a:pw-test').toString('base64') } }, { writeHead(s) { out.status = s; }, end() {} }); return out.status; };
eq([call('/crawl'), call('/api/crawl')], [200, 200], 'the page and its route');

console.log(`crawlstats-test: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
