# Register (or remove) the DAYTIME run of the website crawl (website-load.js):
# the same nationwide list and the same work as the night run
# (website-task.ps1), on fewer workers so the laptop stays usable. See
# docs/context/company-websites.md.
#
#   .\website-day-task.ps1            register, or update an existing one
#   .\website-day-task.ps1 -Remove    take it away
#   .\website-day-task.ps1 -WhatIf    print what it would register and stop
#
# The owner, 2026-11-11: "Yes create a day crawl too".
#
# 09:00 LOCAL, EVERY DAY. Stops starting companies after 690 minutes (about
# 20:30), at $2 of reading, or when web-archive.db reaches 12 GB, so it has
# finished well before the night run starts at 23:00 (the two share one lock;
# the second to start would refuse). Four workers, not twelve: still one
# request every 3 seconds to any one site, robots.txt obeyed. Each run carries
# on where the last stopped (companies tried are skipped).
#
# NO EMAIL OF ITS OWN: a crawl day runs 09:00 to 09:00 (crawlstats.js), so the
# morning email after the night run counts this run too.
#
# NOT A PING: the loader writes the LOCAL formd.db and web-archive.db. It
# never starts server.js and uses no Twelve Data credits.
#
# IT SPENDS MONEY: about $0.003 a company, roughly $1 to $2 a day.
param([switch]$Remove, [switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$TaskName = 'TickrLab websites day'
$Root     = $PSScriptRoot
$Script   = Join-Path $Root 'website-load.js'
$Times    = @('09:00')
$Minutes  = '690'
$MaxUsd   = '2'
$MaxGb    = '12'
$Workers  = '4'
$Pages    = '20'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed '$TaskName'."
  exit 0
}

if (-not (Test-Path $Script)) { throw "website-load.js is not beside this script ($Script)." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node is not on PATH for this shell.' }

# NO WINDOW, as the other tasks: the command goes in websites-day.run.cmd
# beside this script (it holds this machine's node path, so it is not in git),
# and run-hidden.vbs starts it hidden. The report goes to website-load.log.
$cmdLine = "`"$node`" --use-system-ca --disable-warning=ExperimentalWarning website-load.js --commit --min-staff 100 --max-staff 0 --max 200000 --workers $Workers --pages $Pages --then-deep --minutes $Minutes --max-usd $MaxUsd --max-gb $MaxGb >> website-load.log 2>&1"
$runCmd = Join-Path $Root 'websites-day.run.cmd'
Set-Content -Path $runCmd -Encoding ascii -Value @('@echo off', "cd /d `"$Root`"", $cmdLine)
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$(Join-Path $Root 'run-hidden.vbs')`" `"$runCmd`"" -WorkingDirectory $Root
$triggers = @($Times | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ })
# LOCAL WALL-CLOCK TIME (2026-11-01): without an offset the trigger is local
# time, so it does not drift an hour when the clocks change.
foreach ($t in @($triggers)) { $t.StartBoundary = ([datetime]::Parse($t.StartBoundary)).ToString('s') }

# No -StartWhenAvailable: a day the laptop wakes late starts nothing then, so a
# late start can never run into the night run.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 760)

if ($WhatIf) {
  Write-Output "Would register '$TaskName'"
  Write-Output "  run   : $cmdLine (hidden, through run-hidden.vbs)"
  Write-Output "  in    : $Root"
  Write-Output "  when  : every day at $($Times -join ', '), stopping after $Minutes minutes, `$$MaxUsd or $MaxGb GB"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
  -Settings $settings -Description 'The daytime run of the website crawl (website-load.js), four at a time: sites confirmed, read by Claude Haiku, up to 20 pages each kept in the local web-archive.db. Spends Anthropic API credit.' -Force | Out-Null

Write-Output "Registered '$TaskName' -- every day at $($Times -join ', ') local time, at most $Minutes minutes, `$$MaxUsd or $MaxGb GB a run."
Write-Output "Log: $(Join-Path $Root 'website-load.log')"

# Tell /schedule straight away (schedule-report.js); a failure here changes nothing.
try { & $node (Join-Path $Root 'schedule-report.js') } catch { Write-Output "Schedule report not sent: $($_.Exception.Message)" }
