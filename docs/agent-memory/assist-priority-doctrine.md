---
name: assist-priority-doctrine
description: How assistance prioritizes move-by-move — safety outranks the plan; threats are value-aware
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c65ecd65-db19-49ae-aedc-6cff58478ed3
  modified: 2026-09-27T19:56:13.258Z
---

Assistance must **re-prioritize every move**, and **safety outranks the strategy**. Observed
failure (2026-09): while following a multi-step plan, the queen was threatened but the plan
step stayed the headline and the queen was lost.

**Why:** a plan is worthless if you hang material executing it. The weaker player needs to be
taught "deal with the threat first, then resume" — that's the ladder-down pedagogy.

**How to apply:**
- Threats are **value-aware**, not just "hanging." A DEFENDED piece still counts if the
  opponent wins material (queen defended by a pawn, attacked by a knight = lose 900 for 320).
  Engine: `threatened_pieces()` in `core/assist/src/lib.rs`, exposed as `threats[] {sq,kind,loss}`
  (loss in centipawns; a light one-exchange SEE). Tests lock the defended-queen case.
- Client (Play-AI + multiplayer): the coach leads on the biggest-loss threat (louder
  `critical` state for rook+), threatened squares pulse, urgent threats bypass the thinking-
  window delay, and a picked plan shows "Plan on hold — save it first" + dims the step.
- vs-AI games persist **device-local** in `localStorage gb_ai_games` (solo, no server) — start
  now / resume later / several at once; lobby "Your AI games" section. See [[deploy-hosting-gotchas]].

**Priority rungs** (`pickPriority()` in `web/main.js`, top→bottom): analyzing (no SF yet) →
stop-the-mate → save-hanging-piece → continue-your-plan (only when it == SF best) →
**play-for-a-draw** → best move. The recommended MOVE always comes from Stockfish full-strength
(never weak Rust) — Rust supplies threat/plan awareness only.

**Draw as a visible strategy** (2026-09-27, Issam's idea): when you're clearly worse
(`lastEval <= -180 && > -800`) a draw IS the win, so the Lens names it — "Play for a draw", or
"Repeat for a draw ♻" when the move returns to a seen position (`leadsToRepetition()` clones the
pos + checks the post-move signature vs `posCounts`). Must be player-FACING (a strategy they
choose + why), not the engine silently playing the best try. Indigo `kind-draw` styling.
Threefold repetition is detected in JS (`recordPosition`/`positionSig` → `repetitionDraw`) since
the Rust core only knows the 50-move rule; SF also gets full move history (`position startpos
moves …`) so it plays repetition-aware — together these fixed endless "stuck/repeating" games.

Ties to the [[fun-over-clever]] rule: safety help is free and always on; it never nags when safe.
