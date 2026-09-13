#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MIN_NODE_MAJOR=20
BIN_DIR="${HOME}/.local/bin"
CONFIG_DIR="${HOME}/.config/web-acquire"
TARGET="${BIN_DIR}/web-acquire"

fail() {
  printf 'install: %s\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail 'Node.js is required (Node >= 20).'
command -v pnpm >/dev/null 2>&1 || fail 'pnpm is required; install pnpm and run this script again.'

node -e "const major = Number(process.versions.node.split('.')[0]); if (major < ${MIN_NODE_MAJOR}) process.exit(1)" \
  || fail "Node.js ${MIN_NODE_MAJOR}+ is required (found $(node --version))."

printf 'Installing web-acquire from %s\n' "$ROOT"
cd -- "$ROOT"
pnpm install --frozen-lockfile
pnpm build
chmod +x "$ROOT/dist/cli.js"

umask 077
mkdir -p "$BIN_DIR" "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

if [[ -e "$TARGET" && ! -L "$TARGET" ]]; then
  fail "Refusing to replace existing non-symlink: $TARGET"
fi
ln -sfn "$ROOT/dist/cli.js" "$TARGET"

CONFIG_TEMPLATE="$CONFIG_DIR/.env.example"
if [[ ! -e "$CONFIG_DIR/.env" && ! -L "$CONFIG_DIR/.env" && ! -e "$CONFIG_TEMPLATE" ]]; then
  cat > "$CONFIG_TEMPLATE" <<'EOF'
# Bright Data credentials for web-acquire
BRIGHTDATA_API_TOKEN=
BRIGHTDATA_UNLOCKER_ZONE=
BRIGHTDATA_UNLOCKER_ENDPOINT=https://api.brightdata.com/request
EOF
  chmod 600 "$CONFIG_TEMPLATE"
fi

printf 'Installed: %s\n' "$TARGET"
printf 'Config: %s/.env\n' "$CONFIG_DIR"
if [[ ":${PATH}:" != *":${BIN_DIR}:"* ]]; then
  printf 'Add %s to PATH to run: web-acquire\n' "$BIN_DIR"
fi

"$TARGET" --help >/dev/null
printf 'Smoke check: %s --help passed\n' "$TARGET"
