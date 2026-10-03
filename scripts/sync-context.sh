#!/bin/sh
# Keep the PORTABLE session context in the repo up to date.
#
# Claude Code's memory lives in ~/.claude/projects/<slug>/memory and does NOT travel
# with a `git clone`. This script mirrors it into docs/agent-memory/ and stamps
# docs/CONTINUATION.md, so a session on any other machine can pick up exactly where
# the last one left off. Run by the pre-commit hook (see .githooks/pre-commit), so
# it happens on EVERY commit instead of relying on anyone remembering.
#
# Safe by design: never fails a commit. If there's no memory dir on this machine
# (someone else's checkout), it quietly does nothing.
set -u

REPO=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$REPO" || exit 0

DEST="docs/agent-memory"
mkdir -p "$DEST" 2>/dev/null || exit 0

# The project slug depends on where Claude was launched (repo dir vs its parent),
# so take the most recently modified memory dir that belongs to this project.
SRC=$(ls -dt "$HOME"/.claude/projects/*chessAI*/memory \
              "$HOME"/.claude/projects/*glassboard*/memory 2>/dev/null | head -1)

if [ -n "${SRC:-}" ] && [ -d "$SRC" ]; then
  cp "$SRC"/*.md "$DEST"/ 2>/dev/null
fi

# Stamp today's date into CONTINUATION.md so staleness is visible at a glance.
if [ -f docs/CONTINUATION.md ]; then
  TODAY=$(date +%Y-%m-%d)
  # BSD sed (macOS) needs the empty -i argument.
  sed -i '' -E "s/\*\*Last updated:\*\* [0-9]{4}-[0-9]{2}-[0-9]{2}\./**Last updated:** ${TODAY}./" docs/CONTINUATION.md 2>/dev/null \
    || sed -i -E "s/\*\*Last updated:\*\* [0-9]{4}-[0-9]{2}-[0-9]{2}\./**Last updated:** ${TODAY}./" docs/CONTINUATION.md 2>/dev/null
fi

# Stage whatever changed so it rides along with this commit.
git add "$DEST" docs/CONTINUATION.md 2>/dev/null

exit 0
