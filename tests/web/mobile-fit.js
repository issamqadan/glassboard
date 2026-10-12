// MOBILE VERTICAL BUDGET for the game screen.
//
// The step-by-step guidance must be reachable WITHOUT scrolling past the board —
// it is the one thing the strategy panel exists to keep in view. This test holds
// the arithmetic so a future addition above or below the board can't quietly push
// it under the fold again.
var ROWS = { nav: 56, gamebar: 52, oppStrip: 44, stratStrip: 42, youStrip: 44 };
var PANEL_FULL = 200, PANEL_COMPACT = 64;
function board(vw, dvh) { return Math.min(vw - 28, Math.max(248, dvh - 300)); }
function stack(vw, dvh, o) {
  var h = ROWS.nav + ROWS.gamebar + ROWS.oppStrip + ROWS.youStrip + board(vw, dvh);
  if (o.stratStrip) h += ROWS.stratStrip;
  h += o.compactPanel ? PANEL_COMPACT : PANEL_FULL;
  return h;
}
var DEVICES = [[393, 660, "iPhone, toolbar expanded"], [393, 760, "iPhone, toolbar collapsed"],
               [360, 640, "small Android"], [430, 800, "large phone"], [412, 700, "Pixel"]];
var fails = 0;
print("--- BEFORE: strip shown, panel full ---");
DEVICES.forEach(function (d) {
  var h = stack(d[0], d[1], { stratStrip: true, compactPanel: false });
  print("  " + (d[2] + "                     ").slice(0, 26) + d[0] + "x" + d[1] +
        " needs " + h + " -> " + (h <= d[1] ? "fits" : "SCROLLS by " + (h - d[1])));
});
print("\n--- AFTER: strip folded into the panel, steps one tap away ---");
DEVICES.forEach(function (d) {
  var h = stack(d[0], d[1], { stratStrip: false, compactPanel: true });
  var ok = h <= d[1];
  if (!ok) fails++;
  print("  " + (d[2] + "                     ").slice(0, 26) + d[0] + "x" + d[1] +
        " needs " + h + " -> " + (ok ? "fits with " + (d[1] - h) + "px spare" : "FAIL scrolls by " + (h - d[1])));
});
print(fails ? "\n" + fails + " device(s) still scroll" : "\nthe plan and its current objective are above the fold on every tested phone");
