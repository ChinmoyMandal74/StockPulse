// Which funds hold each tracked stock (Form N-PORT): read the SEC's two
// newest quarterly data sets and write one summary per stock.
//
// LOCAL, AND ONLY LOCAL. Each data set is a 460MB download whose holdings
// table is close to a gigabyte unpacked. It is kept on disk and streamed,
// never loaded (zipread.js `streamLines`). This runs on the owner's machine,
// takes a few minutes, and writes about 1,300 short rows. The rules for what
// counts are nport.js.
//
// WHEN TO RUN IT. Four times a year, after the SEC publishes a new data set
// (a few weeks after each calendar quarter ends). It reads whichever two are
// newest and says which. Nothing schedules this.
//
// IT NEEDS THE SECURITY-CODE MAP that inst13f-load.js writes (`cusip_map`):
// a fund report names a holding by CUSIP, as a 13F does. Run that one first
// on a fresh database.
//
//   node --use-system-ca nport-load.js                  # report, write nothing
//   node --use-system-ca nport-load.js --commit
//   node --use-system-ca nport-load.js --show AAPL,GME  # print those stocks' largest funds
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const store = require('./db.js');
const Zip = require('./zipread.js');
const N = require('./nport.js');

const COMMIT = process.argv.includes('--commit');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOW = arg('--show') ? String(arg('--show')).toUpperCase().split(',').filter(Boolean) : ['AAPL'];
const TOP = 15;

const UA = process.env.SEC_UA
  || `Tickr Lab (${process.env.REPORT_TO || process.env.MAIL_FROM || 'owner@example.com'})`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIR = path.join(os.tmpdir(), 'tickrlab-sec');
fs.mkdirSync(DIR, { recursive: true });

// A data set, kept on disk between runs: these never change once published.
// Written under a temporary name and renamed, so an interrupted download is
// never mistaken for a finished one.
async function download(url) {
  const file = path.join(DIR, url.split('/').pop());
  if (fs.existsSync(file) && fs.statSync(file).size > 1e6) return file;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (r.status === 429) throw new Error('the SEC is throttling this address (429). Try again later.');
  if (!r.ok) throw new Error(url + ' answered ' + r.status);
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(file + '.part'));
  fs.renameSync(file + '.part', file);
  await sleep(800);
  return file;
}

// One data set -> { label, byStock: Map symbol -> Map fundId -> {...}, stats }.
async function readSet(file, cusips) {
  const es = Zip.entriesOfFile(file);
  const entry = (name) => { const e = es.find((x) => x.name.toUpperCase().endsWith(name)); if (!e) throw new Error('the data set has no ' + name); return e; };
  const table = async (name, fn) => { let H = null; await Zip.streamLines(file, entry(name), (line) => { if (!H) { H = N.header(line); return; } fn(N.cols(line), H); }); };

  const subs = {};
  await table('SUBMISSION.TSV', (c, H) => { subs[c[H.ACCESSION_NUMBER]] = { filed: N.isoDate(c[H.FILING_DATE]) || '', asOf: N.isoDate(c[H.REPORT_DATE]) }; });
  const regs = {};
  await table('REGISTRANT.TSV', (c, H) => { regs[c[H.ACCESSION_NUMBER]] = String(c[H.REGISTRANT_NAME] || '').trim(); });
  const infos = {};
  await table('FUND_REPORTED_INFO.TSV', (c, H) => {
    infos[c[H.ACCESSION_NUMBER]] = { id: String(c[H.SERIES_ID] || '').trim(), name: String(c[H.SERIES_NAME] || '').trim(), nav: Number(c[H.NET_ASSETS]) || 0 };
  });
  const pick = N.pickReports(subs, infos, regs);
  const ds = N.dataset();
  let rows = 0, used = 0;
  let H = null;
  await Zip.streamLines(file, entry('FUND_REPORTED_HOLDING.TSV'), (line) => {
    if (!H) { H = N.header(line); return; }
    rows++;
    // The accession number is the first field: checked before the line is
    // split, since most rows belong to a report that does not count.
    const fund = pick.get(line.slice(0, line.indexOf('\t')));
    if (!fund) return;
    const h = N.holdingOf(N.cols(line), H);
    if (!h) return;
    const sym = cusips.get(h.cusip);
    if (!sym) return;
    ds.add(sym, fund, h.shares, h.value);
    used++;
  });
  return { byStock: ds.done(), stats: { reports: Object.keys(infos).length, funds: pick.size, rows, used } };
}

