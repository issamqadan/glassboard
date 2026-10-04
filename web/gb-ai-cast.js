// Glassboard AI CAST — your opponent has a name, shared by every screen.
//
// "Glassboard AI" is a product, not an opponent. A named character with a voice
// makes a game feel like a match against someone, and makes beating them mean
// something. The roster is picked by STYLE so the name matches how they play.
//
// This lives in its own module because TWO screens must agree on the answer: the
// board (main.js) and the lobby (portal.html). If each kept its own copy — or
// picked at random — the opponent you faced would be called something else in the
// lobby, which is exactly the bug this fixes.
//
// personaFor(id, style) is a PURE function of the game id: same game, same
// opponent, forever, on any screen and after any reload. Games saved before
// personas existed get a real name this way instead of a generic fallback.
(function (global) {
  const CAST = {
    aggressive: [
      { n: "Blitz Kowalski", e: "⚡", t: "never met a sacrifice they didn't like" },
      { n: "Vera Storm", e: "🌩", t: "comes straight at your king" },
      { n: "Rook Malone", e: "🔥", t: "attacks first, counts material later" },
    ],
    positional: [
      { n: "Professor Olen", e: "🧠", t: "squeezes you one square at a time" },
      { n: "Mira Vance", e: "♟", t: "quiet moves, slow suffocation" },
      { n: "Anatoly Quill", e: "📐", t: "believes in structure above all" },
    ],
    defensive: [
      { n: "The Wall", e: "🛡", t: "would rather trade than tango" },
      { n: "Greta Stone", e: "🧱", t: "patient, solid, impossible to rush" },
      { n: "Tariq Shield", e: "⚓", t: "digs in and dares you to break through" },
    ],
    wildcard: [
      { n: "Jester Nox", e: "🎲", t: "unpredictable — and enjoying it" },
      { n: "Luna Flip", e: "🃏", t: "plays whatever amuses her today" },
      { n: "Chaos Theory", e: "🌀", t: "you will not see it coming" },
    ],
    balanced: [
      { n: "Sam Steady", e: "⚖", t: "plays the best move, every time" },
      { n: "Nadia Clark", e: "♞", t: "no weaknesses, no theatrics" },
      { n: "Felix Orr", e: "🎯", t: "correct, calm, relentless" },
    ],
  };

  const rosterFor = (style) => CAST[style] || CAST.balanced;

  // Stable 32-bit string hash (FNV-1a). Deterministic across pages and reloads.
  function hash(s) {
    let h = 0x811c9dc5;
    s = String(s || "");
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return h >>> 0;
  }

  // The opponent for a given game. Derived, never random — so the lobby card and
  // the board always name the same character.
  function personaFor(id, style) {
    const list = rosterFor(style);
    return list[hash(id) % list.length];
  }

  // A fresh opponent for a brand-new game (free to be random — it gets saved).
  function pick(style) {
    const list = rosterFor(style);
    return list[Math.floor(Math.random() * list.length)];
  }

  // What to show for a game record: the persona it was played against if we have
  // one, otherwise the one its id derives to. Never "Glassboard AI".
  function forGame(g) {
    if (!g) return pick("balanced");
    if (g.aiPersona && g.aiPersona.n) return g.aiPersona;
    return personaFor(g.id, g.aiStyle);
  }

  global.GBAiCast = { CAST, rosterFor, personaFor, pick, forGame };
})(typeof window !== "undefined" ? window : this);
