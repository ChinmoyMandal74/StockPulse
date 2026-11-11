// Company websites: find a private company's own site and read what it says
// about itself (backlog 61, E17; rules websites.js, notes
// docs/context/company-websites.md). LOCAL, BY HAND; nothing schedules it.
//
// FINDING THE SITE. No file gives the address, so it is guessed from the name
// (websites.js candidates), each guess looked up in DNS first (no request to
// anyone's site), and only an address that answers is visited: robots.txt,
// then the home page. The site is the company's when its pages carry its
// name and its city or the telephone on file ("confirmed"); the name alone is
// "name only". At most MAX_TRIES addresses are visited a company.
//
// READING IT. A confirmed site's pages (websites.js pickPages, MAX_PAGES at
// most), each only where robots.txt allows, are read by Claude Haiku into
// facts, every one checked against the page text (websites.js check).
//
// CAREFUL BY DESIGN: one request at a time, --gap seconds apart (3 by
// default, never under 2), a plain identifying User-Agent, robots.txt obeyed
// (a robots.txt that will not load counts as "keep out"), no logins, no forms,
// pages of HTML only and 2MB at most. A company's site that refuses or fails
// is that company's answer, recorded, and the run goes on; ten companies in a
// row with no answer at all from anyone stops the run (the connection is the
// likelier fault). The page text is kept only in the LOCAL web-archive.db
// (gitignored); the facts in the LOCAL formd.db; never Turso, never served.
//
//   node --use-system-ca website-load.js                         # dry run: the pilot set and what it would cost
//   node --use-system-ca website-load.js --commit --max 200 --max-usd 3
//   node --use-system-ca website-load.js --commit --ein 330747275   # one company
//   node --use-system-ca website-load.js --commit --no-read          # find and fetch only; no model
//   node --use-system-ca website-load.js --stats
//   node --use-system-ca website-load.js --commit --eins targets-eins.txt   # a shortlist (the viewer's Targets page), in its order
'use strict';
require('dotenv').config({ override: true });
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const W = require('./websites.js');
const Rel = require('./releases.js');

const DIR = path.join(__dirname, 'downloads', 'web');
const LOCK = path.join(DIR, 'website-load.lock');
const MIN_GAP_S = 2;
const MAX_TRIES = 5;                 // addresses visited a company (DNS lookups are free)
const MAX_BYTES = 2 * 1024 * 1024;
const STOP_AFTER_DEAD = 10;          // companies in a row with no answer from any address
const HAIKU = { in: 0.10 / 1e6, out: 0.50 / 1e6 };
const contact = (process.env.REPORT_TO || process.env.MAIL_FROM || '').replace(/.*</, '').replace(/>.*/, '').trim();
const UA = `Mozilla/5.0 (compatible; ${W.UA_TOKEN}/1.0; company facts for research${contact ? '; ' + contact : ''})`;

function options(argv) {
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  return {
    commit: argv.includes('--commit'),
    read: !argv.includes('--no-read'),
    retry: argv.includes('--retry'),
    reread: argv.includes('--reread'),   // the sites read before a change to the read, again from the pages kept
    stats: argv.includes('--stats'),
    max: Math.max(1, Number(arg('--max')) || 200),
    maxUsd: Math.max(0, Number(arg('--max-usd')) || 3),
    gapS: Math.max(MIN_GAP_S, Number(arg('--gap')) || 3),
    ein: arg('--ein') ? String(arg('--ein')).replace(/\D/g, '') : null,
    eins: arg('--eins') || null,     // a file of tax IDs, one a line
    deep: argv.includes('--deep'),   // the rest of each confirmed site, kept whole (no model)
    pages: Math.min(100, Math.max(1, Number(arg('--pages')) || W.MAX_DEEP)),
    thenDeep: argv.includes('--then-deep'),   // each site confirmed, kept whole straight away
    workers: Math.min(12, Math.max(1, Number(arg('--workers')) || 1)),
    minutes: Math.max(0, Number(arg('--minutes')) || 0),   // stop starting companies after this long (0: no limit)
    maxGb: Math.max(0, Number(arg('--max-gb')) || 0),      // stop when web-archive.db reaches this size (0: no limit)
    // The companies: retirement-plan employers filing 2023 or later, between
    // these staff counts (--max-staff 0: no upper bound). The pilot was 100 to 2,000.
    minStaff: Math.max(1, Number(arg('--min-staff')) || 100),
    maxStaff: arg('--max-staff') != null ? Math.max(0, Number(arg('--max-staff')) || 0) : 2000,
    // --url with --ein: the address given by hand (the owner knows CITCO is
    // citcowater.com; no file says so). No guessing; read whatever the match.
    url: arg('--url') ? String(arg('--url')).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '') : null,
  };
}

