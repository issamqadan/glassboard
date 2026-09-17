// Glassboard board-theme switcher. A theme is just a token override on <html>
// (data-board="…"); style.css defines the token sets. Applies the saved choice
// immediately and injects a small swatch control on any page that has a board.
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
  const KEY = "gb_board";
  const saved = () => {
    try { return localStorage.getItem(KEY) || "glass"; } catch { return "glass"; }
  };
  function apply(id) {
    document.documentElement.setAttribute("data-board", id);
    try { localStorage.setItem(KEY, id); } catch {}
  }

  // Apply as early as possible to avoid a flash of the default palette.
  apply(saved());

  function inject() {
    if (!document.querySelector(".board")) return;      // only where a real board exists
    if (document.getElementById("gb-theme")) return;
    const cur = saved();
    const wrap = document.createElement("div");
    wrap.id = "gb-theme";
    wrap.className = "gb-theme";
    wrap.innerHTML =
      '<span class="gb-theme-lab">Board</span>' +
      THEMES.map(
        (t) =>
          `<button class="gb-swatch${t.id === cur ? " on" : ""}" data-id="${t.id}" title="${t.label}" aria-label="${t.label} board" style="--sw-l:${t.light};--sw-d:${t.dark}"><span></span><span></span></button>`
      ).join("");
    wrap.addEventListener("click", (e) => {
      const b = e.target.closest(".gb-swatch");
      if (!b) return;
      apply(b.dataset.id);
      wrap.querySelectorAll(".gb-swatch").forEach((x) => x.classList.toggle("on", x === b));
    });
    document.body.appendChild(wrap);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();

  window.GBTheme = { list: THEMES, apply, current: saved };
})();
