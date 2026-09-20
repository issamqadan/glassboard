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
Closes the hypothesis: **independence score** (provenance → the "ladder down" payoff),
**Match-as-agreement** (negotiated terms shown as the glass-box contract), strategy
depth (P2 proactive plans), and device-agnostic polish. *Adjacent (retention, not
core):* Rivals/social, cross-game badge. *Infra:* same-screen sim (`?sim=1`).
