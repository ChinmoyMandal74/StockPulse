// Acquisition targets (targets.js): regions, the filters, the staff-history
// pattern, the website words and the fit. Pure; the archive side is checked in
// formd-view-test.js.
//   node targets-test.js
'use strict';
const T = require('./targets.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const sp = (s) => new URLSearchParams(s);

// ---- regions ----
eq(T.regionStates(''), null, 'no region: the whole country');
eq(T.regionStates('near:wv'), ['WV', 'KY', 'MD', 'OH', 'PA', 'VA'], 'a state and its neighbours');
ok(T.regionStates('near2:WV').includes('IN') && T.regionStates('near2:WV').includes('NC') && !T.regionStates('near2:WV').includes('TX'), 'two steps out reaches Indiana and North Carolina, not Texas');
eq(T.regionStates('states:wv, oh,xx,KY'), ['WV', 'OH', 'KY'], 'a list, unknown codes dropped');
eq(T.regionStates('states:xx'), null, 'a list of nothing is no filter');
eq(T.regionStates('division:South Atlantic').length, 9, 'a census division');
eq(T.regionStates('region:West').length, 13, 'a census region');
eq(T.regionStates('region:Atlantis'), null, 'an unknown region is no filter');
// Every border runs both ways.
const oneWay = [];
for (const [s, ns] of Object.entries(T.NEIGHBOURS)) for (const n of T.near(s)) if (!T.near(n).includes(s)) oneWay.push(s + '>' + n);
eq(oneWay, [], 'neighbours are symmetric');
eq(Object.values(T.DIVISIONS).flat().sort(), T.STATES.slice().sort(), 'the divisions cover every state once');

// ---- filters ----
const d = T.filters(sp(''));
eq([d.preset, d.buyer, d.minStaff, d.maxStaff, d.minYears, d.pppOnly, d.states], ['water', 'addon', 15, 150, 5, true, null], 'defaults: the water profile, an add-on, 15 to 150 staff');
eq([T.filters(sp('buyer=platform')).minStaff, T.filters(sp('buyer=platform')).maxStaff], [60, 400], 'a platform has its own size band');
eq([T.filters(sp('minStaff=300&maxStaff=20')).minStaff, T.filters(sp('minStaff=300&maxStaff=20')).maxStaff], [20, 300], 'a band given backwards is turned round');
eq(T.filters(sp('minStaff=-4')).minStaff, 15, 'a negative size falls back');
eq(T.filters(sp('planCodes=2371;drop,42x,4237')).planCodes, ['4237'], 'codes are digits only');
eq(T.filters(sp('pppCodes=23711,237110')).pppCodes, ['237110'], 'loan codes are six digits');
eq(T.filters(sp('keywords=Well Drilling, ab ,  irrigation')).keywords, ['well drilling', 'irrigation'], 'words: lower case, short ones dropped');
eq(T.filters(sp('preset=__proto__')).preset, 'water', 'an inherited key is not a preset');
eq(T.filters(sp('region=near:wv')).home, 'WV', 'the home state of a near search');

// ---- the staff pattern ----
const citco = [[2009, 96], [2010, 102], [2011, 112], [2012, 108], [2013, 108], [2014, 106], [2015, 90], [2016, 117], [2017, 108], [2018, 96], [2019, 96], [2020, 91], [2021, 100], [2022, 102], [2023, 138], [2024, 180], [2025, 175]]
  .map(([year, staff]) => ({ year, staff }));
eq(T.pattern(citco).kind, 'jump', 'CITCO: about 100 for a decade, then 175: a jump');
eq(T.pattern(citco.slice(0, 14)).kind, 'steady', 'CITCO to 2022: steady');
eq(T.pattern([{ year: 2020, staff: 50 }, { year: 2021, staff: 52 }, { year: 2022, staff: 51 }]).kind, 'short', 'three years is too few');
eq(T.pattern([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023].map((year) => ({ year, staff: year < 2023 ? 100 : 60 }))).kind, 'shrinking', 'down by more than a quarter');
eq(T.pattern([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023].map((year) => ({ year, staff: year < 2023 ? 20 : 30 }))).kind, 'steady', 'a jump of fewer than 15 people is not one');
eq(T.pattern([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023].map((year) => ({ year, staff: year < 2023 ? 100 : null }))).kind, 'steady', 'a missing year is left out, not read as zero');

// ---- website words ----
eq(T.keywordHits('We drill water wells and service well pumps. Water treatment too.', ['water well', 'well pump', 'water treatment', 'irrigation']), ['water well', 'well pump', 'water treatment'], 'whole phrases found');
eq(T.keywordHits('Our pumping stations', ['pump']), [], 'a word inside another is not a hit');
eq(T.keywordHits('', ['pump']), [], 'no text, no hits');
eq(T.keywordHits('water   treatment', ['water treatment']), ['water treatment'], 'spacing does not matter');

// ---- the fit ----
const f = T.filters(sp('buyer=platform&region=near:WV'));
const base = { planCode: '423700', pppCodes: ['237110'], staff: 175, years: 17, pattern: { kind: 'jump' }, state: 'WV', formd: false, vehicle: false, growth: 0.82,
  site: { status: 'read', hits: ['water treatment', 'wastewater'] } };
const c = T.fit(base, f);
eq(c.score, 80, 'CITCO as a platform: codes, site, size, years, home state, less the jump');
ok(c.backed && c.flags.some((x) => /jumped/.test(x)), 'and flagged as possibly already bought');
const steady = T.fit({ ...base, pattern: { kind: 'steady' } }, f);
eq(steady.score, 105, 'the same company before its jump: steady, and growth counted');
eq(T.fit({ ...base, site: { status: 'read', hits: [] } }, f).score, 30, 'a site that names none of the words counts against');
eq(T.fit({ ...base, site: { status: 'not tried', hits: [] } }, f).score, 50, 'a site not read counts nothing either way');
const fa = T.filters(sp('buyer=addon'));
eq(T.fit({ ...base, pattern: { kind: 'jump' } }, fa).score - T.fit({ ...base, pattern: { kind: 'short' } }, fa).score, 0, 'for an add-on a jump is a flag, not a penalty');
ok(T.fit({ ...base, formd: true }, f).flags.includes('raised outside money (Form D)'), 'outside money flagged');
ok(T.VEHICLE.test('ACME WATER HOLDINGS LLC') && !T.VEHICLE.test('HOLDING TANK SERVICE'.replace('HOLDING', 'HOLDEN')), 'a holding-company name');

// ---- the spreadsheet ----
const csv = T.toCsv([{ score: 80, name: 'THE C. I. THORNBURG CO, INC.', city: 'HUNTINGTON', state: 'WV', source: 'plan', ein: '550421240', planCode: '423700', staff: 175, staffYear: 2025, y2019: 96, years: 17,
  pattern: { kind: 'jump' }, pppCodes: ['237110'], pppJobs: 95, site: { domain: 'citcowater.com', status: 'read', hits: ['water treatment'] }, flags: ['x'], why: ['+15 a, "quoted"'] }]);
ok(csv.includes('"THE C. I. THORNBURG CO, INC."') && csv.includes('55-0421240') && csv.includes('"+15 a, ""quoted"""'), 'quoted where needed, the tax ID with its dash');

console.log(`targets-test: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
