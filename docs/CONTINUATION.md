# CONTINUATION — read this first to pick up work on any machine

> **Purpose:** This repo is worked on with Claude Code across multiple Macs. Claude's
> own memory + session transcript live in `~/.claude/` (machine-local) and do **NOT**
> travel with a `git clone`. This file + `docs/agent-memory/` carry everything a fresh
> Claude session needs to continue exactly where the last one left off.
>
> **Last updated:** 2026-10-07.

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
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_<current>
```
(The session id changes per machine/session — it's informational, not load-bearing.)

## 5. Guardrails (from CLAUDE.md / VISION — never violate)
1. No hidden help — any assistance is visible to the opponent, built both-sides in the same change.
2. Defaults protect fairness; extra control is earned.
3. Strength is **measured, not assumed** (perft, tests, self-play) — no unmeasured strength claims.
4. Assistance is a ladder down (help players need less over time).

## 6. Current state (2026-10-06) — what's live
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

- **Earned rating (2026-10-03, `web/rating.js`):** 💪 chip always on in Play-AI + Lobby; *earned, not
  self-declared* — Unrated until 3 placement games. Every human move is measured (cp-loss at fixed
  depth 4, regardless of help setting); help-followed moves excluded; result weighted by independence;
  <6 own moves → game not rated. Once rated, the earned number drives handicaps (Play-AI humanElo,
  multiplayer join, Lobby create) and the typed fields lock. Celebrations: placed / tier-up / personal
  best / zero-help win (confetti + chime if sounds on). ACPL→rating curve is an ≈ seed — calibrate
  against admin data (P4). Human-vs-human games don't feed it yet (multiplayer needs per-move scoring).
- **Drag physics (2026-10-03):** spring+lift pickup, FLIP landing from the drop point, snap-back on
  illegal drop; touch never selects page text. Ghost CSS must be `.piece.drag-ghost` (specificity!).
- **Physical move sounds (2026-10-03):** synthesized wood click+knock+body+thump in `playSound`
  (main.js); played from `animateLastMove` timed to touch-down (via `moveSound`); drop speed →
  intensity; capture/castle/snap-back/lift variants; tap-to-move now has sound. Needs on-device tuning.
- **Git remote is SSH** (`git@github.com:issamqadan/glassboard.git`) — HTTPS has no stored creds.

- **AI↔HUMAN PARITY (2026-10-03) — the new priority.** Audit found 12 of 14 gameplay features were
  Play-AI-only (`main.js`) and MISSING from human games (`multiplayer.js`): Glass Lens, identity strip,
  proactive strategy rec, Plans picker, follow-the-book, move explanations, Recap, play score, drag,
  sounds, board advice arrow, provenance move list. Since the POC proves a game between **two humans
  far apart in skill**, this gap blocks the exit gate. Decision: **extract-as-you-port into shared
  `web/gb-*.js` modules — never copy.** First module shipped: **`web/gb-assist-ui.js`**
  (moveMeaning / identity / identityRowHTML / bookNextMove, pure, takes an explicit ctx). main.js now
  delegates to it; multiplayer.js uses it for the identity strip + per-candidate "💡 what this does".
  See `docs/agent-memory/ai-human-parity-doctrine.md`.
- **PARITY PROGRESS (2026-10-04): 13 of 16 gameplay features now SHARED.** Modules:
  `gb-assist-ui.js` (moveMeaning, identity strip, always-on strategy strip, pickPriority
  ladder, adviceSVG, playerStripHTML, STRAT_VERB), `gb-sound.js` (wooden move sounds),
  `gb-board-input.js` (tap + physics drag, fully injected context). Human games now have:
  explanations, identity strip, opening awareness, sounds, strategy strip, Glass Lens,
  board arrow, "💡 Try" rec, Plans picker, follow-the-book, the COCKPIT (player strips
  with captured pieces), and drag-to-move.
  **PARITY COMPLETE (2026-10-04): 16 of 16.** `gb-recap.js` gave human games the
  ✨ Game Recap, and multiplayer now does per-move cp-loss scoring (`measureForRating`
  / `rateMoves`), which also unlocked the **earned rating in human games**. Recap rule
  (enforced by test): anything we did not measure is OMITTED, never invented.
- **POC priority stack:** P1 assistance surface in human games (criterion #2, in progress) → P2 recap+score,
  then drag+sounds in human games (criteria #1/#6) → P3 **run the unequal-pair playtest** (the gate).
  NOTE: calibrating rating/levels is **explicitly out of scope this phase** (POC.md says P4).

**Postponed (user's call), not built:** #1 social login (Apple/Google OAuth — needs their dev
accounts + Render secrets), #6 Web Push notifications (needs VAPID keys + Render + install).

- **STRATEGY AUTO-CAPTURE (2026-10-04, `web/gb-capture.js`).** Issam's idea: when something
  genuinely clever happens, Glassboard should NOTICE it, name it, and teach it back. Runs
  automatically at game end in **both** Play-AI and human games; saves to `localStorage gb_learned`
  (device-local, max 50) and registers via `GBStrategies.add()`. Detection is **key-move-centric**:
  it finds the moment a move left the opponent with ≤3 legal replies (counted with `countLegal`,
  not guessed) — NOT "biggest eval drop", which just finds whoever blundered hardest.
  **HONESTY RULE: only motifs verifiable on the board are claimed** (forced / defended /
  wins-material). Browsable under its own **🧠 Learned** chip + section on `strategy.html`,
  listed first; the demo replays from `demoFen` (the position it happened in), not move 1.
  *Known limitation:* one motif family only (forcing checks). Forks/pins/skewers/squeezes are
  invisible — **more rule-based detectors is the high-value next step, not an LLM.** Decided
  2026-10-04: detection must stay deterministic (guardrail #3 + offline play); if an LLM is ever
  added it may only re-word VERIFIED facts, never add a claim, with the template as fallback.
- **THE AI OPPONENT HAS A STABLE NAME (2026-10-04, `web/gb-ai-cast.js`).** The roster is shared
  by the board and the lobby, with `personaFor(id, style)` a **pure function of the game id** —
  same game, same opponent, every screen, after any reload. Two bugs this fixed: (1) `fetchAiGames`
  REPLACED instead of merged, wiping local-only `aiPersona`; (2) resume called `pickPersona()`
  (random), so pre-persona games were renamed on every load and the lobby could never agree with
  the board. There is no "Glassboard AI" fallback any more — a product is not an opponent.
  **Gotcha:** `GBStrategies.add()` used to push learned patterns into `OPENINGS`, but `identify()`
  assumes every entry has a `uci` line (learned entries carry `demoUci`) — that threw a TypeError
  on every identify() call. Learned entries now live in their own list and identify() skips
  line-less entries.

- **HUMAN-GAME FLOW, built 2026-10-06 (the three pieces Issam asked for).** Human games had
  no way to *find* an opponent and nothing to *agree* to; Play-AI had a 6-section setup card
  while humans had one modal. Now:
  1. **The Challenge Board** (`GET /open`, lobby section). `list_games` returns only games you
     already sit in, so a posted game was invisible and a personally-sent link was the ONLY way
     in — "Open invite" was just a default name string. Rooms now carry `want`
     ("any"|"stronger"|"near"|"teach") and `minutes`, persisted via ADD COLUMN IF NOT EXISTS.
     Cards state the consequence BEFORE you commit ("You'd be the lower-rated player: you get
     Guide, they play unassisted").
  2. **The Table** (`RoomState::table_open`, `web/multiplayer.html#tableCard`). Both players sign
     the same contract before move 1. **Enforced server-side** — a `move` is dropped while the
     table is open, so a stale client can't start a game its opponent never agreed to.
     `table_open()` also requires `last_uci.is_none()`, which is what keeps pre-Table games and
     post-restart reloads playable; ready flags are deliberately NOT persisted.
  3. **Mid-game mode change by consent** (ModeRequest→ModeAsk→ModeResponse→ModeSet, modelled on
     the takeback protocol). Either player may propose casual/match any time; only the opponent's
     yes applies it.
  All three verified against a real server with hand-written WebSocket clients (there's no
  `websockets` module on this Mac) — see the commits for the exact properties checked.
  **Gotchas found doing this (all fixed, all non-obvious):**
  • Pushing a glass entry only PERSISTS it — you must also `tx.send(ServerMsg::Glass{..})` or the
    change appears to both players only after a reload.
  • `table_open()` must NOT require the guest seat to be filled. It did, so with an empty seat the
    table counted as closed, the host could play move 1 while waiting, and `last_uci.is_some()`
    then kept the table shut forever — that game skipped the contract entirely.
  • Changing the terms at the table must VOID both signatures, or you're held to a contract you
    never read. (A mid-game change must NOT re-open the table; regression tested.)
  • In the invite/take URL, `he` is the **host's** rating (the page renders "<host> is rated <he>"
    and sizes the handicap preview from it) and `elo` is **yours**. Passing your own as `he` shows
    your number as your opponent's level.
  • `/open` drops challenges older than 7 days. The first real response already had two from three
    weeks earlier; a board of dead challenges means nothing.
  • Checked and FINE: multiplayer.js rewriting `gb_me` without its `id` is harmless — `/account`
    writes the server id into `gb_pid` and portal.html re-derives `me.id = playerId()` on load.
