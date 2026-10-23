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
