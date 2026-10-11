# Glassboard — Unified Experience & Assistance Redesign (Phase 1 proposal)

**Status:** proposal for review. **No code has been changed for this.**
**Date:** 2026-10-11 · Anchors to [VISION.md](VISION.md), [POC.md](POC.md), [GAME-UX.md](GAME-UX.md).

---

## 0. Vision check — what the brief leaves out

Issam asked (2026-10-11) whether this brief changes the game's vision. Checked
against [VISION.md](VISION.md) line by line. The answer matters, so it is recorded
here rather than in chat.

**The brief does not contradict the vision. It is silent on the thing that defines
the product**, which over a long redesign is how a product drifts.

Read the brief closely and assistance is a private service between one player and
the app: *"Recommend a suitable next move · Explain the reasoning · Allow the
player to accept, inspect, or dismiss."* Nowhere in nine parts and seven user
journeys does the opponent see any of it. There is no mention of:

- **the glass box** — guardrail #1, "no hidden help, ever; any assistance a player
  receives must be visible to their opponent". This is the entire premise:
  *"Chess, in the open."*
- **the handicap** — assistance sized to the rating gap, which is what makes an
  unequal game fair and is the one thing the POC exists to prove.
- **symmetry** — the opponent is rationed too, asks for more, and can refuse you.
- **the ladder down** — guardrail #4, that help should fade as you improve.

Implemented literally, Glassboard becomes a very good chess app with a very good
private coach. That is a different product, and a crowded one.

**Where the brief is right and sharpens the vision:**

- Strategy as persistent, reassessed game state is *exactly* guardrail #4 ("prefer
  designs that help players improve"). A plan you can follow and have re-explained
  teaches more than a move ever will. Its own line — *"a move tells the player what
  to do; a strategy teaches the player what they are trying to achieve"* — could
  have come from VISION.md.
- Separating domain state from presentation state is what fixes the plan-erasure
  bug in §1.3. Good engineering, and it serves the product.
- Board-primary, mobile-first matches the board-sovereignty doctrine in
  [GAME-UX.md](GAME-UX.md).
- Conventional time controls are overdue and vision-neutral.

**The guardrail attached to every item in this plan, therefore:**

> Each assistance surface must remain visible to the opponent and stay sized to the
> agreed handicap. Nothing in this redesign may make help private, unmetered, or
> asymmetric.

Concretely, during Steps 1–3: the glass-box log, the shared assistance contract at
The Table, the gap-sized credits and the symmetric asking all stay exactly as they
are. **No step may be implemented in a way that detaches assistance from the
opponent's view.** If the visual redesign later needs space, the glass box is not
where it comes from.

## 0b. Device coverage is a hard constraint, not a goal