- **Casual now actually means unrated.** multiplayer.js recorded every finished game into the
  earned rating regardless of mode, while the create modal promised "no ratings" for casual —
  so casual games quietly moved 💪. Gated on `casualMode()`.
- **One ladder, finally.** The handicap rungs existed FOUR times (×2 in multiplayer.js, once in
  portal.html, nearly a fifth for the board) → `web/gb-terms.js` is now the only copy
  (`RUNGS`/`rungForGap`/`contract`/`previewForTaker`). They did agree (16/16 boundaries checked
  before extracting); the old `rungForGap` had a latent `Math.max(0,g)`-for-`Math.abs(g)` bug.
- **Capture Tray** (`GBAssistUI.capTrayHTML`). Captured pieces were implemented TWICE and
  differently (Play-AI emitted `.capg` unicode the cockpit CSS never styled; human games emitted
  SVG), and were the first thing clipped in the 38px `overflow:hidden` strip. One renderer,
  grouped with counts ("♟ 3"), name shrinks before trophies do, 340ms pop only when a count
  actually rises. **It shipped invisible once:** two rules sized `.pc-svg` at equal specificity
  and the later `width:100%` won — a percentage inside an auto-width parent collapses to zero.
  `scripts/check-board-stability.sh` now guards both halves of that.
