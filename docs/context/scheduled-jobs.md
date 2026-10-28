## Scheduled jobs: `/schedule` (2026-10-22)
The owner: "Can you create a new page showing all scheduled jobs and the timings of them and keep it updated at all times so that we can easily decide on making adjustments."

**Two sources, set side by side.**
- **The declared schedule: `schedule.js`.** Every job: its Task Scheduler name, task script, Eastern times or repetition, days, usual length, what it spends (Twelve Data credits, Anthropic dollars, or free) and what it does. It also holds the Twelve Data windows (`RESERVED`, `SLOT`) and `busyAt`; the recon's behind refresh (`creditWindowBusy` in server.js) calls it, so there is one definition.
- **The live schedule: what Task Scheduler on the laptop holds.** `schedule-report.js` reads `Get-ScheduledTask 'TickrLab*'` (triggers, state, last run, result, next run, missed runs) and posts it to `POST /api/schedule/report` with `CRON_SECRET`. It runs:
  - hourly at five past, from its own task (`schedule-report-task.ps1`, "TickrLab schedule report");
  - and at the end of every `*-task.ps1`, straight after it registers, so a change shows within a minute.
- **The reports are kept** in `schedule_reports` (one row an hour and one per registration, never pruned), so a change to the schedule has a date. The page reads the newest.

**`drift(report)`** compares the two, run by run (day and minute):
- `ok`, `differs` (with the runs only one side has, summarised as "weekdays 09:30"), `missing`, `disabled`;
- `remote` for the Vercel cron;
- plus any `TickrLab *` task nobody declared.

