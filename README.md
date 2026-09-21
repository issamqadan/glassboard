# Glassboard — *Chess, in the open*

Chess where AI assistance is a **transparent, adjustable handicap** between unequal
players — a fair game for both, designed so the weaker player needs the help less over
time. Every bit of help one player receives is visible to their opponent. No hidden help,
ever.

Start with **[docs/VISION.md](docs/VISION.md)** (the founding document), then
**[CLAUDE.md](CLAUDE.md)** (how we work here) and **[docs/POC.md](docs/POC.md)** (what this
phase is proving).

## Architecture

**Portable Core + Thin Platform Shells** — full detail in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

- **Core (`core/`)** — Rust: the engine (`engine`), the assistance layer (`assist`), and the
  WASM bindings (`bindings` → `glassboard-wasm`). The core holds the rules, search, the
  assistance spectrum, and the glass-box log so behaviour is identical on every platform.
- **Web shell (`web/`)** — a thin TypeScript/JavaScript client over the WASM core
  (`web/pkg`, generated). Play-AI, online multiplayer, and a same-screen hotseat.
- **Server (`server/`)** — a small Rust/axum service (accounts, games, profiles) backed by
  Neon Postgres. The web client is static and deploys to GitHub Pages.

## Local development

**Recommended IDE: [VS Code](https://code.visualstudio.com/).** It handles the whole stack
in one window. Install:

- **rust-analyzer** — Rust intellisense, inline errors, test lenses for the core.
- **Even Better TOML** — `Cargo.toml` support.
- **Claude Code** extension — so Claude works right in the editor.

Prefer JetBrains? **RustRover** is a strong alternative for the Rust side.

### Prerequisites

- **Rust** (via [rustup](https://rustup.rs/)) with the `wasm32-unknown-unknown` target:
  `rustup target add wasm32-unknown-unknown`
- **[wasm-pack](https://rustwasm.github.io/wasm-pack/)** — builds the WASM bundle.
- **Python 3** — only for the local static preview server.

### Build & run the web app

```bash
# 1. Compile the Rust core to WebAssembly and stage it in web/pkg
bash scripts/build-web.sh

# 2. Serve the static site locally
cd web && python3 -m http.server 8000
# → open http://localhost:8000/portal.html
```

Re-run `scripts/build-web.sh` after any change under `core/`. Changes under `web/` (JS/CSS/
HTML) are picked up on refresh — no rebuild needed.

### Test the core

```bash
cd core
cargo test              # engine + assistance unit/integration tests
cargo test -p glassboard-assist   # just the assistance layer
```

Per the guardrails in CLAUDE.md, move-generation and assistance changes ship with a
correctness check (perft / unit tests) — no unmeasured strength or behaviour claims.

## Repository layout

```
core/        Rust: engine · assist · bindings (→ web/pkg)
web/         Static web client over the WASM core
server/      Rust/axum service (accounts, games) on Neon Postgres
docs/        VISION · ARCHITECTURE · POC · ROADMAP · GAME-UX
scripts/     build-web.sh and friends
```

Built in the open.
