---
name: strength-and-handicap-model
description: "How AI level, opponent strength, and assist depth map so following the help wins (and its ceiling)"
metadata: 
  node_type: memory
  type: project
  originSessionId: c65ecd65-db19-49ae-aedc-6cff58478ed3
  modified: 2026-09-29T13:36:57.891Z
---

The "follow the assistance → win, not lose" exit criterion is delivered by a
**depth handicap**, measured with self-play (`selfplay_diag`, `#[ignore]`d, in
`core/assist/src/lib.rs`).

**Model** (`strength_for_elo` in `core/bindings/src/lib.rs`): the chosen AI level
→ (search depth, move-variety spread). Beginner d1 · Casual/Intermediate d2 ·
Club/Expert d3 · **Master d4, spread 0 (strongest)**. `engineMoveByElo(elo, rand)`
plays it; lower levels vary more (weaker), higher tighter.

**The handicap:** `assistDepthFor(elo) = min(4, opp_depth+1).max(3)` — the
assistance searches a **ply deeper than the chosen opponent**, so following the
help out-calculates it. Play-AI uses `depth()=assistDepthFor(engineElo)`;
multiplayer uses a fixed strong `DEPTH=4` (same strong analysis both modes).

**Measured** (2026-09-26, self-play, 0 losses everywhere):
- follow-assist(d4) vs opp(d3): **+334 material** — wins decisively (Club/Expert).
- follow-assist(d4) vs opp(d4): **−1** — dead even (Master).
- follow-assist(d3) vs opp(d2): +167.

**Hard ceiling — do NOT "fix" by capping the opponent:** to out-search a depth-4
Master you'd need depth-5 assist = **~4s/move** (measured, `assist_timing`) —
unusable. So Master is an **even fight**, by design. A past attempt to cap the
opponent at depth 3 made Master play weakly — reverted. The opponent's strength
must equal the level the user picked; the assist's edge is real depth, never a nerf.
See [[dont-override-search]].

**Engine strengthened (2026-09-26):** added a transposition table + Zobrist +
null-move pruning (~30% faster) and a real eval (bishop pair, doubled/isolated
pawns, rook files, king pawn-shield, tempo) in `core/engine`. Play is genuinely
more strategic at the same depth.

**Key tension (measured after the eval upgrade):** the assist and opponent share
the SAME engine, so a smarter engine helps both equally. The depth-1 handicap that
gave +334 material vs a *weak-eval* depth-3 opponent now gives only **+7** vs the
*strong-eval* depth-3 opponent (both play well → near-even). Follow-assist still
**never loses** (0 losses at every depth pair), and in-app the opponent's *spread*
(variety) makes it weaker than pure search, so you still win at Beginner→Club; but
Expert/Master are now a genuinely competitive/even fight, not a blowout. You cannot
have BOTH a strong opponent AND help that decisively beats it with one hand-written
engine at playable speed (depth-5 assist = ~4s/move, measured).

**Search upgraded (2026-09-26):** added killer moves + history-heuristic ordering
+ late-move reductions on top of the TT/null-move → **~4x faster** (depth 5:
1939ms→514ms native). Depth 5 is now affordable per move (~1s WASM).

**Re-tuned with the fast search (measured handicap curve, follow-assist vs opp):**
- **+2 plies deeper = COMFORTABLE win (+501 material / +5 pawns)**
- **+1 ply or parity = even fight, never a loss**

Final ladder: opponent Beginner d1 · Casual d2 · Intermediate d2 · Club d3 ·
Expert d4 · Master d5 (spread shrinks as level rises). `assist_depth_for =
(opp+2).min(5).max(3)`. So Beginner..Club (opp ≤ d3) → assist +2 → **following
help WINS**; Expert d4 / Master d5 → assist caps at 5 → competitive/even fight.
Opponent is genuinely strong at the top AND help wins up through Club — both real.

