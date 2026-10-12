// The mobile assistance sheet's PEEK line and its three states.
//
// This is a behavioural test, not a layout one: it asserts what the sheet SAYS and
// which classes it carries, which is the part a screenshot can't check cheaply and
// the part that silently broke before (a plan that vanished from the header, a
// collapse control that never flipped).
load(SRC + "gb-strategy-state.js");
load(SRC + "gb-assist-sheet.js");

var fails = 0;
function ok(name, cond) { if (!cond) { fails++; print("FAIL " + name); } else print("  ok   " + name); }

// A DOM small enough to be obviously correct.
function El() {
  this.innerHTML = ""; this.textContent = ""; this.hidden = false; this.attrs = {}; this.cls = {};
  var self = this;
  this.setAttribute = function (k, v) { self.attrs[k] = v; };
  this.classList = { toggle: function (c, on) { self.cls[c] = !!on; } };
}
function parts() { return { sheet: new El(), peek: new El(), quick: new El() }; }

var S = GBStrategyState;

// ---- no plan: the sheet invites you to pick one -----------------------------
var p = parts();
GBAssistSheet.render({ sheet: p.sheet, peek: p.peek, quick: p.quick,
  state: S.create(), live: null, ply: 0, open: false, move: null });
ok("no plan -> peek says Choose a strategy", p.peek.innerHTML.indexOf("Choose a strategy") >= 0);
ok("no plan -> collapsed chevron points up", p.peek.innerHTML.indexOf("▴") >= 0);
ok("no plan -> sheet is in the peek state", p.sheet.cls.peek === true && p.sheet.cls.open === false);
ok("no move -> the quick button is hidden", p.quick.hidden === true);

// ---- a live plan: name, progress and the CURRENT objective -------------------
var st = S.activate(S.create(), {
  id: "develop", name: "Develop & Castle", idea: "Get your pieces out.",
  steps: [{ text: "Develop your knights", done: true },
          { text: "Develop your bishops", done: false },
          { text: "Castle your king", done: false }],
}, 4);
S.observe(st, [{ id: "develop", name: "Develop & Castle",
  steps: [{ text: "Develop your knights", done: true },
          { text: "Develop your bishops", done: false },
          { text: "Castle your king", done: false }] }], 4);

p = parts();
GBAssistSheet.render({ sheet: p.sheet, peek: p.peek, quick: p.quick,
  state: st, live: null, ply: 4, open: false, move: { san: "Nf3", from: "g1", to: "f3" },
  onQuick: function () { p.played = true; } });
ok("peek names the plan", p.peek.innerHTML.indexOf("Develop &amp; Castle") >= 0);
ok("peek shows progress out of the real step count", p.peek.innerHTML.indexOf("1/3") >= 0);
ok("peek shows the CURRENT objective, not the first", p.peek.innerHTML.indexOf("Develop your bishops") >= 0);
ok("peek does not show a finished objective as current",
   p.peek.innerHTML.indexOf("Develop your knights") < 0);
ok("the move stays one tap away while collapsed",
   p.quick.hidden === false && p.quick.textContent.indexOf("Nf3") >= 0);

// ---- open: the chevron flips and the state classes swap ----------------------
p = parts();
GBAssistSheet.render({ sheet: p.sheet, peek: p.peek, quick: p.quick,
  state: st, live: null, ply: 4, open: true, move: { san: "Nf3" } });
ok("open -> chevron points down", p.peek.innerHTML.indexOf("▾") >= 0);
ok("open -> sheet carries .open and not .peek", p.sheet.cls.open === true && p.sheet.cls.peek === false);
ok("open -> aria-expanded is true", p.peek.attrs["aria-expanded"] === "true");

// ---- the honest case: the position has moved away from the plan --------------
// The peek must NOT keep showing the next objective as if it were on track.
S.observe(st, [{ id: "center", name: "Seize the Centre" }], 10);
p = parts();
GBAssistSheet.render({ sheet: p.sheet, peek: p.peek, quick: p.quick,
  state: st, live: null, ply: 10, open: false, move: null });
ok("plan survives a position that stopped recommending it", S.isLive(st));
ok("peek still names the plan the player chose",
   p.peek.innerHTML.indexOf("Develop &amp; Castle") >= 0);
ok("peek says the position has moved away rather than faking progress",
   p.peek.innerHTML.indexOf("moved away from this plan") >= 0);

// ---- the live engine view wins over the stored copy --------------------------
p = parts();
GBAssistSheet.render({ sheet: p.sheet, peek: p.peek, quick: p.quick,
  state: st, ply: 10, open: false, move: null,
  live: { id: "develop", name: "Develop & Castle",
          steps: [{ text: "a", done: true }, { text: "b", done: true }, { text: "c", done: false }] } });
ok("progress comes from the engine's live step flags", p.peek.innerHTML.indexOf("2/3") >= 0);

// ---- user text is escaped ----------------------------------------------------
var evil = S.activate(S.create(), { id: "x", name: "<img src=x onerror=1>", steps: [] }, 0);
p = parts();
GBAssistSheet.render({ sheet: p.sheet, peek: p.peek, quick: p.quick,
  state: evil, live: null, ply: 0, open: false, move: null });
ok("plan names are escaped", p.peek.innerHTML.indexOf("<img") < 0);

print(fails ? "FAIL " + fails + " sheet checks" : "sheet: all checks passed");
