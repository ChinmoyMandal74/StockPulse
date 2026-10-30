// THE DAILY JOBS EMAIL (2026-10-30, the owner: "Can I get one daily email on
// all scheduled task runs ... ideally it should come end of day .. may be 8pm
// ... it should be a high level summary").
//
// One line per job in schedule.js: how many of today's scheduled starts ran,
// what they did in a phrase (credits, releases read, headlines added,
// articles scored, dollars), and anything that needs a look: a start with no
// run, a run that failed or stopped, a laptop task in a bad state. Built from
// the records each job already writes (refresh_runs, news_runs,
// news_tone_runs, earnings_release_runs, schedule_reports, mail_log); nothing
// new is stored but the day's mark.
//
// A RUN IS MATCHED TO A SLOT by its start: the latest scheduled start at or
// before it (three minutes' grace for a clock running early), if it began
// within the job's window. A headline slot is many batches, all within that
// window, so they count as one run. A start not yet ten minutes old is not
// due. Runs nobody scheduled (a button on /refreshes) are left out.
//
// Pure: no I/O. Called by POST /api/cron/jobs-digest; tested by
// jobsdigest-test.js.
'use strict';
const S = require('./schedule.js');
const NightlySteps = require('./nightlysteps.js');

const etDay = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t));
const etMin = (t) => S.eastern(new Date(t)).minute;
const n0 = (v) => (Number.isFinite(Number(v)) && v != null ? Number(v) : 0);
const RUNNING_MS = 3 * 3600e3;   // a run silent longer than this did not finish

// Task Scheduler's "last result" codes that are not a failure: success, still
// running, never run yet, and "queued" (0x41301, 0x41303, 0x41325).
const TASK_OK = new Set([0, 267009, 267011, 267045]);

// Each job's own records in one shape: { at, state: 'ok' | 'running' |
// 'problem', why, credits, spent, count, left }.
const ADAPT = {
  nightly: (src, now) => refreshRecs(src.refresh, 'nightly', now),
  intraday: (src, now) => refreshRecs(src.refresh, 'intraday', now),
  news: (src) => (src.news || []).filter((r) => r.trigger === 'scheduled' && !r.refreshRunId).map((r) => ({
    at: r.startedAt, count: n0(r.added),
    state: r.status === 'running' ? 'running' : r.status === 'complete' || r.status === 'partial' ? 'ok' : 'problem',
    why: r.status === 'complete' || r.status === 'partial' ? null : (r.status || 'unknown') + (r.error ? ': ' + r.error : ''),
  })),
  tone: (src, now) => (src.tone || []).map((r) => ({
    at: r.startedAt, count: n0(r.scored), spent: n0(r.spent), left: r.endedAt ? n0(r.left) : 0,
    ...endState(r, now),
  })),
  releases: (src, now) => (src.releases || []).map((r) => ({
    at: r.startedAt, count: n0(r.results), spent: n0(r.spent),
    ...endState(r, now),
  })),
};
function refreshRecs(runs, kind, now) {
  return (runs || []).filter((r) => r.kind === kind && r.trigger === 'scheduled').map((r) => ({
    at: r.startedAt, credits: n0(r.credits), steps: r.steps || null, endedAt: r.endedAt || null,
    state: r.status === 'complete' ? 'ok' : r.status === 'running' && now - (r.updatedAt || r.startedAt) < RUNNING_MS ? 'running' : 'problem',
    why: r.status === 'complete' ? null : (r.status || 'unknown') + (r.error ? ': ' + String(r.error).slice(0, 140) : ''),
  }));
}
// The two laptop loaders record an error, or no end while still going.
function endState(r, now) {
  if (r.error) return { state: 'problem', why: String(r.error).slice(0, 140) };
  if (!r.endedAt) return now - r.startedAt < RUNNING_MS ? { state: 'running' } : { state: 'problem', why: 'did not finish' };
  return { state: 'ok' };
}

// One nightly run's steps: each named for the email, a problem step joining
// the run's problems. A finished refresh whose steps are not on file yet is
// still on its later steps for two hours; after that they were never saved.
const STEPS_LATE_MS = 2 * 3600e3;
function nightlySteps(slot, r, now, problems) {
  if (!Array.isArray(r.steps)) {
    const waiting = r.state === 'running' || (r.endedAt && now - r.endedAt < STEPS_LATE_MS) || (!r.endedAt && r.state !== 'problem');
    if (!waiting) problems.push(slot + ' the step results were not saved');
    return { slot, steps: null, pending: !!waiting };
  }
  const steps = r.steps.map((x) => ({ name: NightlySteps.NAMES[x.name] || x.name, state: x.state === 'ok' ? 'ok' : 'problem', note: x.note || '' }));
  for (const x of steps) if (x.state !== 'ok') problems.push(slot + ' ' + x.name + ': ' + x.note.slice(0, 140));
  return { slot, steps, pending: false };
}
function stepsPhrase(stepRuns) {
  const done = stepRuns.filter((x) => x.steps);
  if (!done.length) return stepRuns.some((x) => x.pending) ? 'steps still running' : '';
  const all = done.reduce((k, x) => k + x.steps.length, 0);
  const ok = done.reduce((k, x) => k + x.steps.filter((y) => y.state === 'ok').length, 0);
  return ok + ' of ' + all + ' steps OK';
}

const money = (v) => '$' + (v < 10 ? v.toFixed(2) : Math.round(v).toLocaleString('en-US'));
const plural = (k, one, many) => k.toLocaleString('en-US') + ' ' + (k === 1 ? one : many || one + 's');

