# Register (or remove) the Windows scheduled task that emails the owner the
# week's figures for the local article archive (archive-report.js), every
# Saturday at 08:00.
#
#   .\archive-report-task.ps1            register, or update an existing one
#   .\archive-report-task.ps1 -Remove    take it away
#   .\archive-report-task.ps1 -WhatIf    print what it would register and stop
#
# ONE READ AND ONE HTTP CALL: the archive (news-archive.db, on this laptop
# only) is counted here and the counts are posted to the app, which sends the
# email. It writes nothing and spends nothing. 08:00 Saturday is clear of the
# weekend tone runs (06:30, 12:30, 18:30) and the 05:00 earnings reader.
param([switch]$Remove, [switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$TaskName = 'TickrLab archive report'
$Root     = $PSScriptRoot
$Script   = Join-Path $Root 'archive-report.js'
$Start    = '08:00'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed '$TaskName'."
  exit 0
}

if (-not (Test-Path $Script)) { throw "archive-report.js is not beside this script ($Script)." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node is not on PATH for this shell.' }

# No window: the command goes in archive-report.run.cmd beside this script (it
# holds this machine's node path, so it is not in git), and run-hidden.vbs
# starts it hidden through wscript.exe, as every other TickrLab task does.
$cmdLine = "`"$node`" --disable-warning=ExperimentalWarning archive-report.js >> archive-report.log 2>&1"
$runCmd = Join-Path $Root 'archive-report.run.cmd'
Set-Content -Path $runCmd -Encoding ascii -Value @('@echo off', "cd /d `"$Root`"", $cmdLine)
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$(Join-Path $Root 'run-hidden.vbs')`" `"$runCmd`"" -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At $Start
# LOCAL WALL-CLOCK TIME (2026-11-01). New-ScheduledTaskTrigger writes the start
# in UTC ("...Z"), which Task Scheduler reads as "synchronize across time
# zones": the trigger then keeps its UTC instant and runs an hour early or
# late when the clocks change. Without an offset it is local time.
foreach ($t in @($trigger)) { $t.StartBoundary = ([datetime]::Parse($t.StartBoundary)).ToString('s') }

# Started late if the laptop was asleep at 08:00, so the week is still mailed.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

if ($WhatIf) {
  Write-Output "Would register '$TaskName'"
  Write-Output "  run   : $node archive-report.js"
  Write-Output "  in    : $Root"
  Write-Output "  when  : Saturdays at $Start"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description 'Emails the owner the week''s figures for the local article archive (archive-report.js). Spends nothing.' -Force | Out-Null

Write-Output "Registered '$TaskName' -- Saturdays at $Start local time."
Write-Output "Log: $(Join-Path $Root 'archive-report.log')"

# Tell /schedule straight away; a failure here changes nothing.
try { & $node (Join-Path $Root 'schedule-report.js') } catch { Write-Output "Schedule report not sent: $($_.Exception.Message)" }
