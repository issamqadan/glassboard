// Glassboard rating — an EARNED, own-play strength estimate (window.GBRating).
//
// Not self-declared: a player starts Unrated and is placed by their first games.
// Only moves the player found themselves count; moves taken from the help are
// excluded, and a result only counts in proportion to how independent it was.
// Two signals, the way a coach reads a game:
//   1. move quality — average centipawn loss of YOUR moves → a "played like ≈X"
//      estimate for this game (standard ACPL↔rating approximation, labelled ≈);
//   2. the result vs the opponent's strength, weighted by your independence.
// Calibration of the ACPL→rating curve against real games is P4 (admin data);
// until then the number is an honest ≈ estimate, not an official Elo.
(function () {
  const KEY = "gb_rating";
  const PLACEMENT = 3;      // games before you get a number
  const MIN_MOVES = 6;      // measured own moves for a game to count
  const TIERS = [
    { at: 0, ic: "🌱", name: "Newcomer" },
    { at: 800, ic: "♙", name: "Learner" },
    { at: 1000, ic: "♟", name: "Player" },
    { at: 1200, ic: "♞", name: "Improver" },
    { at: 1400, ic: "⚔", name: "Club" },
    { at: 1600, ic: "★", name: "Strong Club" },
    { at: 1800, ic: "🏅", name: "Expert" },
    { at: 2000, ic: "👑", name: "Master" },
  ];
  const blank = () => ({ r: null, games: 0, placed: [], best: null, history: [] });
  function load() { try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY)) || {}); } catch { return blank(); } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
  function tierFor(r) { let t = TIERS[0]; for (const x of TIERS) if (r != null && r >= x.at) t = x; return t; }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const expected = (me, opp) => 1 / (1 + Math.pow(10, (opp - me) / 400));

  // ACPL → "played like" rating. 20cp≈2540, 40≈2080, 70≈1540, 120≈930, 180≈510.
  function qualityRating(acpl) { return clamp(Math.round(3100 * Math.exp(-acpl / 100)), 400, 2700); }

  // moves: [{ cp, own }] for the player's moves (cp = centipawn loss ≥0, null if
  // unmeasured). result: 1 / 0.5 / 0. opp: opponent rating. Returns the game's
  // estimate, or null when it can't fairly be rated.
  function gameEstimate(moves, result, opp) {
    const all = moves.filter((m) => m.cp != null);
    const own = all.filter((m) => m.own);
    if (own.length < MIN_MOVES) return null;
    // Cap a single blunder (mates read as ±30000) so one move can't dominate.
    const acpl = own.reduce((s, m) => s + Math.min(500, m.cp), 0) / own.length;
    const q = qualityRating(acpl);
    const indep = all.length ? own.length / all.length : 1;
    const est = q + indep * 200 * (result - expected(q, opp));
    return { est: clamp(Math.round(est), 400, 2800), q, acpl: Math.round(acpl), indep, ownMoves: own.length };
  }

  // Record a finished game. Returns what changed, for the celebration UI.
  function record(moves, result, opp, meta) {
    const s = load();
    const g = gameEstimate(moves, result, opp);
    const before = s.r, bestBefore = s.best, tierBefore = before != null ? tierFor(before) : null;
    if (!g) return { rated: false, reason: "short", state: s };
    s.games += 1;
    let placedNow = false;
    if (s.r == null) {
      s.placed.push(g.est);
      if (s.placed.length >= PLACEMENT) { s.r = Math.round(s.placed.reduce((a, b) => a + b, 0) / s.placed.length); placedNow = true; }
    } else {
      const provisional = s.games <= 10;
      const step = clamp((provisional ? 0.3 : 0.15) * (g.est - s.r), provisional ? -100 : -60, provisional ? 100 : 60);
      s.r = Math.round(s.r + step);
    }
    const newBest = s.r != null && (s.best == null || s.r > s.best);
    if (newBest) s.best = s.r;
    if (s.r != null) s.history = s.history.concat([{ t: Date.now(), r: s.r, est: g.est, ...(meta || {}) }]).slice(-50);
    save(s);
    const tierAfter = s.r != null ? tierFor(s.r) : null;
    return {
      rated: true, game: g, before, after: s.r, placedNow, state: s,
      placementLeft: s.r == null ? PLACEMENT - s.placed.length : 0,
      newBest: newBest && bestBefore != null,
      tierUp: !!(tierBefore && tierAfter && tierAfter.at > tierBefore.at) ? tierAfter : null,
    };
  }

  function get() {
    const s = load();
    return { r: s.r, games: s.games, best: s.best, provisional: s.r != null && s.games <= 10,
      placementLeft: s.r == null ? PLACEMENT - s.placed.length : 0, tier: s.r != null ? tierFor(s.r) : null, history: s.history };
  }
  // The rating the handicap should use: earned when you have one, else the
  // self-estimate (only until placement — then the board decides, not the player).
  function effective(selfEstimate) { const s = load(); return s.r != null ? s.r : selfEstimate; }

  // Chip markup: "💪 ♞ 1240 ▲18" / "💪 Unrated · 2 to go".
  function chipHTML(delta) {
    const g = get();
    if (g.r == null) return `<span class="gbr-chip unrated" title="Your Glassboard rating is earned from your own moves. Play ${g.placementLeft} more rated game${g.placementLeft === 1 ? "" : "s"} to get placed.">💪 Unrated · ${g.placementLeft} to go</span>`;
    const d = delta ? `<span class="gbr-d ${delta > 0 ? "up" : "down"}">${delta > 0 ? "▲" : "▼"}${Math.abs(delta)}</span>` : "";
    return `<span class="gbr-chip" title="${g.tier.name} — your earned rating (≈), from the moves you found yourself${g.provisional ? " · provisional" : ""}">💪 ${g.tier.ic} ${g.r}${g.provisional ? "?" : ""}${d}</span>`;
  }

  // A short burst of confetti (DOM, no library). Respects reduced motion.
  function confetti(n) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#7ee0d6", "#e0be79", "#f2707e", "#9fb4ff", "#ffffff"];
    const box = document.createElement("div"); box.className = "gbr-confetti";
    for (let i = 0; i < (n || 70); i++) {
      const p = document.createElement("i");
      p.style.left = Math.random() * 100 + "vw";
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = Math.random() * 0.35 + "s";
      p.style.animationDuration = 1.6 + Math.random() * 1.2 + "s";
      p.style.setProperty("--dx", (Math.random() * 2 - 1) * 120 + "px");
      p.style.setProperty("--rot", Math.random() * 720 + "deg");
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3400);
  }
  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)(); const t = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine"; o.frequency.value = f;
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, t + i * 0.09); g.gain.exponentialRampToValueAtTime(0.08, t + i * 0.09 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.5);
        o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.55);
      });
    } catch {}
  }

  // The celebration for a recorded game (or null if nothing worth a moment).
  // Returns { big, html } — big = confetti-worthy.
  function celebration(rec, ctx) {
    if (!rec || !rec.rated) return null;
    const zeroHelp = ctx && ctx.won && rec.game.indep >= 0.999 && ctx.helpOnOffer;
    if (rec.placedNow) { const t = tierFor(rec.after); return { big: true, html: `<b>You're rated! ${t.ic} ${rec.after}</b><small>${t.name} — earned from your own moves over your first games.</small>` }; }
    if (rec.tierUp) return { big: true, html: `<b>Level up — ${rec.tierUp.ic} ${rec.tierUp.name}!</b><small>Your rating crossed ${rec.tierUp.at}. That's real improvement, on your own moves.</small>` };
    if (rec.newBest) return { big: true, html: `<b>New personal best — ${rec.after}</b><small>The highest you've ever been rated.</small>` };
    if (zeroHelp) return { big: true, html: `<b>Won with zero help</b><small>Every move was yours — that's the ladder down.</small>` };
    if (rec.after == null) return { big: false, html: `<b>Placement game counted</b><small>${rec.placementLeft} more to get your rating.</small>` };
    const d = rec.after - (rec.before || rec.after);
    if (d > 0) return { big: false, html: `<b>Rating ▲${d} → ${rec.after}</b><small>You played like ≈${rec.game.est} this game.</small>` };
    return null;
  }

  window.GBRating = { get, load, record, effective, tierFor, chipHTML, confetti, chime, celebration, gameEstimate, TIERS, PLACEMENT, MIN_MOVES };
})();
