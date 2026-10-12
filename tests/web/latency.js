var engineEloEl = { value: "3000" };
var indepOwn = 0, indepFollowed = 0;
// adviceMovetime() is now clock-aware: the advice search runs on YOUR turn and so
// spends YOUR time. Default to an UNTIMED game here, which is the condition the
// fairness invariant was calibrated under — searchBudget returns the ceiling
// unchanged, so the invariant is tested against unchanged behaviour. A timed case
// follows at the end.
load(SRC + 'gb-clock.js');
var timedGame = false, clock = null, uciHistory = [];
function clockMs() { return 0; }
load(TESTDIR + '/extract.js');

print("level          lean   opponent    advice   advice>=opp");
var bad = 0, before = 0, after = 0, n = 0;
AI_LEVELS.forEach(function (l) {
  [0, 0.5, 1].forEach(function (lean) {
    engineEloEl.value = String(l.elo);
    indepOwn = Math.round((1 - lean) * 10); indepFollowed = Math.round(lean * 10);
    var b = aiBoost(l.elo), adv = adviceMovetime();
    var oppMs = b.depth ? 0 : b.movetime;   // depth-capped rungs are near-instant
    var ok = adv >= oppMs;
    if (!ok) bad++;
    before += 1400; after += adv; n++;
    print((l.name + "            ").slice(0, 14) + " " + lean.toFixed(1) + "  " +
      ("      " + (b.depth ? "d" + b.depth : b.movetime + "ms")).slice(-9) + " " +
      ("      " + adv + "ms").slice(-9) + "   " + (ok ? "ok" : "VIOLATION"));
  });
});
print("\nfairness invariant (advice never out-searched): " + (bad === 0 ? "HOLDS in all " + n + " cases" : bad + " VIOLATIONS"));
print("advice think-time per turn: was " + Math.round(before/n) + "ms flat -> now " + Math.round(after/n) + "ms mean (" +
      Math.round(100 - after/before*100) + "% less waiting)");
engineEloEl.value = "3000"; indepOwn = 10; indepFollowed = 0;
print("Master unchanged at full strength: " + adviceMovetime() + "ms (was 1400ms)");


print("\n--- clock-aware advice (new): the advisor cannot flag you ---");
timedGame = true;
var myMs = 300000;
clock = { control: GBClock.control(5, 0) };
clockMs = function () { return myMs; };
engineEloEl.value = "3000"; indepOwn = 10; indepFollowed = 0;
var rows = [[300000, "5:00 left"], [60000, "1:00 left"], [10000, "0:10 left"], [3000, "3s left"], [800, "0.8s left"]];
var bad = 0;
rows.forEach(function (r) {
  myMs = r[0]; uciHistory = new Array(40);
  var adv = adviceMovetime();
  var pct = Math.round((adv / r[0]) * 100);
  print("  " + (r[1] + "        ").slice(0, 12) + " advice may think " + adv + "ms (" + pct + "% of your clock)");
  if (adv >= r[0]) { print("    FAIL the advisor could flag you"); bad++; }
  if (pct > 26) { print("    FAIL more than a quarter of the clock"); bad++; }
});
// And an untimed game must be byte-identical to before.
timedGame = false; clock = null;
print("  untimed is unchanged      : " + adviceMovetime() + "ms (want 1400)");
if (adviceMovetime() !== 1400) { print("    FAIL untimed advice changed"); bad++; }
print(bad ? "  " + bad + " FAIL(s)" : "  clock-aware advice holds");
