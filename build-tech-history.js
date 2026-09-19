// Build `tech_history` — the all-technical verdict at weekly marks, back to
// the start of the bar archive.
//
//   node --use-system-ca build-tech-history.js                 # dry run
//   node --use-system-ca build-tech-history.js --commit        # write to Turso
//   node --use-system-ca build-tech-history.js --commit --from 2015-01-01
//   node --use-system-ca build-tech-history.js --commit --only MU,AAPL
//
// WHY A TABLE AND NOT A LIVE QUERY. The archive is 1.7M bars; a measured whole-
// archive read sits close to the ~3-minute response wall this project already
// hit, and Turso meters rows read. This table is ~344k rows and a one-year
// window of it is ~22k rows in 60ms, so a twenty-year sweep reads it once
// instead of reading `bars` at all.
//
// WHY IT CAN EXIST AT ALL. Every field is derived from a symbol's own bars —
// no fundamentals, no universe, no API. That is what frees it from
// `fundamentals_history`, which starts on 2026-08-30 and is what caps the
// advice backtest at two months. It also means this table is REBUILDABLE:
// delete it and run this again.
//
// Runs against the LOCAL analysis copy (`analysis.db`), never Turso, for the
// reason analysis-db.js exists — the same 300x that makes research bearable.
// Re-run `analysis-db.js --full` first after any deep backfill: an incremental
// sync only moves forward and will never see newly-added OLD bars.
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const Action = require('./private/action.js');
const TechRow = require('./techrow.js');
const store = require('./db.js');

