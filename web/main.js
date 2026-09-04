// Glassboard web shell (M2 + M3). A thin view over the WASM core: all rules,
// search, assistance, and the glass-box live in Rust. This file renders the
// board + panels and forwards clicks. Assistance is computed once per position
// change (so the glass-box records each turn exactly once).

import init, { Game } from "./pkg/glassboard_wasm.js";

const GLYPH = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const assistEl = document.getElementById("assist");
const glassEl = document.getElementById("glass");
const levelEl = document.getElementById("level");
const depthEl = document.getElementById("depth");
const humanEloEl = document.getElementById("humanElo");
const engineEloEl = document.getElementById("engineElo");

let game;
let selected = null;
let legalTargets = [];
let hanging = [];
let assistData = null; // parsed assist JSON for the current (White) turn
let busy = false;

const depth = () => parseInt(depthEl.value, 10);
const idx = (file, rank) => rank * 8 + file;
const isWhitePiece = (c) => c !== "." && c === c.toUpperCase();

async function main() {
  await init();
  document.getElementById("new").addEventListener("click", newGame);
  newGame();
}

function newGame() {
  game = new Game();
  game.setRatings(parseInt(humanEloEl.value, 10), parseInt(engineEloEl.value, 10));
  selected = null;
  legalTargets = [];
  busy = false;
  levelEl.textContent = game.assistLevel();
  onPositionChanged();
}

// Called once whenever the position changes (after a move). Computes assistance
// for White's turn exactly once, then repaints everything.
function onPositionChanged() {
  hanging = [];
  assistData = null;
  if (game.status() === "ongoing" && game.sideToMove() === "white") {
    assistData = JSON.parse(game.assist(depth())); // records to glass-box once
    hanging = assistData.hanging;
  }
  paint();
}

// Repaints board + panels from current state (no assistance recompute).
function paint() {
  renderBoard();
  renderAssist();
  renderGlass();
  renderStatus();
}

function renderBoard() {
  const s = game.boardString();
  boardEl.innerHTML = "";
  for (let rank = 7; rank >= 0; rank--) {
    for (let file = 0; file < 8; file++) {
      const i = idx(file, rank);
      const sq = document.createElement("div");
      sq.className = "sq " + ((file + rank) % 2 === 1 ? "light" : "dark");
      if (selected === i) sq.classList.add("selected");
      if (legalTargets.includes(i)) sq.classList.add("target");
      if (hanging.includes(i)) sq.classList.add("hanging");

      const c = s[i];
      if (c !== ".") {
        const span = document.createElement("span");
        span.className = "piece " + (isWhitePiece(c) ? "white" : "black");
        span.textContent = GLYPH[c];
        sq.appendChild(span);
      }
      sq.addEventListener("click", () => onSquareClick(i));
      boardEl.appendChild(sq);
    }
  }
}

function renderStatus() {
  const st = game.status();
  const side = game.sideToMove();
  const cap = side.charAt(0).toUpperCase() + side.slice(1);
  let msg;
  if (st === "checkmate") msg = `Checkmate — ${side === "white" ? "Black" : "White"} wins.`;
  else if (st === "stalemate") msg = "Stalemate — draw.";
  else if (st === "fifty-move") msg = "Draw — fifty-move rule.";
  else msg = `${cap} to move` + (game.inCheck() ? " — check!" : "");
  statusEl.textContent = msg;
  levelEl.textContent = game.assistLevel();
}

function renderAssist() {
  assistEl.innerHTML = "";
  if (!assistData) {
    assistEl.innerHTML = `<div class="none">Engine to move — no assistance this turn.</div>`;
    return;
  }
  const a = assistData;
  if (a.inCheck) add(`<div class="warn">⚠ You are in check.</div>`);
  if (a.hanging.length) {
    add(`<div class="warn">⚠ Hanging: ${a.hanging.map(sqName).join(", ")}</div>`);
  }
  a.messages.forEach((m) => add(`<div class="msg">• ${escapeHtml(m)}</div>`));

  if (a.candidates.length) {
    a.candidates.forEach((c) => {
      const rec = a.recommended && c.uci === a.recommended ? " rec" : "";
      const el = document.createElement("div");
      el.className = "cand" + rec;
      el.innerHTML = `<span>${c.uci}${rec ? " ➤" : ""}</span><span class="score">${fmtScore(c.score)}</span>`;
      el.addEventListener("click", () => playMove(c.from, c.to));
      assistEl.appendChild(el);
    });
  }
  if (!assistEl.innerHTML) add(`<div class="none">No assistance at this rung.</div>`);

  function add(html) {
    assistEl.insertAdjacentHTML("beforeend", html);
  }
}

function renderGlass() {
  const events = JSON.parse(game.glassbox());
  if (!events.length) {
    glassEl.innerHTML = `<div class="none">No assistance used yet.</div>`;
    return;
  }
  glassEl.innerHTML = events
    .map(
      (e) =>
        `<div class="ev"><span class="who">${e.side}</span> · ${escapeHtml(e.summary)}</div>`
    )
    .join("");
}

function onSquareClick(i) {
  if (busy || game.status() !== "ongoing" || game.sideToMove() !== "white") return;
  const c = game.boardString()[i];

  if (selected === null) {
    if (isWhitePiece(c)) selectSquare(i);
    return;
  }
  if (i === selected) {
    clearSelection();
    return;
  }
  if (legalTargets.includes(i)) {
    playMove(selected, i);
    return;
  }
  if (isWhitePiece(c)) selectSquare(i);
  else clearSelection();
}

function selectSquare(i) {
  selected = i;
  legalTargets = Array.from(game.legalTo(i));
  paint();
}

function clearSelection() {
  selected = null;
  legalTargets = [];
  paint();
}

function playMove(from, to) {
  let promo;
  if (game.isPromotion(from, to)) {
    const p = window.prompt("Promote to? (q, r, b, n)", "q");
    promo = p && "qrbn".includes(p.toLowerCase()) ? p.toLowerCase() : "q";
  }
  const ok = game.makeMove(from, to, promo);
  selected = null;
  legalTargets = [];
  if (!ok) {
    paint();
    return;
  }
  onPositionChanged(); // now Black to move → assist cleared
  setTimeout(engineReply, 150);
}

function engineReply() {
  if (game.status() !== "ongoing") {
    onPositionChanged();
    return;
  }
  busy = true;
  statusEl.textContent = "Engine thinking…";
  setTimeout(() => {
    game.engineMove(depth());
    busy = false;
    onPositionChanged();
  }, 20);
}

// --- helpers ---------------------------------------------------------------

function sqName(i) {
  const file = String.fromCharCode(97 + (i % 8));
  const rank = 1 + Math.floor(i / 8);
  return `${file}${rank}`;
}

function fmtScore(cp) {
  if (Math.abs(cp) >= 29000) return cp > 0 ? "#" : "-#"; // mate
  const s = (cp / 100).toFixed(1);
  return cp > 0 ? `+${s}` : s;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

main();
