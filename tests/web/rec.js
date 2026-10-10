var window = this; load(SRC + 'gb-terms.js'); load(SRC + 'gb-help-budget.js');
var B = window.GBHelpBudget;
function r(cp, g) { var x = B.recommend({cp:cp, grantedBefore:g||0}); return x.advise.toUpperCase().padEnd(7) + " " + x.line; }
print("you a rook up (+500)      : " + r(500));
print("dead level (0)            : " + r(0));
print("you slightly worse (-120) : " + r(-120));
print("you losing (-400)         : " + r(-400));
print("you ahead but allowed 2   : " + r(500, 2));
print("\nadvises, never decides    : " + (B.recommend({cp:500}).advise === "grant" && B.recommend({cp:0}).advise === "refuse"));
