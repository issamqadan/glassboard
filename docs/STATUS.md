# Status — where Glassboard stands

> Running context log so any session can pick up instantly. Newest at top.
> **Last updated:** 2026-09-04

## Snapshot

**Glassboard** — *"Chess, in the open."* A chess platform where AI assistance is
a first-class, transparent, adjustable handicap between unequal players. See
[VISION.md](VISION.md) (the anchor) and [ARCHITECTURE.md](ARCHITECTURE.md).

Repo: https://github.com/issamqadan/glassboard · Stack: Rust core (→ WASM +
native), Python/PyTorch training (later), thin web shell first.

## Done

- ✅ **Vision, name, governing docs** — VISION.md, CLAUDE.md, ARCHITECTURE.md;
  `vision-check` skill live.
- ✅ **M0 — engine core**: board, FEN, legal move generation. Perft-verified to
  119,060,324 nodes (startpos d6) across all six canonical positions.
- ✅ **M1 — search + eval**: negamax alpha-beta + quiescence + MVV-LVA +
  iterative deepening; material + piece-square tables. Finds mates, wins
  material, detects checkmate/stalemate. (`core/engine`)
- ✅ **Milestone A — terminal CLI**: `core/engine/src/bin/play.rs`
  (human-vs-engine + self-play).
- ✅ **M2 — web shell (WASM), build + serve working**: `core/bindings`
  (wasm-bindgen `Game` API) + `web/` (vanilla HTML/CSS/JS board). Builds with
  wasm-pack, serves via python http.server. 4 native API tests pass.
- ✅ **M3 — assistance layer + glass-box (engine-side)**: `core/assist` — the
  assistance spectrum (`analyze`: awareness / coaching / suggestion / guided /
  autopilot), the Assistance-Handicap seed (`recommended_level`, gap → rung,
  monotonic, `Off` at parity), and the transparent `GlassBox` log. All help
  flows through `analyze` + `GlassBox::record` — no hidden help by construction.
  UI wiring is the follow-up.

**Tests:** 22 green — 7 perft, 5 tactics, 4 WASM API, 6 assist
(`cd core && cargo test`; deep perft: `cargo test --release -- --ignored`).

## Next session — resume here

1. **Verify M2 in a real browser** (no browser extension was available this
   session). Run the two commands below, open the page, play a game end to end.
2. Optional M2 polish: last-move highlight, promotion picker UI (currently a
   `prompt`), move list, flip board.
3. **Wire assistance into the UIs**: surface `analyze` output + the glass-box
   in the CLI and web shell — the both-sides-visible transparency panel; add a
   `Matched`-mode game loop that applies `recommended_level` from both ratings.
4. **M4 — neural eval + calibration**: train a net (Python/PyTorch), infer in
   Rust; the `assist-calibrate` skill replaces the seed `recommended_level`
   thresholds with a *measured* effective-Elo mapping.

## How to run

Play in terminal:
```sh
cd core && cargo run --release -p glassboard-engine --bin play -- play 4 white
```

Play in browser:
```sh
cd core/bindings && wasm-pack build --target web --out-dir ../../web/pkg
cd ../../web && python3 -m http.server 8000   # then open http://localhost:8000
```

## Toolchain notes

- Installed: Rust 1.98.1, `wasm32-unknown-unknown` target, wasm-pack 0.15.0.
- `cargo` on PATH via `~/.zshrc` (`. "$HOME/.cargo/env"`).
- **Not** installed: Node/npm (intentionally — the M2 shell is Node-free). Only
  needed if/when we move to a React/Vite shell.
- Git remote uses SSH (`git@github.com:issamqadan/glassboard.git`).
