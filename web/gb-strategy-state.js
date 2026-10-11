// Glassboard STRATEGY STATE — the active plan is part of the game, not the UI.
//
// The bug this exists to kill (web/main.js, before 2026-10-11):
//
//     if (pickedStrategyId && !sr.strategies.some((s) => s.id === pickedStrategyId))
//       pickedStrategyId = null;
//
// On every repaint, if the engine's CANDIDATE list for the current position no
// longer contained your chosen plan, the plan was silently deleted. The engine
// re-derives candidates each move, so an opponent's reply that made your plan
// temporarily unattractive erased it — and you were never told. That is the whole
// of "my strategy disappeared".
//
// A plan is a conditional intention a player formed. It is not a render artefact,
// it does not expire because the engine's top three changed this move, and only
// the player may discard it. So:
//
//   • `observe()` NEVER clears the plan. If it isn't currently recommended, the
//     plan moves to NEEDS-REASSESS and we say why.
//   • The plan carries its own name, objective and steps, so it can still be
//     displayed when the engine isn't offering it.
//   • Only `abandon()` / `replace()` / `complete()` end a plan — all player acts.
//
// Lifecycle: none → active ⇄ advancing ⇄ reassess → completed | abandoned | replaced
//
// No invented progress percentages. Step progress comes from the engine's own
// `step.done` booleans; a strategy is a conditional plan, not a script.
(function (global) {
  const NONE = "none", ACTIVE = "active", ADVANCING = "advancing",
        REASSESS = "reassess", COMPLETED = "completed", ABANDONED = "abandoned", REPLACED = "replaced";

  function create() {
    return { id: null, name: "", objective: "", why: "", steps: [],
             state: NONE, activatedPly: 0, lastRecommendedPly: 0, reassessSincePly: 0 };
  }

  // The player chose this plan. `strategy` is an engine candidate
  // { id, name, idea, steps? }; `ply` is the move number it was chosen on.
  function activate(st, strategy, ply) {
    if (!st || !strategy || !strategy.id) return st;
    st.id = strategy.id;
    st.name = strategy.name || "";
    st.objective = strategy.idea || strategy.objective || "";
    st.why = strategy.why || "";
    st.steps = (strategy.steps || []).slice();
    st.state = ACTIVE;
    st.activatedPly = ply || 0;
    st.lastRecommendedPly = ply || 0;
    st.reassessSincePly = 0;
    return st;
  }

  // Called on every position with the engine's current candidates. This is the
  // function that used to be a deletion.
  function observe(st, candidates, ply) {
    if (!st || !st.id) return st;
    if (st.state === COMPLETED || st.state === ABANDONED || st.state === REPLACED) return st;
    const list = candidates || [];
    const live = list.find((c) => c && c.id === st.id);
    if (live) {
      // Still recommended. Refresh the copy we hold so the display stays current,
      // and note that the position supports it again.
      st.name = live.name || st.name;
      st.objective = live.idea || st.objective;
      if (live.steps) st.steps = live.steps.slice();
      st.lastRecommendedPly = ply || 0;
      st.reassessSincePly = 0;
      st.state = ADVANCING;
      return st;
    }
    // NOT currently recommended. The plan stays. We only record that the position
    // has moved away from it, and for how long.
    if (st.state !== REASSESS) st.reassessSincePly = ply || 0;
    st.state = REASSESS;
    return st;
  }

  // Player acts.
  function abandon(st) { if (st && st.id) st.state = ABANDONED; return st; }
  function complete(st) { if (st && st.id) st.state = COMPLETED; return st; }
  function replace(st, strategy, ply) {
    if (!st) return st;
    const fresh = create();
    fresh.replacedId = st.id || null;
    return activate(fresh, strategy, ply);
  }
  function clear(st) { return create(); }

  // Is there a plan the player is still following? REASSESS counts: the plan is
  // theirs until they drop it.
  function isLive(st) {
    return !!(st && st.id && (st.state === ACTIVE || st.state === ADVANCING || st.state === REASSESS));
  }
  const needsReassess = (st) => !!(st && st.id && st.state === REASSESS);

  // The step the player is on, from the engine's own done-flags.
  function currentStep(st) {
    if (!st || !st.steps || !st.steps.length) return null;
    const i = st.steps.filter((x) => x && x.done).length;
    return st.steps[i] || null;
  }
  const stepsDone = (st) => (st && st.steps ? st.steps.filter((x) => x && x.done).length : 0);

  // One honest line about where the plan stands. Never claims the plan is working
  // when the position has moved away from it.
  function statusLine(st, ply) {
    if (!isLive(st)) return "";
    if (st.state === REASSESS) {
      const n = Math.max(0, Math.floor(((ply || 0) - (st.reassessSincePly || 0)) / 2));
      return n >= 1
        ? `The position has moved away from this plan (${n} move${n === 1 ? "" : "s"} ago). Keep probing, adapt, or pick another.`
        : "The position has moved away from this plan — keep probing, adapt, or pick another.";
    }
    const step = currentStep(st);
    if (step && step.text) return step.text;
    return st.objective || "";
  }

  // Persistence. Plain JSON so it rides along with the game record (Play-AI) or a
  // per-room key (human games) — the point is that it lives WITH THE GAME and not
  // with any panel's visibility.
  function toJSON(st) { return st && st.id ? st : null; }
  function fromJSON(o) {
    const st = create();
    if (!o || !o.id) return st;
    Object.keys(st).forEach((k) => { if (o[k] !== undefined) st[k] = o[k]; });
    st.id = o.id;
    return st;
  }

  global.GBStrategyState = {
    STATES: { NONE, ACTIVE, ADVANCING, REASSESS, COMPLETED, ABANDONED, REPLACED },
    create, activate, observe, abandon, complete, replace, clear,
    isLive, needsReassess, currentStep, stepsDone, statusLine, toJSON, fromJSON,
  };
})(typeof window !== "undefined" ? window : this);
