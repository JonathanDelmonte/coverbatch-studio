#!/bin/bash
# __NAME__ for macOS: starts the local engine and opens the program's window.
# The bundle's main executable (Contents/MacOS). scripts/package-macos.js fills in
# the name; the engine, the interface and the runtimes live in Contents/Resources.
set -u
# A Finder launch gets this PATH anyway; tests put their stand-ins for open,
# sysctl, xattr and osascript first.
export PATH="${COVERBATCH_TEST_BIN:+$COVERBATCH_TEST_BIN:}/usr/bin:/bin:/usr/sbin:/sbin"

NAME="__NAME__"
CONTENTS="$(cd "$(dirname "$0")/.." && pwd -P)"
APP="$(dirname "$CONTENTS")"
RES="$CONTENTS/Resources"
SUPPORT="$HOME/Library/Application Support/$NAME"
LOG="$SUPPORT/registro.txt"

# Messages go through a native dialog: the app has no window of its own.
say() {
  osascript - "$1" "$NAME" >/dev/null 2>&1 <<'APPLESCRIPT'
on run argv
  activate
  display dialog (item 1 of argv) with title (item 2 of argv) buttons {"OK"} default button 1 with icon caution
end run
APPLESCRIPT
}

# Opened straight from Downloads, macOS runs a read-only copy from a random folder
# ("App Translocation"). Moved to Applications, the app keeps a fixed home.
case "$APP" in
  */AppTranslocation/*)
    say "Antes de abrir, arraste o $NAME para a pasta Aplicativos (Applications). Depois, abra-o de lá."
    exit 0 ;;
esac

# Downloaded files carry Apple's quarantine mark. The person has already allowed
# this app to open, so the engine and the image libraries inside it are cleared
# too; otherwise macOS would ask again for each of them.
xattr -dr com.apple.quarantine "$APP" 2>/dev/null

# Apple silicon or Intel: the bundle carries the official Node.js for both.
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then NODE="$RES/runtime/node-arm64"; else NODE="$RES/runtime/node-x64"; fi
if [ ! -x "$NODE" ] || [ ! -f "$RES/app/scripts/launcher.js" ]; then
  say "Faltam arquivos do $NAME. Baixe o programa de novo e substitua o que está na pasta Aplicativos."
  exit 1
fi

mkdir -p "$SUPPORT" || { say "Não foi possível criar a pasta de dados em $SUPPORT."; exit 1; }
# One log for every launch, appended; only what this launch writes is read below.
if [ -f "$LOG" ] && [ "$(($(wc -c < "$LOG")))" -gt 1000000 ]; then mv -f "$LOG" "$SUPPORT/registro-anterior.txt"; fi
echo "--- $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG"
OFFSET=$(($(wc -c < "$LOG")))
PROFILE=""
[ -d "$RES/perfil" ] && PROFILE="$RES/perfil"

# The engine outlives this script: with COVERBATCH_DETACH it moves to a session of
# its own and stops by itself a few seconds after the last window closes. Each
# click on the app runs this script again, which finds the engine already running
# and opens one more window.
cd "$RES/app" || exit 1
COVERBATCH_DATA_DIR="$SUPPORT/dados" COVERBATCH_PROFILE_DIR="$PROFILE" COVERBATCH_LIFETIME=window COVERBATCH_DETACH=1 NODE_OPTIONS= \
  "$NODE" "$RES/app/scripts/launcher.js" --no-browser </dev/null >>"$LOG" 2>&1 &

# Only what this launch wrote counts: the address, or a reason it failed.
since() { tail -c +"$((OFFSET + 1))" "$LOG" 2>/dev/null; }
URL=""
for _ in $(seq 1 300); do
  URL="$(since | grep -Eo 'http://127\.0\.0\.1:[0-9]+' | head -n 1)"
  [ -n "$URL" ] && break
  since | grep -Eq 'Não foi possível abrir|Error|Bad CPU|cannot execute|Permission denied|Killed' && break
  sleep 0.2
done
if [ -z "$URL" ]; then
  say "O $NAME não conseguiu abrir.

$(since | tail -n 6)"
  exit 1
fi

# The interface in a window of its own (Chrome, Edge or Brave in app mode), with a
# browser profile kept apart from the person's; otherwise the default browser.
for BROWSER in "Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium"; do
  for DIR in "/Applications" "$HOME/Applications"; do
    if [ -d "$DIR/$BROWSER.app" ]; then
      open -na "$DIR/$BROWSER.app" --args --app="$URL" --user-data-dir="$SUPPORT/janela" \
        --no-first-run --no-default-browser-check --disable-extensions --window-size=1400,920 && exit 0
    fi
  done
done
open "$URL"
