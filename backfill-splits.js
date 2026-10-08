#!/usr/bin/env node
// Fill the `splits` table for the universe. Dry run by default; --commit to
// fetch and write. `--only SYM,SYM` for a trial, `--missing` to skip symbols
// already fetched, `--rate N` for credits a minute (default 80).
//
// WHY IT IS OPTIONAL. The server fetches a symbol's split history the first
// time its Evolution card is drawn (`splitsFor` in server.js) and stores it,
// so a single stock needs no backfill at all. This is for doing the whole
// universe in one pass -- which is what a market-wide series would need.
//
// WHAT IT COSTS. /splits is 20 credits a symbol, measured off
// `api-credits-used`: ~1,274 symbols is about 25,500 credits.
//
// THE DEFAULT RATE IS 80 CREDITS A MINUTE, AND THE ARITHMETIC IS THE REASON.
// The plan allows 610 a minute and an intraday price round takes about 500
// of them in its own minute, so anything over ~100 here can push that minute
// past the ceiling -- and the call the provider then refuses may be the
// PRICE round's, not this one. (This comment first said 200 "leaves the live
// refresh its room"; 500 + 200 is 700.) At 80 the universe takes about five
// and a half hours. A NIGHTLY round runs at ~561, which leaves no room at
// all: do not let a run overlap 07:30-08:15 or 19:30-20:15 Eastern.
//
// A SYMBOL THAT FAILS IS LEFT UNRECORDED, never written empty: an empty list
// reads as "fetched, and it has never split", and --missing would then skip
// it for ever.
require('dotenv').config();
const store = require('./db.js');

const KEY = process.env.TWELVE_DATA_API_KEY;
const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const COMMIT = process.argv.includes('--commit');
const MISSING = process.argv.includes('--missing');
const ONLY = arg('--only') ? arg('--only').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
const RATE = Math.max(20, Math.min(580, Number(arg('--rate')) || 80));
const COST = 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (store.init) await store.init();
  let symbols = ONLY || (await store.readUniverse());
  if (MISSING) {
    const keep = [];
    for (const s of symbols) { if (!(await store.readSplits(s).catch(() => null))) keep.push(s); }
    symbols = keep;
  }
  const mins = symbols.length * COST / RATE;
  console.log(symbols.length + ' symbols, ' + symbols.length * COST + ' credits, about ' + mins.toFixed(0) + ' min at ' + RATE + ' credits/min');
  if (!COMMIT) { console.log('Dry run: nothing fetched, nothing written. Add --commit.'); process.exitCode = 0; return; }
  if (!KEY) { console.log('No TWELVE_DATA_API_KEY in .env.'); process.exitCode = 1; return; }

  let ok = 0, withSplits = 0, failed = 0;
  const gap = 60000 * COST / RATE;
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    const t0 = Date.now();
    try {
      const r = await fetch('https://api.twelvedata.com/splits?symbol=' + encodeURIComponent(sym)
        + '&country=United%20States&range=full&apikey=' + KEY, { signal: AbortSignal.timeout(30000) });
      const j = await r.json();
      if (!r.ok || !j || j.status === 'error' || !Array.isArray(j.splits)) throw new Error((j && j.message) || 'HTTP ' + r.status);
      const list = j.splits.map((s) => ({ d: String(s.date || '').slice(0, 10), f: Number(s.from_factor) / Number(s.to_factor) }))
        .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.d) && s.f > 0 && isFinite(s.f));
      await store.writeSplits(sym, list);
      ok++; if (list.length) withSplits++;
    } catch (e) {
      failed++;
      console.log('  ' + sym + ' failed: ' + String(e.message || e).slice(0, 100));
      // A refusal for credits is the whole run going too fast, not this symbol.
      if (/credit|limit|429/i.test(String(e.message || e))) await sleep(62000);
    }
    if ((i + 1) % 25 === 0) console.log('  ' + (i + 1) + ' of ' + symbols.length + ' — ' + ok + ' stored, ' + failed + ' failed');
    const wait = gap - (Date.now() - t0);
    if (i + 1 < symbols.length && wait > 0) await sleep(wait);
  }
  console.log('Done: ' + ok + ' stored (' + withSplits + ' with at least one split), ' + failed + ' failed' + (failed ? ' — re-run with --missing' : ''));
  process.exitCode = failed && !ok ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
