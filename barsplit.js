// Splits and the bar archive (2026-11-08): two decisions, pure, shared by the
// price refresh (persistBars), the nightly splits step and split-repair.js.
//
// WHY THIS EXISTS. The archive holds the provider's split-adjusted series, and
// a split was noticed only by an old fetched bar disagreeing with the stored
// one, after which the symbol was REWRITTEN FROM THE FETCH. Since the live pull
// went shallow (12 bars, 2026-09-17) that rewrite deleted years of history and
// kept twelve rows: SCCO, MSGS and SOXX lost theirs that way in October and
// November. And when the provider never adjusted at all (IESC, 2-for-1 on
// 2026-08-24, still unadjusted at Twelve Data in November) nothing disagreed,
// so a 54% "fall" sat in the archive and fed every reading for ten weeks.
//
// So a split is now a MULTIPLICATION of what is stored, never a replacement:
//   windowSplit  - a fetched window that re-prices the stored bars before some
//                  date by one factor, consistently, is a split the provider
//                  has applied: scale the older stored bars by that factor.
//   storedStep   - a split the provider lists whose date shows a matching cliff
//                  in the stored closes is a split nobody applied: scale the
//                  bars before the cliff by 1/f.
// Anything that does not fit either shape is left alone and reported. Wrongly
// rescaling a symbol's whole history is worse than leaving one stale bar.
'use strict';

const TOL = 0.005;          // 0.5%: past rounding, well short of any split (as SPLIT_TOLERANCE)
const MIN_CHANGED = 2;      // one disagreeing bar is as likely a provider correction as a split
const MIN_STEP = 0.1;       // |ln f| below this (about 10%) is a stock dividend: too small to tell from a day's move
const STEP_FIT = 0.15;      // the cliff, once divided out, must leave a move under about 15%

// fetched: [{ d, close }] (any order). stored: Map of date -> stored close, for
// the fetched dates the archive holds.
// -> { kind: 'same' }                     nothing re-priced
//    { kind: 'rescale', k, changed }      every stored bar older than the window times k
//    { kind: 'conflict', why }            re-priced, but not the way a split does it
function windowSplit(fetched, stored, tol = TOL) {
  const pairs = [];
  for (const b of fetched || []) {
    const s = stored.get(b.d);
    if (s == null || !(s > 0) || !(b.close > 0)) continue;
    pairs.push({ d: b.d, r: b.close / s });
  }
  if (!pairs.length) return { kind: 'conflict', why: 'the fetched window shares no date with the archive' };
  const changed = pairs.filter((p) => Math.abs(p.r - 1) > tol);
  if (!changed.length) return { kind: 'same' };
  const same = pairs.filter((p) => Math.abs(p.r - 1) <= tol);
  // A split re-prices every bar BEFORE it and none after: the changed bars must
  // all be older than every unchanged one.
  const newestChanged = changed.reduce((a, p) => (p.d > a ? p.d : a), '');
  const oldestSame = same.reduce((a, p) => (a == null || p.d < a ? p.d : a), null);
  if (oldestSame != null && oldestSame < newestChanged) return { kind: 'conflict', why: 'bars changed on both sides of unchanged ones' };
  if (changed.length < MIN_CHANGED) return { kind: 'conflict', why: 'only one bar changed' };
  const rs = changed.map((p) => p.r).sort((a, b) => a - b);
  const k = rs[rs.length >> 1];
  if (rs.some((r) => Math.abs(r / k - 1) > tol)) return { kind: 'conflict', why: 'the changed bars disagree on the factor' };
  return { kind: 'rescale', k, changed: changed.length };
}

// True when f is p/q for whole numbers up to 20, to a millionth.
function wholeRatio(f) {
  for (let q = 1; q <= 20; q++) { const p = Math.round(f * q); if (p >= 1 && p <= 20 * q && Math.abs(p / q - f) <= 1e-6 * f) return true; }
  return false;
}

