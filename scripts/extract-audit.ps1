# Extracts the structured [AUDIT] JSON-lines from a captured session log into a
# clean .jsonl artifact: model loads/unloads + inference performance
# (prompt size, completion tokens, TTFT, total latency, tokens/sec).
#
# Usage:
#   ./scripts/extract-audit.ps1                 # uses the newest session-*.log
#   ./scripts/extract-audit.ps1 path/to/session.log

param([string]$LogFile)

$ErrorActionPreference = "Stop"
$logDir = Join-Path $PSScriptRoot "..\artifacts\logs"

if (-not $LogFile) {
    $latest = Get-ChildItem -Path $logDir -Filter "session-*.log" |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -eq $latest) { Write-Error "No session-*.log found in $logDir"; exit 1 }
    $LogFile = $latest.FullName
}
if (-not (Test-Path $LogFile)) { Write-Error "Log file not found: $LogFile"; exit 1 }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outFile = Join-Path $logDir "audit-$stamp.jsonl"

# Each audit entry looks like: "... ReactNativeJS: [AUDIT] {json}". Keep only the JSON.
$records = Get-Content $LogFile |
    Where-Object { $_ -match '\[AUDIT\] ' } |
    ForEach-Object { ($_ -replace '^.*?\[AUDIT\] ', '').Trim() } |
    Where-Object { $_ -ne '' }

if ($null -eq $records -or $records.Count -eq 0) {
    Write-Warning "No [AUDIT] records found in $LogFile. Was the log captured with the audit build? Re-run a session, then try again."
    exit 1
}

$records | Set-Content -Path $outFile -Encoding utf8
Write-Host "Wrote $($records.Count) audit records to $outFile"
