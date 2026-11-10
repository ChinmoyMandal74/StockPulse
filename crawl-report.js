#!/usr/bin/env node
// The morning email on the website crawl (2026-11-10, the owner: "send me a
// daily email in the morning on the crwal previous night"). The crawl's
// databases live on this laptop only (formd.db, web-archive.db), so the
// figures are counted here (crawlstats.js) and sent to the app, which mails
// them to the operator (/api/cron/crawl-report). Counts only: no page text,
// no company leaves the laptop.
//
// Run by the nightly websites task straight after the crawl ends
// (website-task.ps1 writes both lines into websites.run.cmd), so it arrives
// around 06:45. Reads the databases and never writes them; spends nothing.
//
//   node crawl-report.js          count and send
//   node crawl-report.js --dry    print what it would send, send nothing
//
// Exit code 0 when the app took the report, 1 otherwise.
'use strict';
const fs = require('fs');
const path = require('path');
const CS = require('./crawlstats.js');

const DRY = process.argv.includes('--dry');
const ROOT = __dirname;
const CAP_GB = 12;

function fromEnvFile(k) {
  let raw;
  try { raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8'); } catch { return ''; }
  for (const line of raw.split(/\r?\n/)) {
    const m = new RegExp('^\\s*' + k + '\\s*=\\s*(.*)$').exec(line);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}
const stamp = () => new Date().toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '') + ' ET';
const fileSize = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
function logTail(file) {
  try {
    const size = fs.statSync(file).size, fd = fs.openSync(file, 'r');
    try { const n = Math.min(size, 65536), b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, size - n); return b.toString('utf8'); } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

// The report: the night just run, the whole list, the archive. Exported for the test.
function report(db, web, now, extra = {}) {
  const f = CS.figures(db, web, { now, archiveBytes: extra.archiveBytes });
  const night = CS.nightOf(now);
  const last = f.nights.find((x) => x.night === night) || { night, tried: 0, confirmed: 0, nameOnly: 0, none: 0, read: 0, usd: 0, kept: 0, pages: 0, chars: 0, requests: 0, first: null, last: null };
  return {
    at: now, host: require('os').hostname(), night: last,
    total: { target: f.target, tried: f.triedInList, left: f.left, confirmed: f.confirmed, kept: f.kept, pages: f.pages, chars: f.pageChars, usd: f.usd,
      earlier: f.earlierVersions, pace: f.pace, nightsLeft: f.nightsLeft, finish: f.finish, archiveBytes: f.archiveBytes, capBytes: CAP_GB * 1e9 },
    run: CS.lastRun(extra.log || ''),
  };
}

async function main() {
  let body;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(ROOT, 'formd.db'), { readOnly: true });
    const webFile = path.join(ROOT, 'web-archive.db');
    const web = fs.existsSync(webFile) ? new DatabaseSync(webFile, { readOnly: true }) : null;
    try {
      body = report(db, web, Date.now(), { archiveBytes: fileSize(webFile) + fileSize(webFile + '-wal'), log: logTail(path.join(ROOT, 'website-load.log')) });
    } finally { db.close(); if (web) web.close(); }
  } catch (e) {
    // The email still goes: figures that cannot be counted are the news.
    body = { at: Date.now(), host: require('os').hostname(), error: String(e.message).split('\n')[0].slice(0, 200) };
  }
  if (DRY) { console.log(JSON.stringify(body, null, 2)); return; }
  const secret = fromEnvFile('CRON_SECRET');
  const base = (fromEnvFile('APP_URL') || 'https://www.tickrlab.com').replace(/\/+$/, '');
  const i = process.argv.indexOf('--base');
  const url = (i > 0 ? process.argv[i + 1] : base) + '/api/cron/crawl-report';
  if (!secret) { console.log(stamp() + '  crawl report FAILED  CRON_SECRET is not in .env'); process.exitCode = 1; return; }
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + secret }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({}));
    console.log(stamp() + '  crawl report ' + (r.ok && j.sent ? 'sent: ' + (body.night ? body.night.tried + ' tried last night, ' + body.total.tried + ' of ' + body.total.target + ' in all' : 'the figures could not be counted') : 'FAILED  the app answered ' + r.status + ' ' + (j.error || '')));
    if (!r.ok || !j.sent) process.exitCode = 1;
  } catch (e) {
    console.log(stamp() + '  crawl report FAILED  ' + String(e.message).split('\n')[0]);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { report };
