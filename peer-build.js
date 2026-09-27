#!/usr/bin/env node
// Build the co-movement peer table — peers for the stocks whose industry is
// too thin to have any.
//
// WHY THIS EXISTS, measured rather than assumed. The screener's peer rule is
// "same industry, nearest by market cap", and for the ~93% of stocks whose
// industry holds three or more others it works: median return correlation
// 0.42-0.45 against a 0.24 random-same-sector floor. For the ~80 whose
// industry is too thin it falls back to the sector and the result is
// WORTHLESS — 0.207 against a 0.206 floor. It is not a peer group, it is six
// companies of a similar size. Kohl's got Whirlpool, Peloton, Shake Shack and
// Wingstop.
//
// Picking the same-sector stocks whose daily returns tracked the anchor most
// closely lands at 0.420 on those same 80 — measured OUT OF SAMPLE, peers
// chosen in one window and scored in the next, in both a 6m/6m and a 1y/1y
// split. Kohl's gets Macy's, Best Buy, Dillard's, Abercrombie & Fitch,
// Williams-Sonoma and Gap.
//
// THE DEEP CASES ARE DELIBERATELY NOT TOUCHED. Co-movement beats the taxonomy
// there too, but only by 0.02 on the cleaner window — and the taxonomy answer
// can be labelled ("Others in Semiconductors") where this one can only ever
// say "these moved alike". Not worth the trade.
//
// Reads BARS FROM THE LOCAL COPY (analysis.db), never Turso: that is the whole
// reason analysis-db.js exists, and a year of closes for the universe is
// exactly the shape of query that must not be aimed at production. The only
// thing it asks Turso for is the snapshot, and the only thing it writes is
// ~480 rows.
//
//   node peer-build.js              dry run, prints what it would store
//   node peer-build.js --commit     writes
//   node peer-build.js --only KSS   one anchor, for a look
require('dotenv').config();      // before db.js, which throws without TURSO_*
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const store = require('./db.js');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? (args[i + 1] || '').toUpperCase() : null; })();

const SESSIONS = 253;          // one year of daily returns
const MIN_BARS = 200;          // enough of that year to mean anything
const MIN_INDUSTRY = 3;        // the server's PEER_MIN_INDUSTRY
const KEEP = 6;                // the server's PEER_MAX
const MIN_SECTOR = 8;          // below this a sector cannot rank anything
// A FLOOR, BECAUSE A WEAK CO-MOVEMENT GROUP IS NOISE WEARING A PEER GROUP'S
// CLOTHES. Random same-sector pairs measured 0.206-0.249, so a "peer" at 0.25
// is telling the reader nothing while looking like an answer — Apple's best
// six came back at 0.25-0.29 (Cirrus Logic, Sensata, Euronet, GoDaddy), which
// is not a peer group, it is the market. Below this a pair is dropped, and an
// anchor left with fewer than MIN_INDUSTRY survivors stores nothing at all
// and keeps the taxonomy answer, whose label at least describes what it did.
const MIN_CORR = 0.30;

const local = new DatabaseSync(path.join(__dirname, 'analysis.db'), { readOnly: true });

function returnsBysymbol() {
  const dates = local.prepare('select distinct d from bars order by d desc limit ?').all(SESSIONS)
    .map((r) => r.d).reverse();
  const closes = new Map();
  for (const r of local.prepare('select symbol, d, close from bars where d >= ? order by symbol, d').all(dates[0])) {
    if (!closes.has(r.symbol)) closes.set(r.symbol, []);
    closes.get(r.symbol).push(Number(r.close));
  }
  // Standardised once, so a correlation is a dot product rather than a pass
  // over both series — 80 anchors against ~200 sector names each.
  const z = new Map();
  for (const [sym, c] of closes) {
    if (c.length < MIN_BARS) continue;
    const v = [];
    for (let i = 1; i < c.length; i++) v.push(c[i - 1] > 0 ? c[i] / c[i - 1] - 1 : 0);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const d = v.map((x) => x - m);
    const n = Math.sqrt(d.reduce((a, b) => a + b * b, 0));
    if (n) z.set(sym, d.map((x) => x / n));
  }
  return { z, from: dates[0], to: dates[dates.length - 1] };
}
const dot = (a, b) => {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
};

