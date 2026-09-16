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
const RUNGS = [
  [100, "Off", "an even match — no assistance"],
  [300, "Awareness", "safety signals — hanging pieces & checks"],
  [500, "Coaching", "threats and the opponent’s plan, explained"],
  [800, "Strategy", "a named strategy to follow"],
  [1200, "Guided", "a plan with progress + the move to play"],
  [Infinity, "Autopilot", "the co-pilot executes the plan"],
];
const tierFor = (gap) => { const g = Math.abs(gap); for (const r of RUNGS) if (g < r[0]) return r; return RUNGS[RUNGS.length - 1]; };

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
let pickedStrategyId = null;
let lastStratRelay = null;
let forceAssist = null; // testing: force an assist rung even when you're stronger
let gameMode = "match"; // "match" (declared handicap) | "casual" (free, both sides assisted)
let prevMyTurn = false, seenState = false, wasOver = false;
const baseTitle = "Glassboard — Online";
let lastMove = null;
let lastGlassFen = null;
let hostName = null;
let myName = null;

const idx = (file, rank) => rank * 8 + file;
const isWhitePiece = (c) => c !== "." && c === c.toUpperCase();
// On the deployed (https) site, default to the Fly server; locally, the LAN server.
const defaultServer = () =>
  location.protocol === "https:"
    ? "wss://playglassboard.onrender.com"
    : `ws://${location.hostname || "localhost"}:9001`;

// Stable per-DEVICE player id (localStorage): one browser = one player across
// tabs/reloads. Add ?test=1 to the URL for a per-tab id, to run two players in
// one browser. Must match the portal's playerId() so seating is consistent.
function playerId() {
  if (new URLSearchParams(location.search).get("test")) {
    let t = sessionStorage.getItem("gb_pid_test");
    if (!t) { t = "t" + Math.random().toString(36).slice(2, 10); sessionStorage.setItem("gb_pid_test", t); }
    return t;
  }
  let id = localStorage.getItem("gb_pid");
  if (!id) { id = "p" + Math.random().toString(36).slice(2, 10); localStorage.setItem("gb_pid", id); }
  return id;
}
// Name/rating are shared with the portal (localStorage); the id is per-tab.
function currentPlayer() {
  let m = null;
  try { m = JSON.parse(localStorage.getItem("gb_me")); } catch {}
  const name = (el("pname") && el("pname").value.trim()) || (m && m.name) || "Player";
  const rating = parseInt(el("elo").value, 10) || (m && m.rating) || 1200;
  localStorage.setItem("gb_me", JSON.stringify({ name, rating }));
  return { id: playerId(), name, rating };
}
// Level chips fill the rating input and trigger the handicap preview.
function setInput(id, v) { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event("input")); } }

