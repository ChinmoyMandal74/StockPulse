// splitadj.js, inst13f.js's buyers and sellers, holderbook.js's bought and sold.
const S = require('./splitadj.js');
const I = require('./inst13f.js');
const HB = require('./holderbook.js');
let ran = 0, failed = 0;
const check = (name, ok, extra) => { ran++; if (!ok) { failed++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const near = (a, b) => Math.abs(a - b) < 1e-6;

// ---- the split factor ----
const nvda = [{ d: '2021-07-20', f: 4 }, { d: '2024-06-10', f: 10 }];
check('a split inside the window', S.factor(nvda, '2024-03-31', '2024-06-30') === 10);
check('a split on the later date counts', S.factor([{ d: '2024-06-30', f: 2 }], '2024-03-31', '2024-06-30') === 2);
check('a split on the earlier date does not', S.factor([{ d: '2024-03-31', f: 2 }], '2024-03-31', '2024-06-30') === 1);
check('outside the window', S.factor(nvda, '2025-03-31', '2025-06-30') === 1);
check('two splits multiply', S.factor(nvda, '2021-01-01', '2024-12-31') === 40);
check('a reverse split', near(S.factor([{ d: '2026-05-01', f: 0.1 }], '2026-03-31', '2026-06-30'), 0.1));
check('no dates, no change', S.factor(nvda, null, '2024-06-30') === 1);

// ---- a 10-for-1 split is not buying ----
const cur = new Map([['NVDA', new Map([['A', { name: 'Alpha', shares: 1000, value: 100000 }], ['B', { name: 'Beta', shares: 600, value: 60000 }], ['C', { name: 'Gamma', shares: 50, value: 5000 }]])]]);
const prevRaw = new Map([['NVDA', new Map([['A', { name: 'Alpha', shares: 100, value: 90000 }], ['B', { name: 'Beta', shares: 80, value: 72000 }], ['D', { name: 'Delta', shares: 30, value: 27000 }]])]]);
const splits = new Map([['NVDA', [{ d: '2026-06-10', f: 10 }]]]);
const adj = S.adjustPrev(prevRaw, splits, () => '2026-03-31', () => '2026-06-30');
check('adjust counts the holdings moved', adj.adjusted === 3 && adj.symbols.join() === 'NVDA', adj);
check('the original is not changed', prevRaw.get('NVDA').get('A').shares === 100);
check('shares on this period\'s footing', adj.prev.get('NVDA').get('A').shares === 1000 && adj.prev.get('NVDA').get('B').shares === 800);
check('value left as it was', adj.prev.get('NVDA').get('A').value === 90000);

const s = I.summarise(cur.get('NVDA'), adj.prev.get('NVDA'), 0, 15);
check('total change after the split', s.shares === 1650 && s.sharesPrev === 2100, [s.shares, s.sharesPrev]);
check('Alpha held steady: neither list', !s.buyers.some((m) => m.cik === 'A') && !s.sellers.some((m) => m.cik === 'A'));
check('buyers: the new holder', s.buyers.length === 1 && s.buyers[0].cik === 'C' && s.buyers[0].prev === 0, s.buyers);
check('sellers: the largest cut first, an exit included', s.sellers.map((m) => m.cik).join() === 'D,B', s.sellers);
check('an exit reads zero shares now', s.sellers[0].shares === 0 && s.sellers[0].prev === 300);
// Without the adjustment every holder looks like a buyer.
const raw = I.summarise(cur.get('NVDA'), prevRaw.get('NVDA'), 0, 15);
check('unadjusted, the split reads as buying', raw.buyers.length === 3, raw.buyers.map((m) => m.cik));
// No earlier quarter: no lists.
const none = I.summarise(cur.get('NVDA'), null, 0, 15);
check('no earlier quarter, no lists', none.buyers === null && none.sellers === null);

// ---- bought and sold in a holder's book, at one price ----
const px = new Map([['NVDA', 100], ['AAPL', 200]]);
const curB = new Map([['NVDA', new Map([['A', { name: 'Alpha', shares: 1200 }]])], ['AAPL', new Map([['A', { name: 'Alpha', shares: 10 }]])]]);
const prevB = new Map([['NVDA', new Map([['A', { name: 'Alpha', shares: 1000 }]])], ['AAPL', new Map([['A', { name: 'Alpha', shares: 50 }]])], ['MSFT', new Map([['A', { name: 'Alpha', shares: 5 }]])]]);
px.set('MSFT', 400);
const opts = { keyOf: (k) => k, sharesOf: (h) => h.shares, valueOf: (sym, h) => h.shares * px.get(sym), meta: (k, h) => ({ name: h.name, asOf: '2026-06-30' }), priceOf: (sym) => px.get(sym) };
const book = HB.finish([...HB.invert(curB, prevB, opts).values()][0]);
// bought: NVDA +200 x 100 = 20,000. sold: AAPL -40 x 200 = 8,000, MSFT exit 5 x 400 = 2,000.
check('bought at one price', near(book.bought, 20000), book.bought);
check('sold, the exit included', near(book.sold, 10000), book.sold);
const noPrev = HB.finish([...HB.invert(curB, null, opts).values()][0]);
check('no earlier period: null, not zero', noPrev.bought === null && noPrev.sold === null);
// The price moving is not buying: the same shares at any price buy nothing.
const steady = HB.finish([...HB.invert(new Map([['NVDA', new Map([['A', { name: 'Alpha', shares: 1000 }]])]]), new Map([['NVDA', new Map([['A', { name: 'Alpha', shares: 1000 }]])]]), opts).values()][0]);
check('same shares, no buying or selling', steady.bought === 0 && steady.sold === 0);

// ---- the holders decide whether a listed factor changed the share count ----
const holders = (pairs) => new Map(pairs.map(([id, sh]) => [id, { name: id, shares: sh }]));
const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
const curK = new Map([['KLAC', holders(ids.map((id, i) => [id, (i + 1) * 100]))], ['FDX', holders(ids.map((id, i) => [id, (i + 1) * 10]))]]);
const prevK = new Map([['KLAC', holders(ids.map((id, i) => [id, (i + 1) * 10]))], ['FDX', holders(ids.map((id, i) => [id, (i + 1) * 10]))]]);
const listed = new Map([['KLAC', [{ d: '2026-06-12', f: 10 }]], ['FDX', [{ d: '2026-06-01', f: 1.241 }]]]);
const conf = S.confirmed(curK, prevK, listed, () => ['2026-03-31', '2026-06-30']);
check('a real 10-for-1 is confirmed', conf.splits.has('KLAC'), conf.report);
check('a spin-off factor is not', !conf.splits.has('FDX'), conf.report);
// A factor close to 1 with unchanged counts: within 15% of both, so the
// nearer-than-1 rule must refuse it (S&P Global 1.057, Unilever 0.888).
const nearOne = S.confirmed(new Map([['SPGI', holders(ids.map((id, i) => [id, (i + 1) * 10]))], ['UL', holders(ids.map((id, i) => [id, (i + 1) * 10]))]]),
  new Map([['SPGI', holders(ids.map((id, i) => [id, (i + 1) * 10]))], ['UL', holders(ids.map((id, i) => [id, (i + 1) * 10]))]]),
  new Map([['SPGI', [{ d: '2026-05-01', f: 1.057 }]], ['UL', [{ d: '2026-05-01', f: 0.888 }]]]), () => ['2026-03-31', '2026-06-30']);
check('a near-1 factor with unchanged counts is refused', !nearOne.splits.has('SPGI') && !nearOne.splits.has('UL'), nearOne.report);
// A real small split still passes: 3-for-2 with counts up 50%.
const threeTwo = S.confirmed(new Map([['X', holders(ids.map((id, i) => [id, (i + 1) * 15]))]]), new Map([['X', holders(ids.map((id, i) => [id, (i + 1) * 10]))]]),
  new Map([['X', [{ d: '2026-05-01', f: 1.5 }]]]), () => ['2026-03-31', '2026-06-30']);
check('a real 3-for-2 still passes', threeTwo.splits.has('X'), threeTwo.report);
const few = S.confirmed(new Map([['X', holders([['a', 20]])]]), new Map([['X', holders([['a', 10]])]]), new Map([['X', [{ d: '2026-05-01', f: 2 }]]]), () => ['2026-03-31', '2026-06-30']);
check('too few holders in both: not applied', !few.splits.has('X'));

// ---- only managers that filed in both quarters ----
const c2 = holders([['A', 100], ['LATE', 500]]);
const p2 = holders([['A', 100], ['GONE', 300]]);
const filers = { prev: new Set(['A', 'GONE']), cur: new Set(['A', 'LATE']) };
const s2 = I.summarise(c2, p2, 0, 15, filers);
check('a manager absent from last quarter\'s set is not a buyer', !s2.buyers.some((m) => m.cik === 'LATE'), s2.buyers);
check('a manager absent from this quarter\'s set is not a seller', !s2.sellers.some((m) => m.cik === 'GONE'), s2.sellers);
const filers2 = { prev: new Set(['A', 'GONE', 'LATE']), cur: new Set(['A', 'LATE', 'GONE']) };
const s3 = I.summarise(c2, p2, 0, 15, filers2);
check('one that filed both quarters still counts', s3.buyers.some((m) => m.cik === 'LATE') && s3.sellers.some((m) => m.cik === 'GONE'));
// A new listing: no holders last quarter at all, no lists.
const s4 = I.summarise(holders([['A', 100]]), new Map(), 0, 15, filers);
check('a new listing has no buyers or sellers', s4.buyers === null && s4.sellers === null);

// ---- a holder's book: a new listing and a missing filing are not trades ----
const pxB = new Map([['OLD', 10], ['IPO', 50]]);
const curL = new Map([['OLD', new Map([['H', { name: 'H', shares: 100 }]])], ['IPO', new Map([['H', { name: 'H', shares: 1000 }]])]]);
const prevL = new Map([['OLD', new Map([['H', { name: 'H', shares: 100 }]])]]);
const o2 = { keyOf: (k) => k, sharesOf: (h) => h.shares, valueOf: (sym, h) => h.shares * pxB.get(sym), meta: (k, h) => ({ name: h.name }), priceOf: (sym) => pxB.get(sym) };
const bL = HB.finish([...HB.invert(curL, prevL, o2).values()][0]);
check('a new listing is not bought', bL.bought === 0 && bL.added === 0, [bL.bought, bL.added]);
const curN = new Map([['OLD', new Map([['NEWFILER', { name: 'N', shares: 100 }], ['H', { name: 'H', shares: 100 }]])]]);
const books = HB.invert(curN, prevL, o2);
const bN = HB.finish(books.get('NEWFILER'));
check('a holder with no earlier report is not compared', bN.bought === null && bN.added === null, [bN.bought, bN.added]);

// ---- the What changed card's inputs: last period's shares, one price, exits valued ----
const pxC = new Map([['UP', 10], ['GO', 20], ['NEW', 5]]);
const curC = new Map([['UP', new Map([['H', { name: 'H', shares: 150 }]])], ['NEW', new Map([['H', { name: 'H', shares: 40 }]])]]);
const prevC = new Map([['UP', new Map([['H', { name: 'H', shares: 100 }]])], ['GO', new Map([['H', { name: 'H', shares: 30 }]])], ['NEW', new Map([['X', { name: 'X', shares: 1 }]])]]);
const oC = { keyOf: (k) => k, sharesOf: (h) => h.shares, valueOf: (sym, h) => h.shares * pxC.get(sym), meta: (k, h) => ({ name: h.name }), priceOf: (sym) => pxC.get(sym) };
const bC = HB.finish([...HB.invert(curC, prevC, oC).values()][0]);
check('an exit stores its period price', JSON.stringify(bC.data.gone) === JSON.stringify([['GO', 30, 20]]), bC.data.gone);
const rowC = (s) => ({ name: s, price: 99 });
const vC = HB.view(bC, rowC);
const up = vC.positions.find((p) => p.symbol === 'UP'), nw = vC.positions.find((p) => p.symbol === 'NEW');
check('a position carries last period and its price', up.prev === 100 && up.px === 10 && nw.prev === 0, [up.prev, up.px, nw.prev]);
check('the card adds up to the stored bought', (up.shares - up.prev) * up.px + (nw.shares - nw.prev) * nw.px === bC.bought, bC.bought);
check('an exit is valued at its period price, not the latest', vC.gone[0].value === 600 && vC.gone[0].pxLatest === false && bC.sold === 600, vC.gone);
const vOld = HB.view(Object.assign({}, bC, { data: { pos: bC.data.pos, gone: [['GO', 30]] } }), rowC);
check('an exit stored without a price falls back to the latest close, flagged', vOld.gone[0].value === 30 * 99 && vOld.gone[0].pxLatest === true, vOld.gone);
const vNone = HB.view(Object.assign({}, bC, { data: { pos: bC.data.pos, gone: [['GO', 30]] } }), (s) => ({ name: s }));
check('no price anywhere leaves the exit unvalued, not zero', vNone.gone[0].value === null, vNone.gone);

console.log(ran + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
