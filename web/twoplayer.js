// Glassboard 2-player test shell. Two same-origin browser windows sync through
// BroadcastChannel (no server): one picks White, the other Black. The weaker
// side (by Elo) is assisted; the stronger plays unassisted; the glass-box is
// shared and identical in both windows. State is authoritative as a move list
// that each window replays into its own WASM engine.

import init, { Game } from "./pkg/glassboard_wasm.js";

// ︎ forces text-style (not emoji) glyphs so colors render on mobile.
const GLYPH = { p: "♟︎", n: "♞︎", b: "♝︎", r: "♜︎", q: "♛︎", k: "♚︎" };
const FILES = "abcdefgh";

const el = (id) => document.getElementById(id);
const boardEl = el("board");
const statusEl = el("status");
const assistEl = el("assist");
const glassEl = el("glass");
const levelEl = el("level");
const depthEl = el("depth");
const whiteEloEl = el("whiteElo");
const blackEloEl = el("blackElo");

const channel = new BroadcastChannel("glassboard-2p");

// Shared, authoritative state (last-writer-wins by version).
let state = { version: 0, moves: [], whiteElo: 1200, blackElo: 1600, glass: [] };

// Local view state.
let role = null; // 'white' | 'black'
let game;
let selected = null;
let legalTargets = [];
let hanging = [];
let assistData = null;

const depth = () => parseInt(depthEl.value, 10);
const idx = (file, rank) => rank * 8 + file;
const isWhitePiece = (c) => c !== "." && c === c.toUpperCase();

async function main() {
  await init();
  game = new Game();

  el("pickWhite").addEventListener("click", () => pickRole("white"));
  el("pickBlack").addEventListener("click", () => pickRole("black"));
  el("new").addEventListener("click", newGame);
  const psheet = el("pieceSheet"), pclose = el("pieceSheetClose");
  if (pclose && psheet) pclose.addEventListener("click", () => { psheet.style.display = "none"; });
  if (psheet) psheet.addEventListener("click", (e) => { if (e.target === psheet) psheet.style.display = "none"; });

  channel.onmessage = onMessage;
  channel.postMessage({ type: "request" }); // ask peers for current state

  rebuild();
  render();
}

// --- networking ------------------------------------------------------------

function broadcast() {
  channel.postMessage({ type: "state", state });
}

function onMessage(ev) {
  const msg = ev.data;
  if (msg.type === "request") {
    broadcast(); // share our state with a newly-opened window
  } else if (msg.type === "state" && msg.state.version >= state.version) {
    state = msg.state;
    rebuild();
    render();
  }
}

// --- game state ------------------------------------------------------------

// Rebuild the local engine by replaying the authoritative move list.
function rebuild() {
  game = new Game();
  for (const m of state.moves) game.makeMove(m.from, m.to, m.promo);
  selected = null;
  legalTargets = [];

  const side = game.sideToMove();
  assistData = null;
  hanging = [];
  if (role && side === role && game.status() === "ongoing") {
    const myElo = role === "white" ? state.whiteElo : state.blackElo;
    const oppElo = role === "white" ? state.blackElo : state.whiteElo;
    game.setRatings(myElo, oppElo); // handicap = gap(opp - me), Off if I'm stronger
    assistData = JSON.parse(game.assist(depth()));
    hanging = assistData.hanging;
  }
}

function pickRole(r) {
  role = r;
  el("pickWhite").classList.toggle("active", r === "white");
  el("pickBlack").classList.toggle("active", r === "black");
  channel.postMessage({ type: "request" });
  rebuild();
  render();
}

function newGame() {
  state = {
    version: state.version + 1,
    moves: [],
    whiteElo: parseInt(whiteEloEl.value, 10),
    blackElo: parseInt(blackEloEl.value, 10),
    glass: [],
    resetId: state.version + 1, // force adoption even at equal versions
  };
  rebuild();
  render();
  broadcast();
}

function playMove(from, to) {
  if (!role || game.sideToMove() !== role || game.status() !== "ongoing") return;

  let promo;
  if (game.isPromotion(from, to)) {
    const p = window.prompt("Promote to? (q, r, b, n)", "q");
    promo = p && "qrbn".includes(p.toLowerCase()) ? p.toLowerCase() : "q";
  }
  if (!game.makeMove(from, to, promo)) return;

  // Log this turn's assistance to the shared glass-box (if any help was given).
  if (assistData && assistData.level !== "off") {
    state.glass.push({ ply: state.moves.length, side: role, summary: summarize(assistData) });
  }
  state.moves.push({ from, to, promo: promo ?? null });
  state.version += 1;

  rebuild();
  render();
  broadcast();
}

