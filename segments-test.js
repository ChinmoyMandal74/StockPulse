// segments.js: the shapes a revenue breakdown arrives in, on small made-up
// instances. (2026-10-26: written with the two new shapes, so the old ones are
// pinned down beside them.)
//   node segments-test.js
'use strict';
const S = require('./segments.js');
let ran = 0, failed = 0;
const check = (m, c, x) => { ran++; if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x).slice(0, 300)); } };

// A tiny instance: contexts from [id, dims], facts from [concept, ctx, value].
let n = 0;
function inst(facts) {
  const ctxs = new Map();
  const ctxId = (dims, year) => {
    const key = (year || 2025) + '|' + dims.map((d) => d.join('=')).join('&');
    if (!ctxs.has(key)) ctxs.set(key, { id: 'c' + (++n), dims, year: year || 2025 });
    return ctxs.get(key).id;
  };
  const body = facts.map(([concept, dims, v, year]) => `<${concept} contextRef="${ctxId(dims, year)}" unitRef="${/Percentage/.test(concept) ? 'pure' : 'usd'}" decimals="-6">${v}</${concept}>`).join('\n');
  const head = [...ctxs.values()].map((c) => `<xbrli:context id="${c.id}"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier>`
    + (c.dims.length ? '<xbrli:segment>' + c.dims.map(([a, m]) => `<xbrldi:explicitMember dimension="${a}">${m}</xbrldi:explicitMember>`).join('') + '</xbrli:segment>' : '')
    + `</xbrli:entity><xbrli:period><xbrli:startDate>${c.year}-01-01</xbrli:startDate><xbrli:endDate>${c.year}-12-31</xbrli:endDate></xbrli:period></xbrli:context>`).join('\n');
  return `<xbrli:xbrl>${head}\n<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>\n${body}</xbrli:xbrl>`;
}
const REV = 'us-gaap:Revenues';
const SEG = 'us-gaap:StatementBusinessSegmentsAxis', PROD = 'srt:ProductOrServiceAxis', GEO = 'srt:StatementGeographicalAxis';
const CONS = 'srt:ConsolidationItemsAxis';
const first = (xml) => S.periods(xml, '', 'FY')[0] || null;
const parts = (K) => K.members.filter((m) => !m.subtotal).map((m) => m.key.split(':')[1] + ' ' + Math.round(m.v / K.total * 100)).join(', ');

