#!/usr/bin/env node
// Fills the local earnings release text archive (releasearchive.js) with every
// release earnings_releases has read since 2017: each filing's Exhibit 99.1
// fetched again from the SEC and kept as text (2026-11-01, the owner: "Build
// it now"). New releases are kept by release-load.js as it reads them; this
// is the history.
//
//   node --use-system-ca release-archive-load.js            fetch and keep (newest first)
//   node --use-system-ca release-archive-load.js --dry      count what is left, fetch nothing
//   ... --limit 200       stop after 200 fetches
//   ... --retry-misses    ask again for exhibits the SEC refused before (404s)
//
// THE LIST comes from the local research copy (analysis.db, earnings_releases:
// every filing with an exhibit), not Turso, so a fill reads no billed rows.
// Sync it first (node --use-system-ca analysis-db.js) to include the latest.
//
// IT RESUMES BY ITSELF. Every filing kept is skipped next time, and an exhibit
// the SEC answered 404 for is noted (misses) and skipped too. Stop it, close
// the laptop, restart the machine: run the same command again and it carries
// on from what is left. A lock file stops two copies running at once. A
// lost connection (the laptop asleep) is waited out, up to about 25 minutes,
// before the filing is left for the next run.
//
// SEC: sequential, declared user agent, one request every PACE_MS (600 ms,
// under two a second; the SEC allows ten). This address has had a 429 and a
// 403 before: either stops the run at once ("a 429 is a wait, not a retry").
// Spends no API credit and no model call. Writes only the local file.
'use strict';
require('dotenv').config({ override: true });
const fs = require('fs');
const path = require('path');
const Rel = require('./releases.js');
const RA = require('./releasearchive.js');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DRY = argv.includes('--dry');
const RETRY_MISSES = argv.includes('--retry-misses');
const LIMIT = Number(opt('--limit', 0)) || Infinity;
const PACE_MS = 600;
const contact = (process.env.REPORT_TO || process.env.MAIL_FROM || '').replace(/.*</, '').replace(/>.*/, '').trim();
const UA = String(process.env.SEC_UA || (contact ? 'Tickr Lab (' + contact + ')' : '')).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString();
const LOCK = path.join(__dirname, 'release-archive-load.lock');

class Stop extends Error {}

// One copy at a time: the lock holds the pid, and a lock whose process is
// gone (the machine restarted mid-run) is taken over.
function takeLock() {
  try {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    if (pid && pid !== process.pid) {
      try { process.kill(pid, 0); return false; } catch { /* gone: take it over */ }
    }
  } catch { /* no lock */ }
  fs.writeFileSync(LOCK, String(process.pid));
  return true;
}
const dropLock = () => { try { if (Number(fs.readFileSync(LOCK, 'utf8')) === process.pid) fs.unlinkSync(LOCK); } catch { /* fine */ } };

// The exhibit's text, or { status } for an answer that is not one. Waits out
// a lost connection: 15 s, then 30, 60, 120 and 240 s, then twice 8 minutes.
async function fetchText(url) {
  const waits = [15, 30, 60, 120, 240, 480, 480];
  for (let a = 0; ; a++) {
    await sleep(PACE_MS);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(60000) });
      if (r.status === 429 || r.status === 403) throw new Stop('the SEC answered ' + r.status + '; stopping. Wait an hour or more, then run the same command again.');
      if (!r.ok) return { status: r.status };
      return { text: Rel.toText(await r.text()) };
    } catch (err) {
      if (err instanceof Stop) throw err;
      if (a >= waits.length) return { status: 0, error: String(err.message).slice(0, 80) };
      console.log(`  [${stamp()}] no connection (${String(err.message).slice(0, 60)}); waiting ${waits[a]}s`);
      await sleep(waits[a] * 1000);
    }
  }
}

async function main() {
  if (!UA) throw new Stop('no SEC user agent: set SEC_UA, REPORT_TO or MAIL_FROM');
  const { DatabaseSync } = require('node:sqlite');
  const src = new DatabaseSync(path.join(__dirname, 'analysis.db'), { readOnly: true });
  const rows = src.prepare(`select accn, symbol, filed, period_end, period_label, is_results, url, exhibit from earnings_releases
                            where exhibit is not null and url is not null order by filed desc, accn`).all();
  src.close();
  const A = RA.open();
  const have = A.accns();
  const misses = RETRY_MISSES ? new Set() : A.missed();
  const todo = rows.filter((r) => !have.has(r.accn) && !misses.has(r.accn));
  console.log(`[${stamp()}] release text archive: ${rows.length} releases with an exhibit on file, ${have.size} kept, ${misses.size} refused before, ${todo.length} to fetch`
    + (DRY ? ' (dry run: nothing fetched)' : `; about ${Math.round(todo.length * (PACE_MS + 250) / 3600000 * 10) / 10} hours at one every ${PACE_MS} ms`));
  if (DRY || !todo.length) { A.close(); return; }
  if (!takeLock()) { console.log('  another fill is already running (' + LOCK + '); leaving it to finish'); A.close(); return; }
  const t0 = Date.now();
  let kept = 0, refused = 0, failed = 0, n = 0;
  const report = () => {
    const per = (Date.now() - t0) / Math.max(1, n);
    console.log(`  ${n}/${todo.length}  ${kept} kept, ${refused} refused by the SEC, ${failed} left for next time; `
      + `${A.count()} in the archive; about ${Math.round((todo.length - n) * per / 360000) / 10} hours to go`);
  };
  try {
    for (const r of todo) {
      if (n >= LIMIT) { console.log('  stopping: --limit'); break; }
      n++;
      const got = await fetchText(r.url);
      if (got.text) {
        if (A.put({ accn: r.accn, symbol: r.symbol, filed: r.filed, text: got.text, url: r.url, exhibit: r.exhibit,
          period_end: r.period_end, period_label: r.period_label, is_results: r.is_results == null ? null : Number(r.is_results) === 1 }).added) kept++;
      } else if (got.status === 404 || got.status === 410 || got.text === '') {
        A.miss(r.accn, got.status || 0); refused++;
        console.log(`  ${r.symbol} ${r.filed} ${r.accn}: the SEC answered ${got.status || 'an empty page'}; noted, not asked again`);
      } else {
        failed++;
        console.log(`  ${r.symbol} ${r.filed} ${r.accn}: ${got.status ? 'the SEC answered ' + got.status : got.error}; left for next time`);
      }
      if (n % 250 === 0) report();
    }
  } finally {
    report();
    console.log(`[${stamp()}] done for now: ${kept} kept this run; ${Math.round((Date.now() - t0) / 60000)} min`);
    A.close();
    dropLock();
  }
}

main().catch((e) => {
  console.log(`[${stamp()}] ${e instanceof Stop ? 'STOPPED' : 'FAILED'}: ${e.message}`);
  dropLock();
  process.exitCode = 1;
});
