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
  ];
  let me = null;
  try { me = JSON.parse(localStorage.getItem("gb_me")); } catch {}
  const name = me && me.name ? esc(me.name) : "Sign in";
  const init = me && me.name ? esc(me.name.trim().charAt(0).toUpperCase()) : "+";
  const isOn = (it) => it.match.includes(cur);

  const topLinks = items.map((it) => `<a class="gbnav-link${isOn(it) ? " on" : ""}" href="./${it.href}">${it.label}</a>`).join("");
  const tabLinks = items.map((it) =>
    `<a class="gbtab${isOn(it) ? " on" : ""}" href="./${it.href}"><span class="gbtab-ic">${it.icon}</span><span>${it.label}</span></a>`
  ).join("");

  const top = document.createElement("header");
  top.className = "gbnav";
  top.innerHTML =
    `<a class="gbnav-brand" href="./portal.html"><span class="gbnav-mark">♞</span> Glassboard</a>` +
    `<nav class="gbnav-links">${topLinks}</nav>` +
    `<a class="gbnav-me" href="./portal.html" title="${name}"><span class="gbnav-av">${init}</span><span class="gbnav-name">${name}</span></a>`;
  document.body.insertBefore(top, document.body.firstChild);

  const tabs = document.createElement("nav");
  tabs.className = "gbtabs";
  tabs.innerHTML = tabLinks + `<a class="gbtab" href="./portal.html"><span class="gbtab-ic">👤</span><span>You</span></a>`;
  document.body.appendChild(tabs);

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
  }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
}
gbnav();
