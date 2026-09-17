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

// Public assistance vocabulary — a recognizable ladder ("I was on Guide") over
// the engine's internal rung ids. Order of help: Off < Hint < Coach < Guide <
// Assist < Autopilot.
const LEVEL_LABEL = { off: "Off", awareness: "Hint", coaching: "Coach", suggestion: "Guide", guided: "Assist", autopilot: "Autopilot" };
const LEVEL_DESC = { off: "No assistance", awareness: "Highlights threats & free material", coaching: "Explains threats in words", suggestion: "Suggests candidate moves", guided: "Shows the single best move", autopilot: "Can play the move for you" };
const levelLabel = (l) => LEVEL_LABEL[l] || "—";
function setLevelPill(l) { if (levelEl) { levelEl.textContent = levelLabel(l); levelEl.title = LEVEL_DESC[l] || ""; } }
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
let freeCaptures = [];
let lastStratSig = ""; // signature of strategies last seen while the fold was open
let curStratSig = "";
// Agency budget (soft): the free safety net (threats/glow) is always on; seeing
// deeper help spends from a per-game pool. No cutoff — spend is a self-improvement
// score, logged and summarized at game end. Costs: suggestions 2, best move 4.
const BUDGET_TOTAL = 40;
let budgetSpent = 0;
let revealedSugg = false; // did we reveal the candidate list this position?
let revealedBest = false; // did we reveal the single best move this position?
let helpWasAvailable = false; // was move-level help on the table at all this game?
const COST_SUGG = 2, COST_BEST = 4;
// First Game Mode: a learn-by-playing layer for a total beginner. Guides the
// first couple of moves (pulse a piece → show its squares → tap), then fades.
let firstGame = false, fgStep = 0, fgHintSquares = [];
const FG = [
  { ic: "👋", text: "Welcome! You'll learn chess just by playing. You're <b>White</b> — your pieces are along the bottom, and you move first.", cta: "Show me →" },
  { ic: "👆", text: "Tap one of the <b>glowing</b> pieces to pick it up.", hint: "curated" },
  { ic: "✨", text: "The <b>dots</b> show every square that piece can move to. Tap a dot to move there." },
  { ic: "🤝", text: "Nice — that's a move! Your opponent (the computer) takes its turn now…" },
  { ic: "♟", text: "Your turn again. Same idea: <b>tap a piece, then a dot</b>. If a piece is in danger, the coach under the board warns you." },
  { ic: "🎉", text: "You've got it! Keep playing — help is always under the board. Have fun!", cta: "Play on", final: true },
];
let lastMove = null; // { from, to } of the most recent move
let assistData = null; // parsed assist JSON for the current (White) turn
let busy = false;
let resigned = false;

const depth = () => parseInt(depthEl.value, 10);
const idx = (file, rank) => rank * 8 + file;
const isWhitePiece = (c) => c !== "." && c === c.toUpperCase();

// A total beginner's first visit (or ?first=1) starts in First Game Mode.
function detectFirstGame() {
  const forced = new URLSearchParams(location.search).get("first");
  firstGame = forced ? forced !== "0" : !localStorage.getItem("gb_played");
  fgStep = 0;
}
function fgExit() {
  firstGame = false;
  fgHintSquares = [];
  try { localStorage.setItem("gb_played", "1"); } catch {}
  renderFirstGame();
  paint();
}
function fgGo(n) { fgStep = n; renderFirstGame(); paint(); }
function fgOn(trigger) {
  if (!firstGame) return;
  const s = fgStep;
  if (s === 1 && trigger === "select") fgGo(2);
  else if (s === 2 && trigger === "move") fgGo(3);
  else if (s === 3 && trigger === "engine") fgGo(4);
  else if (s === 4 && trigger === "move") fgGo(5);
}
function renderFirstGame() {
  const el = document.getElementById("firstGame");
  if (!el) return;
  if (!firstGame) { el.hidden = true; fgHintSquares = []; return; }
  const step = FG[fgStep] || FG[FG.length - 1];
  fgHintSquares = step.hint === "curated" ? [12, 11, 6, 1] : []; // e2 d2 g1 b1
  const dots = FG.map((_, i) => `<span class="fg-dot${i <= fgStep ? " on" : ""}"></span>`).join("");
  el.hidden = false;
  el.innerHTML =
    `<span class="fg-ic">${step.ic}</span>` +
    `<div class="fg-body"><div class="fg-text">${step.text}</div>` +
    `<div class="fg-row">` +
    (step.cta ? `<button class="fg-cta" id="fgCta">${step.cta}</button>` : "") +
    (step.final ? "" : `<button class="fg-skip" id="fgSkip">Skip — I know chess</button>`) +
    `<span class="fg-dots">${dots}</span></div></div>`;
  const cta = document.getElementById("fgCta");
  if (cta) cta.addEventListener("click", () => { if (step.final) fgExit(); else fgGo(fgStep + 1); });
  const skip = document.getElementById("fgSkip");
  if (skip) skip.addEventListener("click", fgExit);
}

