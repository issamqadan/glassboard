// Glassboard ASSISTANCE SHEET — the mobile peek line, shared by both game types.
//
// On a phone the whole strategy experience is one surface anchored above the tab
// bar: PEEK (the plan, its progress, the current objective, and the move) →
// CHOOSE → GUIDE. This module owns only the PEEK line and the open/collapsed
// classes. What goes INSIDE the sheet is still the Glass Lens (the guide) and the
// plan chooser — the same code desktop renders — so the two can never drift.
//
// It lives here, and not in main.js, for the standing rule that anything added to
// Play-AI has to show up identically in a human game. The last time a surface was
// written twice, the two copies disagreed within a week.
//
// On desktop the sheet element is `display: contents`, so it has no box at all and
// the right rail lays out exactly as it did before the sheet existed. Everything
// here still runs; it simply has nothing visible to affect.
(function (global) {
  const STRAT_ICON = {
    save_piece: "🛡", win_material: "⚔", develop: "♞", center: "▦", attack_king: "⚔",
    simplify: "♟", passer: "⏫", iso_attack: "◎", minority_attack: "⇉", iqp_attack: "◈",
    open_file: "▤", pawn_storm: "⛰", fianchetto: "◹", outpost: "⚑", rook_seventh: "⇥",
    improve: "↗", pawn_break: "⚡",
  };
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // o = {
  //   sheet, peek, quick   — the three elements
  //   state                — the GBStrategyState record
  //   live                 — the engine's current view of that plan (may be null)
  //   ply                  — for the honest "moved away from this plan" line
  //   open                 — is the sheet expanded?
  //   move                 — { san } to offer while collapsed, or null
  //   onToggle, onQuick    — handlers
  // }
  function render(o) {
    const S = global.GBStrategyState;
    const sheet = o.sheet, peek = o.peek, quick = o.quick;
    if (!sheet || !peek || !S) return;

    const st = o.state;
    const has = S.isLive(st);
    const steps = (o.live && o.live.steps) || (st && st.steps) || [];
    const done = steps.filter((x) => x && x.done).length;
    const name = (o.live && o.live.name) || (st && st.name) || "";
    // statusLine() is deliberate: when the position has moved away from the plan it
    // says so instead of pretending the next objective is still on track.
    const now = S.statusLine(st, o.ply || 0) || (st && st.objective) || "";
    const chev = o.open ? "▾" : "▴";

    peek.innerHTML = has
      ? `<span class="ap-main"><span class="ap-ic">${STRAT_ICON[st && st.id] || "🧭"}</span>` +
          `<b>${esc(name)}</b>` +
          (steps.length ? `<span class="ap-prog">${done}/${steps.length}</span>` : "") +
          `<span class="ap-chev">${chev}</span></span>` +
        (now ? `<span class="ap-now">${esc(now)}</span>` : "")
      : `<span class="ap-main"><span class="ap-ic">🧭</span><b>Choose a strategy</b>` +
          `<span class="ap-chev">${chev}</span></span>` +
        `<span class="ap-now">Pick a plan and follow it step by step.</span>`;
    peek.setAttribute("aria-expanded", o.open ? "true" : "false");
    sheet.classList.toggle("open", !!o.open);
    sheet.classList.toggle("peek", !o.open);
    peek.onclick = o.onToggle || null;

    // The move stays one tap away while collapsed — "reachable without scrolling"
    // has to include the thing you actually came here to do.
    if (quick) {
      quick.hidden = !o.move;
      if (o.move) {
        quick.textContent = "▶ " + (o.move.san || "Play");
        quick.onclick = (ev) => { ev.stopPropagation(); if (o.onQuick) o.onQuick(o.move); };
      }
    }
  }

  global.GBAssistSheet = { render, STRAT_ICON };
})(typeof window !== "undefined" ? window : this);
