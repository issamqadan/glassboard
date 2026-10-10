var engineEloEl = { value: "3000" };
var indepOwn = 0, indepFollowed = 0;
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
