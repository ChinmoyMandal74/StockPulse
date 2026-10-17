// Institutional holdings (Form 13F): read the SEC's two newest quarterly data
// sets and write one summary per tracked stock.
//
// LOCAL, AND ONLY LOCAL. Each data set is a 100MB download that unpacks to a
// 400MB table of about 3.8 million rows; that is not a serverless request.
// This runs on the owner's machine, takes a few minutes, and writes about
// 1,300 short rows. The rules for what counts are inst13f.js.
//
// WHEN TO RUN IT. Four times a year: the SEC publishes a quarter's data set
// roughly ten weeks after the quarter ends (the filings are due at 45 days).
// Running it sooner changes nothing; the script reads whatever is newest and
// says which quarter that is. Nothing schedules this.
//
// THE THREE DOWNLOADS, all from sec.gov, declared, one at a time:
//   - the two newest 13F data sets (this quarter, and last for the change);
//   - a few fails-to-deliver files, read only for the one thing they are
//     uniquely good for here: each line carries a security's CUSIP beside its
//     ticker, which is the map a 13F needs and the app did not have.
// Downloads are kept in the system temp folder and reused on a second run.
//
//   node --use-system-ca inst13f-load.js                 # report, write nothing
//   node --use-system-ca inst13f-load.js --commit
//   node --use-system-ca inst13f-load.js --show AAPL,GME # print those stocks' top holders
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./db.js');
const Zip = require('./zipread.js');
const I = require('./inst13f.js');
const HolderBook = require('./holderbook.js');
const SplitAdj = require('./splitadj.js');

const COMMIT = process.argv.includes('--commit');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOW = arg('--show') ? String(arg('--show')).toUpperCase().split(',').filter(Boolean) : ['AAPL'];
const FTD_FILES = 8;                // four months of half-monthly files
const TOP = 15;

const UA = process.env.SEC_UA
  || `Tickr Lab (${process.env.REPORT_TO || process.env.MAIL_FROM || 'owner@example.com'})`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIR = path.join(os.tmpdir(), 'tickrlab-sec');
fs.mkdirSync(DIR, { recursive: true });

