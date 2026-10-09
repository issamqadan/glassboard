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
    aiStyle: aiStyle,
    aiPersona: aiPersona,
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
  aiStyle = (rec.aiStyle && AI_STYLES[rec.aiStyle]) ? rec.aiStyle : "balanced";
  // Derived from the game id, not re-rolled: a game saved before personas
  // existed still gets ONE stable opponent, and the lobby agrees with us.
  aiPersona = window.GBAiCast.forGame(Object.assign({}, rec, { aiStyle: aiStyle }));
  setupMinutes = typeof rec.minutes === "number" ? rec.minutes : 0;
  timedGame = !!rec.timedGame;
  humanMs = typeof rec.humanMs === "number" ? rec.humanMs : setupMinutes * 60000;
  engineMs = typeof rec.engineMs === "number" ? rec.engineMs : setupMinutes * 60000;
  flagged = false; flagLoser = "";
  aiTokens = typeof rec.aiTokens === "number" ? rec.aiTokens : AI_TOKENS_MAX;
  aiLifelineLog = []; aiLastLifelineIdx = -9; momentSeen = {};
  lastMoveLifeline = false; playerFollows = 0; playerTokens = PLAYER_TOKENS_MAX; playerHelpLog = [];
  history = []; uciHistory = []; posCounts = Object.create(null); repetitionDraw = false; recordPosition(); // resumed from a FEN — opening history can't be reconstructed
  helpDelivery = rec.helpDelivery || "open";
  helpReceived = typeof rec.helpReceived === "number" ? rec.helpReceived : 0;
  helpRevealed = helpDelivery === "open"; helpRequestPending = false;
  aiGameId = id; aiSaved = true;
  if (window.GBAssistUI && GBAssistUI.capTrayReset) GBAssistUI.capTrayReset();
  selected = null; legalTargets = []; lastMove = null; busy = false; resigned = false; aiResigned = false; aiHopeless = 0; mateKingSq = -1;
  indepOwn = 0; indepFollowed = 0; moveReview = []; rateMoves = []; ratePending = []; lastRating = null; lastEval = null; evalTrail = [];
  pickedStrategyId = null; followBook = false; budgetSpent = 0; helpWasAvailable = false; animMoveKey = null;
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
  { elo: 1500, ic: "♞", name: "Intermediate", desc: "Knows the basics", rating: "≈1500", skill: 6, movetime: 300 },
  { elo: 1900, ic: "⚔", name: "Club", desc: "Solid, purposeful", rating: "≈1800", skill: 9, movetime: 500 },
  { elo: 2300, ic: "★", name: "Expert", desc: "Sharp & strong", rating: "≈2100", skill: 12, movetime: 800 },
  { elo: 3000, ic: "👑", name: "Master", desc: "The toughest test", rating: "≈2500+", skill: 20, movetime: 1400 },
];
// Stockfish parameters (and the ≈rating) for an engine rating from the ladder.
function sfLevelFor(elo) { return AI_LEVELS.reduce((a, l) => (elo <= l.elo && !a ? l : a), null) || AI_LEVELS[AI_LEVELS.length - 1]; }
function ratingFor(elo) { return sfLevelFor(elo).rating; }
// The opponent's move: Stockfish (accurate levels) with a Rust-core fallback if it
// isn't available. A lifeline makes the AI "dig deep" → full-strength Skill 20.
// SYMMETRIC ASSISTANCE: the AI scales UP as YOU lean on help. Your "lean" is the
// share of your moves that took the suggestion; the more you use help, the closer
// the opponent plays to full strength — a visible, both-sides handicap (never a
// secret buff). Play mostly solo and it stays at the level you picked.
function aiLean() {
  const yours = indepOwn + indepFollowed;
  return yours > 0 ? indepFollowed / yours : 0; // 0..1
}
// The opponent gets tougher as you lean on help — but is ALWAYS kept below the
// full-strength assist (skill 20 @ 1400ms), so following the top move reliably WINS
// (with more effort at the higher levels). Ceiling is 16 (~4 skill below the assist).
// Opponents below Master stay under the full-strength assist, so following the help
// wins there. MASTER IS DELIBERATELY NOT CAPPED — it plays at full strength (skill 20),
// so it is a genuine wall: with perfect help you hold/draw, you don't steamroll it.
const AI_SKILL_CEIL = 16;        // the cap for every level EXCEPT Master
const AI_SKILL_CEIL_MASTER = 20; // Master plays its real strength
function aiBoost(baseElo) {
  const lvl = sfLevelFor(baseElo);
  const lean = aiLean();
  const hardCeil = lvl.skill >= 20 ? AI_SKILL_CEIL_MASTER : AI_SKILL_CEIL;
  const ceil = Math.min(hardCeil, Math.max(lvl.skill, lvl.skill + 4)); // lean adds up to +4, never past the cap
  const skill = Math.min(ceil, Math.round(lvl.skill + lean * (ceil - lvl.skill)));
  const baseMt = lvl.movetime || (lvl.depth ? 300 : 500);
  // Think-time capped below the assist's (1400ms) so the recommendation is never
  // out-searched — following it out-calculates the opponent instead of losing ground.
  // Sub-Master opponents stay under the assist's think-time (so following help wins);
  // Master gets its full time — it's meant to be a real fight, not a handicapped one.
  const mtCeil = lvl.skill >= 20 ? 1400 : 1100;
  const movetime = Math.min(mtCeil, Math.round(baseMt + lean * (mtCeil - baseMt)));
  const depth = lean > 0.15 ? undefined : lvl.depth;
  return { lean, skill, movetime, depth, base: lvl.skill, boosted: skill > lvl.skill };
}
// Opponent PERSONALITIES. Each opponent is the same engine, but plays with a style
// by choosing among Stockfish's NEAR-BEST candidate moves (bounded so it never
// blunders) — so games feel like different people, not one sterile brain.
const AI_STYLES = {
  balanced:   { ic: "⚖", name: "Balanced",   desc: "Plays the objectively best move — a classic all-rounder." },
  aggressive: { ic: "⚔", name: "Aggressive", desc: "Attacks, captures, and chases your king. Loves sharp play." },
  positional: { ic: "♟", name: "Positional", desc: "Slow squeeze — space, outposts, and quiet build-up." },
  defensive:  { ic: "🛡", name: "Defensive",  desc: "Rock-solid — trades, simplifies, and keeps its king safe." },
  wildcard:   { ic: "🎲", name: "Wildcard",   desc: "Unpredictable — mixes it up among sound moves." },
};
let setupStyle = (() => { try { return (JSON.parse(localStorage.getItem("gb_setup")) || {}).style || "balanced"; } catch { return "balanced"; } })();

// ---- Your opponent has a NAME and a personality ----------------------------
// "Glassboard AI" is a product, not an opponent. A named character with a voice
// makes a game feel like a match against someone — and makes beating them mean
// something. The roster is picked by STYLE so the name matches how they play.
// The roster itself now lives in gb-ai-cast.js so the lobby names the SAME
// opponent you faced on the board. See that file for why.
const AI_CAST = (window.GBAiCast && window.GBAiCast.CAST) || {};
let aiPersona = null; // { n, e, t } — this game's opponent
function pickPersona(style) { return window.GBAiCast.pick(style); }
// Display name for the opponent: their character name, with the level as their rank.
function aiName() { return aiPersona ? aiPersona.n : "Your opponent"; }
function aiEmoji() { return aiPersona ? aiPersona.e : "🤖"; }
let aiStyle = "balanced"; // the live game's opponent personality

function givesCheck(uci) {
  try { const g = Game.fromFen(game.fen()); const q = uciToSquares(uci); if (!g.makeMove(q.from, q.to, uci.length > 4 ? uci[4] : undefined)) return false; return g.inCheck(); } catch { return false; }
}
// Choose among near-best candidates by the opponent's style. Candidates are
// Stockfish's MultiPV list (best-first, with evals); we only ever pick from moves
// within a small eval margin of the best, so personality never costs a blunder.
function pickStyleMove(cands, style, aiWhite, skill) {
  if (!cands || !cands.length) return null;
  cands = cands.filter((c) => c && c.uci);
  if (!cands.length) return null;
  if (style === "balanced" || cands.length === 1) return cands[0].uci;
  const best = cands[0].cp;
  // STYLE IS *HOW* YOU PLAY AMONG EQUALLY GOOD MOVES — never a handicap. The margin
  // of "personality" therefore SHRINKS as strength rises: a club player can indulge
  // half a pawn for flavour, a Master cannot. (A flat 90cp margin was letting a
  // Wildcard Master bleed ~7 pawns over a game and resign — it wasn't a Master.)
  const sk = typeof skill === "number" ? skill : 12;
  const wide = style === "aggressive" || style === "wildcard";
  const base = wide ? 90 : 55;
  // skill 0-10 → full margin … skill 20 → ~1/6 of it (15cp wide / 9cp tight).
  const scale = sk <= 10 ? 1 : Math.max(0.17, 1 - (sk - 10) * 0.083);
  const margin = Math.round(base * scale);
  const pool = cands.filter((c) => best - c.cp <= margin).slice(0, 5);
  if (pool.length <= 1) return cands[0].uci;
  if (style === "wildcard") return pool[Math.floor(Math.random() * pool.length)].uci;
  const bs = game.boardString();
  const kingCh = aiWhite ? "k" : "K"; // the ENEMY (human) king
  let ek = -1; for (let i = 0; i < 64; i++) if (bs[i] === kingCh) { ek = i; break; }
  const isEnemy = (c) => c && c !== "." && (aiWhite ? (c >= "a" && c <= "z") : (c >= "A" && c <= "Z"));
  let bestMv = pool[0].uci, bestScore = -1e9;
  for (const c of pool) {
    const q = uciToSquares(c.uci); if (!q) continue;
    const mover = bs[q.from] || "", tgt = bs[q.to] || "";
    const cap = isEnemy(tgt);
    let s = 0;
    if (style === "aggressive") {
      if (cap) s += 3 + (PVAL[tgt.toLowerCase()] || 0);
      if (ek >= 0) s += Math.max(0, 7 - (Math.abs((q.to % 8) - (ek % 8)) + Math.abs(((q.to / 8) | 0) - ((ek / 8) | 0)))); // closer to the enemy king
      if (givesCheck(c.uci)) s += 6;
      if (mover === "P" || mover === "p") s += aiWhite ? ((q.to / 8) | 0) : (7 - ((q.to / 8) | 0)); // pushing pawns up
    } else if (style === "positional") {
      if ([27, 28, 35, 36].includes(q.to)) s += 4;                        // central squares
      const home = aiWhite ? 0 : 7;
      if ("NBnb".includes(mover) && ((q.from / 8) | 0) === home) s += 4;   // develop a piece
      if (cap) s -= 2;                                                     // avoid early trades
    } else if (style === "defensive") {
      if (cap) { const gain = (PVAL[tgt.toLowerCase()] || 0) - (PVAL[(mover || "p").toLowerCase()] || 0); if (gain === 0) s += 3; } // simplify by equal trades
      if ((mover === "K" || mover === "k") && Math.abs((q.to % 8) - (q.from % 8)) === 2) s += 5; // castle to safety
      s += 0.5; // gentle bias toward quiet, solid moves
    }
    s += (c.cp - best) * 0.02; // tie-break toward the stronger move
    if (s > bestScore) { bestScore = s; bestMv = c.uci; }
  }
  return bestMv;
}
function opponentMove(fen, usedLifeline, baseElo) {
  const rustFallback = () => askEngine("bestMove", { fen, elo: usedLifeline ? 3000 : baseElo, rand: usedLifeline ? 0 : Math.random() });
  if (firstGame || !window.GBEngine) return rustFallback();
  const b = aiBoost(baseElo);
  const moves = uciHistory.length ? uciHistory.slice() : null; // full history → repetition-aware play
  // Styled opponent: pick among near-best candidates by personality. Full-strength
  // lifelines and the Balanced style just play the single best move.
  if (!usedLifeline && aiStyle !== "balanced" && GBEngine.bestMoves) {
    const opts = { skill: b.skill, movetime: b.movetime, multipv: 4 };
    if (moves) opts.moves = moves;
    return GBEngine.bestMoves(fen, opts)
      .then((cands) => pickStyleMove(cands, aiStyle, engineColor() === "white", b.skill) || rustFallback())
      .catch(rustFallback);
  }
  const opts = usedLifeline ? { skill: 20, movetime: 900 } : { skill: b.skill, movetime: b.movetime, depth: b.depth };
  if (moves) opts.moves = moves;
  return GBEngine.bestMove(fen, opts).then((u) => u || rustFallback()).catch(rustFallback);
}
const RUNGS = [
  { id: "awareness", name: "Hint", desc: "Highlights threats & free material" },
  { id: "coaching", name: "Coach", desc: "Explains threats in words" },
  { id: "suggestion", name: "Guide", desc: "Suggests candidate moves + plans" },
  { id: "guided", name: "Assist", desc: "Shows the single best move" },
  { id: "autopilot", name: "Autopilot", desc: "Can play the move for you" },
];
// Your last match setup is REMEMBERED, so starting another game is one tap — the
// defaults below only apply on a first-ever visit.
const SETUP_KEY = "gb_setup";
const savedSetup = (() => { try { return JSON.parse(localStorage.getItem(SETUP_KEY)) || {}; } catch { return {}; } })();
function rememberSetup() {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify({
      elo: setupElo, mode: setupMode, rung: setupRung, color: setupColor,
      minutes: setupMinutes, delivery: setupDelivery, style: setupStyle,
    }));
  } catch {}
}
let setupElo = typeof savedSetup.elo === "number" ? savedSetup.elo : 1500;   // chosen opponent rating
let setupMode = savedSetup.mode || "full";        // "off" | "full" | "custom"
let setupRung = savedSetup.rung || "suggestion";  // chosen rung when custom
let setupColor = savedSetup.color || "white";     // "white" | "black" | "random" — the side YOU play
let setupMinutes = typeof savedSetup.minutes === "number" ? savedSetup.minutes : 0; // 0 = untimed
let setupDelivery = savedSetup.delivery || "open"; // how help arrives: "open" | "oncall" | "gentleman"
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
// ---- THE HELP BUDGET ------------------------------------------------------
// A finite allowance, sized to the gap, spent as help is OFFERED (not as it's
// followed — playerFollows below still tracks that, for the independence score).
// Safety signals are never spendable, so running out means "on your own
// judgement", never "blind". See web/gb-help-budget.js for why.
let helpMax = 0;          // the allowance agreed for this game
let helpLeft = 0;         // what's left of it
let helpSpent = 0;        // scarce help actually taken
let helpEarned = 0;       // tokens won back by finding the best move unaided
let helpAsked = 0;        // times you asked the opponent for more
let helpGranted = 0;      // times they said yes
let helpPosPaid = -1;     // ply we last charged for — one charge per position
function budgetUnlimited() { return !helpMax || GBHelpBudget.unlimited(helpLeft); }
// Compute the allowance from the gap between you and this opponent's level.
function resetHelpBudget() {
  const gap = Math.abs((parseInt(humanEloEl.value, 10) || 1200) - (parseInt(engineEloEl.value, 10) || 1500));
  helpMax = GBHelpBudget.tokensFor({ gap });
  helpLeft = helpMax; helpSpent = 0; helpEarned = 0; helpAsked = 0; helpGranted = 0; helpPosPaid = -1;
}
// Is the powerful help available right now? Already paid for this position counts.
function scarceAvailable() {
  if (aiAssistOverride === "off" || firstGame) return true; // nothing to meter
  return helpPosPaid === uciHistory.length || helpLeft > 0;
}
// Charge one token for this position, once. Returns false when you're out.
function spendHelp(note) {
  if (aiAssistOverride === "off" || firstGame) return true;
  if (helpPosPaid === uciHistory.length) return true; // already paid for this move
  if (helpLeft <= 0) return false;
  helpLeft -= 1; helpSpent += 1; helpPosPaid = uciHistory.length;
  if (note) playerHelpLog.push({ move: Math.floor(uciHistory.length / 2) + 1, note });
  return true;
}
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
// Earned-rating ruler: EVERY move you make is measured at a fixed depth, whatever
// the help setting (moveReview only exists when help is on — and help-off games
// are exactly the pure own-play ones the rating cares about most).
const RATING_DEPTH = 4;
let rateMoves = [];    // [{cp, own}] — your moves; own=false if taken from the help
let ratePending = [];  // in-flight measurements, awaited at game end
let lastRating = null; // GBRating.record() result for the last game
let lastEval = null; // engine's read of your position (white-relative cp), for the live pill
let evalTrail = []; // your-relative eval after each of your turns — the recap's story curve
let lastResult = null; // { won, draw, reason } of the finished game — for the recap
let capturedLesson = null; // a strategy learned from this game, if any
let scored = false;    // guard: count each finished game into the score exactly once
let lastScore = null;  // { total, self, assist, accuracy, ratingBefore, ratingAfter } of the last game
let lastTotals = null; // lifetime totals after this game

