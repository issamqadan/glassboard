#!/usr/bin/env bash
# Build the Glassboard web bundle: compile the Rust core to WebAssembly and
# stage the static site in ./web (which is what you publish to any static host).
set -euo pipefail

# Repo root (this script lives in scripts/).
cd "$(dirname "$0")/.."

# Make cargo available in non-login shells (rustup env), if present.
# shellcheck disable=SC1090
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"

echo "==> Building WASM core (core/bindings → web/pkg)"
( cd core/bindings && wasm-pack build --target web --out-dir ../../web/pkg )

echo ""
echo "==> Web bundle ready: ./web"
echo "    Publish the ./web directory to any static host (Cloudflare Pages, Netlify, …)."
echo "    Local preview:  (cd web && python3 -m http.server 8000)  → http://localhost:8000"
