# Installs the MAREO Today widget outside Google Drive (node_modules there would
# sync), adds it to Windows startup and launches it.
# Usage: powershell -ExecutionPolicy Bypass -File tools\today-widget\install.ps1
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dst = Join-Path $env:LOCALAPPDATA 'mareo-widget'
New-Item -ItemType Directory -Force $dst | Out-Null
foreach ($f in 'main.js', 'preload.js', 'package.json') { Copy-Item (Join-Path $src $f) $dst -Force }
Push-Location $dst
try { npm install --no-audit --no-fund --loglevel=error } finally { Pop-Location }

$exe = Join-Path $dst 'node_modules\electron\dist\electron.exe'
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'MAREO Today.lnk'
$sh = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sh.TargetPath = $exe
$sh.Arguments = "`"$dst`""
$sh.WorkingDirectory = $dst
$sh.Description = 'MAREO Today widget'
$sh.Save()

Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force
Start-Process $exe -ArgumentList "`"$dst`""
Write-Output "OK: $dst  (startup: $lnk)"
