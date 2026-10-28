// EVERY SCHEDULED JOB, in one place (the owner, 2026-10-22: "a new page
// showing all scheduled jobs and the timings of them and keep it updated at
// all times so that we can easily decide on making adjustments").
//
// THIS IS THE DECLARED SCHEDULE: what each job is meant to do and when. The
// LIVE schedule is whatever Windows Task Scheduler holds on the owner's
// laptop; schedule-report.js sends that to the app every hour and after every
// task script registers, and `drift` below sets the two side by side. So a
// change to a *-task.ps1 changes this file in the same commit, and
// schedule-test.js fails until it does.
//
// Times are Eastern. The laptop is on Eastern, so a Task Scheduler time is an
// Eastern time; Vercel's crons are UTC and are converted for the day asked.
//
// Pure: no requires, no I/O. Loaded by server.js and by schedule-test.js.
'use strict';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const ALL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// spends.kind: 'twelve' (Twelve Data credits, the hard 610 a minute),
// 'anthropic' (API dollars), 'free'.
const JOBS = [
  {
    id: 'nightly', name: 'Nightly refresh', task: 'TickrLab nightly', host: 'laptop', script: 'nightly-ping.js', taskScript: 'nightly-task.ps1',
    days: WEEKDAYS, times: ['04:00', '16:00'], minutes: 55,
    // SATURDAY 04:00 TOO (2026-10-24, the owner): Friday's 8-Ks and 13D/13G
    // filings were read only on Monday, so /filings showed Thursday all weekend.
    extra: [{ days: ['Sat'], times: ['04:00'] }],
    spends: { kind: 'twelve', text: 'About 14,000 credits a run: ~171 profiles at 80, seven a minute, plus prices and up to five split calls; in an earnings season up to 100 more profiles of companies that just reported (about 8,000 credits)' },
    what: 'The SEC daily index first (yesterday\'s 8-Ks and 13D/13G), so the profile rotation can also pull the companies that just reported (reportdue.js); then the filings phases: SEC rotation, short interest, index holdings, insider filings, splits and options open interest.',
    log: '/refreshes',
  },
  {
    id: 'intraday', name: 'Intraday prices', task: 'TickrLab intraday prices', host: 'laptop', script: 'intraday-ping.js', taskScript: 'intraday-task.ps1',
    days: WEEKDAYS, repeat: { start: '09:45', every: 30, last: '15:45' }, minutes: 3,
    // 09:32 TOO (2026-10-28, the owner): the opening prices, two minutes after
    // the bell, rather than waiting for 09:45. Its own trigger in the task.
    extra: [{ days: WEEKDAYS, times: ['09:32'] }],
    spends: { kind: 'twelve', text: 'About 1 credit a stock (~1,300 a run), fourteen runs a day' },
    what: 'Live prices for the whole universe through the session, from 09:32 just after the opening bell. No 16:00 run: the evening nightly records the settled close.',
    log: '/refreshes',
  },
  {
    id: 'releases', name: 'Earnings releases', task: 'TickrLab earnings releases', host: 'laptop', script: 'release-load.js', taskScript: 'release-task.ps1',
    days: WEEKDAYS, times: ['09:15', '18:15'], minutes: 10,
    // SATURDAY 05:00 TOO (2026-10-25, the owner): Friday's 8-Ks, recorded by
    // the Saturday 04:00 nightly, read the same morning rather than Monday.
    extra: [{ days: ['Sat'], times: ['05:00'] }],
    spends: { kind: 'anthropic', text: 'About $0.002 a release, capped at $2 a run' },
    what: 'Reads the press release of every results 8-K the nightly runs recorded (the morning run reads the previous business day; Saturday 05:00 reads Friday’s), checks older ones against their 10-Q, and rebuilds the screener group and the S&P 500 recon. When it read new results, emails the owner a digest of them; after a weekday morning run, sends the Earnings results mailing to its subscribers.',
    log: '/news-runs',
  },
  {
    id: 'news', name: 'Headlines', task: 'TickrLab news', host: 'laptop', script: 'news-ping.js', taskScript: 'news-task.ps1',
    days: ALL_DAYS, times: ['05:00', '09:00', '13:00', '17:00'], minutes: 6,
    spends: { kind: 'free', text: 'Free (Google News search feeds, keyless)' },
    what: 'Tops up the headlines for the stocks whose news is oldest, batch by batch until nothing is stale.',
    log: '/news-runs',
  },
  {
    id: 'tone', name: 'Article tone', task: 'TickrLab news tone', host: 'laptop', script: 'news-tone-load.js', taskScript: 'news-tone-task.ps1',
    // HOURLY ON WEEKDAYS (2026-10-26, the owner): :26 past, 07:26 to 18:26,
    // not 16:26 (the nightly's hour); 00:30 every night; weekends three times.
    days: ALL_DAYS, times: ['00:30'], minutes: 30,
    extra: [{ days: WEEKDAYS, times: ['07:26', '08:26', '09:26', '10:26', '11:26', '12:26', '13:26', '14:26', '15:26', '17:26', '18:26'] }, { days: ['Sat', 'Sun'], times: ['06:30', '12:30', '18:30'] }],
    spends: { kind: 'anthropic', text: 'Claude Haiku, capped at $3 a run; charged per article read once, so more runs read the same articles sooner, not more of them' },
    what: 'Reads each new article in the Yahoo Finance feed of every company on the screener (since 2026-10-26; the S&P 500 and the semiconductors before) and stores its kind, tone and a two-sentence summary.',
    log: '/news-runs',
  },
  {
    id: 'schedule', name: 'Schedule report', task: 'TickrLab schedule report', host: 'laptop', script: 'schedule-report.js', taskScript: 'schedule-report-task.ps1',
    days: ALL_DAYS, repeat: { start: '00:05', every: 60, last: '23:05' }, minutes: 1,
    spends: { kind: 'free', text: 'Free' },
    what: 'Sends this page the laptop\'s task list: each task\'s times, last run, result and next run.',
    log: '/schedule',
  },
  {
    id: 'watchdog', name: 'Watchdog', task: null, host: 'vercel', cron: '30 23 * * *', minutes: 1,
    days: ALL_DAYS,
    spends: { kind: 'free', text: 'Free' },
    what: 'Runs on Vercel, not the laptop, so a laptop that slept is still noticed: mails the owner when the nightly did not run.',
    log: '/refreshes',
  },
];

