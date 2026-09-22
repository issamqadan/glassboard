# Playtest kit — running the POC exit gate

> The POC closes on **one** criterion (see [POC.md](POC.md)): an unequal pair plays a
> full game and **both independently say it was fun and fair.** This doc is how to run
> that test and record the result. **Last updated:** 2026-09-23.

## The hypothesis under test

> Can two players far apart in skill (≈700 vs ≈1500) have a game they **both** experience
> as genuinely competitive and **fun** — because assistance is transparent, adjustable,
> and fair?

## Setup (5 minutes)

1. **Recruit an unequal pair.** Ideal gap: a near-beginner (~500–900) and a casual/club
   player (~1300–1700). They can be in the same room or remote.
2. **Both sign in** (name + PIN) on their own device — this keeps ratings, games, and the
   independence trend attached to each person, and lets both submit feedback.
3. **Create the game** from the lobby ("New game"), set the honest ratings, and share the
   link. First to join is White. The weaker player gets the handicap; the stronger plays
   unassisted. Confirm both see **the agreement** at the top of the glass-box (🔍).
   - Beginner with zero chess? Start them at **"New to chess?" → the learn flow** first.

## Run the game

Play one **full game** to a real result (checkmate / resignation / draw). Don't coach from
outside — the point is whether the *product* carries the weaker player.

### What to watch (maps to the 7 "firming up" items)

- **Real game, not a tutorial** — does it feel like a game to both?
- **Transparency = trust, not shame** — does the stronger player trust the glass-box? Does
  the weaker player feel helped, not exposed?
- **The gap closes emotionally** — does the weaker player get *real moments* (a good move
  they found, a threat they saved)? Does the stronger player still have to try?
- **Agency preserved** — watch the **independence %** at game end. Did the weaker player
  play moves on their own (🧠), or only follow (🤖)?
- **Beginner on-ramp** — could a total beginner start from the link and enjoy it?
- **Holds end-to-end** — invite → play → see help → (later) resume. Any friction?
- **Device-agnostic** — try it on a phone in **both orientations** and on desktop.

## Capture the result (the gate)

At game end, **each player** answers the in-app prompt on the game-over screen:
**Fun? 👍/👎 · Fair? 👍/👎 · (optional note)** → **Send**. This posts to the server so both
devices report independently.

**The gate passes when both players, independently, answer Fun 👍 and Fair 👍** — ideally with
a note in the spirit of *"that was a real game."* One 👎 on either axis is a finding, not a
failure — log what caused it; it becomes the top of the field-input log in [POC.md](POC.md).

## Reviewing results

Feedback is collected centrally. To review the latest (newest first):

```bash
curl -s https://playglassboard.onrender.com/feedback | jq
# → { "feedback": [ { ts, game_id, player, mode, fun, fair, note }, … ] }
```

Each game should produce **two** rows (one per player) sharing the same `game_id`. A passing
playtest = a `game_id` where both rows have `fun: true` and `fair: true`.

## After the playtest

- Log the outcome and any 👎 reasons in the **field-input log** in [POC.md](POC.md).
- If both said fun & fair: the experience is firmed up — the POC's core hypothesis holds.
- If not: the specific friction is the next roadmap priority (field input beats roadmap).