const COMMIT = process.argv.includes('--commit');
const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const FROM = argOf('--from', '1900-01-01');
const ONLY = argOf('--only', '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const LOCAL = path.resolve('analysis.db');

// The verdict stored in `action`/`flag` is Balanced's. The row keeps every
// input the rules read, so a page can re-evaluate any preset at read time —
// this is the convenient default, not the only answer available.
const { cfg } = Action.resolve(null, 'Balanced');

// A mark is stale if the symbol has not traded within this many days of it.
// Without the guard a delisted-then-relisted name, or a foreign listing over a
// long holiday, carries a price forward into a week it never traded.
const STALE_DAYS = 8;

const fmt = (n) => n.toLocaleString('en-US');

(async () => {
  if (!fs.existsSync(LOCAL)) {
    console.error(`No ${LOCAL}. Run:  node --use-system-ca analysis-db.js --full`);
    process.exit(1);
  }
  const db = new DatabaseSync(LOCAL, { readOnly: true });

  const universe = db.prepare('select distinct symbol from bars order by symbol').all()
    .map((r) => r.symbol)
    .filter((s) => !ONLY.length || ONLY.includes(s));

  // The canonical weekly marks come from the UNION of trading days, not from
  // any one symbol: every symbol must land on the same dates or an equal-weight
  // basket is not measured on one day. The last session of each ISO week wins.
  const allDates = db.prepare('select distinct d from bars where d >= ? order by d').all(FROM)
    .map((r) => r.d);
  const markOf = new Map();                       // "year-week" -> the week's last date
  for (const d of allDates) {
    const t = Date.parse(d + 'T00:00:00Z');
    const wk = Math.floor(t / (7 * 86400000));    // seven-day buckets from the epoch
    markOf.set(wk, d);                            // dates ascend, so the last wins
  }
  const marks = [...markOf.values()].sort();

  console.log(`local archive : ${fmt(allDates.length)} trading days, ${allDates[0]} → ${allDates[allDates.length - 1]}`);
  console.log(`symbols       : ${universe.length}${ONLY.length ? ' (--only)' : ''}`);
  console.log(`weekly marks  : ${fmt(marks.length)}`);
  console.log(`rules         : ${cfg.profile} (stored as the default; every input is stored too)`);
  console.log(`mode          : ${COMMIT ? 'COMMIT — writing to Turso' : 'DRY RUN — nothing will be written'}\n`);

  const out = [];
  let skippedShort = 0, skippedStale = 0, symbolsDone = 0;
  const byAction = new Map();

  for (const sym of universe) {
    const rows = db.prepare('select d, high, close, volume from bars where symbol = ? order by d').all(sym);
    if (rows.length < TechRow.MIN_SESSIONS) { skippedShort++; continue; }
    const dates = rows.map((r) => r.d);
    const closes = rows.map((r) => Number(r.close));
    const highs = rows.map((r) => Number(r.high) || Number(r.close));
    const vols = rows.map((r) => Number(r.volume) || 0);
    const rsi = TechRow.rsiSeries(closes);

    // Walk the marks and the sessions together — both ascend, so this is one
    // pass rather than a search per mark.
    let i = -1;
    for (const mark of marks) {
      while (i + 1 < dates.length && dates[i + 1] <= mark) i++;
      if (i < TechRow.MIN_SESSIONS - 1) continue;             // no 52-week window yet
      if (dates[i] > mark) continue;
      const gap = (Date.parse(mark) - Date.parse(dates[i])) / 86400000;
      if (gap > STALE_DAYS) { skippedStale++; continue; }
      const tech = TechRow.rowAt(closes, highs, vols, i);
      if (!tech) continue;
      // The compact shape action.js's replay helpers take. No fundamentals are
      // passed and none are read: `actionAt` runs the ETF list, which is the
      // all-technical one.
      const r = { v200: tech.vs200ma, v50: tech.vs50ma, rsi: rsi[i],
        m1: tech.oneMonthPct, m3: tech.threeMonthPct, fh: tech.pctFromHigh,
        vol: tech.volTrend, hist: tech.historyDays };
      const v = Action.actionAt(r, cfg);
      // The Trend word is its own family and is what a trend-only study reads
      // first. 'ETF' as the type: the classification is not replayable, and the
      // technical list is the one that never asks.
      const trend = Action.trendAt(r, 'ETF', cfg);
      byAction.set(v.action, (byAction.get(v.action) || 0) + 1);
      out.push({ symbol: sym, d: mark, action: v.action, flag: v.flag, trend,
        close: closes[i], vs200: tech.vs200ma, vs50: tech.vs50ma, rsi: rsi[i],
        m1: tech.oneMonthPct, m3: tech.threeMonthPct, fromHigh: tech.pctFromHigh,
        volTrend: tech.volTrend, historyDays: tech.historyDays });
    }
    symbolsDone++;
    if (symbolsDone % 50 === 0) console.log(`  …${symbolsDone}/${universe.length} symbols, ${fmt(out.length)} rows`);
  }

  console.log(`\n${fmt(out.length)} rows from ${symbolsDone} symbols`);
  console.log(`  ${skippedShort} symbols skipped: under ${TechRow.MIN_SESSIONS} sessions`);
  console.log(`  ${fmt(skippedStale)} marks skipped: no session within ${STALE_DAYS} days`);
  const total = [...byAction.values()].reduce((a, b) => a + b, 0) || 1;
  console.log('\n  verdict mix across the archive:');
  for (const a of Action.ACTIONS.slice().reverse()) {
    const n = byAction.get(a) || 0;
    console.log(`    ${a.padEnd(18)} ${String(fmt(n)).padStart(9)}  ${((n / total) * 100).toFixed(1)}%`);
  }
  // `out` is built symbol by symbol, so out[0] is the FIRST SYMBOL's earliest
  // mark rather than the archive's — printing that pair as "the span"
  // understated it by a decade. Take the real extremes, and report how many
  // symbols a sweep would actually have at each point, which is the number
  // that decides whether an early window means anything at all.
  const perMark = new Map();
  let first = null, last = null;
  for (const r of out) {
    perMark.set(r.d, (perMark.get(r.d) || 0) + 1);
    if (first === null || r.d < first) first = r.d;
    if (last === null || r.d > last) last = r.d;
  }
  console.log(`\n  span: ${first} → ${last}  (${fmt(perMark.size)} marks carrying at least one symbol)`);
  console.log('\n  symbols a sweep would have, by year:');
  const byYear = new Map();
  for (const [d, n] of perMark) {
    const y = d.slice(0, 4);
    if (!byYear.has(y) || n > byYear.get(y)) byYear.set(y, n);      // the year's best-covered mark
  }
  const years = [...byYear.keys()].sort();
  for (const y of years) {
    if (Number(y) % 2 === 1 && y !== years[years.length - 1]) continue;   // every other year, plus the last
    const n = byYear.get(y);
    console.log(`    ${y}  ${String(n).padStart(3)} symbols  ${'#'.repeat(Math.round(n / 10))}`);
  }

  if (!COMMIT) { console.log('\nRe-run with --commit to write.'); process.exit(0); }

  // RESUME. A full write is twenty minutes or more across a network and will be
  // cut at least once — the first attempt died on ECONNRESET at 258 of 430
  // symbols, having spent half an hour. A symbol already holding exactly the
  // marks computed for it is skipped; anything short is rewritten whole, which
  // the upsert makes free and which is the one case worth redoing.
  let todo = out;
  if (!process.argv.includes('--no-resume')) {
    const have = await store.techHistoryCounts();
    const wantBy = new Map();
    for (const r of out) wantBy.set(r.symbol, (wantBy.get(r.symbol) || 0) + 1);
    const done = new Set();
    for (const [sym, n] of wantBy) if (have[sym] === n) done.add(sym);
    if (done.size) {
      todo = out.filter((r) => !done.has(r.symbol));
      console.log(`\nresuming: ${done.size} symbols already complete, `
        + `${fmt(out.length - todo.length)} rows skipped`);
    }
  }
  if (!todo.length) {
    const already = await store.techHistorySpan();
    console.log(`\nnothing to write — tech_history holds ${fmt(already.rows)} rows across `
      + `${already.symbols} symbols, ${already.first} → ${already.last}.`);
    process.exit(0);
  }

  console.log('\nwriting…');
  const t0 = Date.now();
  let written = 0;
  const CHUNK = 5000;
  for (let k = 0; k < todo.length; k += CHUNK) {
    const slice = todo.slice(k, k + CHUNK);
    // A dropped socket part way through is a network event, not a data problem,
    // and the upsert means replaying a chunk costs only time.
    let ok = false;
    for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
      try { written += await store.writeTechHistory(slice); ok = true; } catch (err) {
        if (attempt === 4) throw err;
        console.log(`  chunk at ${fmt(k)} failed (${err.message}) — retrying in ${attempt * 5}s`);
        await new Promise((r) => setTimeout(r, attempt * 5000));
      }
    }
    const pct = ((k + CHUNK) / todo.length) * 100;
    console.log(`  ${fmt(Math.min(written, todo.length))} / ${fmt(todo.length)}  (${Math.min(pct, 100).toFixed(0)}%)`
      + `  ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  }
  const after = await store.techHistorySpan();
  console.log(`\nwrote ${fmt(written)} rows in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  console.log(`tech_history now: ${fmt(after.rows)} rows, ${after.symbols} symbols, ${after.first} → ${after.last}`);
  process.exit(0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
