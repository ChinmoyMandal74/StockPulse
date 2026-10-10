// Euro reference rates, and the filings that were waiting for them.
//
// TWO JOBS, in the order they depend on each other:
//
//   1. Load the European Central Bank's daily euro reference rates into
//      fx_rates -- every working day back to 1999, about 7,100 rows. The
//      server tops this up by itself from then on (eurFx in server.js); this
//      is the first fill, which is 8MB and has no business in a request.
//
//   2. Re-read the companies whose filings came back EMPTY. Until 2026-10-10
//      the reader looked only at US GAAP facts, so a foreign filer under
//      international standards read as a company with nothing filed --
//      Spotify among them. Each is fetched again and read by the same
//      secfacts.js the server uses: an IFRS filer reporting in dollars needs
//      no rate at all, one reporting in euros is converted at the rate of
//      each period (see fx.js), and one reporting in any other currency is
//      recorded as exactly that.
//
// LOCAL because of the first job's size and the second's pacing: one request
// per company to an address that has throttled this project before, so it is
// sequential and slow on purpose. Dry run by default.
//
//   node --use-system-ca fx-load.js                 # report, write nothing
//   node --use-system-ca fx-load.js --commit
//   node --use-system-ca fx-load.js --commit --only SPOT,ASML
//   node --use-system-ca fx-load.js --rates-only --commit
require('dotenv').config();
const store = require('./db.js');
const SecFacts = require('./secfacts.js');
const Fx = require('./fx.js');

const COMMIT = process.argv.includes('--commit');
const RATES_ONLY = process.argv.includes('--rates-only');
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > 0 ? String(process.argv[onlyArg + 1] || '').toUpperCase().split(',').filter(Boolean) : null;

// The server's own declaration, built the same way: the SEC refuses a bot
// that does not say who it is.
const CONTACT = String(process.env.REPORT_TO || process.env.MAIL_FROM || '').trim();
const SEC_UA = String(process.env.SEC_UA || (CONTACT ? `Tickr Lab (${CONTACT})` : '')).trim();
const GAP_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ---- 1. the rates
  const have = await store.readFxRates('EUR');
  const last = have.length ? have[have.length - 1].d : null;
  const r = await fetch(have.length ? Fx.RECENT_URL : Fx.HIST_URL, { signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error('ECB answered ' + r.status);
  const got = Fx.parseEcb(await r.text());
  const fresh = last ? got.filter((x) => x.d > last) : got;
  console.log(`euro rates: ${have.length} stored${last ? ' to ' + last : ''}; the ECB file holds ${got.length}`
    + (got.length ? ` (${got[0].d} to ${got[got.length - 1].d})` : '') + `; ${fresh.length} new`);
  if (COMMIT && fresh.length) console.log(`  wrote ${await store.writeFxRates('EUR', fresh)} rows`);
  const fx = Fx.book(have.concat(fresh));
  if (RATES_ONLY) { if (!COMMIT) console.log('\nDRY RUN: nothing written. Re-run with --commit.'); return; }

  // ---- 2. the filers that read empty
  if (!SEC_UA) throw new Error('No SEC_UA, REPORT_TO or MAIL_FROM in .env: the SEC refuses an undeclared client.');
  const universe = new Set((await store.readUniverse()).map((s) => String(s).toUpperCase()));
  const state = await store.readSecState();
  const todo = Object.keys(state).filter((sym) => universe.has(sym) && state[sym].cik
    && (ONLY ? ONLY.includes(sym) : (state[sym].status === 'empty' || state[sym].status === 'currency'))).sort();
  console.log(`\nfilers to re-read: ${todo.length}` + (ONLY ? ' (named)' : ' (status empty or currency)'));
  const tally = {};
  const say = (k) => { tally[k] = (tally[k] || 0) + 1; };
  for (const sym of todo) {
    const cik = state[sym].cik;
    let line = sym.padEnd(7);
    try {
      const res = await fetch('https://data.sec.gov/api/xbrl/companyfacts/CIK' + String(cik).padStart(10, '0') + '.json', {
        headers: { 'User-Agent': SEC_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      // A 429 is a wait, never a retry, and the run stops: the next company
      // would only be refused as well.
      if (res.status === 429) { console.log(line + 'throttled by the SEC; stopping here.'); break; }
      if (res.status === 404) { say('no facts'); console.log(line + 'no facts on file'); await sleep(GAP_MS); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const facts = await res.json();
      const tax = SecFacts.taxonomyOf(facts);
      const cur = SecFacts.currencyOf(facts);
      const rows = SecFacts.normalise(facts, sym, cur === 'EUR' ? { fx, fxCurrency: 'EUR' } : undefined);
      if (!rows.length) {
        if (cur && cur !== 'USD' && cur !== 'EUR') {
          say('reports in ' + cur);
          line += `reports in ${cur}: not converted`;
          if (COMMIT) await store.noteSecMiss(sym, 'currency', 'reports in ' + cur, cik, { taxonomy: tax, currency: cur });
        } else { say('still empty'); line += `still empty (${tax})`; }
        console.log(line);
      } else {
        const fy = rows.filter((x) => x.periodType === 'FY').length, q = rows.filter((x) => x.periodType === 'Q').length;
        const newest = rows[0];
        say(cur === 'EUR' ? 'recovered, from euros' : 'recovered, in dollars');
        line += `${rows.length} rows (${fy} annual, ${q} quarterly)`
          + (cur === 'EUR' ? ', from euros' : cur ? `, ${cur}` : '')
          + ` · newest ${newest.periodEnd} revenue ${newest.revenue == null ? '—' : '$' + (newest.revenue / 1e9).toFixed(2) + 'B'}`
          + (newest.fxAvg ? ` at ${newest.fxAvg.toFixed(4)}` : '');
        console.log(line);
        if (COMMIT) {
          const lastFiled = rows.reduce((m, x) => (SecFacts.isStatement(x) && x.filed && (!m || x.filed > m) ? x.filed : m), null);
          // How it files rides along, for the screener's Filer column.
          await store.writeSecFacts(sym, rows, { cik, status: 'ok', lastFiled, taxonomy: tax, currency: cur });
        }
      }
    } catch (e) { say('failed'); console.log(line + 'failed: ' + e.message); }
    await sleep(GAP_MS);
  }
  console.log('\n' + Object.keys(tally).sort().map((k) => `${k}: ${tally[k]}`).join(' · '));
  if (!COMMIT) console.log('DRY RUN: nothing written. Re-run with --commit.');
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
