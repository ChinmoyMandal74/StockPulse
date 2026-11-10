// Company websites (backlog 61, E17): the guesses, robots.txt, the pages
// picked, the match, the checks on the model's answer (websites.js), and the
// loader's run over a made-up web (website-load.js). No network.
//   node website-test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('./websites.js');
const L = require('./website-load.js');

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('FAIL', what); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---- the guesses
const c1 = W.candidates("BREMER WHYTE BROWN & O'MEARA LLP", null, '541110');
eq(c1.slice(0, 3), ['bremerwhytebrownomeara.com', 'bremerwhyte.com', 'bremer.com'], 'the distinctive words, the first two, then the first alone');
ok(c1.includes('bremer-whyte.com') && c1.length <= W.MAX_CANDIDATES, 'a hyphenated guess, and never more than the cap');
eq(W.candidates('PUMP & PROCESS EQUIPMENT CO., INC.', null, '423830')[0], 'pumpprocessequipment.com', 'legal endings and "&" dropped');
eq(W.candidates('CITCO WATER LLC', 'CITCO', '423720').slice(0, 2), ['citco.com', 'citcowater.com'], 'the trading name is tried first');
eq(W.candidates('FAMILIES IN TRANSITION', null, '624200')[0], 'familiestransition.org', 'a charity tries .org first');
ok(!W.candidates('THE GROUP INC', null, '').some((d) => /^(the|group|inc)\./.test(d)), 'no guess from generic words alone');

// ---- robots.txt
const R = W.robots('User-agent: *\nDisallow: /private/\nAllow: /private/ok\nDisallow: /*.php$\n\nUser-agent: BadBot\nDisallow: /');
eq([R('/'), R('/about'), R('/private/x'), R('/private/ok/page'), R('/x.php'), R('/x.php?a=1')], [true, true, false, true, false, true], 'longest rule wins, Allow over Disallow, "*" and "$"');
eq(W.robots('User-agent: *\nDisallow: /')('/about'), false, 'a site that keeps everyone out is kept out of');
eq(W.robots('User-agent: TickrLabResearch\nDisallow: /\n\nUser-agent: *\nDisallow:')('/'), false, 'a group naming us wins over "*"');
eq(W.robots('User-agent: *\nDisallow:')('/anything'), true, 'an empty Disallow allows everything');
eq(W.robots('')('/'), true, 'an empty file allows everything');
eq(W.robots('User-agent: Googlebot\nUser-agent: *\nDisallow: /team')('/team'), false, 'agents listed together share their rules');

// ---- the pages picked
const home = `<a href="/about-us">About Us</a><a href="https://www.acme.com/services/">Our Services</a><a href="/contact">Contact</a>
  <a href="https://facebook.com/acme">About on Facebook</a><a href="/brochure.pdf">About (PDF)</a><a href="/careers">Join our team</a>
  <a href="/news">News</a><a href="/about-us/history/deep">History</a><a href="mailto:x@acme.com">Email</a><a href="/">Home</a>`;
