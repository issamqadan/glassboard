// Glassboard online client. Connects to the multiplayer server over WebSocket;
// the server is authoritative (it validates every move with the engine). Each
// client keeps a local WASM engine rebuilt from the server's FEN — used only to
// show legal targets and compute the local player's assistance. The glass-box
// is relayed by the server so both players see identical help history.

import init, { Game } from "./pkg/glassboard_wasm.js";

// ︎ forces text-style (not emoji) glyphs so colors render on mobile.
const GLYPH = { p: "♟︎", n: "♞︎", b: "♝︎", r: "♜︎", q: "♛︎", k: "♚︎" };
const FILES = "abcdefgh";
const DEPTH = 3;

const el = (id) => document.getElementById(id);
const boardEl = el("board");
const statusEl = el("status");
const assistEl = el("assist");
const glassEl = el("glass");
const levelEl = el("level");
const serverEl = el("server");
const roomEl = el("room");
const eloEl = el("elo");

let ws = null;
let myColor = null;
let game = null;
let state = null;
let glassList = [];
let selected = null;
let legalTargets = [];
let hanging = [];
let assistData = null;
let lastMove = null;
let lastGlassFen = null;

const idx = (file, rank) => rank * 8 + file;
const isWhitePiece = (c) => c !== "." && c === c.toUpperCase();
const defaultServer = () => `ws://${location.hostname || "localhost"}:9001`;

async function main() {
  await init();
  serverEl.value = defaultServer();
  el("connect").addEventListener("click", connect);
  renderBoardEmpty();
}

function connect() {
  if (ws) ws.close();
  const url = serverEl.value.trim() || defaultServer();
  ws = new WebSocket(url);
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: "join", room: roomEl.value.trim() || "test", elo: parseInt(eloEl.value, 10) }));
    statusEl.textContent = "Connected — joining room…";
  };
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onclose = () => (statusEl.textContent = "Disconnected.");
  ws.onerror = () =>
    (statusEl.textContent = "Connection error — is the server running, and is the address right?");
}

function onMessage(msg) {
  switch (msg.t) {
    case "joined":
      myColor = msg.color;
      game = Game.fromFen(msg.fen);
      statusEl.textContent = `Joined as ${myColor}. Waiting for the other player…`;
      renderBoard();
      break;
    case "full":
      statusEl.textContent = "Room is full — two players are already connected.";
      break;
    case "state":
      onState(msg);
      break;
    case "glass":
      glassList.push({ side: msg.side, summary: msg.summary });
      renderGlass();
      break;
  }
}

function onState(msg) {
  state = msg;
  game = Game.fromFen(msg.fen);
  game.setRatings(myElo(), oppElo());
  lastMove = msg.last ? uciToSquares(msg.last) : null;
  selected = null;
  legalTargets = [];

  assistData = null;
  hanging = [];
  if (msg.status === "ongoing" && msg.turn === myColor) {
    assistData = JSON.parse(game.assist(DEPTH));
    hanging = assistData.hanging;
    // Relay this turn's assistance to both glass-boxes (once per position).
    if (assistData.level !== "off" && msg.fen !== lastGlassFen) {
      ws.send(JSON.stringify({ t: "glass", summary: summarize(assistData) }));
      lastGlassFen = msg.fen;
    }
  }
  paint();
}

const myElo = () => (myColor === "white" ? state.white_elo : state.black_elo);
const oppElo = () => (myColor === "white" ? state.black_elo : state.white_elo);

// --- rendering -------------------------------------------------------------

function paint() {
  renderBoard();
  renderAssist();
  renderGlass();
  renderStatus();
}

function orientedSquares() {
  const out = [];
  if (myColor === "black") {
    for (let rank = 0; rank < 8; rank++) for (let file = 7; file >= 0; file--) out.push({ file, rank });
  } else {
    for (let rank = 7; rank >= 0; rank--) for (let file = 0; file < 8; file++) out.push({ file, rank });
  }
  return out;
}

function renderBoardEmpty() {
  boardEl.innerHTML = "";
  for (let i = 0; i < 64; i++) {
    const d = document.createElement("div");
    const file = i % 8, rank = Math.floor(i / 8);
    d.className = "sq " + ((file + rank) % 2 === 1 ? "light" : "dark");
    boardEl.appendChild(d);
  }
}

function renderBoard() {
  if (!game) return renderBoardEmpty();
  const s = game.boardString();
  const bottomRank = myColor === "black" ? 7 : 0;
  const leftFile = myColor === "black" ? 7 : 0;

  boardEl.innerHTML = "";
  for (const { file, rank } of orientedSquares()) {
    const i = idx(file, rank);
    const sq = document.createElement("div");
    sq.className = "sq " + ((file + rank) % 2 === 1 ? "light" : "dark");
    if (selected === i) sq.classList.add("selected");
    if (legalTargets.includes(i)) sq.classList.add("target");
    if (hanging.includes(i)) sq.classList.add("hanging");
    if (lastMove && (lastMove.from === i || lastMove.to === i)) sq.classList.add("lastmove");

    if (rank === bottomRank) sq.appendChild(coord("file", FILES[file]));
    if (file === leftFile) sq.appendChild(coord("rank", String(rank + 1)));

    const c = s[i];
    if (c !== ".") {
      const span = document.createElement("span");
      span.className = "piece " + (isWhitePiece(c) ? "white" : "black");
      span.textContent = GLYPH[c.toLowerCase()];
      sq.appendChild(span);
    }
    sq.addEventListener("click", () => onSquareClick(i));
    boardEl.appendChild(sq);
  }
}

