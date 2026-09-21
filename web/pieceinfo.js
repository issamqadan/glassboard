// Glassboard — piece knowledge for the "learn as you play" tips. Shared by the
// vs-AI and multiplayer clients. window.PIECE_INFO[kind] where kind is the
// lowercase FEN letter (p n b r q k).
window.PIECE_INFO = {
  p: {
    name: "Pawn", icon: "♟",
    moves: "Steps straight forward one square (two on its first move), and captures one square diagonally. It can never move backward.",
    role: "Pawns are the soul of the position — their chains decide where the pieces belong. A pawn that reaches the far side promotes to a queen.",
    strong: "Strongest in connected chains and as a passed pawn in the endgame (no enemy pawn can stop it).",
    pairs: "Pawns protect each other in chains, and shelter your king. A pawn also anchors a knight on a strong outpost.",
  },
  n: {
    name: "Knight", icon: "♞",
    moves: "Jumps in an L — two squares one way, then one square across — and it can leap over other pieces.",
    role: "The tricky short-range attacker. It loves closed, locked positions where its jumping beats sliding pieces.",
    strong: "Deadly on a protected outpost in the centre; weak on the edge — 'a knight on the rim is dim.'",
    pairs: "Lethal next to a queen (they cover different squares), and thrives on a pawn-supported outpost.",
  },
  b: {
    name: "Bishop", icon: "♝",
    moves: "Slides any number of empty squares along a diagonal. Each bishop stays on one colour forever.",
    role: "A long-range sniper. It rakes open diagonals across the whole board — but can be 'bad' if trapped behind its own pawns.",
    strong: "Strong in open positions with long clear diagonals; the two bishops together (the 'bishop pair') is a real edge.",
    pairs: "The bishop pair covers both colours; a bishop + queen form a powerful diagonal battery aimed at the king.",
  },
  r: {
    name: "Rook", icon: "♜",
    moves: "Slides any number of empty squares along a rank or file (straight lines).",
    role: "A heavy piece that wakes up when lines open. Put it on an open file and it becomes a highway into the enemy camp.",
    strong: "Powerful on open files, on the 7th rank (munching pawns), and in the endgame behind a passed pawn.",
    pairs: "Doubled rooks on a file are crushing; a rook + queen on the 7th is often decisive.",
  },
  q: {
    name: "Queen", icon: "♛",
    moves: "Slides any distance along ranks, files, AND diagonals — a rook and bishop combined. The most powerful piece.",
    role: "Your heaviest attacker. Immensely strong — but don't bring it out too early, or the opponent develops with tempo by chasing it.",
    strong: "Dominant in open positions and direct attacks on the king.",
    pairs: "Forms batteries with a rook (down a file) or a bishop (along a diagonal) — the strongest attacking duos in chess.",
  },
  k: {
    name: "King", icon: "♚",
    moves: "Moves one square in any direction. Once per game it can 'castle' with a rook to reach safety. It can never move into check.",
    role: "In the opening and middlegame it's a liability — castle it to safety early. In the endgame it becomes a fighting piece.",
    strong: "Comes alive in the endgame — march it toward the action to escort pawns and fight for squares.",
    pairs: "Shelters behind its own pawns for safety; in the endgame it shepherds passed pawns to promotion.",
  },
};

// ---- Captured material: who has taken what, and by how much ----
// Standard chess values; king excluded (never captured).
window.CAPTURE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

// From a 64-char board string, work out what each side has captured (start
// complement minus what's left) and the material balance (promotion-accurate,
// from White's perspective: +ve = White ahead). Returns
// { whiteCaptured:[black chars], blackCaptured:[White chars], materialDiff }.
window.capturedFromBoard = function (boardStr) {
  const cnt = {};
  for (const ch of boardStr) if (ch !== ".") cnt[ch] = (cnt[ch] || 0) + 1;
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1, P: 8, N: 2, B: 2, R: 2, Q: 1 };
  const missing = (chars) => {
    const out = [];
    for (const c of chars) {
      const gone = Math.max(0, (start[c] || 0) - (cnt[c] || 0));
      for (let k = 0; k < gone; k++) out.push(c);
    }
    out.sort((a, b) => (window.CAPTURE_VALUE[b.toLowerCase()] || 0) - (window.CAPTURE_VALUE[a.toLowerCase()] || 0));
    return out;
  };
  let materialDiff = 0;
  for (const ch of boardStr) {
    if (ch === "." || ch === "K" || ch === "k") continue;
    const v = window.CAPTURE_VALUE[ch.toLowerCase()] || 0;
    materialDiff += ch === ch.toUpperCase() ? v : -v;
  }
  return {
    whiteCaptured: missing(["q", "r", "b", "n", "p"]), // black pieces White took
    blackCaptured: missing(["Q", "R", "B", "N", "P"]), // White pieces Black took
    materialDiff,
  };
};

// One side's tray: the captured glyphs (reusing the board piece set) plus a
// "+N" badge when that side is ahead on material.
window.capturedTrayHTML = function (capturedChars, advantage) {
  const glyphs = capturedChars
    .map((ch) => {
      const color = ch === ch.toUpperCase() ? "white" : "black";
      return `<span class="cap-pc ${color}">${window.pieceSVG ? window.pieceSVG(ch) : ""}</span>`;
    })
    .join("");
  const badge = advantage > 0 ? `<span class="cap-adv">+${advantage}</span>` : "";
  return glyphs || badge ? glyphs + badge : "";
};