function ensureSchema(db) {
  db.exec(`
    create table if not exists web_sites (
      ein text primary key, name text, dba text, city text, state text, phone text, domain text, url text, verdict text,
      name_hit integer, city_hit integer, phone_hit integer, tried text, pages integer, checked_at integer not null
    );
    create table if not exists web_reads (
      ein text primary key, domain text, model text, read text, problems text, in_tok integer, out_tok integer, usd real, at integer not null
    );
    create table if not exists web_requests (at integer not null, url text not null, status integer, bytes integer, ms integer);
    create table if not exists web_reads_history (
      ein text not null, domain text, model text, read text, problems text, in_tok integer, out_tok integer, usd real, at integer not null, replaced_at integer not null
    );
    create index if not exists idx_web_reads_history_ein on web_reads_history (ein);
  `);
}

// The pilot: employers with their own plan, 100 to 2,000 people, filed 2023
// or later; half with a telephone on file (from their Form D), half without,
// each half in a fixed order (a hash of the tax ID) so a rerun continues the
// same list. One --ein instead names the company.
function pilot(db, opts) {
  // The telephones first, in one pass (a lookup per employer took minutes).
  const tel = new Map();
  for (const r of db.prepare('select p.ein, c.phone from fd_profiles p join ct_companies c on c.cik = p.cik where p.ein is not null and c.phone is not null').all()) if (!tel.has(r.ein)) tel.set(r.ein, r.phone);
  const base = 'select l.ein, l.name, l.dba, l.city, l.state, l.business_code naics, l.staff from f5500_latest l';
  // Every other name the employer has filed under (f5500_names), for the
  // guesses and the match.
  const hasNames = !!db.prepare("select 1 from sqlite_master where name = 'f5500_names'").get();
  const othersOf = (ein, cur) => (hasNames ? db.prepare('select name from f5500_names where ein = ?').all(ein).map((x) => x.name).filter((n) => W.words(n).join(' ') !== W.words(cur).join(' ')) : []);
  const withTel = (rs) => rs.map((r) => ({ ...r, phone: tel.get(r.ein) || null }));
  const named = (rs) => rs.map((r) => ({ ...r, others: othersOf(r.ein, r.name) }));
  if (opts.ein) return named(withTel(db.prepare(base + ' where l.ein = ?').all(opts.ein)));
  // A shortlist: the tax IDs in the file's order (best fit first), up to --max.
  if (opts.einList) {
    const one = db.prepare(base + ' where l.ein = ?');
    return named(withTel(opts.einList.slice(0, opts.max).map((e) => one.get(e)).filter(Boolean)));
  }
  const minStaff = opts.minStaff || 100, maxStaff = opts.maxStaff == null ? 2000 : opts.maxStaff;
  const rows = withTel(maxStaff
    ? db.prepare(base + ' where l.staff between ? and ? and l.year >= 2023').all(minStaff, maxStaff)
    : db.prepare(base + ' where l.staff >= ? and l.year >= 2023').all(minStaff));
  const h = (e) => crypto.createHash('sha1').update(String(e)).digest('hex');
  rows.sort((a, b) => (h(a.ein) < h(b.ein) ? -1 : 1));
  const half = Math.ceil(opts.max / 2);
  const withPhone = rows.filter((r) => r.phone).slice(0, half);
  const without = rows.filter((r) => !r.phone).slice(0, opts.max - withPhone.length);
  return named([...withPhone, ...without]);
}

// One page: GET, redirects followed, HTML only, MAX_BYTES at most. Returns
// { status, url (after redirects), html } or { status: 0, error }.
function makeGetter(deps, gapMs, note) {
  let last = 0;
  return async function get(url) {
    const wait = last ? last + gapMs - deps.now() : 0;
    if (wait > 0) await deps.sleep(wait);
    const t0 = deps.now();
    try {
      const r = await deps.fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' }, signal: AbortSignal.timeout(20000) });
      const type = String(r.headers.get('content-type') || '');
      let html = '';
      if (r.status === 200 && (/html|text\/plain|xml/i.test(type) || !type)) {   // xml: a sitemap
        const reader = r.body.getReader();
        const chunks = [];
        let n = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          n += value.length;
          if (n > MAX_BYTES) { try { await reader.cancel(); } catch (_) { /* stopped */ } break; }
          chunks.push(value);
        }
        html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
      } else { try { await r.body?.cancel(); } catch (_) { /* nothing to drain */ } }
      last = deps.now();
      note(url, r.status, html.length, last - t0);
      return { status: r.status, url: r.url || url, html, type };
    } catch (e) {
      last = deps.now();
      note(url, 0, 0, last - t0);
      return { status: 0, url, html: '', error: e.message };
    }
  };
}

const titleOf = (html) => { const m = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(String(html || '')); return m ? Rel.toText(m[1]) : ''; };
const textOf = (html) => {
  // The page's own description is kept with its text; menus and footers are
  // left in (a company's city and telephone are often only there).
  const meta = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,500})["']/i.exec(String(html || ''));
  return [titleOf(html), meta ? Rel.toText(meta[1]) : '', Rel.toText(html)].filter(Boolean).join('\n');
};

