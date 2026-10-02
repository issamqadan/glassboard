---
name: glass-hud-concept
description: "The 'pattern-worthy' next-leap concept for mobile assistance UI — board-native HUD, Assist Dock, help-duel bar"
metadata: 
  node_type: memory
  type: project
  originSessionId: c65ecd65-db19-49ae-aedc-6cff58478ed3
  modified: 2026-09-27T14:15:04.303Z
---

Issam wants the assistance/glass UI to be INNOVATION-award ("pattern") worthy on
mobile, not just tidied. Current state (commit ad2dd38): slim Glass card (two
lifeline gauges + 🔥 solo-streak + opening + 📜 Log bottom-sheet), Suggested Moves
reordered under the board. Good, but not yet the leap.

**The proposed leap — "Glassboard HUD" (assistance as a game HUD, not text panels):**
1. Board-first: the board owns the screen; kill stacked panels below it.
2. Assistance is SPATIAL — painted ON the board: recommended move = glowing arrow,
   threats = pulsing rings, plan = a faint path; tap a lit square to play. (We
   already have a planOverlay SVG + threat/hanging square classes to build on.)
3. Thumb "Assist Dock": one slim bottom bar of icon power-ups — 💡 Best move ·
   🧭 Plan · ⚠️ Danger check · 🎚 Flavors. Tap to summon that help onto the board;
   in On-Call each tap is a counted lifeline. Long-press = detail sheet.
4. "Help duel" bar: one top HUD strip = You vs AI lifelines as health bars; the
   AI's flashes when it digs deep. Symmetric glass, gamified.
5. Glass log = swipe-up sheet (already built) — the receipts.

Core pattern: assistance becomes SPATIAL + GAMIFIED (power-up dock + duel bar),
replacing textual side/stacked panels. Aligns with board-sovereignty
[[game-ux-doctrine]] and fun-over-clever [[fun-over-clever]]. Issam is validating
this with ChatGPT before we build. NOT yet implemented.
