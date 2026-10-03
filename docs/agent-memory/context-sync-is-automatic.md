---
name: context-sync-is-automatic
description: A git pre-commit hook mirrors Claude's memory into the repo — don't rely on remembering to sync
metadata:
  type: feedback
---

Issam (2026-10-03): every commit must keep the portable context current so any
machine/session can continue — "unless there is a better way". There is, and it's built:

**A pre-commit hook does it automatically.** `.githooks/pre-commit` runs
`scripts/sync-context.sh`, which mirrors `~/.claude/projects/<slug>/memory/*.md` into
`docs/agent-memory/`, stamps the date in `docs/CONTINUATION.md`, and stages both.

**Why:** manual syncing already failed — several commits shipped without it.

**How to apply:**
- One-time per machine: `git config core.hooksPath .githooks` (see §7 of
  docs/CONTINUATION.md). Verify with `git config core.hooksPath`.
- Do NOT hand-copy memory any more; just commit.
- The hook can't write narrative — still update §6 (current state) of CONTINUATION.md
  by hand when the picture really changes.
- Links: [[portable-session-context]], [[ship-live-workflow]].