// THE TWELVE DATA WINDOWS nothing else may spend credits in: the nightly's
// rounds and the intraday slots (CLAUDE.md, Budgets). One definition, used by
// the recon's behind refresh (server.js) and drawn on /schedule.
const RESERVED = [
  { label: 'Nightly refresh window', days: WEEKDAYS, from: '03:55', to: '04:50' },
  { label: 'Nightly refresh window', days: WEEKDAYS, from: '15:55', to: '16:50' },
  { label: 'Nightly refresh window', days: ['Sat'], from: '03:55', to: '04:50' },
];
// The intraday slots: minutes 13 to 20 and 43 to 50 of each hour, 9:10 to 16:20,
// and the opening run's 9:30 to 9:37 (a 09:32 start, about three minutes).
const SLOT = { from: '09:10', to: '16:20', minutes: [[13, 20], [43, 50]], extra: [{ from: '09:30', to: '09:37' }] };

const hm = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
const fmt = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

// Eastern weekday and minute of the day for an instant.
function eastern(now) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now || new Date());
  const get = (t) => (p.find((x) => x.type === t) || {}).value;
  return { day: get('weekday'), minute: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

// What spending Twelve Data credits at this instant would collide with, or null.
function busyAt(now) {
  const { day, minute } = eastern(now);
  for (const w of RESERVED) if (w.days.includes(day) && minute >= hm(w.from) && minute <= hm(w.to)) return 'the nightly refresh window';
  if (WEEKDAYS.includes(day) && minute >= hm(SLOT.from) && minute <= hm(SLOT.to)) {
    const mm = minute % 60;
    if (SLOT.minutes.some(([a, b]) => mm >= a && mm <= b)) return 'an intraday price slot';
    if (SLOT.extra.some((w) => minute >= hm(w.from) && minute <= hm(w.to))) return 'an intraday price slot';
  }
  return null;
}

// Eastern minutes of a UTC cron's "M H * * *" on a given date (the offset
// changes with daylight saving).
function cronEastern(cron, date) {
  const [m, h] = String(cron).split(/\s+/).map(Number);
  const d = date ? new Date(date) : new Date();
  const at = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m));
  return eastern(at).minute;
}

// Every start minute (Eastern) a job has on a day of the week. `extra`:
// further runs on other days ({ days, times }), as the nightly's Saturday.
function runsOn(job, day, date) {
  const more = (job.extra || []).filter((x) => x.days.includes(day)).flatMap((x) => x.times.map(hm));
  if (!job.days.includes(day)) return more.sort((a, b) => a - b);
  let base;
  if (job.cron) base = [cronEastern(job.cron, date)];
  else if (job.repeat) {
    base = [];
    for (let t = hm(job.repeat.start); t <= hm(job.repeat.last); t += job.repeat.every) base.push(t);
  } else base = (job.times || []).map(hm);
  // Extra runs join the base ones, a repeating job's included (intraday's 09:32).
  return [...new Set(base.concat(more))].sort((a, b) => a - b);
}

