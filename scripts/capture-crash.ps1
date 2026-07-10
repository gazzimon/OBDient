# Captures crash logs specifically for OBDient app
# Usage: .\scripts\capture-crash.ps1
# Then reproduce the crash in the app

$ErrorActionPreference = "Stop"

$adb = (Get-Command adb -ErrorAction SilentlyContinue)
if ($null -eq $adb) {
    Write-Error "adb not found in PATH. Install Android platform-tools first."
    exit 1
}

$logDir = Join-Path $PSScriptRoot "..\artifacts\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outFile = Join-Path $logDir "crash-$stamp.log"

Write-Host "Clearing logcat buffer..."
adb logcat -c

Write-Host "Recording crash logs to $outFile"
Write-Host "Reproduce the crash now. Press Ctrl+C to stop."

# Filter for crash-relevant tags.
#   bare       — QVAC worker / Bare worklet logs (Info/Warn level; the error
#                message right before a worklet abort logs HERE, not under E/F)
#   BareKit    — react-native-bare-kit host side
#   DEBUG      — crash_dump backtraces (Fatal)
#   libc:F     — "Fatal signal N" lines (W-level libc is device spam, excluded)
#   *:E        — errors+fatals from every other tag
# NOTE: the previous filter (-s ... *:E *:F) silenced the `bare` tag, so worklet
# crashes looked "silent": the abort reason was dropped by the filter itself.
adb logcat -v threadtime ReactNativeJS:V AndroidRuntime:V bare:V BareKit:V System.err:V DEBUG:V libc:F *:E |
    ForEach-Object { $_; Add-Content -Path $outFile -Value $_ -Encoding UTF8 }