---
name: ship-live-workflow
description: Issam tests on the live site from his phone — finish asks by committing, pushing, and confirming the deploy
metadata:
  type: feedback
---

Issam validates changes on the live GitHub Pages site (often on a phone), not locally, and says
"do it buddy" to ship. He writes casually, mixing English with Arabic ("fehem alee?" = "do you get me?").

**Why:** there's no local WASM build on every Mac, and touch/drag/sound feel can only be judged on a device.

**How to apply:** after a change is validated (jsc syntax checks, jsc unit sims), commit, push to
`main` over SSH, and poll `version.txt` until it equals the SHA before saying it's live. Say plainly
what was NOT verified (no browser tools). Physical-feel features (drag, sound) need his on-device
feedback — offer tuning knobs. See [[deploy-hosting-gotchas]], [[portable-session-context]].