// ---- Play score & strength ------------------------------------------------
// Total play score = Self (moves you found on your own) + Assist (moves you took
// help on). Both count toward the total; the split makes the ladder-down visible.
const gbScoreDefaults = () => ({ total: 0, self: 0, assist: 0, games: 0, wins: 0, draws: 0, losses: 0, rating: null });
function loadScore() { try { return Object.assign(gbScoreDefaults(), JSON.parse(localStorage.getItem("gb_score")) || {}); } catch { return gbScoreDefaults(); } }
function ratingNum(elo) { const m = String(ratingFor(elo)).match(/\d+/); return m ? parseInt(m[0], 10) : parseInt(elo, 10) || 1200; }
function computeGamePoints() {
  const R = lastResult || {};
  const lvlIdx = Math.max(0, AI_LEVELS.findIndex((l) => l.name === levelName(engineEloEl.value)));
  const levelMult = 1 + lvlIdx * 0.4; // Beginner ×1.0 … Master ×3.0
  const rev = moveReview.filter((m) => m.cp != null && m.cp >= 0);
  let accuracy = 60;
  if (rev.length >= 3) { const avg = rev.reduce((s, m) => s + m.cp, 0) / rev.length; accuracy = Math.round(Math.max(12, Math.min(99, 100 * Math.exp(-avg / 300)))); }
  const resultPts = R.won ? 100 : R.draw ? 40 : 10;
  const bestMoves = moveReview.filter((m) => m.wasBest).length;
  const total = Math.round(resultPts * levelMult + accuracy + bestMoves * 5);
  // Split by how much you leaned on help. With NO help (assistance off, or none was
  // ever on the board), it's 100% you — never attribute it to "help".
  const noHelp = aiAssistOverride === "off" || !helpWasAvailable;
  const denom = indepOwn + indepFollowed;
  const indepFrac = noHelp ? 1 : (denom > 0 ? indepOwn / denom : 1);
  const self = Math.round(total * indepFrac);
  return { total, self, assist: total - self, accuracy, won: !!R.won, draw: !!R.draw };
}
function scoreFinishedGame() {
  if (firstGame || scored) return;
  scored = true;
  const g = computeGamePoints();
  const s = loadScore();
  s.total += g.total; s.self += g.self; s.assist += g.assist; s.games += 1;
  if (g.won) s.wins += 1; else if (g.draw) s.draws += 1; else s.losses += 1;
  try { localStorage.setItem("gb_score", JSON.stringify(s)); } catch {}
  lastScore = g;
  lastTotals = s;
  // The earned rating waits (briefly) for the last move measurements to land.
  const settle = Promise.all(ratePending.map((p) => p.catch(() => {})));
  const timeout = new Promise((r) => setTimeout(r, 4000));
  const moves = rateMoves.slice(), helpOnOffer = !(aiAssistOverride === "off" || !helpWasAvailable);
  Promise.race([settle, timeout]).then(() => {
    const actual = g.won ? 1 : g.draw ? 0.5 : 0;
    lastRating = window.GBRating ? GBRating.record(moves, actual, ratingNum(engineEloEl.value), { lvl: levelName(engineEloEl.value), res: actual }) : null;
    showRatingOutcome(lastRating, { won: g.won, helpOnOffer });
    postScoreToServer(); // cross-device + admin (no-ops offline)
  });
}
// Game-over: the rating line + (for real milestones) confetti + chime.
function showRatingOutcome(rec, ctx) {
  renderRatingChip(rec && rec.rated && rec.before != null ? rec.after - rec.before : 0);
  const box = document.getElementById("overRating"); if (!box || !window.GBRating) return;
  const c = GBRating.celebration(rec, ctx);
  let html = c ? c.html : "";
  if (!c && rec && !rec.rated) html = `<b>Not rated</b><small>Too few of your own moves to measure this game fairly.</small>`;
  if (!c && rec && rec.rated && rec.after != null && rec.before != null) {
    const d = rec.after - rec.before;
    html = `<b>Rating ${d < 0 ? "▼" + Math.abs(d) : "±0"} → ${rec.after}</b><small>You played like ≈${rec.game.est} this game. It's measured on your own moves only.</small>`;
  }
  box.innerHTML = html ? `<span class="or-ic">💪</span><span class="or-txt">${html}</span>` : "";
  box.hidden = !html;
  box.classList.toggle("big", !!(c && c.big));
  if (c && c.big) { GBRating.confetti(); if (soundOn) GBRating.chime(); }
}
// The always-on earned-rating chip in the game bar.
function renderRatingChip(delta) {
  const el = document.getElementById("ratingChip"); if (!el || !window.GBRating) return;
  el.innerHTML = GBRating.chipHTML(delta || 0);
  if (delta > 0) { el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
}
// Once you're rated, the handicap uses the EARNED number — not a typed-in one.
function syncEarnedRating() {
  if (!window.GBRating || !humanEloEl) return;
  const g = GBRating.get();
  if (g.r == null) return;
  humanEloEl.value = g.r; humanEloEl.readOnly = true;
  humanEloEl.title = "Your earned rating — set by your own play, not typed in";
}
// Report the finished game to the server (per-game deltas; server accumulates). Used
// for cross-device totals and the admin dashboard. Fails silently offline.
function postScoreToServer() {
  if (!lastScore) return;
  try {
    let me = null; try { me = JSON.parse(localStorage.getItem("gb_me")); } catch {}
    const player = (me && me.id) || aiPlayerId() || "";
    if (!player) return;
    const op = currentOpening();
    fetch(AI_SERVER + "/score", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        player, name: (me && me.name) || "",
        level: levelName(engineEloEl.value),
        result: lastScore.won ? "win" : lastScore.draw ? "draw" : "loss",
        accuracy: lastScore.accuracy || 0, style: aiStyle, opening: op ? op.name : "",
        points: lastScore.total, self: lastScore.self, assist: lastScore.assist, rating: (window.GBRating && GBRating.get().r) || 0,
      }),
    }).catch(() => {});
  } catch {}
}
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
// Threefold-repetition detection (the Rust engine doesn't track it): count how many
// times each position (pieces·side·castling·ep) has occurred; 3 → draw.
let posCounts = Object.create(null);
let repetitionDraw = false;
function positionSig() { return game.fen().split(" ").slice(0, 4).join(" "); }
function recordPosition() {
  const s = positionSig();
  posCounts[s] = (posCounts[s] || 0) + 1;
  if (posCounts[s] >= 3) repetitionDraw = true;
}
// Would playing `m` reach a position we've already seen? (i.e. this move is a
// step toward a threefold-repetition draw). Used to name the draw strategy
// concretely — "repeat the position" vs the general "play for a draw".
function leadsToRepetition(m) {
  if (!m) return false;
  try {
    const g = Game.fromFen(game.fen());
    const promo = m.uci && m.uci.length > 4 ? m.uci[4] : undefined;
    if (!g.makeMove(m.from, m.to, promo)) return false;
    const sig = g.fen().split(" ").slice(0, 4).join(" ");
    return (posCounts[sig] || 0) >= 1; // seen before → this move repeats it
  } catch { return false; }
}
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
  { ic: "👆", text: "Tap one of the <b>glowing</b> pieces to pick it up — or just <b>drag</b> it.", hint: "curated" },
  { ic: "✨", text: "The <b>dots</b> show every square that piece can move to. Tap a dot — or drag the piece onto one — to move." },
  { ic: "🤝", text: "Nice — that's a move! Your opponent (the computer) takes its turn now…" },
  { ic: "♟", text: "Your turn again. Same idea: <b>tap a piece, then a dot</b>. If a piece is in danger, the coach under the board warns you." },
  { ic: "💡", text: "One more thing: <b>tap any piece anytime</b> to learn how it moves, when it's strong, and what it works well with. The first time you touch each piece, a tip pops up automatically.", cta: "Got it" },
  { ic: "🎉", text: "You've got it! Keep playing — help is always under the board, and every piece has tips a tap away. Have fun!", cta: "Play on", final: true },
];
let lastMove = null; // { from, to } of the most recent move
let assistData = null; // parsed assist JSON for the current (White) turn
let busy = false;
let aiResigned = false, aiHopeless = 0; // realism: the engine resigns when it's clearly lost
let resigned = false;