// What one job did, in a phrase after "N of M ran".
const PHRASE = {
  nightly: (t) => plural(t.credits, 'Twelve Data credit'),
  intraday: (t) => plural(t.credits, 'Twelve Data credit'),
  news: (t) => plural(t.count, 'headline') + ' added',
  tone: (t) => plural(t.count, 'article') + ' scored, ' + money(t.spent) + (t.left ? '; ' + plural(t.left, 'article') + ' left for the next run' : ''),
  releases: (t) => plural(t.count, 'results release') + ' read, ' + money(t.spent),
};

// src: { refresh, news, tone, releases, report, mail }, each today's (or a
// wider window: anything outside today's Eastern day is ignored).
function build(src, nowMs) {
  const now = nowMs || Date.now();
  const today = etDay(now);
  const { day, minute } = S.eastern(new Date(now));
  const jobs = [], issues = [];
  let credits = 0, spent = 0, runs = 0, due = 0;
  for (const job of S.JOBS) {
    const fmtT = (m) => S.fmt(m);
    if (ADAPT[job.id]) {
      const slots = S.runsOn(job, day, new Date(now)).filter((m) => m <= minute - 10);
      const window = Math.max(30, job.limit || job.minutes * 3 || 60);
      const recs = ADAPT[job.id](src, now).filter((r) => r.at && etDay(r.at) === today);
      const bySlot = new Map(slots.map((m) => [m, []]));
      for (const r of recs) {
        const m = etMin(r.at);
        const s = slots.filter((x) => x <= m + 3).pop();
        if (s != null && m - s <= window) bySlot.get(s).push(r);
      }
      const t = { credits: 0, spent: 0, count: 0, left: 0 };
      const missed = [], problems = [], stepRuns = [];
      let ran = 0, running = 0, lastAt = 0;
      for (const [s, rs] of bySlot) {
        if (!rs.length) { missed.push(fmtT(s)); continue; }
        ran++;
        for (const r of rs) {
          t.credits += n0(r.credits); t.spent += n0(r.spent); t.count += n0(r.count);
          if (r.at > lastAt) { lastAt = r.at; t.left = n0(r.left); }
          if (r.state === 'running') running++;
          if (r.state === 'problem') problems.push(fmtT(s) + ' ' + (r.why || 'failed'));
          if (job.id === 'nightly') stepRuns.push(nightlySteps(fmtT(s), r, now, problems));
        }
      }
      credits += t.credits; spent += t.spent; runs += ran; due += slots.length;
      const status = missed.length || problems.length ? 'issue' : running ? 'running' : 'ok';
      const runsText = slots.length ? ran + ' of ' + slots.length + ' ran' : 'none due today';
      const stepText = stepsPhrase(stepRuns);
      const what = slots.length && ran ? PHRASE[job.id](t) + (stepText ? '; ' + stepText : '') : '';
      jobs.push({ id: job.id, name: job.name, host: job.host, due: slots.length, ran, running, missed, problems, status,
        runs: runsText, what, totals: t, ...(job.id === 'nightly' ? { steps: stepRuns } : {}) });
      for (const m of missed) issues.push(job.name + ': the ' + m + ' run did not start');
      for (const p of problems) issues.push(job.name + ': ' + p);
    }
  }
  // The laptop: its hourly report, and what Task Scheduler says of each task.
  const rep = src.report;
  const laptop = { at: rep ? rep.at : null, problems: [] };
  if (!rep || now - rep.at > 3 * 3600e3) laptop.problems.push(rep ? 'the laptop has not reported since ' + fmtClock(rep.at) : 'the laptop has never reported');
  if (rep) {
    const d = S.drift(rep);
    for (const job of S.JOBS) {
      const st = (d.jobs[job.id] || {}).status;
      if (st === 'doubled') laptop.problems.push(job.name + ' is still enabled on the laptop as well as on Fly.io, so it runs twice');
      else if (st === 'missing') laptop.problems.push(job.name + ': no task on the laptop');
      else if (st === 'disabled') laptop.problems.push(job.name + ': its laptop task is disabled');
      else if (st === 'differs') laptop.problems.push(job.name + ': the laptop task’s times differ from the schedule');
    }
    for (const tk of rep.tasks || []) {
      if (String(tk.state || '') === 'Disabled' || tk.lastResult == null || TASK_OK.has(Number(tk.lastResult))) continue;
      laptop.problems.push(tk.name + ': last result 0x' + Number(tk.lastResult).toString(16));
    }
  }
  for (const p of laptop.problems) issues.push('Laptop: ' + p);
  // The day's mail: how much went out, any refused, and the watchdog's alerts
  // (it records no run; it mails only when something is wrong).
  const mail = (src.mail || []).filter((m) => etDay(m.at) === today && m.kind !== 'jobs-digest');
  const ALERTS = ['watchdog', 'quota-alert', 'ig-token'];
  const alerts = mail.filter((m) => ALERTS.includes(m.kind));
  for (const a of alerts) issues.push('Alert mailed: ' + a.subject.replace(/^\[Tickr Lab\]\s*/, ''));
  const failedMail = mail.filter((m) => !m.ok);
  if (failedMail.length) issues.push(plural(failedMail.length, 'email') + ' refused by the mail provider (' + [...new Set(failedMail.map((m) => m.kind))].join(', ') + ')');
  const byKind = {};
  for (const m of mail) byKind[m.kind] = (byKind[m.kind] || 0) + 1;
  return {
    day: today, weekday: day, at: now, jobs, laptop, issues, runs, due, credits, spent,
    mail: { sent: mail.length, failed: failedMail.length, byKind, alerts: alerts.length },
  };
}
function fmtClock(t) {
  return new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

module.exports = { build, etDay, TASK_OK, money, plural };
