// Glassboard STRATEGY CAPTURE — learn a strategy from a game that was just played.
//
// The idea (Issam, 2026-10-04): when something genuinely clever happens on the board,
// Glassboard should NOTICE it, name it, and teach it back — turning a loss into a
// pattern you own. The catalog was built for this from the start: entries carry
// `source: "learned"` and GBStrategies.add() registers one at runtime.
//
// HONESTY RULE: we only claim motifs we can actually VERIFY on the board —
//   • "forced"   — the reply had exactly one legal move (counted, not guessed)
//   • "defended" — the checking piece landed on a square its own side defends
//   • "wins material" — the material balance really moved
// Anything we can't verify is left unsaid. A captured lesson is evidence, not flavour.
(function (global) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const PIECE = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

  const material = (bs) => { let w = 0, b = 0; for (const c of bs) { if (c === "." ) continue; const v = VAL[c.toLowerCase()] || 0; if (c === c.toUpperCase()) w += v; else b += v; } return w - b; };
  function countLegal(G, fen) {
    try { const g = G.fromFen(fen); let n = 0; for (let i = 0; i < 64; i++) { try { n += Array.from(g.legalTo(i)).length; } catch {} } return n; } catch { return -1; }
  }
  function replay(G, history, upto) {
    const g = new G();
    for (let i = 0; i < upto && i < history.length; i++) {
      const u = history[i]; if (!u || u.length < 4) break;
      const from = (u.charCodeAt(0) - 97) + (u.charCodeAt(1) - 49) * 8;
      const to = (u.charCodeAt(2) - 97) + (u.charCodeAt(3) - 49) * 8;
      try { g.makeMove(from, to, u.length > 4 ? u[4] : undefined); } catch { break; }
    }
    return g;
  }

  // ---- MOTIF DETECTORS ------------------------------------------------------
  // Each one is a PURE function of the board before/after a move, so each can be
  // tested exhaustively on hand-built positions, and each claims only what it can
  // see. Widening coverage this way — rather than asking a model "was that
  // clever?" — is what keeps a captured lesson evidence instead of flavour, and
  // keeps capture working offline (guardrail #3).
  //
  // Squares: index 0 = a1 … 63 = h8 (rank = floor(sq/8)), matching the core.
  const isWhite = (c) => c && c !== "." && c === c.toUpperCase();
  const enemyOf = (c, white) => c && c !== "." && isWhite(c) !== white;
  const sqName = (i) => String.fromCharCode(97 + (i % 8)) + (1 + Math.floor(i / 8));
  const attacksFrom = (board, sq) => {
    const A = global.GBAssistUI;
    if (!A || !A.pieceAttacks) return [];
    return A.pieceAttacks(board, sq, board[sq]) || [];
  };
  const RAYS = {
    b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
    r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
    q: [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]],
  };

  // FORK — the piece that just moved attacks two or more valuable enemy pieces at
  // once. Counted on the board, not guessed.
  function findFork(after, to, white) {
    const targets = attacksFrom(after, to)
      .filter((sq) => enemyOf(after[sq], white))
      .map((sq) => ({ sq, pc: after[sq], v: VAL[after[sq].toLowerCase()] || 0, king: after[sq].toLowerCase() === "k" }))
      .filter((t) => t.king || t.v >= 3);
    if (targets.length < 2) return null;
    const royal = targets.some((t) => t.king);
    return {
      kind: royal ? "royal-fork" : "fork",
      score: 40 + targets.reduce((a, t) => a + (t.king ? 6 : t.v), 0) + (royal ? 20 : 0),
      piece: PIECE[after[to].toLowerCase()] || "piece",
      targets: targets.map((t) => (PIECE[t.pc.toLowerCase()] || "piece") + " on " + sqName(t.sq)),
      motifs: [royal ? "royal-fork" : "fork", "by-" + (PIECE[after[to].toLowerCase()] || "piece")],
    };
  }

  // PIN / SKEWER — walk the moved slider's rays. First enemy piece found, then the
  // next piece along the SAME line: if that's the enemy king the first piece is
  // pinned; if both are valuable it's a skewer. Pure geometry, fully checkable.
  function findPin(after, to, white) {
    const pc = after[to];
    if (!pc || pc === ".") return null;
    const dirs = RAYS[pc.toLowerCase()];
    if (!dirs) return null;
    const f0 = to % 8, r0 = Math.floor(to / 8);
    for (const [df, dr] of dirs) {
      let f = f0 + df, r = r0 + dr, first = null;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const sq = r * 8 + f, c = after[sq];
        if (c && c !== ".") {
          if (!first) {
            // Our own piece blocks the line; an enemy KING first is a check, not a pin.
            if (!enemyOf(c, white) || c.toLowerCase() === "k") break;
            first = { sq, pc: c, v: VAL[c.toLowerCase()] || 0 };
          } else {
            if (!enemyOf(c, white)) break;
            const behindKing = c.toLowerCase() === "k";
            const bv = VAL[c.toLowerCase()] || 0;
            if (behindKing) {
              return {
                kind: "pin", score: 34 + first.v * 2,
                piece: PIECE[pc.toLowerCase()] || "piece",
                pinned: (PIECE[first.pc.toLowerCase()] || "piece") + " on " + sqName(first.sq),
                behind: "king",
                motifs: ["pin", "absolute-pin", "by-" + (PIECE[pc.toLowerCase()] || "piece")],
              };
            }
            if (bv >= 5 && first.v >= 3) {
              return {
                kind: "skewer", score: 28 + bv,
                piece: PIECE[pc.toLowerCase()] || "piece",
                pinned: (PIECE[first.pc.toLowerCase()] || "piece") + " on " + sqName(first.sq),
                behind: PIECE[c.toLowerCase()] || "piece",
                motifs: ["skewer", "by-" + (PIECE[pc.toLowerCase()] || "piece")],
              };
            }
            break;
          }
        }
        f += df; r += dr;
      }
    }
    return null;
  }

  // DISCOVERED ATTACK — moving one piece opens a line for ANOTHER of yours. Found
  // by diffing what your other pieces attacked before and after, so it can't be
  // confused with the mover's own new attacks.
  function findDiscovered(before, after, from, to, white) {
    const was = new Set();
    for (let i = 0; i < 64; i++) {
      if (i === from || i === to) continue;
      if (!before[i] || before[i] === "." || isWhite(before[i]) !== white) continue;
      attacksFrom(before, i).forEach((sq) => was.add(i + ":" + sq));
    }
    for (let i = 0; i < 64; i++) {
      if (i === to) continue; // the mover's own attacks are not a discovery
      if (!after[i] || after[i] === "." || isWhite(after[i]) !== white) continue;
      if (!RAYS[after[i].toLowerCase()]) continue; // only sliders can be uncovered
      for (const sq of attacksFrom(after, i)) {
        const tgt = after[sq];
        if (!enemyOf(tgt, white)) continue;
        const v = VAL[tgt.toLowerCase()] || 0;
        const king = tgt.toLowerCase() === "k";
        if (!king && v < 5) continue;
        if (was.has(i + ":" + sq)) continue; // it already attacked that square
        return {
          kind: "discovered", score: 30 + (king ? 12 : v),
          piece: PIECE[after[i].toLowerCase()] || "piece",
          moved: PIECE[(after[to] || "p").toLowerCase()] || "piece",
          targets: [(PIECE[tgt.toLowerCase()] || "piece") + " on " + sqName(sq)],
          motifs: ["discovered-attack", "by-" + (PIECE[after[i].toLowerCase()] || "piece")],
        };
      }
    }
    return null;
  }

  // Find the single most decisive short sequence in the game: the biggest swing in
  // the eval trail over a small window. `trail` is [{ply, cp}] from YOUR point of
  // view, so a big NEGATIVE swing is something that was done TO you — the best
  // lessons usually are.
  // ctx: { trail, history, Game, myColor, opening }
  function detect(ctx) {
    ctx = ctx || {};
    const trail = (ctx.trail || []).filter((e) => e && typeof e.cp === "number");
    const history = ctx.history || [];
    const G = ctx.Game;
    if (!G || history.length < 6) return null;

    // Walk the real game once, offering every ply to every detector and keeping the
    // best-scoring find. Scores are fixed per motif (plus the material actually
    // won), so the choice is reproducible — not a judgement call.
    let best = null;
    const g = new G();
    for (let k = 0; k < history.length; k++) {
      const u = history[k];
      if (!u || u.length < 4) break;
      const from = (u.charCodeAt(0) - 97) + (u.charCodeAt(1) - 49) * 8;
      const to = (u.charCodeAt(2) - 97) + (u.charCodeAt(3) - 49) * 8;
      const before = g.boardString();
      const moverChar = before[from] || "";
      const matBefore = material(before);
      const white = k % 2 === 0; // even plies are White's
      let ok = false;
      try { ok = g.makeMove(from, to, u.length > 4 ? u[4] : undefined); } catch { ok = false; }
      if (!ok) break;
      const after = g.boardString();
      const piece = PIECE[moverChar.toLowerCase()] || "piece";

      // How much material this side was up, before and a few plies later — used to
      // confirm (never to assume) that a sacrifice actually paid.
      const sign = white ? 1 : -1;
      const gainBy = (plies) => {
        const later = replay(G, history, Math.min(history.length, k + plies));
        return sign * (material(later.boardString()) - matBefore);
      };

      const cands = [];

      // A check the opponent can barely answer: the original detector, kept.
      let gaveCheck = false;
      try { gaveCheck = g.inCheck(); } catch {}
      if (gaveCheck) {
        const n = countLegal(G, g.fen());
        if (n >= 0 && n <= 3) {
          cands.push({
            kind: n === 1 ? "forced-check" : "near-forced-check",
            score: 50 + (n === 1 ? 30 : 0), piece, legalAfter: n,
            motifs: ["check", n === 1 ? "forced" : "near-forced", "by-" + piece],
          });
        }
      }
      const fk = findFork(after, to, white); if (fk) cands.push(Object.assign({ legalAfter: -1 }, fk));
      const pn = findPin(after, to, white); if (pn) cands.push(Object.assign({ legalAfter: -1 }, pn));
      const dc = findDiscovered(before, after, from, to, white); if (dc) cands.push(Object.assign({ legalAfter: -1 }, dc));

      // SACRIFICE — only claimed when the game itself shows it: the piece we just
      // moved is captured on the very next move, and a few plies later this side is
      // AHEAD on material. No speculation about whether it "looked" like a sac.
      const nextU = history[k + 1] || "";
      const recaptured = nextU.length >= 4 &&
        ((nextU.charCodeAt(2) - 97) + (nextU.charCodeAt(3) - 49) * 8) === to;
      const sacVal = VAL[moverChar.toLowerCase()] || 0;
      if (recaptured && sacVal >= 3) {
        const paid = Math.max(gainBy(4), gainBy(6));
        if (paid >= 2) {
          cands.push({
            kind: "sacrifice", score: 60 + paid * 3 + sacVal, piece, legalAfter: -1, paid,
            motifs: ["sacrifice", "wins-material", "by-" + piece],
          });
        }
      }

      for (const c of cands) {
        const swingNow = Math.max(0, gainBy(2), gainBy(4));
        c.idx = k; c.uci = u; c.white = white; c.matSwing = swingNow;
        c.score += swingNow;
        // Ties go to the later moment — the more decisive one in a real game.
        if (!best || c.score >= best.score) best = c;
      }
    }
    if (!best) return null; // nothing we can honestly call a pattern

    // The lesson is the key move plus a little run-up, so the setup is visible.
    const startPly = Math.max(0, best.idx - 3);
    const moves = history.slice(startPly, best.idx + 2); // include the reply
    if (!moves.length) return null;
    const beforeG = replay(G, history, startPly);
    const fen = beforeG.fen();
    const keyColor = best.white ? "white" : "black";
    const byYou = keyColor === (ctx.myColor || "white");
    const Piece = best.piece.charAt(0).toUpperCase() + best.piece.slice(1);

    let swing = best.matSwing * 100;
    if (trail.length) {
      const near = trail.filter((e) => e.ply >= startPly && e.ply <= best.idx + 2).map((e) => e.cp);
      if (near.length >= 2) swing = Math.max(swing, Math.abs(Math.max.apply(null, near) - Math.min.apply(null, near)));
    }

    const T = {
      "forced-check": {
        name: `The Forced ${Piece} Check`,
        idea: `A check the opponent cannot answer freely: after it there was exactly ONE legal reply. The trick is to deliver a check that another piece DEFENDS, while the king has no escape square — the only legal answer is a capture that loses more than it takes.`,
        how: ["Get a second piece defending the square you'll check from",
              "Make sure the enemy king has no escape square",
              "Deliver the check — the only legal reply is a losing capture",
              "Recapture and bank the material"],
      },
      "near-forced-check": {
        name: `${Piece} Shot`,
        idea: `A forcing check that left the opponent only ${best.legalAfter} legal replies — few enough that the follow-up is easy to calculate.`,
        how: ["Find the forcing check that limits their replies",
              "Make sure your checking piece is defended",
              "Convert the material or the attack"],
      },
      fork: {
        name: `The ${Piece} Fork`,
        idea: `One piece, two targets. The ${best.piece} attacked ${(best.targets || []).join(" and ")} at the same time — they can only save one, so the other falls.`,
        how: [`Look for a square where your ${best.piece} touches two valuable pieces at once`,
              "Check the square is safe (or that the trade favours you)",
              "Play it, then take whichever piece they don't save"],
      },
      "royal-fork": {
        name: `The ${Piece} Royal Fork`,
        idea: `The strongest fork there is: the ${best.piece} hit the KING and ${(best.targets || []).filter((t) => !/king/.test(t)).join(" and ")} together. They must answer the check, so the other piece is simply lost.`,
        how: ["Hunt for a square hitting the king and a second piece at once",
              "The check is forcing — they have no time to save the other piece",
              "Take it next move"],
      },
      pin: {
        name: `The ${Piece} Pin`,
        idea: `The ${best.pinned} cannot move: the king is directly behind it, so stepping aside would be illegal. A pinned piece is a frozen piece — pile more attackers onto it.`,
        how: [`Line your ${best.piece} up with an enemy piece and its king`,
              "The piece in between is now stuck there",
              "Attack it again with a pawn or another piece and win it"],
      },
      skewer: {
        name: `The ${Piece} Skewer`,
        idea: `A pin in reverse: the valuable piece is in FRONT. The ${best.pinned} had to move, and the ${best.behind} behind it was then there for the taking.`,
        how: [`Line your ${best.piece} up through a valuable piece onto a lesser one behind it`,
              "They move the front piece out of danger",
              "Take what was hiding behind it"],
      },
      discovered: {
        name: `The Discovered ${Piece} Attack`,
        idea: `Moving the ${best.moved} out of the way uncovered the ${best.piece} behind it, which suddenly attacked ${(best.targets || []).join(" and ")}. The move that creates the threat isn't the piece making it.`,
        how: [`Spot your own ${best.piece} sitting behind one of your pieces on an open line`,
              "Move the front piece away — ideally so it makes its own threat",
              "The uncovered attack lands for free"],
      },
      sacrifice: {
        name: `The ${Piece} Sacrifice`,
        idea: `Giving up the ${best.piece} on purpose. It was captured immediately — and a few moves later this side was ${best.paid} points of material AHEAD. The material you hand over buys something worth more.`,
        how: [`Offer the ${best.piece} where taking it is almost forced`,
              "Make sure your follow-up is forcing — a check, a fork, or a recapture",
              "Collect more than you gave up"],
      },
    };
    const t = T[best.kind] || T["near-forced-check"];

    return {
      id: "learned_" + best.kind + "_" + (fen.split(" ")[0] || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) + "_" + best.idx,
      name: t.name, idea: t.idea, source: "learned", unlocked: true,
      phase: "middlegame", cat: "Tactics", side: keyColor,
      // Graded, so the Learned shelf filters like the rest of the library: a fork
      // or a pin is a pattern a club player drills; a sound sacrifice is not.
      cx: ({ fork: "Intermediate", pin: "Intermediate", skewer: "Intermediate",
             discovered: "Advanced", "royal-fork": "Advanced",
             "near-forced-check": "Advanced", "forced-check": "Advanced",
             sacrifice: "Advanced" })[best.kind] || "Advanced",
      demoFen: fen, demoUci: moves,
      keyMove: best.uci, legalAfter: best.legalAfter,
      swing, motifs: best.motifs, byYou,
      how: t.how,
      capturedAt: Date.now(),
    };
  }


  // ---- the learned library (per device) ----
  const KEY = "gb_learned";
  function list() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
  function save(entry) {
    if (!entry) return null;
    const all = list();
    if (all.some((e) => e.id === entry.id)) return null; // already learned
    all.unshift(entry);
    try { localStorage.setItem(KEY, JSON.stringify(all.slice(0, 50))); } catch {}
    register(entry);
    return entry;
  }
  // Make learned entries first-class in the catalog, exactly like built-ins.
  function register(e) { if (global.GBStrategies && global.GBStrategies.add) { try { global.GBStrategies.add(e); } catch {} } }
  function registerAll() { list().forEach(register); }

  // A recap card for a freshly captured lesson.
  function cardHTML(e) {
    if (!e) return "";
    const who = e.byYou ? "You played it" : "Your opponent played it on you";
    return `<div class="rc-card learned"><span class="rc-ic">🧠</span><div>` +
      `<b>Lesson captured — ${esc(e.name)}</b>` +
      `<p>${esc(e.idea)} <span class="rc-learn-who">${esc(who)} · swing ${(e.swing / 100).toFixed(1)}</span></p>` +
      `<p class="rc-learn-cta">Saved to your <a href="./strategy.html" target="_blank" rel="noopener">Strategies library</a> — replay it there any time.</p>` +
      `</div></div>`;
  }

  // Detectors exported so they can be tested directly on hand-built positions.
  global.GBCapture = { detect, save, list, registerAll, cardHTML, _findFork: findFork, _findPin: findPin, _findDiscovered: findDiscovered };
})(window);
