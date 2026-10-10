var window = this; load(SRC + 'gb-assist-ui.js'); var S = window.GBAssistUI;
function pops(h) { return (h.match(/cap-pc [a-z]+ pop/g) || []).length; }
S.capTrayReset();
S.capTrayHTML({ p: 1 }, "black", "you");   // seed both trays
S.capTrayHTML({ p: 1 }, "white", "opp");
var y = S.capTrayHTML({ p: 2 }, "black", "you");  // YOU take a pawn
var o = S.capTrayHTML({ p: 1 }, "white", "opp");  // opponent took nothing
print("your tray pops              : " + pops(y) + "  (want 1)");
print("opponent tray stays quiet   : " + pops(o) + "  (want 0 — keys are independent)");
