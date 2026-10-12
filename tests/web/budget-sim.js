var window = this; load(SRC + 'gb-clock.js'); var C = window.GBClock;
var fails = 0;

print("--- what the AI gets to think, as its clock drains (ceiling 1400ms) ---");
print("  remaining   moves played   budget");
[[600000,0],[180000,0],[60000,0],[30000,20],[10000,40],[5000,50],[2000,60],[800,70],[200,80]].forEach(function (p) {
  var b = C.searchBudget({ remainingMs: p[0], incrementMs: 0, ceilingMs: 1400, movesPlayed: p[1] });
  print("  " + (C.fmt(p[0]) + "        ").slice(0,10) + " " + ("  " + p[1]).slice(-3) + "            " + b + "ms");
  if (b > p[0]) { print("    FAIL budget exceeds the clock"); fails++; }
});
print("\n  untimed keeps full strength : " + C.searchBudget({ ceilingMs: 1400 }) + "ms" +
      (C.searchBudget({ ceilingMs: 1400 }) === 1400 ? "" : "  FAIL"));
if (C.searchBudget({ ceilingMs: 1400 }) !== 1400) fails++;
print("  an increment buys more time  : " +
  C.searchBudget({ remainingMs: 20000, incrementMs: 0, ceilingMs: 1400, movesPlayed: 30 }) + "ms (3+0) vs " +
  C.searchBudget({ remainingMs: 20000, incrementMs: 3000, ceilingMs: 1400, movesPlayed: 30 }) + "ms (3+3)");

print("\n--- FULL-GAME SIMULATION: does either side flag itself? ---");
// Both sides think for exactly their budget, every move, for 80 moves. A human
// would usually move faster; this is the worst case where nobody hurries.
function sim(min, inc, moves, ceiling) {
  var s = C.create(C.control(min, inc), "white");
  var t = s.since, played = 0, flaggedBy = null, minLeft = Infinity, totalThought = 0;
  for (var i = 0; i < moves; i++) {
    var side = s.active;
    if (!side) break;
    var b = C.searchBudget({ remainingMs: C.remainingOf(s, side), incrementMs: s.control.incrementMs,
                             ceilingMs: ceiling, movesPlayed: played });
    totalThought += b;
    t += b;
    C.completeMove(s, side, t);
    if (s.flagged) { flaggedBy = s.flagged; break; }
    minLeft = Math.min(minLeft, C.remainingOf(s, side));
    played++;
  }
  return { flaggedBy: flaggedBy, moves: played, minLeft: minLeft, avg: Math.round(totalThought / Math.max(1, played)) };
}
[[1,0],[1,1],[2,1],[3,0],[3,2],[5,0],[5,3],[10,0],[10,5],[15,10],[30,0],[60,0]].forEach(function (p) {
  var r = sim(p[0], p[1], 80, 1400);
  var ok = !r.flaggedBy;
  if (!ok) fails++;
  print("  " + (C.label(p[0], p[1]) + "     ").slice(0,7) + " 80 moves: " +
        (ok ? "survived" : "FLAGGED (" + r.flaggedBy + " after " + r.moves + ")") +
        "  · lowest " + C.fmt(r.minLeft === Infinity ? 0 : r.minLeft) + " · avg think " + r.avg + "ms");
});

print("\n--- the OLD behaviour, for comparison (flat 1400ms, clock-blind) ---");
function simFlat(min, inc, moves) {
  var s = C.create(C.control(min, inc), "white");
  var t = s.since, played = 0;
  for (var i = 0; i < moves; i++) {
    var side = s.active; if (!side) break;
    t += 1400; C.completeMove(s, side, t);
    if (s.flagged) return { flaggedBy: s.flagged, moves: played };
    played++;
  }
  return { flaggedBy: null, moves: played };
}
// 80 plies is 40 moves each, and 40 x 1400ms = 56s — which fits inside a
// 1-minute clock with 4 seconds to spare. So a SHORT game hides the problem; a
// long one does not. Run both lengths so the claim is accurate either way.
[80, 120, 160].forEach(function (plies) {
  var row = [];
  [[1,0],[2,1],[3,0],[5,0]].forEach(function (p) {
    var f = simFlat(p[0], p[1], plies), n = sim(p[0], p[1], plies, 1400);
    row.push(C.label(p[0], p[1]) + ": flat " + (f.flaggedBy ? "FLAGS@" + f.moves : "ok") +
             " / budgeted " + (n.flaggedBy ? "FLAGS@" + n.moves : "ok"));
  });
  print("  " + plies + " plies (" + (plies / 2) + " moves each)");
  print("    " + row.join("   "));
});

print("\n--- the advisor must never be the reason YOU flag ---");
[[10000, 1400],[3000, 1400],[1000, 1400],[300, 1400]].forEach(function (p) {
  var b = C.searchBudget({ remainingMs: p[0], incrementMs: 0, ceilingMs: p[1], movesPlayed: 40 });
  var pctOfClock = Math.round((b / p[0]) * 100);
  print("  you have " + (C.fmt(p[0]) + "    ").slice(0,7) + " -> advisor may think " + b + "ms (" + pctOfClock + "% of your clock)");
  if (b >= p[0]) { print("    FAIL the advisor could flag you"); fails++; }
  if (pctOfClock > 26) { print("    FAIL more than a quarter of the clock on one think"); fails++; }
});

print(fails ? "\n" + fails + " FAIL(s)" : "\nall budget properties hold");
