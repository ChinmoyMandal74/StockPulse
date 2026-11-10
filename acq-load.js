// Acquired companies: the audited accounts of private businesses bought by
// SEC filers (backlog 61, phase 2; docs/context/acquired-companies.md).
//
// WHERE THEY ARE. A filer that completes a significant acquisition files an
// 8-K with item 2.01, and must file the business's own financial statements
// under item 9.01, usually by amendment (an 8-K/A) within 71 days. For a
// private business those statements are often the only accounts it ever
// publishes.
//
// LOCAL, BY HAND, AND SLOW ON PURPOSE (the SEC has answered this address
// with a 429 and then a 403; the owner: "be very careful .. be slow"):
//   --list   ONE request: the SEC's bulk submissions file (about 1.6GB, every
//            filer's filing list with each 8-K's items), kept on disk and
//            never fetched twice; the candidate filings are found in it with
//            no further request. Instead of a request per company.
//   --index  per filing, its index page (the documents and their descriptions)
//   --read   per filing, the exhibit holding the business's statements, kept
//            in the archive's texts table so it is never fetched twice, and
//            read by the model (spends API credit; --max-usd caps it)
//   - one request at a time, --gap seconds apart (10 by default, never under 5:
//     the SEC's own ceiling is ten a second);
//   - every answer but a 200 stops the run (a 404 on one document excepted,
//     recorded); nothing is retried;
//   - at most DAY_CAP requests to sec.gov in any 24 hours, from the archive's
//     own request log;
//   - one run at a time (a lock file); nothing schedules it.
//
//   node --use-system-ca acq-load.js --list                       # dry run: what the bulk file would cost
//   node --use-system-ca acq-load.js --list --commit              # download once, find the candidates
//   node --use-system-ca acq-load.js --index --commit --max 50    # 50 filings' indexes, universe first
//   node --use-system-ca acq-load.js --read --commit --max 20 --max-usd 1
//   node --use-system-ca acq-load.js --recheck --commit         # the checks again over stored answers; no request, no spend
//   node --use-system-ca acq-load.js --stats
//   node --use-system-ca acq-load.js --search "acme"
'use strict';
require('dotenv').config({ override: true });
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const Zip = require('./zipread.js');
const F = require('./formd.js');
const Q = require('./acq.js');
const Rel = require('./releases.js');

const LIST_URL = 'https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip';
const DIR = path.join(__dirname, 'downloads', 'sec');
const LOCK = path.join(DIR, 'acq-load.lock');
const MIN_GAP_S = 5;
const DAY_CAP = 1000;

const contact = (process.env.REPORT_TO || process.env.MAIL_FROM || '').replace(/.*</, '').replace(/>.*/, '').trim();
const UA = String(process.env.SEC_UA || (contact ? `Tickr Lab (${contact})` : '')).trim();

function options(argv) {
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const max = arg('--max');
  return {
    commit: argv.includes('--commit'),
    list: argv.includes('--list'),
    index: argv.includes('--index'),
    read: argv.includes('--read'),
    recheck: argv.includes('--recheck'),
    force: argv.includes('--force'),
    stored: argv.includes('--stored'),
    all: argv.includes('--all-filers'),
    max: max === 'all' ? Infinity : Math.max(1, Number(max) || 20),
    gapS: Math.max(MIN_GAP_S, Number(arg('--gap')) || 10),
    maxUsd: Math.max(0, Number(arg('--max-usd')) || 1),
    since: /^\d{4}-\d{2}-\d{2}$/.test(arg('--since') || '') ? arg('--since') : '2009-01-01',
    only: arg('--only') ? String(arg('--only')).toUpperCase().split(',').filter(Boolean) : null,
    search: arg('--search'),
    stats: argv.includes('--stats'),
  };
}

