#!/usr/bin/env node
// Populate `price_extremes` — the highest settled close on record per symbol.
//
// Run this ONCE before the column ships, and again for a ticker added before
// a fold has seen it. After that the nightly maintains it incrementally.
//
// IT READS NO BULK DATA, which is the whole reason it is safe to point at
// production. `max(close) group by symbol` over 4.58M rows is the scan that
// caused the 75%-of-quota warning; this is two INDEXED SEEKS per symbol on the
// (symbol, d) primary key — about 2,400 single-row reads, the same shape
// `closesBefore` already makes on every refresh round.
//
// A SESSION STILL IN PROGRESS IS EXCLUDED, which is the same `settled` rule the
// nightly fold follows and NOT the same thing as "today is excluded" — this
// comment said the latter while the code folded whatever the newest bar was,
// the exact drift db.js's own comment had. Twelve Data serves a bar for today
// whose close is the current price, and a running max only ever goes up, so one
// provisional spike would be stored for ever as a record that never happened.
// After the bell today's close is final and folding it is correct; before it,
// the boundary steps back a day and the read path compares today live anyway.
//
//   node --use-system-ca backfill-ath.js            # dry run, writes nothing
//   node --use-system-ca backfill-ath.js --commit
//   node --use-system-ca backfill-ath.js --commit --only MU,NVDA
require('dotenv').config();
const store = require('./db.js');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const onlyArg = (args.find((a) => a.startsWith('--only')) || '').split('=')[1]
  || (args.includes('--only') ? args[args.indexOf('--only') + 1] : '');
const ONLY = onlyArg ? onlyArg.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
const MISSING = args.includes('--missing');

const money = (v) => (Number.isFinite(v) ? '$' + v.toFixed(2) : '—');

(async () => {
  const t0 = Date.now();
  let universe = await store.readUniverse();
  if (ONLY) universe = universe.filter((s) => ONLY.includes(s));
  const have = await store.readPriceExtremes();
  if (MISSING) universe = universe.filter((s) => !have[s]);
  if (!universe.length) { console.log('nothing to do'); process.exit(0); }

  // The boundary: everything strictly before the newest session anyone holds.
  // Asked of the archive rather than the clock, so a weekend or a holiday
  // needs no calendar — the same reasoning the intraday gate uses.
  // `barsThrough` ALREADY REDUCES to the newest date across the symbols — it is
  // a string, not a per-symbol map. The first cut of this line spread it with
  // `Object.values` and reduced the characters, which picked the largest DIGIT
  // ('6') and then threw `Invalid time value` one line later. A field's shape
  // is something to read, never to guess at.
  let upto = (await store.barsThrough(universe)) || new Date().toISOString().slice(0, 10);

  // THE SAME `settled` TEST THE FOLD MAKES, so this run and the nightly cannot
  // disagree about what counts as a finished session. Asked of New York rather
  // than the local clock, and with `toLocaleString` rather than Git Bash's `TZ`,
  // which is silently ignored on this machine.
  const nowNY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const nyMin = (() => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
      hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return Number(p.hour) * 60 + Number(p.minute);
  })();
  if (upto >= nowNY && nyMin < 16 * 60) {
    // Step back a calendar day rather than hunting for the previous SESSION.
    // `through` landing earlier than the true last session only makes the
    // nightly's gap repair re-scan a day, which is an idempotent upsert; the
    // opposite error — claiming a session was folded when it was not — loses a
    // record for ever, because a max only goes up.
    const d = new Date(nowNY + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    upto = d.toISOString().slice(0, 10);
    console.log(`New York is still open (${Math.floor(nyMin / 60)}:${String(nyMin % 60).padStart(2, '0')}), so today's provisional bar is left out`);
  }
  console.log(`${universe.length} symbols; folding every session up to and including ${upto}`);
  console.log(COMMIT ? 'COMMIT — writing\n' : 'DRY RUN — nothing will be written (pass --commit)\n');

  // `maxCloseBetween` is exclusive at both ends, so reach one day past the
  // boundary to include it. '0000-00-00' sorts below every ISO date.
  const day = new Date(upto + 'T12:00:00');
  day.setDate(day.getDate() + 1);
  const exclusiveEnd = day.toISOString().slice(0, 10);

  const peaks = await store.maxCloseBetween(universe, '0000-00-00', exclusiveEnd);
  const firsts = await store.firstBarDates(universe);

  const rows = [], skipped = [];
  for (const symbol of universe) {
    const p = peaks[symbol], f = firsts[symbol];
    // No bars, or nothing above the sub-cent floor: left ALONE rather than
    // written as zero. A stored zero would read as "checked, and it has no
    // high", where absent correctly reads as "not known yet".
    if (!p || !f || !(p.close >= 0.01)) { skipped.push(symbol); continue; }
    rows.push({ symbol, athClose: p.close, athDate: p.d, firstDate: f, through: upto });
  }

  rows.sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
  for (const r of rows.slice(0, 15)) {
    console.log(`  ${r.symbol.padEnd(7)} ${money(r.athClose).padStart(10)}  set ${r.athDate}  window from ${r.firstDate}`);
  }
  if (rows.length > 15) console.log(`  …and ${rows.length - 15} more`);

  // The distribution is the thing worth printing, because it is what decides
  // whether any surface may say "all-time": a window starting in 2006 is the
  // provider's 5,000-bar ceiling rather than a listing date.
  const byYear = {};
  for (const r of rows) byYear[r.firstDate.slice(0, 4)] = (byYear[r.firstDate.slice(0, 4)] || 0) + 1;
  console.log('\nrecord windows start: ' + Object.entries(byYear).sort().map(([y, n]) => `${y}:${n}`).join(' '));
  if (skipped.length) console.log(`skipped ${skipped.length} with no usable bars: ${skipped.slice(0, 12).join(', ')}`);

  if (COMMIT) {
    const n = await store.writePriceExtremes(rows);
    console.log(`\nwrote ${n} rows`);
    // Judge a load by the rows it stored, never by how it exited — the
    // shortint-load lesson, where a receipt claimed success over a run that
    // had abandoned 412 symbols.
    const back = await store.readPriceExtremes();
    const stored = rows.filter((r) => back[r.symbol] && Math.abs(back[r.symbol].athClose - r.athClose) < 1e-9).length;
    console.log(`read back ${stored} of ${rows.length} matching`);
  }
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