Also asked: does this keep working on every screen? Treated as a non-negotiable,
because it is one (vision non-negotiable #5, device-agnostic and first-class), and
because it has already broken twice — a 824px board on a 393px-tall iPhone in
landscape, and 740px on a 640px-tall unfolded foldable.

Rules for this work:

- **Steps 1–3 add ZERO new above-board chrome.** The clocks already live inside the
  cockpit strips, which are fixed at 38px; the time control is shown inside an
  existing fixed-height row. No new row, no height change, so the board cannot move
  and nothing new can be clipped.
- `scripts/check-board-stability.sh` (9 invariants) must pass at every increment,
  and runs on pre-commit.
- The board keeps its two-axis cap `min(100vw−28, max(248, 100dvh−300))`, verified
  across phone portrait/landscape, foldable folded/unfolded, and tablet.
- The time-control picker lives in the full-screen setup card, which already
  scrolls — so a long preset list cannot push the board anywhere.

---

## 1. Current-state assessment

Verified by reading the code, not by reading the UI. Three findings change the scope.

### 1.1 Human games have no clock at all

`web/multiplayer.js` contains **no clock code whatsoever** — no timer, no remaining
time, no flag-fall. The server stores a `minutes` field (added 2026-10-06 for the
Challenge Board) and `GameSummary` reports it, but **nothing runs it**.

So a challenge posted as "10 min" produces an untimed game. That is a live instance
of the exact bug class we have been hunting all week: the UI promises something the
code does not do. It is mine, and it is the single largest gap here.

### 1.2 There is no increment anywhere

Zero occurrences of `increment` in the codebase. Play-AI has `setupMinutes` only —
a single starting figure, no per-move addition. **The entire time-control table in
the brief (1+0 … 60+0) is net-new**, including the data model, not just presets.

### 1.3 The active strategy is deliberately erased

`web/main.js:2335`:

```js
if (pickedStrategyId && !sr.strategies.some((s) => s.id === pickedStrategyId)) pickedStrategyId = null;
```

Every repaint, if the engine's *candidate* list for the current position no longer
contains your chosen plan, the plan is silently dropped. This is precisely the
brief's objection: the active strategy is living in render-derived state rather
than game state. Confirmed, reproducible, and the root cause of "my plan
disappeared".

### 1.4 What already works and must be preserved

| Area | State |
|---|---|
| Rust engine, move-gen, search, WASM core | Solid. Do not touch. |
| Stockfish opponent, skill levels, personas | Works; level ↔ skill mapping is measured. |
| Play-AI clock | Accurate within its own rules (see 1.5). Renders on each player's cockpit strip — already what Part II asks for. |
| AI is charged for its own thinking | ✓ `tickClock` debits `engineMs` on the engine's turn. |
| Assistance credits (help tokens) | Built 2026-10-09/10. Gap-sized, counted, negotiable, server-authoritative in human games. |
| Takeback allowance | Same model, both game types. |
| Strategy library + capture | 112 openings, 15 plans, 6 motif detectors, 🧠 Learned shelf. |
| Glass-box log, recap, earned rating | Working in both game types. |
| Board sovereignty guards | `scripts/check-board-stability.sh`, 9 invariants. |
| Web test suite | `scripts/test-web.sh`, 23 tests, runs on pre-commit. |

### 1.5 Clock correctness gaps (Play-AI)

```js
if (document.hidden || dt > 2000) dt = 0;   // main.js:1870
```

Deliberate: "don't charge time the player didn't spend at the board". Consequences:

- **Backgrounding the app stops your clock.** Friendly for an untimed practice
  game; a straightforward cheat vector in a 5+3 blitz game.
- Uses `Date.now()`, not a monotonic source. A system clock change corrupts timing.
- **Flag-fall does not adjudicate insufficient mating material.** `insufficient` is
  handled as a *game status* (`main.js:2070`) but on a flag the winner is simply
  the other side. By FIDE, flagging against a bare king is a draw.
- No increment, so no "applied after a completed move" semantics to get right yet.
- Illegal moves can't affect clock ownership (the board rejects them before any
  clock code runs) — so that requirement is already satisfied.

### 1.6 The real mobile vertical budget

This is why assistance scrolls. Measured from the CSS, not estimated.

| Element | Height |
|---|---|
| Shared nav | ~56 |
| Game bar (`height:44px` + 8 pad) | 52 |
| Opponent cockpit strip (38 + 6) | 44 |
| Strategy strip (`height:34px` + 8) | 42 |
| **Board** | `min(100vw−28, max(248, 100dvh−300))` |
| Your cockpit strip (38 + 6) | 44 |
| Glass Lens | **variable** — flex column, content-driven, ~120–220 |

On a 393×852 iPhone with ~760 usable `dvh`: board = 365 (width-capped), fixed
chrome = 238, Lens ≈ 160 → **763 needed vs 760 available**. With the toolbar
expanded (~660 dvh) it overflows by ~100px.

**The Lens being variable-height is the defect.** The board reserves a fixed 300px;
the Lens is free to exceed it. That is the scrolling.

