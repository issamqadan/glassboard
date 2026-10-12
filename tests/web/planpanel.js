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
var drawnWith = "none", answerShown = true, priority = null;
function escapeHtml(x) { return String(x == null ? "" : x); }
function drawPlan(s) { drawnWith = s ? s.id : "none"; }
function pickPriority() { return priority; }
function showAnswer() { return answerShown; }
function uciSquares() { return { from: 1, to: 18 }; }
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

print("--- no plan chosen: the area invites you to pick one ---");
var h = render();
want("offers a choice", /Choose a plan/.test(h));
want("lists the engine's fitting plans", /Develop &amp;? ?Castle|Develop & Castle/.test(h) && /Take the centre/.test(h));
want("each plan states its own idea", /Get your pieces out/.test(h));
want("no board annotation while nothing is chosen", drawnWith === "none");

print("\n--- a plan is chosen: progress comes from the engine's done-flags ---");
setActivePlan("develop"); h = render();
want("shows progress 1/3", /1\/3/.test(h));
want("names the current objective", /Now:<\/b> Develop your bishops|Develop your bishops/.test(h));
want("marks the done step", /pp-step done/.test(h));
want("marks the current step", /pp-step now/.test(h));
want("draws THIS plan's annotations on the board", drawnWith === "develop");
want("offers a way to change plan", /ppChange/.test(h));

print("\n--- understanding is free; the move is separate ---");
answerShown = false; planRevealed = false; h = render();
want("objective readable without revealing", /Develop your bishops/.test(h));
want("the move itself is NOT shown yet", h.indexOf("Nc3") < 0);
want("does NOT duplicate the reveal control", h.indexOf("ppReveal") < 0);
want("no play button before revealing", h.indexOf("ppPlay") < 0);
answerShown = true; h = render();
want("revealed: shows the move", /Nc3/.test(h));
want("revealed: explains its purpose", /brings the last knight into play/.test(h));
want("revealing does not auto-play — a separate button", /ppPlay/.test(h));

print("\n--- a threat outranks the plan, and says so ---");
priority = { kind: "urgent", label: "Save your queen", why: "It is attacked by the knight." };
h = render();
want("states the immediate priority", /Save your queen/.test(h));
want("explains why", /attacked by the knight/.test(h));
want("says the plan survives", /plan is still on/.test(h));
want("does not also push the plan's move", h.indexOf("ppPlay") < 0 && h.indexOf("ppReveal") < 0);
want("the plan itself is still displayed", /Develop & Castle/.test(h));
priority = null;

print("\n--- the position moves away from the plan ---");
assistData = { strategy: { strategies: [OTHER] } };            // engine stops offering it
GBStrategyState.observe(stratState, [OTHER], 12);
h = render();
want("the plan is NOT dropped", /Develop & Castle/.test(h));
want("it is flagged for reassessment", /reassess/.test(EL.className));
want("and says why", /moved away from this plan/.test(h));
want("no stale arrows for a plan the engine isn't offering", drawnWith === "none");

print("\n--- not your turn / game over: nothing lingers ---");
assistData = { strategy: { strategies: [PLAN] } };
game.sideToMove = function () { return "black"; };
h = render();
want("panel hides", EL.hidden === true);
want("board annotations cleared", drawnWith === "none");
game.sideToMove = function () { return "white"; };

print(fails ? "\n" + fails + " FAIL(s)" : "\nthe strategy area behaves");

print("\n--- the plan is named in exactly ONE place ---");
load(SRC + 'gb-assist-ui.js');
var A = window.GBAssistUI;
var ctx = { opening: null, assistData: assistData, myColor: "white", oppColor: "black" };
var strip = A.stripHTML(ctx) || "";
var ident = A.identityRowHTML(ctx) || "";
setActivePlan("develop");
var panel = render();
function has(x, s) { return x.indexOf(s) >= 0; }
want("strip above the board does NOT name the plan", !has(strip, "Develop & Castle"));
want("identity row does NOT name the plan", !has(ident, "Develop & Castle"));
want("the panel DOES name it", has(panel, "Develop & Castle"));
// and with a named opening in play, the strip still does its own job
var ctx2 = { opening: { name: "Sicilian Defense", side: "black", idea: "Unbalance it", eco: "B20" },
             assistData: assistData, myColor: "white", oppColor: "black" };
var strip2 = A.stripHTML(ctx2) || "";
want("strip still names the OPENING", has(strip2, "Sicilian Defense"));
want("strip still does not name the plan", !has(strip2, "Develop & Castle"));
