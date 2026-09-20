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
