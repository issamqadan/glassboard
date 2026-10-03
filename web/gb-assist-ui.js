// Glassboard SHARED assistance surface — one implementation used by BOTH
// Play-AI (main.js) and human games (multiplayer.js).
//
// WHY THIS FILE EXISTS: the two game pages were separate implementations, so every
// assistance feature we built landed in Play-AI only and the human game silently
// fell behind. The vision requires identical behaviour everywhere (a fairness
// requirement), so anything about the PLAYER's assistance experience lives here and
// is called from both. Page-specific extras (AI styles, lifelines) stay in the page.
//
// Everything here is PURE: callers pass an explicit context object, so the module
// never reaches for a page's globals.
(function (global) {
  const PVAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const PIECE_WORD = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
  // Engine plan-id → the noun used in "Continue your <verb>". Shared so the phrasing
  // is identical in both games.
  const STRAT_VERB = { attack_king: "attack", pawn_storm: "attack", win_material: "material win", save_piece: "defense",
    develop: "development", center: "central control", simplify: "simplification", passer: "passed pawn",
    iso_attack: "attack", minority_attack: "minority attack", iqp_attack: "IQP play", open_file: "file pressure",
    fianchetto: "fianchetto plan", outpost: "outpost plan", rook_seventh: "rook lift", improve: "piece play",
    pawn_break: "pawn break" };
  const verbFor = (id) => STRAT_VERB[id] || "plan";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Squares a piece on `sq` attacks/guards on a 64-char board string (a1=0 … h8=63),
  // with ray blockers — used to explain a move in plain terms ("protects / attacks").
  function pieceAttacks(board, sq, pc) {
    if (!pc || pc === ".") return [];
    const f = sq % 8, r = Math.floor(sq / 8), out = [];
    const k = pc.toLowerCase(), white = pc === pc.toUpperCase();
    const on = (ff, rr) => ff >= 0 && ff < 8 && rr >= 0 && rr < 8;
    const add = (ff, rr) => { if (on(ff, rr)) out.push(rr * 8 + ff); };
    const ray = (df, dr) => { let ff = f + df, rr = r + dr; while (on(ff, rr)) { const s = rr * 8 + ff; out.push(s); if (board[s] && board[s] !== ".") break; ff += df; rr += dr; } };
    if (k === "p") { const dr = white ? 1 : -1; add(f - 1, r + dr); add(f + 1, r + dr); }
    else if (k === "n") { [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]].forEach(([a, b]) => add(f + a, r + b)); }
    else if (k === "k") { [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => add(f + a, r + b)); }
    else { if (k === "b" || k === "q") { ray(1, 1); ray(1, -1); ray(-1, 1); ray(-1, -1); } if (k === "r" || k === "q") { ray(1, 0); ray(-1, 0); ray(0, 1); ray(0, -1); } }
    return out;
  }

  // Plain-language "what does this move DO?" for a beginner — one short clause, in
  // priority order (mate → check → wins/saves material → protects → attacks → develops
  // → castles → centre). Computed from the real post-move board (clone + inCheck), so
  // it's honest. Returns "" when nothing notable stands out.
  //
  // ctx: { game, Game, myColor, threatSquares?, hanging?, freeCaptures? }
  function moveMeaning(ctx, m) {
    if (!ctx || !ctx.game || !m || m.from == null) return "";
    const game = ctx.game;
    const pre = game.boardString();
    const moverPre = pre[m.from] || "";
    const white = ctx.myColor === "white";
    const isEnemy = (c) => c && c !== "." && (white ? (c >= "a" && c <= "z") : (c >= "A" && c <= "Z"));
    const isMine = (c) => c && c !== "." && (white ? (c >= "A" && c <= "Z") : (c >= "a" && c <= "z"));
    const nameOf = (c) => (c ? PIECE_WORD[c.toLowerCase()] || "piece" : "piece");
    const capturedPre = pre[m.to];
    let post = null, gives = false, mate = false;
    try {
      const g = ctx.Game.fromFen(game.fen());
      const promo = m.uci && m.uci.length > 4 ? m.uci[4] : undefined;
      if (g.makeMove(m.from, m.to, promo)) { post = g.boardString(); gives = g.inCheck(); mate = g.status() === "checkmate"; }
    } catch { /* fall through to what we can say without the clone */ }
    if (mate) return "Checkmate — this wins the game! 🏆";
    const dangerSet = new Set([...(ctx.threatSquares || []), ...(ctx.hanging || [])]);
    const isCap = isEnemy(capturedPre);
    if (gives && isCap) return `Captures their ${nameOf(capturedPre)} — with check.`;
    if (isCap) {
      const gain = (PVAL[capturedPre.toLowerCase()] || 0) - (PVAL[(moverPre || "p").toLowerCase()] || 0);
      if (gain > 0 || (ctx.freeCaptures || []).includes(m.to)) return `Wins their ${nameOf(capturedPre)} — free material.`;
      if (gain === 0) return `Trades your ${nameOf(moverPre)} for their ${nameOf(capturedPre)}.`;
      return `Takes their ${nameOf(capturedPre)}.`;
    }
    if (gives) return "Puts the king in check — they must respond.";
    if (dangerSet.has(m.from)) return `Moves your ${nameOf(moverPre)} out of danger.`;
    if (post) {
      const moved = post[m.to];
      const atk = pieceAttacks(post, m.to, moved);
      for (const s of atk) { const c = post[s]; if (isMine(c) && dangerSet.has(s)) return `Defends your ${nameOf(c)} — now it's protected.`; }
      let best = 0, bestSq = -1;
      for (const s of atk) { const c = post[s]; if (isEnemy(c)) { const v = PVAL[c.toLowerCase()] || 0; if (v > best) { best = v; bestSq = s; } } }
      if (bestSq >= 0 && best >= 3) return `Attacks their ${nameOf(post[bestSq])}.`;
    }
    if ((moverPre === "K" || moverPre === "k") && Math.abs((m.to % 8) - (m.from % 8)) === 2) return "Castles — tucks your king safely away.";
    const homeRank = white ? 0 : 7;
    if ("NBnb".includes(moverPre) && Math.floor(m.from / 8) === homeRank) return `Develops your ${nameOf(moverPre)} into the game.`;
    if ((moverPre === "P" || moverPre === "p") && [27, 28, 35, 36].includes(m.to)) return "Grabs space in the centre.";
    return "";
  }

  // "Who's playing what" — the named opening (attributed to whichever side it
  // characterises) fused with the engine's live phase + top plan + opponent read.
  // Pure AWARENESS (a label, never a move answer), so it is never help-gated.
  //
  // ctx: { assistData, opening, myColor, oppColor }
  function identity(ctx) {
    ctx = ctx || {};
    const sr = ctx.assistData && ctx.assistData.strategy;
    const op = ctx.opening;
    const meta = global.GBStrategies;
    const you = {}, opp = {};
    if (op) {
      const fam = meta ? meta.familyOf(op.eco) : "";
      if (op.side === ctx.myColor || op.side === "both") { you.name = op.name; you.family = fam; you.idea = op.idea; you.book = true; }
      if (op.side === ctx.oppColor || op.side === "both") { opp.name = op.name; opp.family = fam; opp.idea = op.idea; }
    }
    if (sr && sr.strategies && sr.strategies.length) {
      const top = sr.strategies[0];
      const tm = meta ? meta.themeMeta(top.id) : { cat: "Plan" };
      if (!you.name) { you.name = top.name; you.cat = tm.cat; you.idea = top.idea; }
      else if (!you.book || (sr.phase && sr.phase !== "opening")) you.planHint = top.name; // named opening + a live plan underneath
    }
    if (sr && sr.opponent && !opp.name) opp.read = sr.opponent;
    return { you, opp, phase: sr ? sr.phase : null };
  }

  // The identity strip as HTML — names each side's opening/plan + a phase pill.
  // `extraBits` lets a page append its own chips (e.g. Play-AI's opponent style and
  // the symmetric "AI matching your help" badge) without forking this renderer.
  function identityRowHTML(ctx, extraBits) {
    const idn = identity(ctx);
    const bits = [];
    if (idn.you.name) bits.push(`<span class="gl-id you" title="${esc(idn.you.idea || "")}">📖 You · ${esc(idn.you.name)}${idn.you.planHint ? ` → ${esc(idn.you.planHint)}` : ""}</span>`);
    if (idn.opp.name) bits.push(`<span class="gl-id opp" title="${esc(idn.opp.idea || "")}">🎯 Opp · ${esc(idn.opp.name)}</span>`);
    else if (idn.opp.read) bits.push(`<span class="gl-id opp" title="${esc(idn.opp.read)}">🎯 ${esc(idn.opp.read)}</span>`);
    (extraBits || []).forEach((b) => { if (b) bits.push(b); });
    if (!bits.length && !idn.phase) return "";
    return `<div class="gl-identity">${idn.phase ? `<span class="gl-phase">${esc(idn.phase)}</span>` : ""}${bits.join("")}</div>`;
  }

  // ALWAYS-ON strategy strip — "what am I actually playing, and what are they?"
  //
  // This is pure AWARENESS: the opening is identified from the MOVE LIST alone, so it
  // needs no engine assistance and is shown at EVERY help level (including No help).
  // It answers "which strategy did I follow, knowingly or not — and my opponent?".
  // The engine's live plan (develop/attack/…) is richer help, so it only rides along
  // when the engine actually produced one.
  //
  // ctx: { opening, assistData?, myColor, oppColor }
  // Returns "" when there's nothing honest to say yet (stays quiet in the first moves).
  function stripHTML(ctx) {
    ctx = ctx || {};
    const op = ctx.opening;
    const sr = ctx.assistData && ctx.assistData.strategy;
    const bits = [];
    if (op) {
      const mine = op.side === ctx.myColor || op.side === "both";
      const theirs = op.side === ctx.oppColor || op.side === "both";
      const who = mine ? "You're playing" : theirs ? "Opponent is playing" : "In play";
      bits.push(`<span class="gs-op" title="${esc(op.idea || "")}">📖 <b>${esc(who)}:</b> ${esc(op.name)}</span>`);
    }
    if (sr && sr.strategies && sr.strategies.length) {
      const top = sr.strategies[0];
      bits.push(`<span class="gs-plan" title="${esc(top.idea || "")}">🧭 ${esc(top.name)}</span>`);
    }
    if (sr && sr.opponent) bits.push(`<span class="gs-opp" title="${esc(sr.opponent)}">🎯 ${esc(sr.opponent)}</span>`);
    if (!bits.length) return "";
    const phase = sr && sr.phase ? `<span class="gs-phase">${esc(sr.phase)}</span>` : "";
    return `<div class="gs-row">${phase}${bits.join("")}<span class="gs-more">Plans ›</span></div>`;
  }

  // ---- The PRIORITY LADDER (what the Glass Lens headlines this turn) -----------
  // Shared so Play-AI and human games prioritise identically. The RECOMMENDED MOVE is
  // injected by the caller (Play-AI feeds Stockfish at full strength; human games feed
  // the server-validated Rust engine's pick) — this module never chooses an engine.
  //
  // Order: analyzing → stop mate → save a threatened piece → your picked plan →
  //        follow the book → play for a draw → best available.
  // Rule that must not be broken: a plan/book move is only headlined when it EQUALS
  // the recommended move, so assistance can never talk you into a worse move.
  //
  // ctx: { assistData, recommended, picked, followBook, opening, history, lastEval,
  //        pieceNameAt, sqName, flavor, repeats }
  function pickPriority(ctx) {
    ctx = ctx || {};
    const a = ctx.assistData;
    if (!a || a.level === "off" || !(a.candidates || []).length) return null;
    const rec = ctx.recommended;
    if (!rec) return { analyzing: true }; // say so honestly rather than show a weak move
    const recUci = rec.uci || "";
    const nameAt = ctx.pieceNameAt || (() => "piece");
    const sqn = ctx.sqName || ((i) => String(i));

    if (a.mateThreat) return { move: rec, label: "Stop the checkmate", why: "Mate is threatened — this is the engine's strongest defence.", tag: "Urgent", kind: "urgent" };

    const big = (a.threats || []).filter((t) => t.loss >= 200)[0];
    if (big) {
      const nm = nameAt(big.sq);
      const saves = rec.from === big.sq;
      return { move: rec, tag: "Urgent", kind: "urgent",
        label: saves ? `Move your ${nm} to safety` : `Your ${nm} is attacked`,
        why: `Your ${nm} on ${sqn(big.sq)} is under attack — ${saves ? "this gets it out of danger" : "the engine's strongest response"}.` };
    }

    const picked = ctx.picked;
    if (picked && picked.moveUci && picked.moveUci.slice(0, 4) === recUci.slice(0, 4)) {
      return { move: rec, label: `Continue your ${picked.verb || "plan"}`, why: picked.moveNote || rec.note || "Both your plan and the engine agree here.", tag: "Fits plan · best", kind: "strategy" };
    }

    if (ctx.followBook) {
      const bn = bookNextMove({ opening: ctx.opening, history: ctx.history });
      if (bn && ctx.opening && bn.uci.slice(0, 4) === recUci.slice(0, 4)) {
        return { move: rec, label: `Book: ${ctx.opening.name}`, why: ctx.opening.idea || "Following your opening's main line.", tag: "Book · best", kind: "strategy" };
      }
    }

    if (ctx.lastEval != null && ctx.lastEval <= -180 && ctx.lastEval > -800) {
      const rep = typeof ctx.repeats === "function" ? ctx.repeats(rec) : false;
      return { move: rec, kind: "draw",
        tag: rep ? "Draw · repeat" : "Draw try",
        label: rep ? "Repeat for a draw" : "Play for a draw",
        why: rep
          ? "You're worse here, so a draw is a great result. This repeats an earlier position — do it three times and it's a draw by repetition. ♻"
          : "You're worse here, so aim for a draw, not a win. Keep it solid, trade into a drawish endgame, and look for a repetition or perpetual check. This is the soundest way to hold." };
    }

    const fl = ctx.flavor ? ctx.flavor(rec) : null;
    const byFlavor = { aggr: "Press the attack", simp: "Simplify the position", sneak: "A sneaky move", safe: "Build your position" };
    return { move: rec, label: (fl && byFlavor[fl.key]) || "Best move", why: rec.note || "The engine's strongest move here.", tag: "Best move", kind: "best" };
  }

  // The board "thinks out loud": the recommended move as a breathing arrow + ring.
  // Pure SVG; the caller passes its own orientation-aware square→centre mapper, so
  // the same arrow works on a flipped board in either game.
  function adviceSVG(from, to, kind, cxy) {
    const color = kind === "urgent" ? "#f2707e" : kind === "draw" ? "#8aa0ff" : "#7ee0d6";
    const A = cxy(from), B = cxy(to);
    let dx = B.x - A.x, dy = B.y - A.y; const len = Math.hypot(dx, dy) || 1; const ux = dx / len, uy = dy / len;
    const sx = A.x + ux * 34, sy = A.y + uy * 34, tx = B.x - ux * 28, ty = B.y - uy * 28;
    const h = 34, w = 25, bx = tx - ux * h, by = ty - uy * h, px = -uy, py = ux;
    return `<circle class="adv-ring" cx="${B.x}" cy="${B.y}" r="46" fill="none" stroke="${color}" stroke-width="7"/>` +
      `<g class="adv-arrow"><line x1="${sx}" y1="${sy}" x2="${bx}" y2="${by}" stroke="${color}" stroke-width="18" stroke-linecap="round"/>` +
      `<polygon points="${tx},${ty} ${bx + px * w},${by + py * w} ${bx - px * w},${by - py * w}" fill="${color}"/></g>`;
  }

  // The NEXT move in a chosen opening's book line, if the game is still following it.
  // ctx: { opening, history } — returns {uci,from,to} or null.
  function bookNextMove(ctx) {
    const op = ctx && ctx.opening, hist = (ctx && ctx.history) || [];
    if (!op || !op.uci || op.uci.length <= hist.length) return null;
    for (let i = 0; i < hist.length; i++) if (op.uci[i] !== hist[i]) return null; // history must match the line
    const u = op.uci[hist.length];
    if (!u || u.length < 4) return null;
    return { uci: u, from: (u.charCodeAt(0) - 97) + (u.charCodeAt(1) - 49) * 8, to: (u.charCodeAt(2) - 97) + (u.charCodeAt(3) - 49) * 8 };
  }

  global.GBAssistUI = { PVAL, PIECE_WORD, STRAT_VERB, verbFor, pieceAttacks, moveMeaning, identity, identityRowHTML, stripHTML, pickPriority, adviceSVG, bookNextMove, esc };
})(window);
