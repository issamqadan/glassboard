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
  [300, "Hint", "safety signals — hanging pieces & checks"],
  [500, "Coach", "threats and the opponent’s plan, explained"],
  [800, "Guide", "candidate moves + a named strategy to follow"],
  [1200, "Assist", "the single best move to play, every turn"],
  [Infinity, "Autopilot", "the co-pilot executes the plan"],
];
const tierFor = (gap) => { const g = Math.abs(gap); for (const r of RUNGS) if (g < r[0]) return r; return RUNGS[RUNGS.length - 1]; };

const el = (id) => document.getElementById(id);
const boardEl = el("board");
const statusEl = el("status");
const assistEl = el("assist");
const glassEl = el("glass");
const levelEl = el("level");

// Public assistance vocabulary — a recognizable ladder ("I was on Guide") over
// the engine's internal rung ids. Order of help: Off < Hint < Coach < Guide <
// Assist < Autopilot.
const LEVEL_LABEL = { off: "Off", awareness: "Hint", coaching: "Coach", suggestion: "Guide", guided: "Assist", autopilot: "Autopilot" };
const LEVEL_DESC = { off: "No assistance", awareness: "Highlights threats & free material", coaching: "Explains threats in words", suggestion: "Suggests candidate moves", guided: "Shows the single best move", autopilot: "Can play the move for you" };
const levelLabel = (l) => LEVEL_LABEL[l] || "—";
const serverEl = el("server");
const roomEl = el("room");
const eloEl = el("elo");

