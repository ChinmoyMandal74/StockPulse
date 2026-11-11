# Register (or remove) the Windows scheduled task that finds and keeps
# companies' own websites (website-load.js), nationwide: every employer with
# its own retirement plan, 100 or more staff, filing 2023 or later (about
# 117,000). Each night it finds and confirms sites, reads each confirmed one
# with Claude Haiku, and keeps up to 40 useful pages of it in the LOCAL
# web-archive.db, searchable (web-search.js). See docs/context/company-websites.md.
#
#   .\website-task.ps1            register, or update an existing one
#   .\website-task.ps1 -Remove    take it away
#   .\website-task.ps1 -WhatIf    print what it would register and stop
#
# The owner, 2026-11-10: "Lets do the nationwide , 12GB is fine".
#
# NOT A PING: the loader runs on this machine and writes the LOCAL formd.db
# and web-archive.db, which is why it cannot move to Fly. It never starts
# server.js and uses no Twelve Data credits.
#
# CAREFUL BY DESIGN: robots.txt obeyed, 3 seconds between a worker's requests,
# four workers (four companies at once, so each site still sees one request
# every 3 seconds). Stops starting companies after 465 minutes, at $3 of
# reading, or when web-archive.db reaches 12 GB. Each run carries on where the
# last stopped; a night the laptop is asleep is simply skipped.
#
# IT SPENDS MONEY: about $0.0015 a confirmed site read (a third of companies),
# roughly $0.65 a night; about $60 for the whole list.
#
# 23:00 LOCAL, EVERY NIGHT, until about 06:45; then the morning email (owner,
# 2026-11-10: "why don't you start at 11pm tonight and go on till 7am .. I am
# trying to get this data faster into the app"). Six workers, not four.
param([switch]$Remove, [switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$TaskName = 'TickrLab websites'
$Root     = $PSScriptRoot
$Script   = Join-Path $Root 'website-load.js'
$Times    = @('23:00')
$Minutes  = '465'
$MaxUsd   = '3'
$MaxGb    = '12'
$Workers  = '6'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed '$TaskName'."
  exit 0
}

if (-not (Test-Path $Script)) { throw "website-load.js is not beside this script ($Script)." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node is not on PATH for this shell.' }

# NO WINDOW, as the other tasks: the command goes in websites.run.cmd beside
# this script (it holds this machine's node path, so it is not in git), and
# run-hidden.vbs starts it hidden. The report goes to website-load.log.
$cmdLine = "`"$node`" --use-system-ca --disable-warning=ExperimentalWarning website-load.js --commit --min-staff 100 --max-staff 0 --max 200000 --workers $Workers --then-deep --minutes $Minutes --max-usd $MaxUsd --max-gb $MaxGb >> website-load.log 2>&1"
# THE MORNING EMAIL (2026-11-10, the owner: "send me a daily email in the
# morning on the crwal previous night"): crawl-report.js counts the night and
# the app mails it, straight after the crawl ends (about 06:45).
$reportLine = "`"$node`" --use-system-ca --disable-warning=ExperimentalWarning crawl-report.js >> website-load.log 2>&1"
$runCmd = Join-Path $Root 'websites.run.cmd'
Set-Content -Path $runCmd -Encoding ascii -Value @('@echo off', "cd /d `"$Root`"", $cmdLine, $reportLine)
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$(Join-Path $Root 'run-hidden.vbs')`" `"$runCmd`"" -WorkingDirectory $Root
$triggers = @($Times | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ })
# LOCAL WALL-CLOCK TIME (2026-11-01): without an offset the trigger is local
# time, so it does not drift an hour when the clocks change.
foreach ($t in @($triggers)) { $t.StartBoundary = ([datetime]::Parse($t.StartBoundary)).ToString('s') }

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 500)

if ($WhatIf) {
  Write-Output "Would register '$TaskName'"
  Write-Output "  run   : $cmdLine (hidden, through run-hidden.vbs)"
  Write-Output "  then  : $reportLine (the morning email)"
  Write-Output "  in    : $Root"
  Write-Output "  when  : every night at $($Times -join ', '), stopping after $Minutes minutes, `$$MaxUsd or $MaxGb GB"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
  -Settings $settings -Description 'Finds and keeps companies own websites, nationwide (website-load.js): sites confirmed, read by Claude Haiku, up to 40 pages each kept in the local web-archive.db. Spends Anthropic API credit.' -Force | Out-Null

Write-Output "Registered '$TaskName' -- every night at $($Times -join ', ') local time, at most $Minutes minutes, `$$MaxUsd or $MaxGb GB a run."
Write-Output "Log: $(Join-Path $Root 'website-load.log')"

# Tell /schedule straight away (schedule-report.js); a failure here changes nothing.
try { & $node (Join-Path $Root 'schedule-report.js') } catch { Write-Output "Schedule report not sent: $($_.Exception.Message)" }
