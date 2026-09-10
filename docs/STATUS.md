# Status — where Glassboard stands

> Running context log so any session can pick up instantly. Newest at top.
> **Last updated:** 2026-09-06

**Name/domain (parked 2026-09-06):** keeping **Glassboard** for now; a final
naming pass is deferred (ChatGPT floated descriptive "ChessLevel/LevelChess"
names — but LevelChess has an existing Play Store app + a for-sale .com, and
descriptive names are hard to own; recommendation was to keep the distinctive,
ownable Glassboard). `glassboard.gg` checked **available** (~$52/yr at Porkbun,
flat renewal) — NOT yet purchased. `.com/.ai/.app/.co/.org` all taken/for-sale.

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
- ✅ **Board polish (first pass)**: coordinate labels, crisp outlined pieces
  legible on any square, last-move highlight. (User confirmed the board looks
  good in Safari on 2026-09-05.)
- ✅ **2-player hotseat test** (`web/twoplayer.html` + `twoplayer.js`): two
  same-origin browser windows sync via BroadcastChannel (no server) — each picks
  a side, the weaker Elo is assisted, the stronger unassisted, and the glass-box
  is shared/identical in both windows. Board flips per role. Proves the core
  two-humans-with-a-handicap scenario locally. (Real online multiplayer across
  devices is still a future networking milestone.)
- ✅ **Deploy scaffolding (Path A, invite-only)**: `scripts/build-web.sh`
  (one-command WASM build → `web/` bundle), `docs/DEPLOY.md` (Cloudflare Pages +
  custom domain + Cloudflare Access invite gate), `.github/workflows/deploy-web.yml`
  (optional CI). Static, $0 backend — testers play the assisted vs-engine
  experience. Human-vs-human remote still needs the multiplayer server.
- ✅ **M5 — multiplayer (local / LAN)**: `server/` Rust WebSocket server with
  engine-validated rooms (server is authoritative — 3 room tests) + a glass-box
  relay ("visible to both" over the wire); `web/multiplayer.html` +
  `multiplayer.js` connect over WebSocket. Works locally and across the same
  Wi-Fi with **no host or domain**. Internet play needs the server deployed to a
  free host (Fly.io) — see docs/DEPLOY.md.

**Tests:** 26 green — 7 perft, 5 tactics, 6 assist, 5 WASM API, 3 server room
(`cd core && cargo test`; deep perft: `cargo test --release -- --ignored`).

## Next session — resume here

1. **Go live for internet testing** — all deploy files are in place:
   - Client → **GitHub Pages**: enable in repo Settings → Pages → Source =
     "GitHub Actions" (`.github/workflows/pages.yml`); URL
     `<user>.github.io/glassboard/`.
   - Server → **Fly.io**: `Dockerfile` + `fly.toml` ready — edit the app name,
     `fly deploy`, then put `wss://<name>.fly.dev` in the Online page's Server
     field. See docs/DEPLOY.md.
   Follow-ups: glass-box history for late joiners, reconnect handling, rematch.
2. **M4 — neural eval + calibration**: train a net (Python/PyTorch), infer in
   Rust; the `assist-calibrate` skill replaces the seed `recommended_level`
   thresholds with a *measured* effective-Elo mapping.
3. Optional web polish: promotion picker UI (currently a `prompt`), a move list,
   an "autopilot: play recommended" button, and sizing on small screens.

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

Two-player test (two windows, no server): open
http://localhost:8000/twoplayer.html in two Safari windows; pick White in one
and Black in the other. Weaker Elo is assisted; glass-box synced live.

## Toolchain notes

- Installed: Rust 1.98.1, `wasm32-unknown-unknown` target, wasm-pack 0.15.0.
- `cargo` on PATH via `~/.zshrc` (`. "$HOME/.cargo/env"`).
- **Not** installed: Node/npm (intentionally — the M2 shell is Node-free). Only
  needed if/when we move to a React/Vite shell.
- Git remote uses SSH (`git@github.com:issamqadan/glassboard.git`).