async function main() {
  await init();
  // Allow a shareable link to pre-fill the server + room, e.g.
  //   multiplayer.html?server=wss://xxx.trycloudflare.com&room=test
  const params = new URLSearchParams(location.search);
  serverEl.value = params.get("server") || defaultServer();
  if (params.get("room")) roomEl.value = params.get("room");
  if (params.get("elo")) eloEl.value = params.get("elo");

  const host = params.get("host") ? decodeURIComponent(params.get("host")) : null;
  const he = params.get("he") ? parseInt(params.get("he"), 10) : null;
  const mine = params.get("mine");
  hostName = host;
  const isJoiner = host && !mine;
  gameMode = params.get("mode") === "casual" ? "casual" : "match";
  const casual = gameMode === "casual";
  const set = (id, txt) => { const e = el(id); if (e) e.textContent = txt; };
  const joinBtn = el("connect");

  // Prefill your name from the saved identity (portal users have one).
  const pn = el("pname");
  if (pn) { try { const m = JSON.parse(localStorage.getItem("gb_me")); if (m && m.name) pn.value = m.name; } catch {} }

  // Send new players to onboarding, then back to THIS game (not the portal),
  // with their name + score filled in.
  const learnLink = el("learnLink");
  if (learnLink) learnLink.href = "./learn.html?next=" + encodeURIComponent(location.href);

  // Testing toggle: force assistance on even for the stronger side, so we can
  // experience the strategy UX from either seat. Transparent — still glass-boxed.
  const forceLevel = params.get("assist") || "guided";
  const fc = el("forceAssist");
  if (fc) {
    if (params.get("assist")) { fc.checked = true; forceAssist = forceLevel; }
    fc.addEventListener("change", () => {
      forceAssist = fc.checked ? forceLevel : null;
      computeAssist();
      paint();
    });
  }

  const rb = el("resignBtn");
  if (rb) rb.addEventListener("click", resign);

  const nb = el("notifyBtn");
  if (nb) {
    updateNotifyBtn();
    nb.addEventListener("click", () => {
      if (window.Notification) Notification.requestPermission().then(() => updateNotifyBtn());
    });
  }

  const rmb = el("rematchBtn");
  if (rmb) rmb.addEventListener("click", doRematch);
  const orm = el("overRematch"); if (orm) orm.addEventListener("click", doRematch);
  const ocl = el("overClose"); if (ocl) ocl.addEventListener("click", () => { const ov = document.getElementById("overOverlay"); if (ov) ov.style.display = "none"; });

  if (mine) {
    set("mcEyebrow", "Your game");
    set("mcTitle", "Waiting for your opponent");
    set("mcSub", `Room “${roomEl.value}”. Join to enter as White, then share your invite link — whoever opens it joins as Black.`);
    const intro = el("mcIntro"); if (intro) intro.style.display = "none";
  } else if (host && casual) {
    set("mcEyebrow", "Casual game");
    set("mcTitle", `Play ${host}`);
    set("mcSub", `Casual — both of you get unlimited assistance (always shown to each other), no ratings. Just enter your name and join.`);
    // No rating needed in casual — hide the rating field + level chips.
    const ef = el("elo") && el("elo").closest(".mc-field"); if (ef) ef.style.display = "none";
    const chips = document.querySelector("#matchCard .lvl-chips"); if (chips) chips.style.display = "none";
  } else if (host) {
    set("mcEyebrow", "You’re invited");
    set("mcTitle", `Play ${host}`);
    set("mcSub", he
      ? `${host} is rated ${he}. Read how it works, then enter your own rating to join — you’ll play Black.`
      : `Read how it works, then enter your own rating to join — you’ll play Black.`);
  } else if (roomEl.value) {
    // Re-entering a game we're already in (opened from the lobby).
    set("mcEyebrow", "Your game");
    set("mcTitle", "Resume game");
    set("mcSub", `Room “${roomEl.value}”. Click Join to reconnect and continue.`);
    const intro = el("mcIntro"); if (intro) intro.style.display = "none";
  }

  // The joiner sets their own score. If they've done onboarding/portal, it's
  // known — prefill it (returning from "Find your level" lands ready to join).
  // Otherwise start empty; Join stays disabled until they enter a valid rating.
  if (isJoiner) {
    let saved = null;
    try { const m = JSON.parse(localStorage.getItem("gb_me")); if (m && m.rating) saved = m.rating; } catch {}
    if (saved) { eloEl.value = saved; }
    else { eloEl.value = ""; eloEl.placeholder = "your rating, e.g. 1400"; }
  }

  const refreshJoin = () => {
    const nameOk = !isJoiner || !!(el("pname") && el("pname").value.trim());
    const v = parseInt(eloEl.value, 10);
    const ratingOk = casual || !isJoiner || (v >= 100 && v <= 3200);
    const ok = nameOk && ratingOk;
    joinBtn.disabled = !ok;
    joinBtn.style.opacity = ok ? "" : "0.5";
    joinBtn.style.cursor = ok ? "" : "not-allowed";
    // Make the disabled state explain itself instead of a dead grey button.
    joinBtn.textContent = ok ? "Join game"
      : !nameOk ? "Enter your name to join ↑"
      : "Enter your rating to join ↑";
  };
  const updateHandi = () => {
    refreshJoin();
    const h = el("mcHandi"); if (!h) return;
    if (casual) { h.innerHTML = `<b style="color:#7ee0d6">Casual</b> — both players get the full assistance spectrum, always shown to each other. No ratings.`; return; }
    if (mine) { h.innerHTML = `<span style="color:#7f92ab">The handicap is set once your opponent joins and enters their rating.</span>`; return; }
    if (he == null) { h.textContent = ""; return; }
    const v = parseInt(eloEl.value, 10);
    if (!(v >= 100)) { h.innerHTML = `<span style="color:#7f92ab">Enter your rating to see the matchup and your assistance.</span>`; return; }
    const [, name, desc] = tierFor(he - v);
    const gap = Math.abs(he - v);
    const scores = `<b>You ${v}</b> vs <b>${host} ${he}</b>`;
    if (name === "Off") {
      h.innerHTML = `${scores} · <b>even match</b> — no assistance for either side.`;
    } else if (v < he) {
      h.innerHTML = `${scores} · gap ${gap} → you get <b style="color:#e0be79">${name}</b>: ${desc}. <span style="color:#7f92ab">Shown to ${host} too.</span>`;
    } else {
      h.innerHTML = `${scores} · gap ${gap} → <b>${host}</b> gets <b style="color:#e0be79">${name}</b>: ${desc}. You play unassisted.`;
    }
  };
  updateHandi();
  eloEl.addEventListener("input", updateHandi);
  if (el("pname")) el("pname").addEventListener("input", refreshJoin);

  // Opened from the lobby (host resuming their game, or a game we already
  // joined) → jump straight onto the board; no Join button dance needed.
  if (mine || (!host && roomEl.value)) {
    connect();
  }

  joinBtn.addEventListener("click", connect);
  renderBoardEmpty();
}

