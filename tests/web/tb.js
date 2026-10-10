var window = this; load(SRC + 'gb-terms.js'); load(SRC + 'gb-help-budget.js');
var B = window.GBHelpBudget;
print("--- the allowance (everyone gets one free) ---");
[[0,"even"],[300,"small gap"],[700,"real gap"],[1000,"wide"]].forEach(function(p){
  print("  gap " + ("    "+p[0]).slice(-5) + "  -> " + B.takebacksFor({gap:p[0]}) + " takeback(s)"); });
print("  casual   -> " + B.takebacksFor({mode:"casual"}));
print("  nobody has zero : " + (B.takebacksFor({gap:0}) >= 1));

print("\n--- the opponent's answer ---");
function v(cp, skill, style, used, allow) {
  var r = B.aiTakebackVerdict({cp:cp,skill:skill,style:style,usedSoFar:used,allowance:allow});
  return (r.grant ? "ALLOW " : "REFUSE") + " — " + r.line; }
print("  1st (the free one), Master, close : " + v(0, 20, "aggressive", 0, 3));
print("  1st free even when AI is losing   : " + v(-400, 20, "aggressive", 0, 3));
print("  2nd, AI losing badly              : " + v(-400, 20, "balanced", 1, 3));
print("  2nd, AI well ahead                : " + v(300, 20, "balanced", 1, 3));
print("  2nd, close game, Master           : " + v(0, 20, "aggressive", 1, 3));
print("  2nd, close game, patient Casual   : " + v(0, 2, "positional", 1, 3));
print("  beyond the agreement              : " + v(300, 2, "positional", 3, 3));
var x = B.aiTakebackVerdict({cp:0,skill:20,style:"aggressive",usedSoFar:1,allowance:3});
var y = B.aiTakebackVerdict({cp:0,skill:20,style:"aggressive",usedSoFar:1,allowance:3});
print("  same inputs, same answer          : " + (x.grant===y.grant && x.line===y.line));
print("\n  the free one can never be refused : " +
  [[-900,20,"aggressive"],[0,20,"aggressive"],[900,20,"wildcard"]].every(function(c){
    return B.aiTakebackVerdict({cp:c[0],skill:c[1],style:c[2],usedSoFar:0,allowance:1}).grant; }));
