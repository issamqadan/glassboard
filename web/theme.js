// Glassboard board-theme switcher. A theme is just a token override on <html>
// (data-board="…"); style.css defines the token sets.
//
// Board choice is PER GAME, not global: each game remembers its own board, and a
// new game inherits your most recent pick (the global default). Pages with a game
// call GBTheme.setContext(gameId) once the id is known; pages without one just use
// the default. Storage: "gb_board" = default, "gb_board:<id>" = a specific game.
(function () {
  const THEMES = [
    { id: "glass", label: "Glass", light: "#e6ecf5", dark: "#647d9e" },
    { id: "classic", label: "Classic", light: "#ebecd0", dark: "#779556" },   // chess.com green
    { id: "tournament", label: "Tournament", light: "#f0d9b5", dark: "#b58863" }, // lichess brown
    { id: "walnut", label: "Walnut", light: "#ead8b6", dark: "#a5763f" },
    { id: "emerald", label: "Emerald", light: "#eef1d6", dark: "#6f8f57" },
    { id: "midnight", label: "Midnight", light: "#7a8aa6", dark: "#3b4864" },
    { id: "slate", label: "Slate", light: "#9aa6b8", dark: "#333c4d" },        // darker, moody
  ];
  const KEY = "gb_board";                    // the default (last used)
  const gameKey = (id) => KEY + ":" + id;    // a specific game's board
  let ctx = null;                            // current game id, or null

  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  const defaultTheme = () => ls.get(KEY) || "glass";
  // The board for a game: its own saved choice, else the current default.
  const resolve = (id) => (id ? ls.get(gameKey(id)) : null) || defaultTheme();

  function paint(theme) {
    document.documentElement.setAttribute("data-board", theme);
    const ctl = document.getElementById("gb-theme");
    if (ctl) ctl.querySelectorAll(".gb-swatch").forEach((s) => s.classList.toggle("on", s.dataset.id === theme));
  }

  // Pick a board: paint it, make it the new default, and pin it to this game.
  function choose(theme) {
    paint(theme);
    ls.set(KEY, theme);
    if (ctx) ls.set(gameKey(ctx), theme);
  }

  // Point the switcher at a specific game (called once the game id is known).
  function setContext(id) {
    ctx = id || null;
    paint(resolve(ctx));
  }

  // Apply the default as early as possible to avoid a flash; a game context (if
  // any) refines it a moment later via setContext.
  paint(defaultTheme());

  function inject() {
    if (document.getElementById("gb-theme")) return;
    // Prefer a designated slot (e.g. inside the game's settings menu) so the
    // picker isn't a permanent floating row. Otherwise fall back to a COLLAPSED
    // floating pill that expands only on tap — never an always-visible swatch row.
    const slot = document.getElementById("gbThemeSlot");
    if (!slot && !document.querySelector(".board")) return;
    const swatches = THEMES.map(
      (t) => `<button class="gb-swatch" data-id="${t.id}" title="${t.label}" aria-label="${t.label} board" style="--sw-l:${t.light};--sw-d:${t.dark}"><span></span><span></span></button>`
    ).join("");
    const wrap = document.createElement("div");
    wrap.id = "gb-theme";
    if (slot) {
      wrap.className = "gb-theme in-slot";
      wrap.innerHTML = swatches;
      slot.appendChild(wrap);
    } else {
      wrap.className = "gb-theme floating collapsed";
      wrap.innerHTML = `<button class="gb-theme-toggle" aria-label="Board theme" title="Board theme">🎨</button><div class="gb-theme-swatches">${swatches}</div>`;
      document.body.appendChild(wrap);
      wrap.querySelector(".gb-theme-toggle").addEventListener("click", (e) => { e.stopPropagation(); wrap.classList.toggle("collapsed"); });
      document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) wrap.classList.add("collapsed"); });
    }
    wrap.addEventListener("click", (e) => {
      const b = e.target.closest(".gb-swatch");
      if (b) { choose(b.dataset.id); if (wrap.classList.contains("floating")) wrap.classList.add("collapsed"); }
    });
    paint(resolve(ctx)); // set the active swatch to the current board
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();

  window.GBTheme = { list: THEMES, apply: choose, setContext, current: () => resolve(ctx) };
})();
