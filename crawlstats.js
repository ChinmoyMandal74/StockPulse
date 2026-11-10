// The website crawl in figures (website-load.js; docs/context/company-websites.md):
// how far the nationwide list has got, night by night, and what the last night
// did. One set of figures for the local viewer's Crawl page (/crawl) and the
// morning email (crawl-report.js). Reads formd.db and web-archive.db; writes
// nothing. Counts only: no page text.
'use strict';

const HOUR = 3600e3;
const DAY = 24 * HOUR;
// A night is named by the evening it starts: a run from 01:00 to 06:45 on the
// 11th is the night of the 10th (Eastern, the laptop's clock).
const etDate = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t));
const nightOf = (t) => etDate(t - 12 * HOUR);

// The list the nightly task works through (website-task.ps1): employers with
// their own plan, 100 or more staff, filing 2023 or later.
const TARGET_SQL = 'from f5500_latest where staff >= 100 and year >= 2023';

function figures(db, web, opts = {}) {
  const now = opts.now || Date.now();
  const one = (d, sql, ...a) => d.prepare(sql).get(...a);
  const all = (d, sql, ...a) => d.prepare(sql).all(...a);
  const has = (d, t) => !!(d && one(d, "select 1 x from sqlite_master where name = ?", t));
  // The list's size changes only when the plan filings are loaded: a caller may keep it.
  const target = opts.target != null ? opts.target : one(db, 'select count(*) n ' + TARGET_SQL).n;
  const sitesReady = has(db, 'web_sites');
  const verdicts = sitesReady ? all(db, 'select verdict, count(*) n from web_sites group by verdict') : [];
  const v = Object.fromEntries(verdicts.map((r) => [r.verdict, r.n]));
  const tried = verdicts.reduce((a, r) => a + r.n, 0);
  // Driven from the sites tried, a key lookup each (a join scanned the plan table).
  const triedInList = sitesReady ? one(db, 'select count(*) n from web_sites w where exists (select 1 from f5500_latest l where l.ein = w.ein and l.staff >= 100 and l.year >= 2023)').n : 0;
  const reads = has(db, 'web_reads') ? one(db, 'select count(*) n, coalesce(sum(usd), 0) usd from web_reads') : { n: 0, usd: 0 };
  const crawls = has(web, 'crawls') ? one(web, 'select count(distinct ein) sites, coalesce(sum(pages), 0) pages, coalesce(sum(chars), 0) chars from crawls where pages > 0') : { sites: 0, pages: 0, chars: 0 };
  const pages = has(web, 'pages') ? one(web, 'select count(*) n, coalesce(sum(length(text)), 0) chars from pages') : { n: 0, chars: 0 };
  const earlier = has(web, 'pages_history') ? one(web, 'select count(*) n from pages_history').n : 0;

  // Night by night, newest first.
  const nights = new Map();
  const N = (d) => { if (!nights.has(d)) nights.set(d, { night: d, tried: 0, confirmed: 0, nameOnly: 0, none: 0, read: 0, usd: 0, kept: 0, pages: 0, chars: 0, requests: 0, first: null, last: null }); return nights.get(d); };
  const since = opts.since || 0;
  const span = (x, t) => { x.first = x.first == null ? t : Math.min(x.first, t); x.last = x.last == null ? t : Math.max(x.last, t); };
  if (sitesReady) for (const r of all(db, 'select verdict, checked_at t from web_sites where checked_at >= ?', since)) {
    const x = N(nightOf(r.t)); x.tried++; span(x, r.t);
    if (r.verdict === 'confirmed' || r.verdict === 'given') x.confirmed++; else if (r.verdict === 'name only') x.nameOnly++; else x.none++;
  }
  if (has(db, 'web_reads')) for (const r of all(db, 'select at t, usd from web_reads where at >= ?', since)) { const x = N(nightOf(r.t)); x.read++; x.usd += r.usd || 0; }
  if (has(web, 'crawls')) for (const r of all(web, 'select finished_at t, pages, chars from crawls where finished_at >= ? and pages > 0', since)) { const x = N(nightOf(r.t)); x.kept++; x.pages += r.pages; x.chars += r.chars || 0; span(x, r.t); }
  if (has(db, 'web_requests')) for (const r of all(db, "select strftime('%Y-%m-%d %H', at / 1000, 'unixepoch') h, min(at) t, count(*) n from web_requests where at >= ? group by h", since)) N(nightOf(r.t)).requests += r.n;
  const list = [...nights.values()].sort((a, b) => (a.night < b.night ? 1 : -1));

  // The pace: the companies tried a night over the last three nights that did
  // any work, and when the list would be done at that pace.
  const recent = list.filter((x) => x.tried > 0).slice(0, 3);
  const pace = recent.length ? Math.round(recent.reduce((a, x) => a + x.tried, 0) / recent.length) : null;
  const left = Math.max(0, target - triedInList);
  const nightsLeft = pace ? Math.ceil(left / pace) : null;
  const archiveBytes = opts.archiveBytes != null ? opts.archiveBytes : null;

  return {
    at: now, target, triedInList, left, tried,
    confirmed: (v.confirmed || 0) + (v.given || 0), nameOnly: v['name only'] || 0, none: v['none found'] || 0,
    read: reads.n, usd: reads.usd, kept: crawls.sites, keptPages: crawls.pages, keptChars: crawls.chars,
    pages: pages.n, pageChars: pages.chars, earlierVersions: earlier, archiveBytes,
    pace, nightsLeft, finish: nightsLeft != null ? etDate(now + nightsLeft * DAY) : null,
    nights: list,
  };
}

// The run's own words from the end of its log: the last "done:" line and the
// reason it stopped, if it said one.
function lastRun(logText) {
  const lines = String(logText || '').split(/\r?\n/).filter(Boolean);
  let i = -1;
  for (let k = lines.length - 1; k >= 0; k--) if (/^done: /.test(lines[k])) { i = k; break; }
  if (i < 0) return null;
  const stop = i > 0 && /minutes up|cap|GB|stopped|no answer/.test(lines[i - 1]) ? lines[i - 1] : null;
  return { done: lines[i].slice(0, 400), stop: stop ? stop.slice(0, 300) : null };
}

module.exports = { figures, lastRun, nightOf, etDate, TARGET_SQL };