(async () => {
  const snap = await store.readSnapshot();
  const rows = ((snap && snap.stocks) || []).filter((r) => !r.error && r.companyType !== 'ETF');
  if (!rows.length) { console.error('No snapshot rows. Is TURSO_* set in .env?'); process.exit(1); }

  const { z, from, to } = returnsBysymbol();
  const meta = new Map(rows.map((r) => [r.symbol, r]));
  const have = rows.filter((r) => z.has(r.symbol)).map((r) => r.symbol);
  const byInd = {}, bySec = {};
  for (const s of have) {
    const m = meta.get(s);
    if (m.industry) (byInd[m.industry] ||= []).push(s);
    if (m.sector) (bySec[m.sector] ||= []).push(s);
  }
  console.log(`bars ${from} -> ${to}  ·  ${have.length} of ${rows.length} stocks have a usable year`);

  // The anchors: exactly the ones the server would fall back on. An industry
  // with fewer than MIN_INDUSTRY others, INCLUDING none at all.
  const anchors = have.filter((s) => {
    const m = meta.get(s);
    if (only) return s === only;
    const peersInInd = (byInd[m.industry] || []).filter((x) => x !== s).length;
    return peersInInd < MIN_INDUSTRY;
  });

  const out = {};
  let skipped = 0, weak = 0;
  for (const a of anchors) {
    const m = meta.get(a);
    const pool = (bySec[m.sector] || []).filter((x) => x !== a);
    // A sector too small to rank within is not improved by ranking within it.
    if (pool.length < MIN_SECTOR) { skipped++; continue; }
    // ONE COMPANY, ONE ROW, here as well as on the server: two share classes
    // of the same company correlate at ~1.0 with each other and would take
    // two of the six slots. Deduped by display name, the anchor's own first.
    const seen = new Set([String(m.shortName || m.name || a).trim().toLowerCase()]);
    const ranked = pool
      .map((x) => ({ peer: x, corr: dot(z.get(a), z.get(x)) }))
      .filter((r) => r.corr >= MIN_CORR)
      .sort((p, q) => q.corr - p.corr);
    const keep = [];
    for (const r of ranked) {
      const k = String(meta.get(r.peer).shortName || meta.get(r.peer).name || r.peer).trim().toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      keep.push(r);
      if (keep.length >= KEEP) break;
    }
    if (keep.length >= MIN_INDUSTRY) out[a] = keep; else weak++;
  }

  const names = (a, ps) => ps.map((p) =>
    (meta.get(p.peer).shortName || p.peer) + ' ' + p.corr.toFixed(2)).join(', ');
  const list = Object.keys(out).sort();
  console.log('\n' + list.length + ' anchors with a co-movement group'
    + (skipped ? '  (' + skipped + ' skipped: sector too small to rank in)' : '')
    + (weak ? '  (' + weak + ' left as-is: nothing cleared ' + MIN_CORR + ', so no claim is made)' : ''));
  for (const a of list.slice(0, only ? 50 : 12)) {
    console.log('  ' + a.padEnd(7) + (meta.get(a).industry || 'no industry').padEnd(26) + names(a, out[a]));
  }
  if (!only && list.length > 12) console.log(`  … and ${list.length - 12} more`);

  const med = (v) => { const s2 = v.slice().sort((p, q) => p - q); return s2.length ? s2[Math.floor(s2.length / 2)] : null; };
  const all = list.flatMap((a) => out[a].map((p) => p.corr));
  // In-sample by construction — these pairs were CHOSEN for correlating, so
  // this number flatters itself and is printed only as a sanity check that
  // the maths ran. The honest figure is the held-out 0.420 in the header.
  console.log('\nmedian correlation of a stored pair: '
    + (med(all) == null ? 'n/a' : med(all).toFixed(3))
    + '   (in-sample, so flattering; held out it measured 0.420)');

  if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit.');
    process.exit(0);
  }
  const n = await store.writePeerLinks(out);
  console.log('\nwrote ' + n + ' links for ' + list.length + ' anchors.');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
