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

## Game modes — Casual vs Match (design, 2026-09-15)

A first-class distinction the product should make when starting a game:

- **Casual** — free play. **Unlimited assistance for BOTH sides**, no rating/score
  declaration required, doesn't affect any rating. A transparent sandbox to learn,
  explore strategies, and have fun. (Generalizes today's "force assist" testing
  toggle into a real mode.)
- **Match** — the competitive game. **Assistance is part of the declared terms**:
  the handicap model + the amount/level/quantity of assistance is set up front,
  ratings matter, and the result is measured (feeds calibration). This is the
  vision's fairness game.

Implication: "New game" first asks **Casual or Match**. Match carries the rating +
handicap declaration; Casual skips it and grants both players the full assistance
spectrum. Persist the chosen mode with the game. (Build next.)

## Product direction — external review (2026-09-16)

Deep external product/tech review (via ChatGPT, after playtesting with family)
surfaced strong direction. Capture for future phases:

- **The one hypothesis to prove:** *Can a 700 have a genuinely enjoyable game vs a
  1500?* Optimize for **competitive game quality** and "that was a real game" —
  **NOT** 50/50 win probability (mathematically fair but emotionally hollow).
- **Missing architectural layer — the Player Model:** today it's
  Engine → Assistance → Handicap → UI. Should become
  **Engine → Player Model → Assistance Policy → Handicap → Experience.** Assistance
  should depend on *what this human understands* (piece selection, threat
  awareness, hanging pieces, tactics…), decomposed by capability — not just the
  rating gap. Assistance scaffolds fade per-capability as the player learns.
- **Separate three systems:** (1) Chess Intelligence (pure truth), (2) Player
  Model (what they understand), (3) Assistance Policy (minimum info to reveal
  now) → then the Transparency Service records it. Improve one without touching
  the others.
- **Agency-retention metric:** measure not just effective-Elo gain but
  *EffectiveStrengthGain / AssistanceInformation* — max competitive improvement
  from minimum intervention. "You left something undefended" ≫ "play Nf3" even at
  equal Elo gain. This is likely the IP.
- **Assistance as a first-class mechanic / budget:** an assistance budget spent
  during a game (hint=1, candidate moves=2, best move=4, autoplay=5) → using help
  becomes strategy. And a recognizable **vocabulary** (Off · Hint · Guide · Coach
  · Assist · Autopilot) so people say "I was on Guide" like a golf handicap.
- **Higher skill → more abstract help:** a 1900 doesn't need "play Nf3" but
  "your opponent just weakened the dark squares." Assistance gets more abstract as
  skill rises (keeps strong players engaged).
- **First Game Mode (onboarding):** teach chess *inside* the first real game via
  progressive disclosure — make the first move impossible to fail (pulse a piece →
  illuminate legal squares → tap). Not a separate tutorial. (Partially addressed
  2026-09-16: tutorial now pulses the tappable piece + explicit tap instruction.)
- **Conversational level, not Elo:** "How would you describe yourself?" (never
  played / know the moves / casual / regular / club / competitive) → map to rating
  internally; then Glassboard learns the true level over games. (Partially done —
  level chips.)
- **Copy:** avoid "weaker player" (stigma) → done (now "lower-rated player").
- **Server-authoritative for Match:** already validates moves; extend to validate
  assistance *entitlement* + canonical state for rated games (Casual can stay
  client-trusted).
- **Brand language is landing:** "Different levels. One game." (consumer) +
  "Chess, in the open." (philosophy) + Glass-box. Keep the link-based, no-account
  invite flow simple — it's a core strength.

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

- **2026-09-15** — **P3 strategy layer LIVE (layers 1–2).** Shipped the
  context-aware strategy engine (`core/assist/strategy.rs`): phase detection +
  a named-plan library scored by board-state fit (Win the loose piece, Develop &
  Castle, Seize the Centre, Attack the King, Simplify, Push the Passed Pawn),
  each with a visual plan (arrows+rings), step tracker, concrete move, + an
  opponent-intent read. Exposed via WASM; wired into the live game as a Strategy
  panel that draws the chosen plan on the board (oriented overlay) and relays it
  to the opponent (glass-box). Preview page (`strategy.html`) proved the UX.
  **Remaining P3/beyond:** layer-3 personalization (needs game-logging to Neon),
  richer named-plan library, LLM phrasing, AI-page wiring.
- **2026-09-15** — **Durable accounts LIVE on Neon.** `DATABASE_URL` set on Render;
  server boots `Accounts: Postgres (durable)`. Verified end-to-end against
  production: register (201) → sign back in returning:true (200, read from
  Postgres) → wrong PIN 409. Accounts now survive sleep/redeploy and work across
  devices. **Remaining P2:** persist *games* (still in-memory) + Active/Past
  dashboard + calibration log.
- **2026-09-15** — **Neon-ready durable accounts + richer lobby.** Server has a
  storage layer: Postgres (Neon) when `DATABASE_URL` is set (auto-creates the
  `players` table), else in-memory — so `/account` becomes durable + cross-device
  once Neon is connected (sqlx, rustls TLS, runtime queries; Dockerfile updated
  for TLS + CA certs). Games now carry a `started` timestamp; lobby cards show
  opponent name+rating, whose move, and "started N ago". **Pending: user sets
  `DATABASE_URL` on Render to activate durability** (games persistence still TODO).