async function main() {
  await init();
  detectFirstGame();
  document.getElementById("new").addEventListener("click", () => { firstGame = false; newGame(); });
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
  budgetSpent = 0;
  helpWasAvailable = false;
  animMoveKey = null;
  hideOver();
  setLevelPill(game.assistLevel());
  onPositionChanged();
}

// Spend from the agency budget when the player reveals deeper help.
function spend(n) { budgetSpent += n; renderBudget(); }
function renderBudget() {
  const el = document.getElementById("budget");
  if (!el) return;
  // Appear only once you've actually spent help — a bar sitting at 0/40 is just
  // noise. Then it's a glanceable tally for the rest of the game. (Also hidden
  // during the first game — a beginner shouldn't juggle a budget yet.)
  const on = assistData && !firstGame && budgetSpent > 0 && (assistData.candidates || []).length > 0;
  el.hidden = !on;
  if (!on) return;
  const pct = Math.min(100, Math.round((budgetSpent / BUDGET_TOTAL) * 100));
  el.classList.toggle("over", budgetSpent > BUDGET_TOTAL);
  el.innerHTML =
    `<span class="bg-lab">🪙 Help used</span>` +
    `<span class="bg-bar"><span class="bg-fill" style="width:${pct}%"></span></span>` +
    `<span class="bg-num">${budgetSpent} / ${BUDGET_TOTAL}</span>`;
}

// Called once whenever the position changes (after a move). Computes assistance
// for White's turn exactly once, then repaints everything.
function onPositionChanged() {
  hanging = [];
  freeCaptures = [];
  assistData = null;
  revealedSugg = false; // deeper help must be re-revealed (and re-paid) each position
  revealedBest = false;
  if (game.status() === "ongoing" && game.sideToMove() === "white") {
    assistData = JSON.parse(game.assist(depth())); // records to glass-box once
    hanging = assistData.hanging || [];
    freeCaptures = assistData.freeCaptures || [];
    if ((assistData.candidates || []).length) helpWasAvailable = true;
  }
  paint();
}

// Repaints board + panels from current state (no assistance recompute).
function paint() {
  renderFirstGame();
  renderBoard();
  renderPlayers();
  renderCoach();
  renderAssist();
  renderStrategy();
  renderGlass();
  renderStatus();
  renderBudget();
  showGameOverIfNeeded();
}

