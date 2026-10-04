---
name: strategy-capture-doctrine
description: Glassboard auto-learns strategies from real games — detection must stay deterministic; an LLM may only re-word verified facts
metadata: 
  node_type: memory
  type: project
  originSessionId: c65ecd65-db19-49ae-aedc-6cff58478ed3
  modified: 2026-10-04T16:23:04.037Z
---

Glassboard captures a strategy from the game you just played, names it, and files it under
its own 🧠 Learned shelf (`web/gb-capture.js` → `localStorage gb_learned` → `GBStrategies.add()`).
Runs automatically at game end in **both** Play-AI and human games. Issam's framing (2026-10-04):
"this is an amazing strategical move done by black — this is what I want to be captured."

**Why:** turning a game you lost into a pattern you own is the "ladder down" guardrail in
practice (see [[fun-over-clever]]). It only works if the lesson is TRUE — a captured pattern
that teaches a motif that wasn't there is worse than no capture at all.

**How to apply:**
- Detection stays **deterministic and verified on the board** — forced replies are *counted*
  (`countLegal`), material is *counted*. Only claim motifs you can verify (forced / defended /
  wins-material); omit everything else. This is guardrail #3 ("measured, not assumed") and it
  keeps capture working offline, which Issam specifically wanted for flights.
- Detection is **key-move-centric**, not biggest-eval-drop — the latter just finds whoever
  blundered hardest, which is not a strategy worth learning. (I got this wrong once; it
  surfaced Issam's own blunder as the "lesson".)
- **Widening coverage = more rule-based detectors** (fork, pin, skewer, sacrifice, squeeze),
  not an LLM. Today only one motif family is recognised: forcing checks.
- Decided 2026-10-04: if an LLM is ever added it may **only re-word already-verified facts** —
  never add a claim — server-side, with the template as the fallback. Words from the LLM,
  facts from the engine.
- `gb_learned` is **device-local**, so a capture on the phone is invisible on the Mac. Moving
  it to the account is an open task.
