// One-off deep backfill of the daily bar archive.
//
//   node --use-system-ca backfill-bars.js               # dry run, reports what it would do
//   node --use-system-ca backfill-bars.js --commit      # actually writes
//   node --use-system-ca backfill-bars.js --commit --depth 1250   # ~5 years instead of ~20
//   node --use-system-ca backfill-bars.js --commit --only MU,AAPL # repair specific symbols
//
// Why this exists rather than letting a refresh do it: Twelve Data charges one
// credit per symbol regardless of how many bars come back, so `outputsize=5000`
// buys ~20 years for the same price as the ~300 bars a refresh already fetches.
// But 5,000 bars is ~580 KB per symbol, and ~40 MB across the universe is far
// too much for a serverless function's memory and duration. Run it locally,
// once, against the same Turso database the deployed app uses.
//
// Safe to re-run: each symbol is replaced wholesale, so a second run just
// re-seeds. That is also the repair path when a split has re-adjusted history.

require('dotenv').config();
const store = require('./db');

const COMMIT = process.argv.includes('--commit');
const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const DEPTH = Math.max(1, Number(argOf('--depth', 5000)));
const ONLY = argOf('--only', '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const CONCURRENCY = 3;   // well under the per-minute credit ceiling, and gentle on memory

const API_KEY = process.env.TWELVE_DATA_API_KEY || '';
const TD_BASE = 'https://api.twelvedata.com';

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };

async function fetchSeries(symbol) {
  const url = `${TD_BASE}/time_series?symbol=${encodeURIComponent(symbol)}` +
              `&interval=1day&outputsize=${DEPTH}&apikey=${API_KEY}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.status === 'error') throw new Error(j.message || 'API error');
  const v = Array.isArray(j.values) ? j.values : [];
  return v.map((b) => {
    const close = num(b.close);
    if (close == null || !b.datetime) return null;
    return { symbol, d: String(b.datetime).slice(0, 10),
             open: num(b.open), high: num(b.high), low: num(b.low), close, volume: num(b.volume) };
  }).filter(Boolean);
}

// Fixed-size worker pool: keeps the request rate predictable rather than firing
// the whole universe at once.
async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

(async () => {
  if (!API_KEY) {
    console.error('TWELVE_DATA_API_KEY is not set. Nothing to fetch.');
    process.exit(1);
  }

  const portfolios = await store.readPortfolios();
  const all = [...new Set(Object.values(portfolios).flat().map((x) => String(x).trim().toUpperCase()))];
  const symbols = ONLY.length ? all.filter((s) => ONLY.includes(s)) : all;
  if (ONLY.length) {
    const missing = ONLY.filter((s) => !all.includes(s));
    if (missing.length) console.log(`note: not in any portfolio, skipping — ${missing.join(', ')}`);
  }

  const before = await store.barsStats();
  console.log(`archive before : ${before.rows.toLocaleString()} rows, ${before.symbols} symbols` +
              (before.from ? `, ${before.from} → ${before.to}` : ''));
  console.log(`symbols to pull: ${symbols.length}`);
  console.log(`depth          : ${DEPTH} bars each (1 API credit per symbol regardless of depth)`);
  console.log(COMMIT ? 'mode           : COMMIT — this writes\n' : 'mode           : DRY RUN — nothing will be written\n');

  let ok = 0, failed = 0, rows = 0;
  await pool(symbols, CONCURRENCY, async (sym) => {
    try {
      const bars = await fetchSeries(sym);
      if (!bars.length) { console.log(`  ${sym.padEnd(9)} no data`); failed++; return; }
      const span = `${bars[bars.length - 1].d} → ${bars[0].d}`;
      if (COMMIT) await store.replaceBarsFor(sym, bars);
      rows += bars.length;
      ok++;
      console.log(`  ${sym.padEnd(9)} ${String(bars.length).padStart(5)} bars  ${span}`);
    } catch (err) {
      failed++;
      console.log(`  ${sym.padEnd(9)} FAILED: ${err.message}`);
    }
  });

  console.log(`\n${ok} symbols ok, ${failed} failed, ${rows.toLocaleString()} bars ${COMMIT ? 'written' : 'would be written'}`);
  if (COMMIT) {
    const after = await store.barsStats();
    console.log(`archive after  : ${after.rows.toLocaleString()} rows, ${after.symbols} symbols` +
                (after.from ? `, ${after.from} → ${after.to}` : ''));
  } else {
    console.log('Re-run with --commit to write.');
  }
  process.exit(failed && !ok ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
