// Earlier quarters of Form 13F, into the HISTORY TABLES ONLY (2026-10-17).
//
// The owner, asked what the new history could show: "go" on backfilling two
// years so the stock page and the holder pages can draw quarters now, rather
// than after two years of quarterly loads. The SEC keeps every quarter's data
// set online, so the same reading code (inst13f-load.js) and the same rules
// (inst13f.js, holderbook.js, splitadj.js) are run on each pair of
// consecutive quarters.
//
// WHAT IT WRITES: inst_history (one row a stock a quarter) and holder_history
// (one row a manager a quarter, its 50 largest positions rather than the live
// load's 250: eight quarters of 8,000 managers is otherwise most of the
// database), plus each quarter's net buyers and sellers figure. NEVER the
// latest tables (inst_holdings, holder_books), and never over a quarter
// already on file (`do nothing` on conflict), so the live load's copy wins.
//
// LIMITS, said on every surface that draws it: only stocks tracked today are
// matched, through today's CUSIP map, so a company whose security code has
// since changed may be missing from its older quarters.
//
//   node --use-system-ca --max-old-space-size=6144 inst13f-backfill.js                 # report
//   node --use-system-ca --max-old-space-size=6144 inst13f-backfill.js --commit --quarters 8
require('dotenv').config();
const store = require('./db.js');
const L = require('./inst13f-load.js');
const I = require('./inst13f.js');
const HolderBook = require('./holderbook.js');
const SplitAdj = require('./splitadj.js');

const COMMIT = process.argv.includes('--commit');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const QUARTERS = Math.max(1, Math.min(20, Number(arg('--quarters')) || 8));
const BOOK_CAP = 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function inBatches(list, size, write, what) {
  let n = 0;
  const failed = [];
  for (let i = 0; i < list.length; i += size) {
    const part = list.slice(i, i + size);
    let done = false, why = '';
    for (let a = 0; a < 2 && !done; a++) {
      try { n += await write(part); done = true; } catch (e) { why = e.message; await sleep(1500); }
    }
    if (!done) failed.push(what + ' ' + i + ': ' + why);
  }
  return { n, failed };
}

(async () => {
  const universe = (await store.readUniverse()).map((s) => String(s).toUpperCase());
  const tracked = new Set(universe);
  const sets = L.zipLinks(await L.page('https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets')).filter((u) => /form13f\.zip$/i.test(u));
  console.log(`${sets.length} data sets listed; this run reads ${QUARTERS + 1} after the newest (the newest is the live load's)`);
  // Today's map, widened by what earlier loads stored.
  const cm = await L.cusipMap(tracked);
  for (const [c, s] of await store.readCusipMap()) if (tracked.has(s) && !cm.map.has(c)) cm.map.set(c, s);
  console.log(`security codes: ${cm.map.size}`);
  const snap = await store.readSnapshot();
  const out = {};
  for (const r of ((snap && snap.stocks) || [])) if (r && r.symbol) out[String(r.symbol).toUpperCase()] = Number(r.sharesOutstanding) || 0;

  let cur = null;
  const failedAll = [];
  for (let k = 1; k <= QUARTERS && k + 1 < sets.length; k++) {
    const t0 = Date.now();
    cur = cur || L.readSet(await L.download(sets[k]), cm.map);
    const prev = L.readSet(await L.download(sets[k + 1]), cm.map);
    const label = I.quarterName(cur.period);
    if (!(prev.period < cur.period)) { console.log(`${label}: the set before is not an earlier quarter (${prev.period}); skipped`); cur = prev; continue; }
    // The same three decisions as the live load.
    const listed = await store.readSplitsBetween(prev.period, cur.period);
    const conf = SplitAdj.confirmed(cur.holders, prev.holders, listed, () => [prev.period, cur.period]);
    const prevAdj = SplitAdj.adjustPrev(prev.holders, conf.splits, () => prev.period, () => cur.period).prev;
    const filersIn = (h) => { const s = new Set(); for (const m of h.values()) for (const cik of m.keys()) s.add(cik); return s; };
    const filers = { prev: filersIn(prevAdj), cur: filersIn(cur.holders) };
    const rows = [];
    for (const sym of universe) {
      const c = cur.holders.get(sym);
      if (!c) continue;
      const s = I.summarise(c, prevAdj.get(sym) || new Map(), out[sym], L.TOP, filers);
      if (!s.managers) continue;
      rows.push(Object.assign({ symbol: sym, period: cur.period, prevPeriod: prev.period }, s));
    }
    const pxOf = new Map(rows.map((r) => [r.symbol, r.px]));
    const capOf = new Map(universe.map((s) => [s, I.shareCap(cur.holders.get(s), out[s])]));
    const books = [...HolderBook.invert(cur.holders, prevAdj, {
      keyOf: (cik) => String(cik), sharesOf: (h) => h.shares, keep: (sym, h) => !(capOf.get(sym) && h.shares > capOf.get(sym)),
      valueOf: (sym, h) => (pxOf.get(sym) > 0 ? h.shares * pxOf.get(sym) : null), priceOf: (sym) => pxOf.get(sym) || null,
      meta: (cik, h) => ({ name: h.name, asOf: cur.period }),
    }).values()].map((b) => HolderBook.finish(b, BOOK_CAP)).filter((b) => b.positions > 0);
    const flow = HolderBook.flowList(books, label, cur.period, prev.period);
    console.log(`${label}: ${rows.length} stocks, ${books.length.toLocaleString()} managers, splits applied ${[...conf.splits.keys()].join(' ') || 'none'}; ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (COMMIT) {
      const a = await inBatches(rows, 100, (p) => store.writeInstHistoryOnly(p), label + ' stocks');
      const b = await inBatches(books, 50, (p) => store.writeHolderHistoryOnly('M', label, p), label + ' books');
      try { if (flow) await store.writeFigures({ ['flow13f:M:' + cur.period]: flow }); } catch (e) { failedAll.push(label + ' flow: ' + e.message); }
      console.log(`  written: ${a.n} stocks, ${b.n} books`);
      failedAll.push(...a.failed, ...b.failed);
    }
    cur = prev;
  }
  if (failedAll.length) { console.log('NOT WRITTEN:'); for (const f of failedAll.slice(0, 20)) console.log('  ' + f); process.exitCode = 1; }
  if (!COMMIT) console.log('\nDRY RUN: nothing written. Re-run with --commit.');
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
