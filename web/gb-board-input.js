// Glassboard SHARED board input — tap AND physics drag, used by BOTH games.
// Extracted so piece handling feels identical whoever you're playing.
//
// Everything the page owns (turn/legality/moving) is INJECTED via the context, so
// this module never reaches for page globals:
//   boardEl, canMove(), isMyPiece(sq), isCapture(sq), legalTargets(), selected(),
//   select(sq), clearSelection(), playMove(from,to), tap(sq), sound(kind,int,delay),
//   setDropIntensity(v), setDropFlip(o)
(function (global) {
  let C = null;
  let press = null; // { from, x0, y0, hasPiece, dragging, ghost, pieceEl, w, h }
  const DRAG_THRESH = 6; // px before a press becomes a drag (so a tap stays a tap)
  // Physics: the ghost is a mass on a slightly under-damped spring tied to the pointer
  // (momentum + a soft settle), it LIFTS on pickup (scale + growing shadow), and it
  // TILTS with its real sideways velocity. On release it lands *from where you let go*
  // (a FLIP into the square) — or swings back home if the drop wasn't legal.
  const SPRING_K = 520, SPRING_C = 34; // stiffness / damping (ζ≈0.75 → a tiny overshoot)
  let gx = 0, gy = 0, vx = 0, vy = 0, tx = 0, ty = 0, grot = 0, glift = 0, gLast = 0, gw = 0, gh = 0, dragRAF = null;
  // Drop feel is reported OUT to the page (it times the landing animation/sound).
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function sqElFromPoint(x, y) { const el = document.elementFromPoint(x, y); const s = el && el.closest && el.closest(".sq"); return s || null; }
  function moveGhost(x, y) {
    if (!press || !press.ghost) return;
    const lift = press.touch ? press.h * 0.7 : 0; // on touch, raise it above the finger
    tx = x - press.w / 2;
    ty = y - press.h / 2 - lift;
    C.boardEl.querySelectorAll(".sq.drag-over").forEach((s) => s.classList.remove("drag-over"));
    const se = sqElFromPoint(x, y);
    if (se && C.legalTargets().includes(+se.dataset.sq)) se.classList.add("drag-over");
  }
  function paintGhost() {
    const g = press && press.ghost; if (!g) return;
    g.style.transform = `translate3d(${gx}px, ${gy}px, 0) scale(${1 + 0.2 * glift}) rotate(${grot}deg)`;
    g.style.filter = `drop-shadow(0 ${4 + 12 * glift}px ${5 + 11 * glift}px rgba(0,0,0,${0.35 + 0.25 * glift}))`;
  }
  function dragTick(now) {
    if (!press || !press.ghost) { dragRAF = null; return; }
    const dt = Math.min(0.032, Math.max(0.001, gLast ? (now - gLast) / 1000 : 0.016)); gLast = now;
    if (reduceMotion()) { gx = tx; gy = ty; vx = vy = 0; glift = 1; grot = 0; }
    else {
      // semi-implicit Euler on a damped spring — stable at any frame rate
      vx += (SPRING_K * (tx - gx) - SPRING_C * vx) * dt; vy += (SPRING_K * (ty - gy) - SPRING_C * vy) * dt;
      gx += vx * dt; gy += vy * dt;
      glift += (1 - glift) * Math.min(1, dt * 14);                // ease up into the lift
      const tilt = Math.max(-16, Math.min(16, vx * 0.018));      // lean with real velocity
      grot += (tilt - grot) * Math.min(1, dt * 18);
    }
    paintGhost();
    dragRAF = requestAnimationFrame(dragTick);
  }
  function startDrag(i, e) {
    if (C.selected() !== i) C.select(i); // highlight legal targets (rebuilds the board)
    const sqEl = C.boardEl.querySelector(`.sq[data-sq="${i}"]`);
    const pieceEl = sqEl && sqEl.querySelector(".piece");
    if (!pieceEl) { press = null; return; }
    const rect = pieceEl.getBoundingClientRect();
    const ghost = pieceEl.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.style.width = rect.width + "px"; ghost.style.height = rect.height + "px";
    ghost.style.left = "0px"; ghost.style.top = "0px";
    document.body.appendChild(ghost);
    pieceEl.classList.add("dragging-src");
    document.body.classList.add("gb-dragging"); clearPageSelection();
    press.dragging = true; press.ghost = ghost; press.pieceEl = pieceEl; press.w = gw = rect.width; press.h = gh = rect.height;
    // Start exactly where the piece sits and let the spring carry it to the pointer —
    // picking it up, not teleporting it.
    gx = rect.left; gy = rect.top; vx = vy = 0; grot = 0; glift = 0; gLast = 0;
    paintGhost();
    moveGhost(e.clientX, e.clientY);
    if (!dragRAF) dragRAF = requestAnimationFrame(dragTick);
    C.sound("lift");
  }
  function endDragVisual() { if (dragRAF) { cancelAnimationFrame(dragRAF); dragRAF = null; } document.body.classList.remove("gb-dragging"); }
  function clearPageSelection() { try { const sel = window.getSelection && window.getSelection(); if (sel && sel.rangeCount) sel.removeAllRanges(); } catch {} }
  // The ghost's on-screen pose (centre, scale, tilt) so the real piece can FLIP from it.
  function ghostPose() { return { x: gx + gw / 2, y: gy + gh / 2, scale: 1 + 0.2 * glift, rot: grot }; }
  // Land a rendered piece from a screen pose into its square: a soft overshoot as it
  // settles, shadow shrinking as it touches down.
  function flipPieceFrom(pieceEl, pose) {
    if (!pieceEl || !pose || reduceMotion()) return 0;
    const r = pieceEl.getBoundingClientRect(); if (!r.width) return 0;
    const dx = pose.x - (r.left + r.width / 2), dy = pose.y - (r.top + r.height / 2);
    pieceEl.classList.add("moving", "landing");
    pieceEl.style.transition = "none";
    pieceEl.style.transform = `translate(${dx}px, ${dy}px) scale(${pose.scale}) rotate(${pose.rot}deg)`;
    const ms = Math.round(Math.min(300, 150 + Math.hypot(dx, dy) * 0.35));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pieceEl.style.transition = `transform ${ms}ms cubic-bezier(.3,1.35,.55,1)`;
      pieceEl.style.transform = "translate(0, 0)";
      setTimeout(() => { pieceEl.classList.remove("moving", "landing"); pieceEl.style.transition = ""; pieceEl.style.transform = ""; }, ms + 20);
    }));
    return ms;
  }
  function onBoardPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!C.canMove()) { press = null; return; }
    const sqEl = e.target.closest && e.target.closest(".sq");
    if (!sqEl) { press = null; return; }
    const i = +sqEl.dataset.sq;
    press = { from: i, x0: e.clientX, y0: e.clientY, hasPiece: C.isMyPiece(i), dragging: false, touch: e.pointerType === "touch" };
  }
  function onBoardPointerMove(e) {
    if (!press || !press.hasPiece) return;
    if (!press.dragging) {
      if (Math.hypot(e.clientX - press.x0, e.clientY - press.y0) < DRAG_THRESH) return;
      startDrag(press.from, e);
    }
    if (press && press.dragging) { e.preventDefault(); moveGhost(e.clientX, e.clientY); }
  }
  function onBoardPointerUp(e) {
    if (!press) return;
    const p = press; press = null;
    if (p.dragging) {
      endDragVisual();
      const pose = ghostPose();
      if (p.ghost) p.ghost.remove();
      if (p.pieceEl) p.pieceEl.classList.remove("dragging-src");
      C.boardEl.querySelectorAll(".sq.drag-over").forEach((s) => s.classList.remove("drag-over"));
      const se = sqElFromPoint(e.clientX, e.clientY);
      const to = se ? +se.dataset.sq : -1;
      if (to >= 0 && to !== p.from && C.legalTargets().includes(to)) {
        C.setDropIntensity(Math.max(0.45, Math.min(1, 0.45 + Math.hypot(vx, vy) / 2600))); // a slammed piece sounds heavier
        C.setDropFlip({ key: p.from + "-" + to, t: performance.now(), ...pose }); // land from the hand, not the old square
        C.playMove(p.from, to);
      } else {
        C.clearSelection(); // dropped off a legal square → swing it back home
        const back = flipPieceFrom(C.boardEl.querySelector(`.sq[data-sq="${p.from}"] .piece`), pose);
        C.sound("move", 0.3, back * 0.45); // a soft tok as it settles back
      }
    } else {
      C.tap(p.from); // a tap — run the normal select/move logic
    }
  }
  function setupBoardInput() {
    if (!C.boardEl) return;
    C.boardEl.addEventListener("pointerdown", onBoardPointerDown);
    // Belt-and-braces for mobile: no selection / long-press menu / native image drag
    // may start from the board, or anywhere while a piece is in hand.
    const blockIfBoard = (e) => { if (press || (e.target && e.target.closest && e.target.closest(".board"))) e.preventDefault(); };
    document.addEventListener("selectstart", blockIfBoard);
    C.boardEl.addEventListener("contextmenu", (e) => e.preventDefault());
    C.boardEl.addEventListener("dragstart", (e) => e.preventDefault());
    window.addEventListener("pointermove", onBoardPointerMove, { passive: false });
    window.addEventListener("pointerup", onBoardPointerUp);
    window.addEventListener("pointercancel", () => {
      if (!press) return;
      endDragVisual();
      const p = press, pose = p.dragging ? ghostPose() : null; press = null;
      if (p.ghost) p.ghost.remove();
      if (p.pieceEl) { p.pieceEl.classList.remove("dragging-src"); flipPieceFrom(p.pieceEl, pose); }
      C.boardEl.querySelectorAll(".sq.drag-over").forEach((s) => s.classList.remove("drag-over"));
    });
  }

  global.GBBoardInput = {
    // The page's landing animation needs this: it flies the piece from where you
    // let go into its square (FLIP), instead of from the old square.
    flipFrom: (pieceEl, pose) => flipPieceFrom(pieceEl, pose),
    attach(ctx) {
      C = Object.assign({
        canMove: () => false, isMyPiece: () => false, isCapture: () => false,
        legalTargets: () => [], selected: () => null, select() {}, clearSelection() {},
        playMove() {}, tap() {}, sound() {}, setDropIntensity() {}, setDropFlip() {},
      }, ctx || {});
      setupBoardInput();
    },
  };
})(window);
