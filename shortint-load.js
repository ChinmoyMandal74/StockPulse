#!/usr/bin/env node
//
// Load FINRA consolidated short interest into `short_interest`.
//
//   node --use-system-ca shortint-load.js                 dry run, the whole universe
//   node --use-system-ca shortint-load.js --commit        write it
//   node --use-system-ca shortint-load.js --only NVDA,MU  a trial
//   node --use-system-ca shortint-load.js --missing       only symbols never checked
//   node --use-system-ca shortint-load.js --rate 8        requests per second
//
// WHY THIS IS LOCAL, like backfill-bars.js and insider-load.js: it is ~1,181
// network calls. That has no business inside a serverless request, and doing
// it here means production never talks to FINRA at all.
//
// ONE CALL PER SYMBOL, NOT ONE PER SETTLEMENT DATE. Measured 2026-09-28: a
// symbol's whole history comes back in a single request — NVDA is 210 rows
// and 8.9KB, back to 2017-12-29. The alternative shape, ~190 bulk files at
// ~2.7MB each, is 513MB to extract the same ~10MB. The bulk file is still the
// right tool for the fortnightly top-up, where one file covers every symbol.
//
// Dry run by default. Nothing is written without --commit.

const API = 'https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest';
const FIELDS = ['settlementDate', 'symbolCode', 'currentShortPositionQuantity',
  'previousShortPositionQuantity', 'stockSplitFlag', 'averageDailyVolumeQuantity',
  'daysToCoverQuantity', 'changePercent', 'revisionFlag'];

require('dotenv').config();
const ShortInt = require('./shortint.js');
const store = require('./db.js');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const COMMIT = has('--commit');
const MISSING = has('--missing');
const ONLY = (val('--only', '') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const RATE = Math.max(1, Math.min(20, Number(val('--rate', 8)) || 8));
const GAP_MS = Math.ceil(1000 / RATE);

// A real contact address, the rule the SEC loader follows. FINRA does not
// demand one, but an anonymous script hammering a public API is how an
// address stops being answered — which happened to this project on 2026-09-27.
const UA = process.env.SEC_UA
  || ('Tickr Lab (' + (process.env.REPORT_TO || process.env.MAIL_FROM || 'admin@tickrlab.com') + ')');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchSymbol(finraSym) {
  const body = {
    limit: 1000,
    fields: FIELDS,
    compareFilters: [{ fieldName: 'symbolCode', fieldValue: finraSym, compareType: 'equal' }],
  };
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Accept: 'text/plain' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  // A THROTTLE IS A WAIT, NOT A FAILURE — the lesson the SEC walk cost.
  if (res.status === 429) { const e = new Error('throttled'); e.throttled = true; throw e; }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  return ShortInt.parse(text);
}

(async () => {
  const universe = await store.readUniverse();
  const state = COMMIT || MISSING ? await store.readShortState() : [];
  const seen = new Map(state.map((s) => [s.symbol, s]));

  let symbols = universe.slice();
  if (ONLY.length) symbols = symbols.filter((s) => ONLY.includes(s));
  if (MISSING) symbols = symbols.filter((s) => !seen.has(s));

  console.log('FINRA consolidated short interest');
  console.log('  universe   ' + universe.length + ', to load ' + symbols.length +
    (MISSING ? ' (never checked)' : '') + (ONLY.length ? ' (--only)' : ''));
  console.log('  mode       ' + (COMMIT ? 'COMMIT — writing' : 'dry run, nothing will be written'));
  console.log('  pace       ' + RATE + '/s');
  console.log('');

  const t0 = Date.now();
  let ok = 0, empty = 0, failed = 0, rows = 0, alt = 0;
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    // THREE SPELLINGS OF ONE SYMBOL. FINRA strips the separator (BRKB), we
    // keep the dot (BRK.B), SEC and Yahoo use a hyphen. The failure is a
    // silent miss rather than an error, so when the stripped spelling finds
    // nothing and it DIFFERS from ours, our own is tried before giving up.
    const primary = ShortInt.finraSymbol(sym);
    let got = [];
    let used = primary;
    try {
      got = await fetchSymbol(primary);
      if (!got.length && primary !== sym) {
        await sleep(GAP_MS);
        const second = await fetchSymbol(sym);
        if (second.length) { got = second; used = sym; alt++; }
      }
    } catch (e) {
      failed++;
      console.log('  ' + sym.padEnd(8) + 'FAILED  ' + e.message);
      if (COMMIT) await store.noteShortMiss(sym, e.throttled ? 'throttled' : 'error', e.message);
      if (e.throttled) { console.log('  backing off 60s'); await sleep(60000); }
      await sleep(GAP_MS);
      continue;
    }

    // THE WRITE NEEDS ITS OWN CATCH, and leaving it out cost 412 symbols on
    // the first real run (2026-09-28). Turso answered one batch with an
    // HTTP 404 — transient, the database was healthy a minute later — and
    // because this sat outside the try it threw clean out of the loop and
    // abandoned the rest of the universe at 65%.
    //
    // A blip costs ONE symbol, never the run. The symbol is left unrecorded
    // rather than marked checked, so `--missing` picks it up next time: the
    // insider walk's rule, where a day that fails does not advance.
    try {
      if (!got.length) {
        empty++;
        if (COMMIT) await store.noteShortMiss(sym, 'empty', null);
      } else {
        if (COMMIT) await store.writeShortInterest(sym, got, { finraSym: used, status: 'ok' });
        // Counted AFTER the write lands, or the receipt overstates what is
        // actually stored — which is the number this job is judged on.
        ok++; rows += got.length;
      }
    } catch (e) {
      failed++;
      console.log('  ' + sym.padEnd(8) + 'WRITE FAILED  ' + e.message);
      await sleep(3000);
      continue;
    }

    if (i < 12 || i % 50 === 0) {
      const last = got.length ? got.reduce((a, b) => (a.d > b.d ? a : b)) : null;
      console.log('  ' + sym.padEnd(8) + String(got.length).padStart(4) + ' readings' +
        (last ? '   latest ' + last.d + '  ' + Number(last.shares).toLocaleString() +
          ' short, ' + last.dtc + ' days to cover' : '   (nothing filed)') +
        (used !== primary ? '   [matched as ' + used + ']' : ''));
    }
    await sleep(GAP_MS);
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log('');
  console.log('  ' + ok + ' symbols with readings, ' + empty + ' with none, ' + failed + ' failed');
  console.log('  ' + rows.toLocaleString() + ' readings' + (COMMIT ? ' written' : ' available'));
  if (alt) console.log('  ' + alt + ' matched on our own spelling rather than the stripped one');
  console.log('  ' + mins + ' min');
  if (!COMMIT) console.log('\n  dry run — nothing was written. Re-run with --commit.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