// How a job's schedule reads in words.
function whenText(job, date) {
  const days = job.days.length === 7 ? 'every day' : job.days.join(' ') === WEEKDAYS.join(' ') ? 'weekdays' : job.days.join(', ');
  if (job.cron) return fmt(cronEastern(job.cron, date)) + ' ' + days + ' (Vercel cron ' + job.cron + ' UTC)';
  const extra = (job.extra || []).map((x) => '; ' + x.times.join(', ') + ' ' + (x.days.join(' ') === WEEKDAYS.join(' ') ? 'weekdays' : x.days.join(', '))).join('');
  if (job.repeat) return 'every ' + job.repeat.every + ' min, ' + job.repeat.start + ' to ' + job.repeat.last + ', ' + days + extra;
  return job.times.join(', ') + ', ' + days + extra;
}

// ---- THE LIVE TASK LIST, as schedule-report.js sends it ---------------------
// Task Scheduler's DaysOfWeek is a bit mask, Sunday = 1.
function maskDays(mask) {
  const n = Number(mask) || 0;
  return ALL_DAYS.filter((_, i) => n & (1 << i));
}
// One registered task's start minutes and days, from its triggers.
function liveRuns(task) {
  const runs = [];   // { day, minute }
  for (const t of task.triggers || []) {
    const m = /T(\d\d):(\d\d)/.exec(String(t.start || ''));
    if (!m) continue;
    const start = Number(m[1]) * 60 + Number(m[2]);
    const days = t.kind === 'Daily' ? ALL_DAYS : t.kind === 'Weekly' ? maskDays(t.days) : [];
    const every = isoMinutes(t.interval), span = isoMinutes(t.duration);
    const starts = [start];
    if (every > 0 && span > 0) for (let x = start + every; x <= start + span; x += every) starts.push(x);
    for (const d of days) for (const s of starts) runs.push({ day: d, minute: s });
  }
  return runs;
}
// "PT30M", "PT6H", "P1D" to minutes.
function isoMinutes(s) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(String(s || ''));
  if (!m) return 0;
  return (Number(m[1]) || 0) * 1440 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}
const key = (r) => r.day + ' ' + fmt(r.minute);

// The declared schedule beside the laptop's: per job, 'ok', 'differs' (with
// the runs only one side has), 'missing' (no such task registered) or
// 'disabled'; plus any TickrLab task this file does not know.
function drift(report) {
  const tasks = (report && report.tasks) || [];
  const byName = new Map(tasks.map((t) => [t.name, t]));
  const out = { jobs: {}, unknown: [] };
  for (const job of JOBS) {
    if (!job.task) { out.jobs[job.id] = { status: 'remote' }; continue; }
    const t = byName.get(job.task);
    if (!t) { out.jobs[job.id] = { status: 'missing' }; continue; }
    const want = new Set(), have = new Set();
    for (const d of ALL_DAYS) for (const m of runsOn(job, d)) want.add(key({ day: d, minute: m }));
    for (const r of liveRuns(t)) have.add(key(r));
    const onlyDeclared = [...want].filter((k) => !have.has(k)), onlyLive = [...have].filter((k) => !want.has(k));
    const disabled = String(t.state || '') === 'Disabled';
    out.jobs[job.id] = {
      status: disabled ? 'disabled' : onlyDeclared.length || onlyLive.length ? 'differs' : 'ok',
      onlyDeclared: summarise(onlyDeclared), onlyLive: summarise(onlyLive),
    };
  }
  const known = new Set(JOBS.map((j) => j.task).filter(Boolean));
  for (const t of tasks) if (!known.has(t.name)) out.unknown.push({ name: t.name, runs: summarise(liveRuns(t).map(key)) });
  return out;
}
// "Mon 04:00" x5 weekdays into "Mon-Fri 04:00", so a difference reads in a line.
function summarise(keys) {
  const byTime = {};
  for (const k of keys) { const [d, t] = k.split(' '); (byTime[t] ||= new Set()).add(d); }
  return Object.keys(byTime).sort().map((t) => {
    const ds = ALL_DAYS.filter((d) => byTime[t].has(d));
    const label = ds.length === 7 ? 'daily' : ds.join(' ') === WEEKDAYS.join(' ') ? 'weekdays' : ds.join(',');
    return label + ' ' + t;
  });
}

module.exports = { JOBS, RESERVED, SLOT, WEEKDAYS, ALL_DAYS, hm, fmt, eastern, busyAt, cronEastern, runsOn, whenText, maskDays, liveRuns, isoMinutes, drift, summarise };