// --- rendering -------------------------------------------------------------

let lastTipSq = -2;
function render() {
  renderBoard();
  renderCaptured();
  renderAssist();
  renderGlass();
  renderStatus();
  if (selected !== lastTipSq) { renderPieceTip(selected); lastTipSq = selected; }
}

// Captured material as one tug-bar above the board, oriented to the chosen side.
function renderCaptured() {
  const el = document.getElementById("materialBar");
  if (el && window.renderMaterialBar) window.renderMaterialBar(el, game.boardString(), role !== "black");
}

// Learn the pieces as you play (shared behaviour with the other modes).
function renderPieceTip(sq) {
  const elp = document.getElementById("pieceTip");
  if (!elp || !game) return;
  const c = sq == null ? "" : (game.boardString()[sq] || "").toLowerCase();
  const info = c && window.PIECE_INFO && window.PIECE_INFO[c];
  if (!info) { elp.hidden = true; elp.innerHTML = ""; return; }
  elp.hidden = false;
  let seen = [];
  try { seen = (localStorage.getItem("gb_seen_pieces") || "").split(",").filter(Boolean); } catch {}
  const first = !seen.includes(c);
  if (first) {
    seen.push(c);
    try { localStorage.setItem("gb_seen_pieces", seen.join(",")); } catch {}
    elp.className = "piece-tip first";
    const diag = window.pieceMoveDiagram ? window.pieceMoveDiagram(c) : "";
    elp.innerHTML =
      `<div class="pt-head"><span class="pt-ic">${info.icon}</span> <b>${escapeHtml(info.name)}</b> <span class="pt-new">first time!</span></div>` +
      `<div class="pt-illus">${diag}<div class="pt-moves">${escapeHtml(info.moves)}</div></div>` +
      `<button class="pt-more" id="ptMore">Full tour of the ${escapeHtml(info.name.toLowerCase())} →</button>`;
  } else {
    elp.className = "piece-tip";
    elp.innerHTML = `<button class="pt-chip" id="ptMore">${info.icon} <b>${escapeHtml(info.name)}</b> — tap for tips ⓘ</button>`;
  }
  const more = document.getElementById("ptMore");
  if (more) more.onclick = () => openPieceSheet(c);
}
function openPieceSheet(c) {
  const info = window.PIECE_INFO && window.PIECE_INFO[c];
  if (!info) return;
  const title = document.getElementById("pieceSheetTitle");
  if (title) title.textContent = info.icon + " " + info.name;
  const body = document.getElementById("pieceSheetBody");
  const diag = window.pieceMoveDiagram ? window.pieceMoveDiagram(c) : "";
  if (body) body.innerHTML =
    `<div class="ps-illus"><div class="ps-diagram">${diag}</div>` +
      `<div class="ps-row hero"><span class="ps-lab">How it moves</span><p>${escapeHtml(info.moves)}</p></div></div>` +
    `<div class="ps-row"><span class="ps-lab">Its role</span><p>${escapeHtml(info.role)}</p></div>` +
    `<div class="ps-row"><span class="ps-lab">When it's strong</span><p>${escapeHtml(info.strong)}</p></div>` +
    `<div class="ps-row"><span class="ps-lab">Works well with</span><p>${escapeHtml(info.pairs)}</p></div>`;
  const sh = document.getElementById("pieceSheet");
  if (sh) sh.style.display = "grid";
}

function orientedSquares() {
  const out = [];
  if (role === "black") {
    for (let rank = 0; rank < 8; rank++) for (let file = 7; file >= 0; file--) out.push({ file, rank });
  } else {
    for (let rank = 7; rank >= 0; rank--) for (let file = 0; file < 8; file++) out.push({ file, rank });
  }
  return out;
}

