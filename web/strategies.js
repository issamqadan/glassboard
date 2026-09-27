// Glassboard strategy catalog — a data-driven, pluggable library of real, named
// chess strategies. Today it's a curated opening book (ECO name + the professional
// plan/idea behind each line). The abstraction is built for the roadmap:
//   • `source`  — "builtin" | "purchased" | "learned" (an LLM can capture a plan
//                 from either side's play and save it here as a reusable "skill")
//   • `unlocked`— gate for future purchasable strategies (all free/true for now)
// Identification is longest-prefix match over the game's UCI move history, so a
// specific variation (a longer line) overrides the broad opening it came from.
(function () {
  // Each entry: { eco, name, uci:[...half-moves...], idea, side, source, unlocked }.
  // `side` = who the line most characterises (white | black | both) — used to phrase
  // "the opponent is playing…". `idea` = the known strategic plan of that opening.
  const OPENINGS = [
    // ---- 1.e4 e5 (Open Games) ----
    { eco: "C60", name: "Ruy López", uci: ["e2e4","e7e5","g1f3","b8c6","f1b5"], side: "white",
      idea: "Pin/pressure the knight guarding e5, build a big pawn center, then a slow kingside build-up." },
    { eco: "C50", name: "Italian Game", uci: ["e2e4","e7e5","g1f3","b8c6","f1c4"], side: "white",
      idea: "Aim the bishop at f7, fight for the center with c3–d4, castle and attack." },
    { eco: "C55", name: "Two Knights Defense", uci: ["e2e4","e7e5","g1f3","b8c6","f1c4","g8f6"], side: "black",
      idea: "Counter-attack immediately, inviting sharp play against f7 and e4." },
    { eco: "C51", name: "Evans Gambit", uci: ["e2e4","e7e5","g1f3","b8c6","f1c4","f8c5","b2b4"], side: "white",
      idea: "Sacrifice a pawn to rip open lines and seize the center with c3–d4." },
    { eco: "C45", name: "Scotch Game", uci: ["e2e4","e7e5","g1f3","b8c6","d2d4"], side: "white",
      idea: "Open the center early, trade in the middle, and develop with tempo." },
    { eco: "C42", name: "Petrov Defense", uci: ["e2e4","e7e5","g1f3","g8f6"], side: "black",
      idea: "Mirror White and neutralize — a solid, symmetrical fight for equality." },
    { eco: "C41", name: "Philidor Defense", uci: ["e2e4","e7e5","g1f3","d7d6"], side: "black",
      idea: "A solid but passive setup; hold e5 and unravel behind a compact structure." },
    { eco: "C47", name: "Four Knights Game", uci: ["e2e4","e7e5","g1f3","b8c6","b1c3","g8f6"], side: "both",
      idea: "Symmetrical development; sound and classical, angling for small edges." },
    { eco: "C30", name: "King's Gambit", uci: ["e2e4","e7e5","f2f4"], side: "white",
      idea: "Offer the f-pawn to blast open the f-file and chase a fast attack." },
    { eco: "C25", name: "Vienna Game", uci: ["e2e4","e7e5","b1c3"], side: "white",
      idea: "Prepare f4 with the knight out first — a slower King's-Gambit idea." },
    { eco: "C23", name: "Bishop's Opening", uci: ["e2e4","e7e5","f1c4"], side: "white",
      idea: "Early pressure on f7, flexible move order into Italian/Vienna structures." },

    // ---- 1.e4 c5 (Sicilian) ----
    { eco: "B90", name: "Sicilian — Najdorf", uci: ["e2e4","c7c5","g1f3","d7d6","d2d4","c5d4","f3d4","g8f6","b1c3","a7a6"], side: "black",
      idea: "…a6 controls b5 and prepares …e5/…e6 with queenside counterplay — the fighting main line." },
    { eco: "B76", name: "Sicilian — Dragon", uci: ["e2e4","c7c5","g1f3","d7d6","d2d4","c5d4","f3d4","g8f6","b1c3","g7g6"], side: "black",
      idea: "Fianchetto the bishop and storm down the c-file while White races on the kingside." },
    { eco: "B33", name: "Sicilian — Sveshnikov", uci: ["e2e4","c7c5","g1f3","b8c6","d2d4","c5d4","f3d4","g8f6","b1c3","e7e5"], side: "black",
      idea: "Accept a backward d-pawn/hole on d5 for active piece play and the bishop pair." },
    { eco: "B34", name: "Sicilian — Accelerated Dragon", uci: ["e2e4","c7c5","g1f3","b8c6","d2d4","c5d4","f3d4","g7g6"], side: "black",
      idea: "Fianchetto fast, pressure d4 and e4, and hit …d5 in one go." },
    { eco: "B22", name: "Sicilian — Alapin (c3)", uci: ["e2e4","c7c5","c2c3"], side: "white",
      idea: "Build a big center with d4; avoid theory and play for space." },
    { eco: "B23", name: "Closed Sicilian", uci: ["e2e4","c7c5","b1c3"], side: "white",
      idea: "Keep it closed, fianchetto, and expand on the kingside with f4–f5." },
    { eco: "B20", name: "Sicilian Defense", uci: ["e2e4","c7c5"], side: "black",
      idea: "Unbalance the game — trade a wing pawn for a center pawn and play for the win." },

    // ---- 1.e4 e6 / c6 / d5 / d6 / g6 ----
    { eco: "C02", name: "French — Advance", uci: ["e2e4","e7e6","d2d4","d7d5","e4e5"], side: "white",
      idea: "Grab space with e5, then attack the base of Black's chain on d5/queenside." },
    { eco: "C15", name: "French — Winawer", uci: ["e2e4","e7e6","d2d4","d7d5","b1c3","f8b4"], side: "black",
      idea: "Pin the knight, damage White's pawns with …Bxc3, and target the center." },
    { eco: "C00", name: "French Defense", uci: ["e2e4","e7e6"], side: "black",
      idea: "Solid but cramped; challenge the center with …d5 and break with …c5/…f6." },
    { eco: "B12", name: "Caro-Kann — Advance", uci: ["e2e4","c7c6","d2d4","d7d5","e4e5"], side: "white",
      idea: "Gain space; Black frees the light bishop early, so fight for the light squares." },
    { eco: "B10", name: "Caro-Kann Defense", uci: ["e2e4","c7c6"], side: "black",
      idea: "Solid structure with the good bishop developed outside the pawn chain." },
    { eco: "B01", name: "Scandinavian Defense", uci: ["e2e4","d7d5"], side: "black",
      idea: "Trade center pawns immediately; quick development, clear plans, little theory." },
    { eco: "B07", name: "Pirc Defense", uci: ["e2e4","d7d6","d2d4","g8f6","b1c3","g7g6"], side: "black",
      idea: "Cede the center, fianchetto, and strike back with …e5 or …c5." },
    { eco: "B06", name: "Modern Defense", uci: ["e2e4","g7g6"], side: "black",
      idea: "Hypermodern — let White build a center, then undermine it from the flanks." },
    { eco: "B02", name: "Alekhine Defense", uci: ["e2e4","g8f6"], side: "black",
      idea: "Provoke White's pawns forward, then attack the overextended center." },

    // ---- 1.d4 d5 (Closed / Queen's pawn) ----
    { eco: "D20", name: "Queen's Gambit Accepted", uci: ["d2d4","d7d5","c2c4","d5c4"], side: "black",
      idea: "Take the pawn, don't try to hold it — free your pieces and hit the center with …c5/…e5." },
    { eco: "D10", name: "Slav Defense", uci: ["d2d4","d7d5","c2c4","c7c6"], side: "black",
      idea: "Support d5 with …c6 while keeping the light bishop free — rock-solid." },
    { eco: "D30", name: "Queen's Gambit Declined", uci: ["d2d4","d7d5","c2c4","e7e6"], side: "black",
      idea: "Hold the center with a sound structure; free the game with …c5 or …dxc4 later." },
    { eco: "D06", name: "Queen's Gambit", uci: ["d2d4","d7d5","c2c4"], side: "white",
      idea: "Offer the c-pawn to deflect Black's d5 and build a dominating center." },
    { eco: "D02", name: "London System", uci: ["d2d4","d7d5","g1f3","g8f6","c1f4"], side: "white",
      idea: "A safe, repeatable setup: Bf4, e3, Bd3, c3 — then attack the kingside." },

    // ---- 1.d4 Nf6 (Indian defenses) ----
    { eco: "E20", name: "Nimzo-Indian Defense", uci: ["d2d4","g8f6","c2c4","e7e6","b1c3","f8b4"], side: "black",
      idea: "Pin and trade for the c3-knight to saddle White with doubled pawns; play on the light squares." },
    { eco: "E12", name: "Queen's Indian Defense", uci: ["d2d4","g8f6","c2c4","e7e6","g1f3","b7b6"], side: "black",
      idea: "Fianchetto to fight for e4 and the long diagonal — flexible and solid." },
    { eco: "E11", name: "Bogo-Indian Defense", uci: ["d2d4","g8f6","c2c4","e7e6","g1f3","f8b4"], side: "black",
      idea: "Check on b4 to ease development and head for a comfortable, sound game." },
    { eco: "E00", name: "Catalan Opening", uci: ["d2d4","g8f6","c2c4","e7e6","g2g3"], side: "white",
      idea: "Fianchetto and press the long diagonal; a lasting bind on the queenside." },
    { eco: "E60", name: "King's Indian Defense", uci: ["d2d4","g8f6","c2c4","g7g6"], side: "black",
      idea: "Let White take the center, then blow it up with …e5 and a kingside pawn storm." },
    { eco: "D80", name: "Grünfeld Defense", uci: ["d2d4","g8f6","c2c4","g7g6","b1c3","d7d5"], side: "black",
      idea: "Strike the center with …d5, trade, then hammer White's big center from afar." },
    { eco: "A60", name: "Benoni Defense", uci: ["d2d4","g8f6","c2c4","c7c5"], side: "black",
      idea: "Accept a space deficit for a queenside majority and dynamic …b5/…f5 breaks." },

    // ---- Flank & others ----
    { eco: "A80", name: "Dutch Defense", uci: ["d2d4","f7f5"], side: "black",
      idea: "Grab kingside space and aim for a direct attack, accepting a slightly loose king." },
    { eco: "A20", name: "English — Reversed Sicilian", uci: ["c2c4","e7e5"], side: "white",
      idea: "A Sicilian a tempo up: pressure d5, fianchetto, and play on the queenside." },
    { eco: "A30", name: "English — Symmetrical", uci: ["c2c4","c7c5"], side: "white",
      idea: "Flexible maneuvering; fianchetto and fight for d5 and the small edges." },
    { eco: "A10", name: "English Opening", uci: ["c2c4"], side: "white",
      idea: "Control d5 from the flank, stay flexible, transpose when it suits you." },
    { eco: "A09", name: "Réti Opening", uci: ["g1f3","d7d5","c2c4"], side: "white",
      idea: "Hypermodern — attack d5 from the wing and fianchetto both bishops." },
    { eco: "A04", name: "Réti / King's Indian Attack", uci: ["g1f3"], side: "white",
      idea: "A universal knight-first setup; often a King's Indian Attack against most replies." },
    { eco: "A02", name: "Bird's Opening", uci: ["f2f4"], side: "white",
      idea: "Stake the kingside with f4 (a Dutch reversed) and aim for a f-file attack." },
    { eco: "A01", name: "Nimzo-Larsen Attack", uci: ["b2b3"], side: "white",
      idea: "Fianchetto the queen's bishop and fight for the long diagonal and e5." },
  ];

  function isPrefix(line, hist) {
    if (line.length > hist.length) return false;
    for (let i = 0; i < line.length; i++) if (line[i] !== hist[i]) return false;
    return true;
  }

  window.GBStrategies = {
    openings: OPENINGS,
    // Longest opening line that matches the start of the game's UCI history.
    identify(uciHist) {
      if (!uciHist || !uciHist.length) return null;
      let best = null;
      for (const o of OPENINGS) {
        if (!o.unlocked && o.unlocked !== undefined) continue; // reserved for purchasable
        if (isPrefix(o.uci, uciHist) && (!best || o.uci.length > best.uci.length)) best = o;
      }
      return best;
    },
    // Room for the roadmap: register a strategy at runtime (e.g. an LLM-learned skill).
    add(entry) { OPENINGS.push(Object.assign({ source: "learned", unlocked: true }, entry)); },
  };
  // Default every built-in entry to a free, owned, built-in strategy.
  OPENINGS.forEach((o) => { if (o.source === undefined) o.source = "builtin"; if (o.unlocked === undefined) o.unlocked = true; });
})();