// The careful fetcher: one request, logged, judged. A 404 on a single
// document is an answer about that document and is returned as null; every
// other answer but a 200 throws with .stop (never retried by anyone).
function makeGetter(archive, deps) {
  let last = 0;
  let made = 0;
  return async function get(url, gapMs, cap, opts = {}) {
    if (made >= cap) { const e = new Error(`reached this run's share of the ${DAY_CAP}-a-day cap; run again tomorrow`); e.stop = true; throw e; }
    const wait = last ? last + gapMs - deps.now() : 0;
    if (wait > 0) await deps.sleep(wait);
    const t0 = deps.now();
    let r;
    try {
      r = await deps.fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(opts.timeoutMs || 120000) });
    } catch (e) {
      last = deps.now(); made++;
      archive.noteRequest(url, 0, 0, deps.now() - t0);
      const err = new Error(`could not reach sec.gov (${e.message}). Stopped; nothing retried.`); err.stop = true; throw err;
    }
    if (r.status === 200 && opts.toFile) {
      // The bulk file goes straight to disk; it is never held in memory.
      const part = opts.toFile + '.part';
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(part));
      const bytes = fs.statSync(part).size;
      const want = Number(r.headers.get('content-length')) || 0;
      last = deps.now(); made++;
      archive.noteRequest(url, 200, bytes, deps.now() - t0);
      if (want && bytes !== want) { fs.unlinkSync(part); const e = new Error(`the download stopped short (${bytes} of ${want} bytes). Stopped; nothing retried.`); e.stop = true; throw e; }
      fs.renameSync(part, opts.toFile);
      return bytes;
    }
    const buf = r.status === 200 ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0);
    if (r.status !== 200) { try { await r.body?.cancel(); } catch (_) { /* nothing to drain */ } }
    last = deps.now(); made++;
    archive.noteRequest(url, r.status, buf.length, deps.now() - t0);
    if (r.status === 404 && opts.missingOk) return null;
    const v = F.verdict(r.status);
    if (!v.go) { const e = new Error(v.why); e.stop = true; throw e; }
    return buf;
  };
}

// The app's own tickers (the local analysis copy's names), matched to the
// bulk file's tickers: "BRK.B" there is "BRK-B" here.
function universeTickers(file) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(file || path.join(__dirname, 'analysis.db'), { readOnly: true });
    const out = new Set(d.prepare('select symbol from names').all().map((r) => String(r.symbol).toUpperCase().replace(/\./g, '-')));
    d.close();
    return out;
  } catch (_) { return new Set(); }
}

// --list: every filer's 8-K trail out of the bulk file on disk, no request.
async function buildList(zipFile, opts, deps) {
  const log = deps.log;
  const uni = deps.universe;
  const entries = Zip.entriesOfFile(zipFile).sort((a, b) => a.offset - b.offset);
  const byCik = new Map();
  for (const e of entries) {
    const m = /^CIK(\d{10})(?:-submissions-\d+)?\.json$/.exec(e.name);
    if (!m) continue;
    if (!byCik.has(m[1])) byCik.set(m[1], []);
    byCik.get(m[1]).push(e);
  }
  const fd = fs.openSync(zipFile, 'r');
  const readEntry = (e) => {
    const head = Buffer.alloc(30);
    fs.readSync(fd, head, 0, 30, e.offset);
    const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const raw = Buffer.alloc(e.csize);
    fs.readSync(fd, raw, 0, e.csize, start);
    return JSON.parse((e.method === 8 ? require('zlib').inflateRawSync(raw) : raw).toString('utf8'));
  };
  const filers = [], filings = [];
  let n = 0, bad = 0;
  try {
    for (const [cikPad, list] of byCik) {
      if (++n % 100000 === 0) log(`  ${n} of ${byCik.size} filers read; ${filers.length} with a closing so far`);
      const main = list.find((e) => !/-submissions-/.test(e.name));
      if (!main) continue;
      let j;
      try { j = readEntry(main); } catch (_) { bad++; continue; }
      const tickers = (j.tickers || []).map((t) => String(t).toUpperCase());
      const symbol = tickers.find((t) => uni.has(t)) || null;
      let rows = Q.filingsOf(j.filings && j.filings.recent);
      for (const e of list) {
        if (e === main) continue;
        try { rows = rows.concat(Q.filingsOf(readEntry(e))); } catch (_) { bad++; }
      }
      const seen = new Set();
      rows = rows.filter((r) => (seen.has(r.accn) ? false : seen.add(r.accn)));
      const cands = Q.candidates(rows, opts.since);
      if (!cands.length) continue;
      const cik = String(Number(cikPad));
      filers.push({ cik, name: j.name || null, tickers: tickers.join(',') || null, sic: j.sic || null, in_universe: !!symbol, symbol });
      for (const c of cands) filings.push({ ...c, cik });
    }
  } finally { fs.closeSync(fd); }
  return { filers, filings, bad, filersRead: byCik.size };
}

