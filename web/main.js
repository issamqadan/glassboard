// Glassboard web shell (M2 + M3). A thin view over the WASM core: all rules,
// search, assistance, and the glass-box live in Rust. This file renders the
// board + panels and forwards clicks. Assistance is computed once per position
// change (so the glass-box records each turn exactly once).

import init, { Game } from "./pkg/glassboard_wasm.js";

// Solid glyphs keyed by piece kind; color is decided in CSS by side, so both
// colors share the same crisp shape and stay legible on any square.
// Trailing ︎ forces text-style (not emoji) rendering so White pieces stay
// white on mobile browsers instead of all showing as dark emoji.
const GLYPH = { p: "♟︎", n: "♞︎", b: "♝︎", r: "♜︎", q: "♛︎", k: "♚︎" };
const FILES = "abcdefgh";

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const assistEl = document.getElementById("assist");
const glassEl = document.getElementById("glass");
const levelEl = document.getElementById("level");
const depthEl = document.getElementById("depth");
const humanEloEl = document.getElementById("humanElo");
const engineEloEl = document.getElementById("engineElo");

// Player Model: vs-AI games feed the same learning signal as online play.
// We send each of the human's own moves (position before + the move) to the
// server, which classifies it exactly like a multiplayer move. Fire-and-forget:
// it never blocks the board, and only runs for a signed-in player.
const SERVER_HTTP = "https://playglassboard.onrender.com";
function gbMeId() { try { return (JSON.parse(localStorage.getItem("gb_me")) || {}).id || ""; } catch { return ""; } }
function recordHumanMove(preFen, from, to, promo) {
  const id = gbMeId();
  if (!id) return;
  const uci = sqName(from) + sqName(to) + (promo || "");
  try {
    fetch(SERVER_HTTP + "/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: id, fen: preFen, uci }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

let game;
let selected = null;
let legalTargets = [];
let hanging = [];
let lastMove = null; // { from, to } of the most recent move
let assistData = null; // parsed assist JSON for the current (White) turn
let busy = false;
let resigned = false;

const depth = () => parseInt(depthEl.value, 10);
const idx = (file, rank) => rank * 8 + file;
const isWhitePiece = (c) => c !== "." && c === c.toUpperCase();

async function main() {
  await init();
  document.getElementById("new").addEventListener("click", newGame);
  const rb = document.getElementById("resignBtn");
  if (rb) rb.addEventListener("click", resign);
  const orm = document.getElementById("overRematch");
  if (orm) orm.addEventListener("click", () => { hideOver(); newGame(); });
  const ocl = document.getElementById("overClose");
  if (ocl) ocl.addEventListener("click", hideOver);
  newGame();
}
const hideOver = () => { const ov = document.getElementById("overOverlay"); if (ov) ov.style.display = "none"; };

function newGame() {
  game = new Game();
  game.setRatings(parseInt(humanEloEl.value, 10), parseInt(engineEloEl.value, 10));
  selected = null;
  legalTargets = [];
  lastMove = null;
  busy = false;
  resigned = false;
  pickedStrategyId = null;
  hideOver();
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
  renderPlayers();
  renderStrategy();
  renderAssist();
  renderGlass();
  renderStatus();
  showGameOverIfNeeded();
}

function renderPlayers() {
  const el = document.getElementById("players");
  if (!el) return;
  el.hidden = false;
  const over = resigned || game.status() !== "ongoing";
  const turn = over ? null : game.sideToMove();
  el.innerHTML =
    `<span class="pl"><span class="dot white"></span> <b>You</b> <span class="tnum">${humanEloEl.value}</span></span>` +
    `<span class="vs">vs</span>` +
    `<span class="pl"><span class="dot black"></span> <b>🤖 Glassboard</b> <span class="tnum">${engineEloEl.value}</span></span>` +
    (turn ? `<span class="turn">${turn === "white" ? "Your move" : "Engine…"}</span>` : "");
}

function resign() {
  if (resigned || game.status() !== "ongoing") return;
  if (!confirm("Resign to the engine? It'll count as a loss.")) return;
  resigned = true;
  paint();
}

function showGameOverIfNeeded() {
  const ov = document.getElementById("overOverlay");
  if (!ov) return;
  const st = game.status();
  const over = resigned || st !== "ongoing";
  const rb = document.getElementById("resignBtn");
  if (rb) rb.hidden = over;
  if (!over) { ov.style.display = "none"; return; }
  let winner = "", reason = "";
  if (resigned) { winner = "black"; reason = "resignation"; }        // you (White) resigned
  else if (st === "checkmate") { winner = game.sideToMove() === "white" ? "black" : "white"; reason = "checkmate"; }
  else if (st === "stalemate") { reason = "stalemate"; }
  else if (st === "fifty-move") { reason = "fifty-move rule"; }
  const draw = winner === "", won = winner === "white";
  const res = document.getElementById("overResult"), rea = document.getElementById("overReason");
  res.textContent = draw ? "Draw" : won ? "You win! 🎉" : "You lose";
  res.className = "over-result " + (draw ? "draw" : won ? "win" : "loss");
  rea.textContent = "by " + reason;
  ov.style.display = "grid";
}

// --- strategy layer (same UX as multiplayer; White orientation, plays vs AI) ---
const STRAT_ICON = { win_material: "⚔", develop: "♞", center: "▦", attack_king: "⚔", simplify: "♟", passer: "⏫", iso_attack: "◎", open_file: "▤", pawn_storm: "⛰", fianchetto: "◹" };
const STRAT_COLOR = { win_material: "#f2707e", develop: "#5cc9ec", center: "#7ee0d6", attack_king: "#f2707e", simplify: "#e0be79", passer: "#5cc9ec", iso_attack: "#f2707e", open_file: "#7ee0d6", pawn_storm: "#f2707e", fianchetto: "#e0be79" };
const PLAN_COLOR = { dev: "#5cc9ec", attack: "#f2707e", support: "#7ee0d6", castle: "#e0be79" };
let pickedStrategyId = null;
const planCxy = (sq) => ({ x: ((sq % 8) + 0.5) * 100, y: ((7 - Math.floor(sq / 8)) + 0.5) * 100 }); // White at bottom
function uciSquares(u) {
  if (!u || u.length < 4) return null;
  return { from: (u.charCodeAt(0) - 97) + (u.charCodeAt(1) - 49) * 8, to: (u.charCodeAt(2) - 97) + (u.charCodeAt(3) - 49) * 8 };
}
function planArrow(fromSq, toSq, color, i) {
  const A = planCxy(fromSq), B = planCxy(toSq);
  let dx = B.x - A.x, dy = B.y - A.y; const len = Math.hypot(dx, dy) || 1; const ux = dx / len, uy = dy / len;
  const sx = A.x + ux * 32, sy = A.y + uy * 32, tx = B.x - ux * 30, ty = B.y - uy * 30;
  const h = 30, w = 20, bx = tx - ux * h, by = ty - uy * h, px = -uy, py = ux;
  return `<g class="arrow" style="animation-delay:${(i * 0.12).toFixed(2)}s">` +
    `<line x1="${sx}" y1="${sy}" x2="${bx}" y2="${by}" stroke="${color}" stroke-width="14" stroke-linecap="round" opacity="0.92"/>` +
    `<polygon points="${tx},${ty} ${bx + px * w},${by + py * w} ${bx - px * w},${by - py * w}" fill="${color}"/></g>`;
}
function drawPlan(strat) {
  const ov = document.getElementById("planOverlay");
  if (!ov) return;
  if (!strat) { ov.innerHTML = ""; return; }
  const ringColor = PLAN_COLOR[(strat.arrows[0] || {}).kind] || "#e0be79";
  let s = "";
  (strat.rings || []).forEach((sq, i) => { const C = planCxy(sq); s += `<circle class="ring" cx="${C.x}" cy="${C.y}" r="44" fill="none" stroke="${ringColor}" stroke-width="6" opacity="0.75" style="animation-delay:${(i * 0.1).toFixed(2)}s"/>`; });
  (strat.arrows || []).forEach((a, i) => { s += planArrow(a.from, a.to, PLAN_COLOR[a.kind] || "#5cc9ec", i); });
  ov.innerHTML = s;
}
function renderStrategy() {
  const panel = document.getElementById("stratPanel"), host = document.getElementById("strategy");
  if (!panel || !host) return;
  const sr = assistData && assistData.strategy;
  if (!sr || !sr.strategies || !sr.strategies.length) { panel.hidden = true; host.innerHTML = ""; drawPlan(null); return; }
  panel.hidden = false;
  document.getElementById("stratPhase").textContent = sr.phase;
  host.innerHTML = "";
  if (sr.opponent) { const o = document.createElement("div"); o.className = "opp-read"; o.innerHTML = `<span>👁</span><span>${escapeHtml(sr.opponent)}</span>`; host.appendChild(o); }
  if (pickedStrategyId && !sr.strategies.some((s) => s.id === pickedStrategyId)) pickedStrategyId = null;
  sr.strategies.forEach((s) => {
    const card = document.createElement("div");
    card.className = "scard" + (s.id === pickedStrategyId ? " on" : "");
    card.style.setProperty("--sc", STRAT_COLOR[s.id] || "#5cc9ec");
    card.innerHTML = `<span class="sic">${STRAT_ICON[s.id] || "◆"}</span><div><div class="sname">${escapeHtml(s.name)}</div><div class="sidea">${escapeHtml(s.idea)}</div></div>`;
    card.addEventListener("click", () => { pickedStrategyId = s.id; renderStrategy(); });
    host.appendChild(card);
  });
  const picked = sr.strategies.find((s) => s.id === pickedStrategyId);
  if (picked) {
    const d = document.createElement("div"); d.className = "sdetail"; d.style.setProperty("--sc", STRAT_COLOR[picked.id] || "#5cc9ec");
    const steps = picked.steps.map((st) => `<div class="step ${st.done ? "done" : ""}"><span class="sd">${st.done ? "✓" : "•"}</span><span>${escapeHtml(st.text)}</span></div>`).join("");
    d.innerHTML = `<div class="steps">${steps}</div><div class="snext">Next — <b>your move</b><span class="smove" title="Click to play">${escapeHtml(picked.moveSan || picked.moveUci)}</span>${escapeHtml(picked.moveNote)}</div>`;
    host.appendChild(d);
    const mv = d.querySelector(".smove");
    if (mv) { mv.style.cursor = "pointer"; mv.addEventListener("click", () => { const q = uciSquares(picked.moveUci); if (q) playMove(q.from, q.to); }); }
    drawPlan(picked);
  } else {
    drawPlan(null);
    const hint = document.createElement("div"); hint.className = "shint"; hint.textContent = "Pick a plan to see it on the board.";
    host.appendChild(hint);
  }
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
      if (legalTargets.includes(i)) { sq.classList.add("target"); if (s[i] !== ".") sq.classList.add("capture"); }
      if (hanging.includes(i)) sq.classList.add("hanging");
      if (lastMove && (lastMove.from === i || lastMove.to === i)) sq.classList.add("lastmove");

      // Coordinate labels on the edge squares.
      if (rank === 0) sq.appendChild(coord("file", FILES[file]));
      if (file === 0) sq.appendChild(coord("rank", String(rank + 1)));

      const c = s[i];
      if (c !== ".") {
        const span = document.createElement("span");
        span.className = "piece " + (isWhitePiece(c) ? "white" : "black");
        if (typeof pieceSVG === "function") span.innerHTML = pieceSVG(c);
        else span.textContent = GLYPH[c.toLowerCase()];
        sq.appendChild(span);
      }
      sq.addEventListener("click", () => onSquareClick(i));
      boardEl.appendChild(sq);
    }
  }
}

function coord(kind, text) {
  const el = document.createElement("span");
  el.className = "coord " + kind;
  el.textContent = text;
  return el;
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
      const isRec = a.recommended && c.uci === a.recommended;
      const el = document.createElement("div");
      el.className = "cand" + (isRec ? " rec" : "");
      el.innerHTML =
        `<div class="cand-main"><span class="cand-move">${c.san || c.uci}${isRec ? " ➤" : ""}</span>` +
        (c.note ? `<div class="cand-note">${escapeHtml(c.note)}</div>` : "") +
        `</div><span class="score">${fmtScore(c.score)}</span>`;
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
  if (game.isPromotion(from, to)) { showPromotion(from, to); return; }
  doPlay(from, to, undefined);
}
function doPlay(from, to, promo) {
  const preFen = game.fen(); // position before the human's move (for the Player Model)
  const ok = game.makeMove(from, to, promo);
  selected = null;
  legalTargets = [];
  if (!ok) { paint(); return; }
  lastMove = { from, to };
  recordHumanMove(preFen, from, to, promo); // learn from this move too
  onPositionChanged(); // now Black to move → assist cleared
  setTimeout(engineReply, 150);
}
function showPromotion(from, to) {
  const ov = document.getElementById("promoOverlay");
  if (!ov) { doPlay(from, to, "q"); return; }
  const choices = ov.querySelector(".promo-choices");
  choices.innerHTML = ["q", "r", "b", "n"].map((p) => {
    const g = typeof pieceSVG === "function" ? pieceSVG(p.toUpperCase()) : p.toUpperCase();
    return `<button class="promo-pick" data-p="${p}"><span class="piece white">${g}</span></button>`;
  }).join("");
  choices.querySelectorAll(".promo-pick").forEach((b) => { b.onclick = () => { ov.style.display = "none"; doPlay(from, to, b.dataset.p); }; });
  ov.style.display = "grid";
}

function engineReply() {
  if (game.status() !== "ongoing") {
    onPositionChanged();
    return;
  }
  busy = true;
  statusEl.textContent = "Engine thinking…";
  setTimeout(() => {
    const uci = game.engineMove(depth());
    if (uci.length >= 4) lastMove = uciToSquares(uci);
    busy = false;
    onPositionChanged();
  }, 20);
}

// --- helpers ---------------------------------------------------------------

function sqName(i) {
  return `${FILES[i % 8]}${1 + Math.floor(i / 8)}`;
}

function uciToSquares(uci) {
  const sq = (s) => (s.charCodeAt(0) - 97) + (s.charCodeAt(1) - 49) * 8;
  return { from: sq(uci.slice(0, 2)), to: sq(uci.slice(2, 4)) };
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