// The coach: one prominent, concrete piece of advice under the board. This is
// the primary assistance surface — the abstract strategy layer is secondary.
function pieceNameAt(sq) {
  const c = game.boardString()[sq] || "";
  return ({ p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" })[c.toLowerCase()] || "piece";
}
// The board itself is a status "bulb": an ambient glow that mirrors the coach.
function setBoardGlow(tone) {
  const bw = document.querySelector("main.game .board-wrap");
  if (!bw) return;
  bw.classList.remove("glow-danger", "glow-gold", "glow-calm");
  if (tone === "danger" || tone === "gold" || tone === "calm") bw.classList.add("glow-" + tone);
}
// The coach is a transient safety net: it speaks ONLY when there's real danger
// or a free opportunity. When you're safe, it says nothing (hidden) — no "you're
// safe" spam, no permanent card. Help is free; no reveal buttons.
function renderCoach() {
  const el = document.getElementById("coach");
  if (!el) return;
  const a = assistData;
  let tone = null, ic = "", head = "", sub = "";
  if (a && a.inCheck) {
    tone = "danger"; ic = "⚠"; head = "You're in check";
    sub = "Get your king out of check this move.";
  } else if (a && a.hanging && a.hanging.length) {
    tone = "danger"; ic = "⚠";
    const sq = a.hanging[0];
    head = `Your ${pieceNameAt(sq)} on ${sqName(sq)} can be taken`;
    sub = a.hanging.length > 1
      ? `${a.hanging.length} of your pieces are undefended — move or protect them.`
      : "Defend it or move it to safety.";
  } else if (a && a.freeCaptures && a.freeCaptures.length) {
    tone = "gold"; ic = "★";
    const sq = a.freeCaptures[0];
    head = `Free piece: the ${pieceNameAt(sq)} on ${sqName(sq)}`;
    sub = "Your opponent left it undefended — you can take it.";
  }
  if (!tone) { el.hidden = true; el.innerHTML = ""; setBoardGlow(null); return; } // quiet when safe
  el.hidden = false;
  el.className = "coach " + tone;
  el.innerHTML =
    `<span class="co-ic">${ic}</span>` +
    `<div class="co-body"><div class="co-head">${escapeHtml(head)}</div><div class="co-sub">${escapeHtml(sub)}</div></div>`;
  setBoardGlow(tone);
}

function updateSetupSum() {
  const el = document.getElementById("setupSum");
  if (el) el.textContent = `You ${humanEloEl.value} · Engine ${engineEloEl.value}`;
}
function renderPlayers() {
  updateSetupSum();
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
  rea.innerHTML = "by " + reason + agencySummaryHtml();
  ov.style.display = "grid";
}

// End-of-game agency read: how much help you leaned on, and the trend. The
// point of the whole system — needing less over time.
function agencySummaryHtml() {
  if (!helpWasAvailable) return "";
  const pct = Math.round((budgetSpent / BUDGET_TOTAL) * 100);
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem("gb_lasthelp")); } catch {}
  localStorage.setItem("gb_lasthelp", JSON.stringify(pct));
  let body;
  if (budgetSpent === 0) {
    body = "You played this one <b>entirely on your own</b> — no help spent. 🎉";
  } else {
    let trend = "";
    if (prev != null && isFinite(prev)) {
      const d = pct - prev;
      trend = d < 0 ? ` — down from ${prev}% last game 📉` : d > 0 ? ` — up from ${prev}% last game` : " — same as last game";
    }
    body = `You leaned on <b>${budgetSpent}</b> help points (<b>${pct}%</b> of budget)${trend}. The less you need, the more you've learned.`;
  }
  return `<div class="over-help">🪙 ${body}</div>`;
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
// Strategy is the headline assistance: a visible panel. Pick a plan → the
// step-by-step follows it (with progress) and its arrows draw on the board.
function renderStrategy() {
  const wrap = document.getElementById("stratPanelWrap");
  const host = document.getElementById("strategy");
  const sr = assistData && assistData.strategy;
  if (!sr || !sr.strategies || !sr.strategies.length) {
    if (wrap) wrap.hidden = true;
    if (host) host.innerHTML = "";
    drawPlan(null);
    return;
  }
  if (wrap) wrap.hidden = false;
  if (pickedStrategyId && !sr.strategies.some((s) => s.id === pickedStrategyId)) pickedStrategyId = null;
  const picked = sr.strategies.find((s) => s.id === pickedStrategyId);
  const phaseEl = document.getElementById("stratPhase");
  if (phaseEl) phaseEl.textContent = sr.phase;
  if (host) {
    host.innerHTML = "";
    if (sr.opponent) { const o = document.createElement("div"); o.className = "opp-read"; o.innerHTML = `<span>👁</span><span>${escapeHtml(sr.opponent)}</span>`; host.appendChild(o); }
    sr.strategies.forEach((s) => {
      const card = document.createElement("div");
      card.className = "scard" + (s.id === pickedStrategyId ? " on" : "");
      card.style.setProperty("--sc", STRAT_COLOR[s.id] || "#5cc9ec");
      card.innerHTML = `<span class="sic">${STRAT_ICON[s.id] || "◆"}</span><div><div class="sname">${escapeHtml(s.name)}</div><div class="sidea">${escapeHtml(s.idea)}</div></div>`;
      card.addEventListener("click", () => { pickedStrategyId = s.id; renderStrategy(); renderAssist(); });
      host.appendChild(card);
    });
    if (picked) {
      const d = document.createElement("div"); d.className = "sdetail"; d.style.setProperty("--sc", STRAT_COLOR[picked.id] || "#5cc9ec");
      const steps = picked.steps.map((st) => `<div class="step ${st.done ? "done" : ""}"><span class="sd">${st.done ? "✓" : "•"}</span><span>${escapeHtml(st.text)}</span></div>`).join("");
      d.innerHTML = `<div class="snext">Next — <b>your move</b><span class="smove" title="Click to play">${escapeHtml(picked.moveSan || picked.moveUci)}</span>${escapeHtml(picked.moveNote)}</div><div class="steps">${steps}</div>`;
      host.appendChild(d);
      const mv = d.querySelector(".smove");
      if (mv) { mv.style.cursor = "pointer"; mv.addEventListener("click", () => { const q = uciSquares(picked.moveUci); if (q) playMove(q.from, q.to); }); }
    } else {
      const hint = document.createElement("div"); hint.className = "shint"; hint.textContent = "Pick a plan to see it on the board.";
      host.appendChild(hint);
    }
  }
  drawPlan(picked || null); // arrows stay on the board even with the sheet closed
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
      if (freeCaptures.includes(i)) sq.classList.add("free");
      if (firstGame && fgHintSquares.includes(i)) sq.classList.add("hint");
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
  animateLastMove();
}

// Give the moving piece character: glide it from its old square to the new one
// with a lift-and-settle, instead of just appearing. Runs once per move (guarded
// so repaints — selection, etc. — don't re-animate). White is at the bottom.
let animMoveKey = null;
function animateLastMove() {
  if (!lastMove) return;
  const key = lastMove.from + "-" + lastMove.to;
  if (key === animMoveKey) return;
  animMoveKey = key;
  const rIdx = (sq) => (7 - Math.floor(sq / 8)) * 8 + (sq % 8); // square → rendered cell index
  const toEl = boardEl.children[rIdx(lastMove.to)];
  const piece = toEl && toEl.querySelector(".piece");
  if (!piece) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cell = toEl.getBoundingClientRect().width || 0;
  if (!cell) return;
  const dCol = (lastMove.from % 8) - (lastMove.to % 8);
  const dRow = (7 - Math.floor(lastMove.from / 8)) - (7 - Math.floor(lastMove.to / 8));
  piece.classList.add("moving");
  piece.style.transition = "none";
  piece.style.transform = `translate(${dCol * cell}px, ${dRow * cell}px)`;
  requestAnimationFrame(() => {
    piece.style.transition = "transform .26s cubic-bezier(.34,1.4,.5,1)";
    piece.style.transform = "translate(0, 0)";
    setTimeout(() => piece.classList.remove("moving"), 280);
  });
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
  setLevelPill(game.assistLevel());
}

function renderAssist() {
  assistEl.innerHTML = "";
  if (!assistData) {
    assistEl.innerHTML = `<div class="none">Engine to move — no suggestions this turn.</div>`;
    return;
  }
  const a = assistData;
  // If a strategy is picked, surface its move at the top of the list so the
  // plan and the concrete move live in one place.
  const sr = a.strategy;
  const picked = sr && sr.strategies && sr.strategies.find((s) => s.id === pickedStrategyId);
  if (picked && picked.moveUci) {
    const q = uciSquares(picked.moveUci);
    const sm = document.createElement("div");
    sm.className = "cand strat-move";
    sm.style.setProperty("--sc", STRAT_COLOR[picked.id] || "#5cc9ec");
    sm.innerHTML =
      `<div class="cand-main"><span class="cand-tag">${STRAT_ICON[picked.id] || "◆"} ${escapeHtml(picked.name)}</span>` +
      `<span class="cand-move">${escapeHtml(picked.moveSan || picked.moveUci)}</span>` +
      (picked.moveNote ? `<div class="cand-note">${escapeHtml(picked.moveNote)}</div>` : "") +
      `</div><span class="score">plan</span>`;
    if (q) sm.addEventListener("click", () => playMove(q.from, q.to));
    assistEl.appendChild(sm);
  }
  // Move-by-move help is free here (vs AI / casual). It's collapsed by default
  // under "Suggested moves" — secondary to the strategy.
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
  if (!assistEl.innerHTML) {
    assistEl.innerHTML = `<div class="none">No move suggestions at this level — the coach still flags threats above.</div>`;
  }
}

// The glass-box is a compact, glanceable trace (a row of pips + count in the
// game bar) that pulses when help happens; the full ledger opens on demand.
let lastGlassCount = 0;
function renderGlass() {
  const events = JSON.parse(game.glassbox());
  if (glassEl) {
    glassEl.innerHTML = events.length
      ? events.map((e) => `<div class="ev"><span class="who">${e.side}</span> · ${escapeHtml(e.summary)}</div>`).join("")
      : `<div class="none">No assistance used yet.</div>`;
  }
  const chip = document.getElementById("glassChip");
  if (!chip) return;
  chip.hidden = events.length === 0;
  if (!events.length) { lastGlassCount = 0; return; }
  const pipsEl = chip.querySelector(".gpips");
  if (pipsEl) pipsEl.innerHTML = events.slice(-6).map((e) => `<span class="gpip ${e.side}"></span>`).join("");
  const countEl = document.getElementById("glassCount");
  if (countEl) countEl.textContent = events.length;
  if (events.length !== lastGlassCount) {
    if (lastGlassCount > 0) { chip.classList.remove("pulse"); void chip.offsetWidth; chip.classList.add("pulse"); }
    lastGlassCount = events.length;
  }
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
  fgOn("select");
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
  fgOn("move");
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
    fgOn("engine");
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
