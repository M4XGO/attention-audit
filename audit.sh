#!/bin/bash
set -euo pipefail

# Description: Logs the name of the frontmost macOS app every N seconds to a
#              daily CSV in ./data. Stretches with no keyboard/mouse input are
#              logged as "idle" so lunch and sleep don't count as focus.
#              Only the app name is recorded: no window titles, no URLs, no
#              keystrokes, no screenshots. Nothing leaves your Mac.
# Usage: ./audit.sh [interval_seconds]   (default 30, ctrl-c to stop)
# Dependencies: osascript, ioreg (both macOS built-ins)
# Note: first run asks for Accessibility permission for your terminal app,
#       because reading the frontmost app name goes through System Events.

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DATA_DIR="${SCRIPT_DIR}/data"
readonly INTERVAL="${1:-30}"
readonly IDLE_THRESHOLD=300
readonly READY_AFTER_DAYS=7

if [[ ! "$INTERVAL" =~ ^[0-9]+$ ]] || [[ "$INTERVAL" -lt 5 ]]; then
    echo "Usage: $0 [interval_seconds >= 5]" >&2
    exit 1
fi

# Seconds since the last keyboard or mouse event.
# awk reads all of ioreg instead of exiting early: an early exit sends SIGPIPE
# to ioreg, which pipefail turns into a failure.
idle_seconds() {
    local idle
    idle=$(ioreg -c IOHIDSystem 2>/dev/null \
        | awk '/HIDIdleTime/ && !found {print int($NF/1000000000); found=1}') || true
    echo "${idle:-0}"
}

frontmost_app() {
    osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null || echo "unknown"
}

log_file_for_today() {
    echo "${DATA_DIR}/audit_$(date +%Y-%m-%d).csv"
}

# One notification, the first time 7 distinct days are logged.
notify_when_week_done() {
    local marker="${DATA_DIR}/.week_notified"
    [[ -f "$marker" ]] && return 0
    local days
    days=$(find "$DATA_DIR" -name 'audit_*.csv' | wc -l | tr -d ' ')
    if [[ "$days" -ge "$READY_AFTER_DAYS" ]]; then
        osascript -e "display notification \"Run: python3 report.py --card\" with title \"Your 7-day attention card is ready\"" 2>/dev/null || true
        echo "7 days logged. your card is ready: python3 report.py --card"
        touch "$marker"
    fi
}

mkdir -p "$DATA_DIR"
echo "logging the frontmost app every ${INTERVAL}s to data/audit_YYYY-MM-DD.csv"
echo "idle after ${IDLE_THRESHOLD}s without input. ctrl-c to stop."
echo "run it for 7 days, then: python3 report.py --card"
notify_when_week_done

while true; do
    log_file="$(log_file_for_today)"
    if [[ ! -f "$log_file" ]]; then
        echo "timestamp,app" > "$log_file"
        notify_when_week_done
    fi

    if [[ "$(idle_seconds)" -ge "$IDLE_THRESHOLD" ]]; then
        app="idle"
    else
        app="$(frontmost_app)"
    fi

    printf '%s,"%s"\n' "$(date +%Y-%m-%dT%H:%M:%S)" "${app//\"/}" >> "$log_file"
    sleep "$INTERVAL"
done
