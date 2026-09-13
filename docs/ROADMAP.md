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
| **P2 — Persistence** | Neon Postgres; Active/Past dashboard; the calibration log (every game recorded). | DB + server API |
| **P3 — Strategy layer** | Named-strategy library + heuristic plan detection + opponent-intent read + plan tracker + LLM articulation. In-game strategic assistance panel. | Strategy engine + LLM (server-side) |
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