**The page (admin):**
- **Status:** how old the laptop's list is (amber past two hours: asleep or off), the number of differences, and whether this minute is inside a Twelve Data window.
- **A day on a timeline:** one lane a job, Eastern, 24 hours. Bars start at each run and are as long as a usual run. Colours: accent for Twelve Data, orange for Anthropic, grey for free. Runs only on the laptop are dashed amber. The Twelve Data windows are hatched on the Twelve Data lanes, and there is a now line. A chip picks the day; on a phone the timeline scrolls and the job names stay put.
- **A table:** when, what it does, spends, usual length, last run and its result (Task Scheduler's codes in words: 267011 never run, 267009 running), next run, the Laptop column, and a link to the job's log.
- It reloads every five minutes.

**Rules:**
- **Changing a job's time** means editing its `*-task.ps1` and `schedule.js` together, then running the script on the laptop. `schedule-test.js` fails when the two disagree: it parses each script's times, repetition and days, and checks that every task script is declared and sends a report.
- **A new scheduled job** gets a `schedule.js` entry and the report line at the end of its task script. Until then it is listed on the page as "on the laptop but not declared".
- Times are Eastern: the laptop is on Eastern, and Vercel's UTC cron is converted for the date (the watchdog is 19:30 in summer, 18:30 in winter).

**Tests:**
- `schedule-test.js`: 65 checks. They cover the scripts against the declared schedule, the window clock on both sides of each edge (and in winter time), runs and words, and drift cases built on the real report shapes: moved time, dropped day, shorter repetition, missing, disabled, undeclared.
- Proved by reverting: a moved time, a script without the report line, and a shifted window edge each fail.
- End to end: 21 checks on an in-memory database with this laptop's real task list, one task moved. They cover the secret refused and accepted, anonymous and guest refused, and the drift. In the browser at 1440px and 400px: bars at 04:00 and 16:00 measured from their drawn position, the dashed laptop-only runs, hatching on the Twelve Data lanes only, the status, the Laptop column, no sideways scroll, no page errors.

### No windows (2026-10-23)
The owner, on a blank console window: "sometimes it is hard to know what is running". Chose no windows at all. Each `*-task.ps1` now writes its command to `<name>.run.cmd` beside it (holds the machine's node path; `*.run.cmd` is in `.gitignore`) and registers `wscript.exe run-hidden.vbs <name>.run.cmd`. Windows Script Host has no console; the launcher starts the command hidden, waits, and returns its exit code, so Task Scheduler (and `/schedule`) still see a failure as one. Tried first: `conhost.exe --headless` hides the window but returns 0 whatever the task exited with; a background-session (S4U) task keeps codes but registering one needs administrator rights. What ran and how it ended is on `/schedule` and in each task's log. Checked: a test command exiting 3 comes back as 3; the schedule report run through Task Scheduler hidden returned 0 and wrote its log line.

## The nightly on Saturday 04:00 (2026-10-24)
The owner, after /filings showed Thursday as the newest day on a Saturday: "can you also add 4AM nightly job on saturday too just to avoid these in future". The SEC daily index read is a nightly phase, and the nightly ran weekdays only, so Friday's 8-Ks and 13D/13G filings waited for Monday 04:00 (and so did the earnings reader, which finds results 8-Ks through them). `nightly-task.ps1` adds a third trigger, Saturday 04:00 (11 firings a week); the run also heals Friday's provisional 16:00 close and turns the profile rotation once more (about 14,000 Twelve Data credits). `schedule.js` declares it with a job's new `extra` list (`[{ days: ['Sat'], times: ['04:00'] }]`, read by `runsOn` and `whenText`) and reserves the Saturday 03:55-04:50 window in `RESERVED`. `schedule-test.js` 74 checks. Re-registered on the laptop the same day; the earnings reader still runs weekdays only, so Friday's results releases are read Monday 09:15 unless run by hand.

## Saturday 05:00 run (2026-10-25)

The owner: *"Yes but can we run the Saturday earlier .. may be 5am"*. The earnings reader also runs **Saturday 05:00**, after the Saturday 04:00 nightly (done by 04:50) has recorded Friday's 8-Ks; before, Friday's results waited for Monday 09:15. `release-task.ps1` adds the trigger, `schedule.js` declares it as `extra`, `schedule-test.js` checks both. **The subscriber mailing stays weekday mornings**: `mailList()` in `release-load.js` returns on a Saturday or Sunday, so Saturday's finds go out in Monday's mailing as before; the owner's digest is sent on Saturday. No Twelve Data credits; AI credit as any run, capped at $2.

- **2026-10-26: Article tone hourly on weekdays** at :26 past, 07:26 to 18:26 except 16:26, capped at 30 minutes; 00:30 nightly; weekends three times. See `news-tone.md`.

## Fly.io: the pings off the laptop (2026-10-28)
The owner asked how to move the jobs off the laptop, then signed up to Fly.io. **Step 1 moved the three ping jobs: nightly, intraday prices and headlines.** They are HTTP calls to the app, so where they run makes no difference to what they fetch.

**The machine:**
- App `tickrlab-jobs`, one machine, shared-cpu-1x with 256MB, region `ewr` (Secaucus). About $2 a month.
- `fly.toml` at the root, `fly/Dockerfile`, and `.dockerignore`, which lets in only `schedule.js`, the three ping scripts and `fly/cron.js`. `.env` is never uploaded.
- **Deploy by hand from the laptop: `fly deploy --ha=false -a tickrlab-jobs`.** Never connect GitHub: a push to main is Vercel's deploy, and a Fly restart kills a running job. `--ha=false` matters too, because a second machine would run every job twice.
- The secret is `CRON_SECRET`, set with `fly secrets import` from stdin. `fly/cron.js` writes it into `/app/.env` at start, because the pings read `.env`, never the environment. It does that only when `FLY_APP_NAME` is set, so running it on the laptop cannot overwrite the real `.env`. `APP_URL` is optional (the pings default to production).

**The scheduler, `fly/cron.js`:**
- **It is not a crontab.** Each Eastern minute it asks `schedule.js` (`eastern`, `runsOn`) which `host: 'fly'` jobs are due and runs their script, the same command the laptop task ran. The declared schedule is what runs, so Fly cannot drift from it.
- Task Scheduler's settings are kept. A job still running is not started again. A run is stopped at the job's `limit`: nightly 120 minutes, intraday 10, headlines 45, the tasks' `ExecutionTimeLimit`.
- A minute the machine was down for is not made up.
- Output goes to `fly logs -a tickrlab-jobs`. The runs themselves are on `/refreshes` and `/news-runs` as before.

**Changing a fly job's time:** edit `schedule.js` and redeploy Fly. Keep the laptop's task script in step (`schedule-test.js` still checks it), because it is the way back.

**The way back:** change the job's `host` to `'laptop'`, `Enable-ScheduledTask` its task, and redeploy Fly so it stops running it.

**Drift for fly jobs:**
- `fly` when the laptop task is absent or disabled.
- **`doubled`** ("Runs twice") when it is still enabled. The status line counts it as a difference.
- `drift(report, jobs)` takes the job list, so the tests also check every task script against the schedule as if all jobs were on the laptop.

**Staying on the laptop for now:**
- **Article tone.** `news-tone-task.ps1` notes that publishers refuse data-centre addresses, and the loader records a 401/403/451 as `unreadable` and never retries it. A trial run from Fly could therefore permanently mark articles that the laptop can read. Before tone moves, run a read-only probe from Fly that writes nothing.
- **Earnings releases.** SEC and Anthropic, a candidate for step 2.
- **The schedule report.** It reports the laptop's own tasks.

**Tests:** `schedule-test.js`, 85 checks, including the fly states, a fly job enabled on the laptop, a task removed, and every fly job having a limit. The `doubled` guard was proved by reverting it.
