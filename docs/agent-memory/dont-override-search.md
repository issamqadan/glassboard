---
name: dont-override-search
description: "Never re-rank the engine's move choice with static heuristics; safety belongs in warnings, not move selection"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c65ecd65-db19-49ae-aedc-6cff58478ed3
  modified: 2026-09-25T00:48:26.509Z
---

Do **not** re-rank or override the engine search's move choice with static
heuristics. A "safety re-rank" (subtract a 1-ply static estimate of what a move
hangs, then re-sort) shipped 2026-09-24 and made the assisted side lose by ~6
pawns — a full-assistance game lost quickly. The deep search already avoids real
hangs; a crude static estimate is often wrong (a piece "attacked" that's actually
fine after the recapture), so it steered play into worse moves. **Reverted.**

**Why:** the search is the strongest thing we have. Second-guessing *which move is
best* with shallow heuristics degrades strength. Safety heuristics (value-aware
[[assist-priority-doctrine]] threats, mate-threat, "save your piece" plan) belong
in the **warnings and plan messaging** — telling the player what to watch — never
in choosing the recommended move.

**How to apply:**
- The recommended move = the engine's search result. Full stop.
- New assistance ideas that touch move *selection* must be strength-measured
  before shipping. There's an `#[ignore]`d self-play diagnostic in
  `core/assist/src/lib.rs` (`selfplay_diag`): `cargo test -p glassboard-assist
  selfplay -- --ignored --nocapture`. Baseline: following the recommendation is
  **even (+0)** vs a same-depth opponent. If a change drops that, it's a regression.
- Ties to guardrail #3 (strength is measured, not assumed) in CLAUDE.md.
