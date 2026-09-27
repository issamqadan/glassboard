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
    assist: aiAssistOverride,
    aiTokens: aiTokens,
    humanColor: humanColor,
    helpDelivery: helpDelivery,
    helpReceived: helpReceived,
    minutes: setupMinutes,
    timedGame: timedGame,
    humanMs: humanMs,
    engineMs: engineMs,
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
  aiAssistOverride = rec.assist || "guided";
  game.setAssistOverride(aiAssistOverride); // restore the chosen assistance
  humanColor = rec.humanColor === "black" ? "black" : "white"; // restore your side + orientation
  setupMinutes = typeof rec.minutes === "number" ? rec.minutes : 0;
  timedGame = !!rec.timedGame;
  humanMs = typeof rec.humanMs === "number" ? rec.humanMs : setupMinutes * 60000;
  engineMs = typeof rec.engineMs === "number" ? rec.engineMs : setupMinutes * 60000;
  flagged = false; flagLoser = "";
  aiTokens = typeof rec.aiTokens === "number" ? rec.aiTokens : AI_TOKENS_MAX;
  aiLifelineLog = []; aiLastLifelineIdx = -9; momentSeen = {};
  lastMoveLifeline = false; playerFollows = 0; playerTokens = PLAYER_TOKENS_MAX; playerHelpLog = [];
  history = []; uciHistory = []; // resumed from a FEN — opening history can't be reconstructed
  helpDelivery = rec.helpDelivery || "open";
  helpReceived = typeof rec.helpReceived === "number" ? rec.helpReceived : 0;
  helpRevealed = helpDelivery === "open"; helpRequestPending = false;
  aiGameId = id; aiSaved = true;
  selected = null; legalTargets = []; lastMove = null; busy = false; resigned = false; mateKingSq = -1;
  indepOwn = 0; indepFollowed = 0; moveReview = []; lastEval = null;
  pickedStrategyId = null; budgetSpent = 0; helpWasAvailable = false; animMoveKey = null;
  firstGame = false;
  hideOver();
  if (window.GBTheme) GBTheme.setContext(id); // restore this game's board
  setLevelPill(game.assistLevel());
  onPositionChanged();
  startClock();
  // Resumed mid-cycle on the engine's move → let it reply.
  if (game.status() === "ongoing" && game.sideToMove() === engineColor()) setTimeout(engineReply, 300);
  return true;
}
// ---- AI-match setup: pick the opponent + how much help you want ----
// `rating` is an APPROXIMATE (≈) engine-grade estimate — Stockfish 11 limits
// strength by Skill Level (0-20; this build has no dev-calibrated UCI_Elo), plus a
// depth/movetime cap on the low rungs. Honest ballpark, not an official Elo.
const AI_LEVELS = [
  { elo: 700, ic: "🌱", name: "Beginner", desc: "Learning the moves", rating: "≈900", skill: 0, depth: 1 },
  { elo: 1100, ic: "♟", name: "Casual", desc: "Plays for fun", rating: "≈1200", skill: 2, depth: 3 },
  { elo: 1500, ic: "♞", name: "Intermediate", desc: "Knows the basics", rating: "≈1500", skill: 5, movetime: 150 },
  { elo: 1900, ic: "⚔", name: "Club", desc: "Solid, purposeful", rating: "≈1800", skill: 9, movetime: 250 },
  { elo: 2300, ic: "★", name: "Expert", desc: "Sharp & strong", rating: "≈2100", skill: 14, movetime: 500 },
  { elo: 3000, ic: "👑", name: "Master", desc: "The toughest test", rating: "≈2500+", skill: 20, movetime: 800 },
];
// Stockfish parameters (and the ≈rating) for an engine rating from the ladder.
function sfLevelFor(elo) { return AI_LEVELS.reduce((a, l) => (elo <= l.elo && !a ? l : a), null) || AI_LEVELS[AI_LEVELS.length - 1]; }
function ratingFor(elo) { return sfLevelFor(elo).rating; }
// The opponent's move: Stockfish (accurate levels) with a Rust-core fallback if it
// isn't available. A lifeline makes the AI "dig deep" → full-strength Skill 20.
function opponentMove(fen, usedLifeline, baseElo) {
  const rustFallback = () => askEngine("bestMove", { fen, elo: usedLifeline ? 3000 : baseElo, rand: usedLifeline ? 0 : Math.random() });
  if (firstGame || !window.GBEngine) return rustFallback();
  const lvl = sfLevelFor(baseElo);
  const opts = usedLifeline ? { skill: 20, movetime: 900 } : { skill: lvl.skill, movetime: lvl.movetime, depth: lvl.depth };
  return GBEngine.bestMove(fen, opts).then((u) => u || rustFallback()).catch(rustFallback);
}
const RUNGS = [
  { id: "awareness", name: "Hint", desc: "Highlights threats & free material" },
  { id: "coaching", name: "Coach", desc: "Explains threats in words" },
  { id: "suggestion", name: "Guide", desc: "Suggests candidate moves + plans" },
  { id: "guided", name: "Assist", desc: "Shows the single best move" },
  { id: "autopilot", name: "Autopilot", desc: "Can play the move for you" },
];
let setupElo = 1500;            // chosen opponent rating
let setupMode = "full";        // "off" | "full" | "custom"
let setupRung = "suggestion";  // chosen rung when custom
let setupColor = "white";      // "white" | "black" | "random" — the side YOU play
let setupMinutes = 0;          // 0 = untimed; else per-side minutes for the clock
let setupDelivery = "open";    // how help arrives: "open" | "oncall" | "gentleman"
let aiAssistOverride = "guided"; // the override applied to the live game
const assistOverrideFor = () => setupMode === "off" ? "off" : setupMode === "full" ? "guided" : setupRung;

// Which colour the human plays this game (the engine plays the other). Drives the
// board orientation and every "your turn / your pieces" check.
let humanColor = "white";
const engineColor = () => (humanColor === "white" ? "black" : "white");
const flipped = () => humanColor === "black"; // Black at the bottom when you play Black
// A logical square (0=a1..63=h8) → its rendered {row,col} (row 0 = top of the board).
function rc(sq) {
  const f = sq % 8, r = Math.floor(sq / 8);
  return flipped() ? { row: r, col: 7 - f } : { row: 7 - r, col: f };
}
// Does board char `c` belong to the human? (Case = colour; upper = White.)
const isHumanPiece = (c) => c !== "." && (humanColor === "white" ? c === c.toUpperCase() : c === c.toLowerCase());

// --- AI lifelines: the symmetric Glassboard layer ------------------------------
// You get assistance; so does the AI — and when it spends a lifeline to dig deep
// for a stronger move, you SEE it. Not a secret buff: an explicit, visible game
// event with scarcity. "Oh — you needed help there too." Both sides play glass.
const AI_TOKENS_MAX = 3;         // lifelines the AI gets per game
let aiTokens = AI_TOKENS_MAX;    // how many remain
let aiLifelineLog = [];          // [{move, kind, note}] — what the AI spent, for the panel + reveal
let aiLastLifelineIdx = -9;      // move index of the last spend (spacing, so it doesn't spam)
let lastMoveLifeline = false;    // was the most recent move an AI lifeline? (for the board badge)
let momentSeen = {};             // one-shot guards for personality moments this game
// Your side of the symmetric meter: lifelines you've cashed in by following help.
const PLAYER_TOKENS_MAX = 3;
let playerFollows = 0;           // how many times you've played the suggested move
let playerTokens = PLAYER_TOKENS_MAX;
let playerHelpLog = [];          // [{move, note}] — YOUR help events, shown in the glass panel

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
let evalBeforeEngine = null; // white-relative eval right after YOUR move — to spot the AI slipping
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
// Takeback history: a snapshot captured just before each of YOUR moves, so Undo
// rolls back your move AND the engine's reply, restoring the counters too.
let history = [];
// UCI move list (both sides), from the start of the game — used to name the opening
// via the strategy catalog. Only meaningful for games played from move 1 this session.
let uciHistory = [];
// Chess clock (optional). Each side's remaining ms ticks down on its turn; the
// engine's think-time counts against its own clock. Running out = loss on time.
let timedGame = false, humanMs = 0, engineMs = 0;
let clockTimer = null, clockLast = 0, flagged = false, flagLoser = "";

