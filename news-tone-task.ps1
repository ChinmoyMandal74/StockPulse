# Register (or remove) the Windows scheduled task that reads the semiconductor
# stocks' new articles for their tone, every six hours. See docs/context/news-tone.md.
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
# 00:30, 06:30, 12:30, 18:30 LOCAL: the morning and evening slots each end an
# hour before the 07:30 and 19:30 nightly rotations, which run from this same
# laptop, and the 50-minute limit below makes sure of it. It uses no Twelve
# Data credits, so the price windows are not at stake, only the machine.
# A SHADOW MODEL (2026-10-19, the owner: try a lower model for a few days and
# compare costs). Each article the main model reads is also read by this one;
# its answers go to news-tone-shadow.jsonl on this machine only, never the
# database. node news-tone-compare.js reports the agreement and the cost.
# -NoShadow registers the task without it.
param([switch]$Remove, [switch]$WhatIf, [switch]$NoShadow, [string]$Shadow = 'claude-haiku-5-5')

$ErrorActionPreference = 'Stop'
$TaskName = 'TickrLab news tone'
$Root     = $PSScriptRoot
$Script   = Join-Path $Root 'news-tone-load.js'
$Times    = @('00:30', '06:30', '12:30', '18:30')
$MaxUsd   = '3'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed '$TaskName'."
  exit 0
}

if (-not (Test-Path $Script)) { throw "news-tone-load.js is not beside this script ($Script)." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node is not on PATH for this shell.' }

# The script writes its own report to stdout; cmd redirects it to a log beside it.
$shadowArg = if ($NoShadow) { '' } else { " --shadow $Shadow --shadow-max-usd 1" }
$cmdArgs = "/c `"`"$node`" news-tone-load.js --commit --max-usd $MaxUsd$shadowArg >> news-tone.log 2>&1`""
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmdArgs -WorkingDirectory $Root
$triggers = $Times | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ }

# Six hours of articles take minutes; the limit stops a run that has hung, and
# IgnoreNew stops a slow run being doubled by the next slot's.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 50)

if ($WhatIf) {
  Write-Output "Would register '$TaskName'"
  Write-Output "  run   : cmd.exe $cmdArgs"
  Write-Output "  in    : $Root"
  Write-Output "  daily : $($Times -join ', '), stopping each run at `$$MaxUsd"
  Write-Output "  shadow: $(if ($NoShadow) { 'none' } else { $Shadow + ', local file only, at most $1 a run' })"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
  -Settings $settings -Description 'Reads the semiconductor stocks new articles for their tone (news-tone-load.js), every six hours. Spends Anthropic API credit.' -Force | Out-Null

Write-Output "Registered '$TaskName' -- daily at $($Times -join ', ') local time, at most `$$MaxUsd a run."
Write-Output "Log: $(Join-Path $Root 'news-tone.log')"
