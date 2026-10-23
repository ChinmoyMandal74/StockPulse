' Run a TickrLab task with no window (2026-10-23, the owner: "sometimes it is
' hard to know what is running" - the scheduled tasks opened blank windows).
' Windows Script Host has no console of its own; this starts the task's .cmd
' file hidden (window style 0), waits for it, and hands its exit code back
' to Task Scheduler, so /schedule still sees a failed run as failed.
'   wscript.exe run-hidden.vbs <task>.run.cmd
If WScript.Arguments.Count < 1 Then WScript.Quit 2
WScript.Quit CreateObject("WScript.Shell").Run("cmd.exe /c """ & WScript.Arguments(0) & """", 0, True)
