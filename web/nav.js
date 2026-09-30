// Glassboard — one shared, modern navigation shell for every page.
// A sticky glass top bar (brand · sections · profile) on desktop, and a
// thumb-reachable bottom tab bar on mobile. Injected so there's a single source
// of truth — no more per-page footer links drifting apart.
function gbnav() {
  if (!document.body) { document.addEventListener("DOMContentLoaded", gbnav); return; }
  if (document.querySelector(".gbnav")) return; // don't inject twice
  const cur = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const items = [
    { href: "portal.html", label: "Lobby", icon: "🏠", match: ["portal.html"] },
    { href: "index.html", label: "Play AI", icon: "🤖", match: ["index.html", ""] },
    { href: "learn.html", label: "Learn", icon: "♟", match: ["learn.html"] },
    { href: "strategy.html", label: "Strategies", icon: "📖", match: ["strategy.html"] },
    { href: "help.html", label: "Help", icon: "❓", match: ["help.html"], topOnly: true },
    { href: "forum.html", label: "Forum", icon: "💬", match: ["forum.html"], topOnly: true },
  ];
  let me = null;
  try { me = JSON.parse(localStorage.getItem("gb_me")); } catch {}
  const name = me && me.name ? esc(me.name) : "Sign in";
  const init = me && me.name ? esc(me.name.trim().charAt(0).toUpperCase()) : "+";
  const isOn = (it) => it.match.includes(cur);

  const topLinks = items.map((it) => `<a class="gbnav-link${isOn(it) ? " on" : ""}" href="./${it.href}">${it.label}</a>`).join("");
  const tabLinks = items.filter((it) => !it.topOnly).map((it) =>
    `<a class="gbtab${isOn(it) ? " on" : ""}" href="./${it.href}"><span class="gbtab-ic">${it.icon}</span><span>${it.label}</span></a>`
  ).join("");

  const top = document.createElement("header");
  top.className = "gbnav";
  top.innerHTML =
    `<a class="gbnav-brand" href="./portal.html"><span class="gbnav-mark">♞</span> Glassboard</a>` +
    `<nav class="gbnav-links">${topLinks}</nav>` +
    `<a class="gbnav-me" href="./portal.html" title="${name}"><span class="gbnav-av">${init}</span><span class="gbnav-name">${name}</span></a>`;
  document.body.insertBefore(top, document.body.firstChild);

  // Mobile bottom tabs: the primary destinations + a "More" overflow that holds the
  // secondary ones (Help, Forum, Two players, profile) — so nothing is desktop-only.
  const moreOn = ["help.html", "forum.html", "twoplayer.html"].includes(cur);
  const tabs = document.createElement("nav");
  tabs.className = "gbtabs";
  tabs.innerHTML = tabLinks + `<a class="gbtab${moreOn ? " on" : ""}" href="#" id="gbMore"><span class="gbtab-ic">⋯</span><span>More</span></a>`;
  document.body.appendChild(tabs);

  const moreMenu = document.createElement("div");
  moreMenu.className = "gbmore-menu"; moreMenu.hidden = true;
  moreMenu.innerHTML =
    `<a href="./help.html"${cur === "help.html" ? ' class="on"' : ""}>❓ How Glassboard works</a>` +
    `<a href="./forum.html"${cur === "forum.html" ? ' class="on"' : ""}>💬 Forum &amp; feedback</a>` +
    `<a href="./twoplayer.html"${cur === "twoplayer.html" ? ' class="on"' : ""}>👥 Two players (same screen)</a>` +
    `<a href="#" id="gbMoreProfile"><span class="gbmore-av">${init}</span> ${name}</a>`;
  document.body.appendChild(moreMenu);
  const moreBtn = tabs.querySelector("#gbMore");
  const closeMore = () => { moreMenu.hidden = true; };
  if (moreBtn) moreBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); moreMenu.hidden = !moreMenu.hidden; });
  document.addEventListener("click", (e) => { if (!moreMenu.hidden && !moreMenu.contains(e.target)) closeMore(); });
  const moreProf = moreMenu.querySelector("#gbMoreProfile");
  if (moreProf) moreProf.addEventListener("click", (e) => { e.preventDefault(); closeMore(); if (typeof window.gbNavProfile === "function") window.gbNavProfile(); else location.href = "./portal.html"; });

  // Profile chip opens the identity modal in-place when a page provides one
  // (the portal); otherwise it navigates to the portal.
  const meEl = top.querySelector(".gbnav-me");
  if (meEl) meEl.addEventListener("click", (e) => {
    if (typeof window.gbNavProfile === "function") { e.preventDefault(); window.gbNavProfile(); }
  });
  window.gbNavSetProfile = (nm) => {
    const av = top.querySelector(".gbnav-av"), nameEl = top.querySelector(".gbnav-name");
    if (av) av.textContent = nm ? esc(nm.trim().charAt(0).toUpperCase()) : "+";
    if (nameEl) nameEl.textContent = nm ? esc(nm) : "Sign in";
  };

  const css = `
  /* Fixed (not sticky): the game pages use body{display:flex}, where a sticky
     bar would become a side-by-side flex item. Fixed keeps it out of flow. */
  body { padding-top: 58px; }
  .gbnav { position: fixed; top: 0; left: 0; right: 0; z-index: 60; display: flex; align-items: center; gap: 18px;
    padding: 0 clamp(14px, 4vw, 26px); height: 58px;
    background: linear-gradient(180deg, rgba(9,13,20,0.92), rgba(9,13,20,0.68));
    backdrop-filter: blur(18px) saturate(140%); -webkit-backdrop-filter: blur(18px) saturate(140%);
    border-bottom: 1px solid rgba(255,255,255,0.07); }
  .gbnav-brand { display: flex; align-items: center; gap: 10px; font-weight: 750; letter-spacing: -0.01em; color: #eaf0fb; text-decoration: none; font-size: 1.02rem; }
  .gbnav-mark { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: #04222d; font-size: 15px;
    background: linear-gradient(150deg, #5cc9ec, #3a8fb3); box-shadow: 0 6px 16px -6px rgba(92,201,236,0.7), inset 0 0 0 1px rgba(255,255,255,0.25); }
  .gbnav-links { display: flex; align-items: center; gap: 4px; margin-left: 8px; }
  .gbnav-link { color: #9aa8c2; text-decoration: none; font-size: 0.92rem; font-weight: 560; padding: 8px 14px; border-radius: 10px; transition: color .15s, background .15s; }
  .gbnav-link:hover { color: #eaf0fb; background: rgba(255,255,255,0.05); }
  .gbnav-link.on { color: #eaf0fb; background: rgba(92,201,236,0.16); box-shadow: inset 0 0 0 1px rgba(92,201,236,0.4); }
  .gbnav-me { margin-left: auto; display: flex; align-items: center; gap: 9px; padding: 5px 12px 5px 6px; border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.09); background: rgba(255,255,255,0.04); color: #cdd8e8; text-decoration: none; font-size: 0.86rem; }
  .gbnav-me:hover { border-color: rgba(92,201,236,0.5); color: #eaf0fb; }
  .gbnav-av { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 0.78rem; color: #06121a;
    background: linear-gradient(140deg, #7ee0d6, #5cc9ec); }
  /* turn-awareness badge on the Lobby link (other games that need your move) */
  .gbnav-link, .gbtab { position: relative; }
  .gbnav-badge { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; margin-left: 6px;
    border-radius: 999px; background: #45c86e; color: #04220f; font-size: 0.68rem; font-weight: 800; vertical-align: middle;
    animation: gbnav-badge-p 1.6s ease-in-out infinite; }
  .gbtab .gbnav-badge { position: absolute; top: 2px; right: 50%; margin: 0; transform: translateX(16px); }
  @keyframes gbnav-badge-p { 0%,100% { box-shadow: 0 0 0 0 rgba(69,200,110,0); } 50% { box-shadow: 0 0 0 5px rgba(69,200,110,0.28); } }
  @media (prefers-reduced-motion: reduce) { .gbnav-badge { animation: none; } }
  /* mobile bottom tab bar */
  .gbtabs { display: none; }
  @media (max-width: 640px) {
    .gbnav-links { display: none; }
    .gbnav-name { display: none; }
    .gbtabs { display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 60; padding: 6px 6px calc(6px + env(safe-area-inset-bottom, 0px));
      background: linear-gradient(0deg, rgba(9,13,20,0.96), rgba(9,13,20,0.8)); backdrop-filter: blur(18px); border-top: 1px solid rgba(255,255,255,0.08); }
    .gbtab { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 0; color: #8494ad; text-decoration: none; font-size: 0.66rem; font-weight: 600; }
    .gbtab-ic { font-size: 1.2rem; line-height: 1; }
    .gbtab.on { color: #5cc9ec; }
    body { padding-bottom: 64px; }
  }
  /* "More" overflow menu (mobile) — sits above the tab bar */
  .gbmore-menu { position: fixed; right: 8px; bottom: calc(64px + env(safe-area-inset-bottom, 0px)); z-index: 61;
    background: linear-gradient(165deg, #16243a, #0d1320); border: 1px solid rgba(255,255,255,0.12); border-radius: 14px;
    padding: 6px; display: flex; flex-direction: column; gap: 2px; min-width: 210px;
    box-shadow: 0 20px 44px -18px rgba(0,0,0,0.85); }
  .gbmore-menu[hidden] { display: none; }
  .gbmore-menu a { display: flex; align-items: center; gap: 10px; padding: 12px 13px; border-radius: 10px;
    color: #cdd8e8; text-decoration: none; font-size: 0.92rem; font-weight: 600; }
  .gbmore-menu a:hover, .gbmore-menu a:active { background: rgba(255,255,255,0.06); }
  .gbmore-menu a.on { color: #eaf0fb; background: rgba(92,201,236,0.16); }
  .gbmore-av { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 0.74rem;
    color: #06121a; background: linear-gradient(140deg, #7ee0d6, #5cc9ec); }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  // Turn awareness across games: badge the Lobby link when OTHER active games
  // are waiting on your move (so you know mid-game that another board needs you).
  function setLobbyBadge(n) {
    document.querySelectorAll(".gbnav-link, .gbtab").forEach((a) => {
      if (!/portal\.html/.test(a.getAttribute("href") || "")) return;
      let b = a.querySelector(".gbnav-badge");
      if (n > 0) {
        if (!b) { b = document.createElement("span"); b.className = "gbnav-badge"; a.appendChild(b); }
        b.textContent = n > 9 ? "9+" : String(n);
      } else if (b) { b.remove(); }
    });
  }
  function gbTurnPoll() {
    let me = null;
    try { me = JSON.parse(localStorage.getItem("gb_me")); } catch {}
    if (!me || !me.id) return;
    const server = location.protocol === "https:"
      ? "https://playglassboard.onrender.com"
      : "http://" + (location.hostname || "localhost") + ":9001";
    const curRoom = new URLSearchParams(location.search).get("room");
    fetch(server + "/games?player=" + encodeURIComponent(me.id))
      .then((r) => r.json())
      .then((list) => {
        const need = (list || []).filter(
          (g) => g.status === "active" && !g.over && g.turn && g.turn === g.color && g.id !== curRoom
        ).length;
        setLobbyBadge(need);
      })
      .catch(() => {});
  }
  gbTurnPoll();
  setInterval(gbTurnPoll, 12000);
}
gbnav();

// Anonymous page-hit beacon (admin traffic view). Device id + chosen name only.
(function gbHit() {
  try {
    var page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    if (page === "admin.html" || page === "sf-test.html") return; // don't count admin/diagnostics
    var server = location.protocol === "https:" ? "https://playglassboard.onrender.com" : "http://" + (location.hostname || "localhost") + ":9001";
    var vid = "";
    try { vid = localStorage.getItem("gb_pid") || ""; if (!vid) { vid = "v" + Math.random().toString(36).slice(2, 10); localStorage.setItem("gb_pid", vid); } } catch (e) {}
    var name = "";
    try { var me = JSON.parse(localStorage.getItem("gb_me")); name = me && me.name ? me.name : ""; } catch (e) {}
    var body = JSON.stringify({ page: page, visitor: vid, name: name });
    if (navigator.sendBeacon) navigator.sendBeacon(server + "/hit", new Blob([body], { type: "application/json" }));
    else fetch(server + "/hit", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {});
  } catch (e) {}
})();