// The careful order: the app's own companies first, amendments (where the
// statements usually are) before closings, newest first.
function queue(A, opts, what) {
  const roles = opts.closings ? "('amendment','closing')" : "('amendment')";
  // To index: never tried, or the -index-headers page was missing and the
  // plain page has not been tried yet.
  const where = what === 'index'
    ? "not exists (select 1 from indexed i where i.accn = f.accn and not (i.status = 404 and i.via is null))"
    : 'exists (select 1 from indexed i where i.accn = f.accn)';
  const only = opts.only ? ` and fl.symbol in (${opts.only.map(() => '?').join(',')})` : '';
  return A.db.prepare(`select f.*, fl.symbol, fl.name filer, fl.in_universe from filings f join filers fl on fl.cik = f.cik
    where f.role in ${roles} and ${where} and (fl.in_universe = 1 or ?) ${only}
    order by fl.in_universe desc, f.role = 'amendment' desc, f.filed desc`).all(opts.all ? 1 : 0, ...(opts.only || []));
}

const archiveBase = (cik, accn) => 'https://www.sec.gov/Archives/edgar/data/' + Number(cik) + '/' + String(accn).replace(/-/g, '') + '/';
const HAIKU = { in: 0.10 / 1e6, out: 0.50 / 1e6 };

