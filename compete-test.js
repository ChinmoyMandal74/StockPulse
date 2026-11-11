// Paper competitions' rules (compete.js): the status, names, the admin's
// set-up, the invite code, and the standings (places, ties, the winner, who
// sees which positions).
'use strict';
const C = require('./compete.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log('FAIL ' + m, x === undefined ? '' : JSON.stringify(x)); } };

// ---- status, on New York days ----
const comp = { start_d: '2026-11-16', end_d: '2026-12-18' };
ok(C.status(comp, '2026-11-15') === 'upcoming', 'the day before is upcoming');
ok(C.status(comp, '2026-11-16') === 'running' && C.status(comp, '2026-12-18') === 'running', 'the first and last days are running');
ok(C.status(comp, '2026-12-19') === 'ended', 'the day after the last is ended');

// ---- names ----
ok(C.teamName('  The   Bulls ').name === 'The Bulls', 'a team name trimmed, spaces folded');
ok(!!C.teamName('A').error && !!C.teamName('x'.repeat(31)).error, 'a team name 2 to 30 characters');
ok(!!C.teamName('<script>').error && !!C.shownName('bob@example.com').error, 'no markup, no email address as a name');
ok(C.shownName("Zoë O'Neil-Smith").name === "Zoë O'Neil-Smith", 'letters with accents, apostrophe and hyphen are fine');
ok(!!C.shownName('').error && !!C.shownName(null).error, 'a name is required');

// ---- the admin's set-up ----
const good = C.checkComp({ name: 'December cup', start: '2026-11-16', end: '2026-12-18', startCash: '$100,000' }, '2026-11-11');
ok(C.checkComp({ name: 'Cup #2 (December): long, short', start: '2026-11-16', end: '2026-12-18', startCash: 1e5 }, '2026-11-11').name === 'Cup #2 (December): long, short', 'a competition name may have ( ) : , #');
ok(!!C.teamName('Team (A)').error, 'a team name may not');
ok(good.name === 'December cup' && good.start_cash === 100000 && good.start_d === '2026-11-16', 'a competition: name, days, amount read', good);
ok(!!C.checkComp({ name: 'X cup', start: '2026-12-18', end: '2026-11-16', startCash: 1e5 }, '2026-11-11').error, 'the last day before the first is refused');
ok(!!C.checkComp({ name: 'X cup', start: '2026-10-01', end: '2026-10-30', startCash: 1e5 }, '2026-11-11').error, 'a last day already gone is refused');
ok(!!C.checkComp({ name: 'X cup', start: '2026-11-16', end: '2028-01-01', startCash: 1e5 }, '2026-11-11').error, 'longer than the most a competition may run is refused');
ok(!!C.checkComp({ name: 'X cup', start: '2026-11-16', end: '2026-12-18', startCash: 500 }, '2026-11-11').error, 'under $1,000 is refused');
ok(!!C.checkComp({ name: 'X cup', start: '2026-11-16', end: '2026-12-18', startCash: '' }, '2026-11-11').error, 'no amount is refused, never read as 0');
ok(!C.checkComp({ name: 'X cup', start: '2026-11-11', end: '2026-11-11', startCash: 1e4 }, '2026-11-11').error, 'a one-day competition today is fine');

// ---- invite codes ----
const code = C.codeFrom([0, 1, 2, 3, 4, 5, 6, 255]);
ok(/^[A-HJ-NP-Z2-9]{8}$/.test(code), 'eight characters, none of 0 O 1 I', code);
ok(C.normCode(' abcd-efgh ') === 'ABCDEFGH', 'a typed code is read in capitals without spaces or dashes');

// ---- standings ----
const team = (id, name, show) => ({ id, name, show_positions: show ? 1 : 0 });
const sum = (equity, positions) => ({ startCash: 100000, equity, cash: 0, positions: positions || [] });
const pos = [{ symbol: 'NVDA', name: 'NVIDIA', shares: 10, value: 50000, gainPct: 0.1 }];
const entries = [
  { team: team(1, 'Alpha', true), members: [{ display_name: 'Ann' }], summary: sum(110000, pos), trades: 3 },
  { team: team(2, 'Beta', false), members: [{ display_name: 'Ben' }, { display_name: 'Bo' }], summary: sum(120000, pos), trades: 2 },
  { team: team(3, 'Gamma', true), members: [{ display_name: 'Gil' }], summary: sum(110000.4, []), trades: 1 },
  { team: team(4, 'Delta', true), members: [{ display_name: 'Dee' }], summary: sum(100000, []), trades: 0 },
];
let s = C.standings(entries, 1, false);
ok(s.map((r) => r.team).join() === 'Beta,Alpha,Gamma,Delta', 'placed by return, highest first', s.map((r) => r.team));
ok(s.map((r) => r.rank).join() === '1,2,2,4', 'equal returns to a hundredth of a percent share a place; the next skips', s.map((r) => r.rank));
ok(s.every((r) => !r.winner), 'no winner while it runs');
ok(s.find((r) => r.team === 'Beta').positions === null && s.find((r) => r.team === 'Beta').count === 1, 'a team that hides its positions: count only');
ok(s.find((r) => r.team === 'Alpha').positions[0].symbol === 'NVDA' && Math.abs(s.find((r) => r.team === 'Alpha').positions[0].weight - 50000 / 110000) < 1e-9, 'a team that shows them: each with its weight');
ok(C.standings(entries, 2, false).find((r) => r.team === 'Beta').positions !== null, 'a team always sees its own positions');
ok(s.find((r) => r.team === 'Alpha').mine && !s.find((r) => r.team === 'Beta').mine, 'the viewer\'s team is marked');
ok(JSON.stringify(s).indexOf('@') < 0 && !('user_key' in s[0]), 'no email or key in the standings');
s = C.standings(entries, null, true);
ok(s.filter((r) => r.winner).map((r) => r.team).join() === 'Beta', 'once ended, first place wins');
// Everyone who traded lost; the untouched account sits first in cash and does not win.
const lost = [
  { team: team(1, 'Alpha', true), members: [], summary: sum(95000), trades: 2 },
  { team: team(2, 'Cash', true), members: [], summary: sum(100000), trades: 0 },
  { team: team(3, 'Gamma', true), members: [], summary: sum(97000), trades: 4 },
];
s = C.standings(lost, null, true);
ok(s[0].team === 'Cash' && s[0].rank === 1 && !s[0].winner, 'an account that never traded can be first but cannot win');
ok(s.filter((r) => r.winner).map((r) => r.team).join() === 'Gamma', 'the best return among those that traded wins', s.map((r) => [r.team, r.winner]));
// A tie for the win is shared.
s = C.standings([
  { team: team(1, 'A', 1), members: [], summary: sum(105000), trades: 1 },
  { team: team(2, 'B', 1), members: [], summary: sum(105000), trades: 1 },
], null, true);
ok(s.every((r) => r.winner && r.rank === 1), 'a tie for first is shared');
// A missing value is never a zero.
s = C.standings([{ team: team(1, 'A', 1), members: [], summary: { startCash: 100000, equity: NaN, positions: [] }, trades: 1 }], null, true);
ok(s[0].ret === null && s[0].rank === null && !s[0].winner, 'no value: no return, no place, never 0');

// ---- the final value ----
ok(C.finalOf([{ d: '2026-12-17', value: 1 }, { d: '2026-12-18', value: 2 }, { d: '2026-12-21', value: 3 }], '2026-12-18').value === 2, 'the final value is the last close on or before the last day');
ok(C.finalOf([], '2026-12-18') === null, 'no close, no final value');

console.log(`compete-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
