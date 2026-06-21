# Captures an on-device runtime session into artifacts/logs/.
# Records the ReactNativeJS tag (where console.log lands on Android) plus QVAC
# native tags, producing proof of on-device inference + RAG.
#
# Usage:  ./scripts/capture-logs.ps1
# Stop with Ctrl+C — the session file is flushed as it records.

$ErrorActionPreference = "Stop"

$adb = (Get-Command adb -ErrorAction SilentlyContinue)
if ($null -eq $adb) {
    Write-Error "adb not found in PATH. Install Android platform-tools first."
    exit 1
}

$logDir = Join-Path $PSScriptRoot "..\artifacts\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outFile = Join-Path $logDir "session-$stamp.log"

Write-Host "Clearing logcat buffer..."
adb logcat -c

Write-Host "Recording to $outFile"
Write-Host "Run a full session in the app (load CARpsy, connect ELM327, ask a question)."
Write-Host "Press Ctrl+C to stop."

# ReactNativeJS = JS console.* output; the rest are QVAC/Bare native tags.
adb logcat ReactNativeJS:V QVAC:V bare:V Hypercore:V *:S | Tee-Object -FilePath $outFile
