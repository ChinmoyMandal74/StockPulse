// Fill sec_state.last_filed for symbols whose filings are already stored.
//
// `writeSecFacts` records it from the rows it has in hand, so every FUTURE
// fetch sets it — but ~1,167 symbols were stored before the column existed,
// and re-fetching them is 1,167 requests against an address that has already
// answered 429 and then 403 once. Everything needed is in sec_facts.
//
// It is a LOCAL script for the reason backfill-instrument-type.js is: this
// reads the whole of a 270,000-row table, which is a quota event on this
// database and has no business on a request path. Dry run by default.
//
//   node --use-system-ca backfill-sec-filed.js            (dry run)
//   node --use-system-ca backfill-sec-filed.js --commit
//   node --use-system-ca backfill-sec-filed.js --only VNO,L
require('dotenv').config();
const store = require('./db.js');
const SecFacts = require('./secfacts.js');

const COMMIT = process.argv.includes('--commit');
// `indexOf` returns -1 when the flag is absent, and argv[-1 + 1] is argv[0] —
// the node executable path, which then became the filter and matched nothing.
const oi = process.argv.indexOf('--only');
const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1]
  || (oi > -1 ? (process.argv[oi + 1] || '') : '');
const ONLY = onlyArg && !onlyArg.startsWith('--')
  ? new Set(onlyArg.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)) : null;

(async () => {
  const t0 = Date.now();
  const state = await store.readSecState();
  let syms = Object.keys(state).sort();
  if (ONLY) syms = syms.filter((s) => ONLY.has(s));
  console.log(`${syms.length} symbols in sec_state${ONLY ? ' (filtered)' : ''}`);

  let set = 0; let already = 0; let none = 0; let changed = 0;
  const examples = [];
  for (const sym of syms) {
    // Per symbol, which SEARCHes on the primary key rather than scanning —
    // slower in wall clock than one group-by and far cheaper in rows read,
    // which is what this database meters. The same trade closesBefore made.
    const rows = await store.readSecFacts(sym).catch(() => []);
    const filed = rows.reduce(
      (m, r) => (SecFacts.isStatement(r) && r.filed && (!m || r.filed > m) ? r.filed : m), null);
    if (!filed) { none++; continue; }
    const had = state[sym] && state[sym].lastFiled;
    if (had === filed) { already++; continue; }
    if (had) changed++;
    if (examples.length < 12) examples.push(`  ${sym.padEnd(7)} ${had || '(unset)'} -> ${filed}`);
    if (COMMIT) await store.setSecLastFiled(sym, filed);
    set++;
  }

  console.log(`\n  would set      ${set}`);
  console.log(`  already right  ${already}`);
  console.log(`  no statements  ${none}   (funds and foreign filers file no 10-Q)`);
  console.log(`  overwritten    ${changed}`);
  if (examples.length) { console.log(); examples.forEach((e) => console.log(e)); }
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s` + (COMMIT ? ' — WRITTEN' : ' — dry run, nothing written'));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
