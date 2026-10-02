---
name: portable-session-context
description: Keep repo-portable context in sync so Claude can continue on another machine after a clone
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c65ecd65-db19-49ae-aedc-6cff58478ed3
  modified: 2026-10-02T19:53:47.554Z
---

Issam works across multiple Macs and wants a fresh Claude session on any machine to pick
up exactly where the last left off after a `git clone`.

**Why:** Claude's memory + transcript live in `~/.claude/` (machine-local) and do NOT travel
with the repo, so without an in-repo handoff a new machine starts blind.

**How to apply:**
- The in-repo handoff is **`docs/CONTINUATION.md`** (single "read this first") + **`docs/agent-memory/`**
  (a copy of these memory files). `CLAUDE.md` points to CONTINUATION.md at the top.
- On meaningful commits, KEEP THEM CURRENT: update `docs/CONTINUATION.md`'s state section, and
  re-sync `cp ~/.claude/projects/-Users-issamqadan-chessAI/memory/*.md docs/agent-memory/`, then
  commit both with the code. See §7 of docs/CONTINUATION.md.
- Links to [[site-map-and-beginner-journey]], [[strength-and-handicap-model]], [[deploy-hosting-gotchas]].