- **Play-AI latency.** Stockfish `go` requests are serialized on one UCI channel and a superseded
  advice search was never stopped, so it held the channel for its full 1400ms and the opponent's
  reply queued behind dead work — moving FAST made the AI slower. `GBEngine.cancel(kind)` posts
  "stop"; kind-scoped so it can't kill the opponent's own search. Advice movetime now matches-or-
  beats the opponent instead of a flat 1400ms (fairness invariant tested 18/18; Master unchanged).
  Rust search is NOT the bottleneck — `core/engine/src/bin/searchbench.rs` measures depth 4 = 14ms,
  depth 5 = 35ms mean.
- **CI note:** the **"Deploy web"** workflow (Cloudflare) fails on EVERY push and always has —
  it's inert until the `CLOUDFLARE_*` secrets exist (documented in deploy-web.yml itself). The
  real deploy is **"Deploy to GitHub Pages"**. Don't chase the red X.

**Next up (proposed, user to pick):** (a) **P3 run the unequal-pair playtest — the POC exit gate**
(server has 3 verdicts but the only "match" row is a `u_probe` test; no real unequal pair yet),
(b) more capture detectors (fork/pin/skewer/sacrifice), (c) make the learned library follow the
ACCOUNT not the device (`gb_learned` is localStorage, so a capture on the phone is invisible on
the Mac), (d) multiplayer polish (rematch, promotion picker, reconnect), (e) rotate the Neon DB
password. Awaiting Issam's on-phone feedback on drag feel + sounds + rating chip.

**The POC exit gate** is still a real unequal-pair playtest (beginner + stronger, both say
fun+fair) — see `docs/POC.md`. The family playtests are that gate in motion.

## 7. Keeping this portable — AUTOMATIC (do this once per machine)

Context sync is no longer a discipline problem; a **git hook does it on every commit**.

**One-time, on each Mac after cloning:**
```sh
git config core.hooksPath .githooks
```

That's it. From then on, every `git commit` runs `scripts/sync-context.sh`, which:
- mirrors `~/.claude/projects/<slug>/memory/*.md` → `docs/agent-memory/`
  (it auto-detects the slug, which differs depending on where Claude was launched),
- stamps today's date into this file's **Last updated**,
- stages both so they ride along with the commit.

It never fails a commit, and quietly does nothing on a checkout with no local memory.

**Still worth doing by hand:** update §6 (current state) when the picture really
changes — the hook copies memories, it can't write your narrative.

<!-- superseded manual process, kept for reference -->
### (old) Keeping this portable (manual)
When you commit meaningful work, also:
- Update this file's **State** section if the picture changed.
- Re-copy the memory so the repo stays in sync:
  `cp ~/.claude/projects/<project-dir>/memory/*.md docs/agent-memory/` — `<project-dir>` is
  `-Users-issamqadan-chessAI-glassboard` when Claude is launched inside the repo (current convention),
  or `-Users-issamqadan-chessAI` if launched one level up.
- **On a new Mac, first seed local memory FROM the repo:** `mkdir -p` that dir, then
  `cp docs/agent-memory/*.md ~/.claude/projects/<project-dir>/memory/`. If `git push` asks for a
  username, the remote is HTTPS — switch: `git remote set-url origin git@github.com:issamqadan/glassboard.git`.
- Commit both with the code so a clone on another Mac has the full context.
