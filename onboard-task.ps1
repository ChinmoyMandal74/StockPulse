# Register (or remove) the Windows scheduled task that finishes newly added
# stocks (onboard.js --auto): every half hour it looks for stocks added on
# /themes and not yet loaded, and loads everything they need.
# See docs/context/adding-a-stock.md.
#
#   .\onboard-task.ps1            register, or update an existing one
#   .\onboard-task.ps1 -Remove    take it away
#   .\onboard-task.ps1 -WhatIf    print what it would register and stop
#
# NOT A PING: the loaders run on this machine (the local research copy and the
# release text archive are here), and the profile, filings and source rule
# steps call the deployed app with the cron secret. It never starts server.js.
#
# ONE CLICK (2026-11-04, the owner: "This should all be one one click of a
# button somehow"): the add on /themes is the click. Most runs find nothing
# waiting and end after one small read. A run with stocks spends about 101
# Twelve Data credits and up to $2 of Claude Haiku a batch; onboard.js keeps
# out of the nightly windows and waits out the intraday slots.
#
# :05 AND :35 keep it off the intraday slots (:15 and :45) and the tone job (:26).
param([switch]$Remove, [switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$TaskName = 'TickrLab onboard'
$Root     = $PSScriptRoot
$Script   = Join-Path $Root 'onboard.js'
$Start    = '07:05'
$every    = (New-TimeSpan -Minutes 30)
$forHours = (New-TimeSpan -Hours 15)

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed '$TaskName'."
  exit 0
}

if (-not (Test-Path $Script)) { throw "onboard.js is not beside this script ($Script)." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node is not on PATH for this shell.' }

# NO WINDOW (2026-10-23, the owner): the command goes in onboard.run.cmd beside
# this script (it holds this machine's node path, so it is not in git), and
# run-hidden.vbs starts it hidden through wscript.exe and hands its exit code
# back to Task Scheduler. What ran: onboard.log, and /onboarding.
$cmdLine = "`"$node`" --use-system-ca onboard.js --commit --auto >> onboard.log 2>&1"
$runCmd = Join-Path $Root 'onboard.run.cmd'
Set-Content -Path $runCmd -Encoding ascii -Value @('@echo off', "cd /d `"$Root`"", $cmdLine)
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$(Join-Path $Root 'run-hidden.vbs')`" `"$runCmd`"" -WorkingDirectory $Root
# Every half hour for 15 hours from 07:05: the last at 22:05.
$trigger = New-ScheduledTaskTrigger -Daily -At $Start
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At $Start -RepetitionInterval $every -RepetitionDuration $forHours).Repetition
# LOCAL WALL-CLOCK TIME (2026-11-01). New-ScheduledTaskTrigger writes the start
# in UTC ("...Z"), which Task Scheduler reads as "synchronize across time
# zones": the trigger then keeps its UTC instant and runs an hour early or
# late when the clocks change. Without an offset it is local time.
foreach ($t in @($trigger)) { $t.StartBoundary = ([datetime]::Parse($t.StartBoundary)).ToString('s') }

# Three hours: a batch of new stocks is mostly SEC fetches, one at a time.
# IgnoreNew, and onboard.lock besides, so two runs never overlap.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3)

if ($WhatIf) {
  Write-Output "Would register '$TaskName'"
  Write-Output "  run   : $cmdLine (hidden, through run-hidden.vbs)"
  Write-Output "  in    : $Root"
  Write-Output "  when  : every half hour from $Start to 22:05, every day"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description 'Finishes newly added stocks (onboard.js): price history, profile, SEC data, earnings releases, the local copy and the source rule. Spends Twelve Data credits and Anthropic API credit only when a stock is waiting.' -Force | Out-Null

Write-Output "Registered '$TaskName' -- every half hour from $Start to 22:05 local time."
Write-Output "Log: $(Join-Path $Root 'onboard.log')"

# Tell /schedule straight away (schedule-report.js); a failure here changes nothing.
try { & $node (Join-Path $Root 'schedule-report.js') } catch { Write-Output "Schedule report not sent: $($_.Exception.Message)" }
