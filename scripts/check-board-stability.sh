#!/bin/sh
# GUARD: the board must never move. Everything rendered ABOVE the board has to have
# a FIXED height and must not wrap — otherwise a content change between moves shoves
# the board up and down (reported repeatedly; the worst UX bug in the app).
#
# This checks the CSS invariants for those elements. Run it before shipping layout
# changes:  sh scripts/check-board-stability.sh
set -u
CSS=web/style.css
fail=0
need() { # need <description> <grep-pattern>
  if grep -q "$2" "$CSS"; then printf "  ok   %s\n" "$1";
  else printf "  FAIL %s\n" "$1"; fail=1; fi
}
printf "Board-stability invariants:\n"
need "gamebar has a fixed height"            "height: 44px; box-sizing: content-box"
need "gamebar never wraps"                   "box-sizing: content-box; flex-wrap: nowrap"
need "gb-actions never wraps"                "gb-actions { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap"
need "strategy strip is fixed height"        "opening-line { cursor: pointer; height: 34px"
need "strategy strip is single line"         "gs-row { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap"
need "cockpit strips are fixed height"       "pstrip { display: flex; align-items: center; gap: 8px; height: 38px"
need "mobile does NOT re-enable bar wrap"    "main.game .gamebar, main.game .gb-actions { flex-wrap: nowrap"

# The capture tray shipped invisible once: TWO rules sized .pc-svg inside .ps-caps
# at equal specificity, and the later one used width:100%, which collapses to zero
# inside an auto-width parent. Guard both halves — exactly one sizing rule, and no
# percentage sizing anywhere in the tray.
n=$(grep -c "ps-caps .cap-pc .pc-svg" "$CSS" || true)
if [ "$n" -eq 1 ]; then printf "  ok   capture trophy has exactly one sizing rule\n";
else printf "  FAIL capture trophy sized by %s rules — the later one silently wins\n" "$n"; fail=1; fi
if grep -q "ps-caps .cap-pc .pc-svg { width: 100%" "$CSS"; then
  printf "  FAIL capture trophy sized in %% inside an auto-width parent -> collapses to 0\n"; fail=1;
else printf "  ok   capture trophy is sized in px, not %%\n"; fi

# The board must be capped on BOTH axes. A width-only cap put an 824px board on a
# 393px-tall screen (iPhone landscape) and 740px on a 640px-tall foldable. This is
# the same trap as the trophy glyph: a second equal-specificity rule, later in the
# file, silently winning.
if grep -q "max(248px, calc(100dvh - 300px))" "$CSS"; then
  printf "  ok   board is capped by height as well as width\n";
else printf "  FAIL board has no height cap -> it overflows short/wide viewports\n"; fail=1; fi
n=$(grep -c "main.game .board-wrap { width: min" "$CSS" || true)
if [ "$n" -eq 0 ]; then printf "  ok   board has no second, overriding width rule\n";
else printf "  FAIL %s extra board width rule(s) -> the later one silently wins\n" "$n"; fail=1; fi

if [ "$fail" -eq 0 ]; then printf "All good — nothing above the board can resize.\n"; else
  printf "\nBROKEN: an above-board element can change height → the board will jump.\n"; fi
exit $fail
