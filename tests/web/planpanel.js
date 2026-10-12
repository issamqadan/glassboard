// THE STRATEGY AREA's decision logic. Everything it says about the position must
// come from the engine's own read — steps[].done, arrows, rings, moveNote — and it
// must never contradict the safety ladder.
var window = this; load(SRC + 'gb-strategy-state.js');
var GBStrategyState = window.GBStrategyState;

var PLAN = { id: "develop", name: "Develop & Castle", idea: "Get your pieces out and tuck the king away",
             moveUci: "b1c3", moveSan: "Nc3", moveNote: "brings the last knight into play",
             arrows: [{ from: 1, to: 18, kind: "dev" }], rings: [18],
             steps: [{ text: "Develop your knights", done: true },
                     { text: "Develop your bishops", done: false },
                     { text: "Castle your king", done: false }] };
var OTHER = { id: "centre", name: "Take the centre", idea: "Own e4/d4", steps: [] };

// stubs
var firstGame = false, humanColor = "white", uciHistory = [], helpDelivery = "open";
var STRAT_ICON = { develop: "♘", centre: "✚" };
var assistData = { strategy: { strategies: [PLAN, OTHER] } };
var stratState = GBStrategyState.create();
var planPanelOpen = true, planPickerOpen = false, planRevealed = false;
// Mobile collapses the step list behind a toggle; the plan, progress and current
// objective stay visible. Default collapsed, as on a phone.
var planExpanded = false;
var drawnWith = "none", answerShown = true, priority = null;
function escapeHtml(x) { return String(x == null ? "" : x); }
function drawPlan(s) { drawnWith = s ? s.id : "none"; }
function pickPriority() { return priority; }
function showAnswer() { return answerShown; }
function uciSquares() { return { from: 1, to: 18 }; }
function currentOpening() { return null; }
function playMove() {}
function askForHelp() {}
function paint() {}
function setActivePlan(id) {
  if (!id) { stratState = GBStrategyState.create(); return; }
  var c = assistData.strategy.strategies.filter(function (x) { return x.id === id; })[0] || { id: id };
  stratState = GBStrategyState.activate(GBStrategyState.create(), c, 0);
}
var game = { status: function () { return "ongoing"; }, sideToMove: function () { return "white"; } };
var EL = { hidden: true, innerHTML: "", className: "", querySelectorAll: function () { return []; } };
var document = { getElementById: function (id) { return id === "planPanel" ? EL : null; } };
load(TESTDIR + '/planpanel.src');

function render() { EL.innerHTML = ""; renderPlanPanel(); return EL.innerHTML; }
var fails = 0;
function want(label, cond) { print("  " + (cond ? "ok  " : "FAIL") + " " + label); if (!cond) fails++; }

print("--- the second card is ONLY the chooser now ---");
// The plan's name, progress, objective and the single recommendation live in the
// guidance card (the Lens). This element exists solely to choose a strategy, so a
// closed chooser renders nothing at all.
planPickerOpen = false;
var h = render();
want("closed chooser renders nothing", EL.hidden === true && h === "");
planPickerOpen = true;
h = render();
want("open chooser lists the plans", /Choose a strategy/.test(h) && /Develop & Castle/.test(h) && /Take the centre/.test(h));
want("each plan shows its idea", /Get your pieces out/.test(h));
want("and how much of it the position already meets", /\d+\/\d+ met/.test(h));
want("no move is offered here", h.indexOf("ppPlay") < 0 && h.indexOf("Nc3") < 0);
want("no overlay", !/sheet-overlay/.test(h));

print("\n--- board annotations follow the ACTIVE plan, chooser open or shut ---");
setActivePlan("develop"); planPickerOpen = false; render();
want("arrows drawn for the active plan", drawnWith === "develop");
setActivePlan(null); render();
want("cleared when the plan is dropped", drawnWith === "none");
setActivePlan("develop");
assistData = { strategy: { strategies: [OTHER] } };
GBStrategyState.observe(stratState, [OTHER], 12);
render();
want("no stale arrows once the engine stops offering it", drawnWith === "none");
assistData = { strategy: { strategies: [PLAN, OTHER] } };
game.sideToMove = function () { return "black"; };
render();
want("cleared when it is not your turn", drawnWith === "none");
game.sideToMove = function () { return "white"; };

print(fails ? "\n" + fails + " FAIL(s)" : "\nthe chooser behaves");

print("\n--- the recommendation states its relationship to the plan ---");
load(SRC + 'gb-assist-ui.js');
var AU = window.GBAssistUI;
function prio(recUci, recNote, planMove) {
  return AU.pickPriority({
    assistData: { candidates: [{ uci: recUci, san: "e4", note: recNote }], hanging: [], threats: [] },
    recommended: { uci: recUci, from: 12, to: 28, san: "e4", note: recNote },
    picked: planMove ? { moveUci: planMove, moveSan: "Nf3", verb: "development",
                         steps: [{ text: "Develop your knights", done: false }] } : null,
    game: null, Game: null, myColor: "white",
  });
}
var off = prio("e2e4", "Grabs space in the centre.", "g1f3");
want("off-plan move is labelled as such", /not your plan's step/.test(off.label));
want("it names what the plan wanted", /Nf3/.test(off.why));
want("it names the objective", /develop your knights/i.test(off.why));
want("it says the plan survives", /plan is still on/.test(off.why));
want("it does not force the plan's inferior move", off.move.uci === "e2e4");
var on = prio("g1f3", "Develops a knight.", "g1f3");
want("on-plan move says so instead", /Continue your/.test(on.label) && !/not your plan/.test(on.label));
var noplan = prio("e2e4", "Grabs space in the centre.", null);
want("with no plan, no plan talk", !/plan/.test(noplan.why));

print("\n--- the Change control survives every render branch ---");
// The Lens rebuilds innerHTML on every paint and has branches for: awaiting a
// reveal, no recommendation yet, "Analyzing…", and the normal case. The plan
// header must appear in all of them, or tapping Change does nothing while the
// card happens to be in another state.
var src = readFile("web/main.js");
// Brace-match the function instead of slicing to another name: openStepsSheet is
// defined EARLIER in the file, so the original slice was empty and the assertion
// passed vacuously (0 === 0). A test that cannot fail is worse than no test.
function fnBody(src, name) {
  var a = src.indexOf("function " + name), o = src.indexOf("{", a), d = 0, m = o;
  while (true) {
    if (src[m] === "{") d++;
    else if (src[m] === "}") { d--; if (d === 0) break; }
    m++;
  }
  return src.slice(a, m + 1);
}
var lens = fnBody(src, "renderGlassLens");
var branches = (lens.match(/el\.innerHTML = glIdentityRow\(\)/g) || []).length;
var withHead = (lens.match(/el\.innerHTML = glIdentityRow\(\) \+ planHead/g) || []).length;
print("  branches that set the card's HTML : " + branches);
print("  branches that include the plan     : " + withHead);
want("the slice actually found the function", lens.length > 500 && branches >= 3);
want("every branch renders the plan header", branches === withHead && branches > 0);
want("the control is delegated, not re-bound per render", /addEventListener\("click"[\s\S]{0,200}lensChange/.test(src));
want("no per-render onclick for it remains", !/getElementById\("lensChange"\)/.test(src));
