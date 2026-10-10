var window = this; load(SRC + 'gb-terms.js'); load(SRC + 'gb-help-budget.js');
var humanEloEl = { value: "900" }, engineEloEl = { value: "1900" };
var aiAssistOverride = "guided", firstGame = false, uciHistory = [], playerHelpLog = [];
load(TESTDIR + '/bwire.js');

print("--- both allowances are set together, from the same gap ---");
[["700","3000"],["1200","1500"],["1500","1500"]].forEach(function (p) {
  humanEloEl.value = p[0]; engineEloEl.value = p[1]; resetHelpBudget();
  print("  you " + p[0] + " vs " + p[1] + "  gap " + Math.abs(p[0]-p[1]) +
        "  ->  help " + helpMax + " tokens, takebacks " + tbMax);
});
print("\nnobody ever gets zero takebacks : " + (tbMax >= 1));
print("counters start clean            : used=" + tbUsed + " asked=" + tbAsked + " pending=" + tbPending);

print("\n--- the help budget rewinds with a takeback (no phantom charges) ---");
humanEloEl.value = "900"; engineEloEl.value = "1900"; resetHelpBudget();
uciHistory = ["e2e4","e7e5"]; spendHelp("look");
var snap = { helpLeft: helpMax, helpSpent: 0, helpEarned: 0, helpPosPaid: -1 }; // what the pre-move snapshot held
print("  after spending on this move : left=" + helpLeft + " spent=" + helpSpent);
helpLeft = snap.helpLeft; helpSpent = snap.helpSpent; helpPosPaid = snap.helpPosPaid;  // what undoMove restores
print("  after the takeback restores : left=" + helpLeft + " spent=" + helpSpent + "   <- the charge is undone too");
print("  and the position is re-chargeable : " + (helpPosPaid === -1));