async function page(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (r.status === 429) throw new Error('the SEC is throttling this address (429). Try again later.');
  if (!r.ok) throw new Error(url + ' answered ' + r.status);
  return r.text();
}
// A file from sec.gov, kept between runs: these never change once published.
async function download(url) {
  const file = path.join(DIR, url.split('/').pop());
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return fs.readFileSync(file);
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(600000) });
  if (r.status === 429) throw new Error('the SEC is throttling this address (429). Try again later.');
  if (!r.ok) throw new Error(url + ' answered ' + r.status);
  const b = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(file, b);
  await sleep(600);
  return b;
}
const zipLinks = (html) => [...new Set([...html.matchAll(/href="([^"]+\.zip)"/g)].map((m) => (m[1].startsWith('http') ? m[1] : 'https://www.sec.gov' + m[1])))];
const entry = (zip, name) => {
  const e = Zip.entries(zip).find((x) => x.name.toUpperCase().endsWith(name));
  if (!e) throw new Error('the data set has no ' + name);
  return Zip.read(zip, e);
};

// CUSIP -> symbol, for the symbols tracked here, from the fails files.
async function cusipMap(tracked) {
  const links = zipLinks(await page('https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data')).slice(0, FTD_FILES);
  // A SHARE CLASS IS WRITTEN WITHOUT ITS DOT THERE: Berkshire's B shares are
  // BRK.B here and BRKB in the fails file. Each tracked symbol is looked up
  // under both spellings, or eight companies would have no holders at all.
  const alias = new Map();
  for (const s of tracked) { alias.set(s, s); const bare = s.replace(/[.\-]/g, ''); if (bare !== s && !tracked.has(bare)) alias.set(bare, s); }
  const map = new Map();
  for (const u of links) {
    const zip = await download(u);
    const e = Zip.entries(zip)[0];
    let first = true;
    Zip.eachLine(Zip.read(zip, e), (line) => {
      if (first) { first = false; return; }
      const c = line.split('|');
      const cusip = String(c[1] || '').trim().toUpperCase(), sym = String(c[2] || '').trim().toUpperCase();
      if (cusip.length === 9 && alias.has(sym) && !map.has(cusip)) map.set(cusip, alias.get(sym));
    });
  }
  return { map, files: links.length };
}

// One data set -> { period, holders: Map symbol -> Map cik -> { name, shares, value }, stats }.
function readSet(zip, cusips) {
  const subs = [];
  let H = null;
  Zip.eachLine(entry(zip, 'SUBMISSION.TSV'), (line) => {
    if (!H) { H = I.header(line); return; }
    const c = I.cols(line);
    subs.push({ accn: c[H.ACCESSION_NUMBER], filed: I.isoDate(c[H.FILING_DATE]) || '', type: String(c[H.SUBMISSIONTYPE] || '').trim(),
      cik: String(Number(c[H.CIK]) || c[H.CIK]), period: I.isoDate(c[H.PERIODOFREPORT]) });
  });
  const covers = {};
  H = null;
  Zip.eachLine(entry(zip, 'COVERPAGE.TSV'), (line) => {
    if (!H) { H = I.header(line); return; }
    const c = I.cols(line);
    covers[c[H.ACCESSION_NUMBER]] = { name: String(c[H.FILINGMANAGER_NAME] || '').trim(), amendType: String(c[H.AMENDMENTTYPE] || '').trim() };
  });
  const period = I.mainPeriod(subs);
  const pick = I.chosen(subs, covers, period);
  const q = I.quarter();
  let rows = 0, used = 0, options = 0;
  H = null;
  Zip.eachLine(entry(zip, 'INFOTABLE.TSV'), (line) => {
    if (!H) { H = I.header(line); return; }
    rows++;
    // The accession number is the first field: checked before the line is
    // split, since nine rows in ten belong to a filing that does not count
    // or a security that is not tracked.
    const tab = line.indexOf('\t');
    const who = pick.get(line.slice(0, tab));
    if (!who) return;
    const c = I.cols(line);
    if (String(c[H.PUTCALL] || '').trim()) { options++; return; }
    const h = I.holdingOf(c, H);
    if (!h) return;
    const sym = cusips.get(h.cusip);
    if (!sym) return;
    q.add(sym, who.cik, who.name, h.shares, h.value);
    used++;
  });
  return { period, holders: q.done(), stats: { filings: subs.length, managers: new Set([...pick.values()].map((x) => x.cik)).size, rows, used, options } };
}

(async () => {
  const universe = (await store.readUniverse()).map((s) => String(s).toUpperCase());
  const tracked = new Set(universe);
  const sets = zipLinks(await page('https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets')).filter((u) => /form13f\.zip$/i.test(u)).slice(0, 2);
  if (sets.length < 1) throw new Error('no 13F data set found on the SEC page');
  console.log('data sets: ' + sets.map((u) => u.split('/').pop()).join(' and '));

  const cm = await cusipMap(tracked);
  const mapped = new Set(cm.map.values());
  console.log(`security codes: ${cm.map.size} mapped to ${mapped.size} of ${universe.length} tracked symbols, from ${cm.files} fails-to-deliver files`);

  let t0 = Date.now();
  const cur = readSet(await download(sets[0]), cm.map);
  console.log(`${I.quarterName(cur.period)} (period ${cur.period}): ${cur.stats.managers} managers, ${cur.stats.rows.toLocaleString()} rows read, `
    + `${cur.stats.used.toLocaleString()} are plain holdings of a tracked stock, ${cur.stats.options.toLocaleString()} option rows left out; ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  let prev = null;
  if (sets[1]) {
    t0 = Date.now();
    prev = readSet(await download(sets[1]), cm.map);
    console.log(`${I.quarterName(prev.period)} (period ${prev.period}): ${prev.stats.managers} managers, ${prev.stats.used.toLocaleString()} holdings of a tracked stock; ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (!(prev.period < cur.period)) { console.log('  the second set is not an earlier quarter; no change will be computed.'); prev = null; }
  }
  // ACROSS A SPLIT (2026-10-16): last quarter's shares on this quarter's
  // footing, or every holder of a stock that split between the two quarter
  // ends reads as buying (splitadj.js).
  if (prev) {
    const listed = await store.readSplitsBetween(prev.period, cur.period);
    // Only the factors the holders' own share counts confirm (splitadj.js):
    // a spin-off's price factor is not a change in shares.
    const conf = SplitAdj.confirmed(cur.holders, prev.holders, listed, () => [prev.period, cur.period]);
    for (const x of conf.report) console.log(`  ${x.sym.padEnd(6)} factor ${x.f.toFixed(4)}, holders' median ratio ${x.med == null ? '-' : x.med.toFixed(4)} over ${x.n}: ${x.kept ? 'a split, applied' : 'not a change in shares, left alone'}`);
    const splits = conf.splits;
    const a = SplitAdj.adjustPrev(prev.holders, splits, () => prev.period, () => cur.period);
    prev.holders = a.prev;
    console.log(`splits between the two quarter ends: ${a.symbols.length ? a.symbols.join(' ') : 'none'}; ${a.adjusted.toLocaleString()} holdings put on this quarter's footing`);
  }

  // Shares outstanding, to catch a manager who filed in the wrong units.
  const snap = await store.readSnapshot();
  const out = {};
  for (const r of ((snap && snap.stocks) || [])) if (r && r.symbol) out[String(r.symbol).toUpperCase()] = Number(r.sharesOutstanding) || 0;

  // Every manager with a report in each set: who can be compared (inst13f.js).
  const filersIn = (set) => { const s = new Set(); for (const m of set.holders.values()) for (const cik of m.keys()) s.add(cik); return s; };
  const filers = prev ? { prev: filersIn(prev), cur: filersIn(cur) } : null;
  const rows = [];
  let dropped = 0;
  for (const sym of universe) {
    const c = cur.holders.get(sym);
    if (!c) continue;
    const s = I.summarise(c, prev ? prev.holders.get(sym) || new Map() : null, out[sym], TOP, filers);
    dropped += s.dropped;
    if (!s.managers) continue;
    rows.push(Object.assign({ symbol: sym, period: cur.period, prevPeriod: prev ? prev.period : null }, s));
  }
  console.log(`\n${rows.length} of ${universe.length} tracked symbols have holders on file; ${dropped} manager positions dropped as larger than the whole company`);
  const noMap = universe.filter((s) => !mapped.has(s));
  console.log(`${noMap.length} symbols have no security code mapped` + (noMap.length ? ': ' + noMap.slice(0, 30).join(' ') + (noMap.length > 30 ? ' ...' : '') : ''));
  for (const sym of SHOW) {
    const r = rows.find((x) => x.symbol === sym);
    if (!r) { console.log(`\n${sym}: nothing`); continue; }
    const pct = I.pctOf(r.shares, out[sym]);
    console.log(`\n${sym} ${I.quarterName(r.period)}: ${r.managers} managers hold ${(r.shares / 1e6).toFixed(1)}M shares`
      + (pct == null ? '' : ` (${pct.toFixed(1)}% of shares outstanding)`) + (r.value == null ? '' : `, $${(r.value / 1e9).toFixed(1)}B at $${r.px.toFixed(2)}`)
      + (r.sharesPrev == null ? '' : `; shares held ${I.change(r.shares, r.sharesPrev) >= 0 ? '+' : ''}${(I.change(r.shares, r.sharesPrev) || 0).toFixed(1)}% on the quarter, ${r.added} new, ${r.exited} gone`));
    for (const h of r.top.slice(0, 8)) {
      const ch = h.prev == null ? '' : h.prev === 0 ? ' new' : ' ' + (h.shares / h.prev - 1 >= 0 ? '+' : '') + ((h.shares / h.prev - 1) * 100).toFixed(1) + '%';
      console.log(`   ${h.name.slice(0, 38).padEnd(38)} ${(h.shares / 1e6).toFixed(1).padStart(9)}M${ch}`);
    }
  }
  // EACH MANAGER'S BOOK, from the same holders: a position valued at the
  // stock's one price and left out where the stock's summary left it out.
  const pxOf = new Map(rows.map((r) => [r.symbol, r.px]));
  const capOf = new Map(universe.map((s) => [s, I.shareCap(cur.holders.get(s), out[s])]));
  const keep = (sym, h) => !(capOf.get(sym) && h.shares > capOf.get(sym));
  const names = new Map();
  const books = [...HolderBook.invert(cur.holders, prev ? prev.holders : null, {
    keyOf: (cik) => String(cik), sharesOf: (h) => h.shares, keep,
    valueOf: (sym, h) => (pxOf.get(sym) > 0 ? h.shares * pxOf.get(sym) : null),
    priceOf: (sym) => pxOf.get(sym) || null,
    meta: (cik, h) => ({ name: h.name, asOf: cur.period }),
  }).values()].map((b) => HolderBook.finish(b)).filter((b) => b.positions > 0);
  books.sort((a, b) => (b.value || 0) - (a.value || 0));
  const BOOK_KIND = 'M', BOOK_LABEL = I.quarterName(cur.period);
  console.log(`\n${books.length.toLocaleString()} managers hold at least one tracked stock. The largest in tracked stocks:`);
  for (const b of books.slice(0, 8)) console.log(`   ${b.name.slice(0, 44).padEnd(44)} $${((b.value || 0) / 1e9).toFixed(0).padStart(5)}B in ${String(b.positions).padStart(5)} stocks` + (b.added == null ? '' : `, ${b.added} new, ${b.exited} gone`));
  // THE QUARTER'S NET BUYERS AND SELLERS in tracked stocks, at constant
  // prices: one stored figure, so the directory reads one row, not thousands.
  const flow = HolderBook.flowList(books, I.quarterName(cur.period), cur.period, prev ? prev.period : null);
  if (flow) {
    console.log('');
    console.log('net buyers in tracked stocks, at quarter-end prices:');
    for (const x of flow.buyers.slice(0, 6)) console.log(`   ${x.name.slice(0, 44).padEnd(44)} +$${(x.net / 1e9).toFixed(1)}B  (bought $${(x.bought / 1e9).toFixed(1)}B, sold $${(x.sold / 1e9).toFixed(1)}B, holds $${((x.value || 0) / 1e9).toFixed(0)}B)`);
    console.log('net sellers:');
    for (const x of flow.sellers.slice(0, 6)) console.log(`   ${x.name.slice(0, 44).padEnd(44)} -$${(-x.net / 1e9).toFixed(1)}B`);
  }
  if (COMMIT) {
    // IN SMALL BATCHES, EACH TRIED TWICE, and a batch that still fails is
    // reported and skipped rather than ending the run. The connection has sat
    // idle through a minute of parsing by now and the first write on it can
    // fail outright ("fetch failed"); db.js never retries a write, rightly,
    // but these are upserts keyed on the symbol, so writing one twice is the
    // same as writing it once. The first version sent everything in one go
    // and lost the whole run to that first failure, twice.
    let n = 0;
    const failed = [];
    for (let i = 0; i < rows.length; i += 25) {
      const part = rows.slice(i, i + 25);
      let done = false, why = '';
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        try { n += await store.writeInstHoldings(part); done = true; } catch (e) {
          why = e.message + (e.cause ? ' (' + (e.cause.code || e.cause.message) + ')' : '');
          await sleep(1500);
        }
      }
      if (!done) failed.push(part[0].symbol + '..' + part[part.length - 1].symbol + ': ' + why);
    }
    let codes = 0;
    try { codes = await store.writeCusipMap([...cm.map].map(([cusip, symbol]) => ({ cusip, symbol }))); }
    catch (e) { console.log('security codes not written: ' + e.message); }
    console.log(`\nwritten: ${n} of ${rows.length} stocks, ${codes} security codes`);
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
      console.log(`books written: ${bn} of ${books.length}` + (cleared ? `, ${cleared} from an earlier load removed from the latest list (their quarters stay in holder_history)` : ''));
      if (flow) {
        try { await store.writeFigures({ ['flow13f:M']: flow, ['flow13f:M:' + flow.period]: flow }); console.log('net buyers and sellers written'); }
        catch (e) { console.log('net buyers and sellers NOT written: ' + e.message); process.exitCode = 1; }
      }
      for (const f of bfailed.slice(0, 10)) console.log('  BOOK NOT WRITTEN ' + f);
      if (bfailed.length) process.exitCode = 1;
    }
  } else console.log('\nDRY RUN: nothing written. Re-run with --commit.');
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
