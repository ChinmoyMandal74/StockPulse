#!/usr/bin/env node
// Ask production to send the daily jobs email (jobsdigest.js), from the
// scheduler on Fly.io at 20:00 Eastern. One HTTP call, NOT `node server.js`:
// the work lives behind POST /api/cron/jobs-digest on the deployed app.
//
//   node digest-ping.js            send today's email (once a day; a second call sends nothing)
//   node digest-ping.js --dry      print today's summary, send nothing
//   node digest-ping.js --base URL point it somewhere else (a local server)
//
// The secret comes from .env beside this file (fly/cron.js writes one there),
// never from a command line. Exit 1 only when the server could not be reached,
// refused the secret, or answered an error.
'use strict';
const fs = require('fs');
const path = require('path');

const ARGV = process.argv.slice(2);
const DRY = ARGV.includes('--dry');
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

(async () => {
  const secret = fromEnvFile('CRON_SECRET');
  const base = (BASE_ARG || fromEnvFile('APP_URL') || 'https://www.tickrlab.com').replace(/\/+$/, '');
  if (!secret) { console.log('FAILED  CRON_SECRET is not in .env'); process.exitCode = 1; return; }
  let res, body;
  try {
    res = await fetch(base + '/api/cron/jobs-digest' + (DRY ? '?dry=1' : ''), {
      method: 'POST', signal: AbortSignal.timeout(120000),
      headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' }, body: '{}',
    });
    body = await res.text();
  } catch (e) { console.log('FAILED  could not reach ' + base + ' -- ' + e.message); process.exitCode = 1; return; }
  let j = null;
  try { j = JSON.parse(body); } catch { /* an HTML gateway page is not JSON */ }
  if (!res.ok || !j) { console.log('FAILED  HTTP ' + res.status + ' -- ' + String(body).slice(0, 160)); process.exitCode = 1; return; }
  if (DRY) { console.log(j.subject + '\n\n' + j.text); return; }
  console.log(j.already ? 'already sent today (' + j.already + ')' : j.sent ? 'sent: ' + j.runs + ' of ' + j.due + ' runs, ' + j.issues + ' to look at' : 'not sent');
  if (!j.sent && !j.already) process.exitCode = 1;
})();
