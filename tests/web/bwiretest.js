var window = this; load(SRC + 'gb-terms.js'); load(SRC + 'gb-help-budget.js');
// stubs for what the extracted wiring touches
var humanEloEl = { value: "900" }, engineEloEl = { value: "1900" };  // a 1000-pt gap
var aiAssistOverride = "guided", firstGame = false;
var uciHistory = [], playerHelpLog = [];
load(TESTDIR + '/bwire.js');

resetHelpBudget();
print("gap 1000 -> allowance        : " + helpMax + " tokens");
print("available at the start       : " + scarceAvailable());

print("\n--- spending is once per POSITION, not per glance ---");
uciHistory = ["e2e4","e7e5"];
print("  first look this move       : " + spendHelp("look") + "  left=" + helpLeft);
print("  looking again, same move   : " + spendHelp("look") + "  left=" + helpLeft + "  (no double charge)");
uciHistory = ["e2e4","e7e5","g1f3","b8c6"];
print("  a new move                 : " + spendHelp("look") + "  left=" + helpLeft);

print("\n--- running out, and what that means ---");
var guard = 0;
while (helpLeft > 0 && guard++ < 50) { uciHistory.push("a2a3"); uciHistory.push("a7a6"); spendHelp("look"); }
print("  tokens left                : " + helpLeft);
uciHistory.push("b2b3"); uciHistory.push("b7b6");
print("  can still take scarce help : " + scarceAvailable() + "   (want false)");
print("  spendHelp refuses          : " + spendHelp("look"));
print("  SAFETY is still free       : " + (!GBHelpBudget.isScarce("hanging") && GBHelpBudget.isFree("hanging")) + "   <- never blind");

print("\n--- help off / guided first game: nothing is metered ---");
aiAssistOverride = "off";
print("  help off -> available      : " + scarceAvailable() + ", spend ok: " + spendHelp("x"));
aiAssistOverride = "guided"; firstGame = true;
print("  guided first game          : " + scarceAvailable() + ", spend ok: " + spendHelp("x"));
firstGame = false;

print("\n--- an even match gets a small allowance, a mismatch a big one ---");
humanEloEl.value = "1500"; engineEloEl.value = "1500"; resetHelpBudget();
print("  even (gap 0)               : " + helpMax);
humanEloEl.value = "700"; engineEloEl.value = "3000"; resetHelpBudget();
print("  beginner vs Master (2300)  : " + helpMax);
print("  log recorded " + playerHelpLog.length + " help events for the glass box");
