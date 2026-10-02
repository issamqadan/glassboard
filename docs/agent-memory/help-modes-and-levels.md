---
name: help-modes-and-levels
description: "The 3 help-visibility modes, accurate opponent levels, and named/opponent strategies — direction set 2026-09-27"
metadata: 
  node_type: memory
  type: project
  originSessionId: c65ecd65-db19-49ae-aedc-6cff58478ed3
  modified: 2026-09-27T11:23:26.007Z
---

Direction from Issam (2026-09-27), applies to EVERY game — vs AI or vs human
(symmetry, [[symmetric-assistance]]):

**Three help-visibility modes** (Claude to name them, game-dev flavour):
1. **Always-shown** — help is always on screen for the enabled side. No need to
   tally "help received" (it's always there), BUT still keep the agency signal
   just built: log when the player actively TAPS a suggestion to take it.
2. **On-demand** — help is hidden; you summon it. Auto-tally how many helps
   received. THIS is where an honest independence/help count lives (you can't copy
   a move that isn't shown — resolves the provenance flaw we hit).
3. **Negotiated ("request → accept")** — start with NO help; either side may
   request help mid-game, but the OPPONENT must accept. Every grant is on the
   glass-box record. vs AI: the AI decides whether to grant (personality).

**Provenance flaw context:** basing "followed" on match (old) punished skill;
basing it on clicking the help UI (my fix, commit 5a7ab44) is gameable because the
move is visible — you can read it and play it by hand. Honest independence is only
possible in the on-demand/negotiated modes where the answer isn't shown.

**Opponent levels — MUST be honest (guardrail #3).** Issam wants levels that map
to real/official chess ratings, "100% accurate," for practice. HARD TRUTH to hold:
no engine gives 100%-accurate Elo (strength is contextual); our hand-written engine
is UNCALIBRATED. Honest paths: (a) calibrate our tiers to target Elo bands via
measurement + anchor games, labelled approximate; or (b) adopt a calibrated engine
(e.g. Stockfish WASM with UCI_Elo/skill-limit — industry standard, still only
approximate). Do NOT ship "official/accurate Elo" as a claim without measurement.
See [[strength-and-handicap-model]] (depth-based tiers, not Elo-calibrated).

**Strategies:** replace the limited hand-coded plans with a SUBSTANTIAL library of
real, named professional strategies/openings (opening book / ECO). Also show the
OPPONENT's strategy/opening they're following (whether or not they use assistance)
— extends the glass-box.

**Strategy ARCHITECTURE (Issam, 2026-09-27):** build a data-driven strategy
CATALOG abstraction — each strategy a declarative object (id, name, matcher/plan,
provenance). Design so strategies are pluggable and can later be **purchasable**
(unlock flag: built-in / premium / owned). Future: when an LLM is added, it can
**learn from either side's play, capture a strategy, and save it as a reusable
"skill"** into the catalog. So: catalog entries need a `source` (builtin | purchased
| learned) and unlock state from day one, even if everything is free/built-in now.

**Build order (small wins):** help modes (always-shown + on-demand first, then
negotiated) → named strategies + opponent-strategy display → levels accuracy (the
big architectural/honesty decision).

**SHIPPED (2026-09-27):** help modes (commit 19eaaa9), strategy catalog + library
page /strategy.html (77fa842/b99f4c7), and **Stockfish opponent (commit 4f3744c).**

**Stockfish opponent — how it's wired:** vendored **Stockfish 11 CLASSICAL** (netless,
~3.7MB: web/vendor/stockfish/stockfish.js + .wasm) as a SAME-ORIGIN Web Worker
(web/sf.js → `window.GBEngine`). Cross-origin/CDN loading was abandoned — Safari
blocks cross-origin importScripts + blob-worker self.location. SF16-NNUE was
rejected: needs a 40MB net. **This SF11 build has NO UCI_Elo** (verified live: "No
such option") — strength is set by **Skill Level (0-20)** + a depth/movetime cap on
low rungs, so level ratings are **approximate ≈ labels** (≈900…≈2500+ in AI_LEVELS),
NOT official Elo — labelled honestly. `opponentMove()` in main.js routes the AI move
to `GBEngine.bestMove(fen, {skill,movetime,depth})` with a **Rust-core fallback**;
firstGame stays on Rust. The Rust core still powers the transparent assist (dual
engine). **Handicap model shift:** with a strong SF opponent, the assist is expert
ADVICE, not the measured "follow-help-wins" handicap from [[strength-and-handicap-model]]
(which assumed both sides shared our engine). To go weaker than SF's floor or get
exact UCI_Elo later: a bigger/newer build + net, or calibrate Skill→Elo by measurement.

**Still open:** Plan Dock "guide me through the Najdorf" (wire catalog uci lines into
the in-game pickable plans) — the small follow-on after Stockfish.
