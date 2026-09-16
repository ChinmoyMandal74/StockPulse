// One-off deep backfill of the daily bar archive.
//
//   node --use-system-ca backfill-bars.js               # dry run, reports what it would do
//   node --use-system-ca backfill-bars.js --commit      # actually writes
//   node --use-system-ca backfill-bars.js --commit --depth 1250   # ~5 years instead of ~20
//   node --use-system-ca backfill-bars.js --commit --only MU,AAPL # repair specific symbols
//   node --use-system-ca backfill-bars.js --commit --rate 400      # a gentler credit ceiling
//
// PACED (2026-09-15): one symbol costs one credit and the plan allows 610 a
// minute, so the unpaced version was fine at 190 symbols (190 credits, 13s of
// fetching) and would have been refused partway through a 1,000-symbol run —
// measured rate was ~15 symbols a second, or 900 a minute. The pacer below
// holds the fetch rate under --rate (default 580, leaving headroom for
// anything else touching the key), and a refusal is retried rather than
// counted as a failed symbol.
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
const CONCURRENCY = 3;   // gentle on memory; the pacer is what holds the credit rate
const RATE = Math.max(1, Number(argOf('--rate', 580)));   // credits a minute, under the plan's 610
const RETRIES = 3;       // a refused symbol is retried, not written off

const API_KEY = process.env.TWELVE_DATA_API_KEY || '';
const TD_BASE = 'https://api.twelvedata.com';

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A sliding-window credit meter: `take()` resolves only once spending one more
// credit keeps the last 60 seconds under the limit. Shared by the workers, so
// the whole run is paced rather than each worker separately.
function makePacer(limit, windowMs = 60000, now = () => Date.now(), wait = sleep) {
  const spent = [];        // timestamps, oldest first
  let waited = 0;          // ms spent waiting, for the receipt
  return {
    async take() {
      for (;;) {
        const t = now();
        while (spent.length && t - spent[0] >= windowMs) spent.shift();
        if (spent.length < limit) { spent.push(t); return; }
        const ms = windowMs - (t - spent[0]) + 50;
        waited += ms;
        await wait(ms);
      }
    },
    get waitedMs() { return waited; },
  };
}
const REFUSED = /credit|rate limit|429|too many/i;

const pacer = makePacer(RATE);

async function fetchSeries(symbol) {
  await pacer.take();
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

  const all = [...new Set((await store.readUniverse()).map((x) => String(x).trim().toUpperCase()))];
  const symbols = ONLY.length ? all.filter((s) => ONLY.includes(s)) : all;
  if (ONLY.length) {
    const missing = ONLY.filter((s) => !all.includes(s));
    if (missing.length) console.log(`note: not in the screener, skipping — ${missing.join(', ')}`);
  }

  const before = await store.barsStats();
  console.log(`archive before : ${before.rows.toLocaleString()} rows, ${before.symbols} symbols` +
              (before.from ? `, ${before.from} → ${before.to}` : ''));
  console.log(`symbols to pull: ${symbols.length}`);
  console.log(`depth          : ${DEPTH} bars each (1 API credit per symbol regardless of depth)`);
  console.log(`rate limit     : ${RATE} symbols a minute (the plan allows 610 credits a minute)` +
              (symbols.length > RATE ? ` — this run needs about ${Math.ceil(symbols.length / RATE)} minutes of fetching alone` : ''));
  console.log(COMMIT ? 'mode           : COMMIT — this writes\n' : 'mode           : DRY RUN — nothing will be written\n');

  let ok = 0, failed = 0, rows = 0, retried = 0;
  const started = Date.now();
  await pool(symbols, CONCURRENCY, async (sym) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const bars = await fetchSeries(sym);
        if (!bars.length) { console.log(`  ${sym.padEnd(9)} no data`); failed++; return; }
        const span = `${bars[bars.length - 1].d} → ${bars[0].d}`;
        if (COMMIT) await store.replaceBarsFor(sym, bars);
        rows += bars.length;
        ok++;
        console.log(`  ${sym.padEnd(9)} ${String(bars.length).padStart(5)} bars  ${span}`);
        return;
      } catch (err) {
        // A refusal means the minute is spent, not that the symbol is bad:
        // wait out the window and try again rather than losing its history.
        if (REFUSED.test(err.message || '') && attempt <= RETRIES) {
          retried++;
          console.log(`  ${sym.padEnd(9)} refused (${err.message.slice(0, 60)}) — retrying in 62s`);
          await sleep(62000);
          continue;
        }
        failed++;
        console.log(`  ${sym.padEnd(9)} FAILED: ${err.message}`);
        return;
      }
    }
  });

  const mins = (Date.now() - started) / 60000;
  console.log(`\n${ok} symbols ok, ${failed} failed, ${retried} retried, ${rows.toLocaleString()} bars ${COMMIT ? 'written' : 'would be written'}`);
  console.log(`took ${mins.toFixed(1)} min, ${(ok / Math.max(mins, 0.01)).toFixed(0)} symbols/min` +
              (pacer.waitedMs ? `, ${(pacer.waitedMs / 1000).toFixed(0)}s of that waiting for the credit window` : ', no pacing wait needed'));
  if (COMMIT) {
    const after = await store.barsStats();
    console.log(`archive after  : ${after.rows.toLocaleString()} rows, ${after.symbols} symbols` +
                (after.from ? `, ${after.from} → ${after.to}` : ''));
  } else {
    console.log('Re-run with --commit to write.');
  }
  process.exit(failed && !ok ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
