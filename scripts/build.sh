#!/usr/bin/env bash
#
# Builds single-file kafka-tui executables via `bun build --compile`.
#
# Usage:
#   scripts/build.sh <target>   build one target
#   scripts/build.sh all        build every target below
#   scripts/build.sh list       print available target names
#
# @opentui/core ships its native library as per-platform optional npm
# packages (@opentui/core-darwin-arm64, @opentui/core-linux-x64, etc). A
# plain `bun install` only fetches the one matching your current machine —
# cross-compiling for any other platform needs that platform's package
# physically present in node_modules first, or `bun build --compile` fails
# at bundle time with "Could not resolve: @opentui/core-<platform>". This
# script always runs `bun install --os='*' --cpu='*'` first so every
# platform's native binary is on disk regardless of which target(s) you
# build — this does not touch package.json or bun.lock, it only affects
# what's materialized in node_modules.
#
# Written for bash 3.2 (macOS's stock /bin/bash) — no associative arrays.

set -euo pipefail
cd "$(dirname "$0")/.."

ENTRY="src/index.tsx"
OUT_DIR="dist"

BUN="${BUN:-bun}"
if ! command -v "$BUN" >/dev/null 2>&1; then
  if [ -x "$HOME/.bun/bin/bun" ]; then
    BUN="$HOME/.bun/bin/bun"
  else
    echo "error: bun not found on PATH or at ~/.bun/bin/bun. Set BUN=/path/to/bun to override." >&2
    exit 1
  fi
fi

# name|bun --target value|output filename (relative to OUT_DIR)
target_table() {
  cat <<'EOF'
darwin-arm64|bun-darwin-arm64|kafka-tui-darwin-arm64
darwin-x64|bun-darwin-x64|kafka-tui-darwin-x64
linux-x64|bun-linux-x64|kafka-tui-linux-x64
linux-x64-musl|bun-linux-x64-musl|kafka-tui-linux-x64-musl
linux-arm64|bun-linux-arm64|kafka-tui-linux-arm64
linux-arm64-musl|bun-linux-arm64-musl|kafka-tui-linux-arm64-musl
windows-x64|bun-windows-x64|kafka-tui-windows-x64.exe
windows-arm64|bun-windows-arm64|kafka-tui-windows-arm64.exe
EOF
}

usage() {
  echo "Usage: $0 <target|all|list>"
  echo
  echo "Targets:"
  target_table | cut -d'|' -f1 | sed 's/^/  /'
}

build_one() {
  local name="$1" line bun_target out_name
  line="$(target_table | grep -F "${name}|" || true)"
  if [ -z "$line" ]; then
    echo "error: unknown target '$name'. Run '$0 list' to see valid targets." >&2
    exit 1
  fi
  bun_target="$(echo "$line" | cut -d'|' -f2)"
  out_name="$(echo "$line" | cut -d'|' -f3)"

  echo "==> Building $name ($bun_target) -> $OUT_DIR/$out_name"
  "$BUN" build --compile --target="$bun_target" "$ENTRY" --outfile "$OUT_DIR/$out_name"
}

fetch_native_deps() {
  echo "==> Fetching every platform's native @opentui/core binary (node_modules only, no lockfile changes)..."
  "$BUN" install --os='*' --cpu='*'
}

cmd="${1:-}"
case "$cmd" in
  "")
    usage
    exit 1
    ;;
  -h|--help)
    usage
    ;;
  list)
    target_table | cut -d'|' -f1
    ;;
  all)
    mkdir -p "$OUT_DIR"
    fetch_native_deps
    while IFS='|' read -r name _ _; do
      build_one "$name"
    done <<EOF
$(target_table)
EOF
    echo "==> Done."
    ls -la "$OUT_DIR"
    ;;
  *)
    mkdir -p "$OUT_DIR"
    fetch_native_deps
    build_one "$cmd"
    ;;
esac
