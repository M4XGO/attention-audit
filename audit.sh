#!/bin/bash
set -euo pipefail

# Description: Logs the name of the frontmost macOS app every N seconds to a
#              daily CSV in ./data. Stretches with no keyboard/mouse input are
#              logged as "idle" so lunch and sleep don't count as focus.
#              Only the app name is recorded: no window titles, no URLs, no
#              keystrokes, no screenshots. Nothing leaves your Mac, and no
#              macOS permission is needed.
# Usage: ./audit.sh [interval_seconds]   (default 30, ctrl-c to stop)
#        install.sh runs it in the background at login instead.
# Dependencies: lsappinfo, ioreg, osascript (all macOS built-ins)

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DATA_DIR="${SCRIPT_DIR}/data"
readonly INTERVAL="${1:-30}"
readonly IDLE_THRESHOLD=300
readonly READY_AFTER_DAYS=7

if [[ ! "$INTERVAL" =~ ^[0-9]+$ ]] || [[ "$INTERVAL" -lt 5 ]]; then
    echo "Usage: $0 [interval_seconds >= 5]" >&2
    exit 1
fi

# awk reads all of ioreg instead of exiting early: an early exit sends SIGPIPE
# to ioreg, which pipefail turns into a failure.
idle_seconds() {
    local idle
    idle=$(ioreg -c IOHIDSystem 2>/dev/null \
        | awk '/HIDIdleTime/ && !found {print int($NF/1000000000); found=1}') || true
    echo "${idle:-0}"
}

# lsappinfo reads the frontmost app from LaunchServices, which needs no
# Accessibility or Automation permission, unlike System Events.
frontmost_app() {
    local name
    name=$(lsappinfo info -only name "$(lsappinfo front)" 2>/dev/null \
        | sed -E 's/.*"="(.*)"$/\1/') || true
    echo "${name:-unknown}"
}

log_file_for_today() {
    echo "${DATA_DIR}/audit_$(date +%Y-%m-%d).csv"
}

# Once 7 days are logged, offer the card. "Later" asks again the next day.
offer_card_when_week_done() {
    local done_marker="${DATA_DIR}/.card_shown"
    local asked_marker="${DATA_DIR}/.card_asked_$(date +%Y-%m-%d)"
    [[ -f "$done_marker" || -f "$asked_marker" ]] && return 0
    local days
    days=$(find "$DATA_DIR" -name 'audit_*.csv' | wc -l | tr -d ' ')
    [[ "$days" -lt "$READY_AFTER_DAYS" ]] && return 0

    rm -f "${DATA_DIR}"/.card_asked_*
    touch "$asked_marker"
    echo "${READY_AFTER_DAYS} days logged. your card is ready: ./card.sh"
    ( "${SCRIPT_DIR}/card.sh" --ask >/dev/null 2>&1 && touch "$done_marker" ) &
}

mkdir -p "$DATA_DIR"
echo "logging the frontmost app every ${INTERVAL}s to data/audit_YYYY-MM-DD.csv"
echo "idle after ${IDLE_THRESHOLD}s without input. ctrl-c to stop."
echo "after ${READY_AFTER_DAYS} days you get a prompt for your card (or run ./card.sh any time)"

while true; do
    log_file="$(log_file_for_today)"
    if [[ ! -f "$log_file" ]]; then
        echo "timestamp,app" > "$log_file"
    fi
    offer_card_when_week_done

    if [[ "$(idle_seconds)" -ge "$IDLE_THRESHOLD" ]]; then
        app="idle"
    else
        app="$(frontmost_app)"
    fi

    printf '%s,"%s"\n' "$(date +%Y-%m-%dT%H:%M:%S)" "${app//\"/}" >> "$log_file"
    sleep "$INTERVAL"
done
