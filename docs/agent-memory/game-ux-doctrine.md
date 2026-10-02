---
name: game-ux-doctrine
description: "Governing doctrine for Glassboard's active-game UX (board sovereignty, transient assistance, zero-scroll)"
metadata: 
  node_type: memory
  type: project
  originSessionId: c65ecd65-db19-49ae-aedc-6cff58478ed3
  modified: 2026-09-17T04:07:38.292Z
---

Glassboard's active-game UX is governed by **docs/GAME-UX.md** (adopted 2026-09-17
from Issam's "Principal Game Experience Architect" brief). Read it before any
gameplay-screen change.

Core hard rules:
- **Board sovereignty** — the board gets the largest practical square the viewport
  supports; everything else negotiates for the *remaining* space. Never the leftover
  rectangle. Start layout from "max board here?"
- **No permanent panel tax** — no feature may permanently consume gameplay space just
  because it needs representation. Assistance/glass-box/strategy should be transient or
  on-demand, not always-visible cards. (The current fixed right-rail panels are a known
  violation to redesign.)
- **Zero-scroll move loop** — board + essential state + interaction in one viewport.
- **Layout stability** — assistance appearing must not move/resize the board (overlays,
  reserved micro-regions).
- **Progressive agency** — reveal the least that lets the human keep thinking; assistance
  fades as skill grows; let a strong move land in silence.
- **Game mode ≠ website mode**; portrait/landscape mobile each get their own layout, not a
  rescaled desktop.

**Why:** this is the product's identity (assisted, transparent chess) — protect the board
as sacred gameplay space; more capability should mean *less* UI, not more.
**How to apply:** for every gameplay change, run the board-dimensions before/after review
in docs/GAME-UX.md across the six viewports. Relates to [[player-model-learning-signal]].