let ws = null;
let myColor = null;
let sim = false; // same-screen practice: play both sides locally to test the UI
const orient = () => (sim ? "white" : myColor); // board orientation (fixed white-bottom in sim)
let game = null;
let state = null;
let glassList = [];
let selected = null;
let legalTargets = [];
let hanging = [];
let threats = [];        // value-aware [{sq,kind,loss}], biggest loss first
let threatSquares = [];
let freeCaptures = [];
let assistData = null;
let lastStratSig = ""; // signature of strategies last seen while the fold was open
let curStratSig = "";
// Agency budget (soft) — Match mode only; Casual keeps help unlimited. Free
// safety net (threats/glow) always on; seeing deeper help spends from a pool.
const BUDGET_TOTAL = 40, COST_SUGG = 2, COST_BEST = 4;
let budgetSpent = 0;
let revealedSugg = false, revealedBest = false, helpWasAvailable = false;
let lastRevealFen = "";
const casualMode = () => (state && state.mode === "casual") || gameMode === "casual";
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
  // Test mode (solo multiplayer testing): use a throwaway identity and NEVER
  // write gb_me — localStorage is shared with the host tab, so overwriting it
  // would corrupt the real player's identity.
  if (new URLSearchParams(location.search).get("test")) {
    const name = (el("pname") && el("pname").value.trim()) || "Tester";
    const rating = parseInt(el("elo").value, 10) || 900;
    return { id: playerId(), name, rating };
  }
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
  const params = new URLSearchParams(location.search);
  // Same-screen practice: play both sides locally to test the full experience.
  if (params.get("sim")) { startSim(); return; }
  // Allow a shareable link to pre-fill the server + room, e.g.
  //   multiplayer.html?server=wss://xxx.trycloudflare.com&room=test
  serverEl.value = params.get("server") || defaultServer();
  if (params.get("room")) roomEl.value = params.get("room");
  if (params.get("elo")) eloEl.value = params.get("elo");

  const host = params.get("host") ? decodeURIComponent(params.get("host")) : null;
  const he = params.get("he") ? parseInt(params.get("he"), 10) : null;
  const mine = params.get("mine");
  const isTest = params.get("test");
  hostName = host;
  if (isTest) {
    const b = document.createElement("div");
    b.textContent = "🧪 Test opponent — throwaway player";
    b.style.cssText = "position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:70;" +
      "background:rgba(224,190,121,.16);border:1px solid rgba(224,190,121,.5);color:#e0be79;" +
      "padding:4px 13px;border-radius:999px;font-size:0.74rem;font-weight:640;white-space:nowrap;";
    document.body.appendChild(b);
  }
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

  // The big "New to chess?" card — only for invited players (where beginners land).
  const newHere = el("newHere");
  if (newHere) {
    if (isJoiner) newHere.href = "./learn.html?next=" + encodeURIComponent(location.href);
    else newHere.style.display = "none";
  }

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

  const mf = el("movesFold");
  if (mf) mf.addEventListener("toggle", () => { if (mf.open && hintState === "pending") revealHint(); });
  const psheet = el("pieceSheet"), pclose = el("pieceSheetClose");
  const closePieceSheet = () => { psheet.style.display = "none"; resumeThinkWindow(); };
  if (pclose && psheet) pclose.addEventListener("click", closePieceSheet);
  if (psheet) psheet.addEventListener("click", (e) => { if (e.target === psheet) closePieceSheet(); });
  const gsheet = el("glassSheet"), gchip = el("glassChip"), gclose = el("glassClose");
  if (gchip && gsheet) gchip.addEventListener("click", () => { gsheet.style.display = "grid"; });
  if (gclose && gsheet) gclose.addEventListener("click", () => { gsheet.style.display = "none"; });
  if (gsheet) gsheet.addEventListener("click", (e) => { if (e.target === gsheet) gsheet.style.display = "none"; });

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
  // joined), or a test-opponent link → jump straight onto the board; no Join
  // button dance needed.
  if (mine || isTest || (!host && roomEl.value)) {
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
      budgetSpent = 0; helpWasAvailable = false; lastRevealFen = ""; animMoveKey = null; // fresh agency budget
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
  if (sim) { const ov = document.getElementById("overOverlay"); if (ov) ov.style.display = "none"; startSim(); return; }
  if (!ws || ws.readyState !== 1) return;
  if (!confirm("Start a rematch — a fresh game with the same opponent?")) return;
  const ov = document.getElementById("overOverlay"); if (ov) ov.style.display = "none";
  budgetSpent = 0; helpWasAvailable = false; lastRevealFen = ""; animMoveKey = null; // fresh agency budget
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
  threats = [];
  threatSquares = [];
  freeCaptures = [];
  if (game && state && state.status === "ongoing" && state.turn === myColor) {
    // Deeper help must be re-revealed (and re-paid) each new position.
    if (state.fen !== lastRevealFen) { revealedSugg = false; revealedBest = false; lastRevealFen = state.fen; }
    // Casual: both sides get the full assistance spectrum. Else honor the
    // testing override, otherwise the rating-derived handicap.
    const isCasual = (state && state.mode === "casual") || gameMode === "casual" || sim;
    game.setAssistOverride(isCasual ? "guided" : (forceAssist || ""));
    assistData = JSON.parse(game.assist(DEPTH));
    hanging = assistData.hanging || [];
    threats = assistData.threats || [];
    threatSquares = threats.map((t) => t.sq);
    freeCaptures = assistData.freeCaptures || [];
    if (!isCasual && (assistData.candidates || []).length) helpWasAvailable = true;
    // (Per-position "assist shown" logging is replaced by per-MOVE provenance —
    // see finishMove: what's recorded is whether your move matched the advice.)
  }
  // Move help arrives on a timed "thinking window" — by default nothing shows
  // until HINT_DELAY / "Show now" / never. EXCEPTION: a picked multi-step
  // strategy's step help shows immediately.
  const fold = document.getElementById("movesFold");
  if (fold) fold.open = false;
  const myTurn = state && state.status === "ongoing" && state.turn === myColor;
  const followingPlan = assistData && assistData.strategy && assistData.strategy.strategies
    && assistData.strategy.strategies.some((s) => s.id === pickedStrategyId);
  // Safety never waits: in check or losing real material → help shows at once.
  const urgent = assistData && (assistData.inCheck || (threats[0] && threats[0].loss >= 200));
  if (myTurn && assistData && (assistData.candidates || []).length) {
    if (followingPlan || urgent) revealHint();
    else startThinkWindow();
  } else clearThinkWindow(true);
}

