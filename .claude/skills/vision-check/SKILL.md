---
name: vision-check
description: Review a proposed change, feature, or plan against the chessAI founding vision's non-negotiable guardrails BEFORE it lands. Use whenever adding or changing an assistance feature, a strength/calibration claim, a default setting, or a progression/unlock rule — or when the user asks "does this fit the vision?". Guards transparency (no hidden help), measured strength, defaults-protect-fairness, and assistance-as-a-ladder-down.
---

# vision-check

A guardrail skill. It checks whether a proposed change to chessAI is consistent with the
founding vision before the change is implemented or merged.

## When to use

- Adding or modifying any **assistance** feature (awareness, coaching, suggestion, guided, autopilot).
- Making any claim about **playing strength** or **assistance calibration**.
- Changing a **default** setting, or the **handicap** / **transparency** dials.
- Designing **progression / unlock** rules.
- Any time the user asks "does this fit the vision?" or "is this on-brand?"

## How to run it

1. **Load the vision.** Read `docs/VISION.md`, especially §8 "Non-negotiables."
2. **Restate the change** in one sentence, and identify which vision section (§) it serves.
3. **Check each non-negotiable** and record PASS / RISK / FAIL with a one-line reason:

   | # | Non-negotiable | Question to ask of the change |
   |---|----------------|-------------------------------|
   | 1 | **No hidden help** | Is every bit of AI assistance visible to the opponent? Could any help be secret or under-surfaced? |
   | 2 | **Defaults protect fairness** | Is the most equalizing / most transparent option the free default? Is extra control *earned*, not assumed on? |
   | 3 | **Strength is measured** | Is every strength/calibration claim backed by a reproducible measurement, not a vibe? |
   | 4 | **Ladder down, not crutch** | Does the design help the player eventually need less help, rather than entrench dependence? |

4. **Verdict.** Any FAIL → the change must be revised; state the specific violation and propose
   a compliant alternative. Any RISK → flag it and recommend the mitigation. All PASS → approve,
   and note which vision section it advances.

## Output format

```
Change: <one sentence>
Serves: VISION.md §<n> <title>
[1] No hidden help          — PASS/RISK/FAIL: <reason>
[2] Defaults protect fairness — PASS/RISK/FAIL: <reason>
[3] Strength is measured     — PASS/RISK/FAIL: <reason>
[4] Ladder down, not crutch  — PASS/RISK/FAIL: <reason>
Verdict: APPROVE / REVISE — <next step>
```

## Notes

- This skill checks **alignment**, not code correctness or strength (that's `strength-bench`)
  and not visibility wiring in code (that's `transparency-audit`).
- If `docs/VISION.md` and a change genuinely conflict *and the change is right*, that's a
  signal to update the vision deliberately — never to quietly ignore it.
