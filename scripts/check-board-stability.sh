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
if [ "$fail" -eq 0 ]; then printf "All good — nothing above the board can resize.\n"; else
  printf "\nBROKEN: an above-board element can change height → the board will jump.\n"; fi
exit $fail
