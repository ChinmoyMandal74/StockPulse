# Register (or remove) the Windows scheduled task that sends this laptop's
# task list to /schedule (schedule-report.js), every hour at five past.
#
#   .\schedule-report-task.ps1            register, or update an existing one
#   .\schedule-report-task.ps1 -Remove    take it away
#   .\schedule-report-task.ps1 -WhatIf    print what it would register and stop
#
# NOT A JOB THAT DOES WORK: one read of Task Scheduler and one HTTP call. It
# spends nothing. Every other *-task.ps1 also sends a report straight after it
# registers, so a change shows on /schedule within a minute; this hourly run
# is what catches a change made by hand in Task Scheduler, and shows the last
# run and next run of every task.
#
# Five past the hour keeps it off the hour, where the other jobs start.
param([switch]$Remove, [switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$TaskName = 'TickrLab schedule report'
$Root     = $PSScriptRoot
$Script   = Join-Path $Root 'schedule-report.js'
$Start    = '00:05'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed '$TaskName'."
  exit 0
}

if (-not (Test-Path $Script)) { throw "schedule-report.js is not beside this script ($Script)." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node is not on PATH for this shell.' }

# NO WINDOW (2026-10-23, the owner: "sometimes it is hard to know what is
# running" - every task opened a blank console). The command goes in
# schedule-report.run.cmd beside this script (it holds this machine's node path,
# so it is not in git), and run-hidden.vbs starts it hidden through
# wscript.exe, which has no window, and hands its exit code back to Task
# Scheduler. What ran and how it ended: /schedule, and the task's log.
$cmdLine = "`"$node`" schedule-report.js >> schedule-report.log 2>&1"
$runCmd = Join-Path $Root 'schedule-report.run.cmd'
Set-Content -Path $runCmd -Encoding ascii -Value @('@echo off', "cd /d `"$Root`"", $cmdLine)
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$(Join-Path $Root 'run-hidden.vbs')`" `"$runCmd`"" -WorkingDirectory $Root
# Every hour for 23 hours from 00:05: 24 runs a day, the last at 23:05.
$trigger = New-ScheduledTaskTrigger -Daily -At $Start
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At $Start -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Hours 23)).Repetition

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

if ($WhatIf) {
  Write-Output "Would register '$TaskName'"
  Write-Output "  run   : $node schedule-report.js"
  Write-Output "  in    : $Root"
  Write-Output "  when  : every hour from $Start, every day"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description 'Sends this laptop''s TickrLab task list to tickrlab.com/schedule. Spends nothing.' -Force | Out-Null

Write-Output "Registered '$TaskName' -- every hour from $Start local time."
Write-Output "Log: $(Join-Path $Root 'schedule-report.log')"

# Tell /schedule straight away; a failure here changes nothing.
try { & $node $Script } catch { Write-Output "Schedule report not sent: $($_.Exception.Message)" }
