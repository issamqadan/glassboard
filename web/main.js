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
// ---- vs-AI game persistence: start now, continue later, keep several going ----
// AI games are solo and client-driven, but persisted BOTH ways: localStorage for
// instant/offline use, and the server (keyed by player) so they're durable and
// resumable on any device — just like online games. A finished game is removed.
const AI_STORE = "gb_ai_games";
const AI_SERVER = "https://playglassboard.onrender.com";
let aiGameId = null;   // the slot the current game saves into
let aiSaved = false;   // becomes true once the game has a move worth keeping
const loadAiGames = () => { try { return JSON.parse(localStorage.getItem(AI_STORE)) || []; } catch { return []; } };
const saveAiGames = (g) => { try { localStorage.setItem(AI_STORE, JSON.stringify(g)); } catch {} };
const newAiId = () => "ai" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// Stable player id: the signed-in account if present, else this device's id.
function aiPlayerId() {
  try { const me = JSON.parse(localStorage.getItem("gb_me")); if (me && me.id) return me.id; } catch {}
  let id = localStorage.getItem("gb_pid");
  if (!id) { id = "p" + Math.random().toString(36).slice(2, 10); try { localStorage.setItem("gb_pid", id); } catch {} }
  return id;
}
function aiUpsertRemote(rec) {
  fetch(AI_SERVER + "/ai-games", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: rec.id, pid: aiPlayerId(), fen: rec.fen, human_elo: rec.humanElo, engine_elo: rec.engineElo }),
  }).catch(() => {});
}
function aiDeleteRemote(id) {
  fetch(AI_SERVER + "/ai-games/delete", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
  }).catch(() => {});
}
// Write the current game into its slot (created lazily on the first real move).
// When the game finishes, it's removed from both stores — finished games don't linger.
function persistAiGame(over) {
  if (!game || !aiGameId) return;
  const games = loadAiGames();
  const i = games.findIndex((g) => g.id === aiGameId);
  if (over) {
    if (i >= 0) { games.splice(i, 1); saveAiGames(games); }
    if (aiSaved) aiDeleteRemote(aiGameId);
    return;
  }
  const prev = i >= 0 ? games[i] : null;
  const rec = {
    id: aiGameId,
    fen: game.fen(),
    humanElo: parseInt(humanEloEl.value, 10),
    engineElo: parseInt(engineEloEl.value, 10),
    created: prev ? prev.created : Date.now(),
    updated: Date.now(),
  };
  if (i >= 0) games[i] = rec; else games.unshift(rec);
  saveAiGames(games);
  aiSaved = true;
  aiUpsertRemote(rec);
}
// Resume from local cache if present, else fetch the snapshot from the server.
async function resumeAiGame(id) {
  let rec = loadAiGames().find((g) => g.id === id);
  if (!rec) {
    try {
      const list = await (await fetch(AI_SERVER + "/ai-games?player=" + encodeURIComponent(aiPlayerId()))).json();
      const r = (list || []).find((x) => x.id === id);
      if (r) rec = { id: r.id, fen: r.fen, humanElo: r.human_elo, engineElo: r.engine_elo };
    } catch {}
  }
  if (!rec) return false;
  game = Game.fromFen(rec.fen);
  if (humanEloEl) humanEloEl.value = rec.humanElo;
  if (engineEloEl) engineEloEl.value = rec.engineElo;
  syncAiLevel();
  game.setRatings(rec.humanElo, rec.engineElo);
  aiGameId = id; aiSaved = true;
  selected = null; legalTargets = []; lastMove = null; busy = false; resigned = false; mateKingSq = -1;
  indepOwn = 0; indepFollowed = 0; moveReview = []; lastEval = null;
  pickedStrategyId = null; budgetSpent = 0; helpWasAvailable = false; animMoveKey = null;
  firstGame = false;
  hideOver();
  if (window.GBTheme) GBTheme.setContext(id); // restore this game's board
  setLevelPill(game.assistLevel());
  onPositionChanged();
  // Resumed mid-cycle on the engine's move → let it reply.
  if (game.status() === "ongoing" && game.sideToMove() === "black") setTimeout(engineReply, 300);
  return true;
}
let selected = null;
let legalTargets = [];
let hanging = [];
let threats = [];        // value-aware [{sq,kind,loss}], biggest loss first
let threatSquares = [];  // just the squares, for board highlighting
let mateKingSq = -1;     // the mated king's square, to ring it when the game ends
// Independence: among moves where help was on offer, how many you found yourself
// (🧠 own) vs followed (🤖). The "ladder down" payoff — you should need it less.
let indepOwn = 0, indepFollowed = 0;
// Strength telemetry: per-move centipawn loss vs the engine's best, so we can
// measure how good your (assisted) play actually was in a real game.
let moveReview = []; // [{cp, wasBest}]
let lastEval = null; // engine's read of your position (white-relative cp), for the live pill
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
  { ic: "💡", text: "One more thing: <b>tap any piece anytime</b> to learn how it moves, when it's strong, and what it works well with. The first time you touch each piece, a tip pops up automatically.", cta: "Got it" },
  { ic: "🎉", text: "You've got it! Keep playing — help is always under the board, and every piece has tips a tap away. Have fun!", cta: "Play on", final: true },
];
let lastMove = null; // { from, to } of the most recent move
let assistData = null; // parsed assist JSON for the current (White) turn
let busy = false;
let resigned = false;

