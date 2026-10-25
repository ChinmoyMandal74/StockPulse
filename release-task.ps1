# Register (or remove) the Windows scheduled task that reads new earnings
# releases (release-load.js): every results 8-K the daily SEC read recorded,
# its press release read by Claude Haiku into earnings_releases.
# See docs/context/earnings-releases.md.
#
#   .\release-task.ps1            register, or update an existing one
#   .\release-task.ps1 -Remove    take it away
#   .\release-task.ps1 -WhatIf    print what it would register and stop
#
# NOT A PING, like the tone task: the loader runs on this machine, talks to
# the database through db.js, to the SEC and to the Anthropic API, and never
# starts server.js.
#
# IT SPENDS MONEY: about $0.002 a release (measured 2026-10-22), up to ~150
# on a busy earnings day. Each run reads only filings it has not read and
# stops at --max-usd. Removing the task stops the spending.
#
# 09:15 AND 18:15 LOCAL ON WEEKDAYS (the owner, 2026-10-22). The morning run
# reads what the 04:00 nightly's 'sec daily' phase recorded (the previous
# business day's 8-Ks; a Friday's on Monday); the evening run reads whatever
# the 16:00 nightly recorded since. It uses no Twelve Data credits.
#
# AND SATURDAY 05:00 (2026-10-25, the owner: "Yes but can we run the Saturday
# earlier .. may be 5am"). The Saturday 04:00 nightly records Friday's 8-Ks
# and is done by 04:50; without this run Friday's results waited for Monday
# 09:15. The subscriber mailing stays weekday mornings (release-load.js), so
# Saturday's finds go out in Monday's; the owner's digest goes on Saturday.
param([switch]$Remove, [switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$TaskName = 'TickrLab earnings releases'
$Root     = $PSScriptRoot
$Script   = Join-Path $Root 'release-load.js'
$Times    = @('09:15', '18:15')
$MaxUsd   = '2'
$MaxMin   = '40'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed '$TaskName'."
  exit 0
}

if (-not (Test-Path $Script)) { throw "release-load.js is not beside this script ($Script)." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node is not on PATH for this shell.' }

# --use-system-ca as every local job here; the report goes to a log beside it.
# NO WINDOW (2026-10-23, the owner: "sometimes it is hard to know what is
# running" - every task opened a blank console). The command goes in
# release.run.cmd beside this script (it holds this machine's node path,
# so it is not in git), and run-hidden.vbs starts it hidden through
# wscript.exe, which has no window, and hands its exit code back to Task
# Scheduler. What ran and how it ended: /schedule, and the task's log.
$cmdLine = "`"$node`" --use-system-ca release-load.js --commit --mail --days 5 --max-usd $MaxUsd --max-minutes $MaxMin >> release.log 2>&1"
$runCmd = Join-Path $Root 'release.run.cmd'
Set-Content -Path $runCmd -Encoding ascii -Value @('@echo off', "cd /d `"$Root`"", $cmdLine)
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$(Join-Path $Root 'run-hidden.vbs')`" `"$runCmd`"" -WorkingDirectory $Root
$SatTime  = '05:00'
$triggers = @($Times | ForEach-Object { New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $_ }) +
  @(New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At $SatTime)

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 45)

if ($WhatIf) {
  Write-Output "Would register '$TaskName'"
  Write-Output "  run   : $cmdLine (hidden, through run-hidden.vbs)"
  Write-Output "  in    : $Root"
  Write-Output "  when  : weekdays at $($Times -join ', ') and Saturday at $SatTime, stopping each run at `$$MaxUsd or $MaxMin minutes"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
  -Settings $settings -Description 'Reads new earnings releases (release-load.js): each results 8-K press release read by Claude Haiku into earnings_releases. Spends Anthropic API credit.' -Force | Out-Null

Write-Output "Registered '$TaskName' -- weekdays at $($Times -join ', ') and Saturday at $SatTime local time, at most `$$MaxUsd or $MaxMin minutes a run."
Write-Output "Log: $(Join-Path $Root 'release.log')"

# Tell /schedule straight away (schedule-report.js); a failure here changes nothing.
try { & $node (Join-Path $Root 'schedule-report.js') } catch { Write-Output "Schedule report not sent: $($_.Exception.Message)" }