---

## 2. UX recommendation — the unified model

One sentence: **the board plus two clocks is the fixed stage; everything advisory
lives in a single fixed-height dock with a sheet for depth.**

Three principles, each derived from a finding above:

1. **Nothing advisory may have variable height in the fixed layout.** Depth goes in
   a sheet, never in the always-on row. (Fixes 1.6.)
2. **Move and Strategy are two tabs of one dock, not two panels.** Equally
   discoverable, never competing for vertical space.
3. **The active strategy is game state.** It survives repaints, sheet open/close,
   tab switches, orientation changes, resumes, and a position where it is not among
   the candidates — in which case it is marked *needs reassessment*, not deleted.
   (Fixes 1.3.)

---

## 3. Mobile: two candidate patterns compared

Budget: 393×852 device, **660 dvh worst case** (Safari toolbar expanded).
Fixed cost in both options: nav 56 + two strips 88 = **144**.

### Option A — Fixed two-line Assist Dock + bottom sheet *(recommended)*

```
┌─────────────────────────────────────┐
│ ☰ Glassboard            ⚙       56 │
├─────────────────────────────────────┤
│ ● Luna Flip  ♛×1 ♟×2   +3   4:58 44│  opponent strip (clock here)
├─────────────────────────────────────┤
│                                     │
│                                     │
│            B O A R D           365  │  min(vw−28, max(248, dvh−300))
│                                     │
│                                     │
├─────────────────────────────────────┤
│ ● You  ♞×1   💪1484  🤝 6/8  9:12 44│  your strip (clock + allowance)
├─────────────────────────────────────┤
│ ⟨ Move ⟩  Strategy        🧭 ▲   38 │  tab row — FIXED
│ Nf5 — forks the queen and rook   38 │  one line, ellipsised — FIXED
└─────────────────────────────────────┘
   total 144 + 365 + 76 = 585  ✓ fits 660 with 75px spare
```

Tap the dock (or ▲) to raise a sheet over the *lower* board only:

```
├─────────────────────────────────────┤
│            B O A R D                │  top half stays visible
│   ↗ arrow still showing the move    │
├═════════════════════════════════════┤
│ ⟨ Move ⟩  Strategy              ✕   │
│                                     │
│ ♞ Nf5                      ▶ Play   │
│ Forks the queen on d6 and the rook  │
│ on h6. They can only save one.      │
│                                     │
│ Costs 1 of your 6 help tokens       │
│ ⋯ other moves      👁 show on board │
└─────────────────────────────────────┘
```

**Why this wins:** the dock's collapsed state is *useful on its own* — move or plan
plus one line of why — so most turns never need the sheet. The sheet covers only
the board's lower half, so the piece under discussion usually stays visible.

**Costs:** 76px permanently; two lines is tight for strategy reasoning; needs
careful safe-area handling.

### Option B — One-line Assist Bar + full-screen assistance view

```
│ 🤝 Nf5 · forks Q+R        [Move|Plan] 40 │   total 144+365+40 = 549
```

Tapping opens a **full-screen** assistance page (board hidden).

**Pros:** 36px cheaper; unlimited room for teaching content; simplest layout.
**Cons:** decisively worse for chess — the explanation is separated from the
position it describes, which breaks "board-linked assistance" (Part IV §11). Every
consultation becomes a context switch. In blitz that is fatal.

### Option C (considered, rejected) — assistance as board overlays only

No dock; everything is arrows, square tints and a transient toast. Cheapest
vertically and most elegant for strong players, but there is nowhere to put *why*,
which is the entire educational premise. Rejected as a primary pattern; its
mechanics are retained as the board-linked layer of Option A.

**Recommendation: Option A.** B's saving is 36px and it costs the product its
teaching value. Keep C's overlays inside A.

---

## 4. Desktop

Same conceptual model, more room — not the same layout.

