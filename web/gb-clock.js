// Glassboard CHESS CLOCK — the time-control model and a monotonic clock engine.
//
// One implementation for both game types. Play-AI runs it locally; human games
// render the SERVER's authoritative numbers through the same formatting and
// threshold logic, so a clock looks and reads identically wherever you play.
//
// Why monotonic: the old Play-AI clock accumulated `Date.now()` deltas and
// deliberately threw away any delta while the tab was hidden or larger than 2s
// ("don't charge time you didn't spend at the board"). That is friendly in an
// untimed practice game and a straightforward cheat vector in a 5+3 blitz game —
// background the app and your clock stops. Decided 2026-10-11: in a TIMED game the
// clock continues, charged from a monotonic source so a system clock change can't
// alter it either.
//
// Nothing here touches the DOM or the engine. It is a pure state machine so the
// rules — increment on a COMPLETED move, only the mover's clock running, no
// increment for an illegal move — can be tested exhaustively.
(function (global) {
  // Monotonic where available. performance.now() is immune to wall-clock changes;
  // Date.now() is the fallback and only loses accuracy if the system clock moves.
  const now = () => (global.performance && global.performance.now ? global.performance.now() : Date.now());

  // ---- time controls -------------------------------------------------------
  // "initial + increment", the notation every chess player already knows.
  // Bullet is present but assistance is UNAVAILABLE there in v1: the full-strength
  // advice search is 500–1400ms and the opponent's search up to 1400ms, serialized
  // on one channel, which is most of a 1-minute clock. Advertising help we can't
  // deliver in time would be the same class of bug as a counter that doesn't count.
  const CATEGORIES = [
    { id: "bullet", name: "Bullet", note: "No assistance — you alone", assist: false,
      presets: [[1, 0], [1, 1], [2, 1]] },
    { id: "blitz", name: "Blitz", note: "Fast — assistance is tight", assist: true,
      presets: [[3, 0], [3, 2], [5, 0], [5, 3]] },
    { id: "rapid", name: "Rapid", note: "Room to think and learn", assist: true,
      presets: [[10, 0], [10, 5], [15, 10], [30, 0]] },
    { id: "classical", name: "Classical", note: "Long games", assist: true,
      presets: [[30, 20], [60, 0]] },
  ];
  const DEFAULT = { minutes: 10, increment: 0 }; // what a new player gets

  const label = (minutes, increment) => minutes + "+" + increment;
  // Every preset, flattened, with its category.
  function presets() {
    const out = [];
    CATEGORIES.forEach((c) => c.presets.forEach(([m, i]) =>
      out.push({ id: c.id + "-" + label(m, i), cat: c.id, minutes: m, increment: i, label: label(m, i) })));
    return out;
  }
  // A control from minutes + increment seconds. minutes === 0 means NO CLOCK.
  function control(minutes, increment) {
    const m = Math.max(0, Math.min(180, Math.round(Number(minutes) || 0)));
    const inc = Math.max(0, Math.min(180, Math.round(Number(increment) || 0)));
    return { minutes: m, increment: inc, initialMs: m * 60000, incrementMs: inc * 1000,
             timed: m > 0, label: m > 0 ? label(m, inc) : "No clock" };
  }
  const untimed = () => control(0, 0);
  // Which category a control falls in — drives whether assistance is offered.
  function categoryOf(c) {
    if (!c || !c.timed) return null;
    // Classified by the conventional "estimated duration" rule of thumb:
    // initial + 40 x increment.
    const est = c.minutes + 40 * (c.increment / 60);
    if (est < 3) return CATEGORIES[0];
    if (est < 10) return CATEGORIES[1];
    if (est < 60) return CATEGORIES[2];
    return CATEGORIES[3];
  }
  // v1 decision: no assistance in bullet, and it must be SAID, not just absent.
  function assistAllowed(c) {
    const cat = categoryOf(c);
    return !cat || cat.assist !== false;
  }

  // ---- the clock state machine --------------------------------------------
  // { control, whiteMs, blackMs, active, since, flagged }
  //   active — "white" | "black" | null (nobody's clock is running)
  //   since  — monotonic timestamp the active clock started from
  function create(c, activeSide) {
    const ctl = c && c.initialMs != null ? c : control((c && c.minutes) || 0, (c && c.increment) || 0);
    return { control: ctl, whiteMs: ctl.initialMs, blackMs: ctl.initialMs,
             active: ctl.timed ? (activeSide || "white") : null, since: now(), flagged: null };
  }
  const remainingOf = (s, side) => (side === "white" ? s.whiteMs : s.blackMs);
  function setRemaining(s, side, ms) { if (side === "white") s.whiteMs = ms; else s.blackMs = ms; }

  // Charge the active side for the real time since `since`. Idempotent in the sense
  // that it always moves `since` forward, so calling it often is harmless — which is
  // what lets the UI tick at any rate without drift.
  function settle(s, at) {
    if (!s || !s.control.timed || s.flagged || !s.active) { if (s) s.since = at == null ? now() : at; return s; }
    const t = at == null ? now() : at;
    const dt = Math.max(0, t - s.since);
    s.since = t;
    const left = Math.max(0, remainingOf(s, s.active) - dt);
    setRemaining(s, s.active, left);
    if (left <= 0) { s.flagged = s.active; s.active = null; }
    return s;
  }

  // A COMPLETED legal move: charge the mover, then add their increment, then hand
  // the clock over. Fischer increment is credited for the move just finished, so a
  // move that flags the clock earns nothing.
  function completeMove(s, mover, at) {
    if (!s || !s.control.timed) return s;
    const t = at == null ? now() : at;
    if (s.active === mover) settle(s, t); else s.since = t;
    if (s.flagged) return s;                       // flagged by this very move
    setRemaining(s, mover, remainingOf(s, mover) + s.control.incrementMs);
    s.active = mover === "white" ? "black" : "white";
    s.since = t;
    return s;
  }
  // Stop both clocks (game over, or nobody to move). Charges up to this instant.
  function halt(s, at) { if (!s) return s; settle(s, at); s.active = null; return s; }
  // Resume with `side` to move (after a takeback, a reconnect, or a resume).
  function resume(s, side, at) {
    if (!s || !s.control.timed || s.flagged) return s;
    s.active = side; s.since = at == null ? now() : at;
    return s;
  }

  // ---- time management for a SEARCH ---------------------------------------
  // How long may an engine think on this move, given what's left on the clock?
  //
  // Needed because the opponent's think-time was a fixed per-level figure (up to
  // 1400ms) that knew nothing about its own clock, so in a short game it would
  // happily spend itself into a flag. The same applies to the ADVICE search, which
  // runs on the player's turn and therefore on the player's time — the advisor must
  // never be the reason somebody flags.
  //
  //  remainingMs — what this side has left
  //  incrementMs — credited after the move, so part of it is safe to spend now
  //  ceilingMs   — the level's normal think-time (the strength setting)
  //  movesPlayed — used to estimate how much game is left
  //  floorMs     — never go below this; a legal move still has to come out
  //
  // Returns the ceiling unchanged when there is no clock, so an untimed game plays
  // at exactly the strength it always did.
  function searchBudget(o) {
    o = o || {};
    const ceiling = Math.max(1, o.ceilingMs || 1000);
    const remaining = Number(o.remainingMs);
    if (!isFinite(remaining) || remaining <= 0) return ceiling; // untimed
    const floor = Math.max(1, o.floorMs == null ? 40 : o.floorMs);
    const inc = Math.max(0, o.incrementMs || 0);
    // Reserve a little for sending the move and painting it — losing on time
    // because of our own plumbing would be indefensible.
    const safety = 150;
    const usable = Math.max(0, remaining - safety);
    if (usable <= floor) return floor;
    // Expected moves still to play. Shrinks as the game goes on, which is what
    // makes the budget self-correcting: spend too freely early and the divisor
    // tightens later.
    const movesToGo = Math.max(10, 36 - Math.floor((o.movesPlayed || 0) / 2));
    // Most of the increment is safe to spend: it comes straight back.
    let budget = usable / movesToGo + inc * 0.8;
    budget = Math.min(budget, ceiling);          // never stronger than the level
    budget = Math.min(budget, usable * 0.25);    // never blow a quarter of the clock on one move
    return Math.max(floor, Math.floor(budget));
  }

  // ---- presentation --------------------------------------------------------
  // Under ten seconds, tenths matter and players expect to see them.
  function fmt(ms) {
    const v = Math.max(0, Math.ceil(ms));
    if (v >= 60000) {
      const m = Math.floor(v / 60000), s = Math.floor((v % 60000) / 1000);
      return m + ":" + String(s).padStart(2, "0");
    }
    if (v >= 10000) return "0:" + String(Math.floor(v / 1000)).padStart(2, "0");
    return (v / 1000).toFixed(1);
  }
  // "normal" | "low" (<60s) | "critical" (<10s). Drives colour and optional sound.
  function pressure(ms) { return ms < 10000 ? "critical" : ms < 60000 ? "low" : "normal"; }

  global.GBClock = {
    CATEGORIES, DEFAULT, presets, control, untimed, categoryOf, assistAllowed,
    create, settle, completeMove, halt, resume, remainingOf, fmt, pressure, now, label, searchBudget,
  };
})(typeof window !== "undefined" ? window : this);