// ---- Thinking window: give the player time before help appears ----
const HINT_DELAY = 30;
let hintTick = null, hintSecs = 0, hintState = "off", hintPaused = false;
const hintAutoOff = () => { try { return localStorage.getItem("gb_hint_auto") === "off"; } catch { return false; } };
function hintStep() { hintSecs -= 1; if (hintSecs <= 0) revealHint(); else renderThinkWindow(); }
function clearThinkWindow(hide) {
  if (hintTick) { clearInterval(hintTick); hintTick = null; }
  hintPaused = false;
  if (hide) { hintState = "off"; renderThinkWindow(); }
}
function startThinkWindow() {
  clearThinkWindow();
  hintState = "pending";
  if (hintAutoOff()) { renderThinkWindow(); return; }
  hintSecs = HINT_DELAY;
  renderThinkWindow();
  hintTick = setInterval(hintStep, 1000);
}
// Pause/resume the countdown — used while a piece tip is open (don't rush a learner).
function pauseThinkWindow() {
  if (hintTick) { clearInterval(hintTick); hintTick = null; hintPaused = true; renderThinkWindow(); }
}
function resumeThinkWindow() {
  if (hintState === "pending" && hintPaused) {
    hintPaused = false;
    if (!hintAutoOff() && hintSecs > 0) hintTick = setInterval(hintStep, 1000);
    renderThinkWindow();
  }
}
function revealHint() {
  clearThinkWindow();
  hintState = "revealed";
  const fold = document.getElementById("movesFold");
  if (fold) fold.open = true;
  renderThinkWindow();
}
function dismissHint() {
  clearThinkWindow();
  hintState = "dismissed";
  renderThinkWindow();
}
function renderThinkWindow() {
  const el = document.getElementById("thinkWindow");
  if (!el) return;
  if (hintState !== "pending") { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  if (hintAutoOff()) {
    el.innerHTML =
      `<div class="tw-top"><span class="tw-lead">💡 Want a hint?</span></div>` +
      `<div class="tw-actions"><button class="tw-btn now" id="twNow">Show</button><button class="tw-btn ghost" id="twGot">No thanks</button></div>`;
  } else {
    const pct = Math.max(0, Math.min(100, Math.round((hintSecs / HINT_DELAY) * 100)));
    const label = hintPaused ? "Paused — read the tip, no rush"
      : hintSecs > HINT_DELAY * 0.5 ? "Take your time — think it through"
      : hintSecs > 5 ? "A hint's on its way…" : "Hint almost here…";
    el.innerHTML =
      `<div class="tw-top"><span class="tw-lead">💡 ${label}</span><span class="tw-secs">${hintPaused ? "⏸" : hintSecs + "s"}</span></div>` +
      `<div class="tw-bar"><div class="tw-fill${hintPaused ? " paused" : ""}" style="width:${pct}%"></div></div>` +
      `<div class="tw-actions"><button class="tw-btn now" id="twNow">Show now</button><button class="tw-btn ghost" id="twGot">I've got this</button></div>`;
  }
  const now = document.getElementById("twNow"); if (now) now.onclick = revealHint;
  const got = document.getElementById("twGot"); if (got) got.onclick = dismissHint;
}

const myElo = () => (myColor === "white" ? state.white_elo : state.black_elo);
const oppElo = () => (myColor === "white" ? state.black_elo : state.white_elo);

// --- rendering -------------------------------------------------------------

function paint() {
  renderBoard();
  renderPlayers();
  renderCaptured();
  renderCoach();
  renderAssist();
  renderStrategy();
  renderGlass();
  renderStatus();
  renderBudget();
}

// Captured material as one tug-bar above the board, oriented to the viewer.
function renderCaptured() {
  const el = document.getElementById("materialBar");
  if (!el || !window.renderMaterialBar) return;
  if (!game) { el.innerHTML = ""; return; }
  window.renderMaterialBar(el, game.boardString(), orient() !== "black");
}

// End-of-game agency read: how much help you leaned on, and the trend.
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
    body = `You leaned on <b>${budgetSpent}</b> help points (<b>${pct}%</b> of budget)${trend}.`;
  }
  return `<div class="over-help">🪙 ${body}</div>`;
}
// Spend from the agency budget when the player reveals deeper help.
function spend(n) { budgetSpent += n; renderBudget(); }
function renderBudget() {
  const elb = document.getElementById("budget");
  if (!elb) return;
  const on = assistData && !casualMode() && budgetSpent > 0 && (assistData.candidates || []).length > 0;
  elb.hidden = !on;
  if (!on) return;
  const pct = Math.min(100, Math.round((budgetSpent / BUDGET_TOTAL) * 100));
  elb.classList.toggle("over", budgetSpent > BUDGET_TOTAL);
  elb.innerHTML =
    `<span class="bg-lab">🪙 Help used</span>` +
    `<span class="bg-bar"><span class="bg-fill" style="width:${pct}%"></span></span>` +
    `<span class="bg-num">${budgetSpent} / ${BUDGET_TOTAL}</span>`;
}

