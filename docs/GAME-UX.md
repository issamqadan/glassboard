# Glassboard — Game Experience Doctrine

> Governing design doctrine for the **active game** experience. Derived from the
> Principal Game Experience Architect brief (2026-09-17). When a gameplay-screen
> change conflicts with this doc, this doc wins. Read before any gameplay UI work.
> Anchors to [VISION.md](VISION.md) (assistance = transparent, adjustable, fading).

## The one line
**Different levels. One game.** Minimum useful intervention to keep a game
competitive while preserving human agency. The board is the stage; everything
else is supporting cast that must *earn* its place.

## Hard rules (non-negotiable)

1. **Board sovereignty.** During active play the board gets the **largest
   practical square the viewport supports**. Start every layout question with
   "what is the max comfortable board here?" — then everything else negotiates
   for the *remaining* space. The board is never the leftover rectangle.
2. **No UI regression.** No feature may *permanently* consume gameplay space just
   because it needs representation. New info → do NOT add another container
   around the board. Report board dimensions before/after for every change.
3. **Zero-scroll move loop.** board + essential state + primary interaction fit
   in **one viewport**. Scrolling is only for secondary/on-demand info, never
   part of the normal board → assist → act loop.
4. **Layout stability.** Assistance appearing must not move/resize the board.
   Use overlays, reserved micro-regions, transient layers. The board is physically
   stable.
5. **Game mode ≠ website mode.** In active play, nav recedes, branding goes
   minimal, decoration disappears, the board dominates. Entering a game is like a
   game starting gameplay, not a page navigating.

## Four spatial classes (classify info before placing it)
- **Board-native** (legal targets, selection, last move, threats, candidates,
  regions) → show **on/around the board**.
- **Glanceable** (whose turn, clocks, assist level, opponent assist) → compact,
  persistent-but-tiny.
- **Transient** (a threat, a hint, an assist event, a beginner nudge) → appear,
  communicate, **disappear**. "Does it need to *exist* or need to *remain
  visible*?" are different questions.
- **On-demand** (full glass-box log, move history, settings, profile, analysis)
  → reachable, **never** permanently board-adjacent.

## Assistance = a game mechanic (not a toolbar, not a panel)
- **Bring intelligence to the board**, don't send the player to a panel: square
  illumination, piece emphasis, directional traces, transient arrows, halos,
  compact floating cues, edge indicators, progressive overlays. Keep the board
  readable as chess.
- **Progressive disclosure of agency** (reveal the least that lets them keep
  thinking): "something is vulnerable" → "your bishop is" → region → candidates →
  best move → autopilot. The player should feel *"I found it,"* not *"the computer
  played it."*
- **Assistance fades** as skill emerges. Independence is progression. The best
  interaction can be none. **Let a strong move land in silence.**
- One assistance control with **progressive depth**, not six buttons. Explore
  contextual/press-hold/radial/adaptive surfaces. Make sophistication feel simple.

## The glass-box is a mechanic, not telemetry
Transparency is fundamental but does **not** mean a permanent card per event.
`event → visible acknowledgement → compact trace → history (on-demand)`. The
opponent must grasp *"Glassboard helped them there"* without the board becoming a
developer log. Invent a recognizable transparency language.

## Portrait mobile is its own experience
`minimal opponent state → maximum-width board → minimal current-player state /
essential action`. No permanent side panels. Everything else is contextual,
transient, collapsible, sheet/overlay, or summoned by intent. Board dominates.

## Landscape mobile is its own experience
Not a rotated portrait. Vertical height is scarce: board takes the max square the
height allows, secondary info goes lateral, nav/decoration becomes minimal.

## Responsive = behavior, not just CSS
At breakpoints the **representation** may change entirely while the information
architecture stays constant: a desktop glass-box panel becomes a mobile transient
event; a strategy area becomes an overlay; a label becomes an icon; a toolbar
becomes one contextual control; a persistent element becomes on-demand.

## Beginner / first game (the zero-chess-knowledge test)
Teaching the **interface** ≠ teaching chess. A true beginner learns by guided
action: pulse a piece → "touch this" → show legal squares → "touch one" → it
moves → "that's your first move." `action → understanding → tiny explanation →
next action`, never `docs → memorize → play`. A first game should be possible from
a shared link with no account, config, ratings, modals, or tutorials.

## Player model & modes
- Model capability dimensions (interface familiarity, legal-move/check/capture/
  hanging awareness, tactics, positional, strategic, independence), not just Elo.
  The UI adapts as capability emerges; Glassboard *quietly learns when to leave
  the player alone*.
- **Match** = assistance set by the skill gap (fair, transparent, consistent).
  **Casual** = free experimentation across the spectrum. Distinct, not separate
  products. Invitation stays magical: create → share link → open → play.

## Visual direction
Premium, calm, intelligent, tactile, precise, modern, slightly magical. "Glass" =
transparency, not an excuse for glassmorphism. Avoid generic AI gradients, neon,
card proliferation, gratuitous blur, sci-fi clichés. The position stays instantly
legible. Motion/audio/haptics communicate causality, danger, opportunity, turn,
progress — always calm.

## Required review after every gameplay UI change
Report, for desktop landscape / laptop / tablet portrait+landscape / phone
portrait+landscape:
- **Board:** did it shrink? by how much? why? avoidable?
- **Viewport:** does the move loop fit without scrolling? small phone? expanded
  browser chrome (use dvh + safe-area, not 100vh)? landscape?
- **Assistance:** does it move/resize the board or obscure pieces? could it
  disappear after being understood?
- **Touch:** pieces comfortably selectable? legal targets obvious? controls not
  competing with the board?
- **Cognitive load:** what *permanent* info was added? could it be contextual?

Treat unexpected board shrinkage as a UX regression — do not rationalize it.

## The test
Not "can the user see every feature?" but **"can the user forget the interface
exists and become absorbed in the game?"** The more capable Glassboard becomes,
the *less* UI it should require.
