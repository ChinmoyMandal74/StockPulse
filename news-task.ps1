# Register (or remove) the Windows scheduled task that tops up the headlines
# three times a day, every day.
#
#   .\news-task.ps1            register, or update an existing one
#   .\news-task.ps1 -Remove    take it away
#   .\news-task.ps1 -WhatIf    print what it would register and stop
#
# THREE FIXED TIMES, EVERY DAY INCLUDING WEEKENDS: 08:00, 13:00, 17:00. Three
# separate daily triggers rather than one repeating one, because the gaps are
# uneven (5h, 4h, then 15h overnight) and a repetition interval can only be
# one number.
#
# WEEKENDS ARE DELIBERATE and are why this differs from the price schedule.
# Prices only move when the market is open; headlines are published all week,
# the provider is free and keyless, and none of this costs an API credit. So
# there is nothing here for a market clock to protect.
#
# THE SCHEDULE IS LOCAL TIME AND THIS MACHINE IS ON EASTERN. Unlike the price
# schedule there is no server-side window to catch a slot that lands somewhere
# unexpected, because there is no wrong time to fetch a headline -- if the
# laptop moves timezone the slots simply move with it.
#
# A LAPTOP IS A WEAK CRON HOST and the settings below are what make it
# tolerable rather than what make it reliable:
#   StartWhenAvailable        run a missed slot as soon as the lid opens
#   WakeToRun                 wake the machine for a slot (see the caveat below)
#   AllowStartIfOnBatteries   Task Scheduler REFUSES to start on battery by
#   DontStopIfGoingOnBatteries  default, which would silently skip every slot
#                             on an unplugged laptop
# Wake timers do not fire on machines using Modern Standby (S0), which most
# recent laptops do. Check with:  powercfg /a
param([switch]$Remove, [switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$TaskName = 'TickrLab news'
$Root     = $PSScriptRoot
$Script   = Join-Path $Root 'news-ping.js'
$Times    = @('08:00', '13:00', '17:00')

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed '$TaskName'."
  exit 0
}

if (-not (Test-Path $Script)) { throw "news-ping.js is not beside this script ($Script)." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node is not on PATH for this shell.' }

$action = New-ScheduledTaskAction -Execute $node -Argument 'news-ping.js' -WorkingDirectory $Root
$triggers = $Times | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ }

# A lap of the universe is about thirty batches, a few seconds each, so a slot
# is minutes rather than an hour. The limit is a stop for a run that has gone
# wrong, not a budget for one that has not.
#
# IgnoreNew matters here more than it does for prices: a slow 08:00 lap must
# not have 13:00 start a second one on top of it and fetch everything twice.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -WakeToRun `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 45)

if ($WhatIf) {
  Write-Output "Would register '$TaskName'"
  Write-Output "  run   : $node news-ping.js"
  Write-Output "  in    : $Root"
  Write-Output "  daily : $($Times -join ', '), every day including weekends"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
  -Settings $settings -Description 'Asks tickrlab.com to top up the stored headlines. Three times a day, every day.' -Force | Out-Null

Write-Output "Registered '$TaskName' -- daily at $($Times -join ', ') local time, weekends included."
Write-Output "Log: $(Join-Path $Root 'news-ping.log')"
Write-Output "Run it once now with:  node news-ping.js --dry"
