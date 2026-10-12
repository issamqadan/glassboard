// MOBILE VERTICAL BUDGET for the game screen.
//
// Corrected twice against real device screenshots. The first version of this model
// OMITTED the Glass Lens and the bottom tab bar, which is why it reported "fits"
// for a screen that scrolled by ~183px. Measure what is on the screen, not what you
// remember putting there.
//
// This test TRACKS the gap rather than asserting a pass it cannot honestly claim:
// it fails only if the layout gets WORSE than the recorded baseline, so progress is
// locked in and regressions are caught, without pretending the job is finished.
var ROWS = { nav: 56, gamebar: 52, oppStrip: 44, youStrip: 44, tabbar: 52, stratStrip: 42 };
var TWO_CARDS = 330;   // Lens ~180 + separate strategy panel ~150, each with a move
var ONE_CARD = 210;    // plan head + progress + objective + ONE resolved recommendation
var BASELINE = 80;     // worst remaining overflow, px — must not get worse

function board(vw, dvh, reserve) { return Math.min(vw - 28, Math.max(248, dvh - (reserve || 300))); }
var DEVICES = [[393, 660, "iPhone, toolbar expanded"], [393, 760, "iPhone, toolbar collapsed"],
               [360, 640, "small Android"], [412, 700, "Pixel"], [430, 800, "large phone"]];

function run(label, o) {
  print("\n--- " + label + " ---");
  var worst = 0;
  DEVICES.forEach(function (d) {
    var reserve = d[1] <= 700 ? o.reserve : 300;
    var b = board(d[0], d[1], reserve);
    var h = ROWS.nav + ROWS.gamebar + ROWS.oppStrip + ROWS.youStrip + ROWS.tabbar + b + o.cards
          + (o.stratStrip ? ROWS.stratStrip : 0);
    var over = h - d[1];
    if (over > worst) worst = over;
    print("  " + (d[2] + "                     ").slice(0, 26) + d[0] + "x" + d[1] +
          ": board " + b + " + chrome " + (h - b) + " = " + h +
          " -> " + (over <= 0 ? "fits with " + (-over) + "px spare" : "scrolls by " + over));
  });
  return worst;
}

var before = run("BEFORE: two cards, each with its own move recommendation",
                 { cards: TWO_CARDS, stratStrip: true, reserve: 300 });
var after = run("NOW: one guidance card, strategy strip folded, chooser on demand",
                { cards: ONE_CARD, stratStrip: false, reserve: 380 });

print("\nworst-case overflow: " + before + "px -> " + after + "px");
if (after > BASELINE) {
  print("  FAIL mobile layout regressed past the " + BASELINE + "px baseline");
} else if (after > 0) {
  print("  tracked: " + after + "px still below the fold on the tightest phones.");
  print("  The remaining fat is app chrome, not guidance: nav 56 + game bar 52 +");
  print("  bottom tab bar 52 = 160px. Closing it means relocating the game bar's");
  print("  controls (Takeback, Assist, settings) — they cannot simply be hidden.");
} else {
  print("  everything fits");
}
