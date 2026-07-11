#!/usr/bin/env bash
# One-command installer for the public GitHub repository.
# Usage: curl -fsSL https://raw.githubusercontent.com/LucasGazula/dont-waste/main/scripts/install-remote.sh | bash
set -euo pipefail

REPOSITORY="${DONT_WASTE_REPOSITORY:-LucasGazula/dont-waste}"
REF="${DONT_WASTE_REF:-main}"
PREFIX="${DONT_WASTE_PREFIX:-${HOME:-}/.local}"
INSTALL_ROOT="${DONT_WASTE_INSTALL_ROOT:-${XDG_DATA_HOME:-${HOME:-}/.local/share}/dont-waste-install}"
MARKER="$INSTALL_ROOT/.dont-waste-remote-install"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dont-waste-remote.XXXXXX")"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || die "Don’t Waste remote install requires curl."
command -v tar >/dev/null 2>&1 || die "Don’t Waste remote install requires tar."

ARCHIVE="$TMP_ROOT/dont-waste.tar.gz"
URL="https://codeload.github.com/${REPOSITORY}/tar.gz/refs/heads/${REF}"
printf 'Downloading Don’t Waste from %s\n' "$URL"
curl --fail --location --retry 3 --retry-delay 1 --silent --show-error "$URL" -o "$ARCHIVE"
tar -xzf "$ARCHIVE" -C "$TMP_ROOT"

SOURCE_ROOT="$(find "$TMP_ROOT" -mindepth 1 -maxdepth 1 -type d -print -quit)"
[ -n "$SOURCE_ROOT" ] || die "The downloaded Don’t Waste archive was empty."

INSTALL_PARENT="$(dirname -- "$INSTALL_ROOT")"
mkdir -p "$INSTALL_PARENT"
if [ -e "$INSTALL_ROOT" ]; then
  [ -f "$MARKER" ] || die "Refusing to replace an unrecognised directory: $INSTALL_ROOT"
  rm -rf "$INSTALL_ROOT"
fi
mv "$SOURCE_ROOT" "$INSTALL_ROOT"
printf 'remote-install\nrepository=%s\nref=%s\n' "$REPOSITORY" "$REF" >"$MARKER"

printf 'Preparing dependencies and opening the setup UI…\n'
DONT_WASTE_PREFIX="$PREFIX" bash "$INSTALL_ROOT/scripts/install.sh"

SHIM="$PREFIX/bin/dont-waste"
[ -x "$SHIM" ] || die "The installer did not create $SHIM"
printf '\nInstallation complete. Launching Don’t Waste setup…\n'

# curl | bash consumes stdin; attach the real terminal so the TUI can receive input.
if [ -r /dev/tty ]; then
  exec "$SHIM" "$@" </dev/tty
fi
exec "$SHIM" "$@"
