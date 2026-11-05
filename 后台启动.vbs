' Start Course Notes Helper in the background (no console window).
' Double-clicking ????.vbs starts the server silently; use ??.bat to stop it.

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

sh.Run "node ""server\server.js""", 0, False
