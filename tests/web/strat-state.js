var window = this; load(SRC + 'gb-strategy-state.js'); var S = window.GBStrategyState;
var PLAN = { id: "kingside", name: "Kingside attack", idea: "Storm the king with f-g-h pawns",
             steps: [{text:"Get the knight to f5", done:true},{text:"Push g4", done:false},{text:"Open the h-file", done:false}] };
var OTHER = { id: "queenside", name: "Queenside majority", idea: "Make a passed pawn on the c-file" };

print("--- the bug this module exists to kill ---");
var st = S.create();
S.activate(st, PLAN, 10);
print("  activated            : " + st.name + " [" + st.state + "]");
// The engine's candidate list no longer offers it — the OLD code deleted the plan here.
S.observe(st, [OTHER], 14);
print("  no longer recommended: id=" + st.id + " state=" + st.state);
if (!st.id) print("  FAIL the plan was deleted — this is the original bug");
if (!S.isLive(st)) print("  FAIL a plan under reassessment must still be live");
print("  still the player's   : " + S.isLive(st) + ", needs reassessment: " + S.needsReassess(st));
print("  and it says why      : \"" + S.statusLine(st, 18) + "\"");

print("\n--- repaints cannot touch it ---");
for (var i = 0; i < 50; i++) S.observe(st, [OTHER], 14);
print("  after 50 repaints    : id=" + st.id + " state=" + st.state);
if (!st.id) print("  FAIL repeated repaints erased it");

print("\n--- the position comes back to it ---");
S.observe(st, [PLAN, OTHER], 20);
print("  recommended again    : state=" + st.state + "  (reassess cleared: " + (st.reassessSincePly === 0) + ")");
if (st.state !== "advancing") print("  FAIL should be advancing again");

print("\n--- only the player ends a plan ---");
var a = S.activate(S.create(), PLAN, 4); S.abandon(a);
print("  abandon()            : state=" + a.state + " live=" + S.isLive(a));
var c = S.activate(S.create(), PLAN, 4); S.complete(c);
print("  complete()           : state=" + c.state + " live=" + S.isLive(c));
var r = S.replace(S.activate(S.create(), PLAN, 4), OTHER, 9);
print("  replace()            : now '" + r.name + "' (replaced " + r.replacedId + ")");
if (S.isLive(a) || S.isLive(c)) print("  FAIL an ended plan must not be live");
// an ended plan must stay ended even if the engine recommends it again
S.observe(a, [PLAN], 30);
print("  abandoned stays gone : state=" + a.state);
if (a.state !== "abandoned") print("  FAIL an abandoned plan came back");

print("\n--- step progress is the engine's, not invented ---");
var p = S.activate(S.create(), PLAN, 10);
print("  steps done           : " + S.stepsDone(p) + " of " + p.steps.length);
print("  current step         : \"" + (S.currentStep(p) || {}).text + "\"");
print("  status line          : \"" + S.statusLine(p, 12) + "\"");
if (S.stepsDone(p) !== 1) print("  FAIL step count should come from done flags");

print("\n--- it survives a reload (lives WITH the game) ---");
var saved = JSON.stringify(S.toJSON(st));
var back = S.fromJSON(JSON.parse(saved));
print("  round-tripped        : " + back.name + " [" + back.state + "] live=" + S.isLive(back));
if (back.id !== st.id || back.state !== st.state) print("  FAIL did not survive serialisation");
print("  no plan -> null      : " + (S.toJSON(S.create()) === null));
print("  garbage -> empty     : " + (S.fromJSON({}).id === null) + ", " + (S.fromJSON(null).id === null));
