// Load the SEC's quarterly Form 345 data sets into `insider_trans`.
//
// LOCAL, LIKE backfill-bars.js, AND FOR THE SAME REASON: the source is an
// ~11MB zip per quarter that unpacks to ~60MB of TSV. That has no business
// inside a serverless request — the lesson a 504 at 300.1s already taught
// this project once. Run it here, write the rows, let the app read them.
//
// Dry run by default. Nothing is written without --commit.
//
//   node --use-system-ca insider-load.js                  # what it would do
//   node --use-system-ca insider-load.js --commit         # last 8 quarters
//   node --use-system-ca insider-load.js --commit --quarters 20
//   node --use-system-ca insider-load.js --commit --from 2019q1 --to 2019q4
//   node --use-system-ca insider-load.js --commit --force  # reload stored ones
//
// WINDOWS-ONLY, deliberately: it shells out to PowerShell's Expand-Archive
// rather than adding a zip dependency to a project that has three. The
// machine that runs the intraday schedule is the machine that runs this.
'use strict';
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const store = require('./db.js');
const Insider = require('./insider.js');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const COMMIT = has('--commit');
const FORCE = has('--force');
const QUARTERS = Math.max(1, Number(val('--quarters', 8)));

// The SEC wants a contact string and refuses an undeclared bot. Same
// fallback the filings loader uses, so this needs no new variable.
// MAIL_FROM is a mail header and carries a display name — `Tickr Lab
// <no-reply@...>` — so the address has to be lifted out of it, the same
// thing fromHeader() does in server.js. Angle brackets in a User-Agent are
// at best ugly and at worst refused.
const addressOf = (s) => (/<([^>]+)>/.exec(String(s || '')) || [, s])[1] || '';
const CONTACT = addressOf(process.env.REPORT_TO || process.env.MAIL_FROM || '').trim();
const UA = (process.env.SEC_UA || (CONTACT ? `Tickr Lab (${CONTACT})` : '')).trim();

// THE PATH MOVED. Recent quarters live under `datastandardsinnovation`,
// everything older under `structureddata`, and a loader that knows only one
// silently stops finding new quarters. Both are tried, newest path first.
const BASES = [
  'https://www.sec.gov/files/datastandardsinnovation/data/insider-transactions-data-sets/',
  'https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/',
];

function quarterList(n) {
  const to = val('--to', null);
  const from = val('--from', null);
  const now = new Date();
  let y = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3) + 1;
  // The current quarter is not published until it ends.
  q -= 1; if (q === 0) { q = 4; y -= 1; }
  const out = [];
  if (from) {
    const [fy, fq] = from.toLowerCase().split('q').map(Number);
    let [ty, tq] = to ? to.toLowerCase().split('q').map(Number) : [y, q];
    let cy = fy; let cq = fq;
    while (cy < ty || (cy === ty && cq <= tq)) {
      out.push(cy + 'q' + cq);
      cq += 1; if (cq === 5) { cq = 1; cy += 1; }
    }
    return out;
  }
  for (let i = 0; i < n; i++) {
    out.unshift(y + 'q' + q);
    q -= 1; if (q === 0) { q = 4; y -= 1; }
  }
  return out;
}

const qRange = (quarter) => {
  const [y, q] = quarter.toLowerCase().split('q').map(Number);
  const startM = (q - 1) * 3 + 1;
  const endM = startM + 2;
  const last = new Date(Date.UTC(y, endM, 0)).getUTCDate();
  const p = (n) => String(n).padStart(2, '0');
  return { from: `${y}-${p(startM)}-01`, to: `${y}-${p(endM)}-${p(last)}` };
};

async function download(quarter, dir) {
  const name = quarter + '_form345.zip';
  let last = null;
  for (const base of BASES) {
    const res = await fetch(base + name, {
      headers: { 'User-Agent': UA, Accept: 'application/zip' },
      signal: AbortSignal.timeout(120000),
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const zip = path.join(dir, name);
      fs.writeFileSync(zip, buf);
      return { zip, bytes: buf.length, base };
    }
    last = res.status;
  }
  throw new Error('not published (HTTP ' + last + ')');
}

// PowerShell rather than a dependency. -Force so a retry overwrites.
function unzip(zip, dir) {
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`],
  { stdio: 'pipe' });
}

// A plain TSV reader. These files have no quoting — the SEC's own readme
// says tab-delimited with newline rows — so nothing fancier is warranted,
// and a CSV parser would be slower over 78,000 rows.
function tsv(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const lines = txt.split(/\r?\n/);
  const head = lines[0].split('\t');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const p = lines[i].split('\t');
    const o = {};
    for (let j = 0; j < head.length; j++) o[head[j]] = p[j];
    out.push(o);
  }
  return out;
}

(async () => {
  if (!UA) {
    console.error('No contact address. Set MAIL_FROM, REPORT_TO or SEC_UA — the SEC refuses requests without one.');
    process.exit(1);
  }
  const quarters = quarterList(QUARTERS);
  const done = new Map((await store.readInsiderState()).map((r) => [r.quarter, r]));
  console.log((COMMIT ? 'LOADING' : 'DRY RUN — nothing will be written') + '  ·  ' +
    quarters.length + ' quarters: ' + quarters[0] + ' … ' + quarters[quarters.length - 1]);
  console.log('contact: ' + UA + '\n');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ins-'));
  let total = 0; let skipped = 0; const t0 = Date.now();
  for (const q of quarters) {
    const prev = done.get(q);
    if (prev && prev.status === 'ok' && !FORCE) {
      console.log(q + '  already loaded (' + prev.rows.toLocaleString() + ' rows) — skipping');
      skipped++; continue;
    }
    const dir = path.join(tmp, q);
    fs.mkdirSync(dir, { recursive: true });
    try {
      const t = Date.now();
      const { zip, bytes } = await download(q, dir);
      unzip(zip, dir);
      const rows = Insider.build(
        tsv(path.join(dir, 'SUBMISSION.tsv')),
        tsv(path.join(dir, 'REPORTINGOWNER.tsv')),
        tsv(path.join(dir, 'NONDERIV_TRANS.tsv')));
      const buys = rows.filter((r) => r.buy).length;
      const line = q + '  ' + (bytes / 1e6).toFixed(1) + 'MB  ' +
        rows.length.toLocaleString().padStart(7) + ' kept  ' +
        buys.toLocaleString().padStart(6) + ' buys  ' +
        ((Date.now() - t) / 1000).toFixed(1) + 's';
      if (COMMIT) {
        const { from, to } = qRange(q);
        await store.writeInsiderQuarter(q, rows, { from, to, status: 'ok' });
        console.log(line + '  written');
      } else {
        console.log(line + '  (dry run)');
      }
      total += rows.length;
    } catch (e) {
      console.log(q + '  FAILED: ' + e.message);
      if (COMMIT) await store.writeInsiderQuarter(q, [], { status: 'error', error: e.message }).catch(() => {});
    } finally {
      // These unpack to 60MB each; leaving twenty of them behind is rude.
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + (COMMIT ? 'wrote ' : 'would write ') + total.toLocaleString() +
    ' transactions across ' + (quarters.length - skipped) + ' quarters in ' +
    ((Date.now() - t0) / 60000).toFixed(1) + ' min');
  if (!COMMIT) console.log('Nothing was written. Re-run with --commit.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
