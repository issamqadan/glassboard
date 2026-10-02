---
name: site-map-and-beginner-journey
description: "The Glassboard page map + the zero-knowledge beginner journey (link→Learn→Play), and where each concern lives"
metadata: 
  node_type: memory
  type: project
  originSessionId: c65ecd65-db19-49ae-aedc-6cff58478ed3
  modified: 2026-09-29T23:11:32.677Z
---

Built 2026-09-28 to make a total beginner (Issam's wife, no chess) go link → learn →
play a full game → want more — i.e. the POC exit criterion in human form.

**Pages (all share `web/nav.js`, the single nav source of truth):**
- `portal.html` — the LOBBY. Hero CTA reframed to the beginner path: primary "👋 New to
  chess? Learn to play" (→ learn.html), then Play-AI and "New game — invite a friend".
  Removed day-1 dev cruft: the "Practice both sides" sim link; the "🧪 Test opponent"
  card button now shows only with `?test`/`?dev` (const `DEV`). Footer links Learn/Help/Forum.
- `learn.html` — from-ZERO curriculum (was just a level-finder). "I've never played" →
  new `s-goal` step ("How chess works": checkmate / capturing / you're-never-stuck) →
  piece tutorial → result → `finish()` routes beginners into a guided first game
  (`index.html?first=1`, full help), others into Play-AI. "Skip to playing" → index.html.
- `help.html` — how to USE Glassboard (NOT how to play chess): the Lens, help modes,
  how-much-help, symmetric AI scaling, glass-box record, strategies, ways to play.
- `forum.html` — feedback + questions wall. Backed by the EXISTING server `/feedback`
  (GET list / POST) — posts tagged `mode:"forum:<kind>"` so they never muddy the
  playtest fun/fair gate. End-of-game fun/fair capture already lives in `web/feedback.js`.
- `index.html` (Play AI), `multiplayer.html`, `strategy.html` (library), `twoplayer.html`.

**Nav (`nav.js`):** items Lobby · Play AI · Learn · Strategies (all tabs) + Help · Forum
(`topOnly:true` — desktop top bar + lobby footer, kept off the mobile bottom tabs to stay
lean). Server base: `https://playglassboard.onrender.com` on https, `:9001` on http.

**In-game move explanations (`web/main.js`):** `moveMeaning(m)` gives a beginner one plain
clause ("Wins their knight", "Defends your bishop", "Puts the king in check", "Develops…",
"Checkmate 🏆") — computed from the real post-move board via a clone + `inCheck()` +
`pieceAttacks()` geometry, so protect/attack claims are true. 💡 toggle in the Lens
(`explainMoves`, persisted `gb_explain`, default ON). Ties to [[game-ux-doctrine]] and
[[fun-over-clever]].

**Offline / PWA (2026-09-29, commit dc4741a):** Play-AI works fully offline (planes) —
the engine (Rust WASM) + Stockfish run on-device; only save/sync uses the server, which
no-ops offline (games persist to localStorage). `web/sw.js` is a service worker that
precaches the whole Play-AI app and serves cache-first with `ignoreSearch` (so ?v=<sha>
URLs hit cache); cache name = `gb-<deploySha>` (pages.yml stamps `__GBVER__` into sw.js),
so a new online deploy refreshes it. `manifest.webmanifest` + `icon.svg` make it
installable (Add to Home Screen). Registered from index.html + portal.html with
`updateViaCache:"none"`. version.txt stays network-first so the auto-updater still works.
To prep offline: open the Play-AI page once online (loads/caches everything), then it
plays with no signal.

**Play score + strength + admin (2026-09-30, commits 70810ed + f829247):** Total play
score = 💪 Self (moves found alone) + 🤝 Assist (moves taken with help), per-game +
lifetime, with a light ≈Elo strength tracker. Client: `computeGamePoints()` /
`scoreFinishedGame()` in `web/main.js` (localStorage `gb_score`, `scored` guard, reset
per game); shown in the ✨ Recap and the Lobby "Your play" score card. Server (Phase B):
`scores` + `results` tables, `POST /score` (client posts per-game deltas, server sums),
`GET /admin?key=…` gated by the **ADMIN_KEY** env var — leaderboard, per-level win-rate
+ avg accuracy (validates AI calibration), top openings, recent games. Admin UI =
`web/admin.html` (noindex, password-gated). **Render auto-deploys from GitHub on push
to main** (confirmed 2026-09-30 — server code changes go live automatically); the one
manual step is setting `ADMIN_KEY` in the Render service env for the admin dashboard.

The server (`server/src/main.rs`, Rust/axum on Render, Neon Postgres) auto-deploys from
GitHub on push to main; new `CREATE TABLE IF NOT EXISTS` tables self-create on boot.