// How help ARRIVES this game (orthogonal to how MUCH help = the assist level):
//   open      — always on screen (no "received" tally; we still log taps you take)
//   oncall    — hidden; you summon it, and every summon is tallied
//   gentleman — start with none; you request mid-game, the opponent must accept
let helpDelivery = "open";
let helpRevealed = false;  // has the move-answer been revealed THIS position?
let helpReceived = 0;      // times you pulled help this game (on-call / granted)
let helpRequestPending = false; // gentleman: a request awaiting the opponent's answer
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

// The pre-game setup screen: choose opponent + assistance, then start.
function showSetup() {
  const sc = document.getElementById("setupScreen");
  if (!sc) { newGame(); return; }
  stopClock(); // pause any running game's clock while you set up a new match
  const grid = document.getElementById("lvlGrid");
  if (grid) {
    grid.innerHTML = AI_LEVELS.map((l) =>
      `<button class="lvl-card${l.elo === setupElo ? " on" : ""}" data-elo="${l.elo}" type="button"><span class="lc-ic">${l.ic}</span><span class="lc-name">${l.name}</span><span class="lc-rating">${l.rating}</span><span class="lc-desc">${l.desc}</span></button>`).join("");
    grid.querySelectorAll(".lvl-card").forEach((c) => c.onclick = () => {
      setupElo = +c.dataset.elo;
      grid.querySelectorAll(".lvl-card").forEach((x) => x.classList.toggle("on", x === c));
    });
  }
  const colors = document.getElementById("colorChoice");
  if (colors) colors.querySelectorAll(".cchoice").forEach((c) => {
    c.classList.toggle("on", c.dataset.color === setupColor);
    c.onclick = () => {
      setupColor = c.dataset.color;
      colors.querySelectorAll(".cchoice").forEach((x) => x.classList.toggle("on", x === c));
    };
  });
  const times = document.getElementById("timeChoice");
  if (times) times.querySelectorAll(".cchoice").forEach((t) => {
    t.classList.toggle("on", parseInt(t.dataset.min, 10) === setupMinutes);
    t.onclick = () => {
      setupMinutes = parseInt(t.dataset.min, 10);
      times.querySelectorAll(".cchoice").forEach((x) => x.classList.toggle("on", x === t));
    };
  });
  const modes = document.getElementById("assistModes");
  if (modes) modes.querySelectorAll(".amode").forEach((m) => {
    m.classList.toggle("on", m.dataset.mode === setupMode);
    m.onclick = () => {
      setupMode = m.dataset.mode;
      modes.querySelectorAll(".amode").forEach((x) => x.classList.toggle("on", x === m));
      renderRungPicker();
      syncDeliveryVisibility();
    };
  });
  const deliv = document.getElementById("deliveryModes");
  if (deliv) deliv.querySelectorAll(".amode").forEach((d) => {
    d.classList.toggle("on", d.dataset.delivery === setupDelivery);
    d.onclick = () => {
      setupDelivery = d.dataset.delivery;
      deliv.querySelectorAll(".amode").forEach((x) => x.classList.toggle("on", x === d));
    };
  });
  syncDeliveryVisibility();
  renderRungPicker();
  const start = document.getElementById("setupStart");
  if (start) start.onclick = startFromSetup;
  sc.hidden = false;
}
// The delivery picker only applies when help is enabled ("No help" → hide it).
function syncDeliveryVisibility() {
  const sec = document.getElementById("deliverySection");
  if (sec) sec.hidden = setupMode === "off";
}
function renderRungPicker() {
  const rp = document.getElementById("rungPicker");
  if (!rp) return;
  if (setupMode !== "custom") { rp.hidden = true; return; }
  rp.hidden = false;
  const note = (RUNGS.find((r) => r.id === setupRung) || {}).desc || "";
  rp.innerHTML = RUNGS.map((r) => `<button class="rung${r.id === setupRung ? " on" : ""}" data-id="${r.id}" type="button">${r.name}</button>`).join("") +
    `<span class="rung-note">${escapeHtml(note)}</span>`;
  rp.querySelectorAll(".rung").forEach((b) => b.onclick = () => { setupRung = b.dataset.id; renderRungPicker(); });
}
function startFromSetup() {
  const sc = document.getElementById("setupScreen");
  if (sc) sc.hidden = true;
  engineEloEl.value = setupElo;
  syncAiLevel();
  aiAssistOverride = assistOverrideFor();
  // Gentleman's Game starts with no help on the board (you request it); the chosen
  // level is what gets GRANTED. On Call also starts hidden. Open Hand shows it.
  helpDelivery = setupMode === "off" ? "open" : setupDelivery;
  // Resolve the side you play (random picks one now). Randomness comes from the UI,
  // not the engine — Math.random is fine here (no reproducibility requirement).
  humanColor = setupColor === "black" ? "black" : setupColor === "white" ? "white" : (Math.random() < 0.5 ? "white" : "black");
  firstGame = false;
  newGame();
}

// ---- Engine worker: deep searches run off the main thread so the board never
// freezes while the engine or the assistance is thinking. Requests are id-tagged
// promises; the main thread keeps its own WASM for instant board operations. ----
let engineWorker = null;
let workerReqId = 0;
const workerPending = new Map();
function initEngineWorker() {
  try {
    engineWorker = new Worker(new URL("./engine-worker.js", import.meta.url), { type: "module" });
    engineWorker.onmessage = (e) => {
      const { id, ok, result, error } = e.data || {};
      const p = workerPending.get(id);
      if (!p) return;
      workerPending.delete(id);
      if (ok) p.resolve(result); else p.reject(new Error(error || "worker error"));
    };
    engineWorker.onerror = () => { engineWorker = null; }; // fall back to main-thread search
  } catch { engineWorker = null; }
}
// Ask the worker to run `op`; falls back to a synchronous main-thread search if
// the worker is unavailable (older browser / load failure) so play never breaks.
function askEngine(op, args) {
  if (!engineWorker) return Promise.resolve(syncEngine(op, args));
  return new Promise((resolve, reject) => {
    const id = ++workerReqId;
    workerPending.set(id, { resolve, reject });
    engineWorker.postMessage({ id, op, args });
  }).catch(() => syncEngine(op, args));
}
// Synchronous fallback on the main thread's own Game (freezes briefly, but works).
function syncEngine(op, args) {
  const g = Game.fromFen(args.fen);
  if (op === "bestMove") return g.engineMoveByElo(args.elo, args.rand);
  if (op === "analyze") { g.setRatings(args.humanElo, args.engineElo); g.setAssistOverride(args.override); return g.assist(args.depth); }
  if (op === "bestScore") return g.bestScore(args.depth);
  if (op === "scoreMove") return g.scoreMove(args.from, args.to, args.depth);
  return null;
}