function connect() {
  if (ws) ws.close();
  const url = serverEl.value.trim() || defaultServer();
  ws = new WebSocket(url);
  ws.onopen = () => {
    const p = currentPlayer();
    myName = p.name;
    ws.send(JSON.stringify({ t: "join", room: roomEl.value.trim() || "test", elo: p.rating, pid: p.id, name: p.name }));
    statusEl.textContent = "Connected — joining room…";
  };
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onclose = () => (statusEl.textContent = "Disconnected.");
  ws.onerror = () =>
    (statusEl.textContent = "Connection error — is the server running, and is the address right?");
}

function onMessage(msg) {
  switch (msg.t) {
    case "joined": {
      myColor = msg.color;
      game = Game.fromFen(msg.fen);
      const mc = document.getElementById("matchCard");
      if (mc) mc.style.display = "none"; // context card done its job — focus the board
      statusEl.textContent = `Joined as ${myColor}. Waiting for the other player…`;
      renderBoard();
      break;
    }
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

  // Notify when the opponent's move makes it our turn (not on the initial join).
  const myTurn = msg.status === "ongoing" && msg.turn === myColor;
  if (seenState && myTurn && !prevMyTurn) onMyTurn();
  if (!myTurn) document.title = baseTitle;
  prevMyTurn = myTurn;
  seenState = true;

  // Game-over screen (once per ending; cleared on rematch).
  const rez = gameResult(msg);
  const nowOver = !!rez.reason;
  if (nowOver && !wasOver) showGameOver(rez);
  if (!nowOver) { const ov = document.getElementById("overOverlay"); if (ov) ov.style.display = "none"; }
  wasOver = nowOver;

  computeAssist();
  paint();
}

const oppLabel = () => (myColor === "white" ? state.black_name : state.white_name) || "Your opponent";
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = "sine"; o.frequency.value = 680;
    const t = audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.start(t); o.stop(t + 0.3);
  } catch {}
}
function onMyTurn() {
  document.title = "● Your move · Glassboard";
  if (document.hidden) {
    beep();
    if (window.Notification && Notification.permission === "granted") {
      try {
        new Notification("Your move — Glassboard", {
          body: `${oppLabel()} moved. It's your turn.`,
          tag: "gb-" + (roomEl.value || "game"),
          renotify: true,
        });
      } catch {}
    }
  }
}
// Clear the tab-title badge once the player is looking again.
window.addEventListener("focus", () => (document.title = baseTitle));
document.addEventListener("visibilitychange", () => { if (!document.hidden) document.title = baseTitle; });

function gameResult(msg) {
  let reason = msg.reason || "", winner = msg.winner || "";
  if (!reason && msg.status !== "ongoing") {
    if (msg.status === "checkmate") { reason = "checkmate"; winner = msg.turn === "white" ? "black" : "white"; }
    else if (msg.status === "stalemate") { reason = "stalemate"; winner = ""; }
    else if (msg.status === "fifty-move") { reason = "fifty-move rule"; winner = ""; }
  }
  return { reason, winner };
}
function showGameOver(rez) {
  const ov = document.getElementById("overOverlay");
  if (!ov) return;
  const draw = rez.winner === "", won = rez.winner === myColor;
  const res = el("overResult"), rea = el("overReason");
  if (res) { res.textContent = draw ? "Draw" : won ? "You win! 🎉" : "You lose"; res.className = "over-result " + (draw ? "draw" : won ? "win" : "loss"); }
  if (rea) rea.textContent = "by " + rez.reason;
  ov.style.display = "grid";
}
function doRematch() {
  if (!ws || ws.readyState !== 1) return;
  if (!confirm("Start a rematch — a fresh game with the same opponent?")) return;
  const ov = document.getElementById("overOverlay"); if (ov) ov.style.display = "none";
  ws.send(JSON.stringify({ t: "reset" }));
}

