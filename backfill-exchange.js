// One-off: fill exchange / MIC / trading currency into every stored profile.
//
// These three were read off the PRICE call's meta block, which only exists for
// a symbol priced live — so every archive-priced round wrote them as null, and
// after a Refresh all the whole universe had lost them. They are stored on the
// profile now (server.js, emptyProfile), which survives every round, but the
// profiles already cached predate that and would stay blank until each one is
// next re-pulled — a week of nightly rotation, or an hour of Fill missing.
//
// /quote carries all three for ONE credit, against 80 for a cold profile, so
// this fills 354 symbols in about a minute instead. Dry run by default.
//
//   node --use-system-ca backfill-exchange.js            # report, write nothing
//   node --use-system-ca backfill-exchange.js --commit
//   node --use-system-ca backfill-exchange.js --commit --only ERIC,TM
require('dotenv').config();
const store = require('./db.js');

const API_KEY = process.env.TWELVE_DATA_API_KEY;
const TD_BASE = 'https://api.twelvedata.com';
const COMMIT = process.argv.includes('--commit');
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > 0 ? String(process.argv[onlyArg + 1] || '').toUpperCase().split(',') : null;

// The plan allows 610 credits a minute and /quote is 1, so this is the only
// thing pacing us. 8 at a time with a small gap stays far under it.
const BATCH = 8;
const GAP_MS = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function quote(symbol) {
  const url = `${TD_BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${API_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (!j || j.status === 'error') throw new Error(j && j.message ? j.message : 'error');
  return {
    exchange: j.exchange ? String(j.exchange).slice(0, 40) : null,
    micCode: j.mic_code ? String(j.mic_code).slice(0, 12) : null,
    currency: j.currency ? String(j.currency).slice(0, 8) : null,
  };
}

(async () => {
  if (!API_KEY) { console.error('TWELVE_DATA_API_KEY is not set.'); process.exit(1); }
  const profiles = await store.readProfiles();
  const universe = await store.readUniverse();
  const want = (ONLY || universe).filter((s) => !ONLY || ONLY.includes(s));

  const missing = want.filter((s) => {
    const p = profiles[s];
    return !p || !p.exchange || !p.currency;
  });
  console.log(`universe ${universe.length} · profiles stored ${Object.keys(profiles).length}`);
  console.log(`to fill: ${missing.length} (${want.length - missing.length} already have it)`);
  console.log(`cost: ${missing.length} credits at 1 each, roughly ${Math.ceil(missing.length / BATCH)} seconds\n`);
  if (!missing.length) { console.log('nothing to do.'); process.exit(0); }
  if (!COMMIT) {
    console.log('DRY RUN — pass --commit to write. First 10:');
    missing.slice(0, 10).forEach((s) => console.log('   ', s));
    process.exit(0);
  }

  const t0 = Date.now();
  const patch = {};
  let ok = 0, failed = 0;
  const failures = [];
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    const got = await Promise.all(chunk.map(async (sym) => {
      try { return [sym, await quote(sym)]; }
      catch (e) { failures.push(`${sym}: ${e.message}`); return [sym, null]; }
    }));
    for (const [sym, v] of got) {
      if (!v || (!v.exchange && !v.currency)) { failed++; continue; }
      patch[sym] = v;
      ok++;
    }
    process.stdout.write(`\r  ${Math.min(i + BATCH, missing.length)}/${missing.length}`);
    if (i + BATCH < missing.length) await sleep(GAP_MS);
  }
  console.log('');
  // A targeted merge, NOT writeProfiles: a readProfiles/writeProfiles round
  // trip turns a fetched_at of 0 -- "the pull was refused, retry me" -- into
  // null, which would hide those symbols from the rotation and from the gap
  // detector. This rewrites only the blob.
  const wrote = await store.mergeProfileFields(patch);
  console.log(`  merged into ${wrote} stored profiles`);
  console.log(`\nfilled ${ok}, failed ${failed}, in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (failures.length) {
    console.log('failures:');
    failures.slice(0, 12).forEach((f) => console.log('   ', f));
  }
  const after = await store.readProfiles();
  const still = want.filter((s) => !after[s] || !after[s].exchange).length;
  console.log(`still without an exchange: ${still}`);
  process.exit(0);
})();