async function main() {
  await init();
  initEngineWorker();
  if (window.GBEngine) GBEngine.init().catch(() => {}); // warm up Stockfish in the background
  // Track real user scrolls so the anti-jump restore never fights intentional scrolling.
  const markScroll = () => { userScrollAt = nowMs(); };
  window.addEventListener("wheel", markScroll, { passive: true });
  window.addEventListener("touchmove", markScroll, { passive: true });
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
  document.getElementById("new").addEventListener("click", () => { closeMenu(); firstGame = false; showSetup(); });
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
  const gsheet = document.getElementById("glassSheet"), gsclose = document.getElementById("glassSheetClose");
  const closeGlass = () => { if (gsheet) gsheet.style.display = "none"; };
  if (gsclose) gsclose.addEventListener("click", closeGlass);
  if (gsheet) gsheet.addEventListener("click", (e) => { if (e.target === gsheet) closeGlass(); });
  const rb = document.getElementById("resignBtn");
  if (rb) rb.addEventListener("click", () => { closeMenu(); resign(); });
  const ub = document.getElementById("undoBtn");
  if (ub) ub.addEventListener("click", () => { closeMenu(); undoMove(); });
  const orm = document.getElementById("overRematch");
  if (orm) orm.addEventListener("click", () => { hideOver(); newGame(); }); // same settings (opponent, colour, assistance)
  const ons = document.getElementById("overNewSetup");
  if (ons) ons.addEventListener("click", () => { hideOver(); firstGame = false; showSetup(); });
  const ocl = document.getElementById("overClose");
  if (ocl) ocl.addEventListener("click", hideOver);
  // Resume a saved game if the lobby sent us here with ?g=<id>; a total beginner
  // goes straight into the guided first game; otherwise show the match setup.
  const gid = new URLSearchParams(location.search).get("g");
  if (gid && !firstGame && await resumeAiGame(gid)) return;
  if (firstGame) newGame(); else showSetup();
}
const hideOver = () => { const ov = document.getElementById("overOverlay"); if (ov) ov.style.display = "none"; };

