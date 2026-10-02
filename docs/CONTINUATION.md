# CONTINUATION — read this first to pick up work on any machine

> **Purpose:** This repo is worked on with Claude Code across multiple Macs. Claude's
> own memory + session transcript live in `~/.claude/` (machine-local) and do **NOT**
> travel with a `git clone`. This file + `docs/agent-memory/` carry everything a fresh
> Claude session needs to continue exactly where the last one left off.
>
> **Last updated:** 2026-10-02.

## 0. First actions for a new session
1. Read **`CLAUDE.md`** (operating agreement) and **`docs/VISION.md`** (the anchor).
2. Read every file in **`docs/agent-memory/`** — these are the carried-over memories
   (user profile, feedback doctrines, project decisions, gotchas). Treat them the way
   you'd treat recalled memory: point-in-time, verify against current code before
   asserting. `docs/agent-memory/MEMORY.md` is the index.
3. Skim this file's **Workflow** and **State** sections below.
4. If anything here is stale vs the code, fix the code understanding first, then update
   this file.

## 1. What this is
**Glassboard** — "Chess, in the open." Online chess where AI assistance is transparent,
adjustable, and symmetric. Portable Rust core → WASM (web) + native; thin TS/HTML shells.
- **Live site:** https://issamqadan.github.io/glassboard/ (GitHub Pages)
- **Admin:** https://issamqadan.github.io/glassboard/admin.html (password = `ADMIN_KEY` env on Render)
- **Server:** https://playglassboard.onrender.com (Rust/axum, Neon Postgres)
- **Repo:** https://github.com/issamqadan/glassboard

## 2. Layout
```
core/      Rust: engine (rules/search/eval) + assist (assistance, strategy.rs) + bindings (WASM, lib.rs)
web/       Client: main.js (Play-AI), multiplayer.js, strategies.js, sf.js (Stockfish), portal/learn/help/forum/strategy/admin .html, nav.js, sw.js (offline)
server/    Rust/axum multiplayer + accounts + scores/admin (src/main.rs, src/room.rs)
docs/      VISION.md (anchor), ARCHITECTURE.md, ROADMAP.md, STATUS.md, GAME-UX.md, POC.md, reviews/, agent-memory/
```

## 3. Toolchain to install on a new Mac
- **Rust** via rustup + wasm target: `rustup target add wasm32-unknown-unknown`. `cargo` lives at `~/.cargo/bin/cargo` (not always on PATH — call it by full path).
- **wasm-pack** (the CI installs it; local builds need it): `cargo install wasm-pack` or the installer.
- **jsc** (JavaScriptCore) — ships with macOS at
  `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc`. Used to
  syntax-check JS before committing (there's no node assumed).
- **gh** CLI for GitHub ops. Git push rights to the repo + Render access for the server.

## 4. The dev + deploy loop (how work actually ships)
**Validate before committing:**
- JS: `jsc -e "checkSyntax('web/FILE.js')"`. For `main.js` (ESM import), strip import/export first:
  `grep -vE '^\s*(import |export )' web/main.js | sed 's/import\.meta\.url/"x"/g' > /tmp/c.js` then checkSyntax it.
  For inline `<script>` in an HTML page: `awk '/<script>/{f=1;next} /<\/script>/{f=0} f' web/PAGE.html > /tmp/p.js` then checkSyntax.
- Rust: `cd core && ~/.cargo/bin/cargo build` (and `cargo test -p glassboard-assist` for strategy/assist changes).
- Server: `cd server && ~/.cargo/bin/cargo build`.

**Deploy = push to `main`.** Two independent CI targets auto-deploy:
- **GitHub Pages** (`.github/workflows/pages.yml`): rebuilds WASM via wasm-pack, cache-busts every
  asset URL with the commit SHA, stamps `__GBVER__`→SHA (in `*.html` + `sw.js`), and writes
  `web/version.txt` = the 8-char SHA. **Confirm a web deploy landed** by polling until the live
  marker equals your SHA:
  `SHA=$(git rev-parse --short=8 HEAD); curl -fsS "https://issamqadan.github.io/glassboard/version.txt?ts=$RANDOM"` → compare.
- **Render** (server/): auto-deploys from GitHub on push. `CREATE TABLE IF NOT EXISTS` tables self-create on boot. The only manual env is **`ADMIN_KEY`** (admin dashboard password). Confirm with
  `curl https://playglassboard.onrender.com/` (root) or `/admin?key=nope` (should say unauthorized).

**Cache:** every HTML page has a `gb-version` meta + an inline auto-updater that reloads a stale tab
once; so after a deploy, open tabs self-refresh. `sw.js` precaches the app for **offline** play.

**Commit footer** (end every commit message with):
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_<current>
```
(The session id changes per machine/session — it's informational, not load-bearing.)

## 5. Guardrails (from CLAUDE.md / VISION — never violate)
1. No hidden help — any assistance is visible to the opponent, built both-sides in the same change.
2. Defaults protect fairness; extra control is earned.
3. Strength is **measured, not assumed** (perft, tests, self-play) — no unmeasured strength claims.
4. Assistance is a ladder down (help players need less over time).

## 6. Current state (2026-10-02) — what's live
The POC "beginner journey + fun" phase is deep in. Recently shipped (all live):
- **Play-AI strength model:** following the top move **wins at every level** (opponent capped
  below the skill-20 assist; see `docs/agent-memory/strength-and-handicap-model.md`). Opponent
  **styles** (Balanced/Aggressive/Positional/Defensive/Wildcard), **resign + insufficient-material**
  draw, honest clock (pauses when tab hidden), undo only in untimed/casual.
- **Strategy system:** named openings (112) + middlegame/endgame **plans**, categorized by
  phase/family/complexity/**side (W/B)**; in-game identity strip + **proactive "💡 Try" recommendation**
  + Plans picker + follow-the-book (sound-gated).
- **Beginner journey:** cleaned lobby, Learn curriculum → guided first game, in-game move
  **explanations**, promotion teaching, coordinates in Learn, **first-time welcome** (replayable from
  the account modal), Help + Forum pages.
- **Drag-to-move** pieces (pointer events, spring+tilt physics, touch finger-offset) + optional
  **move sounds** (Web Audio). Tap-to-move preserved.
- **Play score & strength:** Total = 💪 Self + 🤝 Assist, ≈Elo tracker, shown in the ✨ Game Recap
  (persona, accuracy, momentum sparkline, badges, share) and Lobby. **Server-backed** (`/score`) +
  **admin dashboard** (leaderboard, per-level win-rate = calibration, openings, recent games,
  **page-hit traffic**).
- **Offline/PWA** (`sw.js` + manifest), self-updater on every page.

**Postponed (user's call), not built:** #1 social login (Apple/Google OAuth — needs their dev
accounts + Render secrets), #6 Web Push notifications (needs VAPID keys + Render + install).

**The POC exit gate** is still a real unequal-pair playtest (beginner + stronger, both say
fun+fair) — see `docs/POC.md`. The family playtests are that gate in motion.

## 7. Keeping this portable (do this every session)
When you commit meaningful work, also:
- Update this file's **State** section if the picture changed.
- Re-copy the memory so the repo stays in sync:
  `cp ~/.claude/projects/-Users-issamqadan-chessAI/memory/*.md docs/agent-memory/`
- Commit both with the code so a clone on another Mac has the full context.
