// blogvisits.js: the admin and Meta's crawlers left out, then the counts.
// Pure.   node blogvisits-test.js
'use strict';
const B = require('./blogvisits.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };

// ---- Meta's ranges.
ok(B.isMeta('173.252.107.4') && B.isMeta('57.141.0.12') && B.isMeta('69.171.250.1') && B.isMeta('31.13.115.2'), 'Meta addresses are Meta');
ok(B.isMeta('::ffff:173.252.87.10') && B.isMeta('2a03:2880:f12f::1'), 'mapped IPv4 and Meta IPv6 too');
ok(!B.isMeta('173.252.63.255') && !B.isMeta('173.252.128.0'), 'just outside 173.252.64.0/18 is not');
ok(!B.isMeta('68.132.245.10') && !B.isMeta('8.8.8.8') && !B.isMeta('') && !B.isMeta(null) && !B.isMeta('999.1.1.1'), 'others, blanks and nonsense are not');
ok(B.maskIp('68.132.245.10') === '68.132.245.x', 'the last part is hidden');

// ---- The exclusions.
const NOW = Date.parse('2026-11-03T18:00:00Z');
const at = (d, h = 15) => d + 'T' + String(h).padStart(2, '0') + ':00:00.000Z';
const views = [
  { ts: at('2026-11-03'), user: 'owner@x.test', detail: 'post:a', ip: '1.1.1.1' },     // admin account
  { ts: at('2026-11-03'), user: null, detail: 'post:a', ip: '1.1.1.1' },               // admin's address, signed out
  { ts: at('2026-11-03'), user: 'ADMIN', detail: 'blog', ip: '9.9.9.9' },             // password cookie (case)
  { ts: at('2026-11-02'), user: null, detail: 'post:a', ip: '173.252.70.1' },          // Meta
  { ts: at('2026-11-02'), user: null, detail: 'post:a', ip: '57.141.3.4' },            // Meta
  { ts: at('2026-10-20'), user: null, detail: 'blog', ip: '2.2.2.2' },
  { ts: at('2026-10-20'), user: null, detail: 'post:a', ip: '2.2.2.2' },
  { ts: at('2026-11-02'), user: null, detail: 'post:b', ip: '2.2.2.2' },
  { ts: at('2026-11-02'), user: null, detail: 'post:c', ip: '2.2.2.2' },
  { ts: at('2026-11-03'), user: 'guest-abc', detail: 'post:a', ip: '3.3.3.3' },
  { ts: at('2026-11-03'), user: 'reader@x.test', detail: 'post:gone', ip: '4.4.4.4' },
  // 02:00 UTC on Nov 3 is still Nov 2 in New York.
  { ts: '2026-11-03T02:00:00.000Z', user: null, detail: 'blog', ip: '5.5.5.5' },
];
const posts = [{ slug: 'a', title: 'Post A', status: 'published' }, { slug: 'b', title: 'Post B', status: 'draft' }, { slug: 'c', title: 'Post C', status: 'published' }];
const s = B.summarize({ views, adminUsers: ['owner@x.test'], adminIps: ['1.1.1.1'], posts, now: NOW });
ok(s.excluded.admin === 2 && s.excluded.adminAddress === 1 && s.excluded.meta === 2, 'admin account, admin address and Meta each counted out', s.excluded);
ok(s.totals.views === 7 && s.totals.visitors === 4, 'seven views from four addresses remain', s.totals);
ok(s.totals.returning === 1, 'one visitor came back on another day');
ok(s.who.anonymous === 5 && s.who.guest === 1 && s.who.member === 1, 'anonymous, guest and member', s.who);
ok(s.depth[0] === 1 && s.depth[1] === 2 && s.depth['3+'] === 1, 'posts read per visitor', s.depth);
ok(s.last7.visitors === 4 && s.last7.views === 5 && s.last30.views === 7, 'the last 7 and 30 days', [s.last7, s.last30]);

// ---- Pages.
ok(s.pages[0].index && s.pages[0].title === 'Blog index' && s.pages[0].visitors === 2, 'the index comes first');
const A = s.pages.find((p) => p.slug === 'a');
ok(A && A.title === 'Post A' && A.views === 2 && A.visitors === 2 && A.visitors7 === 1, 'a post: its title, views and visitors', A);
ok(s.pages.map((p) => p.slug).join() === ',a,c,b,gone', 'published posts before unpublished, before deleted', s.pages.map((p) => p.slug));
ok(s.pages.find((p) => p.slug === 'b').status === 'draft' && s.pages.find((p) => p.slug === 'gone').status === 'gone', 'unpublished and deleted posts are marked');

// ---- Days.
const day = (d) => s.daily.find((x) => x.day === d);
ok(s.daily[0].day === '2026-10-20' && s.daily[s.daily.length - 1].day === '2026-11-03', 'from the first view to today');
ok(day('2026-10-21').views === 0 && s.daily.length === 15, 'days without a view are there as zero');
ok(day('2026-11-02').views === 3 && day('2026-11-02').visitors === 2 && day('2026-11-02').newVisitors === 1, 'Eastern days; a returning visitor is not new', day('2026-11-02'));
ok(s.recent[0].ip.endsWith('.x') && s.recent.length === 7 && !s.recent.some((r) => r.ip.startsWith('1.1.1') || r.ip.startsWith('173.252')), 'the recent list is masked and excludes the same');

// ---- Sweeps: five different posts in ten minutes.
const sweep = ['p1', 'p2', 'p3', 'p4', 'p5'].map((p, i) => ({ ts: '2026-11-03T15:0' + i + ':00.000Z', user: null, detail: 'post:' + p, ip: '6.6.6.6' }));
const slow = ['p1', 'p2', 'p3', 'p4', 'p5'].map((p, i) => ({ ts: '2026-11-03T1' + i + ':00:00.000Z', user: null, detail: 'post:' + p, ip: '7.7.7.7' }));
const four = ['p1', 'p2', 'p3', 'p4', 'p4', 'p4'].map((p, i) => ({ ts: '2026-11-03T15:0' + i + ':00.000Z', user: null, detail: 'post:' + p, ip: '8.8.4.4' }));
const idx = [0, 1, 2, 3, 4, 5].map((i) => ({ ts: '2026-11-03T15:0' + i + ':00.000Z', user: null, detail: i % 2 ? 'blog' : 'post:p' + i, ip: '9.9.4.4' }));
const sw = B.summarize({ views: views.concat(sweep, slow, four, idx), adminUsers: ['owner@x.test'], adminIps: ['1.1.1.1'], posts, now: NOW });
ok(sw.excluded.sweep === 5 && sw.excluded.sweepAddresses === 1, 'five posts in five minutes is a sweep, left out whole', sw.excluded);
ok(sw.totals.visitors === s.totals.visitors + 3, 'five posts over five hours, four posts, or the index between three posts are not', sw.totals);
ok(B.sweepIps(sweep.map((v) => ({ ts: v.ts, page: v.detail.slice(5), ip: v.ip }))).has('6.6.6.6'), 'the helper on its own');

const empty = B.summarize({ views: [], adminUsers: [], adminIps: [], posts: [], now: NOW });
ok(empty.totals.views === 0 && empty.daily.length === 1 && empty.from === null, 'nothing logged is an empty page, not an error');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
