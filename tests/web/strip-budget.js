// THE COCKPIT STRIP WIDTH BUDGET.
//
// The captured pieces read as "missing" three separate times. The cause was never
// the renderer: the strip is a single fixed-height line and its contents needed
// ~454px of a ~369px strip on a 393px phone, so the trophies slot — the only
// flexible one — collapsed to zero. Tuning flex-shrink twice could not create the
// missing 85px.
//
// This test holds the arithmetic, because a future addition to the strip (another
// chip, a longer label) would silently squeeze the trophies out again and nothing
// would fail.
var window = this; load(SRC + 'gb-assist-ui.js'); var S = window.GBAssistUI;

// Measured widths of the strip's parts, in px.
var W = { padding: 22, gaps: 48, icon: 26, name: 68, rating: 96, help: 54, lead: 22, clock: 46, turn: 72 };
var CHIP = 24;       // one trophy chip, tightened (no pill background)
var MIN_CHIPS = 3;   // a phone must fit at least this many before "+N"
var fails = 0;

function budget(viewport, opts) {
  var inner = viewport - 24;             // board-column padding
  // <=380px tightens the gaps, the side padding and the name's max width — taken
  // from spacing and the label, never from the trophies.
  var narrow = viewport <= 380;
  var gaps = narrow ? 6 * 6 : W.gaps;
  var pad = narrow ? 16 : W.padding;
  var name = narrow ? 48 : W.name;
  var used = pad + W.icon + name + W.help + W.lead + W.clock;
  used += (opts.rating ? W.rating : 0);
  used += (opts.turn ? W.turn : 0);
  used += gaps - (opts.rating ? 0 : (narrow ? 6 : 8)) - (opts.turn ? 0 : (narrow ? 6 : 8));
  return inner - used;
}
print("--- phones, with a clock showing (rating + turn text hidden by CSS) ---");
[360, 393, 412, 430].forEach(function (v) {
  var left = budget(v, { rating: false, turn: false });
  var chips = Math.floor(left / CHIP);
  var ok = chips >= MIN_CHIPS;
  if (!ok) fails++;
  print("  " + v + "px -> " + left + "px for trophies = " + chips + " chips" + (ok ? "" : "   FAIL (want >= " + MIN_CHIPS + ")"));
});
print("\n--- the old layout, for the record ---");
[360, 393].forEach(function (v) {
  var left = budget(v, { rating: true, turn: true });
  print("  " + v + "px with rating+turn -> " + left + "px  (" + (left < CHIP ? "trophies collapse — the original bug" : "ok") + ")");
});
print("\n--- the tray itself caps and reports overflow ---");
var many = S.capTrayHTML({ q: 1, r: 2, b: 1, n: 2, p: 5 }, "black", "t1");
var chipCount = (many.match(/class="cap-pc/g) || []).length;
print("  five piece types -> " + chipCount + " chips shown" + (chipCount <= 4 ? "" : "   FAIL (must cap at 4)"));
if (chipCount > 4) fails++;
print("  overflow is stated  : " + (/cap-more/.test(many) ? "yes, '+N' shown" : "NO — silently clipped") );
if (!/cap-more/.test(many)) { print("  FAIL overflow must be visible"); fails++; }
var few = S.capTrayHTML({ p: 2 }, "black", "t2");
print("  a couple of pawns   : " + ((few.match(/class="cap-pc/g) || []).length) + " chip, no overflow marker: " + !/cap-more/.test(few));
print(fails ? "\n" + fails + " FAIL(s)" : "\nthe strip has room for the trophies");

print("\n--- the trophy slot is discoverable BEFORE the first capture ---");
var empty = S.capTrayHTML({}, "black", "e1");
print("  nothing taken yet -> " + (empty ? "a visible slot is rendered" : "NOTHING — the feature is invisible"));
if (!empty) { print("  FAIL an empty tray must still show where trophies appear"); fails++; }
if (empty.indexOf("cap-tray") < 0) { print("  FAIL the slot must be the tray itself"); fails++; }
if (empty.indexOf("Pieces you take appear here") < 0) { print("  FAIL the slot should explain itself on hover"); fails++; }
var one = S.capTrayHTML({ p: 1 }, "black", "e2");
print("  after one capture -> " + ((one.match(/cap-pc/g) || []).length) + " chip, placeholder gone: " + (one.indexOf("cap-none") < 0));
if (one.indexOf("cap-none") >= 0) { print("  FAIL placeholder should be replaced by the real trophy"); fails++; }
print(fails ? "" : "  the slot is learnable from move one");