// Assistance search depth — a notch deeper than the opponent's, so following the
// help lifts you above it (the handicap made real). Derived from the AI level.
const depth = () => Game.assistDepthFor(parseInt(engineEloEl.value, 10));
// Set the AI-level dropdown to the option nearest the current engine rating.
function syncAiLevel() {
  const sel = document.getElementById("aiLevel");
  if (!sel) return;
  const elo = parseInt(engineEloEl.value, 10);
  let best = sel.options[0];
  for (const o of sel.options) if (Math.abs(+o.value - elo) < Math.abs(+best.value - elo)) best = o;
  sel.value = best.value;
}
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
  const nh = document.getElementById("newHereLink");
  if (nh) nh.hidden = false; // re-show the entry so it can be re-launched anytime
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
  const nh = document.getElementById("newHereLink");
  if (nh) nh.hidden = firstGame; // hidden while the guided game is running
  const closeMenu = () => { const f = document.getElementById("setupFold"); if (f) f.removeAttribute("open"); };
  // AI-level chooser → sets the opponent's rating (drives its strength + the
  // handicap). Applies live to the running game.
  const aiLevelEl = document.getElementById("aiLevel");
  if (aiLevelEl) aiLevelEl.addEventListener("change", () => {
    const newElo = parseInt(aiLevelEl.value, 10);
    const midGame = lastMove != null || moveReview.length > 0; // a move has been played
    if (midGame && !confirm(`Play a new game against the ${levelName(newElo)} AI? (You choose your opponent at the start of a game.)`)) {
      syncAiLevel(); // revert the dropdown to the current opponent
      return;
    }
    engineEloEl.value = newElo;
    closeMenu();
    if (midGame) { firstGame = false; newGame(); }        // new opponent → fresh game
    else {                                                  // untouched board → apply in place
      if (game) game.setRatings(parseInt(humanEloEl.value, 10), newElo);
      setLevelPill(game ? game.assistLevel() : "off");
      onPositionChanged();
    }
  });
  if (humanEloEl) humanEloEl.addEventListener("change", () => {
    if (game) game.setRatings(parseInt(humanEloEl.value, 10), parseInt(engineEloEl.value, 10));
    setLevelPill(game ? game.assistLevel() : "off");
    onPositionChanged();
  });
  document.getElementById("new").addEventListener("click", () => { closeMenu(); firstGame = false; newGame(); });
  const mf = document.getElementById("movesFold");
  if (mf) mf.addEventListener("toggle", () => { if (mf.open && hintState === "pending") revealHint(); });
  const psheet = document.getElementById("pieceSheet"), pclose = document.getElementById("pieceSheetClose");
  const closePieceSheet = () => { psheet.style.display = "none"; resumeThinkWindow(); };
  if (pclose && psheet) pclose.addEventListener("click", closePieceSheet);
  if (psheet) psheet.addEventListener("click", (e) => { if (e.target === psheet) closePieceSheet(); });
  const ssheet = document.getElementById("stepsSheet"), ssclose = document.getElementById("stepsSheetClose");
  const closeSteps = () => { if (ssheet) ssheet.style.display = "none"; };
  if (ssclose) ssclose.addEventListener("click", closeSteps);
  if (ssheet) ssheet.addEventListener("click", (e) => { if (e.target === ssheet) closeSteps(); });
  const rb = document.getElementById("resignBtn");
  if (rb) rb.addEventListener("click", () => { closeMenu(); resign(); });
  const orm = document.getElementById("overRematch");
  if (orm) orm.addEventListener("click", () => { hideOver(); newGame(); });
  const ocl = document.getElementById("overClose");
  if (ocl) ocl.addEventListener("click", hideOver);
  // Resume a saved game if the lobby sent us here with ?g=<id>; else start fresh.
  const gid = new URLSearchParams(location.search).get("g");
  if (gid && !firstGame && await resumeAiGame(gid)) return;
  newGame();
}
const hideOver = () => { const ov = document.getElementById("overOverlay"); if (ov) ov.style.display = "none"; };

