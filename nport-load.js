// Which funds hold each tracked stock (Form N-PORT): read the SEC's two
// newest quarterly data sets and write one summary per stock.
//
// LOCAL, AND ONLY LOCAL. Each data set is a 460MB download whose holdings
// table is close to a gigabyte unpacked. It is kept on disk and streamed,
// never loaded (zipread.js `streamLines`). This runs on the owner's machine,
// takes a few minutes, and writes about 1,300 short rows. The rules for what
// counts are nport.js.
//
// WHEN TO RUN IT. Four times a year, after the SEC publishes a new data set
// (a few weeks after each calendar quarter ends). It reads whichever two are
// newest and says which. Nothing schedules this.
//
// IT NEEDS THE SECURITY-CODE MAP that inst13f-load.js writes (`cusip_map`):
// a fund report names a holding by CUSIP, as a 13F does. Run that one first
// on a fresh database.
//
//   node --use-system-ca nport-load.js                  # report, write nothing
//   node --use-system-ca nport-load.js --commit
//   node --use-system-ca nport-load.js --show AAPL,GME  # print those stocks' largest funds
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const store = require('./db.js');
const Zip = require('./zipread.js');
const N = require('./nport.js');
const HolderBook = require('./holderbook.js');
const SplitAdj = require('./splitadj.js');

const COMMIT = process.argv.includes('--commit');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOW = arg('--show') ? String(arg('--show')).toUpperCase().split(',').filter(Boolean) : ['AAPL'];
const TOP = 15;

const UA = process.env.SEC_UA
  || `Tickr Lab (${process.env.REPORT_TO || process.env.MAIL_FROM || 'owner@example.com'})`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIR = path.join(os.tmpdir(), 'tickrlab-sec');
fs.mkdirSync(DIR, { recursive: true });

// A data set, kept on disk between runs: these never change once published.
// Written under a temporary name and renamed, so an interrupted download is
// never mistaken for a finished one.
async function download(url) {
  const file = path.join(DIR, url.split('/').pop());
  if (fs.existsSync(file) && fs.statSync(file).size > 1e6) return file;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (r.status === 429) throw new Error('the SEC is throttling this address (429). Try again later.');
  if (!r.ok) throw new Error(url + ' answered ' + r.status);
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(file + '.part'));
  fs.renameSync(file + '.part', file);
  await sleep(800);
  return file;
}

// One data set -> { label, byStock: Map symbol -> Map fundId -> {...}, stats }.
async function readSet(file, cusips) {
  const es = Zip.entriesOfFile(file);
  const entry = (name) => { const e = es.find((x) => x.name.toUpperCase().endsWith(name)); if (!e) throw new Error('the data set has no ' + name); return e; };
  const table = async (name, fn) => { let H = null; await Zip.streamLines(file, entry(name), (line) => { if (!H) { H = N.header(line); return; } fn(N.cols(line), H); }); };

  const subs = {};
  await table('SUBMISSION.TSV', (c, H) => { subs[c[H.ACCESSION_NUMBER]] = { filed: N.isoDate(c[H.FILING_DATE]) || '', asOf: N.isoDate(c[H.REPORT_DATE]) }; });
  const regs = {};
  await table('REGISTRANT.TSV', (c, H) => { regs[c[H.ACCESSION_NUMBER]] = String(c[H.REGISTRANT_NAME] || '').trim(); });
  const infos = {};
  await table('FUND_REPORTED_INFO.TSV', (c, H) => {
    infos[c[H.ACCESSION_NUMBER]] = { id: String(c[H.SERIES_ID] || '').trim(), name: String(c[H.SERIES_NAME] || '').trim(), nav: Number(c[H.NET_ASSETS]) || 0 };
  });
  const pick = N.pickReports(subs, infos, regs);
  const ds = N.dataset();
  let rows = 0, used = 0;
  let H = null;
  await Zip.streamLines(file, entry('FUND_REPORTED_HOLDING.TSV'), (line) => {
    if (!H) { H = N.header(line); return; }
    rows++;
    // The accession number is the first field: checked before the line is
    // split, since most rows belong to a report that does not count.
    const fund = pick.get(line.slice(0, line.indexOf('\t')));
    if (!fund) return;
    const h = N.holdingOf(N.cols(line), H);
    if (!h) return;
    const sym = cusips.get(h.cusip);
    if (!sym) return;
    ds.add(sym, fund, h.shares, h.value);
    used++;
  });
  return { byStock: ds.done(), stats: { reports: Object.keys(infos).length, funds: pick.size, rows, used } };
}

