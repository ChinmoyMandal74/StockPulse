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
$Times    = @('00:30', '06:30', '12:30', '18:30')
$MaxUsd   = '3'
$MaxMin   = '45'

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
$cmdArgs = "/c `"`"$node`" news-tone-load.js --commit --max-usd $MaxUsd --max-minutes $MaxMin$shadowArg >> news-tone.log 2>&1`""
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
  Write-Output "  daily : $($Times -join ', '), stopping each run at `$$MaxUsd or $MaxMin minutes"
  Write-Output "  shadow: $(if ($Shadow) { $Shadow + ', local file only, at most $1 a run' } else { 'none' })"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
  -Settings $settings -Description 'Reads new articles for their tone (news-tone-load.js): the semiconductor stocks and the S&P 500, every six hours. Spends Anthropic API credit.' -Force | Out-Null

Write-Output "Registered '$TaskName' -- daily at $($Times -join ', ') local time, at most `$$MaxUsd or $MaxMin minutes a run."
Write-Output "Log: $(Join-Path $Root 'news-tone.log')"

# Tell /schedule straight away (schedule-report.js); a failure here changes nothing.
try { & $node (Join-Path $Root 'schedule-report.js') } catch { Write-Output "Schedule report not sent: $($_.Exception.Message)" }
