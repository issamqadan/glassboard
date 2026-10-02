---
name: ui-lockdown
description: "UI is locked as a stable baseline (git tag ui-lockdown-v1) — tweaks only, no structural churn"
metadata: 
  node_type: memory
  type: project
  originSessionId: c65ecd65-db19-49ae-aedc-6cff58478ed3
  modified: 2026-09-28T13:35:04.533Z
---

As of 2026-09-28 Issam declared the Play-AI UI "locked down" — it's very close and now
just needs **tweaking**, not restructuring. Baseline is git tag **`ui-lockdown-v1`**
(commit `01e9d82e`), pushed to origin.

Locked surface: board-sovereign layout ([[game-ux-doctrine]]), tap-only Glass Lens HUD
with board-native recommendation arrow, provenance move list, captured-beside-names
(the cheesy material slider is gone), three help modes, Stockfish opponent+advisor,
repetition-aware engine + threefold-draw detection, and the player-facing "Play for a
draw" strategy ([[assist-priority-doctrine]]).

**How to apply:** prefer small, targeted tweaks over layout/architecture changes on the
active-game screen. If a change would restructure the locked surface, flag it and get
Issam's OK first rather than churning the UI.
