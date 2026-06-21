#!/usr/bin/env bash
# Extracts the structured [AUDIT] JSON-lines from a captured session log into a
# clean .jsonl artifact: model loads/unloads + inference performance
# (prompt size, completion tokens, TTFT, total latency, tokens/sec).
#
# Usage:
#   ./scripts/extract-audit.sh                  # uses the newest session-*.log
#   ./scripts/extract-audit.sh path/to/session.log
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log_dir="$script_dir/../artifacts/logs"

log_file="${1:-}"
if [ -z "$log_file" ]; then
  log_file="$(ls -t "$log_dir"/session-*.log 2>/dev/null | head -n1 || true)"
  [ -n "$log_file" ] || { echo "No session-*.log found in $log_dir" >&2; exit 1; }
fi
[ -f "$log_file" ] || { echo "Log file not found: $log_file" >&2; exit 1; }

stamp="$(date +%Y%m%d-%H%M%S)"
out_file="$log_dir/audit-$stamp.jsonl"

# Each audit entry looks like: "... ReactNativeJS: [AUDIT] {json}". Keep only the JSON.
grep -a '\[AUDIT\] ' "$log_file" | sed 's/^.*\[AUDIT\] //' > "$out_file" || true

count="$(wc -l < "$out_file" | tr -d ' ')"
if [ "$count" = "0" ]; then
  echo "No [AUDIT] records found in $log_file. Was it captured with the audit build?" >&2
  rm -f "$out_file"
  exit 1
fi
echo "Wrote $count audit records to $out_file"