async function ask(text, deps) {
  for (let a = 0; a < 4; a++) {
    const r = await deps.post(Q.request(text));
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

async function run(opts, deps) {
  const log = deps.log || console.log;
  const A = deps.archive;
  if (opts.stats) { log(JSON.stringify(A.stats(), null, 1)); return { ok: true }; }
  if (opts.search) {
    const rows = A.db.prepare(`select r.business, r.kind, r.auditor, r.opinion, f.filed, fl.name buyer, fl.symbol, p.label, p.revenue, p.net_income, p.total_assets
      from reads r join filings f on f.accn = r.accn join filers fl on fl.cik = f.cik left join periods p on p.accn = r.accn and p.file = r.file and p.seq = 0
      where r.business like ? or fl.name like ? order by f.filed desc limit 50`).all('%' + opts.search + '%', '%' + opts.search + '%');
    const $ = (v) => (v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US'));
    for (const r of rows) log([r.filed, r.business || '(' + r.kind + ')', 'bought by ' + r.buyer + (r.symbol ? ' (' + r.symbol + ')' : ''), r.label || '', 'revenue ' + $(r.revenue), 'net ' + $(r.net_income), 'assets ' + $(r.total_assets), r.auditor || ''].join(' | '));
    return { ok: true };
  }
  if (!/@/.test(UA)) throw new Error('no contact address for the SEC User-Agent: set SEC_UA or REPORT_TO in .env');
  const used = A.requestsSince(deps.now() - 86400e3);
  const cap = Math.max(0, DAY_CAP - used);
  log(`sec.gov requests in the last 24 hours: ${used} of ${DAY_CAP}`);
  const get = makeGetter(A, deps);
  const gapMs = opts.gapS * 1000;
  const summary = { requests: 0, indexed: 0, read: 0, business: 0, usd: 0, problems: 0 };

  if (opts.list) {
    let zipFile = deps.newestList();
    if (!zipFile) {
      if (!opts.commit) { log(`DRY RUN: would download the bulk submissions file once (about 1.6GB, ONE request) and find the candidates in it. Add --commit.`); return { ok: true }; }
      zipFile = path.join(DIR, 'submissions-' + new Date(deps.now()).toISOString().slice(0, 10) + '.zip');
      log('downloading ' + LIST_URL + ' (one request) ...');
      await get(LIST_URL, gapMs, cap, { toFile: zipFile, timeoutMs: 3600e3 });
      summary.requests++;
    }
    log('reading ' + zipFile + ' (no requests) ...');
    const t0 = deps.now();
    const r = await buildList(zipFile, opts, { log, universe: deps.universe });
    const amend = r.filings.filter((f) => f.role === 'amendment');
    const uniCiks = new Set(r.filers.filter((f) => f.in_universe).map((f) => f.cik));
    log(`${r.filersRead} filers read in ${((deps.now() - t0) / 60000).toFixed(1)} min${r.bad ? `, ${r.bad} unreadable files` : ''}; since ${opts.since}: ${r.filers.length} filers with a closing (${uniCiks.size} of them the app's), ${r.filings.length - amend.length} closings, ${amend.length} amendments (${amend.filter((f) => uniCiks.has(f.cik)).length} by the app's companies)`);
    if (!opts.commit) { log('DRY RUN: nothing written. Add --commit.'); return { ok: true }; }
    A.writeList(r.filers, r.filings, path.basename(zipFile));
    log('written to the archive.');
    return { ok: true, filers: r.filers.length, filings: r.filings.length };
  }

  if (opts.index) {
    const todo = queue(A, opts, 'index');
    log(`${todo.length} filings without their index; this run: up to ${Math.min(opts.max, todo.length, cap)}, ${opts.gapS}s apart (about ${Math.ceil(Math.min(opts.max, todo.length, cap) * opts.gapS / 60)} min)`);
    if (!opts.commit) { log('DRY RUN: nothing fetched. Add --commit.'); return { ok: true, todo: todo.length }; }
    for (const f of todo.slice(0, opts.max)) {
      try {
        // The -index-headers page first; a filing too old to have it (404,
        // or already known missing) is read from its plain -index.htm.
        const prior = A.db.prepare('select status, via from indexed where accn = ?').get(f.accn);
        let buf = null, via = null, docs = [];
        if (!(prior && prior.status === 404)) {
          buf = await get(archiveBase(f.cik, f.accn) + f.accn + '-index-headers.html', gapMs, cap, { missingOk: true });
          summary.requests++;
          if (buf) { via = 'headers'; docs = Q.parseIndex(buf.toString('utf8')); }
        }
        if (!buf) {
          buf = await get(archiveBase(f.cik, f.accn) + f.accn + '-index.htm', gapMs, cap, { missingOk: true });
          summary.requests++;
          via = 'page';
          if (buf) docs = Q.parseIndexPage(buf.toString('utf8'));
        }
        A.writeIndex(f.accn, buf ? 200 : 404, docs, via);
        summary.indexed++;
        const pick = Q.pickDocs(docs);
        log(`${f.filed} ${f.symbol || f.filer} ${f.form} ${f.accn}: ${docs.length} documents; to read: ${pick.map((d) => d.type + ' ' + d.file + (d.description ? ' "' + d.description.slice(0, 50) + '"' : '')).join(', ') || 'none'}`);
      } catch (e) {
        log(`${f.accn}: ${e.message}`);
        if (e.stop) { deps.endRun(summary); return { ok: false, stopped: e.message, ...summary }; }
      }
    }
    deps.endRun(summary);
    log(`done: ${summary.indexed} indexed with ${summary.requests} requests.`);
    return { ok: true, ...summary };
  }

  // --recheck: the checks run again over the stored answers and texts, after
  // a change to acq.js check(). No request, no model, nothing spent.
  if (opts.recheck) {
    let n = 0, changed = 0;
    for (const r of A.db.prepare('select * from reads where answer is not null').all()) {
      const text = A.textOf(r.accn, r.file);
      if (text == null) continue;
      const c = Q.check(JSON.parse(r.answer), text);
      if (JSON.stringify(c.problems) !== (r.problems || '[]').replace(/^null$/, '[]')) changed++;
      if (opts.commit) A.writeRead(r.accn, r.file, { ...c.read, model: r.model, problems: c.problems, in_tok: r.in_tok, out_tok: r.out_tok, usd: r.usd, answer: JSON.parse(r.answer) }, c.periods);
      n++;
    }
    log(`${n} readings checked again; ${changed} with different problems${opts.commit ? '; written' : ' (DRY RUN: add --commit to write)'}.`);
    return { ok: true, n, changed };
  }

  if (opts.read) {
    const todo = [];
    // --stored: only exhibits whose text is already on disk (a re-read after a
    // change to the reader): no request to the SEC at all.
    for (const f of queue(A, opts, 'read')) for (const d of Q.pickDocs(A.docsOf(f.accn))) {
      if (opts.stored && A.textOf(f.accn, d.file) == null) continue;
      if (opts.force || !A.isRead(f.accn, d.file)) todo.push({ f, d });
    }
    log(`${todo.length} exhibits to read; this run: up to ${Math.min(opts.max, todo.length)}, at most $${opts.maxUsd}`);
    if (!opts.commit) { log('DRY RUN: nothing fetched or read. Add --commit.'); return { ok: true, todo: todo.length }; }
    if (!deps.post) throw new Error('no ANTHROPIC_API_KEY');
    for (const { f, d } of todo.slice(0, opts.max)) {
      if (summary.usd >= opts.maxUsd) { log(`reached the $${opts.maxUsd} cap`); break; }
      try {
        let text = A.textOf(f.accn, d.file);
        if (text == null) {
          if (opts.stored) continue;   // never reached: --stored keeps only stored texts
          const buf = await get(archiveBase(f.cik, f.accn) + d.file, gapMs, cap, { missingOk: true });
          summary.requests++;
          if (!buf) { A.writeRead(f.accn, d.file, { model: null, kind: 'missing', problems: ['404 from sec.gov'] }, []); continue; }
          const raw = buf.toString('latin1');
          text = /\.txt$/i.test(d.file) && !/<html|<table/i.test(raw) ? raw : Rel.toText(raw);
          A.writeText(f.accn, d.file, text);
        }
        const a = await ask(text, deps);
        summary.usd += a.usd;
        const c = Q.check(a.ans, text);
        A.writeRead(f.accn, d.file, { ...c.read, model: Q.MODEL, problems: c.problems, in_tok: a.in_tok, out_tok: a.out_tok, usd: a.usd, answer: a.ans }, c.periods);
        summary.read++;
        if (c.read.is_business) summary.business++;
        summary.problems += c.problems.length;
        const p0 = c.periods[0];
        const $ = (v) => (v == null ? '—' : '$' + (v / 1e6).toFixed(1) + 'M');
        log(`${f.filed} ${f.symbol || f.filer} ${d.file}: ${c.read.kind}${c.read.business ? ' — ' + c.read.business : ''}${p0 ? ` · ${p0.label}: revenue ${$(p0.revenue)}, net ${$(p0.net_income)}, assets ${$(p0.total_assets)}` : ''}${c.read.auditor ? ' · ' + c.read.auditor : ''}${c.problems.length ? ` · ${c.problems.length} problem(s)` : ''} ($${a.usd.toFixed(4)})`);
      } catch (e) {
        if (e.usd) summary.usd += e.usd;
        log(`${f.accn} ${d.file}: ${e.message}`);
        if (e.stop) { deps.endRun(summary); return { ok: false, stopped: e.message, ...summary }; }
      }
    }
    deps.endRun(summary);
    log(`done: ${summary.read} read (${summary.business} a business's statements), ${summary.requests} SEC requests, $${summary.usd.toFixed(3)}.`);
    return { ok: true, ...summary };
  }
  log('say --list, --index or --read (or --stats, --search)');
  return { ok: true };
}


function fileDeps(archive, args) {
  fs.mkdirSync(DIR, { recursive: true });
  const runAt = archive.startRun(args);
  const KEY = process.env.ANTHROPIC_API_KEY || '';
  return {
    fetch: (...a) => fetch(...a),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    universe: universeTickers(),
    newestList: () => { const f = fs.readdirSync(DIR).filter((n) => /^submissions-\d{4}-\d{2}-\d{2}\.zip$/.test(n)).sort().pop(); return f ? path.join(DIR, f) : null; },
    endRun: (s) => archive.endRun(runAt, s),
    post: KEY ? async (body) => {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
      return { status: r.status, retryAfter: Number(r.headers.get('retry-after')) || 0, body: await r.json().catch(() => ({})) };
    } : null,
  };
}

// One run at a time: a lock file naming the process; a stale one is cleared.
function lock() {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(LOCK)) {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch (_) { /* not running */ }
    if (alive) throw new Error(`another acq-load run (pid ${pid}) is going; one at a time`);
  }
  fs.writeFileSync(LOCK, String(process.pid));
  return () => { try { fs.unlinkSync(LOCK); } catch (_) { /* gone */ } };
}

if (require.main === module) {
  const opts = options(process.argv);
  opts.closings = process.argv.includes('--closings');
  let unlock = () => {};
  (async () => {
    if (!(opts.search || opts.stats)) unlock = lock();
    const archive = require('./acqarchive.js').open();
    try {
      const r = await run(opts, { ...fileDeps(archive, process.argv.slice(2).join(' ')), archive });
      if (!r.ok) process.exitCode = 1;
    } finally { archive.close(); unlock(); }
  })().catch((e) => { console.error(e.message); unlock(); process.exit(1); });
}

module.exports = { options, makeGetter, buildList, queue, ask, run, universeTickers, DAY_CAP, MIN_GAP_S, LIST_URL, DIR };
