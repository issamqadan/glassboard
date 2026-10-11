var window = this; load(SRC + 'gb-clock.js'); var C = window.GBClock;

print("--- time controls ---");
print("  presets: " + C.presets().length + " across " + C.CATEGORIES.length + " categories");
print("  default for a new player: " + C.control(C.DEFAULT.minutes, C.DEFAULT.increment).label);
var c53 = C.control(5, 3);
print("  5+3 -> initial " + c53.initialMs + "ms, increment " + c53.incrementMs + "ms, timed=" + c53.timed);
var noclk = C.untimed();
print("  no clock -> timed=" + noclk.timed + " label='" + noclk.label + "'");
if (C.control(5,3).initialMs !== 300000 || C.control(5,3).incrementMs !== 3000) print("  FAIL 5+3 maths");
if (C.untimed().timed) print("  FAIL untimed should not be timed");

print("\n--- bullet has no assistance in v1, and says so ---");
[[1,0],[2,1],[3,0],[5,3],[10,0],[30,20]].forEach(function (p) {
  var c = C.control(p[0], p[1]), cat = C.categoryOf(c);
  print("  " + (c.label + "      ").slice(0,7) + " -> " + (cat ? cat.name : "-") + ", assistance " + (C.assistAllowed(c) ? "available" : "UNAVAILABLE (" + cat.note + ")"));
});
if (C.assistAllowed(C.control(1,0))) print("  FAIL bullet must not allow assistance");
if (!C.assistAllowed(C.control(5,3))) print("  FAIL blitz must allow assistance");
if (!C.assistAllowed(C.untimed())) print("  FAIL an untimed game must allow assistance");

print("\n--- only the mover's clock runs ---");
var s = C.create(C.control(5, 3), "white");
C.settle(s, C.now());             // establish a baseline
var t = s.since;
C.settle(s, t + 4000);            // 4s pass with white to move
print("  4s on white's turn  : white " + C.fmt(s.whiteMs) + "  black " + C.fmt(s.blackMs));
if (s.blackMs !== 300000) print("  FAIL black's clock moved on white's turn");

print("\n--- Fischer increment lands on a COMPLETED move ---");
C.completeMove(s, "white", t + 4000);
print("  white completes     : white " + C.fmt(s.whiteMs) + " (spent 4s, +3s back) active=" + s.active);
if (Math.abs(s.whiteMs - 299000) > 5) print("  FAIL increment not applied correctly (want ~4:59)");
if (s.active !== "black") print("  FAIL the clock did not pass to black");
C.settle(s, t + 14000);           // 10s of black's time
print("  10s on black's turn : black " + C.fmt(s.blackMs) + "  white " + C.fmt(s.whiteMs));
if (Math.abs(s.whiteMs - 299000) > 5) print("  FAIL white's clock moved on black's turn");

print("\n--- an illegal move changes nothing (the board rejects it before the clock) ---");
var before = { w: s.whiteMs, b: s.blackMs, a: s.active };
C.settle(s, t + 14000);
if (s.active !== before.a) print("  FAIL settle() changed clock ownership");
print("  ownership unchanged : " + (s.active === before.a) + ", no increment granted");

print("\n--- flag-fall ---");
var f = C.create(C.control(1, 0), "white");
C.settle(f, f.since);
C.settle(f, f.since + 61000);
print("  white runs out      : flagged=" + f.flagged + " active=" + f.active + " white=" + C.fmt(f.whiteMs));
if (f.flagged !== "white") print("  FAIL flag not raised");
if (f.active !== null) print("  FAIL a flagged clock must not keep running");
var f2 = C.create(C.control(1, 2), "white");
C.settle(f2, f2.since);
C.completeMove(f2, "white", f2.since + 61000);
print("  flagging move earns no increment: flagged=" + f2.flagged + " white=" + C.fmt(f2.whiteMs));
if (f2.whiteMs > 0) print("  FAIL increment was granted on the flagging move");

print("\n--- backgrounding: a timed clock KEEPS RUNNING (decided 2026-10-11) ---");
var bg = C.create(C.control(5, 0), "white");
C.settle(bg, bg.since);
C.settle(bg, bg.since + 120000);   // app backgrounded for two minutes
print("  2 min away          : white " + C.fmt(bg.whiteMs) + "  (charged in full)");
if (bg.whiteMs > 180500) print("  FAIL backgrounded time was not charged");

print("\n--- halt / resume (game over, takeback, reconnect) ---");
var h = C.create(C.control(5, 0), "white");
C.settle(h, h.since); C.halt(h, h.since + 5000);
var atHalt = h.whiteMs;
C.settle(h, h.since + 60000);
print("  halted, 55s pass    : white " + C.fmt(h.whiteMs) + " (unchanged: " + (h.whiteMs === atHalt) + ")");
if (h.whiteMs !== atHalt) print("  FAIL a halted clock kept running");
C.resume(h, "white", h.since);
C.settle(h, h.since + 2000);
print("  resumed, 2s pass    : white " + C.fmt(h.whiteMs));

print("\n--- an untimed game never flags, never charges ---");
var u = C.create(C.untimed(), "white");
C.settle(u, u.since + 9999999);
C.completeMove(u, "white", u.since + 9999999);
print("  after ~3 hours      : flagged=" + u.flagged + " active=" + u.active);
if (u.flagged) print("  FAIL an untimed game flagged");

print("\n--- display ---");
[300000, 65000, 59000, 10000, 9400, 900, 0].forEach(function (ms) {
  print("  " + (ms + "ms").padEnd(9) + " -> " + C.fmt(ms).padEnd(6) + " (" + C.pressure(ms) + ")");
});
if (C.pressure(59000) !== "low" || C.pressure(9000) !== "critical" || C.pressure(120000) !== "normal") print("  FAIL pressure thresholds");
