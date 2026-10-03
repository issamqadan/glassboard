---
name: ai-human-parity-doctrine
description: "Play-AI is the prototyping ground, but EVERY gameplay feature must behave identically in human games — build shared, not duplicated"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c65ecd65-db19-49ae-aedc-6cff58478ed3
  modified: 2026-10-03T16:14:15.314Z
---

Issam (2026-10-03): "whatever how we enhance game play w/ play AI should reflect 100% w/ play with
human, period." Play-AI is the basis/prototyping ground; human games must get the same experience.
He also chose to **postpone shiny visuals (3D/materials)** in favour of gameplay that is fun,
strengthens strategy/skill, and brings players back.

**Why:** it's the same fairness principle the vision states for platforms ("behavior is identical on
every platform — a fairness requirement"). A feature that only exists vs the AI means the human game
is a different, weaker product — and the glass-box/assistance guarantees silently differ.

**The debt (audited 2026-10-03):** `web/main.js` (Play-AI, ~3100 lines) and `web/multiplayer.js`
(~1430) are SEPARATE implementations. 12 of 14 gameplay features were Play-AI-only: Glass Lens,
strategy identity strip, proactive "💡 Try" rec, Plans picker, follow-the-book, move explanations,
Game Recap, play score (Self+Assist), drag-to-move physics, move sounds, board advice arrow,
provenance move list. (Only GBRating + promotion existed in both.)

**How to apply:**
- Do NOT copy features between the two files — **extract to a shared module** (`web/gb-*.js`) that
  both pages load, so parity is structural. Port feature-by-feature, each step shippable.
- When adding any new gameplay feature, implement it once in the shared layer and verify it appears
  in BOTH Play-AI and multiplayer before calling it done.
- Differences that are legitimately AI-only (opponent styles, AI lifelines, engine resign) stay
  AI-only — everything about the PLAYER's experience must match.
