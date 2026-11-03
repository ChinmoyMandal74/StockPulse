# Register (or remove) the Windows scheduled task that keeps the local research
# copy (analysis.db, analysis-db.js) current: the day's bars and fundamentals,
# and the filings tables (sec_facts, earnings_releases).
#
#   .\localcopy-task.ps1            register, or update an existing one
#   .\localcopy-task.ps1 -Remove    take it away
#   .\localcopy-task.ps1 -WhatIf    print what it would register and stop
#
# THE OWNER, 2026-11-02, reading the daily jobs email: "I don't see anything
# here on local DB update for earning and sec filings". Until now the copy was
# synced only by hand.
#
# NOT A PING: analysis-db.js runs here, reads Turso and writes only the local
# file. It never writes to Turso and never starts server.js. It spends no
# Twelve Data credits and no API money; it reads Turso rows, which are billed:
#   weekdays 18:50, --scheduled = --sec --recent: ~35,000 rows, about a minute
#     (the filings tables' recent rows only, by index);
#   Saturday 06:00, --scheduled = --sec whole: ~385,000 rows, about 3 minutes,
#     which catches what the recent window misses (old periods restated, a
#     10-K's earlier years, rows removed upstream).
#
# 18:50 is after the 16:00 nightly and the 18:15 releases run, and before the
# laptop's 19:05 report, which the 20:00 jobs email reads for this task's
# result. Saturday 06:00 follows the Saturday 04:00 nightly and 05:00 releases.
param([switch]$Remove, [switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$TaskName = 'TickrLab local copy'
$Root     = $PSScriptRoot
$Script   = Join-Path $Root 'analysis-db.js'
$Times    = @('18:50')
$SatTime  = '06:00'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed '$TaskName'."
  exit 0
}

if (-not (Test-Path $Script)) { throw "analysis-db.js is not beside this script ($Script)." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node is not on PATH for this shell.' }

# NO WINDOW, as every task here: the command goes in localcopy.run.cmd beside
# this script (it holds this machine's node path, so it is not in git), and
# run-hidden.vbs starts it hidden through wscript.exe and hands its exit code
# back to Task Scheduler. What ran and how it ended: /schedule, the jobs email,
# and analysis-sync.log.
$cmdLine = "`"$node`" --use-system-ca --no-warnings analysis-db.js --scheduled >> analysis-sync.log 2>&1"
$runCmd = Join-Path $Root 'localcopy.run.cmd'
Set-Content -Path $runCmd -Encoding ascii -Value @('@echo off', "cd /d `"$Root`"", $cmdLine)
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$(Join-Path $Root 'run-hidden.vbs')`" `"$runCmd`"" -WorkingDirectory $Root
$triggers = @($Times | ForEach-Object { New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $_ }) +
  @(New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At $SatTime)
# LOCAL WALL-CLOCK TIME (2026-11-01). New-ScheduledTaskTrigger writes the start
# in UTC ("...Z"), which Task Scheduler reads as "synchronize across time
# zones": the trigger then keeps its UTC instant and runs an hour early or
# late when the clocks change. Without an offset it is local time.
foreach ($t in @($triggers)) { $t.StartBoundary = ([datetime]::Parse($t.StartBoundary)).ToString('s') }

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

if ($WhatIf) {
  Write-Output "Would register '$TaskName'"
  Write-Output "  run   : $cmdLine (hidden, through run-hidden.vbs)"
  Write-Output "  in    : $Root"
  Write-Output "  when  : weekdays at $($Times -join ', ') (recent filings rows) and Saturday at $SatTime (filings tables whole)"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
  -Settings $settings -Description 'Keeps the local research copy current (analysis-db.js --scheduled): bars, fundamentals and the filings tables, into analysis.db. Reads Turso, writes only the local file.' -Force | Out-Null

Write-Output "Registered '$TaskName' -- weekdays at $($Times -join ', ') and Saturday at $SatTime local time."
Write-Output "Log: $(Join-Path $Root 'analysis-sync.log')"

# Tell /schedule straight away (schedule-report.js); a failure here changes nothing.
try { & $node (Join-Path $Root 'schedule-report.js') } catch { Write-Output "Schedule report not sent: $($_.Exception.Message)" }