async function ask(body, deps) {
  for (let a = 0; a < 4; a++) {
    const r = await deps.post(body);
    if (r.status === 429 || r.status === 529) { await deps.sleep((r.retryAfter || 20) * 1000); continue; }
    if ([400, 401, 403, 404].includes(r.status)) { const e = new Error('Anthropic answered ' + r.status + ': ' + String((r.body.error && r.body.error.message) || '').slice(0, 160)); e.stop = true; throw e; }
    if (r.status !== 200) throw new Error('Anthropic ' + r.status);
    const u = r.body.usage || {};
    const usd = (u.input_tokens || 0) * HAIKU.in + (u.output_tokens || 0) * HAIKU.out;
    if (r.body.stop_reason !== 'end_turn') { const e = new Error('the answer stopped: ' + r.body.stop_reason); e.usd = usd; throw e; }
    return { ans: JSON.parse((r.body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')), in_tok: u.input_tokens || 0, out_tok: u.output_tokens || 0, usd };
  }
  throw new Error('Anthropic kept answering 429');
}

// One company: guess, look up, visit, judge, fetch its pages. No model here.
async function findSite(co, get, deps) {
  const tried = [];
  let visits = 0;
  for (const domain of co.url ? [co.url] : W.candidates(co.name, co.dba, co.naics, co.others)) {
    if (visits >= MAX_TRIES) break;
    // The bare name, else www. (some answer only there).
    let host = null;
    for (const h of [domain, 'www.' + domain]) {
      try { if (await deps.lookup(h)) { host = h; break; } } catch (_) { /* no such name */ }
    }
    if (!host) { tried.push({ domain, dns: false }); continue; }
    visits++;
    // HTTPS, else plain HTTP when HTTPS gets no answer at all (a refused
    // connection or a bad certificate; Flack Steel's server serves no HTTPS).
    let origin = 'https://' + host;
    let rb = await get(origin + '/robots.txt');
    if (rb.status === 0) { origin = 'http://' + host; rb = await get(origin + '/robots.txt'); }
    const allowed = rb.status === 200 ? W.robots(rb.html) : rb.status === 404 || rb.status === 410 ? () => true : rb.status === 0 ? null : () => false;
    if (!allowed) { tried.push({ domain, dns: true, error: rb.error || 'no answer' }); continue; }
    if (!allowed('/')) { tried.push({ domain, dns: true, robots: 'disallowed' }); continue; }
    const home = await get(origin + '/');
    if (home.status !== 200 || !home.html) { tried.push({ domain, dns: true, status: home.status, error: home.error }); continue; }
    let finalHost = '';
    try { finalHost = new URL(home.url).hostname; } catch (_) { finalHost = domain; }
    const homeText = textOf(home.html);
    let v = W.verify(homeText, co);
    tried.push({ domain, dns: true, status: 200, landed: finalHost, verdict: v.verdict });
    if (!co.url && (v.verdict === 'parked' || v.verdict === 'no match')) continue;
    // The name is there: its other pages, each where robots.txt allows (the
    // landing host's robots.txt when the home page moved to another host).
    let allowedHere = allowed;
    if (finalHost.toLowerCase().replace(/^www\./, '') !== domain) {
      const rb2 = await get(new URL(home.url).origin + '/robots.txt');
      allowedHere = rb2.status === 200 ? W.robots(rb2.html) : rb2.status === 404 || rb2.status === 410 ? () => true : () => false;
    }
    const pages = [{ kind: 'home', url: home.url, status: 200, text: homeText }];
    for (const p of W.pickPages(home.html, home.url)) {
      let pathName = '/';
      try { pathName = new URL(p.url).pathname; } catch (_) { continue; }
      if (!allowedHere(pathName)) { pages.push({ ...p, status: -1, text: '' }); continue; }
      const r = await get(p.url);
      pages.push({ ...p, status: r.status, text: r.status === 200 ? textOf(r.html) : '' });
    }
    v = W.verify(pages.map((p) => p.text).join('\n'), co);
    // An address given by hand is the company's whatever the pages show (a
    // parked domain excepted); the hits are kept to say what matched.
    if (co.url && v.verdict !== 'parked') v = { ...v, verdict: 'given' };
    return { domain, landed: finalHost, url: home.url, verify: v, pages, tried };
  }
  return { domain: null, verify: { verdict: 'none found', name: false, city: false, phone: false }, pages: [], tried };
}

// ---- the deep crawl (--deep): the rest of a confirmed site, kept whole ----
// From the address already confirmed: robots.txt, the sitemap it names (or
// /sitemap.xml), then the most telling pages first (websites.js pageScore),
// following links found on the way, to --pages pages. A page's text without
// its menus and footer; the same text at two addresses kept once.
async function deepCrawl(site, get, maxPages) {
  let start;
  try { start = new URL(site.url); } catch (_) { return { pages: [], stopped: 'no address' }; }
  const origin = start.origin;
  const rb = await get(origin + '/robots.txt');
  const allowed = rb.status === 200 ? W.robots(rb.html) : rb.status === 404 || rb.status === 410 ? () => true : null;
  if (!allowed) return { pages: [], stopped: 'robots.txt ' + (rb.status || 'no answer') };
  const queue = new Map(), seen = new Set();
  const push = (c) => { if (c && !seen.has(c.url) && (!queue.has(c.url) || queue.get(c.url).s < c.s)) queue.set(c.url, c); };
  const home = W.pageUrl(start.href, start);
  if (home) push({ url: home.href, kind: 'home', s: 100 });
  // The sitemap: the one robots.txt names, else the usual place; an index's
  // child sitemaps, pages before posts, two at most.
  let requests = 1;
  const named = rb.status === 200 ? (/^\s*sitemap:\s*(\S+)/im.exec(rb.html) || [])[1] : null;
  let smUrl = origin + '/sitemap.xml';
  if (named) {
    try { const u = new URL(named, origin); if (u.hostname.replace(/^www\./, '') === start.hostname.replace(/^www\./, '')) smUrl = u.href; } catch (_) { /* the usual place */ }
  }
  let smPath = '/sitemap.xml';
  try { smPath = new URL(smUrl).pathname; } catch (_) { /* the usual place */ }
  if (allowed(smPath)) {
    const sm = await get(smUrl); requests++;
    let locs = sm.status === 200 ? W.sitemapUrls(sm.html) : [];
    if (/<sitemapindex/i.test(sm.html || '')) {
      const kids = locs.filter((l) => /\.xml/i.test(l)).sort((a, b) => (/post|blog|news/i.test(a) ? 1 : 0) - (/post|blog|news/i.test(b) ? 1 : 0)).slice(0, 2);
      locs = [];
      for (const k of kids) { const r = await get(k); requests++; if (r.status === 200) locs.push(...W.sitemapUrls(r.html)); }
    }
    for (const l of locs.slice(0, 2000)) { const u = W.pageUrl(l, start); if (u && u.pathname !== '/') push({ url: u.href, ...W.pageScore(u, '') }); }
  }
  const pages = [], texts = new Set();
  let fails = 0;
  while (pages.length < maxPages && queue.size && requests < maxPages + 15) {
    let best = null;
    for (const c of queue.values()) if (!best || c.s > best.s) best = c;
    queue.delete(best.url); seen.add(best.url);
    let pathName = '/';
    try { pathName = new URL(best.url).pathname; } catch (_) { continue; }
    if (!allowed(pathName)) continue;
    const r = await get(best.url); requests++;
    if (r.status !== 200 || !r.html) { if (++fails >= 8 && !pages.length) return { pages, stopped: 'pages would not load' }; continue; }
    let landed;
    try { landed = new URL(r.url || best.url); } catch (_) { continue; }
    if (landed.hostname.replace(/^www\./, '') !== start.hostname.replace(/^www\./, '')) continue;   // sent off the site
    const text = textOf(best.kind === 'home' ? r.html : W.mainHtml(r.html));
    const sig = crypto.createHash('sha1').update(text).digest('hex');
    if (!texts.has(sig)) { texts.add(sig); pages.push({ url: landed.href, kind: best.kind, text }); }
    seen.add(landed.href.replace(/\/+$/, ''));
    for (const c of W.crawlLinks(r.html, landed.href)) push(c);
  }
  return { pages, stopped: null, requests };
}

// THE RE-READ (2026-11-11, the owner: "Yes fill after crawl finishes"): every
// site read before the headquarters, key people and the company's contact
// details were asked for (its read has no `headquarters` key), read again by the
// model from the pages already kept in web-archive.db: the home page and the
// first page kept of each kind, as the first read chose them. No request to any
// site. The earlier read is kept in web_reads_history, never overwritten.
const REREAD_KINDS = ['about', 'contact', 'services', 'careers', 'team', 'news'];
async function runReread(opts, deps) {
  const log = deps.log || console.log;
  const db = deps.db, adb = deps.archive.db;
  const todo = db.prepare(`select r.ein, s.name, s.dba, s.city, s.state, r.domain from web_reads r join web_sites s on s.ein = r.ein
    where r.read not like '%"headquarters"%' order by r.at`).all().slice(0, opts.max);
  const pagesQ = adb.prepare('select url, kind, text from pages where ein = ? order by fetched_at, rowid');
  log(`${todo.length} sites read before the new fields; reading again from the pages kept, capped at $${opts.maxUsd}`);
  if (!opts.commit) { log('DRY RUN: nothing read. Add --commit.'); return { ok: true, todo: todo.length }; }
  if (!deps.post) throw new Error('no ANTHROPIC_API_KEY');
  const keepQ = db.prepare('insert into web_reads_history (ein, domain, model, read, problems, in_tok, out_tok, usd, at, replaced_at) select ein, domain, model, read, problems, in_tok, out_tok, usd, at, ? from web_reads where ein = ?');
  const setQ = db.prepare('update web_reads set model = ?, read = ?, problems = ?, in_tok = ?, out_tok = ?, usd = ?, at = ? where ein = ?');
  const sum = { read: 0, usd: 0, noPages: 0, failed: 0, hq: 0, address: 0, phone: 0, email: 0, people: 0 };
  let next = 0, stop = null;
  async function worker() {
    while (!stop && next < todo.length) {
      if (sum.usd >= opts.maxUsd) { stop = `reached the $${opts.maxUsd} cap`; break; }
      const co = todo[next++];
      const all = pagesQ.all(co.ein);
      const home = all.find((p) => p.kind === 'home');
      const pages = (home ? [home] : []).concat(REREAD_KINDS.map((k) => all.find((p) => p.kind === k)).filter(Boolean)).slice(0, W.MAX_PAGES + 1).filter((p) => p.text);
      if (!pages.length) { sum.noPages++; continue; }
      try {
        const a = await ask(W.request(co, pages), deps);
        sum.usd += a.usd;
        const c = W.check(a.ans, W.pagesText(pages));
        db.exec('begin');
        try { keepQ.run(deps.now(), co.ein); setQ.run(W.MODEL, JSON.stringify(c.read), JSON.stringify(c.problems), a.in_tok, a.out_tok, a.usd, deps.now(), co.ein); db.exec('commit'); } catch (e) { try { db.exec('rollback'); } catch (_) { /* gone */ } throw e; }
        sum.read++;
        const r = c.read;
        if (r.headquarters) sum.hq++;
        if (r.hq_address) sum.address++;
        if (r.main_phone) sum.phone++;
        if (r.general_email) sum.email++;
        sum.people += r.leaders.length;
        if (sum.read % 50 === 0) log(`${sum.read} read again, $${sum.usd.toFixed(3)}`);
      } catch (e) {
        if (e.usd) sum.usd += e.usd;
        sum.failed++;
        log(`${co.name}: ${e.message}`);
        if (e.stop) { stop = e.message; break; }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.workers, 4)) }, worker));
  log(`done: ${JSON.stringify({ ...sum, usd: Number(sum.usd.toFixed(4)) })}${stop ? ' · stopped: ' + stop : ''}`);
  return { ok: !stop || /cap/.test(stop), ...sum, left: todo.length - next };
}

async function runDeep(opts, deps) {
  const log = deps.log || console.log;
  const db = deps.db;
  const pick = 'select ein, name, city, state, domain, url from web_sites where verdict in (\'confirmed\', \'given\') and url is not null';
  let sites = opts.einList
    ? opts.einList.map((e) => db.prepare(pick + ' and ein = ?').get(e)).filter(Boolean)
    : db.prepare(pick + ' order by checked_at').all();
  const done = deps.archive.crawled();
  const todo = sites.filter((s) => opts.retry || !done.has(s.ein)).slice(0, opts.max);
  log(`${sites.length} confirmed sites; ${todo.length} to crawl, up to ${opts.pages} pages each, ${opts.gapS}s between requests (about ${Math.round(todo.length * (opts.pages + 3) * opts.gapS / 60)} minutes at most). No model.`);
  if (!opts.commit) { log('DRY RUN: nothing fetched. Add --commit.'); return { ok: true, todo: todo.length }; }
  const note = (url, status, bytes, ms) => { try { db.prepare('insert into web_requests (at, url, status, bytes, ms) values (?, ?, ?, ?, ?)').run(deps.now(), url, status, bytes, ms); } catch (_) { /* bookkeeping */ } };
  const get = makeGetter(deps, opts.gapS * 1000, note);
  const sum = { sites: 0, pages: 0, chars: 0, changed: 0 };
  let dead = 0;
  for (const s of todo) {
    const t0 = deps.now();
    const c = await deepCrawl(s, get, opts.pages);
    let changed = 0;
    for (const p of c.pages) if (deps.archive.writePage(p.url, s.ein, p.kind, p.text) === 'changed') changed++;
    const chars = c.pages.reduce((a, p) => a + p.text.length, 0);
    deps.archive.noteCrawl(s.ein, s.domain, t0, deps.now(), c.pages.length, chars, c.stopped);
    sum.sites++; sum.pages += c.pages.length; sum.chars += chars; sum.changed += changed;
    dead = c.pages.length ? 0 : dead + 1;
    const kinds = {};
    for (const p of c.pages) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
    log(`${s.name} (${s.domain}): ${c.pages.length} pages, ${Math.round(chars / 1000)}K characters${changed ? `, ${changed} changed since last time (earlier text kept)` : ''}${c.stopped ? ' · ' + c.stopped : ''} · ${Object.entries(kinds).map(([k, n]) => k + ' ' + n).join(', ')}`);
    if (dead >= STOP_AFTER_DEAD) { log(`${STOP_AFTER_DEAD} sites in a row gave nothing: stopped (check the connection).`); return { ok: false, ...sum }; }
  }
  log(`done: ${sum.sites} sites, ${sum.pages} pages, ${Math.round(sum.chars / 1e6 * 10) / 10}M characters kept.`);
  return { ok: true, ...sum };
}

async function run(opts, deps) {
  const log = deps.log || console.log;
  const db = deps.db;
  ensureSchema(db);
  if (opts.eins && !opts.einList && opts.deep) {
    const list = String(deps.readFile(opts.eins)).split(/\s+/).map((e) => e.replace(/\D/g, '')).filter((e) => /^\d{9}$/.test(e));
    opts = { ...opts, einList: [...new Set(list)] };
  }
  if (opts.reread) return runReread(opts, deps);
  if (opts.deep) return runDeep(opts, deps);
  if (opts.stats) {
    log(JSON.stringify(db.prepare('select verdict, count(*) n from web_sites group by verdict order by n desc').all()));
    log(JSON.stringify(db.prepare('select count(*) reads, round(sum(usd), 4) usd from web_reads').get()));
    return { ok: true };
  }
  if (opts.url && !opts.ein) throw new Error('--url names one company\'s address: give --ein with it');
  if (opts.eins && !opts.einList) {
    const list = String(deps.readFile(opts.eins)).split(/\s+/).map((e) => e.replace(/\D/g, '')).filter((e) => /^\d{9}$/.test(e));
    opts = { ...opts, einList: [...new Set(list)] };
  }
  const all = pilot(db, opts);
  // --retry: the companies where nothing was found are tried again (after a
  // change to how sites are found); every other verdict stands.
  const done = new Set(db.prepare(`select ein from web_sites${opts.retry ? " where verdict <> 'none found'" : ''}`).all().map((r) => r.ein));
  const todo = opts.ein ? all : all.filter((c) => !done.has(c.ein));
  log(`${all.length} companies in the pilot (${all.filter((c) => c.phone).length} with a telephone on file); ${todo.length} not yet tried. About ${MAX_TRIES * 2 + W.MAX_PAGES} requests a company at most, ${opts.gapS}s apart${opts.read ? `; reading by model capped at $${opts.maxUsd}` : '; no model'}`);
  if (!opts.commit) { log('DRY RUN: nothing looked up or fetched. Add --commit.'); return { ok: true, todo: todo.length }; }
  if (opts.read && !deps.post) throw new Error('no ANTHROPIC_API_KEY (or run with --no-read)');
  const note = (url, status, bytes, ms) => { try { db.prepare('insert into web_requests (at, url, status, bytes, ms) values (?, ?, ?, ?, ?)').run(deps.now(), url, status, bytes, ms); } catch (_) { /* bookkeeping */ } };
  const sum = { companies: 0, confirmed: 0, nameOnly: 0, none: 0, read: 0, usd: 0, problems: 0, crawled: 0, pages: 0 };
  let dead = 0, stop = null, next = 0;
  const t0 = deps.now();
  // Why no new company is started: the money, the clock, the disk, the line.
  const halt = () => {
    if (stop) return stop;
    if (opts.read && sum.usd >= opts.maxUsd) stop = `reached the $${opts.maxUsd} cap`;
    else if (opts.minutes && deps.now() - t0 >= opts.minutes * 60000) stop = `${opts.minutes} minutes up; the next run carries on`;
    else if (opts.maxGb && deps.archiveBytes && deps.archiveBytes() >= opts.maxGb * 1e9) stop = `the page archive reached ${opts.maxGb} GB: stopped (raise --max-gb to go on)`;
    return stop;
  };
  // WORKERS (--workers): several companies at once, each worker with its own
  // getter, so each site still sees one request every --gap seconds.
  async function worker() {
    const get = makeGetter(deps, opts.gapS * 1000, note);
    while (!halt() && next < todo.length) {
      const co = todo[next++];
      const r = await oneCompany(co, get);
      if (r === 'stop') return;
    }
  }
  async function oneCompany(co, get) {
    const f = await findSite(opts.url ? { ...co, url: opts.url } : co, get, deps);
    sum.companies++;
    const answered = f.tried.some((t) => t.status || t.robots);
    dead = f.tried.some((t) => t.dns) && !answered ? dead + 1 : 0;
    const v = f.verify;
    db.prepare(`insert or replace into web_sites (ein, name, dba, city, state, phone, domain, url, verdict, name_hit, city_hit, phone_hit, tried, pages, checked_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(co.ein, co.name, co.dba || null, co.city, co.state, co.phone || null, f.landed || f.domain, f.url || null, v.verdict,
      v.name ? 1 : 0, v.city ? 1 : 0, v.phone ? 1 : 0, JSON.stringify(f.tried), f.pages.filter((p) => p.status === 200).length, deps.now());
    for (const p of f.pages) if (p.status === 200) deps.archive.writePage(p.url, co.ein, p.kind, p.text);
    if (v.verdict === 'confirmed' || v.verdict === 'given') sum.confirmed++; else if (v.verdict === 'name only') sum.nameOnly++; else sum.none++;
    let line = `${co.name} (${co.city}, ${co.state}${co.phone ? ', tel' : ''}): ${v.verdict}${f.domain ? ' at ' + (f.landed || f.domain) : ''}${v.verdict === 'confirmed' || v.verdict === 'given' ? ' [' + [v.name && 'name', v.city && 'city', v.phone && 'tel'].filter(Boolean).join('+') + ', ' + f.pages.filter((p) => p.status === 200).length + ' pages]' : ''}`;
    if (opts.read && (v.verdict === 'confirmed' || v.verdict === 'given')) {
      try {
        const pages = f.pages.filter((p) => p.status === 200 && p.text);
        const a = await ask(W.request(co, pages), deps);
        sum.usd += a.usd;
        const c = W.check(a.ans, W.pagesText(pages));
        db.prepare('insert or replace into web_reads (ein, domain, model, read, problems, in_tok, out_tok, usd, at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(co.ein, f.landed || f.domain, W.MODEL, JSON.stringify(c.read), JSON.stringify(c.problems), a.in_tok, a.out_tok, a.usd, deps.now());
        sum.read++;
        sum.problems += c.problems.length;
        const r = c.read;
        line += ` · ${r.is_company_site ? '' : 'NOT ITS SITE (model) · '}${r.founded ? 'founded ' + r.founded + ' · ' : ''}${r.services.length} services, ${r.locations.length} places, ${r.leaders.length} people${r.open_jobs != null ? ', ' + r.open_jobs + ' jobs' : ''}${c.problems.length ? ` · ${c.problems.length} dropped` : ''} ($${a.usd.toFixed(4)})`;
      } catch (e) {
        if (e.usd) sum.usd += e.usd;
        line += ' · read failed: ' + e.message;
        if (e.stop) { log(line); stop = stop || `stopped: ${e.message}`; return 'stop'; }
      }
    }
    // --then-deep: the rest of a confirmed site, kept whole, by the same worker.
    if (opts.thenDeep && (v.verdict === 'confirmed' || v.verdict === 'given') && f.url) {
      const d0 = deps.now();
      const c = await deepCrawl({ url: f.url }, get, opts.pages);
      let chars = 0;
      for (const p of c.pages) { deps.archive.writePage(p.url, co.ein, p.kind, p.text); chars += p.text.length; }
      deps.archive.noteCrawl(co.ein, f.landed || f.domain, d0, deps.now(), c.pages.length, chars, c.stopped);
      sum.crawled++; sum.pages += c.pages.length;
      line += ` · kept ${c.pages.length} pages (${Math.round(chars / 1000)}K)${c.stopped ? ' · ' + c.stopped : ''}`;
    }
    log(line);
    if (dead >= STOP_AFTER_DEAD) { stop = stop || `${STOP_AFTER_DEAD} companies in a row with no answer from any address: stopped (check the connection).`; return 'stop'; }
    return 'ok';
  }
  await Promise.all(Array.from({ length: Math.min(opts.workers || 1, Math.max(1, todo.length)) }, worker));
  if (stop) log(stop);
  const hit = sum.companies ? (100 * sum.confirmed / sum.companies).toFixed(0) : '0';
  log(`done: ${sum.companies} companies; ${sum.confirmed} confirmed (${hit}%), ${sum.nameOnly} name only, ${sum.none} none; ${sum.read} read for $${sum.usd.toFixed(3)}, ${sum.problems} phrases dropped by the checks${opts.thenDeep ? `; ${sum.crawled} sites kept whole, ${sum.pages} pages` : ''}; ${todo.length - next} still to go.`);
  const failed = stop && !/minutes up|cap|GB/.test(stop);
  return { ok: !failed, ...sum, left: todo.length - next };
}

// The page text archive (web-archive.db, LOCAL, gitignored). A page fetched
// again with different text keeps its earlier text in pages_history (the
// owner's rule: history is kept). pages_fts indexes every page's text for
// search (web-search.js), kept in step by triggers; rows are written by insert
// and update, never "insert or replace" (whose delete fires no trigger).
function archiveSchema(db) {
  db.exec(`create table if not exists pages (url text primary key, ein text, kind text, fetched_at integer not null, text text);
    create index if not exists idx_pages_ein on pages (ein);
    create table if not exists pages_history (url text not null, ein text, kind text, fetched_at integer not null, text text, replaced_at integer not null);
    create index if not exists idx_pages_history_url on pages_history (url);
    create table if not exists crawls (ein text not null, domain text, started_at integer not null, finished_at integer, pages integer, chars integer, stopped text);
    create index if not exists idx_crawls_ein on crawls (ein);`);
  const hadFts = !!db.prepare("select 1 from sqlite_master where name = 'pages_fts'").get();
  db.exec(`create virtual table if not exists pages_fts using fts5(text, content='pages', content_rowid='rowid', tokenize='porter unicode61');
    create trigger if not exists pages_ai after insert on pages begin insert into pages_fts (rowid, text) values (new.rowid, new.text); end;
    create trigger if not exists pages_ad after delete on pages begin insert into pages_fts (pages_fts, rowid, text) values ('delete', old.rowid, old.text); end;
    create trigger if not exists pages_au after update of text on pages begin
      insert into pages_fts (pages_fts, rowid, text) values ('delete', old.rowid, old.text);
      insert into pages_fts (rowid, text) values (new.rowid, new.text);
    end;`);
  if (!hadFts) db.exec("insert into pages_fts (pages_fts) values ('rebuild')");   // the pages already kept
}

function openArchive(file, opts = {}) {
  const { DatabaseSync } = require('node:sqlite');
  const db = opts.db || new DatabaseSync(file || process.env.WEB_ARCHIVE_DB || path.join(__dirname, 'web-archive.db'));
  db.exec('pragma busy_timeout = 10000; pragma journal_mode = wal;');
  archiveSchema(db);
  const now = opts.now || (() => Date.now());
  const getQ = db.prepare('select text from pages where url = ?');
  const insQ = db.prepare('insert into pages (url, ein, kind, fetched_at, text) values (?, ?, ?, ?, ?)');
  const updQ = db.prepare('update pages set ein = ?, kind = ?, fetched_at = ?, text = ? where url = ?');
  const seenQ = db.prepare('update pages set fetched_at = ? where url = ?');
  const histQ = db.prepare('insert into pages_history (url, ein, kind, fetched_at, text, replaced_at) select url, ein, kind, fetched_at, text, ? from pages where url = ?');
  // 'new', 'same' (only the date moves on) or 'changed' (the old text kept).
  function writePage(url, ein, kind, text) {
    const old = getQ.get(url);
    if (!old) { insQ.run(url, ein, kind, now(), text); return 'new'; }
    if (old.text === text) { seenQ.run(now(), url); return 'same'; }
    db.exec('begin');
    try { histQ.run(now(), url); updQ.run(ein, kind, now(), text, url); db.exec('commit'); } catch (e) { try { db.exec('rollback'); } catch (_) { /* gone */ } throw e; }
    return 'changed';
  }
  const crawled = () => new Set(db.prepare('select distinct ein from crawls where pages > 0').all().map((r) => r.ein));
  const noteCrawl = (ein, domain, a, b, pages, chars, stopped) =>
    db.prepare('insert into crawls (ein, domain, started_at, finished_at, pages, chars, stopped) values (?, ?, ?, ?, ?, ?, ?)').run(ein, domain, a, b, pages, chars, stopped || null);
  return { db, writePage, crawled, noteCrawl, close: () => (opts.db ? null : db.close()) };
}

function lock() {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(LOCK)) {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch (_) { /* not running */ }
    if (alive) throw new Error(`another website-load run (pid ${pid}) is going; one at a time`);
  }
  fs.writeFileSync(LOCK, String(process.pid));
  return () => { try { fs.unlinkSync(LOCK); } catch (_) { /* gone */ } };
}

if (require.main === module) {
  const opts = options(process.argv);
  let unlock = () => {};
  (async () => {
    if (opts.commit) unlock = lock();
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.FORMD_DB || path.join(__dirname, 'formd.db'));
    db.exec('pragma busy_timeout = 10000; pragma journal_mode = wal;');
    const archive = openArchive();
    const KEY = process.env.ANTHROPIC_API_KEY || '';
    const dns = require('dns').promises;
    try {
      const r = await run(opts, {
        db, archive,
        readFile: (file) => fs.readFileSync(file, 'utf8'),
        // The page archive's size on disk, its write-ahead log included (--max-gb).
        archiveBytes: () => ['', '-wal'].reduce((a, s) => { try { return a + fs.statSync(path.join(__dirname, 'web-archive.db' + s)).size; } catch (_) { return a; } }, 0),
        fetch: (...a) => fetch(...a),
        lookup: async (d) => { const a = await dns.lookup(d); return a && a.address; },
        sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
        now: () => Date.now(),
        post: KEY ? async (body) => {
          const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
          return { status: r.status, retryAfter: Number(r.headers.get('retry-after')) || 0, body: await r.json().catch(() => ({})) };
        } : null,
      });
      if (!r.ok) process.exitCode = 1;
    } finally { archive.close(); db.close(); unlock(); }
  })().catch((e) => { console.error(e.message); unlock(); process.exit(1); });
}

module.exports = { options, ensureSchema, pilot, makeGetter, findSite, deepCrawl, runDeep, run, openArchive, archiveSchema, textOf, MAX_TRIES, UA };