```
┌──────────────────────────────────────────────────────────────────┐
│ ☰ Glassboard                                              ⚙      │
├──────────────────────────────────────────────┬───────────────────┤
│ ● Luna Flip   ♛×1 ♟×2    +3        4:58      │  ⟨ Move ⟩ Strategy│
├──────────────────────────────────────────────┤                   │
│                                              │  ♞ Nf5    ▶ Play  │
│                                              │  Forks the queen  │
│                  B O A R D                   │  and rook…        │
│          min(820, 100dvh−244, 100vw−360)     │                   │
│                                              │  ── Active plan ──│
│                                              │  🧭 Kingside       │
│                                              │  attack  ●●○○     │
├──────────────────────────────────────────────┤  Now: get the     │
│ ● You  ♞×1  💪1484  🤝 6/8          9:12     │  knight to f5     │
├──────────────────────────────────────────────┤                   │
│ 🧭 Sicilian — Najdorf · their plan: …        │  📜 Glass log     │
└──────────────────────────────────────────────┴───────────────────┘
```

Both tabs live in the rail simultaneously (Move on top, Active plan beneath), so
desktop needs no tab switching at all — the tabs exist only to keep the mental
model identical to mobile.

---

## 5. Game setup wireframe

Extends the existing full-screen setup card (already has Opponent / Style / Colour
/ Time / Assistance / Delivery) rather than replacing it.

```
   Set up your match
   ┌───────────────────────────────────────────┐
   │ OPPONENT    [🤖 The AI]  [👤 A human]     │
   ├───────────────────────────────────────────┤
   │ AI LEVEL    🌱 ♟ ♞ ⚔ ★ 👑                 │  (existing 6 rungs)
   │ STYLE       ⚖ 🔥 🧠 🛡 🎲                  │  (existing 5)
   ├───────────────────────────────────────────┤
   │ TIME CONTROL                              │
   │  Bullet    [1+0] [1+1] [2+1]              │
   │  Blitz     [3+0] [3+2] [5+0] [5+3]        │
   │  Rapid     [10+0]* [10+5] [15+10] [30+0]  │  * default for new players
   │  Classical [30+20] [60+0]                 │
   │  [ Custom… ]   [ ⏱ No clock ]             │
   ├───────────────────────────────────────────┤
   │ YOU PLAY    [♔][♚][🎲]                     │
   │ ASSISTANCE  ⚖️ Match my opponent (default) │
   │             ♾️ Full help   🚫 None  🎚️ Pick │
   │   → You 1200 vs ★ Expert — 1100-pt gap,    │
   │     so you get Assist · 8 help tokens      │
   └───────────────────────────────────────────┘
            [ Start match → ]
```

For a human game the same card is the **challenge poster**, and the time control
becomes part of the signed contract at The Table.

---

## 6. Strategy lifecycle

Five states, stored on the game, never derived from the UI.

```
          ┌──────────────┐
          │  CANDIDATE   │ engine says it fits this position
          └──────┬───────┘
         player activates
          ┌──────▼───────┐
   ┌──────│    ACTIVE    │──────┐
   │      └──────┬───────┘      │
   │   position still supports  │ position no longer supports it
   │      ┌──────▼───────┐      │   ┌──────────────────┐
   │      │  ADVANCING   │      └──▶│ NEEDS REASSESS   │
   │      └──────┬───────┘          └────┬────────┬────┘
   │        objective met          adapt │        │ abandon
   │      ┌──────▼───────┐               │        │
   │      │  COMPLETED   │◀──────────────┘        ▼
   │      └──────────────┘                  ┌───────────┐
   └────────────────────────────────────────│ REPLACED  │
                                            └───────────┘
```

Rules:

- **`NEEDS REASSESS` is the fix for 1.3.** When the plan is no longer among the
  candidates we move to this state and say why — we never null the plan.
- **No invented percentages.** The pips already shown are the engine's own
  `step.done` booleans, which are real. Nothing else is implied.