function updateNotifyBtn() {
  const nb = el("notifyBtn");
  if (!nb) return;
  if (!window.Notification) { nb.hidden = true; return; }
  const p = Notification.permission;
  nb.textContent = p === "granted" ? "🔔 On" : p === "denied" ? "🔕 Blocked" : "🔔 Notify";
  nb.disabled = p === "denied";
}

// Compute this side-to-move's assistance for the current position (honoring the
// testing override), and relay it to both glass-boxes once per position.
function computeAssist() {
  assistData = null;
  hanging = [];
  if (game && state && state.status === "ongoing" && state.turn === myColor) {
    // Casual: both sides get the full assistance spectrum. Else honor the
    // testing override, otherwise the rating-derived handicap.
    const isCasual = (state && state.mode === "casual") || gameMode === "casual";
    game.setAssistOverride(isCasual ? "guided" : (forceAssist || ""));
    assistData = JSON.parse(game.assist(DEPTH));
    hanging = assistData.hanging;
    if (assistData.level !== "off" && state.fen !== lastGlassFen) {
      ws.send(JSON.stringify({ t: "glass", summary: summarize(assistData) }));
      lastGlassFen = state.fen;
    }
  }
}

const myElo = () => (myColor === "white" ? state.white_elo : state.black_elo);
const oppElo = () => (myColor === "white" ? state.black_elo : state.white_elo);

// --- rendering -------------------------------------------------------------

function paint() {
  renderBoard();
  renderPlayers();
  renderStrategy();
  renderAssist();
  renderGlass();
  renderStatus();
}

function renderPlayers() {
  const el = document.getElementById("players");
  if (!el || !state || !myColor) return;
  el.hidden = false;
  const wName = state.white_name || (myColor === "white" ? (myName || "You") : (hostName || "White"));
  const bName = state.black_name || (myColor === "black" ? (myName || "You") : "Opponent");
  const w = { name: wName, elo: state.white_elo, color: "white" };
  const b = { name: bName, elo: state.black_elo, color: "black" };
  const you = myColor === "white" ? w : b;
  const opp = myColor === "white" ? b : w;
  const oppSeated = myColor === "white" ? !!state.black_name : !!state.white_name;
  const yourTurn = state.status === "ongoing" && state.turn === myColor;
  const turnHtml = state.status === "ongoing" ? `<span class="turn">${yourTurn ? "Your move" : "Their move"}</span>` : "";
  el.innerHTML =
    `<div class="pl"><span class="dot ${you.color}"></span> You · <b>${escapeHtml(you.name)}</b> <span class="tnum">${you.elo}</span></div>` +
    `<div class="vs">vs</div>` +
    (oppSeated
      ? `<div class="pl"><span class="dot ${opp.color}"></span> <b>${escapeHtml(opp.name)}</b> <span class="tnum">${opp.elo}</span></div>`
      : `<div class="pl"><span class="waiting-dot"></span> Waiting for opponent…</div>`) +
    turnHtml;
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
    if (legalTargets.includes(i)) { sq.classList.add("target"); if (s[i] !== ".") sq.classList.add("capture"); }
    if (hanging.includes(i)) sq.classList.add("hanging");
    if (lastMove && (lastMove.from === i || lastMove.to === i)) sq.classList.add("lastmove");

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
  levelEl.textContent = assistData ? assistData.level : "—";
  if (!state) return;

  // Outcome (server sends winner/reason; fall back to status for older servers).
  let reason = state.reason || "";
  let winner = state.winner || "";
  if (!reason && state.status !== "ongoing") {
    if (state.status === "checkmate") { reason = "checkmate"; winner = state.turn === "white" ? "black" : "white"; }
    else if (state.status === "stalemate") { reason = "stalemate"; winner = ""; }
    else if (state.status === "fifty-move") { reason = "fifty-move rule"; winner = ""; }
  }
  const over = reason !== "";

  const rb = el("resignBtn");
  if (rb) rb.hidden = !(myColor && state.status === "ongoing" && !over);
  const rmb = el("rematchBtn");
  if (rmb) rmb.hidden = !(myColor && over);

  if (over) {
    const draw = winner === "";
    const won = winner === myColor;
    const label = draw ? "Draw" : won ? "You win" : "You lose";
    const cls = draw ? "draw" : won ? "win" : "loss";
    statusEl.innerHTML = `<span class="result ${cls}">${label}</span> — by ${escapeHtml(reason)}. ` +
      `<a href="./portal.html" style="color:var(--accent)">Back to lobby →</a>`;
    return;
  }
  if (state.turn === myColor) statusEl.textContent = `Your move (you are ${myColor})` + (game.inCheck() ? " — check!" : "");
  else statusEl.textContent = `Waiting for ${state.turn} to move…`;
}

