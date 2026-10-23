#!/usr/bin/env node
// Send the app this laptop's scheduled tasks, so /schedule shows what Task
// Scheduler really holds rather than what anyone remembers registering.
// Nothing more: one read of Task Scheduler and one HTTP call. It never starts
// server.js and spends nothing.
//
// Run hourly by its own task (schedule-report-task.ps1) and by every
// *-task.ps1 straight after it registers, so a change shows within a minute.
//
//   node schedule-report.js          read the tasks and send them
//   node schedule-report.js --dry    print what it would send, send nothing
//
// Exit code 0 when the app took the report, 1 otherwise.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DRY = process.argv.includes('--dry');
const ROOT = __dirname;

function fromEnvFile(k) {
  let raw;
  try { raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8'); } catch { return ''; }
  for (const line of raw.split(/\r?\n/)) {
    const m = new RegExp('^\\s*' + k + '\\s*=\\s*(.*)$').exec(line);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

// Dates as ISO text in PowerShell itself: Windows PowerShell 5.1 writes a
// DateTime into JSON as "\/Date(...)\/", which loses the offset.
const PS = `
$ErrorActionPreference = 'Stop'
$iso = { param($d) if ($d -and $d.Year -gt 2000) { $d.ToString('o') } else { $null } }
$out = @(Get-ScheduledTask -TaskName 'TickrLab*' -ErrorAction SilentlyContinue | ForEach-Object {
  $i = $_ | Get-ScheduledTaskInfo
  [pscustomobject]@{
    name = $_.TaskName
    state = [string]$_.State
    action = (($_.Actions | ForEach-Object { ([string]$_.Execute + ' ' + [string]$_.Arguments).Trim() }) -join ' ; ')
    triggers = @($_.Triggers | ForEach-Object {
      [pscustomobject]@{
        kind = ($_.CimClass.CimClassName -replace '^MSFT_Task', '' -replace 'Trigger$', '')
        start = [string]$_.StartBoundary
        days = $_.DaysOfWeek
        interval = [string]$_.Repetition.Interval
        duration = [string]$_.Repetition.Duration
        enabled = [bool]$_.Enabled
      }
    })
    lastRun = (& $iso $i.LastRunTime)
    lastResult = $i.LastTaskResult
    nextRun = (& $iso $i.NextRunTime)
    missed = $i.NumberOfMissedRuns
  }
})
ConvertTo-Json -InputObject $out -Depth 5 -Compress
`;

function stamp() {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '') + ' ET';
}

(async () => {
  let tasks;
  try {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS], { encoding: 'utf8', timeout: 60000, windowsHide: true });
    tasks = JSON.parse(raw.trim() || '[]');
    if (!Array.isArray(tasks)) tasks = [tasks];
  } catch (e) {
    console.log(stamp() + '  FAILED reading Task Scheduler: ' + String(e.message).split('\n')[0]);
    process.exitCode = 1; return;
  }
  const body = { at: Date.now(), host: require('os').hostname(), tasks };
  if (DRY) { console.log(JSON.stringify(body, null, 2)); return; }
  const secret = fromEnvFile('CRON_SECRET');
  const base = (fromEnvFile('APP_URL') || 'https://www.tickrlab.com').replace(/\/+$/, '');
  const i = process.argv.indexOf('--base');
  const url = (i > 0 ? process.argv[i + 1] : base) + '/api/schedule/report';
  if (!secret) { console.log(stamp() + '  FAILED  CRON_SECRET is not in .env'); process.exitCode = 1; return; }
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + secret }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    console.log(stamp() + '  ' + (r.ok ? 'sent ' + tasks.length + ' tasks' : 'FAILED  the app answered ' + r.status));
    if (!r.ok) process.exitCode = 1;
  } catch (e) {
    console.log(stamp() + '  FAILED  ' + String(e.message).split('\n')[0]);
    process.exitCode = 1;
  }
})();
