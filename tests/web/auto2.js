var window = this; load(SRC + 'gb-terms.js');
var RUNG_BY_KEY = { off:"off", hint:"awareness", coach:"coaching", guide:"suggestion", assist:"guided", autopilot:"autopilot" };
var NAME = { awareness:"Hint", coaching:"Coach", suggestion:"Guide", guided:"Assist", autopilot:"Autopilot" };
function auto(you, opp) {
  if (opp <= you) return "Hint";
  var id = RUNG_BY_KEY[GBTerms.rungForGap(opp - you).key];
  return NAME[id === "off" ? "awareness" : id];
}
var LEVELS = [[700,"Beginner"],[1100,"Casual"],[1500,"Intermediate"],[1900,"Club"],[2300,"Expert"],[3000,"Master"]];
[900, 1600, 2100].forEach(function (you) {
  print("you " + you + ": " + LEVELS.map(function(l){ return l[1] + "=" + auto(you, l[0]); }).join("  "));
});
print("\nstronger than your opponent -> safety only : " + (auto(1600,700) === "Hint" && auto(2100,1900) === "Hint"));
print("weaker -> help scales with the gap         : " + (auto(900,1500) === "Guide" && auto(900,3000) === "Autopilot"));
print("never more help for being the favourite    : " + (auto(1600,700) === "Hint"));
