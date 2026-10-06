// Glassboard TERMS — the match contract, in one place.
//
// Glassboard's whole claim is that the handicap is visible and mutual. That claim
// dies quietly if two screens compute the terms differently, so the ladder, the
// phrasing, and the consequence preview all live here and nowhere else.
//
// Before this module the ladder existed twice in multiplayer.js — RUNGS/tierFor and
// rungForGap — and the lobby was about to add a third copy for the Challenge Board.
// The two did agree (verified boundary-by-boundary before extracting), but a player
// offered "Guide" in the lobby and handed "Coach" at the board would be right to
// call the whole thing dishonest, and three copies is how that happens.
(function (global) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // The assistance ladder, keyed by the rating gap it answers. Ordered, and read
  // as "gap BELOW this number gets this rung".
  const RUNGS = [
    { under: 100, key: "off", name: "Off", desc: "an even fight — neither side gets help", short: "Even — no help" },
    { under: 300, key: "hint", name: "Hint", desc: "safety signals — hanging pieces and checks", short: "Safety: threats & checks" },
    { under: 500, key: "coach", name: "Coach", desc: "threats and the opponent's plan, explained", short: "Reads the opponent's plan" },
    { under: 800, key: "guide", name: "Guide", desc: "candidate moves plus a named strategy to follow", short: "A strategy to follow" },
    { under: 1200, key: "assist", name: "Assist", desc: "the single best move to play, every turn", short: "Plan + the move to play" },
    { under: Infinity, key: "autopilot", name: "Autopilot", desc: "a co-pilot that executes the plan", short: "Executes the plan" },
  ];

  // The rung a given rating gap earns. One definition, so the lobby's promise and
  // the board's behaviour cannot drift apart.
  function rungForGap(gap) {
    const g = Math.max(0, Math.abs(Number(gap) || 0));
    for (const r of RUNGS) if (g < r.under) return r;
    return RUNGS[RUNGS.length - 1];
  }

  // What the host is looking for. "Someone stronger" is the point of the board:
  // you can ask to be out-matched, which is how you improve.
  const WANTS = {
    any: { ic: "🎯", label: "Anyone", blurb: "Open to all comers" },
    stronger: { ic: "🔥", label: "Someone stronger", blurb: "Out-rate me — I want a real test" },
    near: { ic: "⚖", label: "Near my level", blurb: "An even fight" },
    teach: { ic: "🎓", label: "Someone learning", blurb: "Happy to teach" },
  };
  const wantOf = (w) => WANTS[w] || WANTS.any;

  const fmtTime = (m) => (!m ? "untimed" : m + " min");

  // THE CONTRACT. Given both sides, say exactly who gets what — the same sentence
  // the lobby shows before you commit and the board shows all game.
  //   a / b: { name, rating }   mode: "match" | "casual"
  // Returns { mode, even, gap, rung, weaker, stronger, headline, detail }.
  function contract(a, b, mode, minutes) {
    a = a || {}; b = b || {};
    const casual = mode === "casual";
    const ar = Number(a.rating) || 0, br = Number(b.rating) || 0;
    const gap = Math.abs(ar - br);
    const rung = rungForGap(gap);
    const weaker = ar <= br ? a : b;
    const stronger = ar <= br ? b : a;
    const t = minutes ? ` · ${fmtTime(minutes)}` : "";
    if (casual) {
      return {
        mode: "casual", even: false, gap, rung: null, weaker, stronger,
        headline: "🎈 Casual — both players get full assistance",
        detail: `No ratings, no handicap: you can both use everything, and you both see everything the other uses${t}.`,
      };
    }
    if (rung.key === "off") {
      return {
        mode: "match", even: true, gap, rung, weaker, stronger,
        headline: "⚖ An even match — no assistance",
        detail: `Only ${gap} rating points apart, so neither side gets help${t}. Pure chess.`,
      };
    }
    return {
      mode: "match", even: false, gap, rung, weaker, stronger,
      headline: `🤝 ${weaker.name || "The lower-rated player"} gets ${rung.name}`,
      detail: `A ${gap}-point gap, so ${weaker.name || "the lower-rated player"} plays with ${rung.name} — ${rung.desc} — and ${stronger.name || "the higher-rated player"} plays unassisted${t}. Every hint is shown to both of you.`,
    };
  }

  // The consequence of taking someone's challenge, from the taker's side. This is
  // the bit that makes the board honest: you see what you'd be agreeing to BEFORE
  // you sit down, not after.
  function previewForTaker(host, taker, mode, minutes) {
    const c = contract(host, taker, mode, minutes);
    if (c.mode === "casual") return { text: "Both of you get full assistance, in the open.", tone: "casual" };
    if (c.even) return { text: `An even fight (${c.gap}-pt gap) — no help for either side.`, tone: "even" };
    const youAreWeaker = c.weaker === taker;
    return {
      text: youAreWeaker
        ? `You'd be the lower-rated player: you get ${c.rung.name}, they play unassisted.`
        : `You'd be the higher-rated player: they get ${c.rung.name}, you play unassisted.`,
      tone: youAreWeaker ? "you-helped" : "they-helped",
    };
  }

  global.GBTerms = { RUNGS, rungForGap, WANTS, wantOf, fmtTime, contract, previewForTaker, esc };
})(typeof window !== "undefined" ? window : this);
