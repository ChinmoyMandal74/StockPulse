# Register (or remove) the Windows scheduled task that pings the intraday price
# refresh every 30 minutes through the US session.
#
#   .\intraday-task.ps1            register, or update an existing one
#   .\intraday-task.ps1 -Remove    take it away
#   .\intraday-task.ps1 -WhatIf    print what it would register and stop
#
# THE SCHEDULE IS LOCAL TIME AND THIS MACHINE IS ON EASTERN, so 9:45 here is
# 9:45 in New York. If the laptop ever moves timezone the trigger moves with it
# and the server simply refuses the calls that land outside its window -- which
# is the point of the server holding the window rather than the scheduler.
#
# A LAPTOP IS A WEAK CRON HOST and the settings below are what make it tolerable
# rather than what make it reliable:
#   StartWhenAvailable        run a missed slot as soon as the lid opens
#   WakeToRun                 wake the machine for a slot (see the caveat below)
#   AllowStartIfOnBatteries   Task Scheduler REFUSES to start on battery by
#   DontStopIfGoingOnBatteries  default, which would silently skip every slot
#                             on an unplugged laptop
# Wake timers do not fire on machines using Modern Standby (S0), which most
# recent laptops do. Check with:  powercfg /a
param([switch]$Remove, [switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$TaskName = 'TickrLab intraday prices'
$Root     = $PSScriptRoot
$Script   = Join-Path $Root 'intraday-ping.js'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed '$TaskName'."
  exit 0
}

if (-not (Test-Path $Script)) { throw "intraday-ping.js is not beside this script ($Script)." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node is not on PATH for this shell.' }

# 9:45 through 15:45 -- thirteen firings. The last is 15 minutes before the bell;
# the 4:15 PM nightly is what records the settled close, so there is deliberately
# no 16:00 slot here.
$start    = '09:45'
$every    = (New-TimeSpan -Minutes 30)
$forHours = (New-TimeSpan -Hours 6)

$action = New-ScheduledTaskAction -Execute $node -Argument 'intraday-ping.js' -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $start
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval $every -RepetitionDuration $forHours).Repetition

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -WakeToRun `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

if ($WhatIf) {
  Write-Output "Would register '$TaskName'"
  Write-Output "  run      : $node intraday-ping.js"
  Write-Output "  in       : $Root"
  Write-Output "  weekdays : $start, every 30 min for 6h  (last 15:45)"
  Write-Output "  firings  : 13 a day"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description 'Asks tickrlab.com to refresh prices intraday. The server decides whether to act.' -Force | Out-Null

Write-Output "Registered '$TaskName' -- weekdays $start, every 30 min for 6 hours (last 15:45 ET)."
Write-Output "Log: $(Join-Path $Root 'intraday-ping.log')"
Write-Output "Run it once now with:  node intraday-ping.js --dry"