function resign() {
  if (!ws || ws.readyState !== 1 || !myColor) return;
  if (!state || state.status !== "ongoing" || (state.reason && state.reason !== "")) return;
  if (!confirm("Resign this game? Your opponent will be recorded as the winner.")) return;
  ws.send(JSON.stringify({ t: "resign" }));
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
    const isRec = a.recommended && c.uci === a.recommended;
    const div = document.createElement("div");
    div.className = "cand" + (isRec ? " rec" : "");
    div.innerHTML =
      `<div class="cand-main"><span class="cand-move">${c.san || c.uci}${isRec ? " ➤" : ""}</span>` +
      (c.note ? `<div class="cand-note">${escapeHtml(c.note)}</div>` : "") +
      `</div><span class="score">${fmtScore(c.score)}</span>`;
    div.addEventListener("click", () => sendMove(c.from, c.to));
    assistEl.appendChild(div);
  });
}

// --- strategy layer ---------------------------------------------------------
const STRAT_ICON = { win_material: "⚔", develop: "♞", center: "▦", attack_king: "⚔", simplify: "♟", passer: "⏫", iso_attack: "◎", open_file: "▤", pawn_storm: "⛰", fianchetto: "◹" };
const STRAT_COLOR = { win_material: "#f2707e", develop: "#5cc9ec", center: "#7ee0d6", attack_king: "#f2707e", simplify: "#e0be79", passer: "#5cc9ec", iso_attack: "#f2707e", open_file: "#7ee0d6", pawn_storm: "#f2707e", fianchetto: "#e0be79" };
const PLAN_COLOR = { dev: "#5cc9ec", attack: "#f2707e", support: "#7ee0d6", castle: "#e0be79" };

// square index → centre in the 800×800 overlay, respecting board orientation.
function planCxy(sq) {
  const f = sq % 8, r = Math.floor(sq / 8);
  const col = myColor === "black" ? 7 - f : f;
  const row = myColor === "black" ? r : 7 - r;
  return { x: (col + 0.5) * 100, y: (row + 0.5) * 100 };
}
function planArrow(fromSq, toSq, color, i) {
  const A = planCxy(fromSq), B = planCxy(toSq);
  let dx = B.x - A.x, dy = B.y - A.y; const len = Math.hypot(dx, dy) || 1; const ux = dx / len, uy = dy / len;
  const sx = A.x + ux * 32, sy = A.y + uy * 32, tx = B.x - ux * 30, ty = B.y - uy * 30;
  const h = 30, w = 20, bx = tx - ux * h, by = ty - uy * h, px = -uy, py = ux;
  const d = (i * 0.12).toFixed(2);
  return `<g class="arrow" style="animation-delay:${d}s">` +
    `<line x1="${sx}" y1="${sy}" x2="${bx}" y2="${by}" stroke="${color}" stroke-width="14" stroke-linecap="round" opacity="0.92"/>` +
    `<polygon points="${tx},${ty} ${bx + px * w},${by + py * w} ${bx - px * w},${by - py * w}" fill="${color}"/></g>`;
}
function drawPlan(strat) {
  const ov = document.getElementById("planOverlay");
  if (!ov) return;
  if (!strat) { ov.innerHTML = ""; return; }
  const ringColor = PLAN_COLOR[(strat.arrows[0] || {}).kind] || "#e0be79";
  let s = "";
  (strat.rings || []).forEach((sq, i) => {
    const C = planCxy(sq);
    s += `<circle class="ring" cx="${C.x}" cy="${C.y}" r="44" fill="none" stroke="${ringColor}" stroke-width="6" opacity="0.75" style="animation-delay:${(i * 0.1).toFixed(2)}s"/>`;
  });
  (strat.arrows || []).forEach((a, i) => { s += planArrow(a.from, a.to, PLAN_COLOR[a.kind] || "#5cc9ec", i); });
  ov.innerHTML = s;
}