function coord(kind, text) {
  const c = document.createElement("span");
  c.className = "coord " + kind;
  c.textContent = text;
  return c;
}

function renderStatus() {
  levelEl.textContent = assistData ? assistData.level : "—";
  if (!state) return;
  if (state.status === "checkmate") statusEl.textContent = `Checkmate — ${state.turn === "white" ? "Black" : "White"} wins.`;
  else if (state.status === "stalemate") statusEl.textContent = "Stalemate — draw.";
  else if (state.status === "fifty-move") statusEl.textContent = "Draw — fifty-move rule.";
  else if (state.turn === myColor) statusEl.textContent = `Your move (you are ${myColor})` + (game.inCheck() ? " — check!" : "");
  else statusEl.textContent = `Waiting for ${state.turn} to move…`;
}

function renderAssist() {
  assistEl.innerHTML = "";
  if (!assistData) {
    assistEl.innerHTML = `<div class="none">Not your turn.</div>`;
    return;
  }
  const a = assistData;
  const add = (h) => assistEl.insertAdjacentHTML("beforeend", h);
  if (a.level === "off") add(`<div class="none">No assistance — you're the stronger side (or at parity).</div>`);
  if (a.inCheck) add(`<div class="warn">⚠ You are in check.</div>`);
  if (a.hanging.length) add(`<div class="warn">⚠ Hanging: ${a.hanging.map(sqName).join(", ")}</div>`);
  a.messages.forEach((m) => add(`<div class="msg">• ${escapeHtml(m)}</div>`));
  a.candidates.forEach((c) => {
    const rec = a.recommended && c.uci === a.recommended ? " rec" : "";
    const div = document.createElement("div");
    div.className = "cand" + rec;
    div.innerHTML = `<span>${c.uci}${rec ? " ➤" : ""}</span><span class="score">${fmtScore(c.score)}</span>`;
    div.addEventListener("click", () => sendMove(c.from, c.to));
    assistEl.appendChild(div);
  });
}

function renderGlass() {
  if (!glassList.length) {
    glassEl.innerHTML = `<div class="none">No assistance used yet.</div>`;
    return;
  }
  glassEl.innerHTML = glassList
    .map((e) => `<div class="ev"><span class="who">${e.side}</span> · ${escapeHtml(e.summary)}</div>`)
    .join("");
}

function onSquareClick(i) {
  if (!state || !game || state.status !== "ongoing" || state.turn !== myColor) return;
  const c = game.boardString()[i];
  const mine = (myColor === "white" && isWhitePiece(c)) || (myColor === "black" && c !== "." && !isWhitePiece(c));

  if (selected === null) {
    if (mine) selectSquare(i);
    return;
  }
  if (i === selected) return clearSelection();
  if (legalTargets.includes(i)) return sendMove(selected, i);
  if (mine) selectSquare(i);
  else clearSelection();
}

function selectSquare(i) {
  selected = i;
  legalTargets = Array.from(game.legalTo(i));
  renderBoard();
}
function clearSelection() {
  selected = null;
  legalTargets = [];
  renderBoard();
}

function sendMove(from, to) {
  let promo = "";
  if (game.isPromotion(from, to)) {
    const p = window.prompt("Promote to? (q, r, b, n)", "q");
    promo = p && "qrbn".includes(p.toLowerCase()) ? p.toLowerCase() : "q";
  }
  const uci = sqName(from) + sqName(to) + promo;
  ws.send(JSON.stringify({ t: "move", uci }));
  clearSelection(); // board updates when the server echoes the new state
}

// --- helpers ---------------------------------------------------------------

function summarize(a) {
  switch (a.level) {
    case "awareness": return `Awareness: ${a.hanging.length} hanging piece(s) highlighted.`;
    case "coaching": return `Coaching: ${a.messages.length} message(s) shown.`;
    case "suggestion": return `Suggestion: ${a.candidates.length} candidate move(s) shown.`;
    case "guided": return `Guided: recommended ${a.recommended ?? "-"}.`;
    case "autopilot": return `Autopilot: recommended ${a.recommended ?? "-"}.`;
    default: return "No assistance.";
  }
}

const sqName = (i) => `${FILES[i % 8]}${1 + Math.floor(i / 8)}`;

function uciToSquares(uci) {
  const s = (t) => t.charCodeAt(0) - 97 + (t.charCodeAt(1) - 49) * 8;
  return { from: s(uci.slice(0, 2)), to: s(uci.slice(2, 4)) };
}

function fmtScore(cp) {
  if (Math.abs(cp) >= 29000) return cp > 0 ? "#" : "-#";
  const s = (cp / 100).toFixed(1);
  return cp > 0 ? `+${s}` : s;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

main();
