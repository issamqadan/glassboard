# Status — where Glassboard stands

> Running context log so any session can pick up instantly. Newest at top.
> **Last updated:** 2026-09-15 · tag `v0.2.1`

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

**🟢 LIVE (2026-09-12, tag `v0.1.0`):** free online, no card, no domain.
- Client → GitHub Pages: https://issamqadan.github.io/glassboard/
  (one-player `/`, hotseat `/twoplayer.html`, online `/multiplayer.html`)
- Server → Render (axum, free tier): https://playglassboard.onrender.com
  (health/root prints the "connect via WebSocket" line — that's the backend, not
  the game). Free tier sleeps after ~15 min idle → ~30-60s cold start.

**📋 Alpha/beta plan (living):** [ROADMAP.md](ROADMAP.md) — the player portal
(create/invite/notify/dashboard + intro + what's-new), **strategy-level
assistance** (opponent-intent reads, named plans, plan-progress, move-in-plan),
the calibration mission, and a 4-phase build plan. Design concept published
2026-09-13.

## Done today (2026-09-14 → 15) — big push, tag `v0.2.0`

- ✅ **Onboarding & beginner-ready** (`web/learn.html`): interactive **"Find your
  level"** (piece tutorial for all 6 pieces, or 3 live puzzles → estimated
  rating); invite→onboarding→**returns to the game** with name+score filled;
  name required (no silent "Player").
- ✅ **Explained suggestions**: engine **SAN** (`core/engine/san.rs`) + assist
  plain-language **notes** ("Develops your knight", "Captures the bishop — wins
  material"); shown in the assist panel.
- ✅ **Beautiful board + theming**: clean **SVG piece set** (`web/pieces.js`,
  token-driven two-tone), framed board, selected-glow / move-dots / capture-rings
  / last-move / place-animation; **4 board themes** (Glass/Walnut/Emerald/
  Midnight) via a swatch switcher (`web/theme.js`), all CSS-token-driven.
- ✅ **Lobby**: live **board previews** of active games (+ whose-move + "started N
  ago"); shows games you **joined** (not just created); device-stable identity
  (one browser = one player; `?test=1` for two-in-one-browser); "Clear all".
- ✅ **Durable accounts on Neon** (LIVE): `POST /account` (name + 4-digit PIN →
  stable cross-device id) backed by Postgres when `DATABASE_URL` is set
  (`Store` in `server/src/main.rs`), in-memory otherwise. Verified in prod. Portal
  identity modal is now sign-in/create.
- ✅ **P3 strategy layer (layers 1–2), LIVE**: `core/assist/strategy.rs` — phase
  detection + fit-scored named-plan library (Win the loose piece · Develop &
  Castle · Seize the Centre · Attack the King · Simplify · Push the Passer),
  each with arrows+rings, step tracker, concrete move, + opponent-intent read.
  Exposed via WASM; **live Strategy panel** in `multiplayer.html`/`.js` that
  **draws the picked plan on the board** and relays it to the opponent
  (glass-box). Preview: `web/strategy.html`. **Shows when you're the assisted
  side (gap ≥ 500) on your turn.**
- ✅ **Force-assist testing toggle** (`v0.2.1`): `setAssistOverride` (bindings) +
  a "force" checkbox / `?assist=<rung>` in `multiplayer.html` to turn assistance
  on for the stronger side too — feel the strategy UX from either seat.
  Transparent (glass-boxed); a testing aid, **not** the fair default.

## Done (earlier)

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
- ✅ **Deployed LIVE, free (2026-09-12)**: client on GitHub Pages, server on
  **Render** (axum rewrite: HTTP health on `/` + reads host `PORT`). Online
  multiplayer works over the internet with no card and no domain. First playable
  public MVP — tagged **v0.1.0**.
- ✅ **Glass-box "visible to both", full game (2026-09-12)**: the server stores
  each room's glass-box history and replays it to anyone who joins, then keeps
  relaying live. Fixes the observed "a late-joining Black didn't see White's
  earlier help." (Room now has a `glass` log; 4 server tests.)

**Tests:** 27 green — 7 perft, 5 tactics, 6 assist, 5 WASM API, 4 server room
(`cd core && cargo test`; deep perft: `cargo test --release -- --ignored`).

## Next session — resume here

**Status:** P3 strategy layer (layers 1–2) is LIVE and playable. User is
**playing with it to gather feedback** (paused here 2026-09-15). Pick up with:

1. **Feedback pass on the live strategy layer** — the user is testing it. Likely
   tweaks: arrow styling/animation, strategy copy, which plans get offered,
   phase thresholds, offering fewer/more plans. (See `core/assist/strategy.rs` +
   `multiplayer.js` renderStrategy/drawPlan.)
2. **Layer-3 personalization → needs game-logging to Neon.** Record each finished
   game (players, moves, result, handicap used, plans followed) to Postgres —
   this is the calibration/personalization data pipeline AND makes games survive
   restarts. Extend `Store` in `server/src/main.rs` (a `games` table) + persist on
   game end. THE key next build for "learns about the player over time."
3. **Grow the named-plan library** + wire the strategy panel into the **AI page**
   (`index.html`/`main.js`) too (currently multiplayer only).
4. **Rotate the Neon DB password** (shared in chat during setup) — Neon → reset
   password → update `DATABASE_URL` on Render.
5. **Multiplayer polish** (still open): rematch button, promotion picker (a
   `prompt` today), reconnect, friendlier "server waking up…" cold-start state.
6. **M4/P4 — measured calibration**: neural eval + `assist-calibrate` to replace
   the seed `recommended_level` thresholds with a measured effective-Elo mapping
   (feeds off the logged games from #2).

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
