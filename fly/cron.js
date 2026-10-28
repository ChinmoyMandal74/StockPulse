// THE SCHEDULER ON FLY.IO (2026-10-28, the owner: "what are my options to move
// these jobs out of my laptop"). One always-on machine in Secaucus (fly.toml)
// runs this file and nothing else. Each minute it asks schedule.js which jobs
// marked host: 'fly' are due at this Eastern minute and starts their script,
// the same command the laptop's task ran. The declared schedule IS the
// crontab, so what runs here cannot drift from what /schedule shows.
//
// Task Scheduler's two settings are kept: a job still running is not started
// again (MultipleInstances IgnoreNew), and a run is stopped at its job's
// `limit` minutes (ExecutionTimeLimit).
//
// The pings read CRON_SECRET (and APP_URL) from .env beside them, never the
// environment, so the Fly secrets are written into one at start. The image
// holds only the files .dockerignore lets in; the secrets are not among them.
// Run output goes to stdout: `fly logs`. The runs themselves are recorded by
// the app (/refreshes, /news-runs).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const S = require('../schedule.js');

const ROOT = path.join(__dirname, '..');
const JOBS = S.JOBS.filter((j) => j.host === 'fly');
const running = new Map();

function say(line) { console.log(new Date().toISOString() + '  ' + line); }

function writeEnv() {
  // Only on Fly (which sets FLY_APP_NAME): run on the laptop, this would
  // overwrite the real .env with two keys.
  if (!process.env.FLY_APP_NAME) { say('not on Fly: .env left alone'); return; }
  const keys = ['CRON_SECRET', 'APP_URL'].filter((k) => process.env[k]);
  fs.writeFileSync(path.join(ROOT, '.env'), keys.map((k) => k + '=' + process.env[k]).join('\n') + '\n', { mode: 0o600 });
  if (!process.env.CRON_SECRET) say('NO CRON_SECRET: every ping will be refused. fly secrets set CRON_SECRET=...');
}

function start(job) {
  if (running.has(job.id)) { say(job.id + ': still running from an earlier start, not started again'); return; }
  const child = spawn(process.execPath, [job.script], { cwd: ROOT, stdio: 'inherit' });
  const began = Date.now();
  const timer = setTimeout(() => { say(job.id + ': past ' + job.limit + ' min, stopped'); child.kill('SIGTERM'); }, job.limit * 60000);
  running.set(job.id, child);
  say(job.id + ': started ' + job.script + ' (pid ' + child.pid + ')');
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    running.delete(job.id);
    say(job.id + ': ended ' + (signal ? 'by ' + signal : 'with code ' + code) + ' after ' + Math.round((Date.now() - began) / 1000) + ' s');
  });
  child.on('error', (e) => say(job.id + ': could not start: ' + e.message));
}

let last = '';
function tick() {
  const now = new Date();
  const { day, minute } = S.eastern(now);
  const key = day + ' ' + minute;
  // Once per Eastern minute, however the timer drifts; a minute the machine
  // was down for is not made up afterwards, as on the laptop.
  if (key !== last) {
    last = key;
    for (const job of JOBS) if (S.runsOn(job, day, now).includes(minute)) start(job);
  }
  setTimeout(tick, 60000 - (Date.now() % 60000) + 1000);
}

writeEnv();
say('scheduler up: ' + (JOBS.map((j) => j.id + ' (' + S.whenText(j) + ')').join('; ') || 'no job is marked host: fly'));
tick();
// A deploy or restart stops the machine with SIGTERM; pass it to running jobs.
process.on('SIGTERM', () => { for (const c of running.values()) c.kill('SIGTERM'); process.exit(0); });
