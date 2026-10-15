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

console.log(ran + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
