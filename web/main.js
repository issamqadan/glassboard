// Glassboard web shell (M2). A thin view over the WASM engine core: all rules
// and search live in Rust; this file only renders the board and forwards clicks.

import init, { Game } from "./pkg/glassboard_wasm.js";

const GLYPH = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const thinkingEl = document.getElementById("thinking");
const depthEl = document.getElementById("depth");

let game;
let selected = null;
let legalTargets = [];
let busy = false;

async function main() {
  await init();
  document.getElementById("new").addEventListener("click", newGame);
  newGame();
}

function newGame() {
  game = new Game();
  selected = null;
  legalTargets = [];
  busy = false;
  thinkingEl.textContent = "";
  render();
}

// Square index with a1 = 0 .. h8 = 63.
const idx = (file, rank) => rank * 8 + file;
const isWhitePiece = (c) => c !== "." && c === c.toUpperCase();

function render() {
  const s = game.boardString();
  boardEl.innerHTML = "";
  // Draw rank 8 (top) down to rank 1 (bottom).
  for (let rank = 7; rank >= 0; rank--) {
    for (let file = 0; file < 8; file++) {
      const i = idx(file, rank);
      const sq = document.createElement("div");
      sq.className = "sq " + ((file + rank) % 2 === 1 ? "light" : "dark");
      if (selected === i) sq.classList.add("selected");
      if (legalTargets.includes(i)) sq.classList.add("target");

      const c = s[i];
      if (c !== ".") {
        const span = document.createElement("span");
        span.className = "piece " + (isWhitePiece(c) ? "white" : "black");
        span.textContent = GLYPH[c];
        sq.appendChild(span);
      }
      sq.addEventListener("click", () => onClick(i));
      boardEl.appendChild(sq);
    }
  }
  updateStatus();
}

function select(i) {
  selected = i;
  legalTargets = Array.from(game.legalTo(i));
  render();
}

function clearSelection() {
  selected = null;
  legalTargets = [];
  render();
}

function onClick(i) {
  if (busy || game.status() !== "ongoing") return;
  const c = game.boardString()[i];

  if (selected === null) {
    if (isWhitePiece(c)) select(i);
    return;
  }
  if (i === selected) {
    clearSelection();
    return;
  }
  if (legalTargets.includes(i)) {
    let promo;
    if (game.isPromotion(selected, i)) promo = choosePromotion();
    const ok = game.makeMove(selected, i, promo);
    clearSelection();
    if (ok) setTimeout(engineReply, 150);
    return;
  }
  // Clicked elsewhere: reselect another own piece, or clear.
  if (isWhitePiece(c)) select(i);
  else clearSelection();
}

function choosePromotion() {
  const p = window.prompt("Promote to? (q, r, b, n)", "q");
  return p && "qrbn".includes(p.toLowerCase()) ? p.toLowerCase() : "q";
}

function engineReply() {
  if (game.status() !== "ongoing") {
    render();
    return;
  }
  busy = true;
  thinkingEl.textContent = "Engine thinking…";
  // Let the "thinking" label paint before the synchronous search blocks.
  setTimeout(() => {
    game.engineMove(parseInt(depthEl.value, 10));
    busy = false;
    thinkingEl.textContent = "";
    render();
  }, 20);
}

function updateStatus() {
  const st = game.status();
  const side = game.sideToMove();
  const cap = side.charAt(0).toUpperCase() + side.slice(1);
  let msg;
  if (st === "checkmate") msg = `Checkmate — ${side === "white" ? "Black" : "White"} wins.`;
  else if (st === "stalemate") msg = "Stalemate — draw.";
  else if (st === "fifty-move") msg = "Draw — fifty-move rule.";
  else msg = `${cap} to move` + (game.inCheck() ? " — check!" : "");
  statusEl.textContent = msg;
}

main();
