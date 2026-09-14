# Roadmap — Glassboard alpha/beta

> **Living document — we evolve this.** The product plan for the alpha/beta phase:
> the player portal, the strategy-level assistance model, and the calibration
> mission. Must stay consistent with [VISION.md](VISION.md) and
> [ARCHITECTURE.md](ARCHITECTURE.md). Running status lives in [STATUS.md](STATUS.md).
>
> **Created:** 2026-09-13 · **Last updated:** 2026-09-13 · See the Changelog at the bottom.

---

## The alpha/beta mission

Two goals, together:

1. **Prove the product** — that two humans of *different* levels can have a genuinely
   competitive, fair, enjoyable game via a transparent AI handicap.
2. **Firm up the science** — turn the handicap from a hand-picked seed into a
   *measured* thing. Every real game is a data point (ratings, assistance used,
   outcome, plan execution) → we solve for what each assistance level is truly
   worth in Elo. **This is why the games dashboard is a data pipeline, not just UX.**

## Design concept (the reference UX)

Interactive concept (dark "glass-box" portal, live handicap visualizer,
create→invite→notify→dashboard, strategy-level assistance):
`https://claude.ai/code/artifact/c475b181-ffbd-4a62-926f-5d62c5554d0c`
It is real HTML/CSS — the starting point for the actual frontend.

## 1. The player portal (game lifecycle)

- **Intro / onboarding.** A first-run explainer: what Glassboard is, "chess in the
  open," and the assistance levels.
- **Create a game.** Initiator sets both levels → sees the computed handicap live →
  gets a **shareable invite link**.
- **Invite → join.** Opponent opens the link and joins.
- **Notify + active basket.** On join, the initiator is notified and the game shows
  as **Ready** in an **Active Games** indicator/basket.
- **Start-on-join.** A "Start game" moment that shows *how it works + the levels*
  before the first move (onboarding at the point of play).
- **Games dashboard.** **Active** games (with live status) + **Past** games (result,
  opponent, handicap used).