function newGame() {
  game = new Game();
  game.setRatings(parseInt(humanEloEl.value, 10), parseInt(engineEloEl.value, 10));
  aiGameId = newAiId(); // a fresh slot; only saved once a move is played
  aiSaved = false;
  mateKingSq = -1;
  indepOwn = 0; indepFollowed = 0; moveReview = []; lastEval = null;
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
  if (window.GBTheme) GBTheme.setContext(aiGameId); // this game's own board
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
  threats = [];
  threatSquares = [];
  freeCaptures = [];
  assistData = null;
  revealedSugg = false; // deeper help must be re-revealed (and re-paid) each position
  revealedBest = false;
  if (game.status() === "ongoing" && game.sideToMove() === "white") {
    assistData = JSON.parse(game.assist(depth())); // records to glass-box once
    hanging = assistData.hanging || [];
    threats = assistData.threats || [];
    threatSquares = threats.map((t) => t.sq);
    freeCaptures = assistData.freeCaptures || [];
    if ((assistData.candidates || []).length) { helpWasAvailable = true; lastEval = assistData.candidates[0].score; }
  }
  // Vs the AI there's no opponent to hide help from, so suggestions show
  // immediately — the timed "thinking window" (which exists so a HUMAN opponent
  // doesn't watch you being fed moves) is a multiplayer-only thing.
  const fold = document.getElementById("movesFold");
  if (fold) fold.open = false;
  if (assistData && (assistData.candidates || []).length && !firstGame) {
    revealHint();
  } else clearThinkWindow(true);
  paint();
}

