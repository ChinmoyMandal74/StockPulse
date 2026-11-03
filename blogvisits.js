// BLOG VISITORS (2026-11-03, the owner: "Create a page to understand blog
// visitors, Ignore admin and Meta crawlers"). The admin page /blog-visitors,
// read from the activity log's blog rows (kind 'page', detail 'blog' for the
// index or 'post:<slug>'), which keep about 60 days (pruneActivity).
//
// Two kinds of view are left out before anything is counted:
//
//   THE ADMIN. A view by an admin account ('admin' and 'open' for the password
//   cookie and open mode), and every view from an address an admin account has
//   used in the log, signed in or not. The second matters more: on the first
//   count 159 of the owner's 265 views were signed out, from the same address.
//
//   META'S CRAWLERS. Instagram and Facebook fetch a page when its link is
//   posted or opened in their apps, from Meta's own network (AS32934). The log
//   holds no browser string, so the test is the address against Meta's
//   published ranges, META_V4 below.
//
// And one pattern no reader makes: an address opening five different posts in
// ten minutes (SWEEPS, below). Other crawlers cannot be told apart and are
// counted; the page says so.
//
// A visitor is an address. Pure: server.js reads the rows (db.js
// readBlogVisitLog) and the post titles; blogvisits-test.js.
'use strict';

// Meta Platforms' IPv4 announcements (AS32934), the ranges its link-preview
// and crawler agents come from. 57.141.0.0/16 is the newer crawler range.
const META_V4 = [
  '31.13.24.0/21', '31.13.64.0/18', '45.64.40.0/22', '57.141.0.0/16', '66.220.144.0/20',
  '69.63.176.0/20', '69.171.224.0/19', '74.119.76.0/22', '102.132.96.0/20', '103.4.96.0/22',
  '129.134.0.0/16', '147.75.208.0/20', '157.240.0.0/16', '163.70.128.0/17', '163.77.128.0/17',
  '173.252.64.0/18', '179.60.192.0/22', '185.60.216.0/22', '185.89.216.0/22', '199.201.64.0/22',
  '204.15.20.0/22',
];
const META_V6 = ['2a03:2880:', '2a03:83e0:'];
const ADMIN_KEYS = ['admin', 'open'];

const v4num = (ip) => {
  const m = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(String(ip || '').trim());
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
};
const RANGES = META_V4.map((c) => {
  const [a, bits] = c.split('/');
  const n = Number(bits);
  const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
  return { base: (v4num(a) & mask) >>> 0, mask };
});
function isMeta(ip) {
  const s = String(ip || '').trim().toLowerCase();
  if (!s) return false;
  const n = v4num(s);
  if (n != null) return RANGES.some((r) => ((n & r.mask) >>> 0) === r.base);
  return META_V6.some((p) => s.startsWith(p));
}

