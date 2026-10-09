// Glassboard RESIGNATION — you tip your king over.
//
// Issam's note (2026-10-09): in The Queen's Gambit, Mr Shaibel's first lesson to
// Beth isn't a move — he reaches out and tips his own king over. That gesture IS
// the resignation, and it's the oldest piece of etiquette in chess. A button
// labelled "Resign" teaches nobody anything; a king lying on its side teaches
// everybody at once, including the person watching.
//
// So: resigning topples the king on the board, for whichever side gave up, in both
// Play-AI and human games. The engine does it too — it doesn't just print a result,
// it lays its king down.
//
// Shared because the gesture must look identical in both games, and because the
// board re-renders from scratch on every paint: the toppled state lives here so a
// repaint can restore it instead of standing the king back up.
(function (global) {
  let toppled = null;   // the square whose king is down, or null
  let fellAt = 0;       // when it fell, so the fall animates ONCE and then just rests

  // Where is this side's king? Returns -1 if it isn't on the board.
  function kingSquare(boardString, white) {
    const want = white ? "K" : "k";
    for (let i = 0; i < 64; i++) if (boardString[i] === want) return i;
    return -1;
  }

  // Lay the king down. Call once when a side resigns.
  function tip(sq) {
    if (sq == null || sq < 0) return false;
    toppled = sq;
    fellAt = Date.now();
    return true;
  }
  function clear() { toppled = null; fellAt = 0; }
  function isDown(sq) { return toppled != null && sq === toppled; }

  // Classes for the square being rendered. The `fall` class carries the animation
  // and is only handed out for the first second — after that the king is simply
  // resting on its side, so a later repaint doesn't replay the topple.
  function classFor(sq) {
    if (!isDown(sq)) return "";
    return Date.now() - fellAt < 1000 ? " toppled fall" : " toppled";
  }

  // The lesson, in one line — shown the first time a player sees it happen.
  const LESSON = "Tipping your king over is how chess players resign — it means “I'm done, you've won.” No words needed.";

  global.GBResign = { kingSquare, tip, clear, isDown, classFor, LESSON };
})(typeof window !== "undefined" ? window : this);
