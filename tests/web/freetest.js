var window = this; load(SRC + 'gb-terms.js'); load(SRC + 'gb-help-budget.js');
var humanEloEl = { value: "900" }, engineEloEl = { value: "3000" };   // a 2100 gap
var aiAssistOverride = "guided", firstGame = false, uciHistory = [], playerHelpLog = [];
load(TESTDIR + '/bwire.js');
var B = window.GBHelpBudget;

print('--- "♾️ Full help" (what he chose) ---');
helpUnlimited = true; resetHelpBudget();
print("  help allowance  : " + helpMax + "   takebacks: " + tbMax);
print("  counter shows   : " + B.counter(helpLeft, helpMax));
var i, guard = 0;
for (i = 0; i < 40; i++) { uciHistory.push("a2a3"); uciHistory.push("a7a6"); if (!spendHelp("look")) guard++; }
print("  after 40 moves  : spent=" + helpSpent + " blocked=" + guard + " available=" + scarceAvailable());
print("  never cut off   : " + (guard === 0 && scarceAvailable() === true));
print("  still COUNTED   : " + B.summary({max:helpMax, spent:helpSpent}));

print('\n--- "⚖️ Match my opponent" (sized, rationed) ---');
helpUnlimited = false; resetHelpBudget(); uciHistory = [];
print("  help allowance  : " + helpMax + "   takebacks: " + tbMax);
print("  counter shows   : " + B.counter(helpLeft, helpMax) + "   <- a number, not 10 clipped emoji");
guard = 0;
for (i = 0; i < 40; i++) { uciHistory.push("a2a3"); uciHistory.push("a7a6"); if (!spendHelp("look")) guard++; }
print("  after 40 moves  : spent=" + helpSpent + " blocked=" + guard + " available=" + scarceAvailable());
print("  stops at the agreed number : " + (helpSpent === 10));

print("\n--- a 5-token allowance still gets dots ---");
humanEloEl.value = "1200"; engineEloEl.value = "1500"; resetHelpBudget();
print("  allowance " + helpMax + " -> " + B.counter(helpLeft, helpMax));

print("\n--- resume keeps what you had left ---");
helpUnlimited = false; humanEloEl.value = "900"; engineEloEl.value = "3000"; resetHelpBudget();
uciHistory = ["a","b"]; spendHelp("x"); uciHistory.push("c","d"); spendHelp("x");
var rec = { helpFree: false, helpMax: isFinite(helpMax)?helpMax:null, helpLeft: isFinite(helpLeft)?helpLeft:null, helpSpent: helpSpent, tbMax: isFinite(tbMax)?tbMax:null, tbUsed: 1 };
print("  saved           : max=" + rec.helpMax + " left=" + rec.helpLeft + " spent=" + rec.helpSpent);
helpMax = 0; helpLeft = 0; helpSpent = 0;                        // simulate a fresh page
helpUnlimited = !!rec.helpFree; resetHelpBudget();
if (typeof rec.helpMax === "number") helpMax = rec.helpMax;
if (typeof rec.helpLeft === "number") helpLeft = rec.helpLeft;
helpSpent = rec.helpSpent || 0;
print("  restored        : max=" + helpMax + " left=" + helpLeft + " spent=" + helpSpent + " available=" + scarceAvailable());
print("  not dead on resume : " + (scarceAvailable() === true && helpMax > 0));
var recF = { helpFree: true, helpMax: null, helpLeft: null };
helpUnlimited = !!recF.helpFree; resetHelpBudget();
print("  unlimited survives JSON (null) : " + (helpMax === Infinity) + " -> " + B.counter(helpLeft, helpMax));