- **A tactical request never discards the plan.** The dock reports the
  relationship: *supports the plan* / *necessary defence, plan intact* / *plan is
  no longer sound*. This is already the behaviour of the safety ladder (safety
  outranks the plan — the fix for the lost-queen blocker); the redesign makes it
  **legible** instead of silent, which is the real improvement.

---

## 7. Component architecture

Reuse is the default. New modules only where a genuine concept is missing.

| Module | Action | Notes |
|---|---|---|
| `core/*` (Rust/WASM) | **untouched** | engine, search, assist, strategy |
| `web/gb-terms.js` | reuse | the one handicap ladder |
| `web/gb-help-budget.js` | reuse | credits, takebacks, verdicts, advice |
| `web/gb-assist-ui.js` | reuse + extend | `moveMeaning`, `pickPriority`, strips, tray |
| `web/gb-board-input.js` | reuse | tap + physics drag |
| `web/gb-resign.js`, `gb-sound.js`, `gb-recap.js`, `gb-capture.js` | reuse | |
| **`web/gb-clock.js`** | **NEW** | time control model + monotonic engine; one implementation for both game types |
| **`web/gb-strategy-state.js`** | **NEW** | the lifecycle in §6, persisted with the game |
| **`web/gb-dock.js`** | **NEW** | the Move/Strategy dock + sheet; pure render over injected ctx, like `gb-board-input.js` |
| `web/main.js` | modify | delegate clock + strategy + dock; delete the retired panels |
| `web/multiplayer.js` | modify | same three; gains a clock for the first time |
| `server/src/main.rs` | modify | authoritative clock per room; `increment` column |
| `web/style.css` | modify | dock, sheet, clock states; retire `#planDock`, dead `renderClocks` tail |

Retire: `#planDock` (already dead-code early-returned), the dead tail of
`renderClocks` after `if (true) return;`, and the legacy `#clocks` row.

---

## 8. State-management design

Five stores, with the brief's separation enforced by *where they persist*:

```
GameState        board FEN · turn · legal moves · status · seats · history
   ↳ persists: server (human) / localStorage + /ai-games (AI)

ClockState       control {initialMs, incrementMs} · remainingMs{w,b} · activeSide
                 · lastTickAt (monotonic) · flagged
   ↳ persists: server (human, AUTHORITATIVE) / with the AI game record

AssistState      credits {max,left,spent,asked,granted} · pending request
                 · current move recommendation + why
   ↳ persists: server (human, already authoritative) / AI game record

StrategyState    activeId · objective · whyApplicable · lifecycle state
                 · currentStep · lastReassessedAtPly
   ↳ persists: WITH THE GAME. This is the 1.3 fix.

PresentationState  dock tab · sheet height · overlays · layout breakpoint
   ↳ persists: nowhere. Resets freely; must never carry game meaning.
```

The hard rule: **nothing in PresentationState may be read to decide game
behaviour, and nothing in the other four may be reset by a UI event.** The four
bugs found in the 2026-10-10 sweep (`scored`, `capturedLesson`, `lastScore`,
`assistFen` not reset on resume) were all violations of the second half; 1.3 is a
violation of the first.

---

## 9. The seven journeys