function renderStrategy() {
  const panel = document.getElementById("stratPanel");
  const host = document.getElementById("strategy");
  if (!panel || !host) return;
  const sr = assistData && assistData.strategy;
  if (!sr || !sr.strategies || !sr.strategies.length) {
    panel.hidden = true; host.innerHTML = ""; drawPlan(null); return;
  }
  panel.hidden = false;
  document.getElementById("stratPhase").textContent = sr.phase;
  host.innerHTML = "";
  if (sr.opponent) {
    const o = document.createElement("div"); o.className = "opp-read";
    o.innerHTML = `<span>👁</span><span>${escapeHtml(sr.opponent)}</span>`;
    host.appendChild(o);
  }
  if (pickedStrategyId && !sr.strategies.some((s) => s.id === pickedStrategyId)) pickedStrategyId = null;
  sr.strategies.forEach((s) => {
    const card = document.createElement("div");
    card.className = "scard" + (s.id === pickedStrategyId ? " on" : "");
    card.style.setProperty("--sc", STRAT_COLOR[s.id] || "#5cc9ec");
    card.innerHTML = `<span class="sic">${STRAT_ICON[s.id] || "◆"}</span>` +
      `<div><div class="sname">${escapeHtml(s.name)}</div><div class="sidea">${escapeHtml(s.idea)}</div></div>`;
    card.addEventListener("click", () => pickStrategy(s.id));
    host.appendChild(card);
  });
  const picked = sr.strategies.find((s) => s.id === pickedStrategyId);
  if (picked) {
    const d = document.createElement("div"); d.className = "sdetail"; d.style.setProperty("--sc", STRAT_COLOR[picked.id] || "#5cc9ec");
    const steps = picked.steps.map((st) => `<div class="step ${st.done ? "done" : ""}"><span class="sd">${st.done ? "✓" : "•"}</span><span>${escapeHtml(st.text)}</span></div>`).join("");
    d.innerHTML = `<div class="steps">${steps}</div>` +
      `<div class="snext">Next — <b>your move</b><span class="smove" title="Click to play">${escapeHtml(picked.moveSan || picked.moveUci)}</span>${escapeHtml(picked.moveNote)}</div>` +
      `<div class="glassmini">🔍 This plan is shown to your opponent too.</div>`;
    host.appendChild(d);
    const mv = d.querySelector(".smove");
    if (mv) { mv.style.cursor = "pointer"; mv.addEventListener("click", () => { const q = uciToSquares(picked.moveUci); if (q) sendMove(q.from, q.to); }); }
    drawPlan(picked);
  } else {
    drawPlan(null);
    const hint = document.createElement("div"); hint.className = "shint"; hint.textContent = "Pick a plan to see it on the board.";
    host.appendChild(hint);
  }
}
function pickStrategy(id) {
  pickedStrategyId = id;
  renderStrategy();
  const sr = assistData && assistData.strategy;
  const s = sr && sr.strategies.find((x) => x.id === id);
  if (s && ws && ws.readyState === 1) {
    const key = state.fen + "|" + id;
    if (lastStratRelay !== key) {
      ws.send(JSON.stringify({ t: "glass", summary: "📋 Plan: " + s.name }));
      lastStratRelay = key;
    }
  }
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
  if (game.isPromotion(from, to)) { showPromotion(from, to); return; }
  finishMove(from, to, "");
}
function finishMove(from, to, promo) {
  const uci = sqName(from) + sqName(to) + promo;
  ws.send(JSON.stringify({ t: "move", uci }));
  clearSelection(); // board updates when the server echoes the new state
}
// Inline promotion picker (no ugly window.prompt).
function showPromotion(from, to) {
  const ov = document.getElementById("promoOverlay");
  if (!ov) { finishMove(from, to, "q"); return; }
  const white = myColor === "white";
  const choices = ov.querySelector(".promo-choices");
  choices.innerHTML = ["q", "r", "b", "n"].map((p) => {
    const glyph = typeof pieceSVG === "function" ? pieceSVG(white ? p.toUpperCase() : p) : p.toUpperCase();
    return `<button class="promo-pick" data-p="${p}"><span class="piece ${white ? "white" : "black"}">${glyph}</span></button>`;
  }).join("");
  choices.querySelectorAll(".promo-pick").forEach((b) => {
    b.onclick = () => { ov.style.display = "none"; finishMove(from, to, b.dataset.p); };
  });
  ov.style.display = "grid";
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
