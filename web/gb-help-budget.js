// Glassboard HELP BUDGET — assistance as a finite, agreed, negotiable resource.
//
// Issam's idea (2026-10-09): help should be a fixed allowance agreed before the
// game, counting down visibly as it's spent. When it runs out you have to ASK your
// opponent for more — and they decide. The AI decides from the position, its level
// and its personality; a human decides however they feel. The result screen reports
// what was spent, asked for, granted and refused.
//
// Why this belongs in the vision rather than just being a fun mechanic:
//   • Guardrail #1 (no hidden help) — a countdown and a request/grant exchange make
//     assistance MORE visible, not less. Help becomes a transaction on the record.
//   • Guardrail #4 (a ladder down, not a crutch) — unlimited help has no reason to
//     fade. Scarcity is what turns "help" into "needing less help", and earn-back
//     pays you for moves you found yourself.
//
// And the one place it could have VIOLATED the vision, which shapes the design:
//   • Guardrail #2 says the most equalizing configuration is always the free
//     default. A flat allowance the opponent may refuse would let a stronger player
//     starve a beginner of exactly the help that keeps the game competitive — the
//     outcome this project exists to prevent. So: the allowance is sized to the
//     RATING GAP (the weaker player gets more), and SAFETY IS NEVER SPENDABLE.
//     Running out means "on your own judgement", never "blind".
(function (global) {
  // ---- what costs, and what never does ------------------------------------
  // Scarce: the help that plays the move for you.
  // Free forever: the help that stops you losing a piece to something you simply
  // didn't see. A beginner at zero tokens must still be in a game.
  const SCARCE = {
    best: "the single best move",
    plan: "a plan to follow",
    candidates: "ranked candidate moves",
  };
  const FREE = {
    hanging: "a piece of yours can be taken",
    check: "you are in check",
    mate: "a checkmate threat",
    meaning: "what a move you're looking at would do",
  };
  const isScarce = (kind) => Object.prototype.hasOwnProperty.call(SCARCE, kind);
  const isFree = (kind) => Object.prototype.hasOwnProperty.call(FREE, kind);

  // ---- the allowance -------------------------------------------------------
  // Sized to the gap, on the same ladder as the handicap itself: the wider the
  // mismatch, the more the weaker player may lean on help. Casual is unlimited —
  // it's the explicit "just play" mode and has no ratings to protect.
  const BY_RUNG = { off: 2, hint: 3, coach: 4, guide: 6, assist: 8, autopilot: 10 };
  function tokensFor(opts) {
    opts = opts || {};
    if (opts.mode === "casual") return Infinity;
    const gap = Math.abs(Number(opts.gap) || 0);
    const rung = (global.GBTerms && global.GBTerms.rungForGap)
      ? global.GBTerms.rungForGap(gap).key
      : (gap < 100 ? "off" : gap < 300 ? "hint" : gap < 500 ? "coach" : gap < 800 ? "guide" : gap < 1200 ? "assist" : "autopilot");
    return BY_RUNG[rung] || 4;
  }
  const unlimited = (n) => n === Infinity;

  // ---- earn-back -----------------------------------------------------------
  // Find a move the engine also rates best, WITHOUT having spent help on that
  // position, and you get a token back. This is guardrail #4 as a game rule:
  // the reward for needing less help is more help in reserve.
  function earnBack(o) {
    o = o || {};
    if (unlimited(o.tokensLeft)) return { earn: false, reason: "" };
    if (!o.wasBest) return { earn: false, reason: "" };
    if (o.usedHelp) return { earn: false, reason: "found with help — no refund" };
    if (o.tokensLeft >= o.max) return { earn: false, reason: "already at full allowance" };
    return { earn: true, reason: "You found the best move yourself — have one back." };
  }

  // ---- the opponent's decision (AI side) -----------------------------------
  // A PURE function of the position, the level and the personality: same inputs,
  // same answer. Deliberately not random — the player should be able to learn how
  // their opponent thinks, and a refusal they can't understand just feels unfair.
  //
  //  cp         — evaluation from the AI's point of view (+ = the AI is better)
  //  skill      — the AI's Stockfish skill for this level (0..20)
  //  style      — "balanced" | "aggressive" | "positional" | "defensive" | "wildcard"
  //  grantedSoFar — how many extra tokens it has already given this game
  // Returns { grant, amount, reason, line } — `line` is what the character says.
  const GENEROSITY = { positional: 1, defensive: 1, balanced: 0, aggressive: -1, wildcard: -1 };
  const MAX_GRANTS = 3; // an allowance can be topped up, not made infinite
  function aiVerdict(o) {
    o = o || {};
    const cp = Number(o.cp) || 0;
    const skill = Math.max(0, Math.min(20, Number(o.skill) || 0));
    const granted = Number(o.grantedSoFar) || 0;
    if (granted >= MAX_GRANTS) {
      return { grant: false, amount: 0, reason: "already topped you up " + granted + " times",
               line: "I've been generous enough for one game." };
    }
    // Comfortably ahead → granting costs nothing and it can afford to be sporting.
    if (cp >= 250) {
      return { grant: true, amount: 2, reason: "it is clearly ahead, so it can afford to be generous",
               line: "I'm well ahead — take two, let's make a game of it." };
    }
    // Behind → it is fighting for its life and says no.
    if (cp <= -150) {
      return { grant: false, amount: 0, reason: "it is losing and will not help you finish it off",
               line: "You're already on top. I'll take my chances." };
    }
    // A close game is where personality and level decide. Strong, sharp opponents
    // guard their edge; patient ones coach.
    const score = GENEROSITY[o.style] != null ? GENEROSITY[o.style] : 0;
    const stingyByLevel = skill >= 16 ? -1 : skill >= 9 ? 0 : 1;
    const total = score + stingyByLevel;
    if (total >= 1) {
      return { grant: true, amount: 1, reason: "a patient opponent at this level will coach you",
               line: "It's close — one more, then you're on your own." };
    }
    return { grant: false, amount: 0, reason: "the game is balanced and this opponent guards its edge",
             line: "Too close to call. No freebies here." };
  }

  // ---- TAKEBACKS -----------------------------------------------------------
  // Same shape as the help allowance, and Issam's point that it matters MORE is
  // right: help only tells you what to play, a takeback un-plays it. So it is
  // agreed up front, counted, and every single one needs the opponent's yes —
  // including against the AI, which previously let you undo as often as you liked
  // with nobody's permission.
  //
  // EVERYONE gets one free. An "oops" you can't take back is the single most
  // common way a beginner's game stops being fun, and the free one costs the
  // stronger player almost nothing. Beyond that the gap decides, same as help.
  const FREE_TAKEBACKS = 1;
  function takebacksFor(opts) {
    opts = opts || {};
    if (opts.mode === "casual") return Infinity; // "just play" mode stays permissive
    const gap = Math.abs(Number(opts.gap) || 0);
    const extra = gap >= 800 ? 2 : gap >= 300 ? 1 : 0;
    return FREE_TAKEBACKS + extra;
  }

  // Whether the opponent allows THIS takeback. Pure, like the help verdict, so a
  // player can learn the character rather than being refused at random.
  //  cp        — from the opponent's point of view (+ = the opponent is better)
  //  usedSoFar — takebacks this player has already been granted
  //  allowance — what was agreed at the start
  function aiTakebackVerdict(o) {
    o = o || {};
    const cp = Number(o.cp) || 0;
    const skill = Math.max(0, Math.min(20, Number(o.skill) || 0));
    const used = Number(o.usedSoFar) || 0;
    const allowance = Number(o.allowance) || 0;
    if (used >= allowance) {
      return { grant: false, reason: "the agreed takebacks are used up",
               line: "We agreed on " + allowance + ". That's " + allowance + "." };
    }
    // The first one was agreed as free — refusing it would make the agreement a lie.
    if (used < FREE_TAKEBACKS) {
      return { grant: true, reason: "the first takeback was agreed as free",
               line: "Go on — that one's free, we agreed." };
    }
    // Losing badly? A takeback that helps you finish it off is an easy no.
    if (cp <= -200) {
      return { grant: false, reason: "it is losing and will not help you tidy up",
               line: "You're winning as it is. I'll keep what I've got." };
    }
    // Comfortably ahead: sporting, and it costs nothing.
    if (cp >= 250) {
      return { grant: true, reason: "it is well ahead and can afford to be sporting",
               line: "Take it back. I'm not worried." };
    }
    const score = (GENEROSITY[o.style] != null ? GENEROSITY[o.style] : 0) + (skill >= 16 ? -1 : skill >= 9 ? 0 : 1);
    if (score >= 1) {
      return { grant: true, reason: "a patient opponent at this level allows it",
               line: "Fine — learn from it." };
    }
    return { grant: false, reason: "a close game and this opponent plays it straight",
             line: "A move's a move. Let's play on." };
  }

  // ---- display -------------------------------------------------------------
  function pips(left, max) {
    if (unlimited(left)) return "∞";
    const n = Math.max(0, Math.min(max, left));
    return "●".repeat(n) + "○".repeat(Math.max(0, max - n));
  }
  // One honest line for the result screen. Anything that didn't happen is omitted
  // rather than reported as a zero — same rule as the recap.
  function summary(o) {
    o = o || {};
    if (unlimited(o.max)) return "Casual — help was unlimited for both of you.";
    const bits = [];
    bits.push(`Spent <b>${o.spent || 0}</b> of your <b>${o.max || 0}</b> help token${(o.max || 0) === 1 ? "" : "s"}`);
    if (o.earned) bits.push(`earned <b>${o.earned}</b> back by finding the best move unaided`);
    if (o.asked) bits.push(`asked for more <b>${o.asked}</b> time${o.asked === 1 ? "" : "s"} (granted <b>${o.granted || 0}</b>)`);
    if (!o.spent && !o.asked) return "You played the whole game without spending a single help token.";
    return bits.join(" · ") + ".";
  }

  global.GBHelpBudget = {
    SCARCE, FREE, isScarce, isFree, tokensFor, earnBack, aiVerdict, pips, summary,
    MAX_GRANTS, unlimited, takebacksFor, aiTakebackVerdict, FREE_TAKEBACKS,
  };
})(typeof window !== "undefined" ? window : this);
