#!/usr/bin/env node
// Ask production to send the two evening news briefs (newsbrief.js), from the
// scheduler on Fly.io at 17:40 Eastern. One HTTP call, NOT `node server.js`:
// the work lives behind POST /api/cron/news-brief on the deployed app.
//
//   node news-brief-ping.js        send today's two briefs (once a day; a second call sends nothing)
//   node news-brief-ping.js --sample  mail both now, marked [Sample]; tonight's still go
//   node news-brief-ping.js --publish  publish both to /briefs now, mail nothing
//   node news-brief-ping.js --dry  print both, send nothing (still calls the model twice, about $0.33)
//   node news-brief-ping.js --base URL  point it somewhere else (a local server)
//
// The secret comes from .env beside this file (fly/cron.js writes one there),
// never from a command line. Exit 1 only when the server could not be reached,
// refused the secret, or answered an error.
'use strict';
const fs = require('fs');
const path = require('path');

const ARGV = process.argv.slice(2);
const DRY = ARGV.includes('--dry');
const SAMPLE = ARGV.includes('--sample');
const PUBLISH = ARGV.includes('--publish');
// --list (with --publish): then the morning mailing to the `briefs` list,
// a batch a call while any are left. The server decides whether it is the
// morning send (08:30 to 13:30 Eastern, today's edition on file) and keeps a
// ledger, so later runs of the day send nothing.
const LIST = ARGV.includes('--list');
const i = ARGV.indexOf('--base');
const BASE_ARG = i >= 0 && ARGV[i + 1] ? String(ARGV[i + 1]) : '';

function fromEnvFile(key) {
  let raw;
  try { raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8'); } catch { return ''; }
  for (const line of raw.split(/\r?\n/)) {
    const m = new RegExp('^\\s*' + key + '\\s*=\\s*(.*)$').exec(line);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

async function mailList(base, secret) {
  let sent = 0, failed = 0;
  for (let k = 0; k < 100; k++) {
    let j = null;
    try {
      const r = await fetch(base + '/api/cron/news-brief-list', { method: 'POST', signal: AbortSignal.timeout(120000),
        headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' }, body: '{}' });
      j = await r.json().catch(() => null);
      if (!r.ok || !j) { console.log('mailing: FAILED  HTTP ' + r.status); process.exitCode = 1; return; }
    } catch (e) { console.log('mailing: FAILED  ' + e.message); process.exitCode = 1; return; }
    if (j.skipped) { console.log('mailing: not sent (' + j.skipped + ')'); return; }
    sent += j.sent || 0; failed += j.failed || 0;
    if (!j.remaining || !(j.sent || j.failed || j.deferred)) { console.log('mailing: ' + sent + ' sent, ' + failed + ' refused, ' + (j.remaining || 0) + ' left of ' + (j.total || 0)); return; }
  }
}

(async () => {
  const secret = fromEnvFile('CRON_SECRET');
  const base = (BASE_ARG || fromEnvFile('APP_URL') || 'https://www.tickrlab.com').replace(/\/+$/, '');
  if (!secret) { console.log('FAILED  CRON_SECRET is not in .env'); process.exitCode = 1; return; }
  let res, body;
  try {
    res = await fetch(base + '/api/cron/news-brief' + (DRY ? '?dry=1' : ''), {
      method: 'POST', signal: AbortSignal.timeout(280000),
      headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' }, body: SAMPLE ? '{"sample":true}' : PUBLISH ? '{"publish":true}' : '{}',
    });
    body = await res.text();
  } catch (e) { console.log('FAILED  could not reach ' + base + ' -- ' + e.message); process.exitCode = 1; return; }
  let j = null;
  try { j = JSON.parse(body); } catch { /* an HTML gateway page is not JSON */ }
  if (!res.ok || !j) { console.log('FAILED  HTTP ' + res.status + ' -- ' + String(body).slice(0, 160)); process.exitCode = 1; return; }
  if (DRY) { console.log(j.today.subject + '\n\n' + j.today.text + '\n\n\n' + j.next.subject + '\n\n' + j.next.text); return; }
  const c = j.counts || {};
  if (PUBLISH) {
    console.log(j.published ? 'published: ' + j.counts.todayItems + ' lines today, ' + j.counts.items + ' for the next session' : 'not published');
    if (!j.published) process.exitCode = 1;
    if (LIST) await mailList(base, secret);
    return;
  }
  if (j.sample) { console.log(j.sent ? 'sample sent' : 'sample not sent'); if (!j.sent) process.exitCode = 1; return; }
  console.log(j.already ? 'already sent today (' + j.already + ')'
    : (j.sent ? 'sent: ' : 'not all sent (today ' + j.today + ', next ' + j.next + '): ')
      + c.todayItems + ' lines from ' + c.todayRead + ' articles' + (c.todayError ? ' (AI: ' + c.todayError + '; ' + c.shown + ' stories listed instead)' : '') + ', ' + c.items + ' next-session lines'
      + (c.aiError ? ' (AI: ' + c.aiError + ')' : '') + ', $' + c.spent);
  if (!j.sent && !j.already) process.exitCode = 1;
})();