// The last part of an address hidden: enough to tell visitors apart on the page.
const maskIp = (ip) => {
  const s = String(ip || '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return s.replace(/\.\d+$/, '.x');
  return s ? s.replace(/:[0-9a-f]*:[0-9a-f]*$/i, ':x') : '—';
};
const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const etDay = (ts) => ET.format(new Date(ts));
const whoOf = (user) => (!user ? 'anonymous' : /^guest-/.test(user) ? 'guest' : 'member');
const pageOf = (detail) => (detail === 'blog' ? '' : String(detail || '').replace(/^post:/, ''));

// SWEEPS. On the first look the deleted test posts each had about thirty
// "visitors", nearly the same number apiece: crawlers (Google's, Anthropic's,
// OpenAI's, cloud hosts) opening every post in a minute. An address that opens
// SWEEP_POSTS or more different posts within SWEEP_MS is left out whole, and
// counted as such. Slower crawlers still pass; the page says so.
const SWEEP_POSTS = 5;
const SWEEP_MS = 10 * 60 * 1000;
function sweepIps(rows) {
  const by = new Map();
  for (const v of rows) {
    if (!v.page) continue;
    if (!by.has(v.ip)) by.set(v.ip, []);
    by.get(v.ip).push({ t: Date.parse(v.ts), page: v.page });
  }
  const out = new Set();
  for (const [ip, L] of by) {
    L.sort((a, b) => a.t - b.t);
    for (let i = 0; i < L.length && !out.has(ip); i++) {
      const seen = new Set();
      for (let j = i; j < L.length && L[j].t - L[i].t <= SWEEP_MS; j++) seen.add(L[j].page);
      if (seen.size >= SWEEP_POSTS) out.add(ip);
    }
  }
  return out;
}

// views: [{ ts, user, detail, ip }]; adminUsers: account emails with the admin
// role; adminIps: every address those accounts (and ADMIN_KEYS) have used;
// posts: [{ slug, title, status }]; now: ms. Returns what the page draws.
function summarize({ views, adminUsers, adminIps, posts, now }) {
  const admins = new Set([...(adminUsers || []), ...ADMIN_KEYS].map((x) => String(x).toLowerCase()));
  const aIps = new Set((adminIps || []).filter(Boolean).map(String));
  const excluded = { admin: 0, adminAddress: 0, meta: 0, sweep: 0, sweepAddresses: 0 };
  const cand = [];
  for (const v of views || []) {
    if (!v || !v.ts) continue;
    const user = v.user == null ? '' : String(v.user);
    const ip = String(v.ip || '');
    if (user && admins.has(user.toLowerCase())) { excluded.admin++; continue; }
    if (ip && aIps.has(ip)) { excluded.adminAddress++; continue; }
    if (isMeta(ip)) { excluded.meta++; continue; }
    cand.push({ ts: String(v.ts), day: etDay(v.ts), who: whoOf(user), page: pageOf(v.detail), ip: ip || 'unknown' });
  }
  cand.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const sweeps = sweepIps(cand);
  excluded.sweepAddresses = sweeps.size;
  const kept = cand.filter((v) => (sweeps.has(v.ip) ? (excluded.sweep++, false) : true));

  const today = etDay(now || Date.now());
  const ago = (n) => etDay((now || Date.now()) - n * 86400000);
  const d7 = ago(6), d30 = ago(29);

  // Per visitor: their days, the posts they read, who they were.
  const byIp = new Map();
  for (const v of kept) {
    let e = byIp.get(v.ip);
    if (!e) byIp.set(v.ip, (e = { views: 0, days: new Set(), posts: new Set(), who: new Set(), first: v.ts, last: v.ts }));
    e.views++; e.days.add(v.day); e.who.add(v.who); e.last = v.ts;
    if (v.page) e.posts.add(v.page);
  }
  const visitors = [...byIp.values()];
  const depth = { 0: 0, 1: 0, 2: 0, '3+': 0 };
  for (const e of visitors) depth[e.posts.size >= 3 ? '3+' : e.posts.size]++;

  const span = (since) => {
    const L = kept.filter((v) => v.day >= since);
    return { views: L.length, visitors: new Set(L.map((v) => v.ip)).size };
  };

  // Day by day from the first kept view (or the first day of the log) to today, gaps as zero.
  const daily = [];
  const first = kept.length ? kept[0].day : today;
  const perDay = new Map();
  for (const v of kept) {
    let e = perDay.get(v.day);
    if (!e) perDay.set(v.day, (e = { views: 0, ips: new Set(), newIps: 0 }));
    e.views++; e.ips.add(v.ip);
  }
  for (const e of visitors) { const d = etDay(e.first); if (perDay.has(d)) perDay.get(d).newIps++; }
  for (let t = Date.parse(first + 'T12:00:00Z'); ; t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (d > today) break;
    const e = perDay.get(d);
    daily.push({ day: d, views: e ? e.views : 0, visitors: e ? e.ips.size : 0, newVisitors: e ? e.newIps : 0 });
  }

  // Per page: the index first, then published posts by visitors, then the
  // unpublished and deleted ones (test posts, mostly, read by crawlers).
  const RANK = { published: 0, draft: 1, gone: 2 };
  const titles = new Map((posts || []).map((p) => [String(p.slug), p]));
  const perPage = new Map();
  for (const v of kept) {
    let e = perPage.get(v.page);
    if (!e) perPage.set(v.page, (e = { views: 0, ips: new Set(), ips7: new Set(), first: v.ts, last: v.ts }));
    e.views++; e.ips.add(v.ip); e.last = v.ts;
    if (v.day >= d7) e.ips7.add(v.ip);
  }
  const pages = [...perPage.entries()].map(([slug, e]) => {
    const p = slug ? titles.get(slug) : null;
    return {
      slug, index: !slug,
      title: !slug ? 'Blog index' : p ? p.title : slug,
      status: !slug ? 'published' : p ? p.status : 'gone',
      views: e.views, visitors: e.ips.size, visitors7: e.ips7.size, first: e.first, last: e.last,
    };
  }).sort((a, b) => (b.index - a.index) || ((RANK[a.status] ?? 1) - (RANK[b.status] ?? 1)) || (b.visitors - a.visitors) || (b.views - a.views));

  const who = { anonymous: 0, guest: 0, member: 0 };
  for (const v of kept) who[v.who]++;

  const recent = kept.slice(-60).reverse().map((v) => {
    const p = v.page ? titles.get(v.page) : null;
    return { ts: v.ts, page: v.page, title: !v.page ? 'Blog index' : p ? p.title : v.page, who: v.who, ip: maskIp(v.ip) };
  });

  return {
    from: kept.length ? kept[0].ts : null,
    to: kept.length ? kept[kept.length - 1].ts : null,
    totals: { views: kept.length, visitors: byIp.size, returning: visitors.filter((e) => e.days.size >= 2).length },
    last7: span(d7), last30: span(d30),
    excluded, who, depth, daily, pages, recent,
  };
}

module.exports = { summarize, isMeta, maskIp, etDay, sweepIps, META_V4, META_V6, ADMIN_KEYS, SWEEP_POSTS, SWEEP_MS };