function newGame() {
  game = new Game();
  game.setRatings(parseInt(humanEloEl.value, 10), parseInt(engineEloEl.value, 10));
  game.setAssistOverride(firstGame ? "guided" : aiAssistOverride); // the help you chose at setup
  aiGameId = newAiId(); // a fresh slot; only saved once a move is played
  aiSaved = false;
  aiTokens = AI_TOKENS_MAX; aiLifelineLog = []; aiLastLifelineIdx = -9; momentSeen = {}; // fresh
  lastMoveLifeline = false; playerFollows = 0; playerTokens = PLAYER_TOKENS_MAX; playerHelpLog = [];
  history = []; uciHistory = [];
  if (firstGame) helpDelivery = "open"; // the guided game always shows help
  helpReceived = 0; helpRevealed = helpDelivery === "open"; helpRequestPending = false;
  // Clock: from the chosen time control (kept across rematches). Untimed if 0.
  timedGame = !firstGame && setupMinutes > 0;
  humanMs = engineMs = setupMinutes * 60000;
  flagged = false; flagLoser = "";
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
  if (window.GBEngine) GBEngine.newGame(); // reset the opponent engine's state
  setLevelPill(game.assistLevel());
  onPositionChanged();
  startClock();
  // You chose Black → the engine (White) makes the opening move.
  if (game.sideToMove() === engineColor()) setTimeout(engineReply, 300);
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

// Bumped on every position change so a slow async assist result that arrives
// after the player has already moved again is recognised as stale and dropped.
let positionToken = 0;

// Called whenever the position changes (after a move). Paints the board IMMEDIATELY
// (so the move shows with no lag), then fetches the assistance off the main thread
// and repaints with the overlays when it arrives — the board stays interactive
// throughout. Assist is computed once per position, for White's turn.
function onPositionChanged() {
  hanging = [];
  threats = [];
  threatSquares = [];
  freeCaptures = [];
  assistData = null;
  revealedSugg = false; // deeper help must be re-revealed (and re-paid) each position
  revealedBest = false;
  helpRevealed = helpDelivery === "open"; // On Call / Gentleman start each move hidden
  helpRequestPending = false;
  const token = ++positionToken;
  clockLast = Date.now(); // the side to move just changed — don't charge them the gap
  paint(); // instant: board, players, captured, material — before any deep search

  if (game.status() === "ongoing" && game.sideToMove() === humanColor) {
    const fen = game.fen();
    const ov = firstGame ? "guided" : aiAssistOverride;
    askEngine("analyze", { fen, depth: depth(), override: ov, humanElo: parseInt(humanEloEl.value, 10), engineElo: parseInt(engineEloEl.value, 10) })
      .then((json) => {
        if (token !== positionToken) return; // position moved on — drop stale result
        assistData = JSON.parse(json);
        hanging = assistData.hanging || [];
        threats = assistData.threats || [];
        threatSquares = threats.map((t) => t.sq);
        freeCaptures = assistData.freeCaptures || [];
        if ((assistData.candidates || []).length) {
          helpWasAvailable = true; lastEval = assistData.candidates[0].score;
          if (!firstGame) {
            // The AI's move swung the position your way → it slipped, you've a chance.
            if (evalBeforeEngine != null) {
              const swing = lastEval - evalBeforeEngine;
              if (swing >= 160 && !momentSeen.slip) { opponentSlippedMoment(); momentSeen.slip = true; }
              else if (swing < 120) momentSeen.slip = false; // re-arm once it calms
            }
            // First time the position turns genuinely sharp → a single "critical" beat.
            if (Math.abs(lastEval) >= 180 && !momentSeen.crit) { criticalMoment(); momentSeen.crit = true; }
            else if (Math.abs(lastEval) < 120) momentSeen.crit = false;
          }
        }
        evalBeforeEngine = null;
        // Vs the AI there's no opponent to hide help from, so suggestions show
        // immediately — the timed "thinking window" (which exists so a HUMAN
        // opponent doesn't watch you being fed moves) is a multiplayer-only thing.
        keepScroll(() => {
          const fold = document.getElementById("movesFold");
          if (fold) fold.open = false;
          // Open Hand reveals immediately; On Call / Gentleman stay hidden until you ask.
          if ((assistData.candidates || []).length && !firstGame && helpRevealed) revealHint();
          else clearThinkWindow(true);
          // In ask-mode, open the panel so the "Ask for a move" button is visible.
          if (fold && !firstGame && !showAnswer() && (assistData.candidates || []).length) fold.open = true;
          paint(); // repaint with the assistance overlays
        });
      })
      .catch(() => {});
  } else {
    evalBeforeEngine = null;
    clearThinkWindow(true);
  }
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
// Run `fn`, then hold the page scroll where it was — browsers scroll a <details>
// into view when you open it programmatically (desktop Safari immediately, iOS
// Safari after a delay). We snapshot the scroll, then restore it across several
// frames + a short timeout so iOS's late scroll can't jerk the board around.
let userScrollAt = 0; // timestamp of the last real user scroll (see main())
function nowMs() { return (window.performance && performance.now) ? performance.now() : 0; }
function keepScroll(fn) {
  const se = document.scrollingElement || document.documentElement;
  const y = window.scrollY || se.scrollTop || 0;
  const x = window.scrollX || se.scrollLeft || 0;
  const t0 = nowMs();
  const restore = () => {
    if (userScrollAt > t0) return; // you scrolled on purpose since — don't fight it
    if (Math.abs((window.scrollY || se.scrollTop || 0) - y) > 1 || Math.abs((window.scrollX || se.scrollLeft || 0) - x) > 1) {
      window.scrollTo(x, y);
      if (se) { se.scrollTop = y; se.scrollLeft = x; }
    }
  };
  fn();
  restore();
  requestAnimationFrame(restore);
  requestAnimationFrame(() => requestAnimationFrame(restore));
  setTimeout(restore, 60);
  setTimeout(restore, 160);
}
function revealHint(auto) {
  clearThinkWindow();
  hintState = "revealed";
  keepScroll(() => { const fold = document.getElementById("movesFold"); if (fold) fold.open = true; });
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

// Repaints board + panels from current state (no assistance recompute). Every
// repaint re-renders panels and toggles the <details> help panel — which Safari
// "helpfully" scrolls into view, jerking the page on every move. So we snapshot
// the scroll position before rendering and restore it (now + next frame), keeping
// the board perfectly stationary as you and the opponent move.
function paint() {
  keepScroll(() => {
    renderFirstGame();
    renderBoard();
    renderPlayers();
    renderEval();
    renderAiAssist();
    renderCoach();
    renderAssist();
    renderStrategy();
    renderPlanDock();
    renderCaptured();
    renderOpening();
    renderClocks();
    renderGlass();
    renderStatus();
    renderBudget();
    showGameOverIfNeeded();
  });
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
  // The plan (name + steps) always shows — that's strategic direction. The concrete
  // NEXT move is the answer: gated in On Call / Gentleman until you pull help.
  const nextHtml = showAnswer()
    ? `<div class="pd-next"><span class="pd-lab">NEXT</span><button class="pd-move" id="pdMove" title="Play this move">${escapeHtml(picked.moveSan || picked.moveUci)}</button>` +
        `<span class="pd-note">${escapeHtml(picked.moveNote)}</span></div>`
    : `<div class="pd-next"><span class="pd-lab">NEXT</span><button class="pd-move pd-ask" id="pdAsk" type="button">${helpDelivery === "gentleman" ? "🤝 Request" : "🔔 Reveal"}</button>` +
        `<span class="pd-note">move hidden — ask to see it</span></div>`;
  dock.innerHTML =
    `<div class="pd-top"><span class="pd-ic">${STRAT_ICON[picked.id] || "◆"}</span><span class="pd-name">${escapeHtml(picked.name)}</span>` +
      `<span class="pd-pips" title="${doneN}/${picked.steps.length} steps">${pips}</span>` +
      `<button class="pd-steps" id="pdSteps">Steps</button><button class="pd-x" id="pdX" title="Drop this plan" aria-label="Drop this plan">✕</button></div>` +
    nextHtml;
  const pm = dock.querySelector("#pdMove");
  if (pm) pm.onclick = () => { const q = uciSquares(picked.moveUci); if (q) playMove(q.from, q.to, true); };
  const pa = dock.querySelector("#pdAsk");
  if (pa) pa.onclick = askForHelp;
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
    (showAnswer()
      ? `<button class="ss-play" id="ssPlay">Play next — ${escapeHtml(picked.moveSan || picked.moveUci)}</button>`
      : `<button class="ss-play" id="ssAsk">${helpDelivery === "gentleman" ? "🤝 Request the move" : "🔔 Reveal the move"}</button>`);
  const p = document.getElementById("ssPlay");
  if (p) p.onclick = () => { const sh = document.getElementById("stepsSheet"); if (sh) sh.style.display = "none"; const q = uciSquares(picked.moveUci); if (q) playMove(q.from, q.to, true); };
  const pa = document.getElementById("ssAsk");
  if (pa) pa.onclick = () => { const sh = document.getElementById("stepsSheet"); if (sh) sh.style.display = "none"; askForHelp(); };
  const sh = document.getElementById("stepsSheet");
  if (sh) sh.style.display = "grid";
}

// Name the opening in play (from the strategy catalog) and show its professional
// plan — this is the "real named strategies" surface, and it names what BOTH sides
// (including the opponent) are playing. Hidden if off-book or resumed mid-game.
function currentOpening() {
  return (window.GBStrategies && !firstGame) ? GBStrategies.identify(uciHistory) : null;
}
function renderOpening() {
  const el = document.getElementById("openingLine");
  if (!el) return;
  const op = currentOpening();
  if (!op) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML =
    `<span class="ol-ic">📖</span>` +
    `<span class="ol-name">${escapeHtml(op.name)}</span>` +
    (op.eco ? `<span class="ol-eco">${escapeHtml(op.eco)}</span>` : "") +
    `<span class="ol-idea">${escapeHtml(op.idea)}</span>`;
}

// Captured material as one tug-bar above the board (you are White → left side).
function renderCaptured() {
  const el = document.getElementById("materialBar");
  if (el && window.renderMaterialBar) window.renderMaterialBar(el, game.boardString(), humanColor === "white");
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
    `<span class="pl"><span class="dot ${humanColor}"></span> <b>You</b> <span class="tnum">${humanEloEl.value}</span></span>` +
    `<span class="vs">·</span>` +
    `<button class="pl ai-chip" id="aiChip" title="Change AI level"><span class="dot ${engineColor()}"></span> <b>🤖 ${levelName(engineEloEl.value)}</b> <span class="ai-rating">${ratingFor(engineEloEl.value)}</span> <span class="ai-caret">▾</span></button>` +
    (turn ? (turn === humanColor
      ? `<span class="turn you">💡 Your move</span>`
      : `<span class="turn wait">Engine…</span>`) : "");
  const ac = document.getElementById("aiChip");
  if (ac) ac.onclick = () => {
    const f = document.getElementById("setupFold"); if (f) f.open = true;
    const s = document.getElementById("aiLevel"); if (s) { try { s.focus(); } catch {} }
  };
}

// The Opponent's-assistance panel — the symmetric glass-box. Always visible in a
// real Play-AI game so "what help did the AI get?" has a clear, honest home:
// lifelines remaining (buoys that dim as spent) + a live log of every one it used.
function pipRow(left, max) {
  let s = "";
  for (let i = 0; i < max; i++) s += `<span class="ll${i < left ? "" : " spent"}">🛟</span>`;
  return s;
}
// How many moves in a row you've played WITHOUT taking help — a playful reward for
// growing independent (the whole point). Derived from move provenance (undo-safe).
function soloStreak() {
  let n = 0;
  for (let i = moveReview.length - 1; i >= 0; i--) { if (moveReview[i].prov === "own") n++; else break; }
  return n;
}
// The merged, chronological glass record (yours + the AI's help) — for the log sheet.
function glassEvents() {
  return playerHelpLog.map((e) => ({ mv: e.move, side: "you", txt: e.note }))
    .concat(aiLifelineLog.map((e) => ({ mv: e.move, side: "ai", tag: e.tag, txt: e.note })))
    .sort((a, b) => a.mv - b.mv);
}
// The GLASS CARD: a slim, fixed-height "in the open" tally — two lifeline gauges,
// a solo-streak flame, the opening, and a tap-to-open full log. It never grows, so
// the board + suggested moves stay put on mobile; the history lives in a sheet.
function renderAiAssist() {
  const el = document.getElementById("aiAssist");
  if (!el) return;
  if (firstGame) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  const isMaster = parseInt(engineEloEl.value, 10) >= 3000;
  const noHelp = aiAssistOverride === "off";
  const youPips = noHelp ? `<span class="gp-none">pure chess</span>` : pipRow(playerTokens, PLAYER_TOKENS_MAX);
  const streak = soloStreak();
  const flame = streak >= 2 ? `<span class="gp-streak" title="moves in a row without help">🔥 ${streak}</span>` : "";
  const aiUsed = AI_TOKENS_MAX - aiTokens;
  const aiPips = isMaster ? `<span class="gp-none">no lifelines</span>` : pipRow(aiTokens, AI_TOKENS_MAX);
  const aiTag = isMaster ? "" : (aiUsed ? `<span class="gp-tag">deep ${aiUsed}×</span>` : "");
  const op = currentOpening();
  const n = glassEvents().length;
  el.innerHTML =
    `<div class="ga-head"><span class="ga-title">🔎 In the open</span>` +
      `<button class="ga-log" id="glassLogBtn" title="Every help either side took">📜 Log${n ? ` <span class="ga-n">${n}</span>` : ""}</button></div>` +
    `<div class="ga-gauges">` +
      `<div class="gp you"><span class="gp-who">🧑 You</span><span class="gp-pips">${youPips}</span>${flame}</div>` +
      `<div class="gp ai"><span class="gp-who">🤖 ${levelName(engineEloEl.value)}</span><span class="gp-pips">${aiPips}</span>${aiTag}</div>` +
    `</div>` +
    (op ? `<button class="ga-open" id="glassOpenBtn">📖 <b>${escapeHtml(op.name)}</b><span class="ga-open-hint">tap for the plan</span></button>` : "");
  const lb = document.getElementById("glassLogBtn"); if (lb) lb.onclick = openGlassSheet;
  const ob = document.getElementById("glassOpenBtn"); if (ob) ob.onclick = () => {
    if (op) showMoment(`<span class="mo-ic">📖</span><span class="mo-txt"><b>${escapeHtml(op.name)}</b><small>${escapeHtml(op.idea)}</small></span>`, "you");
  };
}
// The full glass log — opened on demand so it never crowds the board.
function openGlassSheet() {
  const body = document.getElementById("glassSheetBody");
  if (!body) return;
  const ev = glassEvents();
  body.innerHTML = ev.length
    ? ev.map((e) => `<div class="gl-row ${e.side}"><span class="gl-mv">move ${e.mv}</span>` +
        `<span class="gl-who">${e.side === "you" ? "🧑 You" : "🤖 " + levelName(engineEloEl.value)}</span>` +
        `<span class="gl-txt">${e.tag ? `<b>${e.tag}</b> — ` : ""}${e.txt}</span></div>`).join("")
    : `<div class="gl-empty">No help taken yet — every time either side takes help, it lands here, in the open.</div>`;
  const sh = document.getElementById("glassSheet"); if (sh) sh.style.display = "grid";
}

// A "moment" — personality without touching the board. It lingers (~7s), shows a
// countdown bar so its exit feels intentional, and you can tap it to dismiss early.
const MOMENT_MS = 7000;
let momentTimer = null;
function hideMoment() { const e = document.getElementById("momentToast"); if (e) e.classList.remove("show"); }
function showMoment(html, kind) {
  let el = document.getElementById("momentToast");
  if (!el) {
    el = document.createElement("div"); el.id = "momentToast"; el.className = "moment-toast";
    el.addEventListener("click", () => { if (momentTimer) clearTimeout(momentTimer); hideMoment(); });
    document.body.appendChild(el);
  }
  el.className = "moment-toast show" + (kind ? " " + kind : "");
  el.innerHTML = html + `<span class="mo-bar" style="animation-duration:${MOMENT_MS}ms"></span>`;
  if (momentTimer) clearTimeout(momentTimer);
  momentTimer = setTimeout(hideMoment, MOMENT_MS);
}
// The kinds of assistance the AI can spend — the same glass-box capabilities a
// human gets, named so its use reads as a game event, not an engine internal.
const LIFELINE_KIND = {
  danger:  { tag: "Danger check", note: "under attack — it dug deep to defend" },
  defend:  { tag: "Deep think",   note: "under pressure — it calculated hard for the best reply" },
  sharp:   { tag: "Deep think",   note: "a sharp position — it looked several moves ahead" },
};
// The AI spent a lifeline — a visible, glass-box game event (never a secret buff).
function aiLifelineMoment(kind) {
  const k = LIFELINE_KIND[kind] || LIFELINE_KIND.sharp;
  const left = aiTokens;
  aiLifelineLog.push({ move: Math.floor(moveReview.length) + 1, kind, tag: k.tag, note: k.note });
  showMoment(
    `<span class="mo-ic">🛟</span><span class="mo-txt"><b>${levelName(engineEloEl.value)} used a lifeline · ${k.tag}</b>`
    + `<small>It was ${k.note}. ${left} lifeline${left === 1 ? "" : "s"} left.</small></span>`,
    "ai");
}
// You played the engine's top move without peeking at the help — celebrate agency.
function foundItMoment() {
  showMoment(`<span class="mo-ic">💪</span><span class="mo-txt"><b>You found that on your own</b>`
    + `<small>Best move on the board — and you didn't need the help. That's the ladder down.</small></span>`, "you");
}
// The AI's move handed you a real swing — it slipped, you've got a chance.
function opponentSlippedMoment() {
  showMoment(`<span class="mo-ic">🎁</span><span class="mo-txt"><b>Your opponent just gave you a chance</b>`
    + `<small>That last move swung the position your way. Look for the punish.</small></span>`, "chance");
}
// The position turned sharp — a decisive moment, once per swing into danger.
function criticalMoment() {
  showMoment(`<span class="mo-ic">🔥</span><span class="mo-txt"><b>Critical position</b>`
    + `<small>Sharp spot — the next few moves matter. Slow down and check for threats.</small></span>`, "crit");
}

// ---- Chess clock ----------------------------------------------------------
function fmtClock(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(t / 60), s = t % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
function stopClock() { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } }
function startClock() {
  stopClock();
  if (!timedGame) return;
  clockLast = Date.now();
  clockTimer = setInterval(tickClock, 200);
}
function tickClock() {
  if (!timedGame || flagged) { stopClock(); return; }
  if (resigned || game.status() !== "ongoing") { stopClock(); return; }
  const now = Date.now();
  const dt = now - clockLast;
  clockLast = now;
  const side = game.sideToMove();
  if (side === humanColor) humanMs = Math.max(0, humanMs - dt);
  else engineMs = Math.max(0, engineMs - dt);
  if ((side === humanColor ? humanMs : engineMs) <= 0) {
    flagged = true; flagLoser = side; stopClock();
    renderClocks();
    if (!firstGame) persistAiGame(true); // game's over → drop the saved slot
    paint(); // showGameOverIfNeeded picks up the flag
    return;
  }
  renderClocks();
}
function renderClocks() {
  const box = document.getElementById("clocks");
  if (!box) return;
  if (!timedGame) { box.hidden = true; return; }
  box.hidden = false;
  const you = document.getElementById("clkYou"), ai = document.getElementById("clkAi");
  const over = flagged || resigned || game.status() !== "ongoing";
  const active = over ? null : game.sideToMove();
  if (you) {
    you.textContent = "🧑 " + fmtClock(humanMs);
    you.className = "clk" + (active === humanColor ? " active" : "") + (humanMs <= 10000 ? " low" : "");
  }
  if (ai) {
    ai.textContent = "🤖 " + fmtClock(engineMs);
    ai.className = "clk" + (active === engineColor() ? " active" : "") + (engineMs <= 10000 ? " low" : "");
  }
}

// ---- Help delivery: is the move-answer shown right now? --------------------
// Open Hand → always. On Call / Gentleman → only once you've pulled it this move.
function showAnswer() { return helpDelivery === "open" || helpRevealed; }
// On Call: summon help for this move (instant, tallied).
function askForHelp() {
  if (helpRevealed || game.sideToMove() !== humanColor || game.status() !== "ongoing") return;
  if (helpDelivery === "gentleman") { requestHelpFromOpponent(); return; }
  helpRevealed = true; helpReceived += 1;
  playerHelpLog.push({ move: Math.floor(uciHistory.length / 2) + 1, note: "asked to see a move" });
  showMoment(`<span class="mo-ic">🔔</span><span class="mo-txt"><b>Help on call</b><small>Shown for this move — ${helpReceived} used so far.</small></span>`, "you");
  revealHint(); paint();
}
// Gentleman's Game: ask, and the opponent decides. The AI grants unless it's
// comfortably ahead — then it may decline (and gloat a little).
function requestHelpFromOpponent() {
  if (helpRequestPending || helpRevealed) return;
  helpRequestPending = true; paint();
  setTimeout(() => {
    let sense = 0; try { sense = game.bestScore(2); } catch {} // human-to-move relative
    const decline = sense <= -180 && Math.random() < 0.5; // AI ahead → might refuse
    helpRequestPending = false;
    if (decline) {
      showMoment(`<span class="mo-ic">🚫</span><span class="mo-txt"><b>Opponent declined</b><small>“I like my position.” No help this time — play on.</small></span>`, "ai");
      paint();
    } else {
      helpRevealed = true; helpReceived += 1;
      playerHelpLog.push({ move: Math.floor(uciHistory.length / 2) + 1, note: "opponent allowed help" });
      showMoment(`<span class="mo-ic">🤝</span><span class="mo-txt"><b>Opponent allowed it</b><small>Help granted — ${helpReceived} so far. It's on the record.</small></span>`, "you");
      revealHint(); paint();
    }
  }, 650);
}

// Takeback: roll back your last move (and the engine's reply) to before you moved.
// Only when it's your turn and the engine isn't mid-search. Board-only + counters;
// the AI's lifelines aren't refunded (they're a spent game event, not a mistake).
function undoMove() {
  if (busy || history.length === 0) return;
  const snap = history.pop();
  game = Game.fromFen(snap.fen);
  game.setRatings(parseInt(humanEloEl.value, 10), parseInt(engineEloEl.value, 10));
  game.setAssistOverride(firstGame ? "guided" : aiAssistOverride);
  indepOwn = snap.indepOwn; indepFollowed = snap.indepFollowed;
  playerFollows = snap.playerFollows; playerTokens = Math.max(0, PLAYER_TOKENS_MAX - playerFollows);
  if (moveReview.length > snap.reviewLen) moveReview.length = snap.reviewLen;
  if (typeof snap.uciLen === "number" && uciHistory.length > snap.uciLen) uciHistory.length = snap.uciLen;
  if (typeof snap.helpLogLen === "number" && playerHelpLog.length > snap.helpLogLen) playerHelpLog.length = snap.helpLogLen;
  selected = null; legalTargets = []; lastMove = null; lastMoveLifeline = false;
  resigned = false; mateKingSq = -1; busy = false; evalBeforeEngine = null;
  hideOver();
  if (!firstGame) persistAiGame(false);
  onPositionChanged();
  startClock(); // keep the clock alive after a takeback
}

function resign() {
  if (resigned || game.status() !== "ongoing") return;
  if (!confirm("Resign to the engine? It'll count as a loss.")) return;
  resigned = true;
  stopClock();
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
  const over = resigned || flagged || st !== "ongoing";
  const rb = document.getElementById("resignBtn");
  if (rb) rb.hidden = over;
  if (!over) { ov.style.display = "none"; mateKingSq = -1; return; }
  let winner = "", reason = "";
  if (flagged) { winner = flagLoser === humanColor ? engineColor() : humanColor; reason = "time"; } // ran out of time
  else if (resigned) { winner = engineColor(); reason = "resignation"; } // you resigned → the engine wins
  else if (st === "checkmate") { winner = game.sideToMove() === "white" ? "black" : "white"; reason = "checkmate"; }
  else if (st === "stalemate") { reason = "stalemate"; }
  else if (st === "fifty-move") { reason = "fifty-move rule"; }
  const draw = winner === "", won = winner === humanColor;
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
  } else if (reason === "time") {
    how = won ? "The engine ran out of time — you win on the clock. ⏱" : "Your clock hit zero — a loss on time. ⏱";
  } else {
    how = "Fifty moves without a capture or pawn move — an automatic draw.";
  }

  res.innerHTML = (st === "checkmate" ? `<span class="over-mate">CHECKMATE</span>` : "") +
    (draw ? "Draw" : won ? "You win! 🎉" : "You lose");
  res.className = "over-result " + (draw ? "draw" : won ? "win" : "loss");
  rea.innerHTML = `<div class="over-how">${how}</div>` + aiLifelineHtml() + reviewHtml() + independenceHtml() + agencySummaryHtml();
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
// Post-game reveal of the AI's assistance — the symmetry made explicit: you both
// played glass. How many lifelines it needed is a read on how close the game was.
function aiLifelineHtml() {
  if (firstGame || parseInt(engineEloEl.value, 10) >= 3000) return "";
  const used = AI_TOKENS_MAX - aiTokens;
  const line = used === 0
    ? `🤖 ${levelName(engineEloEl.value)} never reached for a lifeline — it held its own all game.`
    : `🤖 ${levelName(engineEloEl.value)} spent <b>${used}</b> of ${AI_TOKENS_MAX} lifeline${used === 1 ? "" : "s"} — moments it was in trouble and dug deep. You had it on the ropes ${used === 1 ? "once" : used + " times"}.`;
  return `<div class="over-lifeline">${line}</div>`;
}
function independenceHtml() {
  // In On Call / Gentleman the answer was hidden, so independence is HONEST:
  // help received (asked/granted) vs moves you made without it. In Open Hand the
  // answer was always visible, so we don't claim independence — we report taps.
  const moves = moveReview.length;
  if (moves < 2) return "";
  if (helpDelivery === "open") {
    return `<div class="over-indep">` +
      `<div class="oi-head">☀️ Open Hand</div>` +
      `<div class="oi-sub">Help was on screen all game. You <b>took the suggested move ${indepFollowed}</b> time${indepFollowed === 1 ? "" : "s"} of ${moves}. (Independence isn't scored when the answer's visible — switch to <b>On Call</b> to measure it.)</div>` +
      `</div>`;
  }
  const onOwn = Math.max(0, moves - helpReceived);
  const pct = Math.round((onOwn / moves) * 100);
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem("gb_indep_last")); } catch {}
  localStorage.setItem("gb_indep_last", JSON.stringify(pct));
  let trend = "";
  if (prev != null && isFinite(prev)) {
    const d = pct - prev;
    trend = d > 0 ? ` <span class="oi-up">▲ up from ${prev}%</span>` : d < 0 ? ` <span class="oi-dn">▼ from ${prev}%</span>` : " · same as last game";
  }
  const label = helpDelivery === "gentleman" ? "🤝 Gentleman's Game" : "🔔 On Call";
  return `<div class="over-indep">` +
    `<div class="oi-head">🧠 Independence <b>${pct}%</b>${trend}</div>` +
    `<div class="indep-bar"><div class="indep-fill" style="width:${pct}%"></div></div>` +
    `<div class="oi-sub">${label}: you played <b>${onOwn}</b> of ${moves} moves without asking — help was pulled <b>${helpReceived}</b> time${helpReceived === 1 ? "" : "s"}. Needing it less is the whole idea.</div>` +
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
const planCxy = (sq) => { const p = rc(sq); return { x: (p.col + 0.5) * 100, y: (p.row + 0.5) * 100 }; }; // orientation-aware
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
      if (mv) { mv.style.cursor = "pointer"; mv.addEventListener("click", () => { const q = uciSquares(picked.moveUci); if (q) playMove(q.from, q.to, true); }); }
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
  // Render top→bottom, left→right in the VIEWER's orientation. When you play Black
  // the board flips (Black at the bottom) so your pieces face you.
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const rank = flipped() ? row : 7 - row;
      const file = flipped() ? 7 - col : col;
      const i = idx(file, rank);
      const sq = document.createElement("div");
      sq.className = "sq " + ((file + rank) % 2 === 1 ? "light" : "dark");
      sq.dataset.sq = i;
      if (i === mateKingSq) sq.classList.add("mate");
      if (chkKing && s[i] === chkKing) sq.classList.add("check");
      if (assistData && assistData.mateThreat && !assistData.inCheck && s[i] === (humanColor === "white" ? "K" : "k")) sq.classList.add("king-danger");
      if (selected === i) sq.classList.add("selected");
      if (legalTargets.includes(i)) { sq.classList.add("target"); if (s[i] !== ".") sq.classList.add("capture"); }
      if (threatSquares.includes(i)) sq.classList.add("threat");
      if (hanging.includes(i)) sq.classList.add("hanging");
      if (freeCaptures.includes(i)) sq.classList.add("free");
      if (firstGame && fgHintSquares.includes(i)) sq.classList.add("hint");
      if (lastMove && (lastMove.from === i || lastMove.to === i)) {
        sq.classList.add("lastmove");
        if (lastMoveLifeline) sq.classList.add("lifeline-move"); // the AI's assisted move, marked on the board
      }

      // Coordinate labels on the edge squares (bottom row = files, left col = ranks).
      if (row === 7) sq.appendChild(coord("file", FILES[file]));
      if (col === 0) sq.appendChild(coord("rank", String(rank + 1)));

      const c = s[i];
      if (c !== ".") {
        const span = document.createElement("span");
        span.className = "piece " + (isWhitePiece(c) ? "white" : "black");
        if (typeof pieceSVG === "function") span.innerHTML = pieceSVG(c);
        else span.textContent = GLYPH[c.toLowerCase()];
        sq.appendChild(span);
      }
      // Buoy badge on the square the AI's lifeline move landed on — unmistakable.
      if (lastMoveLifeline && lastMove && i === lastMove.to) {
        const b = document.createElement("span");
        b.className = "ll-badge"; b.textContent = "🛟"; b.title = "The AI used a lifeline for this move";
        sq.appendChild(b);
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
  const rIdx = (sq) => { const p = rc(sq); return p.row * 8 + p.col; }; // square → rendered cell (orientation-aware)
  const toEl = boardEl.children[rIdx(lastMove.to)];
  const piece = toEl && toEl.querySelector(".piece");
  if (!piece) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cell = toEl.getBoundingClientRect().width || 0;
  if (!cell) return;
  const from = rc(lastMove.from), to = rc(lastMove.to);
  const dCol = from.col - to.col; // start offset in rendered space, then glide to 0
  const dRow = from.row - to.row;
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
  // Undo is offered only when it's your turn (the engine has replied), you have a
  // move to take back, and it's a real game.
  const ub = document.getElementById("undoBtn");
  if (ub) ub.hidden = firstGame || flagged || st !== "ongoing" || side !== humanColor || history.length === 0;
}

// A playful character for a suggested move — derived from the board, not vibes:
// a capture that wins material is Aggressive, an even trade is Simplify, a pawn
// pushing into enemy territory is Sneaky, a quiet improving move is Safe.
const PVAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function moveFlavor(c) {
  const bs = game.boardString();
  const tgt = bs[c.to], mover = bs[c.from] || "";
  const isCap = tgt >= "a" && tgt <= "z"; // an enemy (black) piece sits on the target
  if (isCap) {
    const gain = (PVAL[tgt] || 0) - (PVAL[mover.toLowerCase()] || 0);
    if (gain === 0) return { key: "simp", ic: "♻", name: "Simplify" };
    return { key: "aggr", ic: "⚔", name: "Aggressive" };
  }
  const toRank = 1 + Math.floor(c.to / 8);
  if (mover === "P" && toRank >= 5) return { key: "sneak", ic: "🗡", name: "Sneaky" };
  return { key: "safe", ic: "🛡", name: "Safe" };
}
function renderAssist() {
  assistEl.innerHTML = "";
  if (!assistData) {
    assistEl.innerHTML = `<div class="none">Engine to move — no suggestions this turn.</div>`;
    return;
  }
  const a = assistData;
  // On Call / Gentleman: until you pull help this move, show the ask button — never
  // the move itself (so it can't be read off the screen). Safety highlights + coach
  // stay on the board regardless; only the move-answer is gated.
  if (!firstGame && !showAnswer() && (a.candidates || []).length) {
    if (helpDelivery === "gentleman") {
      assistEl.innerHTML = helpRequestPending
        ? `<div class="ask-help waiting">🤝 Waiting for your opponent to allow it…</div>`
        : `<button class="ask-help" id="askHelp" type="button">🤝 Request help <span class="ask-sub">opponent must allow</span></button>`;
    } else {
      assistEl.innerHTML = `<button class="ask-help" id="askHelp" type="button">🔔 Ask for a move${helpReceived ? ` <span class="ask-n">${helpReceived} used</span>` : ""}</button>`;
    }
    assistEl.innerHTML += `<div class="ask-note">Play on your own, or ask — every ask is on the record.</div>`;
    const b = document.getElementById("askHelp");
    if (b) b.onclick = askForHelp;
    return;
  }
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
    if (q) sm.addEventListener("click", () => playMove(q.from, q.to, true));
    assistEl.appendChild(sm);
  }
  // Move-by-move help is free here (vs AI / casual). It's collapsed by default
  // under "Suggested moves" — secondary to the strategy.
  if (a.candidates.length) {
    const hangSq = (a.hanging && a.hanging.length) ? a.hanging[0] : -1; // move that flees the threat
    a.candidates.forEach((c) => {
      const isRec = a.recommended && c.uci === a.recommended;
      const saves = c.from === hangSq;
      const fl = moveFlavor(c);
      const el = document.createElement("div");
      el.className = "cand" + (isRec ? " rec" : "") + (saves ? " saves" : "");
      el.innerHTML =
        `<div class="cand-main">` +
        (saves ? `<span class="cand-tag saves-tag">🛡 moves your ${pieceNameAt(hangSq)} to safety</span>` : "") +
        `<span class="cand-move">${c.san || c.uci}${isRec ? " ➤" : ""}</span> <span class="cand-flavor fl-${fl.key}">${fl.ic} ${fl.name}</span>` +
        (c.note ? `<div class="cand-note">${escapeHtml(c.note)}</div>` : "") +
        `</div><span class="score">${fmtScore(c.score)}</span>`;
      el.addEventListener("click", () => playMove(c.from, c.to, true));
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
  if (busy || flagged || game.status() !== "ongoing" || game.sideToMove() !== humanColor) return;
  const c = game.boardString()[i];

  if (selected === null) {
    if (isHumanPiece(c)) selectSquare(i);
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
  if (isHumanPiece(c)) selectSquare(i);
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

// viaHelp = the move was played by CLICKING the assistance UI (a suggested move,
// the plan move, the best-move chip). A move you make on the board yourself is
// your own choice — even if it happens to match the recommendation.
function playMove(from, to, viaHelp) {
  if (game.isPromotion(from, to)) { showPromotion(from, to, viaHelp); return; }
  doPlay(from, to, undefined, viaHelp);
}
// How was this move sourced? "followed" = you clicked the help; "own" = you moved
// on the board yourself; null = no help was on offer this position. NOT based on
// whether the move matches the advice — matching your own good move is still YOURS.
function provenanceOf(viaHelp) {
  const a = assistData;
  if (!a || a.level === "off" || !(a.candidates || []).length) return null;
  return viaHelp ? "followed" : "own";
}
function doPlay(from, to, promo, viaHelp) {
  if (flagged || busy) return; // clock's out, or it's the engine's turn
  const preFen = game.fen(); // position before the human's move (for the Player Model)
  // Takeback snapshot: this position + the pre-move counters. Undo restores here.
  history.push({ fen: preFen, indepOwn, indepFollowed, reviewLen: moveReview.length, playerFollows, uciLen: uciHistory.length, helpLogLen: playerHelpLog.length });
  const prov = provenanceOf(viaHelp); // by SOURCE (clicked help vs your own board move)
  if (prov === "own") indepOwn += 1; else if (prov === "followed") indepFollowed += 1;
  lastMoveLifeline = false; // your move — clear the AI's lifeline board badge
  if (prov === "followed") {
    playerFollows += 1; playerTokens = Math.max(0, PLAYER_TOKENS_MAX - playerFollows);
    // Glass: taking a suggested move is help received — put it on the record.
    playerHelpLog.push({ move: Math.floor(uciHistory.length / 2) + 1, note: "played the suggested move" });
  }
  // Strength telemetry: how far from best was this move? The cp-loss needs a deep
  // search (scoreMove at depth()), so it runs on the worker and fills in the entry
  // when it returns — the "found it on your own" moment (which only needs wasBest)
  // fires immediately, and the review entry keeps its slot so counts stay correct.
  if (!firstGame && assistData && (assistData.candidates || []).length) {
    const bestScore = assistData.candidates[0].score;
    const wasBest = assistData.recommended && (sqName(from) + sqName(to)) === assistData.recommended.slice(0, 4);
    const entry = { cp: null, wasBest, prov };
    moveReview.push(entry);
    if (prov === "own" && wasBest && !revealedBest && (momentSeen.found || 0) < 3 && moveReview.length >= 3) {
      momentSeen.found = (momentSeen.found || 0) + 1; foundItMoment();
    }
    askEngine("scoreMove", { fen: preFen, from, to, depth: depth() })
      .then((played) => { if (played > -1000000) entry.cp = Math.max(0, bestScore - played); })
      .catch(() => {});
  }
  const ok = game.makeMove(from, to, promo);
  selected = null;
  legalTargets = [];
  renderPieceTip(null);
  if (!ok) { history.pop(); paint(); return; } // illegal → undo the snapshot we pushed
  lastMove = { from, to };
  uciHistory.push(sqName(from) + sqName(to) + (promo || "")); // for opening identification
  recordHumanMove(preFen, from, to, promo); // learn from this move too
  fgOn("move");
  // White-relative eval right after your move (black to move → negate). Compared
  // after the AI replies to detect a swing your way (the AI "slipping").
  try { evalBeforeEngine = game.status() === "ongoing" ? -game.bestScore(2) : null; } catch { evalBeforeEngine = null; }
  if (!firstGame) persistAiGame(game.status() !== "ongoing"); // save progress (skip the guided game)
  onPositionChanged(); // now Black to move → assist cleared
  setTimeout(engineReply, 150);
}
function showPromotion(from, to, viaHelp) {
  const ov = document.getElementById("promoOverlay");
  if (!ov) { doPlay(from, to, "q", viaHelp); return; }
  const choices = ov.querySelector(".promo-choices");
  const white = humanColor === "white";
  choices.innerHTML = ["q", "r", "b", "n"].map((p) => {
    const glyphChar = white ? p.toUpperCase() : p;
    const g = typeof pieceSVG === "function" ? pieceSVG(glyphChar) : glyphChar;
    return `<button class="promo-pick" data-p="${p}"><span class="piece ${white ? "white" : "black"}">${g}</span></button>`;
  }).join("");
  choices.querySelectorAll(".promo-pick").forEach((b) => { b.onclick = () => { ov.style.display = "none"; doPlay(from, to, b.dataset.p, viaHelp); }; });
  ov.style.display = "grid";
}

function engineReply() {
  if (game.status() !== "ongoing") {
    onPositionChanged();
    return;
  }
  busy = true; // the board already shows "Engine…" from the prior repaint
  const baseElo = parseInt(engineEloEl.value, 10);
  // Should the AI reach for a lifeline? It "senses" the position with a quick
  // shallow look (bestScore, depth 2 — cheap, stays on the main thread). When it's
  // even or worse — under real pressure — and still has a lifeline unused-recently,
  // it digs deep (a Master-strength reply). Fires in ordinary competitive play.
  let usedLifeline = false, llKind = "";
  const spaced = moveReview.length - aiLastLifelineIdx >= 2;
  if (!firstGame && aiTokens > 0 && baseElo < 3000 && moveReview.length >= 3 && spaced) {
    let llSense = 0;
    try { llSense = game.bestScore(2); } catch { llSense = 0; }
    if (llSense <= -40) { // you've earned a real edge → it's under pressure
      usedLifeline = true; aiTokens--; aiLastLifelineIdx = moveReview.length;
      llKind = llSense <= -140 ? "danger" : "defend";
    }
  }
  const fenBefore = game.fen(); // guard: drop the reply if the game moved on / reset
  opponentMove(fenBefore, usedLifeline, baseElo)
    .then((uci) => {
      // Stale/aborted (new game, resume, resign) — the position isn't the one we sent.
      if (flagged || game.fen() !== fenBefore || game.status() !== "ongoing" || game.sideToMove() !== engineColor()) { busy = false; return; }
      if (uci && uci.length >= 4) {
        const sq = uciToSquares(uci);
        game.makeMove(sq.from, sq.to, uci.length > 4 ? uci[4] : undefined);
        lastMove = sq;
        uciHistory.push(uci); // for opening identification
        lastMoveLifeline = usedLifeline; // mark the assisted move on the board
      }
      busy = false;
      if (usedLifeline) aiLifelineMoment(llKind);
      if (!firstGame) persistAiGame(game.status() !== "ongoing");
      onPositionChanged();
      fgOn("engine");
    })
    .catch(() => { busy = false; });
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
