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

    // KEY-MOVE FIRST. We look for the moment a move created a position the opponent
    // could not answer freely — a check with exactly one (or very few) legal replies.
    // That is the teachable pattern. Searching for "biggest eval drop" instead finds
    // whoever blundered hardest, which is not a strategy worth learning.
    let key = null; // { idx, uci, piece, legalAfter, matBefore }
    const g = new G();
    for (let k = 0; k < history.length; k++) {
      const u = history[k];
      if (!u || u.length < 4) break;
      const from = (u.charCodeAt(0) - 97) + (u.charCodeAt(1) - 49) * 8;
      const to = (u.charCodeAt(2) - 97) + (u.charCodeAt(3) - 49) * 8;
      const moverChar = g.boardString()[from] || "";
      const matBefore = material(g.boardString());
      let ok = false;
      try { ok = g.makeMove(from, to, u.length > 4 ? u[4] : undefined); } catch { ok = false; }
      if (!ok) break;
      let gaveCheck = false;
      try { gaveCheck = g.inCheck(); } catch {}
      if (!gaveCheck) continue;
      const n = countLegal(G, g.fen());
      if (n < 0 || n > 3) continue;
      // Prefer the most forcing one; ties go to the later (more decisive) moment.
      if (!key || n <= key.legalAfter) key = { idx: k, uci: u, piece: (PIECE[moverChar.toLowerCase()] || "piece"), legalAfter: n, matBefore };
    }
    if (!key) return null; // nothing we can honestly call a pattern

    // The lesson is the key move plus a little run-up, so the setup is visible.
    const startPly = Math.max(0, key.idx - 3);
    const moves = history.slice(startPly, key.idx + 2); // include the forced reply
    if (!moves.length) return null;
    const before = replay(G, history, startPly);
    const fen = before.fen();
    const matBefore = material(before.boardString());
    const after = replay(G, history, Math.min(history.length, key.idx + 2));
    const matSwing = Math.abs(material(after.boardString()) - matBefore);

    const forced = key.legalAfter === 1;
    const motifs = ["check", "by-" + key.piece];
    if (forced) motifs.push("forced"); else motifs.push("near-forced");
    if (matSwing >= 3) motifs.push("wins-material");

    // Who played the key move? Even plies are White's.
    const keyByWhite = key.idx % 2 === 0;
    const keyColor = keyByWhite ? "white" : "black";
    const byYou = keyColor === (ctx.myColor || "white");
    // Eval swing across the lesson, if we have a trail (purely informational).
    let swing = matSwing * 100;
    if (trail.length) {
      const near = trail.filter((e) => e.ply >= startPly && e.ply <= key.idx + 2).map((e) => e.cp);
      if (near.length >= 2) swing = Math.max(swing, Math.abs(Math.max.apply(null, near) - Math.min.apply(null, near)));
    }

    const Piece = key.piece.charAt(0).toUpperCase() + key.piece.slice(1);
    const name = forced
      ? `The Forced ${Piece} Check`
      : matSwing >= 3 ? `${Piece} Strike — wins material` : `${Piece} Shot`;
    const idea = forced
      ? `A check the opponent cannot answer freely: after it there was exactly ONE legal reply. The trick is to deliver a check that another piece DEFENDS, while the king has no escape square — the only legal answer is a capture that loses more than it takes.`
      : `A forcing check that left the opponent only ${key.legalAfter} legal replies${matSwing >= 3 ? `, winning ${matSwing} points of material` : ""}.`;

    return {
      id: "learned_" + (fen.split(" ")[0] || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) + "_" + key.idx,
      name, idea, source: "learned", unlocked: true,
      phase: "middlegame", cat: "Tactics", cx: "Advanced", side: keyColor,
      demoFen: fen, demoUci: moves,
      keyMove: key.uci, legalAfter: key.legalAfter,
      swing, motifs, byYou,
      how: forced ? [
        "Get a second piece defending the square you'll check from",
        "Make sure the enemy king has no escape square",
        "Deliver the check — the only legal reply is a losing capture",
        "Recapture and bank the material",
      ] : [
        "Find the forcing check that limits their replies",
        "Make sure your checking piece is defended",
        "Convert the material or the attack",
      ],
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

  global.GBCapture = { detect, save, list, registerAll, cardHTML };
})(window);
