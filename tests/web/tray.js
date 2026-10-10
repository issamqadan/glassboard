var window = this; load(SRC + 'gb-assist-ui.js'); var S = window.GBAssistUI;
function chips(h) { return (h.match(/class="cap-pc[^"]*"/g) || []).length; }
function pops(h) { return (h.match(/cap-pc [a-z]+ pop/g) || []).length; }

// Play-AI shape: a count map + explicit colour
var h = S.capTrayHTML({ p: 3, n: 1 }, "black", "you");
print("5 pawns+knight -> chips     : " + chips(h) + "  (grouped, not 4 glyphs)");
print("count shown for the pawns   : " + (h.indexOf('<i class="cap-n">3</i>') !== -1));
print("single knight has no count  : " + (h.split("cap-n").length - 1 === 1));
print("colour applied              : " + (h.indexOf('cap-pc black') !== -1));

// human-game shape: an array of piece chars, colour from the letter case
var h2 = S.capTrayHTML(["P", "P", "R"], null, "opp");
print("array form infers white     : " + (h2.indexOf('cap-pc white') !== -1));

// pop semantics — the whole point: a clock tick must not re-pop the trophies
S.capTrayReset();
var a = S.capTrayHTML({ p: 1 }, "black", "you");
print("\nfirst paint of a new game   : " + pops(a) + " pops  (want 0 — no popping the board state you joined into)");
var bb = S.capTrayHTML({ p: 1 }, "black", "you");
print("re-render, nothing captured : " + pops(bb) + " pops  (want 0 — this is the clock ticking)");
var c = S.capTrayHTML({ p: 2 }, "black", "you");
print("a pawn is actually taken    : " + pops(c) + " pops  (want 1)");
var d = S.capTrayHTML({ p: 2 }, "black", "you");
print("then the clock ticks again  : " + pops(d) + " pops  (want 0)");
// the two trays are independent
var e = S.capTrayHTML({ q: 1 }, "white", "opp");
print("opponent tray is separate   : " + pops(e) + " pops  (want 1, its own key)");
print("empty tray renders nothing  : " + (S.capTrayHTML({}, "white", "x") === ""));
print("reset clears the memory     : " + (function(){ S.capTrayReset(); return pops(S.capTrayHTML({p:2},"black","you")) === 0; })());
