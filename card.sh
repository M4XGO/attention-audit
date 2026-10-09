#!/bin/bash
set -euo pipefail

# Description: Builds your attention card from the logged data, opens it, and
#              opens a prefilled post so sharing is one drag. Nothing is posted
#              until you hit send.
# Usage: ./card.sh            build, open, offer to share
#        ./card.sh --ask      ask first with a dialog (used by the 7-day prompt)
#        ./card.sh --no-share build and print the report only
# Dependencies: osascript (macOS built-in)

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DATA_DIR="${SCRIPT_DIR}/data"
readonly CARD="${SCRIPT_DIR}/card.png"
readonly ICON="${SCRIPT_DIR}/assets/nudge.icns"
readonly REPO_URL="github.com/M4XGO/attention-audit"
readonly X_HANDLE="@NonyMaxime"
readonly WAITLIST_URL="https://mynudge.app/?utm_source=attention-audit&utm_medium=script&utm_campaign=card#waitlist"
readonly CTA="Want to know what your numbers mean + early access to Nudge?"
readonly MODE="${1:-}"

if [[ "$MODE" == "--ask" ]]; then
    answer=$(osascript -e "button returned of (display dialog \"7 days logged. Your attention card is ready.\" with title \"Nudge · Attention audit\" buttons {\"Later\", \"Show my card\"} default button \"Show my card\" with icon POSIX file \"${ICON}\")" 2>/dev/null || echo "Later")
    if [[ "$answer" != "Show my card" ]]; then
        exit 1
    fi
fi

if ! output=$(osascript -l JavaScript "${SCRIPT_DIR}/card.js" "$DATA_DIR" "$CARD" 2>&1); then
    message="${output##*Error: }"
    echo "$message" >&2
    if [[ ! -t 1 ]]; then
        osascript -e "display alert \"Nudge · Attention audit\" message \"${message//\"/}\"" >/dev/null 2>&1 || true
    fi
    exit 1
fi

summary=$(tail -n 1 <<< "$output")
echo "${output%$'\n'*}"
echo
echo "card saved to $CARD"
echo
echo "$CTA"
echo "$WAITLIST_URL"

[[ "$MODE" == "--no-share" ]] && exit 0

field() {
    sed -E "s/.*\"$1\":\"?([^\",}]*)\"?.*/\1/" <<< "$summary"
}

post="my attention audit, $(field days) days on my mac:

$(field perDay) app switches a day. median focus stretch: $(field median).

check yours: ${REPO_URL} via ${X_HANDLE}"

encoded=$(osascript -l JavaScript -e 'function run(argv) { return encodeURIComponent(argv[0]) }' "$post")

open "$CARD"
open "https://x.com/intent/post?text=${encoded}"

# Asked once, after the card: by then they have seen their numbers.
marker="${DATA_DIR}/.waitlist_asked"
if [[ ! -f "$marker" ]]; then
    touch "$marker"
    join=$(osascript -e "button returned of (display dialog \"${CTA}\" with title \"Nudge · Attention audit\" buttons {\"No thanks\", \"Join the waitlist\"} default button \"Join the waitlist\" with icon POSIX file \"${ICON}\")" 2>/dev/null || echo "No thanks")
    if [[ "$join" == "Join the waitlist" ]]; then
        open "$WAITLIST_URL"
    fi
fi
