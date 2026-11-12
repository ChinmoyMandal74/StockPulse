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
// HOSTS: 'laptop' (Task Scheduler), 'vercel' (a Vercel cron) and, since
// 2026-10-28, 'fly': one machine on Fly.io whose scheduler (fly/cron.js) runs
// this file's times directly, so it cannot drift from it. A fly job keeps its
// task script as the way back to the laptop; drift says 'doubled' if that
// task is registered and enabled, because then every run happens twice.
// `limit` is the minutes after which a fly run is stopped (the tasks'
// ExecutionTimeLimit).
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
    id: 'nightly', name: 'Nightly refresh', task: 'TickrLab nightly', host: 'fly', script: 'nightly-ping.js', taskScript: 'nightly-task.ps1',
    days: WEEKDAYS, times: ['04:00', '16:00'], minutes: 55, limit: 120,
    // SATURDAY 04:00 TOO (2026-10-24, the owner): Friday's 8-Ks and 13D/13G
    // filings were read only on Monday, so /filings showed Thursday all weekend.
    extra: [{ days: ['Sat'], times: ['04:00'] }],
    spends: { kind: 'twelve', text: 'About 14,000 credits a run: ~171 profiles at 80, seven a minute, plus prices and up to five split calls; in an earnings season up to 100 more profiles of companies that just reported (about 8,000 credits)' },
    what: 'The SEC daily index first (yesterday\'s 8-Ks and 13D/13G), so the profile rotation can also pull the companies that just reported (reportdue.js); then the filings phases: SEC rotation, short interest, index holdings, insider filings, splits and options open interest.',
    log: '/refreshes',
  },
  {
    id: 'intraday', name: 'Intraday prices', task: 'TickrLab intraday prices', host: 'fly', script: 'intraday-ping.js', taskScript: 'intraday-task.ps1',
    days: WEEKDAYS, repeat: { start: '09:45', every: 30, last: '15:45' }, minutes: 3, limit: 10,
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
    what: 'Reads the press release of every results 8-K the nightly runs recorded (the morning run reads the previous business day; Saturday 05:00 reads Friday’s), checks older ones against their 10-Q, and rebuilds the screener group and the S&P 500 recon. When it read new results, emails the owner a digest of them; after a weekday morning run, sends the Earnings results mailing to its subscribers, then emails the owner Reporting today (the tracked companies the earnings calendar lists for the day).',
    log: '/news-runs',
  },
  {
    id: 'news', name: 'Headlines', task: 'TickrLab news', host: 'fly', script: 'news-ping.js', taskScript: 'news-task.ps1',
    days: ALL_DAYS, times: ['05:00', '09:00', '13:00', '17:00'], minutes: 6, limit: 45,
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
    // THE ARTICLE ARCHIVE'S WEEKLY EMAIL (2026-11-01, the owner: "create a
    // schedule task on Saturday morning 8AM to send details on New Article
    // Archive local copy"). On the laptop because the archive is.
    id: 'archive', name: 'Article archive report', task: 'TickrLab archive report', host: 'laptop', script: 'archive-report.js', taskScript: 'archive-report-task.ps1',
    days: ['Sat'], times: ['08:00'], minutes: 1,
    spends: { kind: 'free', text: 'Free' },
    what: 'Counts the local article text archive (news-archive.db, on the laptop only) and emails the owner the week: articles kept by day, companies and publishers, the readings the tone job scored beside them, and the file\'s size and growth.',
    log: '/schedule',
  },
  {
    // THE LOCAL RESEARCH COPY (2026-11-02, the owner, reading the jobs email:
    // "I don't see anything here on local DB update for earning and sec
    // filings"). Synced by hand until then. On the laptop because the file is.
    id: 'localcopy', name: 'Local research copy', task: 'TickrLab local copy', host: 'laptop', script: 'analysis-db.js', taskScript: 'localcopy-task.ps1',
    days: WEEKDAYS, times: ['18:50'], minutes: 3,
    extra: [{ days: ['Sat'], times: ['06:00'] }],
    spends: { kind: 'free', text: 'Free in credits and API money; reads Turso rows: about 35,000 on a weekday, about 385,000 on Saturday' },
    what: 'Copies the day\'s new rows into analysis.db on the laptop, the local copy every backtest and blog table reads: bars and fundamentals, and the filings tables (earnings_releases, sec_facts). Weekdays the filings tables\' recent rows only; Saturday both whole, catching what the window misses. Never writes to Turso.',
    log: '/schedule',
  },
  {
    // COMPANIES' OWN WEBSITES, NATIONWIDE (2026-11-10, the owner: "Lets do the
    // nationwide , 12GB is fine"). On the laptop because formd.db and
    // web-archive.db are. Carries on night after night until the list is done.
    id: 'websites', name: 'Company websites', task: 'TickrLab websites', host: 'laptop', script: 'website-load.js', taskScript: 'website-task.ps1',
    days: ALL_DAYS, times: ['23:00'], minutes: 465,
    spends: { kind: 'anthropic', text: 'Claude Haiku, about $0.0015 a confirmed site, capped at $5 a run (about $3 a night)' },
    what: 'Finds the own website of every employer with a retirement plan and 100 or more staff (about 117,000), twelve at a time, robots.txt obeyed; reads each confirmed site and keeps up to 20 useful pages of it in web-archive.db on the laptop, searchable. Runs 23:00 to about 06:45 (465 minutes) or until 12 GB and carries on the next night, then emails the owner the night\'s figures (crawl-report.js). Progress: the laptop\'s Crawl page, localhost:4100/crawl.',
    log: '/schedule',
  },
  {
    // THE DAYTIME RUN (2026-11-11, the owner: "Yes create a day crawl too"):
    // the same list and work on four workers, done by about 20:30 so it never
    // meets the night run's lock; the morning email counts both.
    id: 'websites-day', name: 'Company websites, day run', task: 'TickrLab websites day', host: 'laptop', script: 'website-load.js', taskScript: 'website-day-task.ps1',
    days: ALL_DAYS, times: ['09:00'], minutes: 690,
    spends: { kind: 'anthropic', text: 'Claude Haiku, about $0.003 a company, capped at $2 a run' },
    what: 'The daytime run of the website crawl: the same nationwide list as the night run, four at a time so the laptop stays usable, robots.txt obeyed, up to 20 useful pages a confirmed site kept in web-archive.db. Runs 09:00 to about 20:30 (690 minutes) and carries on where the last run stopped. No email of its own: the morning email after the night run counts the whole day.',
    log: '/schedule',
  },
  {
    // NEW STOCKS FINISHED BY THEMSELVES (2026-11-04, the owner: "This should
    // all be one one click of a button somehow"). On the laptop because the
    // local copy and the release text archive are.
    id: 'onboard', name: 'New stocks', task: 'TickrLab onboard', host: 'laptop', script: 'onboard.js', taskScript: 'onboard-task.ps1',
    days: ALL_DAYS, repeat: { start: '07:05', every: 30, last: '22:05' }, minutes: 1,
    spends: { kind: 'twelve', text: 'Nothing when no stock is waiting (one small read). A stock: about 101 Twelve Data credits (prices, splits, profile) and cents of Claude Haiku for its releases; it waits out the intraday slots and skips the nightly windows' },
    what: 'Finds stocks added on /themes and not yet loaded, and loads everything: full price history, record close, short interest, splits, profile and earnings history, SEC filings, 8-K events, 13D/13G holders, segments, drawdowns, options, earnings releases since 2017, the local copy, release text and Signal history, and the source rule (onboard.js).',
    log: '/onboarding',
  },
  {
    id: 'watchdog', name: 'Watchdog', task: null, host: 'vercel', cron: '30 23 * * *', minutes: 1,
    days: ALL_DAYS,
    spends: { kind: 'free', text: 'Free' },
    what: 'Runs on Vercel, not the laptop, so a laptop that slept is still noticed: mails the owner when the nightly did not run.',
    log: '/refreshes',
  },
  {
    // THE DAILY JOBS EMAIL (2026-10-30, the owner: "one daily email on all
    // scheduled task runs ... end of day .. may be 8pm"). On Fly.io rather
    // than a Vercel cron, whose Hobby timing is "somewhere in the hour".
    id: 'digest', name: 'Daily jobs email', task: null, host: 'fly', script: 'digest-ping.js',
    days: ALL_DAYS, times: ['20:00'], minutes: 1, limit: 5,
    spends: { kind: 'free', text: 'Free' },
    what: 'Emails the owner a one-screen summary of the day: for each job above, how many of its scheduled runs started and what they did, the laptop\'s tasks, the day\'s emails, and anything to look at (jobsdigest.js).',
    log: '/schedule',
  },
  {
    // THE EVENING NEWS BRIEFS (2026-11-12, the owner: two daily briefs of the
    // news, "around 5:40 pm everyday New York time"). Every day, weekends too:
    // the tone loader reads weekend articles, and Friday's brief looks to Monday.
    id: 'newsbrief', name: 'Evening news briefs', task: null, host: 'fly', script: 'news-brief-ping.js',
    days: ALL_DAYS, times: ['17:40'], minutes: 1, limit: 6,
    spends: { kind: 'anthropic', text: 'Two Claude Sonnet calls a day: the day re-read (about $0.29, 110,000 tokens) and the next session (about $0.04)' },
    what: 'Emails the owner two briefs, and publishes them on /briefs, from the stored article readings (newsbrief.js): today\'s news re-read by AI from every article about a company, each piece of news once, high then medium; and the next session: up to ten AI lines, each checked against what it cites, and who reports before the next open or reported after today\'s close.',
    log: '/schedule',
  },
  {
    // THE DAYTIME UPDATES OF /briefs (2026-11-12, the owner: "May be refresh
    // the news 3 or 4 times a day"): published only, no email. Three on
    // weekdays; at the weekend one, at 11:40 (then: "Include weekend too ..
    // but may be do 2 refresh instead of 4"), the evening run the second.
    // Keep in step with NewsBrief.UPDATES, which the page reads.
    id: 'newsbrief-update', name: 'News brief updates', task: null, host: 'fly', script: 'news-brief-update.js',
    days: WEEKDAYS, times: ['08:40', '11:40', '14:40'], minutes: 2, limit: 20,
    extra: [{ days: ['Sat', 'Sun'], times: ['11:40'] }],
    spends: { kind: 'anthropic', text: 'Two Claude Sonnet calls a run, about $0.33; three runs a weekday, one a weekend day (about $1 and $0.33)' },
    what: 'Publishes the news brief on /briefs through the day: the news since the last evening brief, re-read by AI, and the next session (at 08:40, the session about to open). No email; the page shows these and the evening edition only.',
    log: '/briefs',
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
// 'disabled'; plus any TickrLab task this file does not know. A fly job is
// 'fly' when the laptop's task is absent or disabled, and 'doubled' when it
// is still enabled there.
function drift(report, jobs = JOBS) {
  const tasks = (report && report.tasks) || [];
  const byName = new Map(tasks.map((t) => [t.name, t]));
  const out = { jobs: {}, unknown: [] };
  for (const job of jobs) {
    const t = job.task ? byName.get(job.task) : null;
    if (!job.task && job.host !== 'fly') { out.jobs[job.id] = { status: 'remote' }; continue; }
    if (job.host === 'fly') { out.jobs[job.id] = { status: t && String(t.state || '') !== 'Disabled' ? 'doubled' : 'fly' }; continue; }
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
  const known = new Set(jobs.map((j) => j.task).filter(Boolean));
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
