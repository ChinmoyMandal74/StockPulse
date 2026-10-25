// schedule.js: the declared schedule against the task scripts that register
// it, the Twelve Data windows, and the comparison with the laptop's report.
//   node schedule-test.js
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./schedule.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log('  FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };

// ---- 1. Every task script says what schedule.js says ------------------------
const scripts = fs.readdirSync(__dirname).filter((f) => /-task\.ps1$/.test(f));
for (const f of scripts) ok(S.JOBS.some((j) => j.taskScript === f), f + ' is declared in schedule.js');
for (const j of S.JOBS.filter((x) => x.taskScript)) {
  const file = path.join(__dirname, j.taskScript);
  if (!fs.existsSync(file)) { ok(false, j.taskScript + ' exists'); continue; }
  const src = fs.readFileSync(file, 'utf8');
  ok(new RegExp("\\$TaskName\\s*=\\s*'" + j.task + "'").test(src), j.id + ': task name ' + j.task);
  const assigned = src.split(/\r?\n/).filter((l) => /^\$\w+\s*=/.test(l)).join('\n');
  const times = [...assigned.matchAll(/'(\d\d:\d\d)'/g)].map((m) => m[1]).sort();
  if (j.repeat) {
    ok(times.length === 1 && times[0] === j.repeat.start, j.id + ': starts at ' + j.repeat.start, times);
    const every = /RepetitionInterval\s+\$?\(?(?:New-TimeSpan\s+-(Minutes|Hours)\s+(\d+))?/.exec(src);
    const evVar = /\$every\s*=\s*\(New-TimeSpan\s+-(Minutes|Hours)\s+(\d+)\)/.exec(src);
    const e = evVar || every;
    const everyMin = e && e[2] ? Number(e[2]) * (e[1] === 'Hours' ? 60 : 1) : null;
    ok(everyMin === j.repeat.every, j.id + ': every ' + j.repeat.every + ' min', everyMin);
    const durVar = /\$forHours\s*=\s*\(New-TimeSpan\s+-Hours\s+(\d+)\)/.exec(src) || /RepetitionDuration\s+\(New-TimeSpan\s+-Hours\s+(\d+)\)/.exec(src);
    const last = durVar ? S.hm(j.repeat.start) + Number(durVar[1]) * 60 : null;
    ok(last === S.hm(j.repeat.last), j.id + ': last run ' + j.repeat.last, last == null ? null : S.fmt(last));
  } else {
    ok(JSON.stringify(times) === JSON.stringify([...j.times].sort()), j.id + ': times ' + j.times.join(', '), times);
  }
  const weekdays = /Monday/.test(src) && !/-Daily/.test(src);
  const daily = /-Daily/.test(src);
  ok(j.days.length === 5 ? weekdays : daily, j.id + ': ' + (j.days.length === 5 ? 'weekdays' : 'every day'));
  ok(/schedule-report\.js/.test(src), j.id + ': the script sends a report after registering');
  ok(!/[^\x00-\x7F]/.test(src), j.taskScript + ' is ASCII');
}

// Every job's log link is a page the server serves (it once said /refresh-runs).
{
  const srv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  for (const j of S.JOBS) ok(srv.includes("app.get('" + j.log + "'"), j.id + ': its log link ' + j.log + ' is a page');
}

// ---- 2. The Twelve Data windows (the recon refresh asks busyAt) ------------
const at = (iso) => S.busyAt(new Date(iso));
ok(/nightly/.test(at('2026-10-22T08:00:00Z')), '04:00 ET Thu: nightly window');
ok(/nightly/.test(at('2026-10-22T07:55:00Z')), '03:55 ET: nightly window begins');
ok(at('2026-10-22T07:54:00Z') === null, '03:54 ET: clear');
ok(/nightly/.test(at('2026-10-22T08:50:00Z')) && at('2026-10-22T08:51:00Z') === null, '04:50 in, 04:51 clear');
ok(/nightly/.test(at('2026-10-22T20:30:00Z')), '16:30 ET: evening window');
ok(/intraday/.test(at('2026-10-22T14:15:00Z')) && /intraday/.test(at('2026-10-22T14:44:00Z')), '10:15 and 10:44 ET: intraday slots');
ok(at('2026-10-22T14:12:00Z') === null && at('2026-10-22T14:21:00Z') === null, '10:12 and 10:21 ET: clear');
ok(/nightly/.test(at('2026-10-24T08:00:00Z')) && at('2026-10-24T14:15:00Z') === null, 'Saturday: the 04:00 nightly window (2026-10-24), no intraday slots');
ok(at('2026-10-25T08:00:00Z') === null && at('2026-10-24T20:30:00Z') === null, 'Sunday 04:00 and Saturday 16:30: clear');
{ const nj = S.JOBS.find((j) => j.id === 'nightly'); ok(S.runsOn(nj, 'Sat').join() === '240' && S.runsOn(nj, 'Fri').join() === '240,960' && S.runsOn(nj, 'Sun').length === 0 && /Sat/.test(S.whenText(nj)), 'the nightly runs Saturday 04:00 as well', [S.runsOn(nj, 'Sat'), S.whenText(nj)]); }
ok(at('2026-12-03T09:00:00Z') !== null && at('2026-12-03T08:00:00Z') === null, 'December (EST): 04:00 ET is 09:00 UTC');

// ---- 3. Runs, words, the Vercel cron in Eastern ----------------------------
const job = (id) => S.JOBS.find((j) => j.id === id);
ok(S.runsOn(job('intraday'), 'Wed').length === 13 && S.runsOn(job('intraday'), 'Sat').length === 0, 'intraday: thirteen runs a weekday, none on Saturday');
ok(S.runsOn(job('schedule'), 'Sun').length === 24, 'schedule report: 24 a day');
ok(S.cronEastern('30 23 * * *', '2026-10-22T12:00:00Z') === 19 * 60 + 30, 'watchdog: 19:30 ET in October');
ok(S.cronEastern('30 23 * * *', '2026-12-03T12:00:00Z') === 18 * 60 + 30, 'watchdog: 18:30 ET in December');
ok(S.whenText(job('news')) === '05:00, 09:00, 13:00, 17:00, every day', 'words', S.whenText(job('news')));
ok(S.isoMinutes('PT30M') === 30 && S.isoMinutes('PT6H') === 360 && S.isoMinutes('P1D') === 1440 && S.isoMinutes('') === 0, 'ISO durations');
ok(JSON.stringify(S.maskDays(62)) === JSON.stringify(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) && S.maskDays(65).join() === 'Sun,Sat', 'day masks');

// ---- 4. Drift: the declared schedule beside a report -----------------------
// Real report shapes (schedule-report.js --dry on the laptop, 2026-10-22).
const tr = (kind, time, days, interval, duration) => ({ kind, start: '2026-10-01T' + time + ':00-04:00', days: days == null ? null : days, interval: interval || '', duration: duration || '', enabled: true });
const good = () => ({ at: Date.now(), tasks: [
  { name: 'TickrLab nightly', state: 'Ready', triggers: [tr('Weekly', '04:00', 62), tr('Weekly', '16:00', 62), tr('Weekly', '04:00', 64)] },
  { name: 'TickrLab intraday prices', state: 'Ready', triggers: [tr('Weekly', '09:45', 62, 'PT30M', 'PT6H')] },
  { name: 'TickrLab earnings releases', state: 'Ready', triggers: [tr('Weekly', '09:15', 62), tr('Weekly', '18:15', 62)] },
  { name: 'TickrLab news', state: 'Ready', triggers: [tr('Daily', '05:00'), tr('Daily', '09:00'), tr('Daily', '13:00'), tr('Daily', '17:00')] },
  { name: 'TickrLab news tone', state: 'Ready', triggers: ['00:30', '06:30', '12:30', '18:30'].map((t) => tr('Daily', t)) },
  { name: 'TickrLab schedule report', state: 'Ready', triggers: [tr('Daily', '00:05', null, 'PT1H', 'PT23H')] },
] });
let d = S.drift(good());
ok(Object.values(d.jobs).every((v) => v.status === 'ok' || v.status === 'remote') && d.unknown.length === 0, 'the real schedule: every job matches', d);
ok(d.jobs.watchdog.status === 'remote', 'the Vercel cron is not looked for on the laptop');
let r = good(); r.tasks[2].triggers = [tr('Weekly', '09:30', 62), tr('Weekly', '18:00', 62)];
d = S.drift(r);
ok(d.jobs.releases.status === 'differs' && d.jobs.releases.onlyLive.join() === 'weekdays 09:30,weekdays 18:00' && d.jobs.releases.onlyDeclared.join() === 'weekdays 09:15,weekdays 18:15', 'a moved time reads as the runs on each side', d.jobs.releases);
r = good(); r.tasks[0].triggers[1] = tr('Weekly', '16:00', 30);   // Mon-Thu
d = S.drift(r);
ok(d.jobs.nightly.status === 'differs' && d.jobs.nightly.onlyDeclared.join() === 'Fri 16:00', 'a dropped day is named', d.jobs.nightly);
r = good(); r.tasks[1].triggers = [tr('Weekly', '09:45', 62, 'PT30M', 'PT5H')];
d = S.drift(r);
ok(d.jobs.intraday.status === 'differs' && d.jobs.intraday.onlyDeclared.join() === 'weekdays 15:15,weekdays 15:45', 'a shorter repetition loses its last runs', d.jobs.intraday);
r = good(); r.tasks.splice(5, 1);
ok(S.drift(r).jobs.schedule.status === 'missing', 'an unregistered task is missing');
r = good(); r.tasks[3].state = 'Disabled';
ok(S.drift(r).jobs.news.status === 'disabled', 'a disabled task says so');
r = good(); r.tasks.push({ name: 'TickrLab something new', state: 'Ready', triggers: [tr('Daily', '11:00')] });
d = S.drift(r);
ok(d.unknown.length === 1 && d.unknown[0].runs.join() === 'daily 11:00', 'a task nobody declared is listed', d.unknown);
ok(S.drift(null).jobs.nightly.status === 'missing', 'no report: nothing matches');

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