| | Journey | How it plays out | Gaps it depends on |
|---|---|---|---|
| **A** | Beginner, 10+0 vs AI | Default assistance is ⚖️ Match-my-opponent → Assist rung. Dock shows `♞ Nf5 — forks the queen and rook`; arrow on board; tap ▶ to play. One token spent, shown. | clock increment model |
| **B** | 15+10, learn a plan | Dock → Strategy tab lists candidates with objective + why-now. Activate → dock collapses to `🧭 Kingside attack ●●○○ · now: knight to f5`. Each turn's move is labelled *advances the plan*. | strategy lifecycle |
| **C** | Opponent defends | Plan leaves the candidate set → state becomes **NEEDS REASSESS**; dock turns amber: *"They've put a knight on f6 — the attack has no entry square. Adapt (queenside) or keep probing?"* Plan is **not** deleted. | 1.3 fix |
| **D** | Tactic during a plan | Move tab answers independently and states the relationship: *necessary defence — your plan is intact*. Strategy tab unchanged. | relationship labelling |
| **E** | Mobile 5+3 blitz | Option A: 585 of 660px used. Both clocks and board always visible; dock answers without a sheet; no scrolling. **See §10 on whether blitz should allow assistance at all.** | dock + clock |
| **F** | Library, no side effects | Strategy library opens in review mode. Activation is a separate explicit button. Browsing cannot replace an active plan. | lifecycle states |
| **G** | <10s left | Clock goes critical (colour + optional tick). Assistance stays dismissible, never auto-charges, never pauses the clock. Sheet auto-collapses under 10s so the board is unobstructed. | clock states |

---

## 10. Tradeoffs and open questions — **decisions needed**

**Q1. Does backgrounding stop your clock?** Today it does, deliberately
(`main.js:1870`). Honest in an untimed game; a cheat vector in blitz.
*Recommend:* strict monotonic charging in any timed game, server-authoritative for
human games; keep the forgiving rule only when there is no clock.

**Q2. Bullet + assistance is not viable, and I'd rather say so than ship it.**
Measured: the full-strength advice search is 500–1400ms, the Stockfish opponent up
to 1400ms, serialized on one channel. In a 1+0 game that is most of the clock.
*Recommend:* ship Bullet **with assistance unavailable** and label it ("Bullet is
you alone"), or omit Bullet from v1. Shipping 1+0 with a 1.4s advisor would be the
same genre of bug as a counter that doesn't count.

**Q3. Who owns the human-game clock?** It must be the server (clients cannot be
trusted and games here span days). That is real work: per-room clock, tick on move,
increment on completion, flag detection without a client connected.
*Recommend:* server-authoritative, with the client rendering a smoothed local
estimate between state pushes.

**Q4. Does Open Hand charge a token every move?** It does now, automatically, since
help appears unasked. The brief says never charge for *opening a panel* — this
isn't that, but it is close enough to confirm.
*Recommend:* keep, because Open Hand genuinely delivers the answer each turn — but
make the setup copy say so (it now does).

**Q5. Flag-fall against insufficient material.** Currently a loss; by FIDE a draw.
*Recommend:* implement the draw. Small, and it is a correctness claim we make.

**Q6. How much of the game bar survives?** Option A's budget assumes the top game
bar is **gone** on mobile (its actions move into the dock and ⚙). That is 52px and
the difference between fitting and scrolling.
*Recommend:* yes, remove it on mobile. Needs your sign-off since it is visible
structure and `ui-lockdown-v1` says tweaks only.

**Q7. Do we show the opponent's help allowance?** Glass-box says yes (symmetry).
Space says the strips are already full.
*Recommend:* show it on the opponent strip only when they have spent or asked.

---

## 11. Suggested sequencing (post-approval)

Each step independently shippable and testable; the riskiest correctness work
first, the visible restructure last.

1. **`gb-clock.js` + the time-control model** (increment, monotonic, flag
   adjudication incl. Q5) — Play-AI first, where it can be verified end-to-end.
2. **Server-authoritative clock for human games** (Q3) — closes finding 1.1, the
   live false promise.
3. **`gb-strategy-state.js`** — closes finding 1.3. No visual change; fixes the
   "my plan vanished" complaint on its own.
4. **`gb-dock.js` on mobile** (Option A) — closes finding 1.6.
5. **Desktop rail** reusing the same dock modules.
6. **Setup card** gains the time-control groups; The Table gains the clock terms.

Steps 1–3 are correctness and would be worth doing even if the visual redesign
were rejected outright.
