#!/usr/bin/env bash
# Captures an on-device runtime session into artifacts/logs/.
# Records the ReactNativeJS tag (where console.log lands on Android) plus QVAC
# native tags, producing proof of on-device inference + RAG.
#
# Usage:  ./scripts/capture-logs.sh
# Stop with Ctrl+C — the session file is flushed as it records.

set -euo pipefail

if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found in PATH. Install Android platform-tools first." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/../artifacts/logs"
mkdir -p "$LOG_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$LOG_DIR/session-$STAMP.log"

echo "Clearing logcat buffer..."
adb logcat -c

echo "Recording to $OUT_FILE"
echo "Run a full session in the app (load CARpsy, connect ELM327, ask a question)."
echo "Press Ctrl+C to stop."

# ReactNativeJS = JS console.* output; the rest are QVAC/Bare native tags.
adb logcat ReactNativeJS:V QVAC:V bare:V Hypercore:V '*:S' | tee "$OUT_FILE"
