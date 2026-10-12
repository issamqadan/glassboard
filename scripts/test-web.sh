#!/bin/sh
# Glassboard web test suite.
#
# The web layer has no build step and no test runner, so these exercise the shared
# modules (and slices extracted VERBATIM from main.js / multiplayer.js) under
# JavaScriptCore — the one JS engine every Mac already has. They exist because this
# project produced a run of bugs with a single shape: a promise in the UI that the
# code didn't keep, or state initialised on one game-start path but not another.
#
#   sh scripts/test-web.sh
#
# A test fails if it throws, or if it prints a line containing "FAIL".
# Extracted slices are rebuilt from source on every run (see
# scripts/extract-slices.py), so a test cannot pass against a stale copy of the
# code it is checking.
set -u
cd "$(dirname "$0")/.." || exit 1
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
[ -x "$JSC" ] || { echo "JavaScriptCore not found at $JSC"; exit 2; }
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

python3 scripts/extract-slices.py "$WORK" || {
  echo "could not extract slices from web/main.js — the test suite cannot verify anything"
  exit 2
}
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
