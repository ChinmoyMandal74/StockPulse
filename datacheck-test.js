// The data check (datacheck.js, 2026-11-08). Pure: no database, no network.
//
//   node datacheck-test.js
//
// The fixtures are the real cases that made the check worth having: IESC's
// unapplied two-for-one, ITA's and MTUM's unrecorded ETF splits, XP's fall,
// SCCO's lost history and REZI's spin-off factor.
'use strict';
const C = require('./datacheck.js');

let n = 0, failed = 0;
function check(label, got, want) {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
  else console.log(`  ok    ${label}`);
}
const bars = (pairs) => pairs.map(([d, close]) => ({ d, close }));

console.log('moves');
{
  const B = {
    IESC: bars([['2026-08-20', 683.27], ['2026-08-21', 685.04], ['2026-08-25', 313.23], ['2026-08-26', 331.48]]),
    ITA: bars([['2026-10-27', 206.22], ['2026-10-28', 207.74], ['2026-10-29', 71.43], ['2026-10-30', 69.91]]),
    MTUM: bars([['2026-10-28', 303.50], ['2026-10-29', 74.58]]),
    REV: bars([['2026-10-01', 2.10], ['2026-10-02', 21.40]]),                       // a one-for-ten, unrecorded
    BIO: bars([['2026-10-05', 40.00], ['2026-10-06', 22.00]]),                       // a trial failure: -45%
    CALM: bars([['2026-10-05', 40.00], ['2026-10-06', 36.00], ['2026-10-07', 39.00]]), // ordinary days
    OLD: bars([['2026-01-05', 40.00], ['2026-01-06', 10.00]]),                       // before the window
  };
  const splits = new Map([['IESC', [{ d: '2026-08-24', f: 2 }]]]);
  const m = C.moves(B, splits, '2026-08-01');
  const by = (s) => m.find((x) => x.symbol === s);
  check('IESC: a held split explains the cliff -> unadjusted', [by('IESC').kind, by('IESC').d], ['unadjusted', '2026-08-25']);
  check('ITA: a third of the price, no split held -> looks like a 3-for-1', [by('ITA').kind, by('ITA').n], ['split?', '3-for-1']);
  check('MTUM: a quarter of the price -> looks like a 4-for-1', [by('MTUM').kind, by('MTUM').n], ['split?', '4-for-1']);
  check('ten times the price -> looks like a 1-for-10', [by('REV').kind, by('REV').n], ['split?', '1-for-10']);
  check('a 45% fall the size of no split -> a move to check against the news', by('BIO').kind, 'move');
  check('ordinary days are not reported', by('CALM'), undefined);
  check('a move before the window is not reported', by('OLD'), undefined);
  check('the key holds kind, stock and day (so it is reported once)', by('BIO').key, 'move|BIO|2026-10-06');
  // the same IESC cliff, with the split held but the archive already adjusted: no move at all
  check('an adjusted series around a held split reports nothing',
    C.moves({ IESC: bars([['2026-08-21', 342.52], ['2026-08-25', 313.23]]) }, splits, '2026-08-01').length, 0);
}

console.log('history');
{
  const h = C.history({ SCCO: { first: '2026-10-19' }, AAPL: { first: '2006-12-20' }, NEWS: { first: '2026-11-01' } },
    { SCCO: '2006-12-21', AAPL: '2006-12-20', GONE: '2010-01-04', NEWS: '2026-10-30' });
  check('SCCO starting in October instead of 2006 is lost history', h.map((x) => x.symbol), ['SCCO']);
  check('a stock that left the universe is not a shrink, nor a two-day move of the first date', h.length, 1);
}

console.log('factors');
{
  const f = C.factors(new Map([['REZI', [{ d: '2026-08-04', f: 1.437 }]], ['IESC', [{ d: '2026-08-24', f: 2 }]],
    ['SCCO', [{ d: '2026-11-03', f: 1.0106 }]], ['OLDF', [{ d: '2025-01-02', f: 1.3 }]]]), '2026-07-10');
  check('REZI’s 1.437 is a factor the app does not apply; a 2-for-1, a 1% stock dividend and an old factor are not listed', f.map((x) => x.symbol), ['REZI']);
}

console.log('diff');
{
  const a = { key: 'move|BIO|2026-10-06' }, b = { key: 'history|SCCO|2026-10-19' }, c = { key: 'factor|REZI|2026-08-04' };
  const first = C.diff([a, b], {}, '2026-11-09');
  check('first run: everything is new', [first.fresh.length, first.open.length, first.cleared.length], [2, 0, 0]);
  const second = C.diff([a, b, c], first.seen, '2026-11-10');
  check('next run: the old two are open, the new one is new', [second.fresh.map((x) => x.key), second.open.length], [['factor|REZI|2026-08-04'], 2]);
  check('…and keeps the day each was first seen', second.seen['move|BIO|2026-10-06'], '2026-11-09');
  const third = C.diff([c], second.seen, '2026-11-11');
  check('a history finding that went away is cleared; a move leaving the window is not', third.cleared, ['history|SCCO|2026-10-19']);
}

console.log(`\n${n - failed} of ${n} checks passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
