var window = this;
load(SRC + 'gb-assist-ui.js'); load(SRC + 'gb-capture.js');
var C = window.GBCapture;
// board index 0 = a1 .. 63 = h8
function mk(spec) { var b = ".".repeat(64).split(""); Object.keys(spec).forEach(function (sq) {
  var f = sq.charCodeAt(0) - 97, r = +sq[1] - 1; b[r*8+f] = spec[sq]; }); return b.join(""); }
function ix(sq) { return (sq.charCodeAt(0)-97) + (+sq[1]-1)*8; }

print("--- FORK ---");
// white knight on e6 hitting black queen d8 and rook f8
var f1 = mk({ e6:"N", d8:"q", f8:"r", e1:"K", e8:"k" });
var r1 = C._findFork(f1, ix("e6"), true);
print("  Ne6 hits queen+rook : " + (r1 ? r1.kind + " -> " + r1.targets.join(" & ") : "none"));
// royal fork: knight hits king + rook
var f2 = mk({ e6:"N", c7:"k", f8:"r", e1:"K" });
var r2 = C._findFork(f2, ix("e6"), true);
print("  knight hits K+rook : " + (r2 ? r2.kind : "none") + "  (want royal-fork)");
// only ONE valuable target -> not a fork
var f3 = mk({ e6:"N", d8:"q", e1:"K", e8:"k" });
print("  one target only     : " + (C._findFork(f3, ix("e6"), true) ? "CLAIMED (wrong)" : "none, correct"));
// two PAWNS attacked is not worth calling a fork
var f4 = mk({ e6:"N", d7:"p", f7:"p", e1:"K", e8:"k" });
print("  two pawns           : " + (C._findFork(f4, ix("e6"), true) ? "CLAIMED (wrong)" : "none, correct"));

print("\n--- PIN / SKEWER ---");
// white bishop b5, black knight c6, black king d7 behind it -> absolute pin
var p1 = mk({ b5:"B", c6:"n", d7:"k", e1:"K" });
var rp = C._findPin(p1, ix("b5"), true);
print("  Bb5 pins knight to king : " + (rp ? rp.kind + " (" + rp.pinned + " -> " + rp.behind + ")" : "none"));
// rook e1, black rook e5, black queen e8 -> skewer
var p2 = mk({ e1:"R", e5:"r", e8:"q", a1:"K", h8:"k" });
var rs = C._findPin(p2, ix("e1"), true);
print("  Re1 skewers rook/queen  : " + (rs ? rs.kind : "none"));
// enemy KING first on the ray = a check, not a pin
var p3 = mk({ b5:"B", c6:"k", d7:"n", e1:"K" });
print("  king first on the ray   : " + (C._findPin(p3, ix("b5"), true) ? "CLAIMED (wrong)" : "none, correct — that's a check"));
// our OWN piece blocks -> nothing
var p4 = mk({ b5:"B", c6:"P", d7:"k", e1:"K" });
print("  own piece blocks        : " + (C._findPin(p4, ix("b5"), true) ? "CLAIMED (wrong)" : "none, correct"));
// a knight can't pin
var p5 = mk({ b5:"N", c6:"n", d7:"k", e1:"K" });
print("  knight 'pin'            : " + (C._findPin(p5, ix("b5"), true) ? "CLAIMED (wrong)" : "none, correct"));

print("\n--- DISCOVERED ATTACK ---");
// white rook a1, white knight d1 moves away, black queen h1 on the rank
var before = mk({ a1:"R", d1:"N", h1:"q", e8:"k", e2:"K" });
var after  = mk({ a1:"R", c3:"N", h1:"q", e8:"k", e2:"K" });
var rd = C._findDiscovered(before, after, ix("d1"), ix("c3"), true);
print("  Nd1-c3 uncovers Ra1xq   : " + (rd ? rd.kind + " by " + rd.piece + " -> " + rd.targets.join("") : "none"));
// nothing uncovered: the rook already attacked it
var b2 = mk({ a1:"R", h1:"q", d4:"N", e8:"k", e2:"K" });
var a2 = mk({ a1:"R", h1:"q", c5:"N", e8:"k", e2:"K" });
print("  line was already open   : " + (C._findDiscovered(b2, a2, ix("d4"), ix("c5"), true) ? "CLAIMED (wrong)" : "none, correct"));
// the MOVER's own new attacks must not count as a discovery
var b3 = mk({ d1:"R", h8:"k", e2:"K", a4:"q" });
var a3 = mk({ a1:"R", h8:"k", e2:"K", a4:"q" });
var r3 = C._findDiscovered(b3, a3, ix("d1"), ix("a1"), true);
print("  mover's own new attack  : " + (r3 ? "CLAIMED (wrong)" : "none, correct"));
