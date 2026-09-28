# Code review — Strategy system + symmetric assistance

**Date:** 2026-09-28 · **Status:** 📌 Pinned for review · **Live at:** commit `05b5786a`

Code-level breakdown of the strategy system (Phases 1–3), the symmetric AI-scaling
fix, and the follow-the-book soundness gate shipped on 2026-09-28. What / where / why,
with the key snippets. The through-line: **advice stays sound; fairness comes from
moving the opponent or naming the plan — never from weakening the tip or hiding help.**

---

## 1. Symmetric AI scaling — the opponent rises as you lean on help
**Where:** `web/main.js` — `aiLean()`, `aiBoost()`, `opponentMove()`, `glIdentityRow()`

```js
function aiLean() {                 // 0..1 = share of your moves that took the suggestion
  const yours = indepOwn + indepFollowed;
  return yours > 0 ? indepFollowed / yours : 0;
}
function aiBoost(baseElo) {
  const lvl = sfLevelFor(baseElo);
  const lean = aiLean();
  const skill = Math.min(20, Math.round(lvl.skill + lean * (20 - lvl.skill)));
  const movetime = Math.round(baseMt + lean * (1500 - baseMt));
  const depth = lean > 0.15 ? undefined : lvl.depth;   // lift the low-rung depth cap once you lean
  return { lean, skill, movetime, depth, base: lvl.skill, boosted: skill > lvl.skill };
}
```

- **What:** the opponent's Stockfish skill/time interpolate from your chosen level
  toward full strength, in proportion to `lean`. `opponentMove()` calls `aiBoost()`
  for the base reply (the per-move pressure "lifeline" still spikes to full strength).
- **Why:** diagnosis of "Expert = easy win" — the assist always hands you Skill-20
  (~2500) moves, so following them outguns any sub-Master opponent. Rather than weaken
  the advice (which would reintroduce "recommends a losing move"), we move the
  *opponent*. `indepFollowed`/`indepOwn` already existed from the provenance system, so
  `lean` is free and accurate.
- **Transparency half** (`glIdentityRow`): when `aiBoost().boosted`, the Lens renders
  `⛏ AI matching your help` with a tooltip stating the exact % of turns you took help —
  guardrail #1 (no hidden help) turned into a visible signal.

---

## 2. Follow-the-book soundness gate
**Where:** `web/main.js` — `bookNextMove()` and a rung in `pickPriority()`

```js
function bookNextMove() {
  const op = currentOpening();
  if (!op || !op.uci || op.uci.length <= uciHistory.length) return null;  // book exhausted
  for (let i = 0; i < uciHistory.length; i++)
    if (op.uci[i] !== uciHistory[i]) return null;                          // line diverged
  const u = op.uci[uciHistory.length]; const q = uciToSquares(u);
  return q ? { uci: u, from: q.from, to: q.to } : null;
}
// inside pickPriority(), after the picked-plan rung:
if (followBook) {
  const bn = bookNextMove(), op = currentOpening();
  if (bn && op && bn.uci.slice(0, 4) === recUci.slice(0, 4))             // ← the gate
    return { move: rec, label: `Book: ${op.name}`, why: op.idea, tag: "Book · best", kind: "strategy" };
}
```

- **What:** while "Follow the book" is on, the Lens headlines the book's next move —
  **but only when it equals `sfBest`** (`recUci`). Otherwise this rung falls through to
  the normal recommendation.
- **Why:** satisfies both guardrails at once — you get the *named* opening plan
  (education) *and* it can never talk you into a book move that's actually a blunder
  (soundness). `recUci` is already the Stockfish full-strength move from the "root fix,"
  so the equality check is the whole safety mechanism.

---

## 3. The two new Rust detectors
**Where:** `core/assist/src/strategy.rs` — a helper + two blocks in `strategize()`

```rust
fn pawns_on_file(b: &Board, color: Color, file: i32) -> i32 { /* count */ }
fn has_pawn_on_file(b, color, file) -> bool { pawns_on_file(..) > 0 }

// Minority attack (Carlsbad): you have fewer queenside pawns
if ph != "opening"
    && !has_pawn_on_file(b, side, 2)   // you have NO c-pawn
    && has_pawn_on_file(b, opp, 2)     // they still have theirs
    && has_pawn_on_file(b, side, 1) {  // and you have a b-pawn to push
    let rec = plan_move(ranked, top_score, |m|
        kind_at(b, m.from) == Some(Pawn) && file_of(m.from) <= 1 && forward_pawn(b, m, side));
    // → push "minority_attack" with a queenside-pawn-push plan move
}

// Your own IQP: isolated pawn on the d-file → play actively
if let Some(&dp) = isolated_of(b, side).iter().find(|&&s| file_of(s) == 3) {
    let rec = plan_move(ranked, top_score, |_| true);  // your best active continuation
    // → push "iqp_attack"
}
```

- **What:** pure board-reading. Minority attack keys off pawn-file counts (fewer
  queenside pawns than the opponent); IQP reuses `isolated_of()` restricted to the d-file.
- **Why:** heuristic structural reads, so per the vision they're framed as "suggested
  plans," and every plan's move goes through `plan_move()`, which stays within the
  engine's blunder guard (the `plans_never_recommend_a_blunder` test enforces this).
- **Connects:** ids (`minority_attack`, `iqp_attack`) match the catalog `PLANS` entries,
  so an in-game detected plan links straight to its written lesson.
- **Locked by tests:** `carlsbad_offers_the_minority_attack` +
  `own_isolated_d_pawn_offers_active_iqp_play` (13 strategy tests pass; full workspace builds).

---

## 4. Supporting cast
- **Strategy identity** (`strategyIdentity()` / `glIdentityRow()`): fuses
  `currentOpening()` (attributed by the opening's `side`) + engine `phase`/top-plan/
  `opponent` read into the two-sided strip. Rendered in *every* Lens state because it's
  awareness, not a gated move answer.
- **Picker sheet** (`openPlanSheet()`): mirrors the existing `altSheet`/`glassSheet`
  pattern; groups live Rust plans by `themeMeta().cat`, adds the book toggle up top and
  catalog "Learn" links below.
- **Complexity** (`complexityOf()` in `web/strategies.js`): pinned map for plans +
  sharp/easy openings, else derived from catalog line depth — a transparent heuristic,
  not a claimed rating.

---

## Commits (2026-09-28)
- `01e9d82` — draw-seeking strategy ("Play for a draw" / "Repeat for a draw")
- `4c4dceb` — strategy identity in-game + taxonomy + 49 advanced openings (96 total)
- `aa09a38` — named middlegame/endgame PLANS in the library (grouped by phase)
- `9d40f16` — strengthen the opponent ladder (Expert 14→18, etc.)
- `c5b5fda` — symmetric AI scaling (aiLean/aiBoost + `⛏ AI matching your help`)
- `f55d390` — complexity levels + filter (Beginner/Intermediate/Advanced)
- `0403d5d` — Phase 2: in-game Strategy picker + follow-the-book gate
- `05b5786` — Phase 3: engine detects minority attack + your isolated d-pawn (+ tests)
