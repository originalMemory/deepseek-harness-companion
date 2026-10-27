param(
    [Parameter(Mandatory)][ValidateSet('Stop', 'Launch')][string]$Action,
    [string]$Executable
)
$ErrorActionPreference = 'Stop'
if ($Action -eq 'Launch') {
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Companion executable is missing: $Executable" }
    Start-Process -FilePath $Executable
    exit
}

# A portable application extracts into a temporary directory; identify only Companion's executable name.
$processes = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'DeepSeek Harness Companion.exe' })
foreach ($owned in $processes) {
    if (Get-Process -Id $owned.ProcessId -ErrorAction SilentlyContinue) {
        & "$env:SystemRoot\System32\taskkill.exe" /PID $owned.ProcessId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not stop Companion process $($owned.ProcessId). Quit it and retry." }
    }
}
if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'DeepSeek Harness Companion.exe' }) {
    throw 'Companion is still running. Quit it from its tray menu and retry.'
}
