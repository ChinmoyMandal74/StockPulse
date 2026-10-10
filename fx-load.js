// Exchange rates, and the filings that were waiting for them.
//
// TWO JOBS, in the order they depend on each other:
//
//   1. Load daily exchange rates into fx_rates for every reporting currency
//      a filer here uses: about 7,100 rows a currency back to 1999 from the
//      European Central Bank, and the Taiwan dollar from Twelve Data (see
//      fx.js for why that one differs). The server tops each up by itself
//      from then on (fxFor in server.js); this is the first fill, which is
//      8MB of download and has no business in a request.
//
//   2. Re-read the companies whose filings came back EMPTY or UNCONVERTED.
//      Until 2026-10-10 the reader looked only at US GAAP facts, so a foreign
//      filer under international standards read as a company with nothing
//      filed -- Spotify among them. Each is fetched again and read by the
//      same secfacts.js the server uses: an IFRS filer reporting in dollars
//      needs no rate at all, and one reporting in another currency is
//      converted at the rate of each period.
//
// LOCAL because of the first job's size and the second's pacing: one request
// per company to an address that has throttled this project before, so it is
// sequential and slow on purpose. Dry run by default.
//
//   node --use-system-ca fx-load.js                 # report, write nothing
//   node --use-system-ca fx-load.js --commit
//   node --use-system-ca fx-load.js --commit --only SPOT,TSM
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

// One currency's rows from its source. The ECB's two files are each fetched
// at most once a run, however many currencies are read out of them.
const ecbText = {};
async function ratesFor(ccy, have) {
  if (Fx.sourceOf(ccy) === 'twelvedata') {
    const key = process.env.TWELVE_DATA_API_KEY;
    if (!key) throw new Error('no TWELVE_DATA_API_KEY for ' + ccy);
    const r = await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent('USD/' + ccy)}`
      + `&interval=1day&outputsize=${have ? 120 : 5000}&apikey=${key}`, { signal: AbortSignal.timeout(60000) });
    const j = await r.json();
    if (!j || j.status === 'error' || !j.values) throw new Error('Twelve Data: ' + String((j && j.message) || r.status).slice(0, 120));
    return Fx.parseTd(j.values);
  }
  const which = have ? 'RECENT_URL' : 'HIST_URL';
  if (!ecbText[which]) {
    const r = await fetch(Fx[which], { signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error('ECB answered ' + r.status);
    ecbText[which] = await r.text();
  }
  return Fx.parseEcbAll(ecbText[which], [ccy])[ccy] || [];
}

(async () => {
  const universe = new Set((await store.readUniverse()).map((s) => String(s).toUpperCase()));
  const state = await store.readSecState();

  // ---- 1. the rates, for every currency a filer here reports in
  const wanted = new Set(['EUR']);
  for (const sym of Object.keys(state)) {
    const c = state[sym].currency;
    if (universe.has(sym) && c && c !== 'USD') wanted.add(c);
  }
  const books = {};
  for (const ccy of [...wanted].sort()) {
    if (!Fx.supports(ccy)) { console.log(`${ccy}: no rate source, left unconverted`); continue; }
    const have = await store.readFxRates(ccy);
    const last = have.length ? have[have.length - 1].d : null;
    let fresh = [];
    try {
      const got = await ratesFor(ccy, have.length > 0);
      fresh = last ? got.filter((x) => x.d > last) : got;
      console.log(`${ccy} (${Fx.sourceOf(ccy)}): ${have.length} stored${last ? ' to ' + last : ''}; ${fresh.length} new`
        + (fresh.length ? ` (${fresh[0].d} to ${fresh[fresh.length - 1].d})` : ''));
      if (COMMIT && fresh.length) await store.writeFxRates(ccy, fresh);
    } catch (e) { console.log(`${ccy}: rates not fetched (${e.message}); using what is stored`); }
    books[ccy] = Fx.book(have.concat(fresh));
  }
  if (RATES_ONLY) { if (!COMMIT) console.log('\nDRY RUN: nothing written. Re-run with --commit.'); return; }

  // ---- 2. the filers that read empty, or could not be converted
  if (!SEC_UA) throw new Error('No SEC_UA, REPORT_TO or MAIL_FROM in .env: the SEC refuses an undeclared client.');
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
      const conv = !!cur && cur !== 'USD' && !!books[cur];
      const rows = SecFacts.normalise(facts, sym, conv ? { fx: books[cur], fxCurrency: cur } : undefined);
      if (!rows.length) {
        if (cur && cur !== 'USD' && !conv) {
          say('reports in ' + cur + ', unconverted');
          line += `reports in ${cur}: no rates for it`;
          if (COMMIT) await store.noteSecMiss(sym, 'currency', 'reports in ' + cur, cik, { taxonomy: tax, currency: cur });
        } else { say('still empty'); line += `still empty (${tax}${cur ? ', ' + cur : ''})`; }
        console.log(line);
      } else {
        const fy = rows.filter((x) => x.periodType === 'FY').length, q = rows.filter((x) => x.periodType === 'Q').length;
        const newest = rows.find((x) => x.revenue != null) || rows[0];
        say(cur && cur !== 'USD' ? 'recovered, from ' + cur : 'recovered, in dollars');
        line += `${rows.length} rows (${fy} annual, ${q} quarterly)`
          + (cur && cur !== 'USD' ? ', from ' + cur : cur ? ', USD' : '')
          + ` · ${newest.periodEnd} revenue ${newest.revenue == null ? '—' : '$' + (newest.revenue / 1e9).toFixed(2) + 'B'}`
          + (newest.fxAvg ? ` at ${Number(newest.fxAvg).toPrecision(4)}` : '');
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