- **What's new / Evolving feed.** Communicates to players what's been added and how
  the game is evolving (alpha ethos — even the product's evolution is in the open).

## 2. Strategy-level assistance (the differentiator)

The assistance must be **chess-specific and strategic**, not generic move-spoon-feeding —
this is what makes the platform attractive to strong players (facing a human executing a
transparent *plan* is teaching, not cheating).

Evolved assistance spectrum (strategy-forward):

| Rung | What the assisted side receives |
|------|---------------------------------|
| **Off** | No assistance. |
| **Awareness** | Safety signals — hanging pieces, checks, the opponent's immediate threat. |
| **Coaching** | Plain-language reads of the position and **what the opponent is planning**. |
| **Strategy** | A **named strategy** to follow (e.g. minority attack, IQP play), with candidate moves that serve the plan. |
| **Guided** | A **step-by-step plan with progress tracking**, and the next move highlighted **as a step in that plan**. |
| **Autopilot** | The co-pilot **executes the plan** for the weaker side, in full view of the opponent. |

Strategy-level features (across the higher rungs):
- **Opponent-intent read** — infer the opponent's multi-step plan from their moves.
- **Named-strategy library** — recognizable plans (minority attack, IQP, minority
  defense, kingside pawn storm, blockade, …).
- **Plan tracker** — the assisted player's current plan, its steps, and progress.
- **Move-in-plan framing** — every recommended move labeled as a step of the plan.
- **All transparent** — the opponent sees the plan too.

**Capability note:** move-help comes from the existing engine (search + eval).
Strategy-level help is a *new capability* — a **strategy layer**: motif/plan detection,
opponent-plan inference, named-strategy library, and natural-language articulation. This is
where an **LLM + chess knowledge** genuinely earns its place (server-side; key as a secret).

## 3. Architecture decisions (alpha)

- **Identity:** device-based player ID + display name (localStorage). No passwords/accounts
  for alpha. (Revisit accounts for beta.)
- **Persistence:** a **free managed Postgres (Neon — free, no card)** for players, games,
  and the calibration log. (The current in-memory rooms don't survive restarts.)
- **Server:** extend the Rust WebSocket server (`server/`) with a small games API
  (create → link, my-games, join → notify) beside the live game socket. Game logic stays in
  the core.
- **Strategy layer:** start curated (a library of named plans + heuristic detection) + LLM
  articulation; calibrate from real games.

## 4. Phased build plan

| Phase | Scope | Needs |
|-------|-------|-------|
| **P1 — Lobby real** | Device identity; create/invite/join/notify; the concept as the real frontend. Runs on the existing WS server. | Frontend build; small server additions |
| **P1.5 — Onboarding & beginner-ready** (from real-game feedback 2026-09-14) | (1) friendly **level assessment** — "how well do you play?" → a rating — on both invite and join (a rating number means nothing to a non-player); (2) a **learn-to-play** intro for total beginners — piece names, how each piece moves, the goal; (3) **plain-language descriptions on every assistance suggestion** — readable move (SAN) + what it does ("Nf3 — develops a knight and guards e5"); (4) an **"How Glassboard works"** intro (the transparent handicap / assistance / glass-box). Unblocks inviting people who've never played. | engine SAN + heuristic move descriptions; UI/content |
| **P2 — Persistence + registration** | Neon Postgres; **lightweight registration** (claim a username + optional PIN → one durable identity + games list across devices); Active/Past dashboard; the calibration log (every game recorded). | DB + server API |
| **P3 — Strategy layer** | Beyond single moves: **compound / multi-step strategies** the assisted player follows (named-plan library + heuristic plan detection + a plan-progress tracker), **opponent-intent reads** that *alert when an opponent's move signals an upcoming plan*, and natural-language articulation (LLM). In-game strategic assistance panel. | Strategy engine + LLM (server-side) |
| **P4 — Calibration (M4)** | Neural eval for tunable strength; measure each rung's / plan's Elo value from alpha data; replace the seed handicap with a measured mapping. | Python/PyTorch + `assist-calibrate` |

## Open decisions

1. Accounts vs device-identity for **beta** (alpha = device).
2. Strategy library scope for P3 (which named plans first).
3. LLM provider/budget + caching strategy for strategic articulation.
4. Rating source: self-reported vs a Glassboard rating earned in-app.

## Status snapshot (see STATUS.md for detail)

Shipped: engine (M0/M1), assistance + glass-box (M3), online multiplayer **live & free**
(GitHub Pages + Render), glass-box visible-to-both. Tagged **v0.1.0**.
Next: **P1 — Lobby real** (this roadmap).

---

## Changelog

- **2026-09-15** — **Identity: staged plan (both).** Fixed onboarding-from-invite
  (return to the game with name+score, not the portal; name now required, no silent
  "Player"). Quick win shipped: **device-stable player id** (localStorage → one
  browser = one player across tabs; `?test=1` for two-in-one-browser testing) +
  a **"Clear all" games** control. Real **registration deferred to P2** (rides on
  Neon persistence — durable identity across devices).
- **2026-09-14** — **Beautiful board + theming.** Replaced Unicode glyphs with a
  clean SVG piece set (`web/pieces.js`, two-tone via CSS vars), framed the board
  with vignette/shadow, and added selected-glow / move-dots / capture-rings /
  last-move wash / place animation — all **token-driven**. Added a **board-theme
  switcher** (`web/theme.js`) with four skins (Glass/Walnut/Emerald/Midnight),
  each just a `--light/--dark` token override; choice persists per device. Proves
  the token architecture for future full theming. Also added **live board
  previews** of active games in the lobby (server `/games` now returns fen+turn).
- **2026-09-14** — **Onboarding pivot → interactive + board fixes.** The static
  learn page felt like a manual; rebuilt `web/learn.html` as an interactive
  **"Find your level"** flow — you make real moves and it *assesses skill from play*
  (beginner piece tutorial, or 3 live puzzles → estimated rating, saved to identity).
  Also fixed the game board: **squares now stay square** (explicit grid rows) and
  **white pieces render white** (forced a text symbol-font ahead of OS emoji, which
  was silently recoloring pieces). Shared `style.css` → fixes online/AI/2-player.
- **2026-09-14** — **P1.5 (1,2,3,5 done).** Shipped: (1) tap-a-level assessment;
  (2) learn-to-play + (5) "How Glassboard works" onboarding (`web/learn.html`);
  and (3) **explained suggestions** — engine now renders **SAN** (`san.rs`:
  `Nf3`/`exd5`/`O-O`/`Ra8#`, with tests) and the assist layer adds a plain-language
  **note** per candidate ("Develops your knight", "Captures the bishop — wins
  material", "Gives check"). Bindings + client show `San` + the note instead of
  raw coordinates. Remaining P1.5: none. Next: **P3 strategy layer**.
- **2026-09-14** — **Real-game feedback → P1.5 Onboarding & beginner-ready.**
  After playing a real game, five priorities captured: (1) friendly level
  assessment on invite/join, (2) a learn-to-play intro for total beginners
  (pieces + moves + goal), (3) plain-language descriptions on every assistance
  suggestion, (4) an "How Glassboard works" intro, and (5) **strategy-level
  assistance** — compound/multi-step plans + opponent-move alerts — made explicit
  in P3. Build order: P1.5 (unblocks inviting non-players) → P3 (strategy).
- **2026-09-13** — **P1: server game registry + join notification.** The server
  (axum) now persists games in memory with **identity-based seating** (host→White,
  guest→Black, keyed by player id, stable across reconnects) and exposes
  `POST /games` + `GET /games?player=` (with CORS). The game page sends the player
  id + name; the portal **registers each created game** and **polls** → fires a
  "X joined — game ready" toast and flips the card to **Ready** with the computed
  handicap. Closes P1's notification spec (#3). 5 server tests; endpoints
  curl-verified. **Pending user testing.**
- **2026-09-13** — **P1 polish 2 (join clarity):** the join match card now shows
  **both scores and explains the assistance from the gap** (e.g. "You 1400 vs
  Issam 1870 · gap 470 → you get **Coaching**: threats and the opponent's plan,
  explained. Shown to Issam too."). The joiner must set their **own** rating
  (empty + required; Join disabled until valid). Handles even/stronger-side/host
  states. **Pending: user testing** (feedback next session), then the server-side
  game registry (cross-portal join notification) to close P1.
- **2026-09-13** — **P1 polish (invite arrival + create):** the invite link now
  opens a **context-rich match card** on the game page — who invited you, their
  rating, a "how it works" intro, your rating → **live handicap preview**, and a
  **Join game** button (server/room tucked under "Advanced"). Create no longer
  asks the initiator to guess the opponent's rating — the **joiner enters their
  own rating while reading the intro** (the natural moment). Future: opponent
  rating becomes a lookup for registered players.
- **2026-09-13** — **P1 (Lobby) first cut** shipped: `web/portal.html` — device
  identity (name + rating in localStorage, no account), **create game → shareable
  invite link**, **My games** list, handicap preview, assistance ladder. The game
  page (`multiplayer.html`) reads invite params (room, host, rating) and shows a
  "you're invited / your game" state. Linked from the AI page. Wired to the live
  Render server. **Still to do in P1:** server-side game registry so the initiator
  is notified across the portal when someone joins (currently the join shows in
  the game room). Then P2 persistence (Neon).
- **2026-09-13** — Roadmap created. Captured: player portal (create/invite/notify/dashboard
  + intro + what's-new), strategy-level assistance model (evolved spectrum + strategy layer),
  calibration mission, device-identity + Neon architecture, 4-phase build plan. Design concept
  published. Next up: Phase 1.
