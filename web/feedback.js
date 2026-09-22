// Glassboard — post-game feedback capture. The POC exit gate is "both players
// say it was fun and fair," so we ask exactly that at game end and report it to
// the server (both devices submit independently). Shared by every mode.
(function () {
  const SERVER = "https://playglassboard.onrender.com";
  function pid() {
    try { const me = JSON.parse(localStorage.getItem("gb_me")); if (me && me.id) return me.id; } catch {}
    return localStorage.getItem("gb_pid") || "";
  }
  window.gbFeedback = {
    render(el, opts) {
      if (!el) return;
      opts = opts || {};
      let fun = null, fair = null;
      el.hidden = false;
      el.innerHTML =
        `<div class="fb-q">How was that game?</div>` +
        `<div class="fb-rows">` +
          `<div class="fb-row"><span class="fb-lab">Fun?</span><button class="fb-b" data-k="fun" data-v="1">👍</button><button class="fb-b" data-k="fun" data-v="0">👎</button></div>` +
          `<div class="fb-row"><span class="fb-lab">Fair?</span><button class="fb-b" data-k="fair" data-v="1">👍</button><button class="fb-b" data-k="fair" data-v="0">👎</button></div>` +
        `</div>` +
        `<input class="fb-note" id="fbNote" placeholder="Anything to add? (optional)" maxlength="500" />` +
        `<button class="fb-send" id="fbSend" disabled>Send feedback</button>` +
        `<div class="fb-thanks" id="fbThanks" hidden>Thanks — noted 🙏 It goes straight to the playtest log.</div>`;
      const send = el.querySelector("#fbSend");
      el.querySelectorAll(".fb-b").forEach((b) => {
        b.onclick = () => {
          const k = b.dataset.k, v = b.dataset.v === "1";
          if (k === "fun") fun = v; else fair = v;
          el.querySelectorAll(`.fb-b[data-k="${k}"]`).forEach((x) => x.classList.toggle("on", x === b));
          send.disabled = fun === null || fair === null;
        };
      });
      send.onclick = () => {
        const note = (el.querySelector("#fbNote").value || "").trim();
        fetch(SERVER + "/feedback", {
          method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
          body: JSON.stringify({ game_id: opts.gameId || "", player: pid(), mode: opts.mode || "", fun: !!fun, fair: !!fair, note }),
        }).catch(() => {});
        el.querySelector(".fb-q").style.display = "none";
        el.querySelector(".fb-rows").style.display = "none";
        el.querySelector("#fbNote").style.display = "none";
        send.style.display = "none";
        el.querySelector("#fbThanks").hidden = false;
      };
    },
  };
})();
