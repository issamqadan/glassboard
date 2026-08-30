# Vision — Glassboard

> **Product name:** **Glassboard** — *"Chess, in the open."* The name grows from this
> document's #1 non-negotiable: **glass-box transparency**. Every bit of AI assistance is
> visible to both players — which is what turns assistance from *cheating* into a *legitimate,
> declared game mechanic*. It works equally well with assistance OFF (two masters on a
> fully-open board), so it is platform-sized, not an "aid" brand. The *balance / even-game*
> idea lives in supporting copy, not in the name.
> `chessAI` remains only the working directory / repo path. Availability note: `glassboard.com`
> is held by an unrelated hardware-design firm, so launch on `.gg` / `.app`; the gaming
> trademark class (9 / 41) appears open pending a formal search.
>
> **Status:** Founding document. This is the anchor; everything else (skills, architecture,
> governing documents) derives from and must stay consistent with this.
> **Last updated:** 2026-08-30

---

## 1. The one-sentence vision

**Chess where AI assistance is a first-class, transparent, and adjustable part of gameplay —
used to fairly offset skill differences between opponents, and designed to help the weaker
player eventually need it less.**

## 2. The core mechanic: the Assistance Handicap

Different sports equalize unequal players in different ways:

- Golf equalizes with a **stroke handicap**.
- Odds chess equalizes with **material or time odds**.

Glassboard introduces a new one: **the Assistance Handicap** — equalizing players through a
**dial of transparent AI assistance**.

A chess master can play a near-beginner as a genuinely competitive game, because the beginner
plays *with an AI co-pilot* tuned to close the gap. The defining, non-negotiable rule:

> **The assistance dial is fully visible to both players. It is a *declared* handicap, never
> hidden help. This is not cheating — it is a transparent, agreed-upon equalizer.**

Transparency is the ethical and design spine of the entire product. Any feature that would
let one player secretly benefit from AI violates the vision.

## 3. The assistance spectrum

Assistance is a **spectrum, not a switch**. Rising rungs blend the underlying capabilities
(engine + neural evaluation + coaching + agent) in different proportions:

| Rung | Name (provisional) | What the assisted player receives |
|------|--------------------|-----------------------------------|
| 0 | Off | No assistance. Pure play. |
| 1 | Awareness | Passive signals: a piece is hanging, you're in check-danger. |
| 2 | Coaching | Natural-language explanation of the threat/opportunity. |
| 3 | Suggestion | 2–3 candidate moves offered, with reasoning. |
| 4 | Guided | A recommended move, explained; player still executes. |
| 5 | Autopilot (assist-max) | The co-pilot plays the move; player supervises. |

Exact rungs are provisional and will be refined; the *shape* — a smooth ramp from awareness to
autopilot — is the commitment.

### Game modes (how a match is configured)

Players never see "rungs"; they choose a **mode**, and the mode maps onto the assistance
spectrum and the handicap/transparency dials. The mode taxonomy is a keeper:

| Mode | What it is |
|------|------------|
| **Classic** | Pure chess. Zero assistance for either side. The platform is complete here. |
| **Matched** | The flagship: automatic Assistance Handicap computed from ratings to make the game even. |
| **Open** | Player-selected, declared assistance level (unlockable). |
| **Adaptive** | Assistance is dynamically re-calibrated during play as the position shifts (unlockable). |
| **Training** | Progression / coaching-oriented play aimed at needing less help over time. |

Because **Classic** exists and needs no AI at all, the brand and platform must make full sense
with assistance off — which they do.

## 4. Two core dials, one governing rule

Both of the game's core dials are **selectable**, but gated behind progression:

1. **Handicap model** — how the assistance level is set:
   - **Auto-from-ratings** (default): the system computes the assistance needed to equalize,
     like a golf handicap. Principled, automatic. This is the flagship path.
   - **Manual**: players dial the tier themselves (unlockable).
   - **Adaptive**: starts from the auto suggestion, adapts mid-game to how the position is
     going (unlockable).

2. **Transparency model** — how much each side sees:
   - **Fully transparent / glass-box** (default): both players see the tier, when help is
     invoked, *and* the actual suggestions shown to the assisted player.
   - Reduced-transparency variants may become selectable via progression — but full
     transparency is always the free default and can never be silently removed.

> **Governing rule for both dials: the fairest, most transparent settings are the free
> default. More control is *earned* through play.**

## 5. Progression: learning to need less help

Assistance is **training wheels the game is designed to help you outgrow.** The player's arc is
literally *learning to need less help.*

- New players begin with only the safest defaults (auto handicap, full transparency).
- Score/skill milestones **unlock** more control: manual dialing, adaptive assistance,
  reduced-transparency modes, and ultimately confident unassisted play.
- Progression is itself part of the fun — the meta-game layered on top of each match.

## 6. Why this needs all four capabilities

Success is defined as **"it plays strongly"** — measurable strength is the scoreboard —
*because you cannot fairly offset a gap you cannot measure.* Calibrating "assistance that
offsets a 900-Elo difference" requires a strong engine and a rigorous model of strength.

| Capability | Role in the vision |
|------------|--------------------|
| **Chess engine** | The ruler. Move generation, search, evaluation — the ground truth of strength and the basis for calibration. |
| **ML / neural chess AI** | Human-like evaluation and move quality; enables *tunable* strength (playing convincingly at a target level, not just maximally). |
| **Coaching / teaching tool** | Turns engine truth into human-understandable awareness, explanation, and suggestions — the substance of rungs 1–4. |
| **Agentic assistant** | Orchestrates the above into a live, conversational co-pilot and manages the full gameplay experience. |

## 7. What success looks like (1 year)

- **Primary scoreboard:** the engine plays *strongly* and its strength is *measurable and
  tunable* to a target level.
- The Assistance Handicap can take two players ~900 Elo apart and produce a game both
  experience as genuinely competitive and fun.
- Every bit of assistance is transparent to both sides — glass-box by default.
- A progression loop exists where players unlock control and measurably learn to need less
  help over time.
- A full gameplay experience ties it together end to end.

## 8. Non-negotiables (the spine)

1. **No hidden help, ever.** Transparency is a right of the opponent, not a setting we can
   quietly disable.
2. **Defaults protect fairness.** The most equalizing, most transparent configuration is
   always the free default.
3. **Strength is measured, not assumed.** Calibration rests on a rigorous, testable notion of
   playing strength.
4. **Assistance is a ladder down, not a crutch.** The design goal is players who need less
   help over time.

---

*This document is intentionally about the "why" and "what," not the "how." Architecture and
implementation live in separate governing documents that must remain consistent with this
vision.*
