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
'use strict';
require('dotenv').config({ override: true });
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const W = require('./websites.js');
const Rel = require('./releases.js');

const DIR = path.join(os.tmpdir(), 'tickrlab-web');
const LOCK = path.join(DIR, 'website-load.lock');
const MIN_GAP_S = 2;
const MAX_TRIES = 4;                 // addresses visited a company (DNS lookups are free)
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
    stats: argv.includes('--stats'),
    max: Math.max(1, Number(arg('--max')) || 200),
    maxUsd: Math.max(0, Number(arg('--max-usd')) || 3),
    gapS: Math.max(MIN_GAP_S, Number(arg('--gap')) || 3),
    ein: arg('--ein') ? String(arg('--ein')).replace(/\D/g, '') : null,
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
  const withTel = (rs) => rs.map((r) => ({ ...r, phone: tel.get(r.ein) || null }));
  if (opts.ein) return withTel(db.prepare(base + ' where l.ein = ?').all(opts.ein));
  const rows = withTel(db.prepare(base + ' where l.staff between 100 and 2000 and l.year >= 2023').all());
  const h = (e) => crypto.createHash('sha1').update(String(e)).digest('hex');
  rows.sort((a, b) => (h(a.ein) < h(b.ein) ? -1 : 1));
  const half = Math.ceil(opts.max / 2);
  const withPhone = rows.filter((r) => r.phone).slice(0, half);
  const without = rows.filter((r) => !r.phone).slice(0, opts.max - withPhone.length);
  return [...withPhone, ...without];
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
      if (r.status === 200 && (/html|text\/plain/i.test(type) || !type)) {
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
  for (const domain of W.candidates(co.name, co.dba, co.naics)) {
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
    if (v.verdict === 'parked' || v.verdict === 'no match') continue;
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
    return { domain, landed: finalHost, url: home.url, verify: v, pages, tried };
  }
  return { domain: null, verify: { verdict: 'none found', name: false, city: false, phone: false }, pages: [], tried };
}

async function run(opts, deps) {
  const log = deps.log || console.log;
  const db = deps.db;
  ensureSchema(db);
  if (opts.stats) {
    log(JSON.stringify(db.prepare('select verdict, count(*) n from web_sites group by verdict order by n desc').all()));
    log(JSON.stringify(db.prepare('select count(*) reads, round(sum(usd), 4) usd from web_reads').get()));
    return { ok: true };
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
  const get = makeGetter(deps, opts.gapS * 1000, note);
  const sum = { companies: 0, confirmed: 0, nameOnly: 0, none: 0, read: 0, usd: 0, problems: 0 };
  let dead = 0;
  for (const co of todo) {
    if (opts.read && sum.usd >= opts.maxUsd) { log(`reached the $${opts.maxUsd} cap`); break; }
    const f = await findSite(co, get, deps);
    sum.companies++;
    const answered = f.tried.some((t) => t.status || t.robots);
    dead = f.tried.some((t) => t.dns) && !answered ? dead + 1 : 0;
    const v = f.verify;
    db.prepare(`insert or replace into web_sites (ein, name, dba, city, state, phone, domain, url, verdict, name_hit, city_hit, phone_hit, tried, pages, checked_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(co.ein, co.name, co.dba || null, co.city, co.state, co.phone || null, f.landed || f.domain, f.url || null, v.verdict,
      v.name ? 1 : 0, v.city ? 1 : 0, v.phone ? 1 : 0, JSON.stringify(f.tried), f.pages.filter((p) => p.status === 200).length, deps.now());
    for (const p of f.pages) if (p.status === 200) deps.archive.writePage(p.url, co.ein, p.kind, p.text);
    if (v.verdict === 'confirmed') sum.confirmed++; else if (v.verdict === 'name only') sum.nameOnly++; else sum.none++;
    let line = `${co.name} (${co.city}, ${co.state}${co.phone ? ', tel' : ''}): ${v.verdict}${f.domain ? ' at ' + (f.landed || f.domain) : ''}${v.verdict === 'confirmed' ? ' [' + ['name', v.city && 'city', v.phone && 'tel'].filter(Boolean).join('+') + ', ' + f.pages.filter((p) => p.status === 200).length + ' pages]' : ''}`;
    if (opts.read && v.verdict === 'confirmed') {
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
        if (e.stop) { log(line); log(`stopped: ${e.message}`); return { ok: false, ...sum }; }
      }
    }
    log(line);
    if (dead >= STOP_AFTER_DEAD) { log(`${STOP_AFTER_DEAD} companies in a row with no answer from any address: stopped (check the connection).`); return { ok: false, ...sum }; }
  }
  const hit = sum.companies ? (100 * sum.confirmed / sum.companies).toFixed(0) : '0';
  log(`done: ${sum.companies} companies; ${sum.confirmed} confirmed (${hit}%), ${sum.nameOnly} name only, ${sum.none} none; ${sum.read} read for $${sum.usd.toFixed(3)}, ${sum.problems} phrases dropped by the checks.`);
  return { ok: true, ...sum };
}

function openArchive(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file || process.env.WEB_ARCHIVE_DB || path.join(__dirname, 'web-archive.db'));
  db.exec('pragma busy_timeout = 10000; pragma journal_mode = wal;');
  db.exec('create table if not exists pages (url text primary key, ein text, kind text, fetched_at integer not null, text text)');
  const put = db.prepare('insert or replace into pages (url, ein, kind, fetched_at, text) values (?, ?, ?, ?, ?)');
  return { db, writePage: (url, ein, kind, text) => put.run(url, ein, kind, Date.now(), text), close: () => db.close() };
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

module.exports = { options, ensureSchema, pilot, makeGetter, findSite, run, openArchive, textOf, MAX_TRIES, UA };
