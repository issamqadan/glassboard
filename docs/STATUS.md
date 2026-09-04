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
- ✅ **Matched-mode CLI** (`core/assist/src/bin/matched.rs`): assisted play with
  a live assistance panel + a both-sides-visible glass-box; the Autopilot rung
  auto-plays for a hands-free large-gap game. Makes M3 tangible in the terminal.
- ✅ **Assistance in the web shell**: `core/bindings` exposes `setRatings`,
  `assistLevel`, `assist` (JSON), and `glassbox` (JSON); `web/` renders a
  Matched-mode board with hanging-piece highlights, clickable candidate moves,
  and a live both-sides glass-box panel. Rebuild wasm to refresh: see web/README.

**Tests:** 23 green — 7 perft, 5 tactics, 6 assist, 5 WASM API
(`cd core && cargo test`; deep perft: `cargo test --release -- --ignored`).

## Next session — resume here

1. **Verify M2+M3 in a real browser** (no browser extension this session):
   rebuild wasm, serve, open the page, play a Matched game and watch the
   glass-box fill as you use help.
2. **Board visual polish** (user feedback 2026-09-04: "board not perfect — good
   start"): the web board renders but needs refinement — likely rank/file
   coordinate labels, better piece contrast on dark squares, square sizing /
   responsive layout, and a last-move highlight. Also: promotion picker UI
   (currently a `prompt`), an "autopilot: play recommended" button, move list,
   flip board.
3. **M4 — neural eval + calibration**: train a net (Python/PyTorch), infer in
   Rust; the `assist-calibrate` skill replaces the seed `recommended_level`
   thresholds with a *measured* effective-Elo mapping.

## How to run

Play in terminal:
```sh
cd core && cargo run --release -p glassboard-engine --bin play -- play 4 white
```

Play a Matched (assisted) game in terminal:
```sh
cd core && cargo run --release -p glassboard-assist --bin matched -- 1200 1700 3
# args: your_elo engine_elo depth [max_plies]. Large gaps → Autopilot self-plays.
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
