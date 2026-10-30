// The daily jobs email's arithmetic (jobsdigest.js): runs matched to their
// slots, missed and failed runs named, headline batches counted as one run,
// runs nobody scheduled left out, starts not yet due, yesterday ignored, the
// laptop's report and the day's mail. Pure; no server, no database.
'use strict';
const J = require('./jobsdigest.js');
const S = require('./schedule.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m, x === undefined ? '' : JSON.stringify(x).slice(0, 400)); } };

// Thursday 2026-10-29, 20:00 Eastern (EDT, UTC-4).
const NOW = Date.parse('2026-10-29T20:00:00-04:00');
const at = (hm, day = '2026-10-29') => Date.parse(day + 'T' + hm + ':00-04:00');
const STEP_KEYS = ['sec daily', 'calendar', 'refresh', 'sec', 'short', 'holdings', 'insider', 'splits', 'options', 'months', 'figures', 'index P/E', 'news archive'];
const okSteps = () => STEP_KEYS.map((name) => ({ name, state: 'ok', note: 'up to date' }));
const refresh = (kind, hm, extra) => Object.assign({ kind, trigger: 'scheduled', status: 'complete', startedAt: at(hm), updatedAt: at(hm) + 60000, endedAt: at(hm) + 60000, credits: kind === 'nightly' ? 20000 : 1286 }, kind === 'nightly' ? { steps: okSteps() } : {}, extra);
const intradayTimes = S.runsOn(S.JOBS.find((j) => j.id === 'intraday'), 'Thu').map(S.fmt);
const toneTimes = S.runsOn(S.JOBS.find((j) => j.id === 'tone'), 'Thu').map(S.fmt);
const tone = (hm, extra) => Object.assign({ startedAt: at(hm), endedAt: at(hm) + 1500000, scored: 300, spent: 0.1, left: 0, stop: 'done', error: null }, extra);
const rel = (hm, extra) => Object.assign({ startedAt: at(hm), endedAt: at(hm) + 600000, results: 50, spent: 0.3, error: null }, extra);
const newsBatches = (hm, k) => Array.from({ length: k }, (_, i) => ({ trigger: 'scheduled', refreshRunId: null, status: 'complete', startedAt: at(hm) + i * 15000, added: 100 }));
const TASKS = [
  { name: 'TickrLab earnings releases', state: 'Ready', lastResult: 0, triggers: [] },
  { name: 'TickrLab news tone', state: 'Ready', lastResult: 0, triggers: [] },
  { name: 'TickrLab schedule report', state: 'Running', lastResult: 267009, triggers: [] },
  { name: 'TickrLab nightly', state: 'Disabled', lastResult: 0, triggers: [] },
];
function clean() {
  return {
    refresh: [refresh('nightly', '04:00'), refresh('nightly', '16:00')].concat(intradayTimes.map((t) => refresh('intraday', t))),
    news: ['05:00', '09:00', '13:00', '17:00'].flatMap((t) => newsBatches(t, 3)),
    tone: toneTimes.map((t) => tone(t)),
    releases: [rel('09:15'), rel('18:15')],
    report: { at: NOW - 55 * 60000, tasks: TASKS },
    mail: [{ at: at('09:20'), kind: 'release-digest', ok: true, subject: 'x' }],
  };
}
const job = (d, id) => d.jobs.find((j) => j.id === id);
// The real task triggers are not in the fixture, so drift says the laptop
// jobs' times differ; strip those lines to test everything else.
const realIssues = (d) => d.issues.filter((x) => !/times differ/.test(x));

// 1. A clean day.
let d = J.build(clean(), NOW);
ok(job(d, 'nightly').runs === '2 of 2 ran' && job(d, 'intraday').runs === '14 of 14 ran', 'nightly 2 of 2, intraday 14 of 14', d.jobs.map((j) => j.runs));
ok(job(d, 'news').runs === '4 of 4 ran' && job(d, 'news').totals.count === 1200, 'headline batches count as one run each, their headlines summed', job(d, 'news'));
ok(job(d, 'tone').runs === toneTimes.length + ' of ' + toneTimes.length + ' ran', 'tone: every hourly run', job(d, 'tone').runs);
ok(job(d, 'releases').what === '100 results releases read, $0.60', 'releases: what they read and spent', job(d, 'releases').what);
ok(job(d, 'nightly').what === '40,000 Twelve Data credits; 26 of 26 steps OK', 'nightly: the credits and the steps', job(d, 'nightly').what);
ok(job(d, 'nightly').steps.length === 2 && job(d, 'nightly').steps[1].slot === '16:00' && job(d, 'nightly').steps[0].steps[3].name === 'SEC filings rotation', 'every step of each run, named for the email', job(d, 'nightly').steps);
ok(realIssues(d).length === 0 && d.jobs.every((j) => j.status === 'ok'), 'a clean day: nothing to look at', d.issues);
ok(d.mail.sent === 1 && d.mail.failed === 0, 'the day’s mail counted', d.mail);
ok(!d.jobs.some((j) => j.id === 'digest' || j.id === 'schedule' || j.id === 'watchdog'), 'only jobs with run records get a row');

// 2. A missed slot.
let src = clean(); src.refresh = src.refresh.filter((r) => !(r.kind === 'intraday' && r.startedAt === at('11:15')));
d = J.build(src, NOW);
ok(job(d, 'intraday').runs === '13 of 14 ran' && job(d, 'intraday').missed[0] === '11:15' && job(d, 'intraday').status === 'issue', 'a start with no run is named', job(d, 'intraday'));
ok(realIssues(d).includes('Intraday prices: the 11:15 run did not start'), 'and listed to look at', d.issues);

// 3. A failed run, and a laptop loader's error.
src = clean(); src.refresh[1] = refresh('nightly', '16:00', { status: 'failed', error: 'Twelve Data 429' });
src.releases[1] = rel('18:15', { error: 'Anthropic answered 400' });
d = J.build(src, NOW);
ok(realIssues(d).some((x) => /Nightly refresh: 16:00 failed: Twelve Data 429/.test(x)), 'a failed nightly, with its error', d.issues);
ok(realIssues(d).some((x) => /Earnings releases: 18:15 Anthropic answered 400/.test(x)), 'a loader’s error', d.issues);

// 4. Still running is not a problem; silent for hours is.
src = clean(); src.tone[src.tone.length - 1] = tone('18:26', { endedAt: null });
d = J.build(src, NOW);
ok(job(d, 'tone').status === 'running' && realIssues(d).length === 0, 'a run still going says Running', job(d, 'tone'));
src = clean(); src.tone[0] = tone('00:30', { endedAt: null });
d = J.build(src, NOW);
ok(realIssues(d).some((x) => /Article tone: 00:30 did not finish/.test(x)), 'a run with no end after three hours did not finish', d.issues);

// 5. A start under ten minutes old is not due; yesterday's runs are ignored.
src = clean(); src.tone = src.tone.filter((r) => r.startedAt !== at('18:26')); src.mail = [];
d = J.build(src, at('18:30'));
ok(job(d, 'tone').missed.length === 0 && !job(d, 'tone').missed.includes('18:26'), 'the 18:26 run is not due at 18:30', job(d, 'tone'));
src = clean(); src.refresh.push(refresh('nightly', '16:00', { startedAt: at('16:00', '2026-10-28'), status: 'failed' }));
d = J.build(src, NOW);
ok(realIssues(d).length === 0 && job(d, 'nightly').runs === '2 of 2 ran', 'yesterday’s failed nightly is not today’s', d.issues);

// 6. Runs nobody scheduled are left out.
src = clean(); src.refresh.push(refresh('nightly', '16:30', { trigger: 'manual', status: 'failed' }));
src.news.push({ trigger: 'page', status: 'failed', startedAt: at('09:10'), added: 5 });
d = J.build(src, NOW);
ok(realIssues(d).length === 0 && job(d, 'nightly').totals.credits === 40000, 'a manual refresh and a page fetch are not counted', d.issues);

// 6b. A scheduled run far from any start is not matched to one; a refresh
// silent for hours while marked running is a problem.
src = clean(); src.refresh.push(refresh('nightly', '10:00', { status: 'failed' }));
d = J.build(src, NOW);
ok(realIssues(d).length === 0, 'a run six hours after the nightly’s start is not that start’s', d.issues);
src = clean(); src.refresh[1] = refresh('nightly', '16:00', { status: 'running', updatedAt: at('16:05') });
d = J.build(src, NOW);
ok(realIssues(d).some((x) => /Nightly refresh: 16:00 running/.test(x)), 'a refresh still marked running but silent since 16:05 is a problem', d.issues);

// 7. The tone run that ran out of time says what is left.
src = clean(); src.tone[src.tone.length - 1] = tone('18:26', { stop: 'time', left: 83 });
d = J.build(src, NOW);
ok(/83 articles left for the next run$/.test(job(d, 'tone').what), 'what the last tone run left', job(d, 'tone').what);

// 8. The laptop: stale report, a task failing, a fly job still enabled.
src = clean(); src.report = { at: NOW - 5 * 3600e3, tasks: TASKS };
d = J.build(src, NOW);
ok(d.issues.some((x) => /has not reported since/.test(x)), 'a laptop silent for five hours', d.issues);
src = clean(); src.report = { at: NOW - 600000, tasks: TASKS.map((t) => (t.name === 'TickrLab earnings releases' ? Object.assign({}, t, { lastResult: 1 }) : t)) };
d = J.build(src, NOW);
ok(d.issues.some((x) => /TickrLab earnings releases: last result 0x1/.test(x)), 'a laptop task whose last result is an error', d.issues);
ok(!d.issues.some((x) => /schedule report: last result/.test(x)), 'a task still running (0x41301) is fine', d.issues);
src = clean(); src.report = { at: NOW - 600000, tasks: TASKS.map((t) => (t.name === 'TickrLab nightly' ? Object.assign({}, t, { state: 'Ready' }) : t)) };
d = J.build(src, NOW);
ok(d.issues.some((x) => /Nightly refresh is still enabled on the laptop/.test(x)), 'a fly job still enabled on the laptop runs twice', d.issues);
ok(!d.issues.some((x) => /Daily jobs email/.test(x)), 'the email’s own job (fly, no task) is not a laptop problem', d.issues);

// 9. Mail: a refusal and a watchdog alert.
src = clean(); src.mail.push({ at: at('19:31'), kind: 'watchdog', ok: true, subject: '[Tickr Lab] Nightly refresh failed — 2026-10-29' }, { at: at('09:21'), kind: 'release-list', ok: false, subject: 'y' });
d = J.build(src, NOW);
ok(d.issues.includes('Alert mailed: Nightly refresh failed — 2026-10-29'), 'a watchdog alert is listed', d.issues);
ok(d.issues.some((x) => /1 email refused by the mail provider \(release-list\)/.test(x)), 'a refused email is listed', d.issues);

// 10. A Saturday: one nightly, one releases run, no intraday.
const SAT = Date.parse('2026-10-31T20:00:00-04:00');
d = J.build({ refresh: [refresh('nightly', '04:00', { startedAt: Date.parse('2026-10-31T04:00:00-04:00') })], news: [], tone: [], releases: [], report: { at: SAT - 600000, tasks: TASKS }, mail: [] }, SAT);
ok(job(d, 'nightly').runs === '1 of 1 ran' && job(d, 'intraday').runs === 'none due today' && job(d, 'releases').runs === '0 of 1 ran', 'Saturday’s schedule', d.jobs.map((j) => j.id + ' ' + j.runs));

// 11. The digest job itself, and drift for a fly job with no task.
const dj = S.JOBS.find((j) => j.id === 'digest');
ok(dj && dj.host === 'fly' && S.runsOn(dj, 'Sun').map(S.fmt).join() === '20:00' && S.runsOn(dj, 'Wed').map(S.fmt).join() === '20:00', 'the email: 20:00 every day on Fly.io');
ok(S.drift({ at: 1, tasks: [] }).jobs.digest.status === 'fly', 'drift: a fly job with no laptop task is on Fly.io, not Vercel');

const NS = require('./nightlysteps.js');
const st = (name, lines) => NS.stepFrom(name, lines, 0, 5000);
ok(st('sec', ['sec        up to date -- 3 refetched in 1 batch(es)']).state === 'ok' && st('sec', ['sec        up to date -- 3 refetched in 1 batch(es)']).note === 'up to date -- 3 refetched in 1 batch(es)', 'a step that went through is OK, its line without the label');
ok(st('sec', ['sec        40 refetched in 30 batch(es) (cap) -- more next run']).state === 'ok', 'a step that hit its cap is still OK');
ok(st('short', ['short      2026-10-15 is dated but not published yet -- holding 2026-09-30']).state === 'ok', 'short interest not yet published is OK');
for (const line of ['options    stopped after 3 batch(es) -- timed out', 'holdings   REFUSED the file -- too few rows', 'short      FINRA unreachable (x) -- holding y', 'months     HTTP 500', 'figures    not built -- no rows', 'splits     3 fetched, 1 failed (ABC), 0 still due', 'calendar   not read -- no key', 'insider    stopped -- the SEC is rate-limiting; resumes next run', 'news archi skipped -- boom'])
  ok(st('x', [line]).state === 'problem', 'a problem: ' + line.slice(11, 50));
ok(st('months', []).state === 'problem' && st('months', []).note === 'said nothing', 'a step that said nothing is a problem');
ok(st('holdings', ['holdings   SPY as of 2026-10-29 -- 503 holdings', 'holdings   qqq skipped -- timed out']).state === 'problem', 'one bad line of two makes the step a problem');
src = clean(); src.refresh[1] = refresh('nightly', '16:00', { steps: okSteps().map((x) => x.name === 'options' ? { name: 'options', state: 'problem', note: 'stopped after 3 batch(es) -- timed out' } : x) });
d = J.build(src, NOW);
ok(job(d, 'nightly').status === 'issue' && realIssues(d).includes('Nightly refresh: 16:00 Options open interest: stopped after 3 batch(es) -- timed out'), 'a problem step is named to look at', d.issues);
ok(/25 of 26 steps OK/.test(job(d, 'nightly').what), 'and counted', job(d, 'nightly').what);
src = clean(); delete src.refresh[1].steps; src.refresh[1].endedAt = NOW - 30 * 60000;
d = J.build(src, NOW);
ok(job(d, 'nightly').status === 'ok' && job(d, 'nightly').steps[1].pending && /13 of 13 steps OK/.test(job(d, 'nightly').what), 'a refresh finished half an hour ago is still on its later steps', job(d, 'nightly'));
src = clean(); delete src.refresh[0].steps;
d = J.build(src, NOW);
ok(realIssues(d).includes('Nightly refresh: 04:00 the step results were not saved') && !job(d, 'nightly').steps[0].pending, 'steps missing long after the refresh are named', d.issues);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
