#!/bin/bash
set -euo pipefail

# Description: Installs the attention audit for the current user:
#              - copies the scripts to ~/.attention-audit
#              - starts the logger in the background at login (LaunchAgent)
#              - adds "Attention Card.app" to ~/Applications
#              No sudo, no permission prompt, nothing leaves your Mac.
# Usage: curl -fsSL https://raw.githubusercontent.com/M4XGO/attention-audit/main/install.sh | bash
#        ~/.attention-audit/install.sh uninstall
# Dependencies: curl, tar, launchctl, osacompile, codesign (all macOS built-ins)

readonly INSTALL_DIR="${HOME}/.attention-audit"
readonly LABEL="com.m4xgo.attention-audit"
readonly PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
readonly APP="${HOME}/Applications/Attention Card.app"
readonly TARBALL="https://github.com/M4XGO/attention-audit/archive/refs/heads/main.tar.gz"
readonly FILES=(audit.sh card.sh card.js install.sh)

stop_agent() {
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
}

uninstall() {
    stop_agent
    rm -f "$PLIST"
    rm -rf "$APP"
    echo "stopped the logger and removed Attention Card.app."
    echo "your data is still in ${INSTALL_DIR}/data. delete it with: rm -rf ${INSTALL_DIR}"
}

fetch_files() {
    local tmp
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' RETURN
    curl -fsSL "$TARBALL" | tar -xz -C "$tmp" --strip-components 1
    mkdir -p "${INSTALL_DIR}/data"
    for f in "${FILES[@]}"; do
        cp "${tmp}/${f}" "${INSTALL_DIR}/${f}"
    done
    mkdir -p "${INSTALL_DIR}/assets"
    cp -R "${tmp}/assets/." "${INSTALL_DIR}/assets/"
    chmod +x "${INSTALL_DIR}"/*.sh
}

install_agent() {
    mkdir -p "$(dirname "$PLIST")"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${INSTALL_DIR}/audit.sh</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ProcessType</key><string>Background</string>
    <key>StandardOutPath</key><string>${INSTALL_DIR}/audit.log</string>
    <key>StandardErrorPath</key><string>${INSTALL_DIR}/audit.log</string>
</dict>
</plist>
EOF
    stop_agent
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
}

install_app() {
    mkdir -p "$(dirname "$APP")"
    rm -rf "$APP"
    osacompile -o "$APP" -e "do shell script quoted form of \"${INSTALL_DIR}/card.sh\" & \" > /dev/null 2>&1 &\""
    # Swapping the icon breaks osacompile's ad-hoc signature, so sign again.
    cp "${INSTALL_DIR}/assets/nudge.icns" "${APP}/Contents/Resources/applet.icns"
    codesign --force --sign - "$APP" >/dev/null 2>&1 || true
    touch "$APP"
}

if [[ "${1:-}" == "uninstall" ]]; then
    uninstall
    exit 0
fi

if [[ "$(uname)" != "Darwin" ]]; then
    echo "Error: this audit only runs on macOS" >&2
    exit 1
fi

echo "installing attention audit to ${INSTALL_DIR}"
fetch_files
install_agent
install_app

cat <<EOF

done. the audit is now running in the background, and starts again at login.

- in 7 days you get a prompt with your card
- want it earlier? open "Attention Card" from ~/Applications (or Spotlight)
- your data: ${INSTALL_DIR}/data (plain CSV, never leaves your mac)
- stop and remove: ${INSTALL_DIR}/install.sh uninstall
EOF
