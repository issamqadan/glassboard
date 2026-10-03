---
name: earned-rating-doctrine
description: The 💪 rating is EARNED from own moves only — never self-declared; it drives handicaps once placed
metadata:
  type: project
---

Issam's explicit ask (2026-10-03): the player's score/rating must be "actual scoring, not one set to
itself" — assessed like a chess master would, from the player's OWN play (no assistance), shown at all
times, with celebratory moments as it rises. Built in `web/rating.js` (GBRating).

**Why:** a typed-in rating can be sandbagged to get unfair help, and a result-only Elo rewards
help-carried wins — both break fairness (guardrails #2, #4).

**How to apply:**
- Unrated until 3 placement games; help-followed moves are excluded; games with <6 own measured moves
  aren't rated; results weighted by independence. Every move is measured at fixed depth 4 regardless
  of help setting.
- Once rated, the earned number overrides typed ratings everywhere (Play-AI, multiplayer join, Lobby)
  and those inputs lock. Don't add any path that lets a player set their own rating after placement.
- The ACPL→rating curve is an ≈ seed — calibrate on admin data (P4) before claiming accuracy ([[strength-and-handicap-model]]).
- Open: human-vs-human games don't feed it yet; rating is device-local (localStorage `gb_rating`).
