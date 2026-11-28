#!/bin/sh
# Installs the `puck` CLI from the latest GitHub release of ZeshanGIT/puck.
#
#   curl -fsSL https://raw.githubusercontent.com/ZeshanGIT/puck/main/install.sh | sh
#
# macOS (Apple Silicon or Intel) and Linux x64. It downloads the binary for this machine, checks it
# against the release's SHA256SUMS, and puts it in ~/.local/bin (or PUCK_INSTALL_DIR).
#
# Options, as environment variables:
#   PUCK_INSTALL_DIR       where to put `puck` (default: ~/.local/bin)
#   PUCK_VERSION           a release tag such as v1.0.0-build.1180 (default: the latest release)
#   PUCK_INSTALL_BASE_URL  download from here instead of GitHub (testing; file:// works)
set -eu

REPO="ZeshanGIT/puck"
INSTALL_DIR="${PUCK_INSTALL_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*"; }
fail() { printf 'puck install: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is required"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin)
    # A shell running under Rosetta reports x86_64 on Apple Silicon; prefer the native binary.
    if [ "$arch" = "x86_64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
      arch="arm64"
    fi
    case "$arch" in
      arm64) asset="puck-darwin-arm64" ;;
      x86_64) asset="puck-darwin-x64" ;;
      *) fail "unsupported Mac architecture: $arch" ;;
    esac
    ;;
  Linux)
    case "$arch" in
      x86_64 | amd64) asset="puck-linux-x64" ;;
      *) fail "unsupported Linux architecture: $arch (only x64 builds are published)" ;;
    esac
    ;;
  *) fail "unsupported system: $os (macOS and Linux only)" ;;
esac

if [ -n "${PUCK_INSTALL_BASE_URL:-}" ]; then
  base="${PUCK_INSTALL_BASE_URL%/}"
elif [ -n "${PUCK_VERSION:-}" ]; then
  base="https://github.com/$REPO/releases/download/$PUCK_VERSION"
else
  base="https://github.com/$REPO/releases/latest/download"
fi

if command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
elif command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | awk '{print $1}'; }
else
  fail "shasum or sha256sum is required to check the download"
fi

tmp="$(mktemp -d "${TMPDIR:-/tmp}/puck-install.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT INT TERM

say "Downloading $asset from $base"
curl -fsSL "$base/$asset" -o "$tmp/$asset" || fail "could not download $base/$asset"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" || fail "could not download $base/SHA256SUMS"

expected="$(awk -v name="$asset" '$2 == name || $2 == "*" name {print $1}' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || fail "SHA256SUMS has no entry for $asset"
actual="$(sha256 "$tmp/$asset")"
[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset (expected $expected, got $actual); nothing was installed"
say "Checksum OK"

chmod 755 "$tmp/$asset"
mkdir -p "$INSTALL_DIR" || fail "could not create $INSTALL_DIR"
mv -f "$tmp/$asset" "$INSTALL_DIR/puck" || fail "could not write $INSTALL_DIR/puck (set PUCK_INSTALL_DIR to a folder you own)"

version="$("$INSTALL_DIR/puck" --version 2>/dev/null || true)"
say "Installed puck ${version:-} to $INSTALL_DIR/puck"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) say "Next: puck login" ;;
  *)
    case "${SHELL:-}" in
      */zsh) rc="$HOME/.zshrc" ;;
      */bash) rc="$HOME/.bash_profile" ;;
      *) rc="your shell's startup file" ;;
    esac
    say ""
    say "$INSTALL_DIR is not on your PATH. Add it, then open a new terminal:"
    say "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> $rc"
    say "Then: puck login"
    ;;
esac