// How long the full-strength advice may think. It must NEVER be out-searched by the
// opponent (that's the handicap made real — see [[strength-and-handicap-model]]), so
// it is always at least their think-time. But a flat 1400ms made every turn cost 1.4s
// even against Beginner, whose own move takes 300ms — pure latency for no fairness.
// So: match-or-beat the opponent, floor 500ms, ceiling the old 1400ms (Master, where
// it stays an even fight).
function adviceMovetime() {
  const oppMt = aiBoost(parseInt(engineEloEl.value, 10)).movetime || 500;
  return Math.max(500, Math.min(1400, Math.round(oppMt * 1.25)));
}
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
  const styles = document.getElementById("styleChoice");
  if (styles) styles.querySelectorAll(".cchoice").forEach((s) => {
    s.classList.toggle("on", s.dataset.style === setupStyle);
    s.onclick = () => {
      setupStyle = s.dataset.style;
      styles.querySelectorAll(".cchoice").forEach((x) => x.classList.toggle("on", x === s));
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
  // Cancel/back: return to the game in progress, or the lobby if there's none.
  const cancel = document.getElementById("setupCancel");
  if (cancel) cancel.onclick = () => {
    if (game) { sc.hidden = true; startClock(); }
    else location.href = "./portal.html";
  };
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
  rememberSetup(); // next time, your choices are already made
  engineEloEl.value = setupElo;
  syncAiLevel();
  aiAssistOverride = assistOverrideFor();
  // Gentleman's Game starts with no help on the board (you request it); the chosen
  // level is what gets GRANTED. On Call also starts hidden. Open Hand shows it.
  helpDelivery = setupMode === "off" ? "open" : setupDelivery;
  // Resolve the side you play (random picks one now). Randomness comes from the UI,
  // not the engine — Math.random is fine here (no reproducibility requirement).
  humanColor = setupColor === "black" ? "black" : setupColor === "white" ? "white" : (Math.random() < 0.5 ? "white" : "black");
  aiStyle = setupStyle === "random" ? (["aggressive", "positional", "defensive", "wildcard"][Math.floor(Math.random() * 4)]) : setupStyle;
  aiPersona = pickPersona(aiStyle); // this game's named opponent
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
// NOTE (measured 2026-10-04): this worker is serial, and each of your moves queues
// four searches — but prioritising the advice over the rating/review measurements
// buys nothing, because they fire at DIFFERENT times (measurements on your move,
// `analyze` only after the engine replies) and finish during the engine's own
// think-time. Rust search is also cheap: depth 4 = 14ms, depth 5 = 35ms mean
// (core/engine/src/bin/searchbench.rs). The per-move lag is Stockfish, not this.
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
  // Heartbeat for the safety net above: a dropped engine reply recovers on its own
  // even when nothing else happens to nudge the game.
  setInterval(() => { if (!document.hidden) ensureTurnProgress(); }, 4000);
  detectFirstGame();
  const nh = document.getElementById("newHereLink");
  if (nh) nh.hidden = firstGame; // hidden while the guided game is running
  const closeMenu = () => { const f = document.getElementById("setupFold"); if (f) f.removeAttribute("open"); };
  // The ⚙ panel lives inside the game bar, which is now a fixed-height, clipped row
  // (so it can never move the board). An absolutely-positioned dropdown would be
  // clipped away by that — so when it opens we pin it with position:FIXED, anchored
  // under the gear. Fixed elements escape every ancestor's overflow.
  const fold = document.getElementById("setupFold");
  if (fold) {
    // PORTAL the panel to <body> while it's open. On desktop main.game is a clipped,
    // height-constrained flex column, and any ancestor with overflow/transform can
    // trap or hide a dropdown. Re-parenting to <body> removes every such risk —
    // then we just position it under the gear. It goes back on close so the markup
    // (and <details> semantics) stay intact.
    const panel = fold.querySelector(".opts-body");
    const place = () => {
      const sum = fold.querySelector("summary");
      if (!panel || !sum) return;
      const r = sum.getBoundingClientRect();
      panel.style.position = "fixed";
      panel.style.top = Math.round(r.bottom + 6) + "px";
      panel.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + "px";
      panel.style.left = "auto";
      panel.style.zIndex = "400";
      panel.style.maxHeight = Math.max(160, Math.round(window.innerHeight - r.bottom - 24)) + "px";
      panel.style.overflowY = "auto";
    };
    // The portal host carries the SAME .gb-opts class, so every descendant style
    // (.gb-opts .opts-body, .menu-item, .menu-sep, .menu-theme…) still applies once
    // the panel is re-parented. Zero-size + fixed, so it never affects layout.
    const portalHost = () => {
      let h = document.getElementById("gbOptsPortal");
      if (!h) {
        h = document.createElement("div");
        h.id = "gbOptsPortal"; h.className = "gb-opts";
        h.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:400;";
        document.body.appendChild(h);
      }
      return h;
    };
    const open = () => { if (panel) portalHost().appendChild(panel); place(); };
    const shut = () => { if (panel && panel.parentNode !== fold) fold.appendChild(panel); };
    fold.addEventListener("toggle", () => { if (fold.open) open(); else shut(); });
    window.addEventListener("resize", () => { if (fold.open) place(); });
    window.addEventListener("scroll", () => { if (fold.open) place(); }, true);
    // Tapping outside closes it (it's a popover now, not part of the bar's flow).
    document.addEventListener("pointerdown", (e) => {
      if (!fold.open) return;
      if (fold.contains(e.target) || (panel && panel.contains(e.target))) return;
      fold.removeAttribute("open"); shut();
    });
  }
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
  const asheet = document.getElementById("altSheet"), asclose = document.getElementById("altSheetClose");
  const closeAlt = () => { if (asheet) asheet.style.display = "none"; };
  if (asclose) asclose.addEventListener("click", closeAlt);
  if (asheet) asheet.addEventListener("click", (e) => { if (e.target === asheet) closeAlt(); });
  const plsheet = document.getElementById("planSheet"), plclose = document.getElementById("planSheetClose");
  const closePlan = () => { if (plsheet) plsheet.style.display = "none"; };
  if (plclose) plclose.addEventListener("click", closePlan);
  if (plsheet) plsheet.addEventListener("click", (e) => { if (e.target === plsheet) closePlan(); });
  const rb = document.getElementById("resignBtn");
  if (rb) rb.addEventListener("click", () => { closeMenu(); resign(); });
  setupBoardInput(); // tap + drag piece movement
  syncEarnedRating(); renderRatingChip(0);
  const snd = document.getElementById("soundToggle");
  if (snd) { snd.checked = soundOn; snd.addEventListener("change", toggleSound); }
  const ub = document.getElementById("undoBtn");
  if (ub) ub.addEventListener("click", () => { closeMenu(); undoMove(); });
  const orm = document.getElementById("overRematch");
  if (orm) orm.addEventListener("click", () => { hideOver(); newGame(); }); // same settings (opponent, colour, assistance)
  const ons = document.getElementById("overNewSetup");
  if (ons) ons.addEventListener("click", () => { hideOver(); firstGame = false; showSetup(); });
  const ocl = document.getElementById("overClose");
  if (ocl) ocl.addEventListener("click", hideOver);
  const orc = document.getElementById("overRecap");
  if (orc) orc.addEventListener("click", openRecap);
  const rcsheet = document.getElementById("recapSheet"), rcclose = document.getElementById("recapSheetClose");
  const closeRecap = () => { if (rcsheet) rcsheet.style.display = "none"; };
  if (rcclose) rcclose.addEventListener("click", closeRecap);
  if (rcsheet) rcsheet.addEventListener("click", (e) => { if (e.target === rcsheet) closeRecap(); });
  // Resume a saved game if the lobby sent us here with ?g=<id>; a total beginner
  // goes straight into the guided first game; otherwise show the match setup.
  const gid = new URLSearchParams(location.search).get("g");
  if (gid && !firstGame && await resumeAiGame(gid)) return;
  if (firstGame) newGame(); else showSetup();
}
const hideOver = () => { const ov = document.getElementById("overOverlay"); if (ov) ov.style.display = "none"; };

function newGame() {
  syncEarnedRating();
  game = new Game();
  posCounts = Object.create(null); repetitionDraw = false; recordPosition();
  game.setRatings(parseInt(humanEloEl.value, 10), parseInt(engineEloEl.value, 10));
  game.setAssistOverride(firstGame ? "guided" : aiAssistOverride); // the help you chose at setup
  aiGameId = newAiId(); // a fresh slot; only saved once a move is played
  aiSaved = false;
  aiTokens = AI_TOKENS_MAX; aiLifelineLog = []; aiLastLifelineIdx = -9; momentSeen = {}; // fresh
  lastMoveLifeline = false; playerFollows = 0; playerTokens = PLAYER_TOKENS_MAX; playerHelpLog = [];
  history = []; uciHistory = []; // posCounts/repetition already reset + initial recorded above
  if (firstGame) helpDelivery = "open"; // the guided game always shows help
  helpReceived = 0; helpRevealed = helpDelivery === "open"; helpRequestPending = false;
  resetHelpBudget();
  // Clock: from the chosen time control (kept across rematches). Untimed if 0.
  timedGame = !firstGame && setupMinutes > 0;
  humanMs = engineMs = setupMinutes * 60000;
  flagged = false; flagLoser = "";
  mateKingSq = -1;
  indepOwn = 0; indepFollowed = 0; moveReview = []; rateMoves = []; ratePending = []; lastRating = null; lastEval = null; evalTrail = [];
  selected = null;
  legalTargets = [];
  lastMove = null;
  busy = false;
  resigned = false;
  aiResigned = false; aiHopeless = 0;
  scored = false; lastScore = null; capturedLesson = null;
  pickedStrategyId = null;
  followBook = false;
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
  // Re-arm the safety net after every position change (deferred so this paint
  // finishes first, and so a reply that is merely slow isn't double-fired).
  setTimeout(ensureTurnProgress, 1400);
  hanging = [];
  threats = [];
  threatSquares = [];
  freeCaptures = [];
  assistData = null;
  revealedSugg = false; // deeper help must be re-revealed (and re-paid) each position
  revealedBest = false;
  // Open Hand shows the answer unasked, so it is charged for the position the
  // moment that position arrives — that's what "counts down as it's offered" means.
  if (helpDelivery === "open" && game.status() === "ongoing" && game.sideToMove() === humanColor) {
    spendHelp("help shown (Open Hand)");
  }
  helpRevealed = helpDelivery === "open"; // On Call / Gentleman start each move hidden
  helpRequestPending = false;
  previewedMove = null; // a new position — clear any lens preview
  sfBest = null; // full-strength advice, fetched fresh each turn
  const token = ++positionToken;
  // The advice search for the position we just LEFT is now worthless, but `go`
  // requests are serialized — leaving it running would delay the next search (often
  // the opponent's own move) by its full movetime. Free the channel immediately.
  if (window.GBEngine && GBEngine.cancel) GBEngine.cancel("advice");
  clockLast = Date.now(); // the side to move just changed — don't charge them the gap
  paint(); // instant: board, players, captured, material — before any deep search

  if (game.status() === "ongoing" && game.sideToMove() === humanColor) {
    const fen = game.fen();
    const ov = firstGame ? "guided" : aiAssistOverride;
    // Strong advice: the recommended move comes from Stockfish at FULL strength, so
    // following it genuinely holds up against the (skill-limited) Stockfish opponent.
    if (!firstGame && window.GBEngine && ov !== "off") {
      const sfOpts = { skill: 20, movetime: adviceMovetime(), kind: "advice" };
      if (uciHistory.length) sfOpts.moves = uciHistory.slice(); // repetition-aware advice
      GBEngine.bestMove(fen, sfOpts).then((uci) => {
        if (token !== positionToken || !uci || uci.length < 4) return;
        const q = uciToSquares(uci), cand = candByUci(uci);
        sfBest = { uci, from: q.from, to: q.to, san: (cand && cand.san) || approxSan(uci), note: (cand && cand.note) || "" };
        if (!busy) paint(); // upgrade the lens to the full-strength recommendation
      }).catch(() => {});
    }
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
          if (!firstGame && lastEval != null) evalTrail.push({ ply: uciHistory.length, cp: lastEval }); // {ply,cp} — the recap's story curve
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
        // The Glass Lens is now the primary surface — it shows the prioritised move
        // (or the ask/reveal control) every turn. The old "Suggested moves" fold is
        // just the alternatives list, opened on demand from the lens (⋯), so we no
        // longer auto-open it (that's what used to pile content down the page).
        keepScroll(() => {
          const fold = document.getElementById("movesFold");
          if (fold) fold.open = false;
          clearThinkWindow(true);
          paint(); // repaint with the lens + overlays
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
// A real AI game is playable offline once the app is cached (service worker in
// control) and the game is saved on this device — surface that subtly, in context.
function offlineReady() { return !!(navigator.serviceWorker && navigator.serviceWorker.controller); }
// First visit: repaint once the service worker takes control, so the ✈️ pill shows.
if (typeof navigator !== "undefined" && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener("controllerchange", () => { try { renderOfflinePill(); } catch {} });
}
function renderOfflinePill() {
  const el = document.getElementById("offlinePill");
  if (!el) return;
  el.hidden = firstGame || !offlineReady() || !aiSaved;
}
function paint() {
  keepScroll(() => {
    renderFirstGame();
    renderBoard();
    renderPlayers();
    renderOfflinePill();
    renderEval();
    renderAiAssist();
    renderCoach();
    renderAssist();
    renderStrategy();
    renderPlanDock();
    renderGlassLens();
    renderBoardAdvice();
    renderMoveList();
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
  dock.hidden = true; dock.innerHTML = ""; return; // plan folded into the Glass Lens now
  // eslint-disable-next-line no-unreachable
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
  // The plan (name + step progress) shows here as strategic CONTEXT. The concrete
  // next move now lives in the Glass Lens, so it isn't repeated here.
  dock.innerHTML =
    `<div class="pd-top"><span class="pd-ic">${STRAT_ICON[picked.id] || "◆"}</span><span class="pd-name">${escapeHtml(picked.name)}</span>` +
      `<span class="pd-pips" title="${doneN}/${picked.steps.length} steps">${pips}</span>` +
      `<button class="pd-steps" id="pdSteps">Steps</button><button class="pd-x" id="pdX" title="Drop this plan" aria-label="Drop this plan">✕</button></div>`;
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
// The ALWAYS-ON strategy strip above the board: which opening you're actually
// playing (named from your moves — so it tells you even when you didn't choose one),
// what your opponent is playing, and the live plan. This is AWARENESS, not a move
// answer, so it shows at EVERY assistance level — including "No help" — and is
// never gated behind the Lens. Tapping it opens the Plans picker.
// Cached on its own HTML so repaints can't make it flash (an old complaint).
function renderOpening() {
  const el = document.getElementById("openingLine");
  if (!el || !window.GBAssistUI) return;
  // BOARD SOVEREIGNTY: never toggle this element's presence mid-game — showing or
  // hiding it would move the board. During a game it always occupies its fixed
  // 34px row; only the CONTENT swaps (and only when it actually changed).
  const inGame = !firstGame && game.status() === "ongoing";
  if (!inGame) { el.hidden = true; el.innerHTML = ""; el._h = ""; return; }
  el.hidden = false;
  const html = GBAssistUI.stripHTML({ opening: currentOpening(), assistData, myColor: humanColor, oppColor: engineColor() }) || "<div class='gs-row gs-empty'></div>";
  if (html !== el._h) { el.innerHTML = html; el._h = html; el.onclick = openPlanSheet; }
}

// "Who's playing what" — fuse the NAMED opening (attributed to whichever side it
// characterises) with the engine's live phase + top plan + opponent read into a
// two-sided read. This is pure AWARENESS (a label, never a move answer), so it is
// NOT help-gated — it shows in every mode, symmetric glass for both sides.
function strategyIdentity() {
  if (!window.GBAssistUI) return { you: {}, opp: {}, phase: null };
  return GBAssistUI.identity({ assistData, opening: currentOpening(), myColor: humanColor, oppColor: engineColor() });
}
// The NEXT move in your chosen opening's book line, if you're still following it.
// Returns {uci,from,to} for the side to move (the human, when the Lens is up), or
// null once the line diverges or the book runs out.
function bookNextMove() {
  if (!window.GBAssistUI) return null;
  return GBAssistUI.bookNextMove({ opening: currentOpening(), history: uciHistory });
}
// The identity strip as HTML — names each side's opening/plan + a phase pill. Pure
// awareness (a label, not a move answer), so it's rendered in EVERY Lens state
// (analyzing, awaiting-your-ask, and the full recommendation).
function glIdentityRow() {
  if (!window.GBAssistUI) return "";
  // Play-AI's own chips ride along as extras — the strip itself is shared with
  // human games, so both read identically.
  const extra = [];
  if (!firstGame && aiStyle && aiStyle !== "balanced" && AI_STYLES[aiStyle]) {
    const s = AI_STYLES[aiStyle];
    extra.push(`<span class="gl-id style" title="${escapeHtml(s.desc)}">${s.ic} ${escapeHtml(s.name)}</span>`);
  }
  // Symmetric-glass badge: when your leaning on help has pushed the AI above the
  // level you picked, show it — the same help meter drives both sides.
  const baseElo = engineEloEl ? parseInt(engineEloEl.value, 10) : 1500;
  const b = (!firstGame && window.GBEngine) ? aiBoost(baseElo) : null;
  if (b && b.boosted) {
    const pct = Math.round(b.lean * 100);
    extra.push(`<span class="gl-id boost" title="You've taken the suggested move on ${pct}% of your turns, so the AI is digging deeper to match — assistance is symmetric and always in the open.">⛏ AI matching your help</span>`);
  }
  return GBAssistUI.identityRowHTML({ assistData, opening: currentOpening(), myColor: humanColor, oppColor: engineColor() }, extra);
}

// The MOVE LIST — Glassboard's signature: every move shown, and each of YOUR moves
// tagged with its provenance (💪 found alone · 🤝 took help), so the glass-box lives
// in the record itself. Replays UCI from the start for readable SAN.
const START_FEN_STR = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
function startBoardArr() {
  const rows = START_FEN_STR.split("/"), arr = new Array(64).fill(".");
  for (let i = 0; i < 8; i++) { const rank = 7 - i; let f = 0; for (const ch of rows[i]) { if (/\d/.test(ch)) f += +ch; else { arr[rank * 8 + f] = ch; f++; } } }
  return arr;
}
function sanFromArr(arr, uci) {
  const from = (uci.charCodeAt(0) - 97) + (uci.charCodeAt(1) - 49) * 8;
  const to = (uci.charCodeAt(2) - 97) + (uci.charCodeAt(3) - 49) * 8;
  const p = (arr[from] || "p").toLowerCase(), cap = arr[to] && arr[to] !== ".";
  const dst = uci.slice(2, 4);
  if (p === "p") return (cap ? uci[0] + "x" : "") + dst + (uci.length > 4 ? "=" + uci[4].toUpperCase() : "");
  return p.toUpperCase() + (cap ? "x" : "") + dst;
}
function applyUciArr(arr, uci) {
  const from = (uci.charCodeAt(0) - 97) + (uci.charCodeAt(1) - 49) * 8;
  const to = (uci.charCodeAt(2) - 97) + (uci.charCodeAt(3) - 49) * 8;
  const p = arr[from]; arr[from] = ".";
  arr[to] = uci.length > 4 ? (p === p.toUpperCase() ? uci[4].toUpperCase() : uci[4].toLowerCase()) : p;
}
function renderMoveList() {
  const el = document.getElementById("moveList");
  if (!el) return;
  if (firstGame || uciHistory.length === 0) { el.hidden = true; el.innerHTML = ""; el._n = -1; return; }
  el.hidden = false;
  if (el._n === uciHistory.length) return; // only rebuild when a move is actually added (no flashing)
  el._n = uciHistory.length;
  const arr = startBoardArr();
  const sans = uciHistory.map((u) => { const s = sanFromArr(arr, u); applyUciArr(arr, u); return s; });
  // Human plies: even if you're White (ply 0,2,…), odd if Black. Map to moveReview order.
  const humanEven = humanColor === "white";
  const provIcon = { own: `<span class="mv-prov own" title="you found this on your own">💪</span>`, followed: `<span class="mv-prov foll" title="you took help for this move">🤝</span>` };
  let hi = 0; // index into moveReview (your moves, in order)
  const cell = (ply) => {
    if (ply >= sans.length) return `<span class="mv-cell empty"></span>`;
    const isHuman = (ply % 2 === 0) === humanEven;
    let icon = "";
    if (isHuman) { const r = moveReview[hi]; if (r && provIcon[r.prov]) icon = provIcon[r.prov]; hi++; }
    return `<span class="mv-cell${isHuman ? " you" : ""}">${escapeHtml(sans[ply])}${icon}</span>`;
  };
  let rows = "";
  for (let i = 0; i < sans.length; i += 2) {
    rows += `<div class="mv-row"><span class="mv-num">${i / 2 + 1}.</span>${cell(i)}${cell(i + 1)}</div>`;
  }
  el.innerHTML = `<div class="mv-head">Moves <span class="mv-legend">💪 you · 🤝 helped</span></div><div class="mv-scroll">${rows}</div>`;
  const sc = el.querySelector(".mv-scroll"); if (sc) sc.scrollTop = sc.scrollHeight;
}

// Captured material as one tug-bar above the board (you are White → left side).
// Captured pieces + material lead now live beside each player's name (renderPlayers),
// so nothing sits above the board. This just retires the old material slider.
function renderCaptured() {
  const el = document.getElementById("materialBar");
  if (el) { el.hidden = true; el.innerHTML = ""; }
}
// What each side has captured (from the board vs the starting set) and the material
// lead in pawns (White-relative). Used for the tasteful in-name trophies.
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const CAP_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
function capturedSummary() {
  const bs = game.boardString();
  const wOn = { p: 0, n: 0, b: 0, r: 0, q: 0 }, bOn = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  for (const ch of bs) { if (ch === ".") continue; const k = ch.toLowerCase(); if (k in wOn) { if (ch === ch.toUpperCase()) wOn[k]++; else bOn[k]++; } }
  const whiteCap = {}, blackCap = {}; let wv = 0, bv = 0; // white captured black pieces & vice versa
  for (const k of ["q", "r", "b", "n", "p"]) {
    const wc = Math.max(0, START_COUNT[k] - bOn[k]); if (wc) { whiteCap[k] = wc; wv += wc * CAP_VAL[k]; }
    const bc = Math.max(0, START_COUNT[k] - wOn[k]); if (bc) { blackCap[k] = bc; bv += bc * CAP_VAL[k]; }
  }
  return { whiteCap, blackCap, lead: wv - bv }; // lead > 0 → White is up material
}
// Shared with human games (GBAssistUI.capTrayHTML) so the trophies look identical
// in both. `color` is the colour of the pieces TAKEN, not of the player who took
// them — your tray holds your opponent's pieces.
function capGlyphs(cap, color, key) { return GBAssistUI.capTrayHTML(cap, color, key); }

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
// ---- THE COCKPIT -----------------------------------------------------------
// Each player's information lives on THEIR side of the board (opponent above, you
// below) — name · rating · captured pieces · material lead · lifelines · clock ·
// whose turn. Spatial mapping: you look where the information belongs.
// Both strips are FIXED HEIGHT so the board never moves (board sovereignty).
const stripHTML_player = (o) => GBAssistUI.playerStripHTML(o);
function renderPlayers() {
  updateSetupSum();
  const legacy = document.getElementById("players"); // retired: the cockpit replaces it
  if (legacy) { legacy.hidden = true; legacy.innerHTML = ""; }
  const oppEl = document.getElementById("oppStrip"), youEl = document.getElementById("youStrip");
  if (!oppEl || !youEl) return;
  const over = resigned || aiResigned || flagged || game.status() !== "ongoing";
  const turn = over ? null : game.sideToMove();
  const cap = capturedSummary();
  const youCap = humanColor === "white" ? cap.whiteCap : cap.blackCap;
  const aiCap = humanColor === "white" ? cap.blackCap : cap.whiteCap;
  const youLead = humanColor === "white" ? cap.lead : -cap.lead; // >0 → you're up material
  const showClock = timedGame;
  const aiLevel = parseInt(engineEloEl.value, 10);

  const opp = stripHTML_player({
    icon: `<span class="dot ${engineColor()}"></span>${aiEmoji()}`,
    name: aiName(), rating: `${levelName(aiLevel)} ${ratingFor(aiLevel)}`,
    pips: (firstGame || aiLevel >= 3000) ? "" : pipRow(aiTokens, AI_TOKENS_MAX),
    pipsTitle: "opponent's lifelines remaining — its help, in the open",
    caps: capGlyphs(aiCap, humanColor, "opp"), lead: -youLead,
    clock: showClock ? fmtClock(engineMs) : "", low: showClock && engineMs <= 10000,
    turn: turn === engineColor(), turnText: "thinking…",
  });
  const you = stripHTML_player({
    icon: `<span class="dot ${humanColor}"></span>👤`,
    // Your EARNED rating when you have one (it's the honest number, and the one the
    // handicap uses); otherwise the working estimate.
    name: "You", rating: (() => { const g = window.GBRating ? GBRating.get() : null;
      return g && g.r != null ? `${g.tier ? g.tier.ic + " " : ""}${g.r}${g.provisional ? "?" : ""}` : humanEloEl.value; })(),
    // The pips were decorative: playerTokens counted moves you FOLLOWED and nothing
    // was ever gated on it. They now show the real, spendable allowance.
    pips: (firstGame || aiAssistOverride === "off") ? "" : pipRow(helpLeft, helpMax),
    pipsTitle: `help tokens — ${helpLeft} of ${helpMax} left (safety warnings are always free)`,
    caps: capGlyphs(youCap, engineColor(), "you"), lead: youLead,
    clock: showClock ? fmtClock(humanMs) : "", low: showClock && humanMs <= 10000,
    turn: turn === humanColor, turnText: "your move",
  });
  oppEl.hidden = false; youEl.hidden = false;
  if (oppEl._h !== opp) { oppEl.innerHTML = opp; oppEl._h = opp; }
  if (youEl._h !== you) { youEl.innerHTML = you; youEl._h = you; }
  oppEl.classList.toggle("active", turn === engineColor());
  youEl.classList.toggle("active", turn === humanColor);
  oppEl.onclick = () => { const f = document.getElementById("setupFold"); if (f) f.open = true;
    const sel = document.getElementById("aiLevel"); if (sel) { try { sel.focus(); } catch {} } };
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
// The old "in the open" card is folded into the HUD now (help counts sit beside the
// player names; the full log opens from the Lens's 📜 button), so nothing extra
// stacks below the board.
function renderAiAssist() {
  const el = document.getElementById("aiAssist");
  if (el) { el.hidden = true; el.innerHTML = ""; }
}
// The full glass log — opened on demand so it never crowds the board.
function openGlassSheet() {
  const body = document.getElementById("glassSheetBody");
  if (!body) return;
  const ev = glassEvents();
  body.innerHTML = ev.length
    ? ev.map((e) => `<div class="gl-row ${e.side}"><span class="gl-mv">move ${e.mv}</span>` +
        `<span class="gl-who">${e.side === "you" ? "🧑 You" : aiEmoji() + " " + aiName()}</span>` +
        `<span class="gl-txt">${e.tag ? `<b>${e.tag}</b> — ` : ""}${e.txt}</span></div>`).join("")
    : `<div class="gl-empty">No help taken yet — every time either side takes help, it lands here, in the open.</div>`;
  const sh = document.getElementById("glassSheet"); if (sh) sh.style.display = "grid";
}

// A "moment" — personality without touching the board. It lingers (~7s), shows a
// countdown bar so its exit feels intentional, and you can tap it to dismiss early.
const MOMENT_MS = 7000;
let momentTimer = null;
function hideMoment() { const e = document.getElementById("momentToast"); if (e) e.classList.remove("show"); }
// `action` (optional) = { label, fn } renders a button; the toast lingers longer so
// there's time to act on it (used by the blunder coach's "take it back").
function showMoment(html, kind, action) {
  let el = document.getElementById("momentToast");
  if (!el) {
    el = document.createElement("div"); el.id = "momentToast"; el.className = "moment-toast";
    document.body.appendChild(el);
  }
  el.onclick = (e) => { if (e.target.closest(".mo-act")) return; if (momentTimer) clearTimeout(momentTimer); hideMoment(); };
  el.className = "moment-toast show" + (kind ? " " + kind : "");
  const ms = action ? MOMENT_MS + 4000 : MOMENT_MS; // give more time when there's an action
  el.innerHTML = html + (action ? `<button class="mo-act" type="button">${action.label}</button>` : "") +
    `<span class="mo-bar" style="animation-duration:${ms}ms"></span>`;
  if (action) { const b = el.querySelector(".mo-act"); if (b) b.onclick = () => { hideMoment(); action.fn(); }; }
  if (momentTimer) clearTimeout(momentTimer);
  momentTimer = setTimeout(hideMoment, ms);
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
// Blunder coach — special assistance when you play a weak move. Chess-player framing:
// name the severity, quantify the cost, and offer a takeback. Only when help is on
// (No-help = pure chess, no nagging); it only NAMES the better move in Open Hand, so
// On-Call/Gentleman aren't force-fed advice they chose to request. Capped per game.
function maybeBlunderCoach(entry, bestSan) {
  if (aiAssistOverride === "off") return;
  if (!entry || entry.wasBest || entry.cp == null || entry.cp < 150) return;
  if (moveReview[moveReview.length - 1] !== entry) return; // you've already played on
  if ((momentSeen.blunders || 0) >= 5) return;
  momentSeen.blunders = (momentSeen.blunders || 0) + 1;
  const pawns = (entry.cp / 100).toFixed(1);
  const severe = entry.cp >= 300;
  const nameBetter = helpDelivery === "open" && bestSan; // don't reveal in ask-modes
  const head = severe ? "Blunder" : "There was better";
  const ic = severe ? "🚨" : "⚠️";
  const msg = (severe ? `That hands back about ${pawns} pawns.` : `A stronger move was there (~${pawns} pawns better).`) +
    (nameBetter ? ` <b>${escapeHtml(bestSan)}</b> was stronger.` : "");
  showMoment(
    `<span class="mo-ic">${ic}</span><span class="mo-txt"><b>${head}</b><small>${msg}</small></span>`,
    severe ? "crit" : "ai",
    history.length > 0 ? { label: "↩ Take it back", fn: undoMove } : null,
  );
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
// Returning from a hidden tab: reset the reference so the away-time isn't charged.
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (!document.hidden) clockLast = Date.now(); });
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
  let dt = now - clockLast;
  clockLast = now;
  // Don't charge time the player didn't actually spend at the board: skip when the
  // tab is hidden (backgrounded / screen locked) or when a tick gap is abnormally
  // large (the timer was throttled/asleep). Foreground ticks are ~200ms, so real
  // thinking still counts fully.
  if (document.hidden || dt > 2000) dt = 0;
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
  // Clocks now live on each player's cockpit strip (on their own side of the board),
  // so this standalone row is retired — but keep the function: the clock tick calls
  // it, and it refreshes the strips.
  const box = document.getElementById("clocks");
  if (box) { box.hidden = true; }
  if (timedGame) renderPlayers();
  if (!box) return;
  if (true) return;
  const you = document.getElementById("clkYou"), ai = document.getElementById("clkAi");
  const over = flagged || resigned || game.status() !== "ongoing";
  const active = over ? null : game.sideToMove();
  if (you) {
    you.textContent = "🧑 " + fmtClock(humanMs);
    you.className = "clk" + (active === humanColor ? " active" : "") + (humanMs <= 10000 ? " low" : "");
  }
  if (ai) {
    ai.textContent = aiEmoji() + " " + fmtClock(engineMs);
    ai.className = "clk" + (active === engineColor() ? " active" : "") + (engineMs <= 10000 ? " low" : "");
  }
}

// ---- Help delivery: is the move-answer shown right now? --------------------
// Open Hand → always. On Call / Gentleman → only once you've pulled it this move.
function showAnswer() { return (helpDelivery === "open" || helpRevealed) && scarceAvailable(); }
// On Call: summon help for this move (instant, tallied).
function askForHelp() {
  if (helpRevealed || game.sideToMove() !== humanColor || game.status() !== "ongoing") return;
  if (helpDelivery === "gentleman") { requestHelpFromOpponent(); return; }
  if (!spendHelp("asked to see a move")) { outOfHelpMoment(); paint(); return; }
  helpRevealed = true; helpReceived += 1;
  showMoment(`<span class="mo-ic">🔔</span><span class="mo-txt"><b>Help on call</b><small>${GBHelpBudget.pips(helpLeft, helpMax)} — ${helpLeft} left of ${helpMax}.</small></span>`, "you");
  revealHint(); paint();
}
// Gentleman's Game: ask, and the opponent decides. The AI grants unless it's
// comfortably ahead — then it may decline (and gloat a little).
// You're out (or you're in Gentleman's mode): ask the opponent for more. The AI
// answers from the POSITION, its LEVEL and its PERSONALITY — a pure decision, so
// you can learn how this character thinks instead of being refused at random.
// It replaces a coin flip on bestScore(2) that nobody could have reasoned about.
function requestHelpFromOpponent() {
  if (helpRequestPending) return;
  helpRequestPending = true; helpAsked += 1;
  playerHelpLog.push({ move: Math.floor(uciHistory.length / 2) + 1, note: "asked the opponent for more help" });
  paint();
  setTimeout(() => {
    let sense = 0; try { sense = game.bestScore(2); } catch {} // relative to YOU (to move)
    const b = aiBoost(parseInt(engineEloEl.value, 10));
    const verdict = GBHelpBudget.aiVerdict({
      cp: -sense,                 // flip: the verdict wants it from the AI's side
      skill: b.skill, style: aiStyle, grantedSoFar: helpGranted,
    });
    helpRequestPending = false;
    if (!verdict.grant) {
      playerHelpLog.push({ move: Math.floor(uciHistory.length / 2) + 1, note: "opponent refused more help — " + verdict.reason });
      showMoment(`<span class="mo-ic">🚫</span><span class="mo-txt"><b>${escapeHtml(aiName())} said no</b><small>“${escapeHtml(verdict.line)}”</small></span>`, "ai");
      paint();
      return;
    }
    helpGranted += 1;
    helpLeft += verdict.amount; helpMax += verdict.amount; // the allowance really grew
    playerHelpLog.push({ move: Math.floor(uciHistory.length / 2) + 1, note: `opponent granted +${verdict.amount} help` });
    showMoment(`<span class="mo-ic">🤝</span><span class="mo-txt"><b>${escapeHtml(aiName())} granted +${verdict.amount}</b><small>“${escapeHtml(verdict.line)}” · ${GBHelpBudget.pips(helpLeft, helpMax)}</small></span>`, "you");
    if (helpDelivery !== "open" && spendHelp("help granted and taken")) { helpRevealed = true; helpReceived += 1; revealHint(); }
    paint();
  }, 650);
}
// Out of tokens: say so, and point at the only way to get more.
function outOfHelpMoment() {
  showMoment(`<span class="mo-ic">🪫</span><span class="mo-txt"><b>Out of help</b>` +
    `<small>Safety warnings stay on — ask ${escapeHtml(aiName())} if you want the key move again.</small></span>`, "you");
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
  if (snap.rateLen != null && rateMoves.length > snap.rateLen) rateMoves.length = snap.rateLen;
  if (typeof snap.uciLen === "number" && uciHistory.length > snap.uciLen) uciHistory.length = snap.uciLen;
  if (typeof snap.helpLogLen === "number" && playerHelpLog.length > snap.helpLogLen) playerHelpLog.length = snap.helpLogLen;
  selected = null; legalTargets = []; lastMove = null; lastMoveLifeline = false;
  resigned = false; aiResigned = false; aiHopeless = 0; mateKingSq = -1; busy = false; evalBeforeEngine = null;
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
  const over = resigned || aiResigned || flagged || repetitionDraw || st !== "ongoing";
  const rb = document.getElementById("resignBtn");
  if (rb) rb.hidden = over;
  if (!over) { ov.style.display = "none"; mateKingSq = -1; return; }
  let winner = "", reason = "";
  if (flagged) { winner = flagLoser === humanColor ? engineColor() : humanColor; reason = "time"; } // ran out of time
  else if (aiResigned) { winner = humanColor; reason = "resignation"; } // the engine resigned → you win
  else if (resigned) { winner = engineColor(); reason = "resignation"; } // you resigned → the engine wins
  else if (st === "checkmate") { winner = game.sideToMove() === "white" ? "black" : "white"; reason = "checkmate"; }
  else if (st === "stalemate") { reason = "stalemate"; }
  else if (repetitionDraw) { reason = "repetition"; }
  else if (st === "insufficient") { reason = "insufficient material"; }
  else if (st === "fifty-move") { reason = "fifty-move rule"; }
  const draw = winner === "", won = winner === humanColor;
  lastResult = { won, draw, reason }; // captured for the ✨ Recap
  // STRATEGY CAPTURE: if something genuinely forcing happened, learn it and keep it.
  try {
    if (!capturedLesson && window.GBCapture) {
      capturedLesson = GBCapture.save(GBCapture.detect({
        trail: evalTrail, history: uciHistory, Game, myColor: humanColor, opening: currentOpening(),
      }));
    }
  } catch {}
  scoreFinishedGame(); // tally the play score once, now the result is known
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
    how = won ? "The engine resigns — your position was winning. No need to grind it out. 🎉" : "You resigned this one.";
  } else if (reason === "time") {
    how = won ? "The engine ran out of time — you win on the clock. ⏱" : "Your clock hit zero — a loss on time. ⏱";
  } else if (reason === "repetition") {
    how = "The same position came up three times — a draw by repetition. ♻";
  } else if (reason === "insufficient material") {
    how = "Neither side has enough pieces left to checkmate — an automatic draw. 🤝";
  } else {
    how = "Fifty moves without a capture or pawn move — an automatic draw.";
  }

  res.innerHTML = (st === "checkmate" ? `<span class="over-mate">CHECKMATE</span>` : "") +
    (draw ? "Draw" : won ? "You win! 🎉" : "You lose");
  res.className = "over-result " + (draw ? "draw" : won ? "win" : "loss");
  rea.innerHTML = `<div class="over-how">${how}</div>` + helpBudgetHtml() + aiLifelineHtml() + reviewHtml() + independenceHtml() + agencySummaryHtml();
  if (window.gbFeedback) gbFeedback.render(document.getElementById("overFeedback"), { mode: "ai", gameId: aiGameId || "" });
  setBoardGlow(draw ? "draw" : won ? "win" : "loss"); // highlight the result on the board (which stays visible)
  ov.style.display = "grid";
}

// ---- ✨ Game Recap: a playful, shareable highlight reel of the game just played ----
function yourMovePly(k) { return humanColor === "white" ? 2 * k : 2 * k + 1; }
function sanForPly(ply) {
  if (ply == null || ply < 0 || ply >= uciHistory.length) return "";
  const arr = startBoardArr();
  for (let i = 0; i < ply; i++) applyUciArr(arr, uciHistory[i]);
  try { return sanFromArr(arr, uciHistory[ply]); } catch { return ""; }
}
// The recap is SHARED (web/gb-recap.js) so human games get the identical payoff.
// Play-AI supplies everything it measures; the module omits anything it isn't given.
function buildRecap() {
  const R = lastResult || { won: false, draw: false, reason: "" };
  return GBRecap.build({
    result: R,
    moves: moveReview.map((m) => ({ cp: m.cp, own: m.prov === "own", wasBest: m.wasBest })),
    evalTrail, plies: uciHistory.length,
    opponent: { name: aiName(), rank: levelName(engineEloEl.value),
                style: AI_STYLES[aiStyle] ? AI_STYLES[aiStyle].name : "Balanced",
                tag: aiPersona ? `${aiEmoji()} ${aiName()}` : "the AI" },
    opening: currentOpening(), helpable: helpWasAvailable,
    lifelines: AI_TOKENS_MAX - aiTokens,
    myMovePly: yourMovePly, sanForPly,
    score: lastScore ? { total: lastScore.total, self: lastScore.self, assist: lastScore.assist,
                         ratingAfter: lastTotals ? lastTotals.rating : null,
                         lifetime: lastTotals ? lastTotals.total : null } : null,
  });
}
function openRecap() {
  const sh = document.getElementById("recapSheet"), body = document.getElementById("recapSheetBody");
  if (!sh || !body || !window.GBRecap) return;
  const r = buildRecap();
  body.innerHTML = GBRecap.html(r, evalTrail) ;
  // A freshly learned pattern goes right above the actions.
  if (capturedLesson && window.GBCapture) {
    const cards = body.querySelector('.rc-cards');
    const card = GBCapture.cardHTML(capturedLesson);
    if (cards) cards.insertAdjacentHTML('afterbegin', card);
    else body.querySelector('.rc-actions').insertAdjacentHTML('beforebegin', `<div class="rc-cards">${card}</div>`);
  }
  const shareBtn = document.getElementById("rcShare");
  if (shareBtn) shareBtn.onclick = () => {
    const done = () => { shareBtn.textContent = "✓ Copied"; setTimeout(() => { shareBtn.textContent = "🔗 Share"; }, 1600); };
    if (navigator.share) navigator.share({ text: r.share }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(r.share).then(done).catch(done);
    else done();
  };
  const again = document.getElementById("rcAgain");
  if (again) again.onclick = () => { sh.style.display = "none"; hideOver(); newGame(); };
  sh.style.display = "grid";
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
  // "On your own" must account for EVERY way help was taken — budget spends, On-Call
  // pulls, and playing the suggested move. (It used to check budgetSpent only, so an
  // On-Call game with 27 pulls still claimed "entirely on your own" — a glass-box
  // contradiction, and the glass-box has to be honest above all.)
  const tookHelp = budgetSpent > 0 || helpReceived > 0 || indepFollowed > 0;
  if (!tookHelp) {
    body = "You played this one <b>entirely on your own</b> — no help spent. 🎉";
  } else if (budgetSpent === 0) {
    const bits = [];
    if (helpReceived > 0) bits.push(`asked <b>${helpReceived}</b> time${helpReceived === 1 ? "" : "s"}`);
    if (indepFollowed > 0) bits.push(`played the suggested move <b>${indepFollowed}</b> time${indepFollowed === 1 ? "" : "s"}`);
    body = `You ${bits.join(" and ")}. Needing it less is the whole idea.`;
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
    ? `${aiEmoji()} ${aiName()} never reached for a lifeline — it held its own all game.`
    : `${aiEmoji()} ${aiName()} spent <b>${used}</b> of ${AI_TOKENS_MAX} lifeline${used === 1 ? "" : "s"} — moments it was in trouble and dug deep. You had it on the ropes ${used === 1 ? "once" : used + " times"}.`;
  return `<div class="over-lifeline">${line}</div>`;
}
// What the allowance did this game — part of the result, as Issam asked. Anything
// that didn't happen is left out rather than reported as a zero.
function helpBudgetHtml() {
  if (firstGame || aiAssistOverride === "off" || !helpMax) return "";
  const line = GBHelpBudget.summary({ max: helpMax, spent: helpSpent, earned: helpEarned, asked: helpAsked, granted: helpGranted });
  const refused = Math.max(0, helpAsked - helpGranted);
  const extra = refused ? ` <span class="hb-refused">${escapeHtml(aiName())} refused ${refused} time${refused === 1 ? "" : "s"}.</span>` : "";
  return `<div class="over-help"><span class="oh-ic">🤝</span><span class="oh-txt">${line}${extra}` +
    `<small>${GBHelpBudget.pips(helpLeft, helpMax)} left at the end · safety warnings were always free</small></span></div>`;
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
const STRAT_ICON = { save_piece: "🛡", win_material: "⚔", develop: "♞", center: "▦", attack_king: "⚔", simplify: "♟", passer: "⏫", iso_attack: "◎", minority_attack: "⇉", iqp_attack: "◈", open_file: "▤", pawn_storm: "⛰", fianchetto: "◹", outpost: "⚑", rook_seventh: "⇥", improve: "↗", pawn_break: "⚡" };
const STRAT_COLOR = { save_piece: "#f2b03a", win_material: "#f2707e", develop: "#5cc9ec", center: "#7ee0d6", attack_king: "#f2707e", simplify: "#e0be79", passer: "#5cc9ec", iso_attack: "#f2707e", minority_attack: "#7ee0d6", iqp_attack: "#7ee0d6", open_file: "#7ee0d6", pawn_storm: "#f2707e", fianchetto: "#e0be79", outpost: "#7ee0d6", rook_seventh: "#f2707e", improve: "#9fc0ff", pawn_break: "#e0be79" };
const PLAN_COLOR = { dev: "#5cc9ec", attack: "#f2707e", support: "#7ee0d6", castle: "#e0be79" };
let pickedStrategyId = null;
let followBook = false; // "follow the book" — surface the chosen opening's line while in book
// Beginner "what does this move do?" explanations. Default ON (a total beginner needs
// them); persisted so a stronger player who turns them off stays off.
let explainMoves = (() => { try { const v = localStorage.getItem("gb_explain"); return v === null ? true : v === "1"; } catch { return true; } })();
function toggleExplain() { explainMoves = !explainMoves; try { localStorage.setItem("gb_explain", explainMoves ? "1" : "0"); } catch {} paint(); }
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
      // Lens preview — visually DISTINCT from a real move (dashed teal, not solid).
      if (previewedMove) {
        if (i === previewedMove.from) sq.classList.add("preview-from");
        if (i === previewedMove.to) sq.classList.add("preview-to");
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
      // Tap AND drag are handled by delegated pointer events on boardEl (setupBoardInput),
      // so we don't bind per-square click here (that would double-fire with pointerup).
      boardEl.appendChild(sq);
    }
  }
  animateLastMove();
}

// Give the moving piece character: glide it from its old square to the new one
// with a lift-and-settle, instead of just appearing. Runs once per move (guarded
// so repaints — selection, etc. — don't re-animate). White is at the bottom.
let animMoveKey = null;
let moveSound = null; // { capture, intensity } — set when a move is made, played as the piece lands
function animateLastMove() {
  if (!lastMove) return;
  const key = lastMove.from + "-" + lastMove.to;
  if (key === animMoveKey) return;
  animMoveKey = key;
  const snd = moveSound; moveSound = null;
  const landSound = (delayMs) => { if (!snd) return;
    const pc = (game.boardString()[lastMove.to] || "").toLowerCase();
    const castle = pc === "k" && Math.abs((lastMove.to % 8) - (lastMove.from % 8)) === 2;
    playSound(snd.capture ? "capture" : castle ? "castle" : "move", snd.intensity, delayMs); };
  const rIdx = (sq) => { const p = rc(sq); return p.row * 8 + p.col; }; // square → rendered cell (orientation-aware)
  const toEl = boardEl.children[rIdx(lastMove.to)];
  const piece = toEl && toEl.querySelector(".piece");
  if (!piece) { landSound(0); return; }
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { landSound(0); return; }
  const drop = dropFlip; dropFlip = null; // a dragged move lands from where it was dropped
  if (drop && drop.key === key && performance.now() - drop.t < 1500) { landSound(GBBoardInput.flipFrom(piece, drop) * 0.45); return; }
  const cell = toEl.getBoundingClientRect().width || 0;
  if (!cell) { landSound(0); return; }
  landSound(115); // the glide's eased curve reaches the square at ~45% of its .26s
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
  // Undo is a CASUAL aid — it's offered only in an untimed practice game, on your
  // turn, with a move to take back. Never in a timed game (a takeback can't unspend
  // the clock, and a timed game is the serious mode).
  const ub = document.getElementById("undoBtn");
  if (ub) ub.hidden = firstGame || timedGame || flagged || st !== "ongoing" || side !== humanColor || history.length === 0;
}

// A playful character for a suggested move — derived from the board, not vibes:
// a capture that wins material is Aggressive, an even trade is Simplify, a pawn
// pushing into enemy territory is Sneaky, a quiet improving move is Safe.
const PVAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
// Plain-language "what does this move DO?" — SHARED with human games so the
// explanation is identical in both (web/gb-assist-ui.js).
function moveMeaning(m) {
  if (!window.GBAssistUI) return "";
  return GBAssistUI.moveMeaning({ game, Game, myColor: humanColor, threatSquares, hanging, freeCaptures }, m);
}
// ---- Glass Lens: the thumb-first "what matters NOW" control ----------------
// One prioritised recommendation surfaced every turn (urgent threat → your plan →
// best move), previewed on the board, with alternatives a thumb-drag away.
// Plan verbs live in the shared module so both games phrase plans identically.
const STRAT_VERB = (window.GBAssistUI && GBAssistUI.STRAT_VERB) || {};
let previewedMove = null; // {from,to,uci,san} currently previewed by the lens
let sfBest = null;        // {from,to,uci,san,note} — Stockfish full-strength best move this turn

function candByUci(uci) { const a = assistData; return (a && (a.candidates || []).find((c) => c.uci === uci)) || null; }
function asMove(c) { return c && { from: c.from, to: c.to, uci: c.uci, san: c.san }; }
// Approximate SAN from a UCI move using the current board (piece letter + capture +
// target) — good enough to label a Stockfish move we don't have a candidate for.
function approxSan(uci) {
  const from = uciToSquares(uci).from, to = uciToSquares(uci).to;
  const bs = game.boardString();
  const p = (bs[from] || "p").toLowerCase(), cap = bs[to] && bs[to] !== ".";
  const dst = sqName(to);
  if (p === "p") return (cap ? sqName(from)[0] + "x" : "") + dst + (uci.length > 4 ? "=" + uci[4].toUpperCase() : "");
  return p.toUpperCase() + (cap ? "x" : "") + dst;
}

// The single most-relevant piece of advice right now, from EXISTING analysis only.
// Returns { move, label, why, tag, kind, altBest }. null if no help on offer.
function pickPriority() {
  if (!window.GBAssistUI) return null;
  const sr = assistData && assistData.strategy;
  const picked = sr && sr.strategies && sr.strategies.find((s) => s.id === pickedStrategyId);
  return GBAssistUI.pickPriority({
    assistData, recommended: sfBest,            // Play-AI feeds Stockfish at full strength
    picked: picked ? Object.assign({ verb: STRAT_VERB[picked.id] || "plan" }, picked) : null,
    followBook, opening: currentOpening(), history: uciHistory, lastEval,
    pieceNameAt, sqName, flavor: moveFlavor, repeats: leadsToRepetition,
  });
}

// Preview a move on the board (distinct from a real move): select its piece so the
// destination lights up, mark the recommended target, and remember it. Playing is a
// separate, deliberate action (tap the board target, or the lens Play button).
function previewMove(m, boardOnly) {
  if (!m) return;
  previewedMove = m;
  selected = m.from;
  try { legalTargets = Array.from(game.legalTo(m.from)); } catch { legalTargets = []; }
  if (boardOnly) renderBoard(); else paint(); // boardOnly during a drag so the lens strip survives
}
function clearPreview() { if (previewedMove) { previewedMove = null; } }

function renderGlassLens() {
  const el = document.getElementById("glassLens");
  if (!el) return;
  const active = !firstGame && game.status() === "ongoing" && game.sideToMove() === humanColor && assistData && (assistData.candidates || []).length;
  if (!active) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  // Modes: don't reveal the move until it's been requested (accounting preserved).
  if (!showAnswer()) {
    el.className = "glass-lens ask";
    // Out of allowance: the only way on is to ask your opponent. Said plainly,
    // with the reassurance that safety warnings haven't gone anywhere.
    const out = !scarceAvailable();
    el.innerHTML = glIdentityRow() + (
      helpRequestPending
        ? `<div class="gl-askbtn waiting">🤝 Waiting for ${escapeHtml(aiName())}…</div>`
      : out
        ? `<button class="gl-askbtn" id="lensAsk" type="button">🪫 Out of help — ask ${escapeHtml(aiName())} for more <small>safety warnings stay on</small></button>`
      : helpDelivery === "gentleman"
        ? `<button class="gl-askbtn" id="lensAsk" type="button">🤝 Ask for the key move <small>opponent must allow</small></button>`
        : `<button class="gl-askbtn" id="lensAsk" type="button">🔔 Show the key move <small>${GBHelpBudget.pips(helpLeft, helpMax)} ${helpLeft} of ${helpMax} left</small></button>`);
    const b = document.getElementById("lensAsk");
    if (b) b.onclick = out ? requestHelpFromOpponent : askForHelp;
    return;
  }
  const p = pickPriority();
  if (!p) { el.hidden = true; el.innerHTML = ""; return; }
  // The strong engine is still calculating — show that honestly rather than a weak move.
  if (p.analyzing) {
    el.className = "glass-lens analyzing";
    el.innerHTML = glIdentityRow() + `<div class="gl-analyzing"><span class="gl-spin"></span> Analyzing the position…</div>`;
    return;
  }
  // Always-visible HUD: the advice is SHOWN (label + why), and the move is a single
  // clear button — tap ▶ to play it. The plan (pick or steps) folds in here too, so
  // NOTHING else needs to sit below the board — no scrolling to find help.
  const sr = assistData.strategy, strategies = (sr && sr.strategies) || [];
  const picked = strategies.find((s) => s.id === pickedStrategyId);
  const bookOp = (followBook && bookNextMove()) ? currentOpening() : null;
  const plansBtn = `<button class="gl-plansbtn" id="lensPlans" type="button" title="Pick a strategy">🧭 Plans</button>`;
  let planRow = "";
  if (picked) planRow = `<div class="gl-planrow"><button class="gl-plan" id="lensPlan" type="button">🧭 ${escapeHtml(picked.name)} · steps</button>${plansBtn}</div>`;
  else if (bookOp) planRow = `<div class="gl-planrow"><span class="gl-planlab book">📖 ${escapeHtml(bookOp.name)}</span>${plansBtn}</div>`;
  else if (strategies.length) {
    // Proactive recommendation: the engine's best-fit plan for THIS position, offered
    // as a one-tap "Try…" — plus the rest behind the Plans button.
    const top = strategies[0];
    const rec = `<button class="gl-planrec" data-id="${top.id}" type="button" title="${escapeHtml(top.idea || "")}">💡 Try: ${STRAT_ICON[top.id] || "◆"} ${escapeHtml(top.name)}</button>`;
    const next = strategies[1] ? `<button class="gl-planpick" data-id="${strategies[1].id}" type="button">${STRAT_ICON[strategies[1].id] || "◆"} ${escapeHtml(strategies[1].name)}</button>` : "";
    planRow = `<div class="gl-planrow">${rec}${next}${plansBtn}</div>`;
  } else planRow = `<div class="gl-planrow">${plansBtn}</div>`;
  const meaning = explainMoves ? moveMeaning(p.move) : "";
  el.className = "glass-lens kind-" + p.kind;
  el.innerHTML = glIdentityRow() +
    `<div class="gl-r1"><span class="gl-label">${escapeHtml(p.label)}</span><span class="gl-tag t-${p.kind}">${escapeHtml(p.tag)}</span>` +
      `<button class="gl-explain${explainMoves ? " on" : ""}" id="lensExplain" type="button" title="${explainMoves ? "Explanations on — tap to hide" : "Explain moves in plain language"}">💡</button>` +
      `<button class="gl-log" id="lensLog" type="button" title="Assistance log">📜</button></div>` +
    (meaning ? `<div class="gl-mean">💡 ${escapeHtml(meaning)}</div>` : "") +
    (p.why ? `<div class="gl-why">${escapeHtml(p.why)}</div>` : "") +
    `<div class="gl-actions">` +
      `<button class="gl-playmove" id="lensPlay" type="button">▶ ${escapeHtml(p.move.san || "Play")}</button>` +
      `<button class="gl-show" id="lensShow" type="button" title="Show on the board">👁</button>` +
      `<button class="gl-more" id="lensMore" type="button">⋯</button>` +
    `</div>` + planRow;
  document.getElementById("lensPlay").onclick = () => playMove(p.move.from, p.move.to, true);
  document.getElementById("lensShow").onclick = () => previewMove(p.move);
  document.getElementById("lensMore").onclick = () => openAltSheet(p);
  document.getElementById("lensLog").onclick = openGlassSheet;
  const ex = document.getElementById("lensExplain"); if (ex) ex.onclick = toggleExplain;
  const pl = document.getElementById("lensPlan"); if (pl) pl.onclick = () => openStepsSheet(picked);
  const pls = document.getElementById("lensPlans"); if (pls) pls.onclick = openPlanSheet;
  el.querySelectorAll(".gl-planpick, .gl-planrec").forEach((b) => b.onclick = () => { pickedStrategyId = b.dataset.id; followBook = false; paint(); });
}

// The Strategy picker — a bottom sheet of plans that FIT this position, filtered by
// phase: follow-the-book in the opening, the engine's live plans grouped by category,
// and links to the matching catalog write-ups. Adopting one drives the plan surface
// (and is visible to your opponent — assistance stays in the open).
function openPlanSheet() {
  const body = document.getElementById("planSheetBody"), sh = document.getElementById("planSheet");
  if (!body || !sh) return;
  const sr = assistData && assistData.strategy;
  const phase = (sr && sr.phase) || "opening";
  const S = window.GBStrategies;
  const strategies = (sr && sr.strategies) || [];
  let html = `<div class="ps-phase">Phase — <b>${escapeHtml(phase)}</b></div>`;
  // Follow the book (opening phase, still in a known line)
  const op = currentOpening(), bn = bookNextMove();
  if (op && bn) {
    html += `<div class="ps-sec">Opening</div>` +
      `<button class="ps-item book${followBook ? " on" : ""}" data-act="book"><span class="ps-ic">📖</span>` +
      `<span class="ps-t"><b>${followBook ? "Following the book" : "Follow the book"} — ${escapeHtml(op.name)}</b>` +
      `<small>${escapeHtml(op.idea || "Play the opening's main line while it stays sound.")}</small></span></button>`;
  }
  // Live plans the engine detects here, grouped by category
  if (strategies.length) {
    const byCat = {};
    strategies.forEach((s) => { const cat = (S ? S.themeMeta(s.id).cat : "Plan"); (byCat[cat] || (byCat[cat] = [])).push(s); });
    (S ? S.categories : Object.keys(byCat)).forEach((cat) => {
      const items = byCat[cat]; if (!items || !items.length) return;
      html += `<div class="ps-sec">${escapeHtml(cat)}</div>` + items.map((s) =>
        `<button class="ps-item${s.id === pickedStrategyId ? " on" : ""}" data-id="${s.id}" style="--sc:${STRAT_COLOR[s.id] || "#5cc9ec"}">` +
        `<span class="ps-ic">${STRAT_ICON[s.id] || "◆"}</span><span class="ps-t"><b>${escapeHtml(s.name)}</b><small>${escapeHtml(s.idea || "")}</small></span></button>`).join("");
    });
  }
  // Learn — the catalog write-ups for this phase (opens the library)
  const cplans = (S && S.plansByPhase) ? S.plansByPhase(phase) : [];
  if (cplans.length) {
    html += `<div class="ps-sec">Learn — ${escapeHtml(phase)} strategies</div>` + cplans.map((p) => {
      const cx = p.cx || (S.complexity ? S.complexity(p) : "");
      return `<a class="ps-item learn" href="./strategy.html" target="_blank" rel="noopener"><span class="ps-ic">${STRAT_ICON[p.id] || "◆"}</span>` +
        `<span class="ps-t"><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.idea || "")}</small></span>` +
        (cx ? `<span class="ps-cx cx-${cx}">${cx}</span>` : "") + `</a>`;
    }).join("");
  }
  if (pickedStrategyId || followBook) html += `<button class="ps-clear" data-act="clear" type="button">✕ Clear active plan</button>`;
  body.innerHTML = html;
  body.querySelectorAll(".ps-item[data-id]").forEach((b) => b.onclick = () => { pickedStrategyId = b.dataset.id; followBook = false; sh.style.display = "none"; paint(); });
  const bk = body.querySelector('.ps-item[data-act="book"]'); if (bk) bk.onclick = () => { followBook = !followBook; if (followBook) pickedStrategyId = null; sh.style.display = "none"; paint(); };
  const clr = body.querySelector('.ps-clear'); if (clr) clr.onclick = () => { pickedStrategyId = null; followBook = false; sh.style.display = "none"; paint(); };
  sh.style.display = "grid";
}

// ---- The board thinks out loud: assistance rendered AS living board intelligence.
// The recommended move is a BREATHING ARROW on the board (tap it to play); threats
// pulse (CSS on .sq.threat). This is the assistance-first, board-native surface.
function renderBoardAdvice() {
  const ov = document.getElementById("planOverlay");
  if (!ov) return;
  const active = !firstGame && game.status() === "ongoing" && game.sideToMove() === humanColor && assistData && mateKingSq < 0;
  const p = active && showAnswer() ? pickPriority() : null;
  if (!p || p.analyzing || !p.move) { if (ov.innerHTML) ov.innerHTML = ""; ov.style.pointerEvents = "none"; ov.onclick = null; return; }
  ov.innerHTML = GBAssistUI.adviceSVG(p.move.from, p.move.to, p.kind, planCxy);
  // The arrow itself is tappable — play the shown move straight off the board.
  ov.style.pointerEvents = "none";
  const g = ov.querySelector(".adv-arrow"); if (g) { g.style.pointerEvents = "auto"; g.style.cursor = "pointer"; g.onclick = () => playMove(p.move.from, p.move.to, true); }
}

// Alternatives — a dismissable bottom sheet. ▶ plays a move; 👁 shows it on the board.
function openAltSheet(p) {
  const body = document.getElementById("altSheetBody");
  const sh = document.getElementById("altSheet");
  if (!body || !sh) return;
  const seen = new Set(), rows = [];
  const add = (mv, lab, note) => { if (mv && !seen.has(mv.uci)) { seen.add(mv.uci); rows.push({ mv, lab, note }); } };
  add(p.move, p.label, p.why);
  if (p.altBest) add(asMove(p.altBest), "Best move", p.altBest.note || "");
  (assistData.candidates || []).slice(0, 6).forEach((c) => add(asMove(c), moveFlavor(c).name, c.note || ""));
  body.innerHTML = rows.map((r, i) =>
    `<div class="alt-row"><span class="alt-move">${escapeHtml(r.mv.san || "")}</span>` +
    `<span class="alt-body"><b>${escapeHtml(r.lab)}</b>${r.note ? `<small>${escapeHtml(r.note)}</small>` : ""}</span>` +
    `<span class="alt-btns"><button class="alt-show" data-i="${i}" type="button" title="Show on board">👁</button>` +
    `<button class="alt-play" data-i="${i}" type="button">▶ Play</button></span></div>`).join("");
  body.querySelectorAll(".alt-play").forEach((b) => b.onclick = () => { sh.style.display = "none"; const m = rows[+b.dataset.i].mv; playMove(m.from, m.to, true); });
  body.querySelectorAll(".alt-show").forEach((b) => b.onclick = () => { sh.style.display = "none"; previewMove(rows[+b.dataset.i].mv); });
  sh.style.display = "grid";
}

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
  if (busy || flagged || repetitionDraw || aiResigned || game.status() !== "ongoing" || game.sideToMove() !== humanColor) return;
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

// ---- Drag-to-move (pointer events: mouse + touch), with tap-to-move preserved ----
// Board input (tap + physics drag) is SHARED — see web/gb-board-input.js. The page
// supplies only what it owns: whose turn it is, legality, and how a move is made.
let dropIntensity = null; // set by a drag-drop; consumed by the next move's sound
let dropFlip = null;      // the ghost's pose at the drop, so the piece lands from the hand
function setupBoardInput() {
  if (!window.GBBoardInput || !boardEl) return;
  GBBoardInput.attach({
    boardEl,
    canMove: () => !(busy || flagged || repetitionDraw || aiResigned || game.status() !== "ongoing" || game.sideToMove() !== humanColor),
    isMyPiece: (i) => isHumanPiece(game.boardString()[i]),
    isCapture: (i) => game.boardString()[i] !== ".",
    legalTargets: () => legalTargets,
    selected: () => selected,
    select: selectSquare,
    clearSelection,
    playMove: (from, to) => playMove(from, to, false),
    tap: onSquareClick,
    sound: (kind, intensity, delay) => playSound(kind, intensity, delay),
    setDropIntensity: (v) => { dropIntensity = v; },
    setDropFlip: (o) => { dropFlip = o; },
  });
}

// ---- Optional move sounds (Web Audio — synthesized, netless/offline) -----------
let soundOn = (() => { try { return localStorage.getItem("gb_sound") === "1"; } catch { return false; } })(); // mirrors GBSound.isOn()
// Move sounds live in the SHARED engine (web/gb-sound.js) so Play-AI and human
// games sound identical. These thin wrappers keep the existing call sites.
function playSound(kind, intensity, delayMs) { if (window.GBSound) GBSound.play(kind, intensity, delayMs); }
function toggleSound() { if (window.GBSound) { soundOn = GBSound.toggle(); } paint(); }

function selectSquare(i) {
  if (previewedMove && i !== previewedMove.from) previewedMove = null; // picking your own piece drops the lens preview
  selected = i;
  legalTargets = Array.from(game.legalTo(i));
  fgOn("select");
  renderPieceTip(i);
  paint();
}

function clearSelection() {
  selected = null;
  legalTargets = [];
  previewedMove = null;
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
// Measure one of your moves for the earned rating: centipawn loss vs the best move
// at a fixed depth. Already-decided positions (|eval| > 10 pawns) aren't counted —
// every move "loses" nothing there, which would flatter the number.
function measureForRating(fen, from, to, own) {
  const entry = { cp: null, own };
  rateMoves.push(entry);
  const job = askEngine("bestScore", { fen, depth: RATING_DEPTH }).then((best) => {
    if (best == null || Math.abs(best) > 1000) return;
    return askEngine("scoreMove", { fen, from, to, depth: RATING_DEPTH }).then((played) => {
      if (played > -1000000) entry.cp = Math.max(0, best - played);
    });
  }).catch(() => {});
  ratePending.push(job);
}
function doPlay(from, to, promo, viaHelp) {
  if (flagged || busy || repetitionDraw || aiResigned) return; // clock's out, mid-think, a draw, or the engine resigned
  const preFen = game.fen(); // position before the human's move (for the Player Model)
  // Takeback snapshot: this position + the pre-move counters. Undo restores here.
  history.push({ fen: preFen, indepOwn, indepFollowed, reviewLen: moveReview.length, rateLen: rateMoves.length, playerFollows, uciLen: uciHistory.length, helpLogLen: playerHelpLog.length });
  const prov = provenanceOf(viaHelp); // by SOURCE (clicked help vs your own board move)
  if (prov === "own") indepOwn += 1; else if (prov === "followed") indepFollowed += 1;
  lastMoveLifeline = false; // your move — clear the AI's lifeline board badge
  if (prov === "followed") {
    playerFollows += 1; playerTokens = Math.max(0, PLAYER_TOKENS_MAX - playerFollows);
    // Glass: taking a suggested move is help received — put it on the record.
    playerHelpLog.push({ move: Math.floor(uciHistory.length / 2) + 1, note: "played the suggested move" });
  }
  if (!firstGame) measureForRating(preFen, from, to, prov !== "followed");
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
    // EARN-BACK: you found the engine's own choice without spending help on this
    // position, so you get a token back. The reward for needing less help is more
    // help in reserve — guardrail #4 as an actual game rule.
    if (!firstGame && aiAssistOverride !== "off") {
      const eb = GBHelpBudget.earnBack({
        wasBest, usedHelp: prov === "followed" || helpPosPaid === uciHistory.length,
        tokensLeft: helpLeft, max: helpMax,
      });
      if (eb.earn) {
        helpLeft += 1; helpEarned += 1;
        playerHelpLog.push({ move: Math.floor(uciHistory.length / 2) + 1, note: "earned a help token back (found the best move alone)" });
        showMoment(`<span class="mo-ic">🎁</span><span class="mo-txt"><b>+1 help token</b><small>${eb.reason} ${GBHelpBudget.pips(helpLeft, helpMax)}</small></span>`, "you");
      }
    }
    const bestSan = (assistData.candidates[0] || {}).san || "";
    askEngine("scoreMove", { fen: preFen, from, to, depth: depth() })
      .then((played) => { if (played > -1000000) { entry.cp = Math.max(0, bestScore - played); maybeBlunderCoach(entry, bestSan); } })
      .catch(() => {});
  }
  const bs = game.boardString(), mover = (bs[from] || "").toLowerCase();
  const isCapture = bs[to] !== "." || (mover === "p" && (from % 8) !== (to % 8)); // incl. en passant
  moveSound = { capture: isCapture, intensity: dropIntensity != null ? dropIntensity : 0.7 }; dropIntensity = null;
  const ok = game.makeMove(from, to, promo);
  selected = null;
  legalTargets = [];
  renderPieceTip(null);
  if (!ok) { moveSound = null; history.pop(); paint(); return; } // illegal → undo the snapshot we pushed
  lastMove = { from, to };
  uciHistory.push(sqName(from) + sqName(to) + (promo || "")); // for opening identification
  recordPosition(); // threefold check
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
  const box = ov.querySelector(".promo-box");
  const white = humanColor === "white";
  // First-timers don't know what this is — teach it in the moment (when explanations
  // are on or it's a guided game). The Queen is pre-marked as the obvious choice.
  const beginner = explainMoves || firstGame;
  const NAMES = { q: "Queen", r: "Rook", b: "Bishop", n: "Knight" };
  const title = beginner ? "Your pawn made it across! 🎉" : "Promote your pawn";
  const note = beginner
    ? "A pawn that reaches the far end <b>becomes a stronger piece</b>. Most players choose the <b>Queen</b> — it's the most powerful. Tap one:"
    : "";
  const btns = ["q", "r", "b", "n"].map((p) => {
    const glyphChar = white ? p.toUpperCase() : p;
    const g = typeof pieceSVG === "function" ? pieceSVG(glyphChar) : glyphChar;
    return `<button class="promo-pick${p === "q" ? " best" : ""}" data-p="${p}" ${p === "q" ? "autofocus" : ""}>` +
      `<span class="piece ${white ? "white" : "black"}">${g}</span>` +
      `<span class="promo-name">${NAMES[p]}${p === "q" ? " · best" : ""}</span></button>`;
  }).join("");
  box.innerHTML = `<div class="promo-title">${title}</div>` +
    (note ? `<div class="promo-note">${note}</div>` : "") +
    `<div class="promo-choices">${btns}</div>`;
  box.querySelectorAll(".promo-pick").forEach((b) => { b.onclick = () => { ov.style.display = "none"; doPlay(from, to, b.dataset.p, viaHelp); }; });
  ov.style.display = "grid";
}

// Play `uci` for the engine. Returns false if it couldn't be played — which the
// caller MUST handle, because an unplayed engine move leaves the turn with a side
// that will never move again.
function applyEngineMove(uci) {
  if (!uci || uci.length < 4) return false;
  const sq = uciToSquares(uci);
  const capturedByEngine = game.boardString()[sq.to] !== "."; // before the move lands
  // makeMove's return value used to be IGNORED here. An illegal or stale move
  // silently did nothing and the game deadlocked with the engine still "to move".
  let ok = false;
  try { ok = !!game.makeMove(sq.from, sq.to, uci.length > 4 ? uci[4] : undefined); } catch { ok = false; }
  if (!ok) return false;
  lastMove = sq;
  uciHistory.push(uci);
  recordPosition(); // threefold check
  moveSound = { capture: capturedByEngine || (/p/i.test(game.boardString()[sq.to] || "") && (sq.from % 8) !== (sq.to % 8)), intensity: 0.62 };
  return true;
}
// Any legal move for the side to move — the last resort so the game always
// continues. A position with no legal move isn't "stuck", it's over, and
// game.status() already says so.
function anyLegalMove() {
  try {
    for (let i = 0; i < 64; i++) {
      const outs = Array.from(game.legalTo(i));
      if (outs.length) {
        const to = outs[0];
        const f = (c) => String.fromCharCode(97 + (c % 8)) + (1 + Math.floor(c / 8));
        const promo = (/p/i.test(game.boardString()[i] || "") && (to < 8 || to > 55)) ? "q" : "";
        return f(i) + f(to) + promo;
      }
    }
  } catch {}
  return null;
}

// SAFETY NET: if it is the engine's turn, nothing is in flight and the game is
// live, then the engine owes us a move. Any path that drops a reply (a search
// that returns nothing, a rejected move, a promise that never settles) would
// otherwise freeze the board forever with no way back. Cheap to check, and it
// makes a deadlock impossible rather than merely unlikely.
function ensureTurnProgress() {
  if (busy || flagged || resigned || aiResigned || repetitionDraw) return;
  if (!game || game.status() !== "ongoing") return;
  if (game.sideToMove() !== engineColor()) return;
  engineReply();
}

function engineReply() {
  if (game.status() !== "ongoing" || repetitionDraw) {
    busy = false; paint(); // draw reached (e.g. threefold) — show it, don't move
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
      let played = applyEngineMove(uci);
      if (played) lastMoveLifeline = usedLifeline; // mark the assisted move on the board
      if (!played) {
        // The search gave us nothing usable (empty reply, "(none)", or a move the
        // board rejected). Fall back rather than hand the turn back to nobody:
        // the Rust core first, then any legal move. Silence here is what froze a
        // game at the end, where a king had one legal move and the board stopped
        // responding.
        const fb = (() => { try { return game.engineMoveByElo(baseElo, 0); } catch { return null; } })();
        played = applyEngineMove(fb) || applyEngineMove(anyLegalMove());
        if (played) lastMoveLifeline = false;
      }
      busy = false;
      maybeEngineResign(); // a real opponent resigns when hopelessly lost
      if (usedLifeline) aiLifelineMoment(llKind);
      if (!firstGame) persistAiGame(game.status() !== "ongoing" || aiResigned);
      onPositionChanged();
      fgOn("engine");
    })
    .catch(() => { busy = false; });
}

// Realism: a real opponent doesn't make you grind out a hopeless position — it
// resigns. When you're clearly winning (up a rook+ / near mate) and it's stable
// over a couple of moves, the engine resigns. Stronger levels resign sooner;
// Beginner/Casual never do (weak players play on) — and never in the opening.
function maybeEngineResign() {
  if (firstGame || aiResigned || resigned || flagged) return;
  if (game.status() !== "ongoing" || game.sideToMove() !== humanColor) return;
  if (uciHistory.length < 16) { aiHopeless = 0; return; }
  const lvl = sfLevelFor(parseInt(engineEloEl.value, 10));
  const resignAt = lvl.skill >= 12 ? 700 : lvl.skill >= 5 ? 1000 : Infinity;
  let ev = 0; try { ev = game.bestScore(2); } catch { ev = 0; } // side to move = you → your-relative cp
  if (ev >= resignAt) aiHopeless++; else aiHopeless = 0;
  if (aiHopeless >= 2) { aiResigned = true; stopClock(); paint(); }
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