// The coach: one prominent, concrete piece of advice under the board — the
// primary assistance surface, identical to the vs-AI page. Strategy is secondary.
function pieceNameAt(sq) {
  const c = (game ? game.boardString()[sq] : "") || "";
  return ({ p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" })[c.toLowerCase()] || "piece";
}
// The board itself is a status "bulb": an ambient glow that mirrors the coach.
function setBoardGlow(tone) {
  const bw = document.querySelector("main.game .board-wrap");
  if (!bw) return;
  bw.classList.remove("glow-danger", "glow-gold", "glow-calm");
  if (tone === "danger" || tone === "gold" || tone === "calm") bw.classList.add("glow-" + tone);
}
// Transient safety net: speaks ONLY on real danger or a free opportunity;
// silent (hidden) otherwise. No "you're safe" card, no reveal buttons.
function renderCoach() {
  const elc = document.getElementById("coach");
  if (!elc) return;
  const a = assistData;
  let tone = null, ic = "", head = "", sub = "", actSq = null, actLabel = "", crit = false;
  const tlist = (a && a.threats) || [];
  if (a && a.inCheck) {
    tone = "danger"; ic = "⚠"; head = "You're in check";
    sub = "Get your king out of check this move.";
  } else if (tlist.length) {
    // Value-aware: biggest-loss threat first — catches a defended queen too.
    const t = tlist[0];
    crit = t.loss >= 500;
    tone = "danger"; ic = crit ? "🛑" : "⚠";
    const nm = pieceNameAt(t.sq);
    head = crit ? `Save your ${nm} on ${sqName(t.sq)}!` : `Your ${nm} on ${sqName(t.sq)} is under attack`;
    sub = crit
      ? "You'll lose it for less — handle this before your plan."
      : (tlist.length > 1
        ? `${tlist.length} pieces are under attack — protect the most valuable first.`
        : "Defend it, move it, or capture the attacker.");
    actSq = t.sq; actLabel = "Show how to save it →";
  } else if (a && a.freeCaptures && a.freeCaptures.length) {
    tone = "gold"; ic = "★";
    const sq = a.freeCaptures[0];
    head = `Free piece: the ${pieceNameAt(sq)} on ${sqName(sq)}`;
    sub = "Your opponent left it undefended — you can take it.";
  }
  if (!tone) { elc.hidden = true; elc.innerHTML = ""; setBoardGlow(null); return; } // quiet when safe
  elc.hidden = false;
  elc.className = "coach " + tone + (crit ? " critical" : "");
  elc.innerHTML =
    `<span class="co-ic">${ic}</span>` +
    `<div class="co-body"><div class="co-head">${escapeHtml(head)}</div><div class="co-sub">${escapeHtml(sub)}</div></div>` +
    (actSq != null ? `<button class="co-act" id="coachAct">${actLabel}</button>` : "");
  setBoardGlow(tone);
  if (actSq != null) {
    const act = document.getElementById("coachAct");
    if (act) act.addEventListener("click", () => selectSquare(actSq));
  }
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
  const turnHtml = state.status === "ongoing"
    ? (yourTurn ? `<span class="turn you">💡 Your move</span>` : `<span class="turn wait">Their move</span>`)
    : "";
  el.innerHTML =
    `<div class="pl"><span class="dot ${you.color}"></span> You · <b>${escapeHtml(you.name)}</b> <span class="tnum">${you.elo}</span></div>` +
    `<div class="vs">vs</div>` +
    (oppSeated
      ? `<div class="pl"><span class="dot ${opp.color}"></span> <b>${escapeHtml(opp.name)}</b> <span class="tnum">${opp.elo}</span></div>`
      : `<div class="pl"><span class="waiting-dot"></span> Waiting for opponent…</div>`) +
    turnHtml +
    (oppSeated ? rivalryChip(opp.name) : "");
}

// Reflect the rivalry in-game: head-to-head record vs the current opponent,
// read through the platform-agnostic social layer.
function rivalryChip(oppName) {
  if (!window.gbSocial || !oppName) return "";
  let games = [];
  try { games = JSON.parse(localStorage.getItem("gb_games")) || []; } catch {}
  const r = gbSocial.rivals(games).find((x) => x.name.toLowerCase() === oppName.trim().toLowerCase());
  if (!r || (r.wins + r.losses + r.draws) === 0) return "";
  const lead = r.wins > r.losses ? "lead" : r.wins < r.losses ? "trail" : "even";
  const streak = r.streak && r.streak.n >= 2
    ? ` · ${r.streak.type === "W" ? "🔥" : r.streak.type === "L" ? "💢" : "🤝"}${r.streak.n}` : "";
  const word = lead === "lead" ? "You lead" : lead === "trail" ? "You trail" : "All square";
  return `<span class="rivalry ${lead}">⚔ ${word} ${r.wins}–${r.losses}${r.draws ? " (" + r.draws + "d)" : ""}${streak}</span>`;
}

function orientedSquares() {
  const out = [];
  if (orient() === "black") {
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
  const bottomRank = orient() === "black" ? 7 : 0;
  const leftFile = orient() === "black" ? 7 : 0;
  const chkKing = (state && state.status === "ongoing" && game.inCheck()) ? (state.turn === "white" ? "K" : "k") : null;

  boardEl.innerHTML = "";
  for (const { file, rank } of orientedSquares()) {
    const i = idx(file, rank);
    const sq = document.createElement("div");
    sq.className = "sq " + ((file + rank) % 2 === 1 ? "light" : "dark");
    if (chkKing && s[i] === chkKing) sq.classList.add("check");
    if (selected === i) sq.classList.add("selected");
    if (legalTargets.includes(i)) { sq.classList.add("target"); if (s[i] !== ".") sq.classList.add("capture"); }
    if (threatSquares.includes(i)) sq.classList.add("threat");
    if (hanging.includes(i)) sq.classList.add("hanging");
    if (freeCaptures.includes(i)) sq.classList.add("free");
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
  animateLastMove();
}

// Glide the moving piece from its old square to the new one (respects board
// orientation — black at the bottom when you're Black). Gives the opponent's
// move character instead of just appearing.
let animMoveKey = null;
function renderedRC(sq) {
  const file = sq % 8, rank = Math.floor(sq / 8);
  return orient() === "black" ? { col: 7 - file, row: rank } : { col: file, row: 7 - rank };
}
function animateLastMove() {
  if (!lastMove) return;
  const key = lastMove.from + "-" + lastMove.to;
  if (key === animMoveKey) return;
  animMoveKey = key;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const to = renderedRC(lastMove.to), from = renderedRC(lastMove.from);
  const toEl = boardEl.children[to.row * 8 + to.col];
  const piece = toEl && toEl.querySelector(".piece");
  if (!piece) return;
  const cell = toEl.getBoundingClientRect().width || 0;
  if (!cell) return;
  piece.classList.add("moving");
  piece.style.transition = "none";
  piece.style.transform = `translate(${(from.col - to.col) * cell}px, ${(from.row - to.row) * cell}px)`;
  requestAnimationFrame(() => {
    piece.style.transition = "transform .26s cubic-bezier(.34,1.4,.5,1)";
    piece.style.transform = "translate(0, 0)";
    setTimeout(() => piece.classList.remove("moving"), 280);
  });
}

function coord(kind, text) {
  const c = document.createElement("span");
  c.className = "coord " + kind;
  c.textContent = text;
  return c;
}

function renderStatus() {
  if (levelEl) { levelEl.textContent = assistData ? levelLabel(assistData.level) : "—"; levelEl.title = assistData ? (LEVEL_DESC[assistData.level] || "") : ""; }
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
      `<a href="./portal.html" style="color:var(--accent)">Back to lobby →</a>` + agencySummaryHtml();
    return;
  }
  // Turn lives in the players strip + coach — keep the status line clear during
  // play so it collapses (:empty). It reappears only for connection messages
  // (set on connect) and the game-over result above.
  statusEl.textContent = "";
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
  if (a.level === "off") add(`<div class="none">You're the higher-rated side — you play unassisted (that's the fair part). <b>Your opponent</b> is getting the help, and every bit of it shows in the <b>Glass-box</b> below.<br><span style="color:#7f92ab">Want to use plans + assistance yourself? Start a <b>Casual</b> game (both sides get it), or <a href="./index.html" style="color:var(--accent)">Play the AI ↗</a>.</span></div>`);
  // Surface the picked strategy's move at the top of the list.
  const sr = a.strategy;
  const picked = sr && sr.strategies && sr.strategies.find((s) => s.id === pickedStrategyId);
  if (picked && picked.moveUci) {
    const q = uciToSquares(picked.moveUci);
    const sm = document.createElement("div");
    sm.className = "cand strat-move";
    sm.style.setProperty("--sc", STRAT_COLOR[picked.id] || "#5cc9ec");
    sm.innerHTML =
      `<div class="cand-main"><span class="cand-tag">${STRAT_ICON[picked.id] || "◆"} ${escapeHtml(picked.name)}</span>` +
      `<span class="cand-move">${escapeHtml(picked.moveSan || picked.moveUci)}</span>` +
      (picked.moveNote ? `<div class="cand-note">${escapeHtml(picked.moveNote)}</div>` : "") +
      `</div><span class="score">plan</span>`;
    if (q) sm.addEventListener("click", () => sendMove(q.from, q.to));
    assistEl.appendChild(sm);
  }
  // Match: candidate moves are deeper help — gate behind a small spend. Casual
  // keeps them free. The coach's safety warnings above are always free.
  if (a.candidates.length && !casualMode() && !revealedSugg && !revealedBest) {
    const btn = document.createElement("button");
    btn.className = "reveal-btn";
    btn.textContent = `💡 Show ${a.candidates.length} suggested move${a.candidates.length > 1 ? "s" : ""} (−${COST_SUGG})`;
    btn.addEventListener("click", () => { spend(COST_SUGG); revealedSugg = true; renderAssist(); });
    assistEl.appendChild(btn);
    const note = document.createElement("div");
    note.className = "reveal-note";
    note.textContent = "The coach's safety warnings above are always free.";
    assistEl.appendChild(note);
    return;
  }
  const hangSq = (a.hanging && a.hanging.length) ? a.hanging[0] : -1;
  a.candidates.forEach((c) => {
    const isRec = a.recommended && c.uci === a.recommended;
    const saves = c.from === hangSq;
    const div = document.createElement("div");
    div.className = "cand" + (isRec ? " rec" : "") + (saves ? " saves" : "");
    div.innerHTML =
      `<div class="cand-main">` +
      (saves ? `<span class="cand-tag saves-tag">🛡 moves your ${pieceNameAt(hangSq)} to safety</span>` : "") +
      `<span class="cand-move">${c.san || c.uci}${isRec ? " ➤" : ""}</span>` +
      (c.note ? `<div class="cand-note">${escapeHtml(c.note)}</div>` : "") +
      `</div><span class="score">${fmtScore(c.score)}</span>`;
    div.addEventListener("click", () => sendMove(c.from, c.to));
    assistEl.appendChild(div);
  });
  if (!assistEl.innerHTML) {
    assistEl.innerHTML = `<div class="none">No move suggestions at this level — the coach still flags threats above.</div>`;
  }
}

// --- strategy layer ---------------------------------------------------------
const STRAT_ICON = { win_material: "⚔", develop: "♞", center: "▦", attack_king: "⚔", simplify: "♟", passer: "⏫", iso_attack: "◎", open_file: "▤", pawn_storm: "⛰", fianchetto: "◹", outpost: "⚑", rook_seventh: "⇥", improve: "↗" };
const STRAT_COLOR = { win_material: "#f2707e", develop: "#5cc9ec", center: "#7ee0d6", attack_king: "#f2707e", simplify: "#e0be79", passer: "#5cc9ec", iso_attack: "#f2707e", open_file: "#7ee0d6", pawn_storm: "#f2707e", fianchetto: "#e0be79", outpost: "#7ee0d6", rook_seventh: "#f2707e", improve: "#9fc0ff" };
const PLAN_COLOR = { dev: "#5cc9ec", attack: "#f2707e", support: "#7ee0d6", castle: "#e0be79" };

// square index → centre in the 800×800 overlay, respecting board orientation.
function planCxy(sq) {
  const f = sq % 8, r = Math.floor(sq / 8);
  const col = orient() === "black" ? 7 - f : f;
  const row = orient() === "black" ? r : 7 - r;
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

// Strategy is the headline assistance: a visible panel. Pick a plan → the
// step-by-step follows it (with progress) and its arrows draw on the board.
function renderStrategy() {
  const wrap = document.getElementById("stratPanelWrap");
  const host = document.getElementById("strategy");
  const sr = assistData && assistData.strategy;
  if (!sr || !sr.strategies || !sr.strategies.length) {
    if (wrap) wrap.hidden = true;
    if (host) host.innerHTML = "";
    linkPlanPanels(null);
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
    if (sr.opponent) {
      const o = document.createElement("div"); o.className = "opp-read";
      o.innerHTML = `<span>👁</span><span>${escapeHtml(sr.opponent)}</span>`;
      host.appendChild(o);
    }
    sr.strategies.forEach((s) => {
      const card = document.createElement("div");
      card.className = "scard" + (s.id === pickedStrategyId ? " on" : "");
      card.style.setProperty("--sc", STRAT_COLOR[s.id] || "#5cc9ec");
      card.innerHTML = `<span class="sic">${STRAT_ICON[s.id] || "◆"}</span>` +
        `<div><div class="sname">${escapeHtml(s.name)}</div><div class="sidea">${escapeHtml(s.idea)}</div></div>`;
      card.addEventListener("click", () => pickStrategy(s.id));
      host.appendChild(card);
    });
    if (picked) {
      const d = document.createElement("div"); d.className = "sdetail"; d.style.setProperty("--sc", STRAT_COLOR[picked.id] || "#5cc9ec");
      const steps = picked.steps.map((st) => `<div class="step ${st.done ? "done" : ""}"><span class="sd">${st.done ? "✓" : "•"}</span><span>${escapeHtml(st.text)}</span></div>`).join("");
      const t = threats && threats[0];
      const onHold = t && t.loss >= 200;
      const hold = onHold
        ? `<div class="shold">⏸ <b>Plan on hold</b> — your ${pieceNameAt(t.sq)} on ${sqName(t.sq)} is under attack. Save it first (see the coach), then continue.</div>`
        : "";
      d.innerHTML = hold +
        `<div class="snext${onHold ? " dimmed" : ""}">Next — <b>your move</b><span class="smove" title="Click to play">${escapeHtml(picked.moveSan || picked.moveUci)}</span>${escapeHtml(picked.moveNote)}</div>` +
        `<div class="steps${onHold ? " dimmed" : ""}">${steps}</div>` +
        `<div class="glassmini">🔍 This plan is shown to your opponent too.</div>`;
      host.appendChild(d);
      const mv = d.querySelector(".smove");
      if (mv) { mv.style.cursor = "pointer"; mv.addEventListener("click", () => { const q = uciToSquares(picked.moveUci); if (q) sendMove(q.from, q.to); }); }
    } else {
      const hint = document.createElement("div"); hint.className = "shint"; hint.textContent = "Pick a plan to see it on the board.";
      host.appendChild(hint);
    }
  }
  linkPlanPanels(picked);
  drawPlan(picked || null);
}
// Tie the Strategy + Suggested-moves panels together once a plan is picked.
function linkPlanPanels(picked) {
  const sc = picked ? (STRAT_COLOR[picked.id] || "#5cc9ec") : "";
  [document.getElementById("stratPanelWrap"), document.getElementById("movesFold")].forEach((elp) => {
    if (!elp) return;
    if (picked) { elp.classList.add("plan-linked"); elp.style.setProperty("--sc", sc); }
    else { elp.classList.remove("plan-linked"); elp.style.removeProperty("--sc"); }
  });
  const mp = document.getElementById("movesPlan");
  if (mp) mp.textContent = picked ? "→ " + picked.name : "";
}
function pickStrategy(id) {
  pickedStrategyId = id;
  renderStrategy();
  renderAssist();
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

// Compact transparency trace (pips + count in the game bar, pulses on new
// help); the full ledger opens on demand in a sheet.
// Parse a glass entry into a move-provenance record, or null for legacy text.
function parseProv(e) {
  const m = /^prov:(followed|own):(\w+)/.exec(e.summary || "");
  if (!m) return null;
  return { side: e.side, prov: m[1], uci: m[2] };
}
let lastGlassCount = 0;
function renderGlass() {
  const provs = glassList.map(parseProv).filter(Boolean);
  const legacy = glassList.filter((e) => !parseProv(e));
  // Full ledger (sheet): a per-move story, plus any legacy notes.
  if (glassEl) {
    const rows = provs.map((p) => {
      const icon = p.prov === "followed" ? "🤖" : "🧠";
      const what = p.prov === "followed" ? "followed the suggestion" : "played their own move";
      const side = p.side.charAt(0).toUpperCase() + p.side.slice(1);
      return `<div class="ev prov-${p.prov}"><span class="who">${icon} ${side}</span> ${what} <span class="pm">${p.uci}</span></div>`;
    });
    const extra = legacy.map((e) => `<div class="ev"><span class="who">${e.side}</span> · ${escapeHtml(e.summary)}</div>`);
    glassEl.innerHTML = (rows.concat(extra).join("")) || `<div class="none">No moves yet — every move is logged here as 🤖 followed or 🧠 your own.</div>`;
  }
  const chip = document.getElementById("glassChip");
  if (!chip) return;
  chip.hidden = provs.length === 0;
  if (!provs.length) { lastGlassCount = 0; return; }
  // Compact ribbon: one pip per move, coloured by provenance (🤖 vs 🧠).
  const pipsEl = chip.querySelector(".gpips");
  if (pipsEl) pipsEl.innerHTML = provs.slice(-8).map((p) => `<span class="gpip ${p.prov}"></span>`).join("");
  const countEl = document.getElementById("glassCount");
  const followed = provs.filter((p) => p.prov === "followed").length;
  if (countEl) countEl.textContent = followed + "🤖";
  if (provs.length !== lastGlassCount) {
    if (lastGlassCount > 0) { chip.classList.remove("pulse"); void chip.offsetWidth; chip.classList.add("pulse"); }
    lastGlassCount = provs.length;
  }
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
  renderPieceTip(i);
  renderBoard();
}
function clearSelection() {
  selected = null;
  legalTargets = [];
  renderPieceTip(null);
  renderBoard();
}

// Learn the pieces as you play: first-touch tip + a tap-anytime full tour.
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
  if (typeof pauseThinkWindow === "function") pauseThinkWindow(); // don't rush a learner reading the tip
}

function sendMove(from, to) {
  if (game.isPromotion(from, to)) { showPromotion(from, to); return; }
  finishMove(from, to, "");
}
// Move provenance (the airtight transparency signal): did the move I'm about to
// play match the assistance that was live for me? Recorded on the actual move,
// so it can't be spoofed by reading the suggestion without tapping.
function moveProvenance(from, to) {
  const a = assistData;
  if (!a || a.level === "off") return "own"; // no help was on offer → my own move
  const cands = a.candidates || [];
  if (cands.some((c) => c.from === from && c.to === to)) return "followed";
  const sr = a.strategy;
  const picked = sr && sr.strategies && sr.strategies.find((s) => s.id === pickedStrategyId);
  if (picked && picked.moveUci && picked.moveUci.slice(0, 4) === sqName(from) + sqName(to)) return "followed";
  return "own"; // played something the assistance didn't suggest
}
function finishMove(from, to, promo) {
  const prov = moveProvenance(from, to);
  const uci = sqName(from) + sqName(to) + promo;
  if (sim) { simMove(from, to, promo, prov, uci); return; }
  // Relay provenance (opaque summary, no server change) so BOTH players see it.
  ws.send(JSON.stringify({ t: "glass", summary: "prov:" + prov + ":" + uci }));
  ws.send(JSON.stringify({ t: "move", uci }));
  clearSelection(); // board updates when the server echoes the new state
}

// ---- Same-screen practice (sim): play both sides locally to test the UI. ----
function startSim() {
  sim = true;
  gameMode = new URLSearchParams(location.search).get("mode") === "casual" ? "casual" : "match";
  game = new Game(); // startpos
  glassList = [];
  lastGlassCount = 0;
  const mc = el("matchCard"); if (mc) mc.style.display = "none";
  if (!document.getElementById("simBadge")) {
    const badge = document.createElement("div");
    badge.id = "simBadge";
    badge.textContent = "🧪 Practice — playing both sides";
    badge.style.cssText = "position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:70;" +
      "background:rgba(126,224,214,.16);border:1px solid rgba(126,224,214,.5);color:#7ee0d6;" +
      "padding:4px 13px;border-radius:999px;font-size:0.74rem;font-weight:640;white-space:nowrap;";
    document.body.appendChild(badge);
  }
  simRefresh();
}
function simRefresh() {
  const st = game.status();
  const over = st !== "ongoing";
  myColor = game.sideToMove();       // the mover is "you" (assist + provenance + piece-picking)
  state = {
    status: over ? st : "ongoing",
    turn: game.sideToMove(),
    fen: game.fen(),
    mode: gameMode,
    white_name: "White", black_name: "Black",
    white_elo: 900, black_elo: 900,
    winner: over ? (st === "checkmate" ? (game.sideToMove() === "white" ? "black" : "white") : "") : "",
    reason: over ? (st === "checkmate" ? "checkmate" : st) : "",
  };
  computeAssist();
  paint();
  if (over) showGameOver({ winner: state.winner, reason: state.reason });
}
function simMove(from, to, promo, prov, uci) {
  glassList.push({ side: game.sideToMove(), summary: "prov:" + prov + ":" + uci });
  game.makeMove(from, to, promo || undefined);
  lastMove = { from, to };
  clearSelection();
  simRefresh();
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
    case "awareness": return `Hint: ${a.hanging.length} hanging piece(s) highlighted.`;
    case "coaching": return `Coach: ${a.messages.length} message(s) shown.`;
    case "suggestion": return `Guide: ${a.candidates.length} candidate move(s) shown.`;
    case "guided": return `Assist: recommended ${a.recommended ?? "-"}.`;
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