(async () => {
  const universe = (await store.readUniverse()).map((s) => String(s).toUpperCase());
  const cusips = await store.readCusipMap();
  if (cusips.size < 100) throw new Error('no security-code map on file. Run inst13f-load.js --commit first: it writes the map this needs.');
  console.log(`security codes on file: ${cusips.size}`);

  const r = await fetch('https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error('the SEC page answered ' + r.status);
  const html = await r.text();
  const sets = [...new Set([...html.matchAll(/href="([^"]+_nport\.zip)"/g)].map((m) => (m[1].startsWith('http') ? m[1] : 'https://www.sec.gov' + m[1])))].slice(0, 2);
  if (!sets.length) throw new Error('no N-PORT data set found on the SEC page');
  const label = (u) => u.split('/').pop().replace(/_nport\.zip$/i, '');
  console.log('data sets: ' + sets.map(label).join(' and '));

  let t0 = Date.now();
  const cur = await readSet(await download(sets[0]), cusips);
  console.log(`${label(sets[0])}: ${cur.stats.funds.toLocaleString()} funds, ${cur.stats.rows.toLocaleString()} holdings rows read, `
    + `${cur.stats.used.toLocaleString()} are a long position in a tracked stock; ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  let prev = null;
  if (sets[1]) {
    t0 = Date.now();
    prev = await readSet(await download(sets[1]), cusips);
    console.log(`${label(sets[1])}: ${prev.stats.funds.toLocaleString()} funds, ${prev.stats.used.toLocaleString()} positions in a tracked stock; ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  // ACROSS A SPLIT (2026-10-16): each fund's earlier holding on the footing
  // of its later report. A fund reports as of its own date, so the window is
  // that fund's two dates; a fund with no later report uses the newest date
  // in this set (splitadj.js).
  if (prev) {
    let lo = null, hi = null;
    for (const m of prev.byStock.values()) for (const h of m.values()) if (h.asOf && (!lo || h.asOf < lo)) lo = h.asOf;
    for (const m of cur.byStock.values()) for (const h of m.values()) if (h.asOf && (!hi || h.asOf > hi)) hi = h.asOf;
    if (lo && hi) {
      const listed = await store.readSplitsBetween(lo, hi);
      // Only the factors the funds' own share counts confirm (splitadj.js).
      const conf = SplitAdj.confirmed(cur.byStock, prev.byStock, listed, () => [lo, hi]);
      for (const x of conf.report) console.log(`  ${x.sym.padEnd(6)} factor ${x.f.toFixed(4)}, funds' median ratio ${x.med == null ? '-' : x.med.toFixed(4)} over ${x.n}: ${x.kept ? 'a split, applied' : 'left alone'}`);
      const splits = conf.splits;
      const a = SplitAdj.adjustPrev(prev.byStock, splits, (sym, id, h) => h.asOf,
        (sym, id) => { const c = cur.byStock.get(sym); const h = c && c.get(id); return (h && h.asOf) || hi; });
      prev.byStock = a.prev;
      console.log(`splits between the two sets: ${a.symbols.length ? a.symbols.join(' ') : 'none'}; ${a.adjusted.toLocaleString()} fund holdings put on the later footing`);
    }
  }
  // One price a stock, for valuing a change in shares and an exit: the
  // median of what the funds themselves reported (value over shares).
  const pxOf = new Map();
  for (const [sym, m] of cur.byStock) {
    const v = [...m.values()].filter((h) => h.value > 0 && h.shares > 0).map((h) => h.value / h.shares).sort((a, b) => a - b);
    if (v.length) pxOf.set(sym, v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2);
  }

  const rows = [];
  for (const sym of universe) {
    const c = cur.byStock.get(sym);
    if (!c) continue;
    const s = N.summarise(c, prev ? prev.byStock.get(sym) || new Map() : null, TOP);
    if (!s.funds) continue;
    rows.push(Object.assign({ symbol: sym, label: label(sets[0]), prevLabel: prev ? label(sets[1]) : null }, s));
  }
  console.log(`\n${rows.length} of ${universe.length} tracked symbols are held by at least one fund`);
  for (const sym of SHOW) {
    const x = rows.find((y) => y.symbol === sym);
    if (!x) { console.log(`\n${sym}: nothing`); continue; }
    console.log(`\n${sym}: ${x.funds.toLocaleString()} funds hold ${(x.shares / 1e6).toFixed(1)}M shares, reports as of ${N.span(x.from, x.to)}`
      + (x.sharesPrev == null ? '' : `; shares ${N.change(x.shares, x.sharesPrev) >= 0 ? '+' : ''}${(N.change(x.shares, x.sharesPrev) || 0).toFixed(1)}% on the set before, ${x.added} new, ${x.exited} gone`));
    for (const h of x.top.slice(0, 8)) {
      console.log(`   ${h.name.slice(0, 46).padEnd(46)} ${(h.shares / 1e6).toFixed(1).padStart(8)}M  ${h.weight == null ? '    —' : h.weight.toFixed(2).padStart(5) + '%'} of the fund  ${h.asOf}`);
    }
  }
  // EACH FUND'S BOOK, from the same positions. A fund's own reported value
  // is used: one fund's figures are in one unit, unlike a manager's 13F.
  const books = [...HolderBook.invert(cur.byStock, prev ? prev.byStock : null, {
    keyOf: (id) => N.fundKey(id), sharesOf: (h) => h.shares,
    valueOf: (sym, h) => (h.value > 0 ? h.value : null),
    priceOf: (sym) => pxOf.get(sym) || null,
    meta: (id, h) => ({ name: h.name, family: h.family, asOf: h.asOf, nav: h.nav }),
  }).values()].map((b) => HolderBook.finish(b)).filter((b) => b.positions > 0);
  books.sort((a, b) => (b.value || 0) - (a.value || 0));
  const BOOK_KIND = 'F', BOOK_LABEL = label(sets[0]);
  console.log(`\n${books.length.toLocaleString()} funds hold at least one tracked stock. The largest in tracked stocks:`);
  for (const b of books.slice(0, 8)) console.log(`   ${b.name.slice(0, 50).padEnd(50)} $${((b.value || 0) / 1e9).toFixed(0).padStart(5)}B in ${String(b.positions).padStart(5)} stocks`);
  if (COMMIT) {
    // Small batches, each tried twice: the connection has sat idle through
    // minutes of parsing, and these are upserts (inst13f-load.js's lesson).
    let n = 0;
    const failed = [];
    for (let i = 0; i < rows.length; i += 25) {
      const part = rows.slice(i, i + 25);
      let done = false, why = '';
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        try { n += await store.writeFundHolders(part); done = true; } catch (e) { why = e.message; await sleep(1500); }
      }
      if (!done) failed.push(part[0].symbol + '..' + part[part.length - 1].symbol + ': ' + why);
    }
    console.log(`\nwritten: ${n} of ${rows.length} stocks`);
    for (const f of failed) console.log('  NOT WRITTEN ' + f);
    if (failed.length) process.exitCode = 1;
    // THE HOLDERS' BOOKS: the same rows turned round, one a holder.
    {
      const started = Date.now();
      let bn = 0;
      const bfailed = [];
      for (let i = 0; i < books.length; i += 20) {
        const part = books.slice(i, i + 20);
        let done = false, why = '';
        for (let attempt = 0; attempt < 2 && !done; attempt++) {
          try { bn += await store.writeHolderBooks(BOOK_KIND, BOOK_LABEL, part); done = true; } catch (e) { why = e.message; await sleep(1500); }
        }
        if (!done) bfailed.push(part[0].name + ' ..: ' + why);
        if ((i / 20) % 100 === 99) console.log(`  books: ${bn} of ${books.length} written`);
      }
      // Only after every batch went in: a holder absent from this load held
      // something last time and nothing now.
      let cleared = 0;
      if (!bfailed.length) { try { cleared = await store.clearHolderBooks(BOOK_KIND, started); } catch (e) { console.log('old books not cleared: ' + e.message); } }
      console.log(`books written: ${bn} of ${books.length}` + (cleared ? `, ${cleared} from an earlier load removed from the latest list (their periods stay in holder_history)` : ''));
      const flow = HolderBook.flowList(books, BOOK_LABEL, BOOK_LABEL, prev ? label(sets[1]) : null);
      if (flow) {
        try { await store.writeFigures({ ['flow13f:F']: flow, ['flow13f:F:' + BOOK_LABEL]: flow }); console.log('net buyers and sellers among funds written'); }
        catch (e) { console.log('net buyers and sellers among funds NOT written: ' + e.message); process.exitCode = 1; }
      }
      for (const f of bfailed.slice(0, 10)) console.log('  BOOK NOT WRITTEN ' + f);
      if (bfailed.length) process.exitCode = 1;
    }
  } else console.log('\nDRY RUN: nothing written. Re-run with --commit.');
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
