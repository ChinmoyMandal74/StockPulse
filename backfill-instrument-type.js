#!/usr/bin/env node
// Fill `instrumentType` on every stored profile. Dry run by default; --commit
// to write. `--only SYM,SYM` for a trial.
//
// WHY THIS EXISTS RATHER THAN A SWEEP. Adding a field to emptyProfile() makes
// every stored profile a "fields" gap, and the next Fill missing then re-pulls
// the whole universe: at 1,188 stocks that is ~96,000 credits and ~2.8 hours,
// to buy a value that is FREE. Run this BEFORE deploying the field and there
// is no gap at all — the key is already in every blob by the time the code
// knows to look for it. The `backfill-exchange.js` precedent exactly.
//
// IT COSTS NOTHING AND TAKES ONE REQUEST. /stocks and /etf are reference
// endpoints: they send no `api-credits-request` header at all, so they are not
// metered, and the whole US list comes back in a single call. 1,188 per-symbol
// lookups would have been just as free and 1,188 times slower.
//
// IT MERGES THROUGH `mergeProfileFields`, NEVER readProfiles/writeProfiles.
// That round trip is lossy: readProfiles DELETES `fetchedAt` when the column is
// 0 — the "pull was refused, retry me" sentinel — and writeProfiles then stores
// null, which would hide the symbol from the rotation and from profileGaps's
// `failed` test. The targeted merge rewrites only the blob.
require('dotenv').config();
const https = require('https');
const store = require('./db.js');

const KEY = process.env.TWELVE_DATA_API_KEY;
const COMMIT = process.argv.includes('--commit');
const onlyIx = process.argv.indexOf('--only');
const ONLY = onlyIx > -1 && process.argv[onlyIx + 1]
  ? process.argv[onlyIx + 1].split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  : null;

const get = (path) => new Promise((res, rej) => {
  https.get('https://api.twelvedata.com' + path, (x) => {
    let b = '';
    x.on('data', (c) => b += c);
    x.on('end', () => {
      try { res({ j: JSON.parse(b), metered: x.headers['api-credits-request'] }); }
      catch (e) { rej(new Error('unparseable reply: ' + b.slice(0, 120))); }
    });
  }).on('error', rej);
});

(async () => {
  const t0 = Date.now();
  if (!KEY) throw new Error('TWELVE_DATA_API_KEY is not set');

  const universe = await store.readUniverse();
  const profiles = await store.readProfiles();
  const want = (ONLY || universe).filter((s) => profiles[s]);
  console.log('universe ' + universe.length + ', stored profiles ' + Object.keys(profiles).length
    + ', in scope ' + want.length + (ONLY ? '  (--only)' : ''));

  // PIN THE COUNTRY — /stocks with no country filter answers with whichever
  // listing it likes (MSFT comes back as the Vienna one, in EUR).
  const st = await get('/stocks?country=United States&apikey=' + KEY);
  const et = await get('/etf?country=United States&apikey=' + KEY);
  const srows = (st.j && st.j.data) || [];
  const erows = (et.j && et.j.data) || [];
  console.log('/stocks US ' + srows.length + ' rows, /etf US ' + erows.length + ' rows   metered: '
    + (st.metered === undefined && et.metered === undefined ? 'NO — free' : 'YES: ' + st.metered + '/' + et.metered));
  if (!srows.length) throw new Error('/stocks returned nothing — refusing to write nulls over good data');

  const type = new Map();
  for (const r of srows) if (r.symbol && r.type && !type.has(r.symbol)) type.set(r.symbol, String(r.type).slice(0, 48));
  const funds = new Set(erows.map((r) => r.symbol));

  const patch = {};
  const counts = {};
  const missing = [];
  const unchanged = [];
  for (const sym of want) {
    const t = type.get(sym) || (funds.has(sym) ? 'ETF' : null);
    if (!t) { missing.push(sym); continue; }
    counts[t] = (counts[t] || 0) + 1;
    if (profiles[sym].instrumentType === t) { unchanged.push(sym); continue; }
    patch[sym] = { instrumentType: t };
  }

  console.log('\n--- what the reference list says about the universe ---');
  Object.entries(counts).sort((a, b) => b[1] - a[1])
    .forEach(([t, n]) => console.log('  ' + String(n).padStart(5) + '  ' + t));
  console.log('\n  to write      : ' + Object.keys(patch).length);
  console.log('  already right : ' + unchanged.length);
  console.log('  UNRESOLVED    : ' + missing.length + (missing.length ? '  ' + missing.slice(0, 40).join(', ') : ''));
  if (missing.length) {
    console.log('  An unresolved symbol is left ALONE rather than written null — a');
    console.log('  reference list can omit a symbol for its own reasons, and a null');
    console.log('  here would read as "checked, and it is nothing".');
  }

  // Anything that is not common stock, named, since that is the question this
  // field was added to answer.
  const EQUITY = new Set(['Common Stock', 'American Depositary Receipt', 'Depositary Receipt',
    'Limited Partnership', 'REIT', 'ETF']);
  const odd = Object.entries(counts).filter(([t]) => !EQUITY.has(t));
  console.log('\n--- labels that are NOT in the known-equity/fund set ---');
  if (!odd.length) console.log('  none');
  for (const [t, n] of odd) {
    const syms = want.filter((s) => (type.get(s) || (funds.has(s) ? 'ETF' : null)) === t);
    console.log('  ' + t + ' (' + n + '): ' + syms.slice(0, 30).join(', '));
  }

  if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit.');
    process.exit(0);
  }

  const wrote = await store.mergeProfileFields(patch);
  console.log('\nprofiles updated: ' + wrote + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

  // Read back through the same accessor the app uses, and judge by the DATA.
  const after = await store.readProfiles();
  const still = want.filter((s) => after[s] && !after[s].instrumentType && !missing.includes(s));
  const haveKey = want.filter((s) => after[s] && 'instrumentType' in after[s]).length;
  console.log('carry the KEY (what profileGaps tests): ' + haveKey + ' of ' + want.length);
  console.log('carry a VALUE: ' + want.filter((s) => after[s] && after[s].instrumentType).length);
  console.log(still.length ? 'STILL BLANK and not unresolved: ' + still.join(', ')
    : 'every in-scope profile that could be typed now is.');
  process.exit(0);
})().catch((e) => { console.log('FAILED: ' + e.message); process.exit(1); });
