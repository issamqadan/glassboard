#!/bin/sh
# Glassboard web test suite.
#
# The web layer has no build step and no test runner, so these exercise the shared
# modules (and slices extracted VERBATIM from main.js / multiplayer.js) under
# JavaScriptCore — the one JS engine every Mac already has. They exist because this
# session produced a run of bugs with a single shape: a promise in the UI that the
# code didn't keep, or state initialised on one game-start path but not another.
#
#   sh scripts/test-web.sh
#
# A test fails if it throws, or if it prints a line containing "FAIL".
# Extracted slices are rebuilt from source on every run, so a test cannot pass
# against a stale copy of the code it is checking.
set -u
cd "$(dirname "$0")/.." || exit 1
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
[ -x "$JSC" ] || { echo "JavaScriptCore not found at $JSC"; exit 2; }
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# --- rebuild the verbatim slices the tests load -----------------------------
python3 - "$WORK" <<'PY'
import sys
work = sys.argv[1]
s = open("web/main.js").read()
def w(name, txt): open(work + "/" + name, "w").write(txt)
def slice_from(start, end_anchor, end_from=None):
    a = s.index(start)
    b = s.index(end_anchor, a if end_from is None else s.index(end_from, a))
    return s[a:s.index("\n}", b) + 2]
w("bwire.js",    slice_from("let helpMax = 0;", "  return true;\n}", "function spendHelp"))
w("assess.js",   slice_from("function assessPosition() {", "    danger: !!(assistData"))
w("deadlock.js", slice_from("// Play `uci` for the engine.", "  engineReply();", "function ensureTurnProgress"))
w("aiask.js",    slice_from("function maybeAiAsksForHelp() {", "  });\n}"))
a = s.index("const AI_LEVELS = [")
e = s.index("\n}", s.index("return { lean, skill, movetime, depth, base: lvl.skill")) + 2
b = s.index("function adviceMovetime() {")
be = s.index("\n}", s.index("return Math.max(500", b)) + 2
w("extract.js", s[a:e] + "\n" + s[b:be] + "\n")
PY
[ -f "$WORK/bwire.js" ] || { echo "could not extract slices from web/main.js"; exit 2; }
cp tests/web/fakegame.js "$WORK/" 2>/dev/null

pass=0; fail=0; failed=""
for f in tests/web/*.js; do
  name=$(basename "$f" .js)
  [ "$name" = "fakegame" ] && continue           # a helper, not a test
  prog="$WORK/run-$name.js"
  { printf 'var SRC = "web/"; var TESTDIR = "%s";\n' "$WORK"; cat "$f"; } > "$prog"
  out=$("$JSC" "$prog" 2>&1)
  if printf '%s' "$out" | grep -q "FAIL" || printf '%s' "$out" | grep -qE "^Exception:|ReferenceError|SyntaxError|TypeError:"; then
    fail=$((fail + 1)); failed="$failed $name"
    printf "FAIL  %s\n" "$name"
    printf '%s\n' "$out" | grep -E "FAIL|Exception|Error" | head -3 | sed 's/^/        /'
  else
    pass=$((pass + 1)); printf "pass  %s\n" "$name"
  fi
done
printf -- "----------------------------------------\n"
if [ "$fail" -eq 0 ]; then
  printf "%d passed.\n" "$pass"
else
  printf "%d passed, %d FAILED:%s\n" "$pass" "$fail" "$failed"
fi
exit $fail