// ---- Thinking window: give the player time before help appears. An
// illustrative draining bar (not a boring number), and it PAUSES while the
// player is reading a piece tip. ----
const HINT_DELAY = 30; // seconds (default; tune 30–60)
let hintTick = null, hintSecs = 0, hintState = "off", hintPaused = false; // off|pending|revealed|dismissed
const hintAutoOff = () => { try { return localStorage.getItem("gb_hint_auto") === "off"; } catch { return false; } };
function hintStep() { hintSecs -= 1; if (hintSecs <= 0) revealHint(true); else renderThinkWindow(); }
// A soft "idea!" cue — a gentle two-note rise + a light haptic — for the moment
// the bulb finishes warming and the hint arrives. Felt, not watched. Best-effort.
let _ideaCtx = null;
function ideaCue() {
  try { if (navigator.vibrate) navigator.vibrate(18); } catch {}
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    _ideaCtx = _ideaCtx || new AC();
    if (_ideaCtx.state === "suspended") _ideaCtx.resume();
    const t = _ideaCtx.currentTime;
    [660, 990].forEach((f, i) => {
      const o = _ideaCtx.createOscillator(), g = _ideaCtx.createGain();
      o.type = "sine"; o.frequency.value = f;
      const s = t + i * 0.1;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.05, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.2);
      o.connect(g).connect(_ideaCtx.destination);
      o.start(s); o.stop(s + 0.22);
    });
  } catch {}
}
function clearThinkWindow(hide) {
  if (hintTick) { clearInterval(hintTick); hintTick = null; }
  hintPaused = false;
  if (hide) { hintState = "off"; renderThinkWindow(); }
}
function startThinkWindow() {
  clearThinkWindow();
  hintState = "pending";
  if (hintAutoOff()) { renderThinkWindow(); return; } // manual only — no countdown
  hintSecs = HINT_DELAY;
  renderThinkWindow();
  hintTick = setInterval(hintStep, 1000);
}
// Pause/resume the countdown (used while a piece tip is open — don't rush a learner).
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
function revealHint(auto) {
  clearThinkWindow();
  hintState = "revealed";
  const fold = document.getElementById("movesFold");
  if (fold) fold.open = true;
  renderThinkWindow();
  if (auto === true) ideaCue(); // the idea "arrived" on its own — a gentle cue
}
function dismissHint() {
  clearThinkWindow();
  hintState = "dismissed";
  renderThinkWindow();
}
// The "idea bulb": calm, no countdown. The bulb quietly WARMS UP (dim → bright)
// as your thinking time passes — no ticking number, no draining bar, no pressure.
// Tap it to reveal now; wave it off with "not now". Element persists so the glow
// glides instead of stepping.
function renderThinkWindow() {
  const el = document.getElementById("thinkWindow");
  if (!el) return;
  if (hintState !== "pending") { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  const auto = hintAutoOff();
  const fill = auto ? 1 : Math.max(0, Math.min(1, 1 - hintSecs / HINT_DELAY));
  const label = auto ? "Want a hint?"
    : hintPaused ? "Paused — read the tip, no rush"
    : fill < 0.5 ? "Take your time — think it through"
    : fill < 0.95 ? "An idea's forming…" : "Ready when you are";
  if (!el.querySelector(".tw-bulb")) {
    el.innerHTML =
      `<button class="tw-bulb" id="twNow" title="Show the hint now" aria-label="Show the hint now">💡</button>` +
      `<div class="tw-body"><div class="tw-lead"></div><button class="tw-skip" id="twGot"></button></div>`;
    el.querySelector("#twNow").onclick = () => revealHint(false);
    el.querySelector("#twGot").onclick = dismissHint;
  }
  const bulb = el.querySelector(".tw-bulb");
  bulb.style.setProperty("--fill", fill.toFixed(2));
  bulb.classList.toggle("paused", hintPaused);
  bulb.classList.toggle("ready", !auto && fill >= 0.95);
  el.querySelector(".tw-lead").textContent = label;
  el.querySelector(".tw-skip").textContent = auto ? "no thanks" : "not now";
}

// Live position eval — the engine's read of your position, so strength is
// visible DURING the game (white-relative; from the best-move score).
function renderEval() {
  const el = document.getElementById("evalPill");
  if (!el) return;
  const over = resigned || game.status() !== "ongoing";
  if (lastEval == null || over) { el.hidden = true; return; }
  el.hidden = false;
  let txt, cls;
  if (Math.abs(lastEval) >= 29000) { txt = lastEval > 0 ? "Mate ▲" : "Mate ▼"; }
  else {
    const p = lastEval / 100;
    txt = (p >= 0 ? "+" : "") + p.toFixed(1);
  }
  cls = lastEval >= 80 ? "good" : lastEval <= -80 ? "bad" : "even";
  el.className = "pill eval-pill " + cls;
  el.textContent = "⚖ " + txt;
}

// Repaints board + panels from current state (no assistance recompute).
function paint() {
  renderFirstGame();
  renderBoard();
  renderPlayers();
  renderEval();
  renderCoach();
  renderAssist();
  renderStrategy();
  renderPlanDock();
  renderCaptured();
  renderGlass();
  renderStatus();
  renderBudget();
  showGameOverIfNeeded();
}

// Plan Dock: the strategy made glanceable and always-visible right under the
// board — plan · step progress · the NEXT move as a tappable chip — so on a
// phone you never scroll to find your plan. Full steps open in a bottom sheet.
function renderPlanDock() {
  const dock = document.getElementById("planDock");
  if (!dock) return;
  const sr = assistData && assistData.strategy;
  if (firstGame || !sr || !sr.strategies || !sr.strategies.length) { dock.hidden = true; dock.innerHTML = ""; return; }
  dock.hidden = false;
  const picked = sr.strategies.find((s) => s.id === pickedStrategyId);
  if (!picked) {
    const chips = sr.strategies.slice(0, 3).map((s) =>
      `<button class="pd-pick" data-id="${s.id}" style="--sc:${STRAT_COLOR[s.id] || "#5cc9ec"}"><span class="pd-cic">${STRAT_ICON[s.id] || "◆"}</span>${escapeHtml(s.name)}</button>`).join("");
    dock.style.removeProperty("--sc");
    dock.innerHTML = `<div class="pd-lead">🧭 Pick a plan</div><div class="pd-chips">${chips}</div>`;
    dock.querySelectorAll(".pd-pick").forEach((b) => b.onclick = () => { pickedStrategyId = b.dataset.id; paint(); renderAssist(); });
    return;
  }
  const doneN = picked.steps.filter((s) => s.done).length;
  const pips = picked.steps.map((s, i) => `<span class="pd-pip${s.done ? " done" : i === doneN ? " now" : ""}"></span>`).join("");
  dock.style.setProperty("--sc", STRAT_COLOR[picked.id] || "#5cc9ec");
  dock.innerHTML =
    `<div class="pd-top"><span class="pd-ic">${STRAT_ICON[picked.id] || "◆"}</span><span class="pd-name">${escapeHtml(picked.name)}</span>` +
      `<span class="pd-pips" title="${doneN}/${picked.steps.length} steps">${pips}</span>` +
      `<button class="pd-steps" id="pdSteps">Steps</button><button class="pd-x" id="pdX" title="Drop this plan" aria-label="Drop this plan">✕</button></div>` +
    `<div class="pd-next"><span class="pd-lab">NEXT</span><button class="pd-move" id="pdMove" title="Play this move">${escapeHtml(picked.moveSan || picked.moveUci)}</button>` +
      `<span class="pd-note">${escapeHtml(picked.moveNote)}</span></div>`;
  dock.querySelector("#pdMove").onclick = () => { const q = uciSquares(picked.moveUci); if (q) playMove(q.from, q.to); };
  dock.querySelector("#pdSteps").onclick = () => openStepsSheet(picked);
  dock.querySelector("#pdX").onclick = () => { pickedStrategyId = null; paint(); renderAssist(); };
}
function openStepsSheet(picked) {
  const t = document.getElementById("stepsSheetTitle");
  if (t) t.textContent = (STRAT_ICON[picked.id] || "◆") + " " + picked.name;
  const b = document.getElementById("stepsSheetBody");
  if (b) b.innerHTML =
    `<div class="ss-idea">${escapeHtml(picked.idea)}</div>` +
    `<div class="ss-steps">${picked.steps.map((st) => `<div class="ss-step ${st.done ? "done" : ""}"><span class="ss-dot">${st.done ? "✓" : "•"}</span><span>${escapeHtml(st.text)}</span></div>`).join("")}</div>` +
    `<button class="ss-play" id="ssPlay">Play next — ${escapeHtml(picked.moveSan || picked.moveUci)}</button>`;
  const p = document.getElementById("ssPlay");
  if (p) p.onclick = () => { const sh = document.getElementById("stepsSheet"); if (sh) sh.style.display = "none"; const q = uciSquares(picked.moveUci); if (q) playMove(q.from, q.to); };
  const sh = document.getElementById("stepsSheet");
  if (sh) sh.style.display = "grid";
}

// Captured material as one tug-bar above the board (you are White → left side).
function renderCaptured() {
  const el = document.getElementById("materialBar");
  if (el && window.renderMaterialBar) window.renderMaterialBar(el, game.boardString(), true);
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
  bw.classList.remove("glow-danger", "glow-gold", "glow-calm", "glow-win", "glow-loss", "glow-draw");
  if (["danger", "gold", "calm", "win", "loss", "draw"].includes(tone)) bw.classList.add("glow-" + tone);
}
// The coach is a transient safety net: it speaks ONLY when there's real danger
// or a free opportunity. When you're safe, it says nothing (hidden) — no "you're
// safe" spam, no permanent card. Help is free; no reveal buttons.
function renderCoach() {
  const el = document.getElementById("coach");
  if (!el) return;
  const a = assistData;
  let tone = null, ic = "", head = "", sub = "", actSq = null, actLabel = "", crit = false;
  const tlist = (a && a.threats) || [];
  if (a && a.inCheck) {
    tone = "danger"; ic = "⚠"; head = "You're in check";
    sub = "Get your king out of check this move.";
  } else if (a && a.mateThreat) {
    crit = true; tone = "danger"; ic = "🛑"; head = "Checkmate threat!";
    sub = "The engine can mate next move — your move must stop it (guard the king or remove the attacker).";
  } else if (tlist.length && tlist[0].loss >= 200) {
    // Only alarm for a real piece (minor or more). A single pawn isn't worth a
    // red "SAVE IT" — the engine often (correctly) lets a pawn go, which made the
    // old alarm misleading ("save your pawn" while the best move ignores it).
    const t = tlist[0];
    crit = t.loss >= 500; // rook or more at stake
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
  if (!tone) { el.hidden = true; el.innerHTML = ""; setBoardGlow(null); return; } // quiet when safe
  el.hidden = false;
  el.className = "coach " + tone + (crit ? " critical" : "");
  el.innerHTML =
    `<span class="co-ic">${ic}</span>` +
    `<div class="co-body"><div class="co-head">${escapeHtml(head)}</div><div class="co-sub">${escapeHtml(sub)}</div></div>` +
    (actSq != null ? `<button class="co-act" id="coachAct">${actLabel}</button>` : "");
  setBoardGlow(tone);
  // Make the diagnosis actionable: tap → select the threatened piece so its
  // legal destinations light up on the board, ready to move.
  if (actSq != null) {
    const act = document.getElementById("coachAct");
    if (act) act.addEventListener("click", () => selectSquare(actSq));
  }
}

function updateSetupSum() {
  const el = document.getElementById("setupSum");
  if (el) el.textContent = `You ${humanEloEl.value} · Engine ${engineEloEl.value}`;
}
// Friendly name for an AI rating (matches the ⚙ AI-level options).
function levelName(elo) {
  const e = parseInt(elo, 10);
  return e <= 700 ? "Beginner" : e <= 1100 ? "Casual" : e <= 1500 ? "Intermediate" : e <= 1900 ? "Club" : e <= 2300 ? "Expert" : "Master";
}
function renderPlayers() {
  updateSetupSum();
  const el = document.getElementById("players");
  if (!el) return;
  el.hidden = false;
  const over = resigned || game.status() !== "ongoing";
  const turn = over ? null : game.sideToMove();
  // Compact: whose-move stays on one row. The 🤖 chip shows the AI LEVEL and is
  // tappable to change it — that's where you look for "who am I playing".
  el.innerHTML =
    `<span class="pl"><span class="dot white"></span> <b>You</b> <span class="tnum">${humanEloEl.value}</span></span>` +
    `<span class="vs">·</span>` +
    `<button class="pl ai-chip" id="aiChip" title="Change AI level"><span class="dot black"></span> <b>🤖 ${levelName(engineEloEl.value)}</b> <span class="ai-caret">▾</span></button>` +
    (turn ? (turn === "white"
      ? `<span class="turn you">💡 Your move</span>`
      : `<span class="turn wait">Engine…</span>`) : "");
  const ac = document.getElementById("aiChip");
  if (ac) ac.onclick = () => {
    const f = document.getElementById("setupFold"); if (f) f.open = true;
    const s = document.getElementById("aiLevel"); if (s) { try { s.focus(); } catch {} }
  };
}

function resign() {
  if (resigned || game.status() !== "ongoing") return;
  if (!confirm("Resign to the engine? It'll count as a loss.")) return;
  resigned = true;
  if (!firstGame && aiSaved) persistAiGame(true);
  paint();
}

function findKing(color) {
  const k = color === "white" ? "K" : "k";
  const s = game.boardString();
  for (let i = 0; i < 64; i++) if (s[i] === k) return i;
  return -1;
}
// Draw HOW the game ended, on the board: ring the mated king and arrow the
// piece that delivered mate. Uses the plan overlay (cleared once the game is over).
function illustrateMate(kingSq, fromSq) {
  mateKingSq = kingSq;
  const sq = boardEl.querySelector(`[data-sq="${kingSq}"]`);
  if (sq) sq.classList.add("mate");
  const ov = document.getElementById("planOverlay");
  if (ov && fromSq != null && fromSq >= 0) {
    ov.innerHTML = planArrow(fromSq, kingSq, "#ff5666", 0) +
      `<circle class="mate-ring" cx="${planCxy(kingSq).x}" cy="${planCxy(kingSq).y}" r="46" fill="none" stroke="#ff5666" stroke-width="6"/>`;
  }
}

function showGameOverIfNeeded() {
  const ov = document.getElementById("overOverlay");
  if (!ov) return;
  const st = game.status();
  const over = resigned || st !== "ongoing";
  const rb = document.getElementById("resignBtn");
  if (rb) rb.hidden = over;
  if (!over) { ov.style.display = "none"; mateKingSq = -1; return; }
  let winner = "", reason = "";
  if (resigned) { winner = "black"; reason = "resignation"; }        // you (White) resigned
  else if (st === "checkmate") { winner = game.sideToMove() === "white" ? "black" : "white"; reason = "checkmate"; }
  else if (st === "stalemate") { reason = "stalemate"; }
  else if (st === "fifty-move") { reason = "fifty-move rule"; }
  const draw = winner === "", won = winner === "white";
  const res = document.getElementById("overResult"), rea = document.getElementById("overReason");

  let how = "";
  if (st === "checkmate") {
    const loser = game.sideToMove();                 // the mated side is to move
    const kingSq = findKing(loser);
    illustrateMate(kingSq, lastMove ? lastMove.to : -1);
    const byName = lastMove ? pieceNameAt(lastMove.to) : "piece";
    const bySq = lastMove ? sqName(lastMove.to) : "";
    how = won
      ? `Your ${escapeHtml(byName)}${bySq ? " on " + bySq : ""} delivers mate — the black king can't escape.`
      : `The engine's ${escapeHtml(byName)}${bySq ? " on " + bySq : ""} has your king trapped — no legal escape.`;
  } else if (reason === "stalemate") {
    how = "No legal moves, but the king isn't in check — it's a draw.";
  } else if (reason === "resignation") {
    how = "You resigned this one.";
  } else {
    how = "Fifty moves without a capture or pawn move — an automatic draw.";
  }

  res.innerHTML = (st === "checkmate" ? `<span class="over-mate">CHECKMATE</span>` : "") +
    (draw ? "Draw" : won ? "You win! 🎉" : "You lose");
  res.className = "over-result " + (draw ? "draw" : won ? "win" : "loss");
  rea.innerHTML = `<div class="over-how">${how}</div>` + reviewHtml() + independenceHtml() + agencySummaryHtml();
  if (window.gbFeedback) gbFeedback.render(document.getElementById("overFeedback"), { mode: "ai", gameId: aiGameId || "" });
  setBoardGlow(draw ? "draw" : won ? "win" : "loss"); // highlight the result on the board (which stays visible)
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

// The ladder-down payoff: of the moves where help was on the table, how many you
// found on your own (🧠) vs followed (🤖) — with the trend, because needing it
// less over time is the whole point.
function independenceHtml() {
  const total = indepOwn + indepFollowed;
  if (total < 2) return "";
  const pct = Math.round((indepOwn / total) * 100);
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem("gb_indep_last")); } catch {}
  localStorage.setItem("gb_indep_last", JSON.stringify(pct));
  let trend = "";
  if (prev != null && isFinite(prev)) {
    const d = pct - prev;
    trend = d > 0 ? ` <span class="oi-up">▲ up from ${prev}%</span>` : d < 0 ? ` <span class="oi-dn">▼ from ${prev}%</span>` : " · same as last game";
  }
  return `<div class="over-indep">` +
    `<div class="oi-head">🧠 Independence <b>${pct}%</b>${trend}</div>` +
    `<div class="indep-bar"><div class="indep-fill" style="width:${pct}%"></div></div>` +
    `<div class="oi-sub">You found <b>${indepOwn}</b> of ${total} assisted moves on your own — 🤖 followed ${indepFollowed}. Needing help less is the whole idea.</div>` +
    `</div>`;
}

// Strength measurement (real game): per-move centipawn loss vs the engine's best,
// split into "when you followed the help" (= how strong the assistance was) vs
// "your own moves". Lower cp/move = closer to perfect. Also logged to the console.
function reviewHtml() {
  const r = moveReview.filter((m) => m.cp != null && m.cp >= 0);
  if (r.length < 3) return "";
  const mean = (a) => (a.length ? Math.round(a.reduce((s, m) => s + m.cp, 0) / a.length) : null);
  const avg = mean(r);
  const foll = r.filter((m) => m.prov === "followed");
  const own = r.filter((m) => m.prov === "own");
  const grade = (cp) => cp <= 20 ? "excellent" : cp <= 50 ? "solid" : cp <= 120 ? "some slips" : "loose";
  const worst = r.reduce((a, m) => (m.cp > a.cp ? m : a), r[0]);
  const worstIdx = r.indexOf(worst) + 1;
  console.log(`[review] game over — ${r.length} of your moves | avg ${avg}cp | followed ${foll.length} (avg ${mean(foll)}cp) | own ${own.length} (avg ${mean(own)}cp) | worst ${worst.cp}cp @ move ${worstIdx}`);
  const line = (lab, cp) => cp == null ? "" : `<div class="rv-row"><span>${lab}</span><b>${cp} cp/move</b> · ${grade(cp)}</div>`;
  return `<div class="over-review">` +
    `<div class="rv-head">📊 Play review — how close to best you played</div>` +
    line("Overall", avg) +
    (foll.length ? line("🤖 When you followed the help", mean(foll)) : "") +
    (own.length ? line("🧠 Your own moves", mean(own)) : "") +
    (worst.cp >= 150 ? `<div class="rv-row"><span>Biggest slip</span><b>−${(worst.cp / 100).toFixed(1)}</b> at move ${worstIdx}</div>` : "") +
    `</div>`;
}

// --- strategy layer (same UX as multiplayer; White orientation, plays vs AI) ---
const STRAT_ICON = { save_piece: "🛡", win_material: "⚔", develop: "♞", center: "▦", attack_king: "⚔", simplify: "♟", passer: "⏫", iso_attack: "◎", open_file: "▤", pawn_storm: "⛰", fianchetto: "◹", outpost: "⚑", rook_seventh: "⇥", improve: "↗", pawn_break: "⚡" };
const STRAT_COLOR = { save_piece: "#f2b03a", win_material: "#f2707e", develop: "#5cc9ec", center: "#7ee0d6", attack_king: "#f2707e", simplify: "#e0be79", passer: "#5cc9ec", iso_attack: "#f2707e", open_file: "#7ee0d6", pawn_storm: "#f2707e", fianchetto: "#e0be79", outpost: "#7ee0d6", rook_seventh: "#f2707e", improve: "#9fc0ff", pawn_break: "#e0be79" };
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
      // Safety outranks the plan: if a piece is in real danger, hold the plan and
      // send the player to the coach's rescue before resuming the sequence.
      const t = threats && threats[0];
      const onHold = t && t.loss >= 200;
      const hold = onHold
        ? `<div class="shold">⏸ <b>Plan on hold</b> — your ${pieceNameAt(t.sq)} on ${sqName(t.sq)} is under attack. Save it first (see the coach), then continue.</div>`
        : "";
      d.innerHTML = hold +
        `<div class="snext${onHold ? " dimmed" : ""}">Next — <b>your move</b><span class="smove" title="Click to play">${escapeHtml(picked.moveSan || picked.moveUci)}</span>${escapeHtml(picked.moveNote)}</div><div class="steps${onHold ? " dimmed" : ""}">${steps}</div>`;
      host.appendChild(d);
      const mv = d.querySelector(".smove");
      if (mv) { mv.style.cursor = "pointer"; mv.addEventListener("click", () => { const q = uciSquares(picked.moveUci); if (q) playMove(q.from, q.to); }); }
    } else {
      const hint = document.createElement("div"); hint.className = "shint"; hint.textContent = "Pick a plan to see it on the board.";
      host.appendChild(hint);
    }
  }
  linkPlanPanels(picked);
  drawPlan(picked || null);
}
// Once a plan is picked, visually tie the Strategy panel and the Suggested-moves
// panel together — a shared accent stripe + the plan's name on the moves fold —
// so it reads as "these moves serve this plan," not two separate things.
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