const pk = W.pickPages(home, 'https://acme.com/');
eq(pk.map((p) => p.kind), ['about', 'contact', 'services', 'careers', 'news'], 'one page a kind, likeliest first');
ok(pk.every((p) => /^https:\/\/(www\.)?acme\.com\//.test(p.url)), 'same site only (www or not); no other site, no mail link');
eq(pk[0].url, 'https://acme.com/about-us', 'the shallower about page over the deeper one');
ok(!pk.some((p) => /\.pdf$/.test(p.url)), 'no files');
ok(W.pickPages(home.repeat(3) + '<a href="/team">Leadership</a><a href="/locations">Locations</a>', 'https://acme.com/').length <= W.MAX_PAGES, 'never more than MAX_PAGES');

// ---- is it the company's site
const bw = { name: "BREMER WHYTE BROWN & O'MEARA LLP", city: 'NEWPORT BEACH', state: 'CA', phone: null };
eq(W.verify("Bremer Whyte Brown & O’Meara LLP is a law firm. Offices: Newport Beach, California", bw).verdict, 'confirmed', 'name (curly apostrophe) and city');
eq(W.verify('Bremer, Whyte, Brown & O’Meara. Litigation.', bw).verdict, 'name only', 'name without the place');
eq(W.verify('Bremer Whyte Brown LLP, Newport Beach', bw).verdict, 'confirmed', 'a long name may miss one word');
eq(W.verify('Whyte Brown O’Meara, Newport Beach', bw).verdict, 'no match', 'but never its first');
eq(W.verify('Bremer Plumbing, Newport Beach', bw).verdict, 'no match', 'one word of the name is not the name');
const pp = { name: 'PUMP & PROCESS EQUIPMENT CO., INC.', city: 'BIRMINGHAM', state: 'AL', phone: '2055551234' };
eq(W.verify('Pump & Process Equipment — call (205) 555-1234', pp), { verdict: 'confirmed', name: true, city: false, phone: true }, 'the telephone on file confirms');
eq(W.verify('Pump & Process Equipment — call 205.555.1235', pp).verdict, 'name only', 'another number does not');
eq(W.verify('Pump and Process Equipment +1 205-555-1234', pp).phone, true, 'the telephone written another way');
eq(W.verify('Pump Process Equipment, Birmingham. This domain is for sale!', pp).verdict, 'parked', 'a parked domain is not a site');
eq(W.verify('Rival Corp of Birmingham', { name: 'BIRMINGHAM RIVAL CORP', city: 'BIRMINGHAM' }).verdict, 'confirmed', 'a city in the name still needs the whole name');

// ---- the checks on the model's answer
const page = 'Acme Pumps was founded in 1987 by Jane Roe. We sell industrial pumps, process valves and field service to municipal water and mining customers. Offices in Birmingham, AL and Mobile, AL. Over 150 employees. In 2019 Acme acquired Delta Valve. Jane Roe, President. John Doe, CFO. Clients include the City of Mobile. Call 205-555-1234 or jane@acme.com. Now hiring: 4 open positions.';
const ans = { is_company_site: true, what_they_do: 'We sell industrial pumps, process valves and field service to municipal water and mining customers.', founded_year: '1987', founded_quote: 'Acme Pumps was founded in 1987 by Jane Roe.',
  employees_quote: 'Over 150 employees.', services: ['industrial pumps', 'process valves', 'boiler repair', 'Call 205-555-1234'], markets: ['municipal water', 'mining'], locations: ['Birmingham, AL', 'Mobile, AL', 'Atlanta, GA'],
  leaders: [{ name: 'Jane Roe', role: 'President' }, { name: 'John Doe', role: 'Chief Financial Officer' }, { name: 'Smith', role: '' }], clients: ['City of Mobile'],
  history: [{ year: '2019', quote: 'In 2019 Acme acquired Delta Valve.' }, { year: '2018', quote: 'In 2019 Acme acquired Delta Valve.' }], open_jobs: '4', hiring_quote: 'Now hiring: 4 open positions.' };
const ch = W.check(ans, page);
eq([ch.read.founded, ch.read.services, ch.read.locations], [1987, ['industrial pumps', 'process valves'], ['Birmingham, AL', 'Mobile, AL']], 'what is on the page is kept; what is not is dropped');
eq(ch.read.leaders, [{ name: 'Jane Roe', role: 'President' }, { name: 'John Doe', role: null }], 'a name on the page kept, a title not on it dropped, a single word is not a person');
eq(ch.read.history, [{ year: 2019, quote: 'In 2019 Acme acquired Delta Valve.' }], 'a year must stand in its own quote');
ok(ch.problems.some((p) => /contact details/.test(p)), 'a telephone in a phrase drops it');
ok(ch.problems.some((p) => /Atlanta/.test(p)) && ch.problems.some((p) => /boiler/.test(p)), 'each dropped phrase is named');
eq(ch.read.open_jobs, 4, 'an open-jobs count');
eq(W.check({ ...ans, founded_year: '1988' }, page).read.founded, null, 'a year not in its quote is dropped');
eq(W.check({ ...ans, what_they_do: 'Acme is a leading provider of pumps.' }, page).read.what_they_do, null, 'a paraphrase is not a quote');
eq(W.check({ ...ans, what_they_do: 'We  sell industrial pumps,   process valves and field service to municipal water and mining customers.' }, page).read.what_they_do !== null, true, 'spacing does not matter');
ok(!JSON.stringify(W.check(ans, page).read).includes('jane@acme.com'), 'no email address kept anywhere');
ok(!W.SCHEMA.required.some((k) => /email|phone|address/.test(k)), 'the model is never asked for contact details');

// ---- the loader over a made-up web
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'website-test-'));
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(tmp, 'formd.db'));
  db.exec(`create table f5500_latest (ein text primary key, year integer, name text, dba text, city text, state text, business_code text, staff real, first_year integer, first_staff real, y2019 real, years integer);
    create table fd_profiles (cik text, as_of text, ein text); create table ct_companies (cik text primary key, phone text);`);
  const ins = db.prepare('insert into f5500_latest (ein, year, name, dba, city, state, business_code, staff) values (?, 2024, ?, ?, ?, ?, ?, ?)');
  ins.run('111', 'ACME PUMPS INC', null, 'BIRMINGHAM', 'AL', '423830', 150);
  ins.run('222', 'GHOST WIDGETS LLC', null, 'AKRON', 'OH', '332000', 300);
  ins.run('333', 'SECRET HOLDINGS CORP', null, 'DOVER', 'DE', '551112', 500);
  ins.run('444', 'TINY SHOP LLC', null, 'X', 'TX', '445110', 20);
  db.prepare("insert into fd_profiles values ('9', '2024', '111')").run();
  db.prepare("insert into ct_companies values ('9', '205-555-1234')").run();
  const site = {
    'https://acmepumps.com/robots.txt': [200, 'User-agent: *\nDisallow: /private'],
    'https://acmepumps.com/': [200, '<title>Acme Pumps</title><p>Acme Pumps, Birmingham AL. (205) 555-1234</p><a href="/about">About</a><a href="/team">Our team</a><a href="/private">Careers</a>'],
    'https://acmepumps.com/about': [200, '<p>' + page + '</p>'],
    'https://acmepumps.com/team': [200, '<p>Jane Roe, President</p>'],
    'https://ghostwidgets.com/robots.txt': [200, 'User-agent: *\nDisallow: /'],
    'https://secret.com/robots.txt': [404, ''],
    'https://secret.com/': [200, '<p>This domain is for sale</p>'],
  };
  const fetched = [];
  const resp = (status, body, url) => ({ status, url, headers: { get: (h) => (h === 'content-type' ? 'text/html' : null) },
    body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: Buffer.from(body) })), cancel: async () => {} }; }, cancel: async () => {} } });
  const posts = [];
  const archive = L.openArchive(path.join(tmp, 'web-archive.db'));
  const deps = { db, archive, log: () => {}, now: () => Date.now(), sleep: async () => {},
    lookup: async (d) => (['acmepumps.com', 'ghostwidgets.com', 'secret.com'].includes(d) ? '1.2.3.4' : null),
    fetch: async (url) => { fetched.push(url); const s = site[url]; return s ? resp(s[0], s[1], url) : resp(404, '', url); },
    post: async (body) => { posts.push(body); return { status: 200, body: { stop_reason: 'end_turn', usage: { input_tokens: 5000, output_tokens: 400 }, content: [{ type: 'text', text: JSON.stringify(ans) }] } }; } };
  const dry = await L.run({ commit: false, read: true, max: 10, maxUsd: 1, gapS: 2 }, deps);
  eq([dry.todo, fetched.length], [3, 0], 'a dry run: three companies of 100+ people, nothing looked up or fetched');
  const r = await L.run({ commit: true, read: true, max: 10, maxUsd: 1, gapS: 2 }, deps);
  eq([r.companies, r.confirmed, r.read], [3, 1, 1], 'one confirmed and read');
  const s = db.prepare('select ein, verdict, domain, phone_hit, pages from web_sites order by ein').all().map((x) => ({ ...x }));
  eq(s.map((x) => x.verdict), ['confirmed', 'none found', 'none found'], 'Acme found; robots keeps us off Ghost; the parked domain is not Secret\'s site');
  eq([s[0].domain, s[0].phone_hit, s[0].pages], ['acmepumps.com', 1, 3], 'by its telephone on file, with its pages');
  ok(!fetched.includes('https://ghostwidgets.com/'), 'a site whose robots.txt says keep out is not visited');
  ok(!fetched.some((u) => /\/private$/.test(u)), 'a picked page robots.txt keeps us off is not fetched');
  ok(fetched.indexOf('https://acmepumps.com/robots.txt') < fetched.indexOf('https://acmepumps.com/'), 'robots.txt before the home page');
  eq(posts.length, 1, 'only the confirmed site goes to the model');
  const rd = JSON.parse(db.prepare("select read from web_reads where ein = '111'").get().read);
  eq([rd.founded, rd.leaders.length], [1987, 2], 'the checked facts are stored');
  eq(archive.db.prepare("select count(*) n from pages where ein = '111'").get().n, 3, 'the page text goes to the local archive');
  const again = await L.run({ commit: true, read: true, max: 10, maxUsd: 1, gapS: 2 }, deps);
  eq(again.companies, 0, 'a company tried is not tried again');
  // --retry after a change to how sites are found: only "none found" again.
  // Ghost answers only at www (its robots.txt now allowing), Secret only over
  // plain HTTP.
  site['https://www.ghostwidgets.com/robots.txt'] = [404, ''];
  site['https://www.ghostwidgets.com/'] = [200, '<p>Ghost Widgets LLC of Akron, Ohio</p>'];
  site['http://secretholdings.com/robots.txt'] = [404, ''];
  site['http://secretholdings.com/'] = [200, '<p>Secret Holdings Corp, Dover</p>'];
  const deps2 = { ...deps,
    lookup: async (d) => (['www.ghostwidgets.com', 'secretholdings.com'].includes(d) ? '1.2.3.4' : null),
    fetch: async (url) => { fetched.push(url); if (/^https:\/\/secretholdings/.test(url)) throw new Error('ECONNREFUSED'); const s = site[url]; return s ? resp(s[0], s[1], url) : resp(404, '', url); } };
  const re = await L.run({ commit: true, read: false, retry: true, max: 10, maxUsd: 1, gapS: 2 }, deps2);
  eq(re.companies, 2, 'only the two where nothing was found are tried again');
  eq(db.prepare("select ein, verdict, domain from web_sites where ein in ('222', '333') order by ein").all().map((x) => [x.verdict, x.domain]),
    [['confirmed', 'www.ghostwidgets.com'], ['confirmed', 'secretholdings.com']], 'a site answering only at www, and one serving only plain HTTP');
  ok(fetched.includes('http://secretholdings.com/robots.txt'), 'plain HTTP only after HTTPS got no answer');
  // The connection down: every address looked up answers nothing.
  db.exec('delete from web_sites');
  for (let i = 0; i < 12; i++) ins.run('9' + i, 'DEAD CO NUMBER ' + i, null, 'X', 'TX', '445110', 200);
  const down = await L.run({ commit: true, read: false, max: 20, maxUsd: 1, gapS: 2 }, { ...deps, lookup: async () => '1.2.3.4', fetch: async () => { throw new Error('ECONNRESET'); } });
  ok(!down.ok && down.companies === 10, 'ten companies in a row with no answer from anyone stops the run');
  archive.close(); db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`website-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