// bars: [{ d, close }] around a listed split (any order), split: { d, f } with
// f new shares per old (2 for a two-for-one). The provider's split date and
// its price step need not agree (Mueller: listed 07-01, stepped 06-25), so the
// cliff is looked for between any two consecutive stored bars in the window.
// -> { kind: 'unadjusted', at, k, pre, post }  scale every stored bar dated before `at` by k
//    { kind: 'adjusted' }                      no cliff the size of the split
//    { kind: 'skip', why }                     too small to judge, or no bars
function storedStep(bars, split) {
  const f = Number(split && split.f);
  if (!(f > 0) || !isFinite(f)) return { kind: 'skip', why: 'no factor' };
  if (Math.abs(Math.log(f)) < MIN_STEP) return { kind: 'skip', why: 'a stock dividend, too small to tell from a day’s move' };
  // A SHARE SPLIT IS A WHOLE-NUMBER RATIO (2:1, 3:2, 1:10) and the provider
  // gives it exactly. Its other factors are not share changes: REZI's 1.437 of
  // 2026-08-04 was a spin-off (its share count did not move), ATRO's 1.253 is
  // unexplained. Scaling history by those would invent prices, so they are left
  // for a person to look at.
  if (!wholeRatio(f)) return { kind: 'skip', why: 'not a whole-number split ratio (a spin-off or other price factor)' };
  const b = (bars || []).filter((x) => x && x.d && x.close > 0).slice().sort((x, y) => (x.d < y.d ? -1 : 1));
  if (b.length < 2) return { kind: 'skip', why: 'no bars either side' };
  let best = null;
  for (let i = 1; i < b.length; i++) {
    const r = b[i].close / b[i - 1].close;
    const fit = Math.abs(Math.log(r * f));     // what is left of the move once the split is divided out
    if (!best || fit < best.fit) best = { fit, r, i };
  }
  // The step has to look like the split (small residual) and unlike an
  // ordinary day (the raw move at least half the split's size).
  if (best.fit < STEP_FIT && Math.abs(Math.log(best.r)) > Math.abs(Math.log(f)) / 2) {
    return { kind: 'unadjusted', at: b[best.i].d, k: 1 / f, pre: b[best.i - 1], post: b[best.i] };
  }
  return { kind: 'adjusted' };
}

// A provider re-pricing by k ADJUSTS for a split of factor f when k is about
// 1/f (a two-for-one halves the old prices). When k is about f instead, the
// provider's bars are the unadjusted ones and taking them would undo the split.
// f = 1 is no split, so the two readings never meet.
const UNDO_FIT = 0.02;
function undoesSplit(k, splits) {
  if (!(k > 0)) return false;
  return (splits || []).some((s) => Number(s.f) > 0 && Math.abs(Math.log(Number(s.f))) >= TOL
    && Math.abs(Math.log(k / Number(s.f))) < UNDO_FIT);
}