**Web Worker SHIPPED (2026-09-27, commit 2bc119e)** — the ~1s synchronous per-move
freeze is GONE. `web/engine-worker.js` holds a 2nd WASM instance that searches a
position sent as a FEN; the main thread keeps its instance for instant ops. The
three depth-heavy calls (opponent `engineMoveByElo`, `assist`, review `scoreMove`)
run in the worker via `askEngine()` (id-tagged promises + sync fallback).
`onPositionChanged` paints instantly then fetches assist async (positionToken drops
stale results); `engineReply` is async with a fen guard. Board stays live while
thinking. pages.yml cache-busts the worker + its wasm import.

**Deeper ladder shipped (worker makes it affordable):** Beginner d1 · Casual d2 ·
Intermediate **d3** · Club **d4** · Expert **d5** · Master d5 (was d1/d2/d2/d3/d4/d5).
`assist_depth_for = (opp+2).min(5).max(4)`. Timing native release: d4 135ms, d5 511ms.
**Re-measured handicap (new ladder):** assist5 vs opp3 = **+501 (win)**; assist5 vs
opp4 = +3, assist6 vs opp4 = +4 (both EVEN — depth 6 buys only latency, so cap=5).
So **following help WINS up through Intermediate**; **Club/Expert/Master = competitive,
never-losing fight**. Note: making Club stronger (d4) moved the clean-win ceiling
DOWN from Club to Intermediate — the inherent one-engine tension (strong opponent
XOR decisive help-win). NNUE (trained eval) remains the long-term ceiling-raiser.

**DECISION 2026-09-29 — "following the top move must WIN at every level" (Issam chose
this over the even-fight ceiling).** Play-AI uses Stockfish (skill 0-20), NOT the Rust
depth handicap, for the opponent; the **assist recommendation is Stockfish skill 20 @
1400ms** (`sfBest` in `web/main.js`) — the strongest engine in the game. Every opponent
is kept a clear notch below it so playing the recommended move reliably wins (harder up
top, winnable, no forced draws):
- Ladder (`AI_LEVELS` skill): Beginner 0 · Casual 2 · Intermediate 6 · Club 9 · Expert
  12 · **Master 16** (~2400, "strongest you can still beat with full help" — NOT max).
- `aiBoost()`: the opponent still toughens as you lean on help (symmetric ⛏ badge), but
  the ceiling is capped at **skill 16** (`AI_SKILL_CEIL`, ~4 below the assist) and
  think-time at **1100ms < the assist's 1400ms**, so leaning always keeps you ahead.
- Root bug fixed same day: the assist was searching 900ms while Master thought 1500ms,
  so the recommended move was WEAKER than the opponent's reply (you couldn't out-play
  it). Assist now out-searches every opponent.
This supersedes the earlier "Master = even fight / draw is the perfect result" framing.
Also shipped for realistic conclusions: engine RESIGNS when clearly lost
(`maybeEngineResign`) + insufficient-material auto-draw (Rust `status()`), so games end
like real ones instead of grinding to bare kings. See [[symmetric-assistance]].

**MEASURED 2026-09-27 — "Club feels weak" root cause (user report):** ruled out two
suspects with native self-play, found the real lever is DEPTH, not eval:
- **Move-variety spread is NOT the cause** (`spread_cost_diag`, ignored): clean-best
  vs the in-app `engine_move_by_elo` spread pick = **+3cp** over a game (negligible).
  Club already plays essentially its clean depth-3 best move.
- **A "smarter eval" does NOT help at these depths** — tried mobility + passed pawns +
  king-open-file (A/B via a temp `EVAL_BASIC` toggle): upgraded eval **changed the
  chosen move in only 1/4 positions**, and self-play A/B was **50% (16/16 draws, ~0cp)**
  at d3 AND d4. Material+PST already dominate move choice; add-on terms only re-score.
  Cost was ~32% slower at d5 (680 vs 514ms) for no measurable gain → **REVERTED**
  (eval.rs/movegen.rs restored; only `spread_cost_diag` kept as tooling).
- **Conclusion:** perceived weakness = depth-3 tactical blindness, fixable only by more
  DEPTH (handicap tests show +1 ply ≈ +300-500 material). Clean path = **Web Worker**
  (async engine, no UI pause) enabling deeper opponent AND assist. Eval tuning is a
  SPRT rabbit hole (sub-100-Elo gains unmeasurable without hundreds of games) — don't
  hand-tune eval terms again without that infra. See [[dont-override-search]].