- **2026-09-15** — **Registration (in-memory) + more fixes.** Beginner tutorial
  now covers all six pieces + the goal. Lobby shows games you **joined** (not just
  created) by merging the server's game list. Shipped **name + 4-digit PIN
  registration** (`POST /account`) → a stable cross-device player id, wired into
  the portal identity modal. **Caveat:** accounts live in server memory, so Render
  free-tier sleep wipes them — the durable version = swap the registry for **Neon
  Postgres** (P2), which needs a ~5-min DB provision (free, no card).
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

## Strategy assistance — forward-thinking, context-based (2026-09-19)

The differentiator: assistance isn't just "don't hang a piece" — it's a coach
that thinks *ahead* with real chess plans, lets you **choose a plan at any point**,
and warns you when the **opponent** is setting one up. Strategy is the headline
feature (a visible panel; move-by-move is secondary). Fun/enjoyment is the metric
(see docs/GAME-UX.md + memory). Build order:

- **P1 — Deepen the plan library (in progress).** A context-fitted library scored
  by how well each plan fits the position *now*, each with a concrete first move
  (blunder-guarded), board arrows/rings, and a step checklist with progress.
  Shipped plans: win-the-loose-piece, develop & castle, seize the centre, attack
  the king, simplify (ahead), push the passer, attack the isolani, seize the open
  file, kingside pawn storm, the long diagonal, **knight outpost (new)**, **rook
  to the 7th (new)**. Now returns up to 5 so the player can pick one at any time.
  *Next candidates:* minority attack, knight-vs-bad-bishop, space/expand, attack
  the pawn-chain base, improve-your-worst-piece (universal, great for learners),
  prophylaxis (defend their plan).
- **P2 — Proactive, not a menu.** Surface the best-fitting plan *for this moment*
  ("Now's the time to seize the centre") rather than a passive list; escalate the
  strategy chip/panel when a strong plan appears.
- **P3 — Read the opponent's incoming plan.** Infer intent from their recent moves
  + pawn structure + piece flow ("⚠ they're massing on the kingside — attack
  coming; castle or ...h6") and show the danger *region on the board*. The current
  `opponent_read` is a stub to grow into this.
- **P4 — Combinations, counter-plans & custom.** Blend compatible plans (e.g.
  outpost + open file), suggest a counter-plan to the opponent's, and — for power
  players / learners — a "compose your own plan" / pick-multiple mode. The Player
  Model decides how much to reveal; assistance fades as you see it yourself.

Discipline: every plan hint is glass-boxed (visible to both players); strength/
behaviour claims are validated with the strength tooling before they ship.

## Transparency & the assistance game-loop (2026-09-20)

The glass-box flaw: if assistance is *displayed*, a player can read the move and
play it without the act being registered — help hidden in plain sight. Fix
(Issam's insight): don't gate on the tap — **record MOVE PROVENANCE** (does the
move played match the advice?). Unspoofable, and lets help stay generous/visible.

- **Move provenance (the airtight core).** Each move is classified vs the live
  assistance and logged to the glass-box: 🤖 followed (played a suggested move) ·
  🧠 your own (not suggested; if the engine agrees it's strong → highlighted) ·
  🛡 safety-only. Render a **provenance ribbon** in the glass-box — a per-move
  story both players read ("followed the machine 6 straight" vs "playing their
  own game"). This is the agency-retention IP as a live signal.
- **Casual:** assistance proactive & open, revealed elegantly (moves, plans,
  "⚠ their incoming move", danger). No cost/stigma — a learning sandbox.
- **Match:** three separated tracks — (1) **safety net** (danger / opponent plan)
  always free & shown; (2) **move help on a timed "thinking window"** (~20–30s):
  move before it reveals → 🧠 *unassisted credit* (beating the coach is the flex);
  let it run → moves fade in (🤖); plus "Show me now" and "I've got this"; (3)
  **strategy** = the compound multi-move plan (following it shows its moves).
- **Two scoreboards:** win the game, and separately win on **independence**
  (provenance mix). "Beat a 1600 with 3 assisted moves" is the brag.
- Innovations: a **thinking-window ring** around the board; the **off-book
  moment** (own move celebrated for you, marked for them); asymmetry by skill.

## Match = a negotiated agreement (2026-09-20)

Match isn't just an auto-handicap — it's **whatever the two players agree to**,
shown transparently. Terms at create/join: **None** (pure chess) · **Balanced**
(both get the same rung) · **Handicap** (auto by rating gap — the default) ·
**Custom** (per-side amounts). Host proposes, joiner accepts (later: counter-
propose). The agreed contract is displayed in the glass-box header for the whole
game ("Agreed: both on Guide" / "No assistance" / "Handicap: Maya on Coach").
What matters is the agreement — fair because it's mutual and in the open.

## Turn awareness (shipped 2026-09-20)

Games last days, so "it's your move" is unmissable: a glowing 💡 "Your move" pill
in-game; your-move games glow/pulse/sort-to-top in the lobby ("💡 N need you");
and the shared nav badges the Lobby link with the count of OTHER active games
waiting on your move (polled), so you know mid-game that another board needs you.

## AI / LLM (clarification 2026-09-20)

Today: 100% deterministic Rust (negamax + heuristic strategy library) — no ML/LLM.
Vision: **neural inference** (PyTorch weights in the core) for *playing strength*.
A **conversational-LLM coaching layer** (explain a move, narrate the opponent's
plan, adapt to the player) is a candidate — but server-side only, non-deterministic,
outside the offline WASM core, and gated so fair/measurable defaults never depend
on it.