// The one I/O piece, shared by the nightly splits step and split-repair.js so
// there is one way to do it: every split listed between `since` and `until`
// (optionally only for `only` symbols) whose stored closes still show the cliff
// is applied to the archive, bars before the cliff times 1/f, history kept.
// `store` is db.js. Dry unless `commit`. Returns what it found or did.
const dayShift = (iso, n) => { const t = new Date(iso + 'T12:00:00'); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
async function repairStored(store, { since, until = '9999-12-31', only = null, commit = false } = {}) {
  const held = await store.readSplitsBetween(since, until);
  const out = [];
  for (const [sym, list] of held) {
    if (only && !only.includes(sym)) continue;
    for (const sp of list) {
      const w = await store.readBarsWindow([sym], dayShift(sp.d, -12), dayShift(sp.d, 12));
      const bars = (w[sym] || []).map((b) => ({ d: String(b.datetime).slice(0, 10), close: Number(b.close) }));
      const dec = storedStep(bars, sp);
      if (dec.kind !== 'unadjusted') continue;
      const row = { symbol: sym, split: sp.d, f: sp.f, at: dec.at, k: dec.k, pre: dec.pre, post: dec.post, scaled: null };
      if (commit) row.scaled = await store.rescaleBars(sym, dec.at, dec.k, []);
      out.push(row);
    }
  }
  return out;
}


// ---- the archive's writes -------------------------------------------------
// Moved here from server.js on 2026-11-08 so the split handling can be tested
// against a real (in-memory) database; server.js calls it with its store.
// How many bars back to compare stored against freshly fetched. A split
// re-adjusts the entire history, so any old date reveals it.
const SPLIT_PROBE_BARS = 60;
const SPLIT_TOLERANCE = 0.005;   // 0.5% — past rounding, well short of any split
// Re-write this many already-stored bars each refresh. It is what upgrades a
// provisional close, captured while the market was open, to the settled one.
const BAR_OVERLAP = 5;

const barRow = (symbol, b) => {
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const close = num(b.close);
  if (close == null || !b.datetime) return null;
  return { symbol, d: String(b.datetime).slice(0, 10),
           open: num(b.open), high: num(b.high), low: num(b.low), close, volume: num(b.volume) };
};

// Only ever called for a live pull. An as-of pull fetches a different, truncated
// range, and persisting from that path would poison the archive.
// `T` is the round's phase timer, optional. It is threaded in because
// `persist-bars` measured 104.8s of a 121.3s production round (run 77) and the
// single step could not say which of the three things in here spent it — two
// indexed reads, the row building, or the writes. Marks ACCUMULATE by name, so
// marking inside the loop costs one map write per symbol and gives the write
// path its own total.
async function persistBars(store, symbols, series, T = null) {
  const mark = T ? (n) => T.mark(n) : () => {};
  const meta = await store.barsMaxDates(symbols);
  mark('bars-maxdates');

  const probes = [];
  const have = [];
  for (const sym of symbols) {
    const v = series[sym] && series[sym].values;
    if (!Array.isArray(v) || !v.length) continue;
    have.push([sym, v]);
    const p = v[Math.min(SPLIT_PROBE_BARS, v.length - 1)];
    if (p && p.datetime) probes.push({ sym, d: String(p.datetime).slice(0, 10), close: parseFloat(p.close) });
  }
  const stored = await store.barsOn(probes);
  mark('bars-probe');
  const probeBySym = new Map(probes.map((x) => [x.sym, x]));

  // Every write below is a round trip, so count them: on this database a path's
  // cost is its number of round trips, not its number of rows.
  let inserted = 0, rewritten = 0, trips = 0;
  // The steady-state upserts, collected across symbols and written once.
  const pending = [];
  // Symbols whose probe bar disagrees with the archive: settled below, once
  // the stored closes for their whole window have been read in one batch.
  const repriced = [];
  const splits = [], conflicts = [];
  for (const [sym, v] of have) {
    const rows = v.map((b) => barRow(sym, b)).filter(Boolean);
    if (!rows.length) continue;
    const m = meta.get(sym);

    // NOTHING STORED: the fetch is all there is, so it is the archive.
    if (!m || !m.maxDate) {
      // A REWRITE STAYS ITS OWN TRIP, deliberately: a delete beside another
      // symbol's inserts in one shared batch is the way to corrupt this table.
      mark('bars-prep');
      await store.replaceBarsFor(sym, rows);
      trips++;
      mark('bars-write');
      rewritten++;
      inserted += rows.length;
      continue;
    }

    // HISTORY IS NEVER REPLACED FROM A WINDOW (2026-11-08). This path used to
    // delete the symbol and write back the fetch whenever the probe disagreed
    // or the window missed the archive; from a 12-bar live pull that kept
    // twelve rows of years, and SCCO, MSGS and SOXX lost their history to it.
    // A disagreeing probe is now a candidate split, settled by barsplit.js as a
    // multiplication of what is stored; a window that misses the archive is
    // added beside it, gap and all, and said so.
    const probe = probeBySym.get(sym);
    const was = probe ? stored.get(sym + '|' + probe.d) : undefined;
    if (was != null && isFinite(probe.close) && probe.close > 0 &&
        Math.abs(was - probe.close) / probe.close > SPLIT_TOLERANCE) {
      repriced.push({ sym, rows, maxDate: m.maxDate });
      continue;
    }
    if (!rows.some((r) => r.d === m.maxDate)) {
      console.warn(`bars: ${sym} — the fetched window (from ${rows[rows.length - 1].d}) does not reach the archive (to ${m.maxDate}); added beside it, the gap stays`);
      pending.push(...rows);
      continue;
    }

    // Steady state: everything newer than what we hold, plus a short overlap so
    // a provisional close gets corrected.
    const at = rows.findIndex((r) => r.d === m.maxDate);
    pending.push(...rows.slice(0, Math.min(rows.length, at + 1 + BAR_OVERLAP)));
  }

  // A SPLIT IS A MULTIPLICATION. The provider has re-priced the stored bars
  // before some date; if the whole window agrees on one factor in the shape a
  // split makes, every older stored bar is scaled by it and the window written,
  // in one transaction (store.rescaleBars). Anything else keeps what is stored
  // and takes only the bars newer than it.
  if (repriced.length) {
    const storedWin = await store.barsOn(repriced.flatMap((x) => x.rows.map((r) => ({ sym: x.sym, d: r.d }))));
    mark('bars-probe');
    for (const x of repriced) {
      const map = new Map();
      for (const r of x.rows) { const s = storedWin.get(x.sym + '|' + r.d); if (s != null) map.set(r.d, s); }
      let dec = windowSplit(x.rows.map((r) => ({ d: r.d, close: r.close })), map);
      // NOT WHEN IT WOULD UNDO A SPLIT WE APPLIED. Where the provider never
      // adjusted (IESC), the nightly step scales the archive itself; a later
      // deep pull of the provider's unadjusted bars then reads as a re-pricing
      // by f, and taking it would put the cliff straight back.
      if (dec.kind === 'rescale') {
        const held = await store.readSplits(x.sym).catch(() => null);
        if (undoesSplit(dec.k, held ? held.splits : [])) dec = { kind: 'conflict', why: 'the provider’s prices would undo a split already applied' };
      }
      if (dec.kind === 'rescale') {
        const oldest = x.rows.reduce((a, r) => (r.d < a ? r.d : a), x.rows[0].d);
        mark('bars-prep');
        const n = await store.rescaleBars(x.sym, oldest, dec.k, x.rows);
        trips++;
        mark('bars-write');
        rewritten++;
        inserted += x.rows.length;
        splits.push({ symbol: x.sym, k: dec.k, scaled: n });
        console.log(`bars: ${x.sym} re-priced by ${dec.k.toFixed(4)} — ${n} older bars scaled (a split), window written`);
      } else {
        conflicts.push({ symbol: x.sym, why: dec.why || 'unchanged' });
        console.warn(`bars: ${x.sym} disagrees with the archive but not like a split (${dec.why || 'unchanged'}); kept what is stored, took only newer bars`);
        pending.push(...x.rows.filter((r) => r.d > x.maxDate));
      }
    }
  }

  // ONE BATCH ACROSS EVERY SYMBOL, not one per symbol. This was
  // `await store.upsertBars(slice)` INSIDE the loop, so a 500-symbol round made
  // 500 sequential round trips — measured in production (run 77) at ~210ms each
  // and 104.8s of a 121.3s round, the single biggest step in the refresh. The
  // rows were never the cost: the same round writes 2,400 rows cold and 48 in
  // the steady state and took the same 8 trips either way. upsertBars already
  // chunks at BAR_CHUNK statements, so this is ~6 trips for the whole universe.
  // Safe to merge because every statement here is an idempotent upsert keyed on
  // (symbol, d) — unlike the rewrite above, which deletes first.
  mark('bars-prep');
  if (pending.length) {
    inserted += await store.upsertBars(pending);
    trips += Math.ceil(pending.length / store.BAR_CHUNK);
    mark('bars-write');
  }
  return { inserted, rewritten, trips, symbols: have.length, splits, conflicts };
}

module.exports = { windowSplit, storedStep, undoesSplit, wholeRatio, repairStored, persistBars, barRow, TOL, MIN_CHANGED, MIN_STEP, STEP_FIT, SPLIT_PROBE_BARS, BAR_OVERLAP };
