---
name: fun-over-clever
description: "Issam's north star for Glassboard — enjoyment first; don't over-abstract assistance; strategy is the headline"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c65ecd65-db19-49ae-aedc-6cff58478ed3
  modified: 2026-09-17T16:52:42.361Z
---

On 2026-09-17 Issam pushed back hard after a run of "clever" UX changes (chips,
sheets, agency budget everywhere, transparency-ledger jargon, always-on "You're
safe" card): *"I am so turned off from playing chess — if I am not enjoying then
this is a failure."*

**Why:** the product's success metric is **enjoyment**, not feature visibility or
architectural elegance. Cleverness that adds friction/noise/accounting is a
failure even if it's "doctrinally correct." The doctrine (docs/GAME-UX.md) serves
fun — it is not a license to over-engineer.

**How to apply:**
- **Strategy is the headline assistance feature** — a *visible* panel (pick a plan
  → step-by-step with progress → arrows on board). Never hide it behind a chip/
  button. Expand it (richer plans) rather than shrink it. Move-by-move ("Suggested
  moves") is *secondary* and collapsed.
- **Coach = transient safety net**: speak ONLY on real danger / free opportunity.
  No "you're safe" spam, no permanent card.
- **Help is FREE in Play-AI and Casual** — no budget/meter/reveal-gating there.
  The agency budget belongs to **Match** only. No glass-box in Play-AI (no opponent).
- Prefer removing UI over adding it. Before any assistance-UI change ask: does this
  make the game more *fun*, or just more capable? If the latter, don't ship it.
- He wants: **richer strategy library** + **detecting the opponent's incoming plan**
  ("they're attacking your king"). Focus = game experience.

Relates to [[game-ux-doctrine]] (which fun overrides when they conflict).
