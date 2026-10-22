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
# 07:00 LOCAL ON WEEKDAYS: after the 04:00 nightly run, whose 'sec daily'
# phase records the previous business day's 8-Ks; a Friday's are recorded on
# Monday morning and read at 07:00 then. It uses no Twelve Data credits.
param([switch]$Remove, [switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$TaskName = 'TickrLab earnings releases'
$Root     = $PSScriptRoot
$Script   = Join-Path $Root 'release-load.js'
$At       = '07:00'
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
$cmdArgs = "/c `"`"$node`" --use-system-ca release-load.js --commit --days 5 --max-usd $MaxUsd --max-minutes $MaxMin >> release.log 2>&1`""
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmdArgs -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $At

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 45)

if ($WhatIf) {
  Write-Output "Would register '$TaskName'"
  Write-Output "  run   : cmd.exe $cmdArgs"
  Write-Output "  in    : $Root"
  Write-Output "  when  : weekdays at $At, stopping each run at `$$MaxUsd or $MaxMin minutes"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description 'Reads new earnings releases (release-load.js): each results 8-K press release read by Claude Haiku into earnings_releases. Spends Anthropic API credit.' -Force | Out-Null

Write-Output "Registered '$TaskName' -- weekdays at $At local time, at most `$$MaxUsd or $MaxMin minutes a run."
Write-Output "Log: $(Join-Path $Root 'release.log')"