function renderBoard() {
  const s = game.boardString();
  const last = state.moves.length ? state.moves[state.moves.length - 1] : null;
  const bottomRank = role === "black" ? 7 : 0;
  const leftFile = role === "black" ? 7 : 0;

  boardEl.innerHTML = "";
  for (const { file, rank } of orientedSquares()) {
    const i = idx(file, rank);
    const sq = document.createElement("div");
    sq.className = "sq " + ((file + rank) % 2 === 1 ? "light" : "dark");
    if (selected === i) sq.classList.add("selected");
    if (legalTargets.includes(i)) { sq.classList.add("target"); if (s[i] !== ".") sq.classList.add("capture"); }
    if (hanging.includes(i)) sq.classList.add("hanging");
    if (last && (last.from === i || last.to === i)) sq.classList.add("lastmove");

    if (rank === bottomRank) sq.appendChild(coord("file", FILES[file]));
    if (file === leftFile) sq.appendChild(coord("rank", String(rank + 1)));

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

function coord(kind, text) {
  const c = document.createElement("span");
  c.className = "coord " + kind;
  c.textContent = text;
  return c;
}

function renderStatus() {
  const st = game.status();
  const side = game.sideToMove();
  levelEl.textContent = assistData ? assistData.level : "—";

  if (!role) {
    statusEl.textContent = "Pick a side to play (open a second window for the other side).";
    return;
  }
  if (st === "checkmate") {
    statusEl.textContent = `Checkmate — ${side === "white" ? "Black" : "White"} wins.`;
  } else if (st === "stalemate") {
    statusEl.textContent = "Stalemate — draw.";
  } else if (st === "fifty-move") {
    statusEl.textContent = "Draw — fifty-move rule.";
  } else if (side === role) {
    statusEl.textContent = `Your move (you are ${role})` + (game.inCheck() ? " — check!" : "");
  } else {
    statusEl.textContent = `Waiting for ${side} to move…`;
  }
}

function renderAssist() {
  assistEl.innerHTML = "";
  if (!role) {
    assistEl.innerHTML = `<div class="none">Pick a side to see your assistance.</div>`;
    return;
  }
  if (!assistData) {
    assistEl.innerHTML = `<div class="none">Not your turn — waiting for your opponent.</div>`;
    return;
  }
  const a = assistData;
  const add = (h) => assistEl.insertAdjacentHTML("beforeend", h);

  if (a.level === "off") add(`<div class="none">No assistance — you are the stronger side (or at parity).</div>`);
  if (a.inCheck) add(`<div class="warn">⚠ You are in check.</div>`);
  if (a.hanging.length) add(`<div class="warn">⚠ Hanging: ${a.hanging.map(sqName).join(", ")}</div>`);
  a.messages.forEach((m) => add(`<div class="msg">• ${escapeHtml(m)}</div>`));

  a.candidates.forEach((c) => {
    const rec = a.recommended && c.uci === a.recommended ? " rec" : "";
    const div = document.createElement("div");
    div.className = "cand" + rec;
    div.innerHTML = `<span>${c.uci}${rec ? " ➤" : ""}</span><span class="score">${fmtScore(c.score)}</span>`;
    div.addEventListener("click", () => playMove(c.from, c.to));
    assistEl.appendChild(div);
  });
}

function renderGlass() {
  if (!state.glass.length) {
    glassEl.innerHTML = `<div class="none">No assistance used yet.</div>`;
    return;
  }
  glassEl.innerHTML = state.glass
    .map((e) => `<div class="ev"><span class="who">${e.side}</span> · ${escapeHtml(e.summary)}</div>`)
    .join("");
}

function onSquareClick(i) {
  if (!role || game.sideToMove() !== role || game.status() !== "ongoing") return;
  const c = game.boardString()[i];
  if (selected === null) {
    if ((role === "white" && isWhitePiece(c)) || (role === "black" && c !== "." && !isWhitePiece(c))) {
      selected = i;
      legalTargets = Array.from(game.legalTo(i));
      render();
    }
    return;
  }
  if (i === selected) {
    selected = null;
    legalTargets = [];
    render();
    return;
  }
  if (legalTargets.includes(i)) {
    playMove(selected, i);
    return;
  }
  const mine = (role === "white" && isWhitePiece(c)) || (role === "black" && c !== "." && !isWhitePiece(c));
  if (mine) {
    selected = i;
    legalTargets = Array.from(game.legalTo(i));
  } else {
    selected = null;
    legalTargets = [];
  }
  render();
}

// --- helpers ---------------------------------------------------------------

function summarize(a) {
  switch (a.level) {
    case "awareness":
      return `Awareness: ${a.hanging.length} hanging piece(s) highlighted.`;
    case "coaching":
      return `Coaching: ${a.messages.length} message(s) shown.`;
    case "suggestion":
      return `Suggestion: ${a.candidates.length} candidate move(s) shown.`;
    case "guided":
      return `Guided: recommended ${a.recommended ?? "-"}.`;
    case "autopilot":
      return `Autopilot: recommended ${a.recommended ?? "-"}.`;
    default:
      return "No assistance.";
  }
}

const sqName = (i) => `${FILES[i % 8]}${1 + Math.floor(i / 8)}`;

function fmtScore(cp) {
  if (Math.abs(cp) >= 29000) return cp > 0 ? "#" : "-#";
  const s = (cp / 100).toFixed(1);
  return cp > 0 ? `+${s}` : s;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

main();
