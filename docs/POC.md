# POC — firming up the gaming experience

> The shared north star for the current phase. Anchors to [VISION.md](VISION.md)
> and the active-game doctrine [GAME-UX.md](GAME-UX.md). **Last updated:** 2026-09-20.

## The ONE thing this POC proves
> **Can two players far apart in skill (e.g. ~700 vs ~1500) have a game that BOTH
> experience as genuinely competitive and *fun* — because assistance is
> transparent, adjustable, and fair?**

This phase firms up the **experience** that makes that true — **not** engine
strength, scale, or monetization.

### What "firming up" means (the experience must nail)
1. It feels like a **real game**, not a tutorial or a spreadsheet.
2. **Transparency creates trust + tension, not shame/cheating** — the glass-box /
   move-provenance is the heart.
3. The gap **closes emotionally** — the weaker player has real moments; the stronger
   one still has to play. *"That was a real game."*
4. Help **preserves agency** — "I found it"; help fades where you're strong.
5. A **total beginner starts from a link and enjoys it** — no chess knowledge needed.
6. It **holds end-to-end, over days, on phone + desktop** — invite → play → see help
   → come back.
7. **Device-agnostic, first-class** (vision non-negotiable #5): 100% of the experience
   on every device/screen/orientation. No degraded mobile version.

### Exit criteria (how we know it's firmed up)
A real playtest where an **unequal pair plays a full game and both independently say
it was fun and fair** — the beginner needed help but felt ownership; the stronger
player trusted the transparency. Proof by experience, not feature count.

### Explicitly OUT of scope this phase
Measured/calibrated strength (P4), scale/perf, security hardening, monetization,
native apps, the neural net / LLM. (Handicap stays a heuristic seed for now.)

## How we work this phase — two development tracks
1. **Field input** — incoming/ongoing observations from actually *using* the POC.
   These feed the roadmap and usually take priority (they're the point of a POC).
2. **Roadmap work** — planned items; often aligns with (1).

### Field-input log (newest first)
- **2026-09-23 — Roadmap sweep: shipped the open needle-movers.** Strategy P2 (proactive
  pawn-break plan), independence score (game-end + trend), Match-as-agreement (glass-box
  contract), device/orientation reserve fix, and the playtest kit (in-app fun/fair + doc).
- **2026-09-22 — Coach text squished one word per line on narrow rails.** *(Shipped: action
  wraps below; text keeps a real reading width.)*
- **2026-09-22 — Learn should be learner-paced with live tips, not auto-advance.** *(Shipped:
  keep practising each piece, info surfaces as you move, you advance on your own.)*
- **2026-09-22 — "How did I get mated with no warning?"** *(Shipped: mate-threat build-up
  warning + illustrated checkmate.)*
- **2026-09-21 — Captured pieces need a fun visual.** *(Shipped: material tug-bar.)*
- **2026-09-21 — Lobby preview should show the game's board colour.** *(Shipped: mini-board
  renders each game's per-game palette.)*
- **2026-09-21 — Board selection was global, not per-game.** Each game should keep its own
  board; new games inherit your latest pick. *(Shipped.)*
- **2026-09-21 — Losing was abrupt: no build-up warning, and no illustration of how.**
  *(Shipped: engine mate-threat detection → coach shouts "Checkmate threat!" + amber king halo
  on your turn; on mate, the king is ringed, an arrow marks the mating piece, and the overlay
  names how it happened.)*
- **2026-09-21 — Captured pieces need a better, fun visual (not two side trays).** *(Shipped:
  a material "tug" bar above the board — captured pieces flank a beam that slides to the leader.)*
- **2026-09-21 — vs-AI games must persist like online games (DB, cross-device), gone when
  finished.** *(Shipped: ai_games table + REST; syncs per account; removed on finish.)*
- **2026-09-21 — Assistance must re-prioritise move-by-move; a threatened queen must interrupt
  the plan.** *(Shipped: value-aware threats, safety outranks the strategy step.)*
- **2026-09-21 — Piece tips should be illustrated, not plain text.** *(Shipped: move-pattern
  mini-diagrams; timer illustrative + pauses while reading a tip.)*
- **2026-09-20 — Timer / thinking-window spec (firm this up).** By default assistance
  does **not** appear. It appears by (a) **waiting X seconds** (default **30**, tune
  30–60), (b) tapping **"Show now,"** or (c) **never this turn** via **"Don't show."**
  **Exception:** when you're **following an already-picked multi-step strategy**, its
  step help shows immediately (you've opted into the plan). *(Shipped: default 30s +
  strategy exemption, both pages.)*
- **2026-09-20 — Onboarding streamline.** "New to chess?" entry must be present and
  smooth **from the lobby** *and* **on joining/starting a game**. *(In progress.)*
- **2026-09-20 — Device-agnostic is first-class** → promoted to a vision non-negotiable (#5).

## Roadmap alignment (what moves the POC needle)
Closes the hypothesis: **independence score** ✅ (provenance → the "ladder down" payoff,
shown at game end with trend), **Match-as-agreement** ✅ (negotiated terms as the glass-box
contract, visible before move 1), **strategy depth (P2)** ◑ (proactive "pawn break" plan
added; more to come), and **device-agnostic polish** ✅ (board fits with the material bar
across orientations). *Adjacent (retention, not core):* Rivals/social, cross-game badge.
*Infra:* same-screen sim (`?sim=1`).

**The gate is now runnable.** The [playtest kit](PLAYTEST.md) ships in-app fun/fair capture
(server-collected) + a protocol. Next action = **run the unequal-pair playtest** and let the
result lead the field-input log.
