// paper.js on fixtures. No server, no network.   node paper-test.js
// The routes were checked against the real server on an in-memory database
// (25 checks, docs/context/paper-positions.md); this is the arithmetic.
const P = require('./paper.js');
let ran = 0, failed = 0;
const check = (name, ok, extra) => { ran++; if (!ok) { failed++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const near = (a, b) => Math.abs(a - b) < 1e-6;

const acct = { start_cash: 100000, started_at: Date.parse('2026-10-01T14:00:00Z') };
const t = (id, kind, symbol, shares, price, ts) => ({ id, kind, symbol, shares, price, ts: ts || acct.started_at + id * 1000 });

// Average cost: 100 @ 100, then 100 @ 120 -> avg 110; close 50 @ 130.
const ledger = [t(1, 'open', 'A', 100, 100), t(2, 'open', 'A', 100, 120), t(3, 'close', 'A', 50, 130)];
let s = P.summarise(acct, ledger, { A: { price: 140, pricedAt: 1 } });
const a = s.positions[0];
check('average cost across two fills', near(a.avgCost, 110) && near(a.shares, 150), a);
check('a part-close keeps the average of the rest', near(a.cost, 150 * 110));
check('the closed slice is measured against the average', near(s.closed[0].pnl, 50 * 20) && near(s.closed[0].ret, 130 / 110 - 1), s.closed[0]);
check('cash: start less cost plus proceeds', near(s.cash, 100000 - 10000 - 12000 + 6500), s.cash);
check('equity and return at the latest price', near(s.equity, s.cash + 150 * 140) && near(s.ret, s.equity / 100000 - 1));

// Close everything, then open again: a fresh position, fresh average, fresh open date.
const again = ledger.concat([t(4, 'close', 'A', 150, 140), t(5, 'open', 'A', 10, 200)]);
s = P.summarise(acct, again, { A: { price: 200 } });
check('reopened position starts its own average', s.positions.length === 1 && near(s.positions[0].avgCost, 200) && s.positions[0].openedAt === again[4].ts, s.positions);
check('closed list is newest first', s.closed[0].id === 4 && s.closed[1].id === 3);

// Untracked: valued at the last traded price.
s = P.summarise(acct, [t(1, 'open', 'GONE', 10, 50)], {});
check('a stock no longer tracked is valued at its last traded price', s.positions[0].tracked === false && near(s.positions[0].value, 500));

// A close of more than is held only takes what is held.
s = P.summarise(acct, [t(1, 'open', 'A', 5, 10), t(2, 'close', 'A', 50, 12)], {});
check('an over-close in the ledger takes only what was held', near(s.closed[0].shares, 5) && s.positions.length === 0 && near(s.cash, 100000 + 10));

// Sizing.
check('dollars size fractional shares', near(P.sizeOpen({ dollars: 1000 }, 300, 5000).shares, 3.333333));
check('more than the cash is refused', !!P.sizeOpen({ dollars: 6000 }, 300, 5000).error);
check('under $1 is refused', !!P.sizeOpen({ dollars: 0.5 }, 300, 5000).error);
check('no amount is refused', !!P.sizeOpen({}, 300, 5000).error);
check('no price is refused', !!P.sizeOpen({ dollars: 10 }, 0, 5000).error);
check('shares are taken as given', near(P.sizeOpen({ shares: 2 }, 300, 5000).shares, 2));
check('null is not zero: an empty dollars field falls to shares', near(P.sizeOpen({ dollars: '', shares: 1 }, 10, 100).shares, 1));
check('close all by default', near(P.sizeClose({}, 7.5).shares, 7.5));
check('close more than held is refused', !!P.sizeClose({ shares: 8 }, 7.5).error);
check('close with nothing open is refused', !!P.sizeClose({ all: true }, 0).error);

// History: SPY rebased to the start, the account at each close.
const bench = [{ d: '2026-09-30', c: 90 }, { d: '2026-10-01', c: 100 }, { d: '2026-10-02', c: 110 }];
const h = P.history(acct, [t(1, 'open', 'A', 100, 100)], { A: [{ d: '2026-10-01', c: 100 }, { d: '2026-10-02', c: 150 }] }, bench);
check('history starts on the start day', h.length === 2 && h[0].d === '2026-10-01', h);
check('SPY rebased to the starting cash', h[0].bench === 100000 && near(h[1].bench, 110000), h);
check('account valued at each close', near(h[0].value, 100000) && near(h[1].value, 90000 + 100 * 150), h);
// A fill at 8pm Eastern belongs to that New York day, not the next UTC one.
check('trading day is New York’s', P.nyDay(Date.parse('2026-10-02T00:30:00Z')) === '2026-10-01');

// ---- dated entries (2026-10-20) --------------------------------------------
// A trade dated to a past day takes its place by DAY, wherever it was typed in.
const dt = (id, kind, symbol, shares, price, d, extra) => Object.assign({ id, kind, symbol, shares, price, d, ts: Date.parse('2026-10-20T15:00:00Z') + id }, extra || {});
check('dayOf: a dated trade is its day, a live one its New York day', P.dayOf(dt(1, 'open', 'A', 1, 1, '2025-03-04')) === '2025-03-04' && P.dayOf(t(1, 'open', 'A', 1, 1)) === '2026-10-01');
check('whenOf: noon on a dated trade’s day', P.whenOf(dt(1, 'open', 'A', 1, 1, '2025-03-04')) === Date.parse('2025-03-04T12:00:00Z'));
// Typed in after a live open, dated before it: it is the first open of A, so
// the position's open date is the dated one, and the closed slice measures from it.
{
  const L = [t(1, 'open', 'A', 10, 100, Date.parse('2026-10-05T15:00:00Z')), dt(2, 'open', 'A', 10, 50, '2025-01-06'), dt(3, 'close', 'A', 5, 80, '2025-06-02')];
  const S2 = P.summarise(acct, L, { A: { price: 120 } });
  check('replayed by day: the dated close comes before the later live open', S2.closed.length === 1 && near(S2.closed[0].entry, 50) && near(S2.closed[0].exit, 80), S2.closed);
  check('the open date of the position that remains is the dated first open', S2.positions[0].openedAt === Date.parse('2025-01-06T12:00:00Z') && S2.positions[0].dated === true, S2.positions[0]);
  check('days held measured between the two dates', S2.closed[0].days === Math.round((Date.parse('2025-06-02') - Date.parse('2025-01-06')) / 86400000));
  check('average after: 5 left at 50, then 10 at 100', near(S2.positions[0].avgCost, (5 * 50 + 10 * 100) / 15) && near(S2.positions[0].shares, 15));
}
// The whole ledger must add up in day order.
{
  const small = { start_cash: 10000, started_at: acct.started_at };
  check('a ledger that fits passes', P.checkLedger(small, [dt(1, 'open', 'A', 50, 100, '2025-01-06'), dt(2, 'close', 'A', 50, 120, '2025-02-03'), dt(3, 'open', 'B', 100, 110, '2025-03-03')]) === null);
  // An earlier dated open spends the cash a later open had used: the later day fails.
  const r1 = P.checkLedger(small, [t(1, 'open', 'B', 80, 100, Date.parse('2026-10-05T15:00:00Z')), dt(2, 'open', 'A', 50, 100, '2025-01-06')]);
  check('an earlier entry that leaves a later one short of cash is refused, naming the later day', !!r1 && /2026-10-05/.test(r1.error), r1);
  const r2 = P.checkLedger(small, [dt(1, 'open', 'A', 10, 100, '2025-05-01'), dt(2, 'close', 'A', 10, 120, '2025-04-01')]);
  check('a close dated before its open is refused', !!r2 && /2025-04-01/.test(r2.error), r2);
  check('spending exactly the cash is allowed', P.checkLedger(small, [dt(1, 'open', 'A', 100, 100, '2025-01-06')]) === null);
  check('a cent over is refused', !!P.checkLedger(small, [dt(1, 'open', 'A', 100.0001, 100, '2025-01-06')]));
  check('heldOn: what was open at the end of a day', near(P.heldOn([dt(1, 'open', 'A', 10, 1, '2025-01-06'), dt(2, 'close', 'A', 4, 1, '2025-02-03'), dt(3, 'open', 'A', 1, 1, '2025-03-03')], 'A', '2025-02-10'), 6));
  check('heldOn: nothing before the first open', P.heldOn([dt(1, 'open', 'A', 10, 1, '2025-01-06')], 'A', '2025-01-03') === 0);
}
// Splits: a statement from before one is on another footing.
{
  const NV = [{ d: '2021-07-20', f: 4 }, { d: '2024-06-10', f: 10 }];
  check('splitFactor: both splits since 2021', P.splitFactor(NV, '2021-01-04') === 40);
  check('splitFactor: one since 2023', P.splitFactor(NV, '2023-05-01') === 10);
  check('splitFactor: a purchase on the split day is already on the new basis', P.splitFactor(NV, '2024-06-10') === 1);
  check('splitFactor: none since', P.splitFactor(NV, '2025-01-02') === 1 && P.splitFactor(null, '2025-01-02') === 1);
}
// The price paid must lie in the day's range, on the statement's basis.
{
  const bar = { low: 118.5, high: 122, close: 120 };
  check('blank takes the close', P.pricedOn('', bar, 1).price === 120 && P.pricedOn('', bar, 1).entered === null);
  check('a price in the range is kept', near(P.pricedOn(119.25, bar, 1).price, 119.25));
  check('outside the range is refused, naming the range', /118\.50 to \$122\.00/.test(P.pricedOn(130, bar, 1).error || ''), P.pricedOn(130, bar, 1));
  check('half a percent of room for rounding', !P.pricedOn(122.5, bar, 1).error && !!P.pricedOn(123, bar, 1).error);
  check('before a 10-for-1: $1,200 paid is $120 today', near(P.pricedOn(1200, bar, 10).price, 120) && P.pricedOn(1200, bar, 10).entered === 1200);
  check('and the range is said on the statement’s basis', /1185\.00 to \$1220\.00, before the split/.test(P.pricedOn(150, bar, 10).error || ''), P.pricedOn(150, bar, 10));
  check('zero or a word is refused', !!P.pricedOn('0', bar, 1).error && !!P.pricedOn('abc', bar, 1).error);
  check('no stored price for the day', !!P.pricedOn('', { close: null }, 1).error);
}
// The starting amount.
check('starting amount: blank is $100,000', P.startCashOf('').cash === 100000);
check('starting amount: commas and a dollar sign are read', P.startCashOf('$250,000').cash === 250000);
check('starting amount: under $1,000 or over $10M is refused', !!P.startCashOf(500).error && !!P.startCashOf(20000000).error && !!P.startCashOf('lots').error);
// History with dated entries: the account's own start (moved back to the
// first dated day by the server) and the trades in day order.
{
  const a2 = { start_cash: 10000, started_at: Date.parse('2025-01-06T12:00:00Z') };
  const b2 = [{ d: '2025-01-03', c: 90 }, { d: '2025-01-06', c: 100 }, { d: '2025-01-07', c: 105 }, { d: '2025-01-08', c: 100 }];
  const h2 = P.history(a2, [t(9, 'open', 'Z', 1, 1, Date.parse('2026-10-05T15:00:00Z')), dt(2, 'open', 'A', 50, 100, '2025-01-06'), dt(3, 'close', 'A', 50, 110, '2025-01-08')],
    { A: [{ d: '2025-01-06', c: 100 }, { d: '2025-01-07', c: 104 }, { d: '2025-01-08', c: 110 }] }, b2);
  check('dated history starts on the first dated day', h2[0].d === '2025-01-06' && h2.length === 3, h2);
  check('valued through the dated open and close', near(h2[0].value, 10000) && near(h2[1].value, 5000 + 50 * 104) && near(h2[2].value, 10000 + 50 * 10), h2);
  check('SPY rebased on that day', near(h2[1].bench, 10500), h2);
}

console.log(ran + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
