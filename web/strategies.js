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

    // ==== Advanced variations (longer lines override the broad opening) ====
    // ---- Ruy López deep lines ----
    { eco: "C70", name: "Ruy López — Morphy Defence", uci: ["e2e4","e7e5","g1f3","b8c6","f1b5","a7a6"], side: "black",
      idea: "…a6 questions the bishop; keep the tension and prepare …Nf6/…b5 with a full-blooded Spanish fight." },
    { eco: "C84", name: "Ruy López — Closed", uci: ["e2e4","e7e5","g1f3","b8c6","f1b5","a7a6","b5a4","g8f6","e1g1","f8e7"], side: "both",
      idea: "The main-line Spanish: White builds with c3–d4 and a slow kingside build-up; Black holds e5 and expands with …b5/…d6." },
    { eco: "C89", name: "Ruy López — Marshall Attack", uci: ["e2e4","e7e5","g1f3","b8c6","f1b5","a7a6","b5a4","g8f6","e1g1","f8e7","f1e1","b7b5","a4b3","e8g8","c2c3","d7d5"], side: "black",
      idea: "Sacrifice a pawn with …d5 for a raging attack on White's king — deep, forcing, and razor-sharp." },
    { eco: "C80", name: "Ruy López — Open", uci: ["e2e4","e7e5","g1f3","b8c6","f1b5","a7a6","b5a4","g8f6","e1g1","f6e4"], side: "black",
      idea: "Grab e4 and play actively with …d5 and …Bc5/…Nc5, accepting an open, piece-play battle." },
    { eco: "C68", name: "Ruy López — Exchange", uci: ["e2e4","e7e5","g1f3","b8c6","f1b5","a7a6","b5c6","d7c6"], side: "white",
      idea: "Trade on c6, aim for a healthy kingside majority and a favourable endgame despite Black's bishop pair." },
    { eco: "C65", name: "Ruy López — Berlin Defence", uci: ["e2e4","e7e5","g1f3","b8c6","f1b5","g8f6"], side: "black",
      idea: "Head for the rock-solid Berlin endgame — the famous drawing weapon that neutralises White's initiative." },

    // ---- Italian / open-game deep lines ----
    { eco: "C53", name: "Giuoco Piano", uci: ["e2e4","e7e5","g1f3","b8c6","f1c4","f8c5"], side: "both",
      idea: "The 'quiet game': build slowly with c3 and d3–d4, castle, and manoeuvre for a central break." },
    { eco: "C57", name: "Two Knights — Knight Attack", uci: ["e2e4","e7e5","g1f3","b8c6","f1c4","g8f6","f3g5"], side: "white",
      idea: "Ng5 hits f7 at once (Fried Liver territory) — sharp, tactical, and demands precise defence." },
    { eco: "C44", name: "Ponziani Opening", uci: ["e2e4","e7e5","g1f3","b8c6","c2c3"], side: "white",
      idea: "Prepare d4 with c3 — an offbeat try to grab the centre and dodge mainstream theory." },
    { eco: "C44", name: "Scotch Gambit", uci: ["e2e4","e7e5","g1f3","b8c6","d2d4","e5d4","f1c4"], side: "white",
      idea: "Offer the d4-pawn for fast development and pressure on f7 — open lines, quick initiative." },
    { eco: "C21", name: "Danish Gambit", uci: ["e2e4","e7e5","d2d4","e5d4","c2c3"], side: "white",
      idea: "Sacrifice pawns to unleash both bishops on the long diagonals and hunt the king." },
    { eco: "C21", name: "Center Game", uci: ["e2e4","e7e5","d2d4"], side: "white",
      idea: "Open the centre immediately; after Qxd4 the queen eyes the kingside for an early attack." },
    { eco: "C40", name: "Latvian Gambit", uci: ["e2e4","e7e5","g1f3","f7f5"], side: "black",
      idea: "A wild, dubious counter-gambit: …f5 to blow open lines and gamble on an attack." },
    { eco: "C40", name: "Elephant Gambit", uci: ["e2e4","e7e5","g1f3","d7d5"], side: "black",
      idea: "Strike …d5 at once for surprise value and open play — offbeat and double-edged." },

    // ---- Sicilian systems ----
    { eco: "B80", name: "Sicilian — Scheveningen", uci: ["e2e4","c7c5","g1f3","d7d6","d2d4","c5d4","f3d4","g8f6","b1c3","e7e6"], side: "black",
      idea: "The flexible …e6/…d6 'small centre'; absorb White's attack and counter on the queenside." },
    { eco: "B56", name: "Sicilian — Classical", uci: ["e2e4","c7c5","g1f3","d7d6","d2d4","c5d4","f3d4","g8f6","b1c3","b8c6"], side: "black",
      idea: "Natural development with …Nc6/…Nf6; fight for d5 and generate queenside play." },
    { eco: "B60", name: "Sicilian — Richter-Rauzer", uci: ["e2e4","c7c5","g1f3","d7d6","d2d4","c5d4","f3d4","g8f6","b1c3","b8c6","c1g5"], side: "white",
      idea: "Bg5 pins and prepares long castling and a kingside pawn storm against the Classical setup." },
    { eco: "B47", name: "Sicilian — Taimanov", uci: ["e2e4","c7c5","g1f3","e7e6","d2d4","c5d4","f3d4","b8c6"], side: "black",
      idea: "Flexible …e6/…Nc6 development; keep options open and pressure d4/e4 before committing the king." },
    { eco: "B42", name: "Sicilian — Kan", uci: ["e2e4","c7c5","g1f3","e7e6","d2d4","c5d4","f3d4","a7a6"], side: "black",
      idea: "…a6 first for a hyper-flexible setup; delay development and strike with …b5/…d5 later." },
    { eco: "B27", name: "Sicilian — Hyperaccelerated Dragon", uci: ["e2e4","c7c5","g1f3","g7g6"], side: "black",
      idea: "Fianchetto immediately and aim for a fast …d5, saving a tempo over the normal Dragon." },
    { eco: "B23", name: "Sicilian — Grand Prix Attack", uci: ["e2e4","c7c5","b1c3","b8c6","f2f4"], side: "white",
      idea: "Play f4 and Bb5/Bc4 for a direct kingside attack — an aggressive anti-Sicilian." },

    // ---- French deep lines ----
    { eco: "C03", name: "French — Tarrasch", uci: ["e2e4","e7e6","d2d4","d7d5","b1d2"], side: "white",
      idea: "Nd2 keeps the pawns healthy and sidesteps the Winawer pin; play for a small, safe edge." },
    { eco: "C11", name: "French — Classical", uci: ["e2e4","e7e6","d2d4","d7d5","b1c3","g8f6"], side: "black",
      idea: "Develop …Nf6 and challenge e4; head for rich middlegames after e5 or Bg5 lines." },
    { eco: "C10", name: "French — Rubinstein", uci: ["e2e4","e7e6","d2d4","d7d5","b1c3","d5e4"], side: "black",
      idea: "Give up the centre for a solid, low-risk structure and easy piece development." },
    { eco: "C01", name: "French — Exchange", uci: ["e2e4","e7e6","d2d4","d7d5","e4d5","e6d5"], side: "both",
      idea: "Symmetrical and drawish on the surface — outplay the opponent in a balanced middlegame." },

    // ---- Caro-Kann deep lines ----
    { eco: "B18", name: "Caro-Kann — Classical", uci: ["e2e4","c7c6","d2d4","d7d5","b1c3","d5e4","c3e4","c8f5"], side: "black",
      idea: "Develop the light-squared bishop OUTSIDE the pawn chain to f5 — the Caro's whole point." },
    { eco: "B13", name: "Caro-Kann — Panov Attack", uci: ["e2e4","c7c6","d2d4","d7d5","e4d5","c6d5","c2c4"], side: "white",
      idea: "Take on d5 and hit with c4 for an IQP-style initiative and active piece play." },
    { eco: "B11", name: "Caro-Kann — Two Knights", uci: ["e2e4","c7c6","b1c3","d7d5","g1f3"], side: "white",
      idea: "Rapid development against the Caro; keep it fluid and avoid heavy theory." },

    // ---- 1.d4 d5 deep lines ----
    { eco: "D43", name: "Semi-Slav Defense", uci: ["d2d4","d7d5","c2c4","c7c6","g1f3","g8f6","b1c3","e7e6"], side: "black",
      idea: "Combine …c6 and …e6 for a super-solid centre, then break with …c5 or …e5 — deep, dynamic theory." },
    { eco: "D32", name: "QGD — Tarrasch Defense", uci: ["d2d4","d7d5","c2c4","e7e6","b1c3","c7c5"], side: "black",
      idea: "Accept an isolated d-pawn for free piece play and open lines — active but committal." },
    { eco: "D07", name: "Queen's Gambit — Chigorin", uci: ["d2d4","d7d5","c2c4","b8c6"], side: "black",
      idea: "Piece pressure over pawn structure: …Nc6 hits d4 and invites a lively, unbalanced fight." },
    { eco: "D08", name: "Albin Countergambit", uci: ["d2d4","d7d5","c2c4","e7e5"], side: "black",
      idea: "Counter-strike …e5; the advanced d4-pawn becomes a thorn and a base for tactics." },

    // ---- Indian defenses deep lines ----
    { eco: "E90", name: "King's Indian — Classical", uci: ["d2d4","g8f6","c2c4","g7g6","b1c3","f8g7","e2e4","d7d6"], side: "black",
      idea: "Let White build the big centre, then detonate it with …e5 and a kingside pawn storm." },
    { eco: "E62", name: "King's Indian — Fianchetto", uci: ["d2d4","g8f6","c2c4","g7g6","g1f3","f8g7","g2g3"], side: "white",
      idea: "Meet the KID with a calm double fianchetto — solid, positional, and hard to attack." },
    { eco: "D85", name: "Grünfeld — Exchange", uci: ["d2d4","g8f6","c2c4","g7g6","b1c3","d7d5","c4d5","f6d5","e2e4"], side: "white",
      idea: "Build a huge pawn centre and try to make it a battering ram before Black chips at it." },
    { eco: "A57", name: "Benko Gambit", uci: ["d2d4","g8f6","c2c4","c7c5","d4d5","b7b5"], side: "black",
      idea: "Sacrifice a wing pawn for lasting queenside pressure down the a- and b-files." },
    { eco: "A61", name: "Benoni — Modern", uci: ["d2d4","g8f6","c2c4","c7c5","d4d5","e7e6"], side: "black",
      idea: "Accept a space deficit for a queenside majority and dynamic …b5/…f5 breaks." },
    { eco: "A53", name: "Old Indian Defense", uci: ["d2d4","g8f6","c2c4","d7d6"], side: "black",
      idea: "A solid …d6/…e5 setup (a Philidor cousin) — compact and flexible, if a touch passive." },
    { eco: "A51", name: "Budapest Gambit", uci: ["d2d4","g8f6","c2c4","e7e5"], side: "black",
      idea: "Gambit the e5-pawn for quick development and annoying pressure on White's centre." },

    // ---- 1.d4 / flank systems ----
    { eco: "A45", name: "Trompowsky Attack", uci: ["d2d4","g8f6","c1g5"], side: "white",
      idea: "Pin the knight early to damage Black's structure or grab the bishop pair — dodge main theory." },
    { eco: "A46", name: "Torre Attack", uci: ["d2d4","g8f6","g1f3","e7e6","c1g5"], side: "white",
      idea: "A simple, reliable Bg5 system: develop, castle, and press on the kingside." },
    { eco: "D05", name: "Colle System", uci: ["d2d4","d7d5","g1f3","g8f6","e2e3"], side: "white",
      idea: "A tidy setup aiming for the e3–e4 break and a kingside attack — easy to learn, hard to crack." },
    { eco: "A28", name: "English — Four Knights", uci: ["c2c4","e7e5","b1c3","g8f6","g1f3","b8c6"], side: "both",
      idea: "A reversed Sicilian a tempo up; fight for d5 and manoeuvre for the small edges." },
    { eco: "A07", name: "King's Indian Attack", uci: ["g1f3","d7d5","g2g3"], side: "white",
      idea: "A universal white setup: fianchetto, e4, and a slow but dangerous kingside build-up." },

    // ---- 1.e4 minor / other defences ----
    { eco: "B09", name: "Pirc — Austrian Attack", uci: ["e2e4","d7d6","d2d4","g8f6","b1c3","g7g6","f2f4"], side: "white",
      idea: "Grab maximum centre with f4 and roll the pawns forward for a direct kingside attack." },
    { eco: "B03", name: "Alekhine — Four Pawns Attack", uci: ["e2e4","g8f6","e4e5","f6d5","d2d4","d7d6","c2c4","d5b6","f2f4"], side: "white",
      idea: "Chase the knight and build a giant pawn centre — over-extend it and it can crash down." },
    { eco: "B01", name: "Scandinavian — Modern (…Nf6)", uci: ["e2e4","d7d5","e4d5","g8f6"], side: "black",
      idea: "Regain d5 with the knight instead of the queen; quick, harmonious development." },
    { eco: "B01", name: "Scandinavian — Main (…Qxd5)", uci: ["e2e4","d7d5","e4d5","d8d5"], side: "black",
      idea: "Recapture with the queen, retreat it safely, and set up a solid Caro-like structure." },
    { eco: "B00", name: "Nimzowitsch Defense", uci: ["e2e4","b8c6"], side: "black",
      idea: "Provoke and undermine White's centre with piece pressure — hypermodern and offbeat." },
  ];

  function isPrefix(line, hist) {
    if (line.length > hist.length) return false;
    for (let i = 0; i < line.length; i++) if (line[i] !== hist[i]) return false;
    return true;
  }

  // ---- Taxonomy: one categorization shared by the in-game HUD and the library ----
  // The engine (core/assist) detects position-aware PLANS by id; here we give each id
  // a phase + human category + label so both surfaces can group and name them the
  // same way. Phases: opening · middlegame · endgame. Categories are the plain-English
  // buckets a player thinks in.
  const THEMES = {
    // Development & the centre (opening / early middlegame)
    develop:      { phase: "opening",    cat: "Development", label: "Develop your pieces" },
    center:       { phase: "opening",    cat: "Development", label: "Take the centre" },
    fianchetto:   { phase: "opening",    cat: "Development", label: "Fianchetto plan" },
    pawn_break:   { phase: "opening",    cat: "Development", label: "Pawn break" },
    // Attack the king
    attack_king:  { phase: "middlegame", cat: "Attack",      label: "Attack the king" },
    pawn_storm:   { phase: "middlegame", cat: "Attack",      label: "Pawn storm" },
    // Positional / structure play
    iso_attack:   { phase: "middlegame", cat: "Positional",  label: "Hit the isolated pawn" },
    open_file:    { phase: "middlegame", cat: "Positional",  label: "Seize the open file" },
    rook_seventh: { phase: "middlegame", cat: "Positional",  label: "Rook to the 7th" },
    outpost:      { phase: "middlegame", cat: "Positional",  label: "Plant an outpost" },
    improve:      { phase: "middlegame", cat: "Positional",  label: "Improve your worst piece" },
    // Material & simplification
    win_material: { phase: "any",        cat: "Material",    label: "Win material" },
    save_piece:   { phase: "any",        cat: "Material",    label: "Save a piece" },
    simplify:     { phase: "any",        cat: "Material",    label: "Simplify (you're ahead)" },
    // Endgame technique
    passer:       { phase: "endgame",    cat: "Endgame",     label: "Push the passed pawn" },
  };
  const CATS = ["Development", "Attack", "Positional", "Material", "Endgame"];

  // Which broad ECO family an opening belongs to (for grouping in the library and
  // for a one-word "family" tag in-game). Derived from the ECO code so we never
  // duplicate the mapping per entry.
  function familyOf(eco) {
    if (!eco) return "Other";
    const L = eco[0], n = parseInt(eco.slice(1), 10) || 0;
    if (L === "A") {
      if (n >= 80) return "Dutch";
      return "Flank & English";
    }
    if (L === "B") {
      if (n >= 20) return "Sicilian";
      return "e4 — Caro/Pirc/Modern";
    }
    if (L === "C") {
      if (n <= 19) return "French";
      return "Open Games (1.e4 e5)";
    }
    if (L === "D") return "Queen's Pawn & Gambit";
    if (L === "E") return "Indian Defenses";
    return "Other";
  }

  window.GBStrategies = {
    openings: OPENINGS,
    themes: THEMES,
    categories: CATS,
    themeMeta(id) { return THEMES[id] || { phase: "any", cat: "Plan", label: id }; },
    familyOf,
    // Openings grouped by family (for the library page), families in a stable order.
    byFamily() {
      const order = ["Open Games (1.e4 e5)", "Sicilian", "French", "e4 — Caro/Pirc/Modern",
        "Queen's Pawn & Gambit", "Indian Defenses", "Dutch", "Flank & English", "Other"];
      const groups = {};
      for (const o of OPENINGS) (groups[familyOf(o.eco)] || (groups[familyOf(o.eco)] = [])).push(o);
      return order.filter((f) => groups[f]).map((f) => ({ family: f, openings: groups[f] }));
    },
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