// 1. The plain shape: segments on their own axis.
{
  const p = first(inst([[REV, [], 1000], [REV, [[SEG, 'x:AMember']], 600], [REV, [[SEG, 'x:BMember']], 400]]));
  check('one axis alone: read as before', p && parts(p.kinds.segment) === 'AMember 60, BMember 40' && p.kinds.segment.complete && !p.kinds.segment.fromShare, p);
}
// 2. Segment x operating segments (the newer disclosure).
{
  const p = first(inst([[REV, [], 1000], [REV, [[CONS, 'srt:OperatingSegmentsMember'], [SEG, 'x:AMember']], 700], [REV, [[CONS, 'srt:OperatingSegmentsMember'], [SEG, 'x:BMember']], 300],
    [REV, [[CONS, 'us-gaap:IntersegmentEliminationMember'], [SEG, 'x:AMember']], -50]]));
  check('segment x operating segments: read as segments', p && parts(p.kinds.segment) === 'AMember 70, BMember 30' && p.kinds.segment.complete, p && p.kinds);
}
// 3. Eliminations alone on the second axis are not a breakdown.
{
  const p = first(inst([[REV, [], 1000], [REV, [[CONS, 'us-gaap:IntersegmentEliminationMember'], [SEG, 'x:AMember']], 50], [REV, [[CONS, 'us-gaap:IntersegmentEliminationMember'], [SEG, 'x:BMember']], 40]]));
  check('segment x eliminations: not read', p === null || !p.kinds.segment, p && p.kinds);
}
// 4. Netflix's shape: one region alone, and four regions x one product.
{
  const p = first(inst([[REV, [], 1000], [REV, [[GEO, 'country:US']], 440],
    ...[['x:UcanMember', 440], ['x:EmeaMember', 320], ['x:LatamMember', 120], ['x:ApacMember', 120]].map(([m, v]) => [REV, [[PROD, 'x:StreamingMember'], [GEO, m]], v])]));
  check('a lone region beside regions x one product: the four regions', p && p.kinds.geo && parts(p.kinds.geo) === 'UcanMember 44, EmeaMember 32, LatamMember 12, ApacMember 12', p && p.kinds);
  check('...and the product axis, one member throughout, is no breakdown', p && !p.kinds.product, p && p.kinds);
}
// 5. A second axis that is neither (a customer) is not collapsed.
{
  const p = first(inst([[REV, [], 1000], [REV, [['srt:MajorCustomersAxis', 'x:BigCoMember'], [SEG, 'x:AMember']], 300], [REV, [['srt:MajorCustomersAxis', 'x:BigCoMember'], [SEG, 'x:BMember']], 200]]));
  check('segment x a customer: not read', p === null || !p.kinds.segment, p && p.kinds);
}
// 6. Ross's shape: shares of revenue only.
const pct = (member, v, extra) => ['us-gaap:ConcentrationRiskPercentage1', [[PROD, member], ['us-gaap:ConcentrationRiskByBenchmarkAxis', 'us-gaap:RevenueFromContractWithCustomerProductAndServiceBenchmarkMember'], ['us-gaap:ConcentrationRiskByTypeAxis', 'us-gaap:ProductConcentrationRiskMember']].concat(extra || []), v];
{
  const p = first(inst([[REV, [], 2000], pct('x:HomeMember', 0.26), pct('x:LadiesMember', 0.22), pct('x:MensMember', 0.15), pct('x:AccMember', 0.15), pct('x:ShoesMember', 0.13), pct('x:KidsMember', 0.09)]));
  const K = p && p.kinds.product;
  check('shares only: a product breakdown marked fromShare', K && K.fromShare && K.complete && parts(K) === 'HomeMember 26, LadiesMember 22, MensMember 15, AccMember 15, ShoesMember 13, KidsMember 9', p && p.kinds);
  check('shares: the amounts are the shares of the total, for ordering only', K && Math.round(K.members[0].v) === 520 && K.members[0].share === 0.26);
  const p2 = first(inst([[REV, [], 2000], pct('x:HomeMember', 26), pct('x:LadiesMember', 74)]));
  check('a share written as a percent is divided by 100', p2 && p2.kinds.product && Math.round(p2.kinds.product.members[1].v) === 520, p2 && p2.kinds);
}
// 7. Shares never replace amounts, and a share on a non-revenue benchmark is ignored.
{
  const p = first(inst([[REV, [], 1000], [REV, [[PROD, 'x:AMember']], 800], [REV, [[PROD, 'x:BMember']], 200], pct('x:AMember', 0.5), pct('x:BMember', 0.5)]));
  check('amounts on the axis win over shares', p && !p.kinds.product.fromShare && parts(p.kinds.product) === 'AMember 80, BMember 20', p && p.kinds);
  const cust = (m, v) => ['us-gaap:ConcentrationRiskPercentage1', [[PROD, m], ['us-gaap:ConcentrationRiskByBenchmarkAxis', 'us-gaap:AccountsReceivableBenchmarkMember']], v];
  const p2 = first(inst([[REV, [], 1000], cust('x:AMember', 0.6), cust('x:BMember', 0.4)]));
  check('a share of receivables is not a share of revenue', p2 === null || !p2.kinds.product, p2 && p2.kinds);
  const p3 = first(inst([[REV, [], 1000], pct('x:AMember', 0.6, [[GEO, 'country:US']]), pct('x:BMember', 0.4, [[GEO, 'country:US']])]));
  check('a share tagged on another breakdown too is not read', p3 === null || !p3.kinds.product, p3 && p3.kinds);
}
// 8. Names: a label escaped twice in its file.
check('a doubly escaped label reads clean', S.nameOf('u:H', { u_H: 'Haircare Products &amp;amp; Styling Tools [Member]' }) === 'Haircare Products & Styling Tools');

console.log(`${ran} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
