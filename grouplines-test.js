// grouplines.js on fixtures. node grouplines-test.js
'use strict';
const G = require('./grouplines.js');
let n = 0, bad = 0;
const ok = (c, m, x) => { n++; if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-6;
const Q = ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'];
const co = (symbol, body, quarters) => ({ symbol, quarters: quarters || Q, body });
const A = co('A', { rev: [100, 110, 120, 130, 140, 150], gp: [40, 44, 48, 52, 56, 60], oi: [10, 11, 12, 13, 14, 15], ni: [8, 9, 10, 11, 12, 13], fcf: [5, 5, 5, 5, 5, 5], cap: [800, 900, 1000, 1100, 1200, 1300], px: [10, 11, 12, 13, 14, 15] });
const B = co('B', { rev: [200, 200, 200, 200, 200, 220], gp: [50, 50, 50, 50, 50, 55], oi: [20, 20, 20, 20, 20, 22], ni: [-10, -10, 5, 5, 5, 6], fcf: [1, 2, 3, 4, 5, 6], cap: [1000, 1000, 1000, 1000, 1000, 1100], px: [20, 20, 22, 24, 20, 30] });
const C = co('C', { rev: [50, 55, 60, 65, 70, 75], gp: [25, 27, 30, 32, 35, 37], oi: [5, 5, 6, 6, 7, 7], ni: [4, 4, 5, 5, 6, 6], fcf: [2, 2, 2, 2, 2, 2], cap: [500, 500, 600, 600, 700, 700], px: [5, 5, 6, 6, 7, 10] });
// D files only from the third quarter: it must not join a sum part-way.
const D = co('D', { rev: [null, null, 1000, 1000, 1000, 1000], gp: [null, null, 1, 1, 1, 1], oi: [null, null, 1, 1, 1, 1], ni: [null, null, 1, 1, 1, 1], fcf: [null, null, 1, 1, 1, 1], cap: [null, null, 9e3, 9e3, 9e3, 9e3], px: [null, null, 1, 1, 1, 1] });
const W = [A, B, C, D];

let r = G.aggregate(W, Q, 'rev');
ok(r.used === 3 && r.of === 4, 'a company without every quarter is left out of a sum', r);
ok(near(r.values[0], 350) && near(r.values[5], 445), 'revenue: the sum of the same three each quarter', r.values);
r = G.aggregate(W, Q.slice(2), 'rev');
ok(r.used === 4 && near(r.values[0], 1380), 'over a window D covers, it is in', r);
r = G.aggregate(W, Q, 'ni');
ok(near(r.values[0], 2) && near(r.values[2], 20), 'net income sums losses and profits', r.values);
r = G.aggregate(W, Q, 'pm');
ok(near(r.values[0], 0.57) && near(r.values[5], Math.round(25 / 445 * 10000) / 100), 'profit margin: summed income over summed revenue, never an average of margins', r.values);
r = G.aggregate(W, Q, 'gm');
ok(near(r.values[0], Math.round(115 / 350 * 10000) / 100), 'gross margin aggregate', r.values);
r = G.aggregate(W, Q, 'pe');
ok(near(r.values[0], Math.round(2300 / 2 * 100) / 100) && near(r.values[2], Math.round(2600 / 20 * 100) / 100), 'P/E: summed value over summed earnings', r.values);
r = G.aggregate([A, co('X', { cap: [100, 100, 100, 100, 100, 100], ni: [-50, -50, -50, -50, -50, -50] }), co('Y', { cap: [100, 100, 100, 100, 100, 100], ni: [-50, -50, -50, -50, -50, -50] })], Q, 'pe');
ok(r.values[0] === null, 'no P/E when the group’s earnings are not positive', r.values);
r = G.aggregate(W, Q, 'ps');
ok(near(r.values[0], Math.round(2300 / 350 * 100) / 100), 'P/S: summed value over summed revenue', r.values);
r = G.aggregate(W, Q, 'cap');
ok(near(r.values[5], 3100), 'market value sums', r.values);
// Growth needs a year earlier in each member's own list.
r = G.aggregate(W, Q.slice(4), 'rg');
ok(r.used === 3 && near(r.values[0], Math.round((410 / 350 - 1) * 10000) / 100), 'revenue growth: the same companies’ revenue against a year before', r);
r = G.aggregate(W, Q, 'rg');
ok(r.values === null, 'growth over quarters with no year before cannot be drawn', r);
// Share price: the median company's return since the first quarter end.
r = G.aggregate(W, Q, 'px');
ok(r.values[0] === 0 && r.used === 3, 'price starts at 0%, from the companies priced at the first quarter end (D listed later)', r);
// At the last quarter: A 15/10 = 1.5, B 30/20 = 1.5, C 10/5 = 2.0: the median is 1.5.
ok(near(r.values[5], 50), 'price: the median company’s return, not the average', r.values);
// One huge winner moves an average and not the median.
r = G.aggregate([A, B, C, co('W', { px: [1, 1, 1, 1, 1, 100] })], Q, 'px');
ok(near(r.values[5], (1.5 + 2.0) / 2 * 100 - 100), 'a single hundred-bagger does not lead the line (median of four is the middle pair’s mean)', r.values);
r = G.aggregate([A, B, C, co('E', { px: [10, null, null, 20, 20, 20] })], Q, 'px');
// Second quarter: A 1.1, B 1.0, C 1.0, E carried at 10/10 = 1.0: the median is 1.0.
ok(near(r.values[1], 0) && r.used === 4, 'a quarter with no close carries the member’s last', r.values);
ok(G.median([3, 1, 2]) === 2 && G.median([4, 1, 3, 2]) === 2.5 && G.median([]) === null, 'median of odd, even and none');
// Too few companies.
r = G.aggregate([A, B], Q, 'rev');
ok(r.values === null && r.used === 2, 'fewer than three companies: no line', r);
// Members built on different nights: matched by quarter date, not position.
const shifted = co('S', { rev: [999, 100, 110, 120, 130, 140, 150] }, ['2024-12-31'].concat(Q));
r = G.aggregate([shifted, B, C], Q, 'rev');
ok(near(r.values[0], 350), 'quarters matched by date when a member’s list starts earlier', r.values);
// Zero or negative revenue is not a base.
r = G.aggregate([A, B, C, co('Z', { rev: [0, 10, 10, 10, 10, 10], ni: [1, 1, 1, 1, 1, 1] })], Q, 'pm');
ok(r.used === 3, 'a quarter of zero revenue leaves the company out of a margin', r);
ok(G.aggregate(W, Q, 'nope').values === null, 'an unknown measure draws nothing');
console.log(n + ' checks, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