// The material "tug" bar: ONE strip above the board. Each side's captured pieces
// flank a living balance beam whose midpoint slides toward whoever leads on
// material, with the lead amount floating at the tipping point. At-a-glance who's
// winning — and it *moves* when you capture (piece values, felt not memorised).
// `iAmWhite` orients "you" to the left. Built once, then updated in place so the
// beam glides (and captured pieces pop only when the set actually changes).
window.renderMaterialBar = function (el, boardStr, iAmWhite) {
  if (!el || !window.capturedFromBoard) return;
  const c = window.capturedFromBoard(boardStr);
  const mine = iAmWhite ? c.whiteCaptured : c.blackCaptured;   // pieces YOU took
  const theirs = iAmWhite ? c.blackCaptured : c.whiteCaptured; // pieces THEY took
  const adv = iAmWhite ? c.materialDiff : -c.materialDiff;      // + = you lead
  const cap = Math.max(-10, Math.min(10, adv));
  const yourShare = 50 + cap * 4; // 10..90 — leader's zone grows
  const glyphs = (arr) =>
    arr.map((ch) => {
      const color = ch === ch.toUpperCase() ? "white" : "black";
      return `<span class="cap-pc ${color}">${window.pieceSVG ? window.pieceSVG(ch) : ""}</span>`;
    }).join("");

  if (!el.querySelector(".mb-track")) {
    el.innerHTML =
      `<div class="mb-caps you"></div>` +
      `<div class="mb-track">` +
        `<div class="mb-fill you"></div><div class="mb-fill opp"></div>` +
        `<div class="mb-knob"></div><span class="mb-badge"></span>` +
      `</div>` +
      `<div class="mb-caps opp"></div>`;
  }
  const capsYou = el.querySelector(".mb-caps.you");
  const capsOpp = el.querySelector(".mb-caps.opp");
  const sigYou = mine.join(""), sigOpp = theirs.join("");
  if (capsYou.dataset.sig !== sigYou) { capsYou.innerHTML = glyphs(mine); capsYou.dataset.sig = sigYou; }
  if (capsOpp.dataset.sig !== sigOpp) { capsOpp.innerHTML = glyphs(theirs); capsOpp.dataset.sig = sigOpp; }
  el.querySelector(".mb-fill.you").style.width = yourShare + "%";
  el.querySelector(".mb-fill.opp").style.width = (100 - yourShare) + "%";
  el.querySelector(".mb-knob").style.left = yourShare + "%";
  const badge = el.querySelector(".mb-badge");
  badge.className = "mb-badge " + (adv === 0 ? "even" : adv > 0 ? "you" : "opp");
  badge.style.left = (adv === 0 ? 50 : yourShare) + "%";
  badge.textContent = adv === 0 ? "even" : "+" + Math.abs(adv);
};

// Illustrated move pattern: a 5×5 mini-board with the piece in the centre and
// every square it can reach lit up (● move · ✕ capture). Far more intuitive
// than a paragraph — you *see* the L of the knight, the rays of the bishop.
// Returns an HTML string; shared by every gameplay mode.
window.pieceMoveDiagram = function (kind) {
  const N = 5, c = 2; // 5×5 grid, piece at centre (row c, file c)
  const reach = new Set(), caps = new Set();
  const add = (r, f, cap) => { if (r >= 0 && r < N && f >= 0 && f < N) (cap ? caps : reach).add(r * N + f); };
  if (kind === "n") {
    [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]].forEach(([dr, df]) => add(c + dr, c + df));
  } else if (kind === "k") {
    for (let dr = -1; dr <= 1; dr++) for (let df = -1; df <= 1; df++) if (dr || df) add(c + dr, c + df);
  } else if (kind === "p") {
    add(c - 1, c);            // one step forward (board drawn with your side at the bottom → forward is up)
    add(c - 2, c);            // the two-square first move
    add(c - 1, c - 1, true);  // diagonal captures
    add(c - 1, c + 1, true);
  } else {
    const dirs = kind === "r" ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
      : kind === "b" ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]; // queen
    dirs.forEach(([dr, df]) => { for (let s = 1; s < N; s++) { const r = c + dr * s, f = c + df * s; if (r < 0 || r >= N || f < 0 || f >= N) break; add(r, f); } });
  }
  const icon = (window.PIECE_INFO[kind] || {}).icon || "";
  let html = '<div class="mv-grid" aria-hidden="true">';
  for (let r = 0; r < N; r++) for (let f = 0; f < N; f++) {
    const i = r * N + f, dark = (r + f) % 2 === 1;
    let cls = "mv-cell" + (dark ? " d" : ""), inner = "";
    if (r === c && f === c) { cls += " pc"; inner = `<span class="mv-pc">${icon}</span>`; }
    else if (caps.has(i)) { cls += " cap"; inner = '<span class="mv-mark cap">✕</span>'; }
    else if (reach.has(i)) { cls += " mov"; inner = '<span class="mv-mark">●</span>'; }
    html += `<div class="${cls}">${inner}</div>`;
  }
  html += "</div>";
  const legend = kind === "p"
    ? '<div class="mv-legend"><span class="mv-mark">●</span> move &nbsp; <span class="mv-mark cap">✕</span> capture</div>'
    : '<div class="mv-legend"><span class="mv-mark">●</span> where it can go</div>';
  return html + legend;
};
