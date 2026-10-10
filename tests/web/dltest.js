// Stubs for everything the extracted code touches.
var board = ".".repeat(64).split(""), hist = [], lastMove = null, moveSound = null;
var uciHistory = hist, makeOk = true, side = "black", status = "ongoing", legal = {};
var busy = false, flagged = false, resigned = false, aiResigned = false, repetitionDraw = false;
var replies = 0;
function recordPosition() {}
function engineReply() { replies++; }
function engineColor() { return "black"; }
function uciToSquares(u) {
  return { from: (u.charCodeAt(0)-97) + (u.charCodeAt(1)-49)*8, to: (u.charCodeAt(2)-97) + (u.charCodeAt(3)-49)*8 };
}
var game = {
  boardString: function () { return board.join(""); },
  makeMove: function () { return makeOk; },
  sideToMove: function () { return side; },
  status: function () { return status; },
  legalTo: function (i) { return legal[i] || []; },
};
load(TESTDIR + '/deadlock.js');

print("--- applyEngineMove: the unplayed-move deadlock ---");
print("  null reply            -> " + applyEngineMove(null) + "   (was silently ignored)");
print("  '(none)'-ish short    -> " + applyEngineMove("abc"));
makeOk = false;
print("  board REJECTS move    -> " + applyEngineMove("e2e4") + "   (makeMove's result used to be discarded)");
makeOk = true;
var before = hist.length;
print("  legal move            -> " + applyEngineMove("e2e4") + "   (history +" + (hist.length - before) + ")");

print("\n--- anyLegalMove: the last resort ---");
legal = {};
print("  no legal moves        -> " + anyLegalMove() + "   (not stuck — that's checkmate/stalemate)");
legal[4] = [12];                    // e1 -> e2, a king step
board[4] = "K";
print("  king has one move     -> " + anyLegalMove() + "   (want e1e2)");
legal = {}; board = ".".repeat(64).split("");
board[48] = "P"; legal[48] = [56];  // a7 -> a8, promotes
print("  pawn reaching the end -> " + anyLegalMove() + "   (want a7a8q — promotion included)");

print("\n--- ensureTurnProgress: the safety net ---");
side = "black"; status = "ongoing"; replies = 0;
ensureTurnProgress();
print("  engine's turn, idle   -> fires: " + (replies === 1) + "   <- this is what un-sticks the game");
replies = 0; busy = true; ensureTurnProgress();
print("  already searching     -> fires: " + (replies > 0) + "   (want false, no double move)");
busy = false; side = "white"; ensureTurnProgress();
print("  YOUR turn             -> fires: " + (replies > 0) + "   (want false)");
side = "black"; status = "checkmate"; ensureTurnProgress();
print("  game already over     -> fires: " + (replies > 0) + "   (want false)");
status = "ongoing"; aiResigned = true; ensureTurnProgress();
print("  opponent resigned     -> fires: " + (replies > 0) + "   (want false)");
aiResigned = false; repetitionDraw = true; ensureTurnProgress();
print("  draw by repetition    -> fires: " + (replies > 0) + "   (want false)");