function renderBoard() {
  const s = game.boardString();
  const chkKing = (game.status() === "ongoing" && game.inCheck()) ? (game.sideToMove() === "white" ? "K" : "k") : null;
  boardEl.innerHTML = "";
  for (let rank = 7; rank >= 0; rank--) {
    for (let file = 0; file < 8; file++) {
      const i = idx(file, rank);
      const sq = document.createElement("div");
      sq.className = "sq " + ((file + rank) % 2 === 1 ? "light" : "dark");
      sq.dataset.sq = i;
      if (i === mateKingSq) sq.classList.add("mate");
      if (chkKing && s[i] === chkKing) sq.classList.add("check");
      if (assistData && assistData.mateThreat && !assistData.inCheck && s[i] === "K") sq.classList.add("king-danger");
      if (selected === i) sq.classList.add("selected");
      if (legalTargets.includes(i)) { sq.classList.add("target"); if (s[i] !== ".") sq.classList.add("capture"); }
      if (threatSquares.includes(i)) sq.classList.add("threat");
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
    const hangSq = (a.hanging && a.hanging.length) ? a.hanging[0] : -1; // move that flees the threat
    a.candidates.forEach((c) => {
      const isRec = a.recommended && c.uci === a.recommended;
      const saves = c.from === hangSq;
      const el = document.createElement("div");
      el.className = "cand" + (isRec ? " rec" : "") + (saves ? " saves" : "");
      el.innerHTML =
        `<div class="cand-main">` +
        (saves ? `<span class="cand-tag saves-tag">🛡 moves your ${pieceNameAt(hangSq)} to safety</span>` : "") +
        `<span class="cand-move">${c.san || c.uci}${isRec ? " ➤" : ""}</span>` +
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
  renderPieceTip(i);
  paint();
}

function clearSelection() {
  selected = null;
  legalTargets = [];
  renderPieceTip(null);
  paint();
}

// Learn the pieces AS YOU PLAY: the first time you touch each kind, a tip teaches
// how it moves; after that a compact chip lets you open the full tour anytime.
function renderPieceTip(sq) {
  const el = document.getElementById("pieceTip");
  if (!el) return;
  const c = sq == null ? "" : (game.boardString()[sq] || "").toLowerCase();
  const info = c && window.PIECE_INFO && window.PIECE_INFO[c];
  if (!info) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  let seen = [];
  try { seen = (localStorage.getItem("gb_seen_pieces") || "").split(",").filter(Boolean); } catch {}
  const first = !seen.includes(c);
  if (first) {
    seen.push(c);
    try { localStorage.setItem("gb_seen_pieces", seen.join(",")); } catch {}
    el.className = "piece-tip first";
    const diag = window.pieceMoveDiagram ? window.pieceMoveDiagram(c) : "";
    el.innerHTML =
      `<div class="pt-head"><span class="pt-ic">${info.icon}</span> <b>${escapeHtml(info.name)}</b> <span class="pt-new">first time!</span></div>` +
      `<div class="pt-illus">${diag}<div class="pt-moves">${escapeHtml(info.moves)}</div></div>` +
      `<button class="pt-more" id="ptMore">Full tour of the ${escapeHtml(info.name.toLowerCase())} →</button>`;
  } else {
    el.className = "piece-tip";
    el.innerHTML = `<button class="pt-chip" id="ptMore">${info.icon} <b>${escapeHtml(info.name)}</b> — tap for tips ⓘ</button>`;
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

function playMove(from, to) {
  if (game.isPromotion(from, to)) { showPromotion(from, to); return; }
  doPlay(from, to, undefined);
}
// Did this move match the advice that was live? (null = no help was on offer.)
function provenanceOf(from, to) {
  const a = assistData;
  if (!a || a.level === "off" || !(a.candidates || []).length) return null;
  const uci = sqName(from) + sqName(to);
  if ((a.candidates || []).some((c) => c.from === from && c.to === to)) return "followed";
  if (a.recommended && a.recommended.slice(0, 4) === uci) return "followed";
  const sr = a.strategy;
  const picked = sr && sr.strategies && sr.strategies.find((s) => s.id === pickedStrategyId);
  if (picked && picked.moveUci && picked.moveUci.slice(0, 4) === uci) return "followed";
  return "own";
}
function doPlay(from, to, promo) {
  const preFen = game.fen(); // position before the human's move (for the Player Model)
  const prov = provenanceOf(from, to); // classify BEFORE the move (assist is for this position)
  if (prov === "own") indepOwn += 1; else if (prov === "followed") indepFollowed += 1;
  // Strength telemetry (measured BEFORE the move): how far from best was it?
  if (!firstGame && assistData && (assistData.candidates || []).length) {
    try {
      const bestScore = assistData.candidates[0].score;
      const played = game.scoreMove(from, to, depth());
      if (played > -1000000) {
        const cp = Math.max(0, bestScore - played);
        const wasBest = assistData.recommended && (sqName(from) + sqName(to)) === assistData.recommended.slice(0, 4);
        moveReview.push({ cp, wasBest, prov });
        console.log(`[review] ply ${moveReview.length} ${sqName(from)}${sqName(to)} cpLoss=${cp}${wasBest ? " (best)" : ""} ${prov}`);
      }
    } catch {}
  }
  const ok = game.makeMove(from, to, promo);
  selected = null;
  legalTargets = [];
  renderPieceTip(null);
  if (!ok) { paint(); return; }
  lastMove = { from, to };
  recordHumanMove(preFen, from, to, promo); // learn from this move too
  fgOn("move");
  if (!firstGame) persistAiGame(game.status() !== "ongoing"); // save progress (skip the guided game)
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
    const uci = game.engineMoveByElo(parseInt(engineEloEl.value, 10), Math.random()); // strength by chosen AI level
    if (uci.length >= 4) lastMove = uciToSquares(uci);
    busy = false;
    if (!firstGame) persistAiGame(game.status() !== "ongoing");
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
