var window = this; load(SRC + 'gb-terms.js'); load(SRC + 'gb-help-budget.js');
var B = window.GBHelpBudget;

print("--- the allowance is sized to the gap (guardrail #2) ---");
[[0,"even"],[250,"small gap"],[450,"real gap"],[700,"wide"],[1000,"very wide"],[1500,"chasm"]].forEach(function(p){
  print("  gap " + ("    "+p[0]).slice(-5) + " (" + p[1] + ")".padEnd(11) + " -> " + B.tokensFor({gap:p[0]}) + " tokens");
});
print("  casual                     -> " + B.tokensFor({mode:"casual"}) + " (unlimited)");
print("  weaker player gets more    : " + (B.tokensFor({gap:1000}) > B.tokensFor({gap:0})));

print("\n--- what can run out, and what never can (guardrail #2) ---");
["best","plan","candidates"].forEach(function(k){ print("  scarce: " + k + " -> " + B.isScarce(k)); });
["hanging","check","mate","meaning"].forEach(function(k){ print("  FREE  : " + k + " -> " + B.isFree(k) + "  (never spendable)"); });
print("  a safety signal is never scarce : " + (!B.isScarce("hanging") && !B.isScarce("mate")));

print("\n--- earn-back rewards playing unaided (guardrail #4) ---");
print("  best move, unaided, below max : " + JSON.stringify(B.earnBack({wasBest:true,usedHelp:false,tokensLeft:4,max:7})));
print("  best move but help was used   : " + B.earnBack({wasBest:true,usedHelp:true,tokensLeft:4,max:7}).reason);
print("  already at full allowance     : " + B.earnBack({wasBest:true,usedHelp:false,tokensLeft:7,max:7}).reason);
print("  an ordinary move              : " + B.earnBack({wasBest:false,usedHelp:false,tokensLeft:4,max:7}).earn);

print("\n--- the AI's decision: pure, so a player can learn it ---");
function v(cp, skill, style, granted) { var r = B.aiVerdict({cp:cp,skill:skill,style:style,grantedSoFar:granted||0});
  return (r.grant ? "GRANT +" + r.amount : "REFUSE") + "  — " + r.line; }
print("  AI far ahead (+400), Master   : " + v(400, 20, "balanced"));
print("  AI losing (-300), Master      : " + v(-300, 20, "balanced"));
print("  close game, Master/aggressive : " + v(20, 20, "aggressive"));
print("  close game, Casual/positional : " + v(20, 2, "positional"));
print("  close game, Master/positional : " + v(20, 20, "positional"));
print("  after 3 top-ups               : " + v(400, 20, "positional", 3));
var a = B.aiVerdict({cp:20,skill:20,style:"aggressive"}), b2 = B.aiVerdict({cp:20,skill:20,style:"aggressive"});
print("  same inputs, same answer      : " + (a.grant === b2.grant && a.line === b2.line));

print("\n--- the result line (omits what didn't happen) ---");
print("  " + B.summary({max:7,spent:5,earned:2,asked:1,granted:1}));
print("  " + B.summary({max:7,spent:0,asked:0}));
print("  " + B.summary({max:7,spent:3}));
print("  " + B.summary({max:Infinity}));
print("\n  pips: " + B.pips(5,7) + "   empty: " + B.pips(0,7) + "   casual: " + B.pips(Infinity,7));
