# Register (or remove) the Windows scheduled task that drives the nightly
# fundamentals rotation. Two firings a weekday, 04:00 and 16:00 ET.
#
# WHY TWO RATHER THAN ONE BIGGER RUN. A round is 7 profiles (80 credits each
# against a 610/minute ceiling), so refreshing N profiles takes N/7 minutes
# whatever anyone builds. Doubling the rotation by doubling the run length
# gives one ~2-hour job; splitting it gives two ~37-minute jobs that cover the
# same ground. The split wins on every axis that bites a laptop: a shorter
# window to sleep through, half the loss when one is missed, and a credit
# burst spread across the day.
#
# WHY WEEKDAYS. Fundamentals do not move at weekends -- no filings, no
# earnings -- so two runs x five days re-covers the universe about 1.4 times a
# week, which is already better than the 7-day rotation it replaces. The NEWS
# task is separate and deliberately runs all seven days.
#
# 04:00 AND 16:00 SINCE 2026-10-21 (the owner, who chose 16:00 over 16:30 with
# the trade-off below in front of him). Until then 07:30 and 19:30.
#
# THE 16:00 RUN STORES A PROVISIONAL CLOSE. It starts at the bell and prices
# first, so the day's last bar is not yet final; the next 04:00 run reads the
# settled close and heals it. On a FRIDAY there is no next run until Monday
# 04:00, so the weekend shows Friday's provisional close. (19:30 was chosen in
# the first place to avoid exactly this; the old GitHub schedule's 16:15 had
# the same flaw.) The 04:00 run still puts a completed nightly on record long
# before Vercel's watchdog fires (23:30 UTC), so it cannot mail a false
# "missed night".
#
# Settings worth knowing, all of which bit the intraday task first:
#   AllowStartIfOnBatteries   Task Scheduler REFUSES to start on battery by
#                             default, so an unplugged laptop skips silently
#   StartWhenAvailable        run a missed firing as soon as the machine is back
#   WakeToRun                 wake for a firing -- does NOT work on Modern
#                             Standby (S0) machines; `powercfg /a` says which
#   IgnoreNew                 never two at once. The server refuses a second
#                             run anyway, but this stops it being asked.
#
# ExecutionTimeLimit is 2 hours: a clean rotation is ~37 minutes, and the
# ceiling is there for a run that hangs rather than as a budget.
#
#   .\nightly-task.ps1            register both firings
#   .\nightly-task.ps1 -WhatIf    show what it would do
#   .\nightly-task.ps1 -Remove    remove it
#
# ASCII ONLY. Windows PowerShell 5.1 reads a .ps1 as ANSI unless it carries a
# BOM, so an em-dash in a comment is a parse error at a line nowhere near it.
param([switch]$Remove, [switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$TaskName = 'TickrLab nightly'
$Root     = $PSScriptRoot
$Script   = Join-Path $Root 'nightly-ping.js'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed '$TaskName'."
  exit 0
}

if (-not (Test-Path $Script)) { throw "nightly-ping.js is not beside this script ($Script)." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node is not on PATH for this shell.' }

$morning = '04:00'
$evening = '16:00'
$days    = @('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')

$action = New-ScheduledTaskAction -Execute $node -Argument 'nightly-ping.js' -WorkingDirectory $Root
# Two separate weekly triggers rather than a repetition: a repetition would
# keep firing every 12 hours across the weekend, and the two times are not a
# regular interval from each other in any case.
$triggers = @(
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $morning),
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $evening)
)

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -WakeToRun `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

if ($WhatIf) {
  Write-Output "Would register '$TaskName'"
  Write-Output "  run      : $node nightly-ping.js"
  Write-Output "  in       : $Root"
  Write-Output "  weekdays : $morning and $evening ET"
  Write-Output "  firings  : 10 a week"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
  -Settings $settings -Description 'Drives the nightly fundamentals rotation on tickrlab.com. The server refuses a second run if one is already in flight.' -Force | Out-Null

Write-Output "Registered '$TaskName' -- weekdays $morning and $evening ET (10 firings a week)."
