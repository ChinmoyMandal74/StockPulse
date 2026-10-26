# Register (or remove) the Windows scheduled task that reads new articles for
# their tone, every six hours: the semiconductor stocks and, since 2026-10-20,
# every S&P 500 member. See docs/context/news-tone.md.
#
#   .\news-tone-task.ps1            register, or update an existing one
#   .\news-tone-task.ps1 -Remove    take it away
#   .\news-tone-task.ps1 -WhatIf    print what it would register and stop
#
# UNLIKE THE OTHER TASKS THIS IS NOT A PING. The article fetching has to run
# from this machine (publishers refuse data-centre addresses), so the task runs
# news-tone-load.js itself. It talks to the database through db.js and to the
# Anthropic API; it never starts server.js.
#
# IT SPENDS MONEY: under a cent an article, and each run stops at --max-usd.
# Each run reads only articles it has not seen, so the cost follows how much
# news there is, not how many runs. Removing the task stops the spending.
#
# EVERY SIX HOURS (owner, 2026-10-18), because Yahoo's feed holds only the
# latest ~20 items per stock: measured that morning, NVDA's 20 spanned under
# three hours, MU's a day, ACLS's six weeks. One read a day covered the quiet
# stocks and missed most of the busy ones.
#
# 00:30, 06:30, 12:30, 18:30 LOCAL: each slot ends, at the 50-minute limit
# below, well clear of the nightly rotations (04:00 and 16:00 since
# 2026-10-21; 07:30 and 19:30 before), which run from this same laptop. It uses no Twelve
# Data credits, so the price windows are not at stake, only the machine.
# THE MODEL IS CLAUDE HAIKU 5.5 since 2026-10-20 (the owner: "Lets remove
# Sonnet"), set in newstone.js. The shadow comparison that decided it is off
# by default; -Shadow <model> registers the task with a second model reading
# beside it again, its answers in news-tone-shadow.jsonl on this machine only.
#
# A TIME BUDGET: with the S&P 500 a run has about ten times the articles, so
# the loader stops itself after 45 minutes (--max-minutes), inside the task's
# 50-minute limit, and leaves the rest for the next run, newest first.
param([switch]$Remove, [switch]$WhatIf, [string]$Shadow = '')

$ErrorActionPreference = 'Stop'
$TaskName = 'TickrLab news tone'
$Root     = $PSScriptRoot
$Script   = Join-Path $Root 'news-tone-load.js'
# HOURLY ON WEEKDAYS SINCE 2026-10-26 (the owner: "once every hour during
# weekdays starting from 7am to 7pm .. find a good slot when nothing else is
# running"). At :26 past: clear of the headlines (:00), the schedule report
# (:05) and the earnings reader (09:15 and 18:15, about 10 minutes), and
# capped at 30 minutes so it is done before the next hour's :00. The 16:00
# hour is the nightly's, so there is no 16:26. Every night at 00:30, and at
# weekends 06:30, 12:30 and 18:30 as before. The only job a run can meet is
# the 3-minute intraday price ping at :45 (09:45 to 15:45), which uses
# Twelve Data on the server while this uses Yahoo and Anthropic from here.
$Times    = @('00:30')
$Weekday  = @('07:26', '08:26', '09:26', '10:26', '11:26', '12:26', '13:26', '14:26', '15:26', '17:26', '18:26')
$Weekend  = @('06:30', '12:30', '18:30')
$MaxUsd   = '3'
$MaxMin   = '30'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed '$TaskName'."
  exit 0
}

if (-not (Test-Path $Script)) { throw "news-tone-load.js is not beside this script ($Script)." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node is not on PATH for this shell.' }

# The script writes its own report to stdout; cmd redirects it to a log beside it.
$shadowArg = if ($Shadow) { " --shadow $Shadow --shadow-max-usd 1" } else { '' }
# NO WINDOW (2026-10-23, the owner: "sometimes it is hard to know what is
# running" - every task opened a blank console). The command goes in
# news-tone.run.cmd beside this script (it holds this machine's node path,
# so it is not in git), and run-hidden.vbs starts it hidden through
# wscript.exe, which has no window, and hands its exit code back to Task
# Scheduler. What ran and how it ended: /schedule, and the task's log.
$cmdLine = "`"$node`" news-tone-load.js --commit --max-usd $MaxUsd --max-minutes $MaxMin$shadowArg >> news-tone.log 2>&1"
$runCmd = Join-Path $Root 'news-tone.run.cmd'
Set-Content -Path $runCmd -Encoding ascii -Value @('@echo off', "cd /d `"$Root`"", $cmdLine)
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$(Join-Path $Root 'run-hidden.vbs')`" `"$runCmd`"" -WorkingDirectory $Root
$triggers = @($Times | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ }) +
  @($Weekday | ForEach-Object { New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $_ }) +
  @($Weekend | ForEach-Object { New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday, Sunday -At $_ })

# Six hours of articles take minutes; the limit stops a run that has hung, and
# IgnoreNew stops a slow run being doubled by the next slot's.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 35)

if ($WhatIf) {
  Write-Output "Would register '$TaskName'"
  Write-Output "  run   : $cmdLine (hidden, through run-hidden.vbs)"
  Write-Output "  in    : $Root"
  Write-Output "  when  : every day $($Times -join ', '); weekdays $($Weekday -join ', '); weekends $($Weekend -join ', '); stopping each run at `$$MaxUsd or $MaxMin minutes"
  Write-Output "  shadow: $(if ($Shadow) { $Shadow + ', local file only, at most $1 a run' } else { 'none' })"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
  -Settings $settings -Description 'Reads new articles for their tone (news-tone-load.js): every company on the screener, hourly on weekdays 07:26 to 18:26 (not 16:26), nightly at 00:30, and three times a day at weekends. Spends Anthropic API credit.' -Force | Out-Null

Write-Output "Registered '$TaskName' -- daily $($Times -join ', '); weekdays $($Weekday -join ', '); weekends $($Weekend -join ', '); at most `$$MaxUsd or $MaxMin minutes a run."
Write-Output "Log: $(Join-Path $Root 'news-tone.log')"

# Tell /schedule straight away (schedule-report.js); a failure here changes nothing.
try { & $node (Join-Path $Root 'schedule-report.js') } catch { Write-Output "Schedule report not sent: $($_.Exception.Message)" }