(async () => {
  const universe = (await store.readUniverse()).map((s) => String(s).toUpperCase());
  const cusips = await store.readCusipMap();
  if (cusips.size < 100) throw new Error('no security-code map on file. Run inst13f-load.js --commit first: it writes the map this needs.');
  console.log(`security codes on file: ${cusips.size}`);

  const r = await fetch('https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error('the SEC page answered ' + r.status);
  const html = await r.text();
  const sets = [...new Set([...html.matchAll(/href="([^"]+_nport\.zip)"/g)].map((m) => (m[1].startsWith('http') ? m[1] : 'https://www.sec.gov' + m[1])))].slice(0, 2);
  if (!sets.length) throw new Error('no N-PORT data set found on the SEC page');
  const label = (u) => u.split('/').pop().replace(/_nport\.zip$/i, '');
  console.log('data sets: ' + sets.map(label).join(' and '));

  let t0 = Date.now();
  const cur = await readSet(await download(sets[0]), cusips);
  console.log(`${label(sets[0])}: ${cur.stats.funds.toLocaleString()} funds, ${cur.stats.rows.toLocaleString()} holdings rows read, `
    + `${cur.stats.used.toLocaleString()} are a long position in a tracked stock; ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  let prev = null;
  if (sets[1]) {
    t0 = Date.now();
    prev = await readSet(await download(sets[1]), cusips);
    console.log(`${label(sets[1])}: ${prev.stats.funds.toLocaleString()} funds, ${prev.stats.used.toLocaleString()} positions in a tracked stock; ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }

  const rows = [];
  for (const sym of universe) {
    const c = cur.byStock.get(sym);
    if (!c) continue;
    const s = N.summarise(c, prev ? prev.byStock.get(sym) || new Map() : null, TOP);
    if (!s.funds) continue;
    rows.push(Object.assign({ symbol: sym, label: label(sets[0]), prevLabel: prev ? label(sets[1]) : null }, s));
  }
  console.log(`\n${rows.length} of ${universe.length} tracked symbols are held by at least one fund`);
  for (const sym of SHOW) {
    const x = rows.find((y) => y.symbol === sym);
    if (!x) { console.log(`\n${sym}: nothing`); continue; }
    console.log(`\n${sym}: ${x.funds.toLocaleString()} funds hold ${(x.shares / 1e6).toFixed(1)}M shares, reports as of ${N.span(x.from, x.to)}`
      + (x.sharesPrev == null ? '' : `; shares ${N.change(x.shares, x.sharesPrev) >= 0 ? '+' : ''}${(N.change(x.shares, x.sharesPrev) || 0).toFixed(1)}% on the set before, ${x.added} new, ${x.exited} gone`));
    for (const h of x.top.slice(0, 8)) {
      console.log(`   ${h.name.slice(0, 46).padEnd(46)} ${(h.shares / 1e6).toFixed(1).padStart(8)}M  ${h.weight == null ? '    —' : h.weight.toFixed(2).padStart(5) + '%'} of the fund  ${h.asOf}`);
    }
  }
  if (COMMIT) {
    // Small batches, each tried twice: the connection has sat idle through
    // minutes of parsing, and these are upserts (inst13f-load.js's lesson).
    let n = 0;
    const failed = [];
    for (let i = 0; i < rows.length; i += 25) {
      const part = rows.slice(i, i + 25);
      let done = false, why = '';
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        try { n += await store.writeFundHolders(part); done = true; } catch (e) { why = e.message; await sleep(1500); }
      }
      if (!done) failed.push(part[0].symbol + '..' + part[part.length - 1].symbol + ': ' + why);
    }
    console.log(`\nwritten: ${n} of ${rows.length} stocks`);
    for (const f of failed) console.log('  NOT WRITTEN ' + f);
    if (failed.length) process.exitCode = 1;
  } else console.log('\nDRY RUN: nothing written. Re-run with --commit.');
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
