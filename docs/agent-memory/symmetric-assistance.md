---
name: symmetric-assistance
description: "Assistance as a shared, visible game layer both sides use — the AI-lifelines direction and its first slice"
metadata: 
  node_type: memory
  type: project
  originSessionId: c65ecd65-db19-49ae-aedc-6cff58478ed3
  modified: 2026-09-28T17:51:51.103Z
---

Issam's idea (ChatGPT only wrote it up): assistance is not a one-sided crutch
for the weaker player — it's a **game layer both sides share, in the open**.
The opponent changes (AI or human); the Glassboard game doesn't:
`Player + Assistant ↔ AI/Player + Assistant`. Let the AI use assistance too, and
**show it** — "oh, you needed help there too." Never a secret buff; every use is
an explicit, visible event. Scarcity ("use it now or save it?") is the fun.

**Why:** turns the transparency guardrail (#1 no hidden help) into *tension*
instead of a mere utility. Aligns with [[fun-over-clever]] (fun is the metric).

**How to apply:** Play-AI is the prototyping playground (Issam can test solo,
repeatedly). Build the smallest experiment, play it, keep what's fun. Keep the
**board clean** — this is the game layer AROUND chess, NOT an engine-analysis UI.
Anything added should later work the same in human-vs-human.

**First cut (3f8ab78) failed the "did you see it?" test** — trigger fired only
when the AI was losing by >1 pawn (rare in the user's games) and hid behind two
tiny chip buoys. User: "i did not see any difference at all."

**Full build shipped (2026-09-27, commit a7bb2a7)** — user said "ignore the
small-scale idea, deploy in full." All in web/main.js + web/style.css + index.html:
- **Opponent's-assistance PANEL** (`#aiAssist`, always visible in Play-AI): lifelines
  remaining + a live LOG of each spend. This is the home for "what help did the AI get?"
- AI lifelines (3/game): trigger now `game.bestScore(2) <= -40` (you've earned an
  edge → it's under pressure), spaced ≥2 moves, plays `engineMoveByElo(3000,0)`.
  Kinds: Danger check (≤-140) / Deep think. Hidden for Master + first-game.
- **Personality moments** (`showMoment()` toasts, both sides, never touch board):
  🛟 lifeline · 💪 You found that on your own (own+wasBest+!revealedBest, cap 3) ·
  🎁 Opponent gave you a chance (white eval swing ≥160 after AI move, via
  `evalBeforeEngine`) · 🔥 Critical position (|eval|≥180, one-shot re-arming).
- **Suggestion flavors** on every candidate: 🛡 Safe / ⚔ Aggressive / 🗡 Sneaky /
  ♻ Simplify — `moveFlavor()` from boardString (capture value, pawn push), not vibes.
- Setup screen states the symmetry; post-game reveal of AI lifeline use (kept).

**Visibility pass (2026-09-27, commit c194cf3)** — user: "needs to be more visible
and fun... shown as a move highlight... show remaining for both sides... popups
disappear too fast." Fixes: (1) an AI lifeline move now glows amber + pulsing ring
+ a 🛟 badge on the destination square (`lastMoveLifeline` flag → `.sq.lifeline-move`
+ `.ll-badge` in renderBoard), persists until your next move. (2) The panel is now
a BOTH-SIDES meter — `🧑 You` and `🤖 [level]` parallel lifeline rows; your pips are
cashed in by following the suggested move (`prov==="followed"` → `playerFollows++`,
`playerTokens`), No-help mode shows "pure chess". (3) Moments linger 7s (was 3.8s)
with a draining `.mo-bar` countdown + tap-to-dismiss. Removed redundant chip buoys.

**Opponent scales with your lean (2026-09-28, commit c5b5fda)** — user chose this to
fix "strong levels are an easy win when you follow the top move." Root cause: the
assist recommendation is ALWAYS full-strength (Skill 20, `main.js` sfBest), so
following it outguns any sub-Master opponent by design. Fix keeps advice full-strength
& sound (no regression on "never recommend a losing move") and moves the OPPONENT
instead: `aiLean()` = indepFollowed / your-moves; `aiBoost(baseElo)` raises the
opponent's Stockfish skill toward 20 + think-time toward 1500ms in proportion to lean
(lifts the low-rung depth cap once lean>0.15). Play mostly solo → stays at your picked
level; lean hard → digs in toward full strength. VISIBLE per guardrail #1: the Glass
Lens shows an "⛏ AI matching your help" badge (tooltip states the exact % of turns you
took help). Also re-tuned the SF ladder (Expert was only Skill 14 → 18; Club 9→12;
more think time) since "Expert felt sub-expert." Ratings stay ≈ ballparks.

**Strategy system (2026-09-27/28):** the opening catalog (now 96 named lines) + 15
named **middlegame/endgame PLANS** (Minority Attack, IQP attack/blockade, opposite-
castling attack, outpost, open file, space/bind, prophylaxis, simplify; endgame:
passer, opposition, Lucena, Philidor, king activity, rook-behind-passer) live in
`web/strategies.js`, categorized by **phase + category + family + complexity**
(Beginner/Intermediate/Advanced via `complexityOf`). In-game, the Glass Lens shows a
**strategy identity strip** naming YOUR opening/plan and the OPPONENT's (attributed by
side) + phase pill — always-on awareness, every help mode. The library page
(strategy.html) groups by phase, filters by family + complexity, and demos plans from
an illustrative FEN with how-to steps.

**Phase 2 SHIPPED (2026-09-28, commit 0403d5d):** a "🧭 Plans" button in the Glass Lens
opens a Strategy picker sheet (`#planSheet` / `openPlanSheet`) filtered by phase —
opening shows a "📖 Follow the book — <Opening>" toggle (`followBook`; `bookNextMove()`
+ a follow-book rung in `pickPriority` that surfaces the book move ONLY when it equals
the engine's best, so never a book blunder), middle/endgame shows the engine's live
plans grouped by category (adopt → `pickedStrategyId`) + "Learn" links to catalog
write-ups. **Phase 3 SHIPPED (commit 05b5786):** `strategy.rs` now detects two named
structures — `minority_attack` (Carlsbad: fewer queenside pawns → push b-pawn) and
`iqp_attack` (you own the isolated d-pawn → active play), ids matching the catalog
write-ups, with passing unit tests. All three strategy phases are done.

**Still Phase 2 (NOT built):** PLAYER-side spendable lifeline budget as its own
setup mode (deferred — conflicts with existing No-help/Full/Custom modes, needs
careful UX so it doesn't clutter, [[fun-over-clever]]); discrete "show me 3 moves"
purchase; undo lifeline. See [[strength-and-handicap-model]] for AI depth→strength.
