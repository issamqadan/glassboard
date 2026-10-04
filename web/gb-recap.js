// Glassboard SHARED game recap — the playful post-game highlight reel, used by BOTH
// Play-AI and human games so the payoff is identical whoever you played.
//
// Pure: every input is injected. The caller supplies what it measured; anything it
// could not measure is simply omitted rather than faked (an empty accuracy is honest,
// an invented one is not).
//
// ctx: {
//   result:   { won, draw, reason }
//   moves:    [{ cp, own, wasBest? }]   your moves, cp = centipawn loss (null if unmeasured)
//   evalTrail:[{ ply, cp }]             your-relative eval per turn (optional)
//   plies:    number                    total half-moves played
//   opponent: { name, rank, style, tag } who you faced (tag may carry an emoji)
//   opening:  { name } | null
//   helpable: bool                      was help on offer at all?
//   lifelines: number                   opponent lifelines spent (AI only; 0 otherwise)
//   sanForPly(ply) -> string            the caller knows its own move history
//   score:    { total, self, assist, ratingAfter, lifetime } | null
// }
(function (global) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function build(ctx) {
    ctx = ctx || {};
    const R = ctx.result || { won: false, draw: false, reason: "" };
    const moves = ctx.moves || [];
    const trail = ctx.evalTrail || [];
    const san = ctx.sanForPly || (() => "");
    const opp = ctx.opponent || {};
    const measured = moves.filter((m) => m.cp != null && m.cp >= 0);
    const fullMoves = Math.ceil((ctx.plies || 0) / 2);

    let accuracy = null;
    if (measured.length >= 3) {
      const avg = measured.reduce((s, m) => s + m.cp, 0) / measured.length;
      accuracy = Math.round(Math.max(12, Math.min(99, 100 * Math.exp(-avg / 300))));
    }
    const bestCount = moves.filter((m) => m.wasBest).length;
    const ownN = moves.filter((m) => m.own).length;
    const indepPct = moves.length ? Math.round((ownN / moves.length) * 100) : 100;

    const cps = trail.map((e) => e.cp);
    const lowest = cps.length ? Math.min.apply(null, cps) : 0;
    const comeback = R.won && lowest <= -180;

    // Turning point: the biggest swing your way between consecutive turns, attributed
    // to YOUR move that started it (so the SAN refers to a move actually played).
    let tpI = -1, tpSwing = 0;
    for (let i = 1; i < trail.length; i++) { const d = trail[i].cp - trail[i - 1].cp; if (d > tpSwing) { tpSwing = d; tpI = i; } }
    let turning = null;
    if (tpI > 0 && tpSwing >= 150) {
      const ply = trail[tpI - 1].ply;
      turning = { san: san(ply), swing: tpSwing, move: Math.floor(ply / 2) + 1 };
    }

    // Your best move (prefer one you found yourself) and the biggest slip.
    let best = null, worst = null;
    moves.forEach((m, k) => {
      if (m.cp == null) return;
      if (m.wasBest && (!best || (m.own && !best.own))) best = { k, own: m.own };
      if (!worst || m.cp > worst.cp) worst = { k, cp: m.cp };
    });
    const bestSan = best && m2ply(best.k) != null ? san(m2ply(best.k)) : "";
    const worstOut = worst && worst.cp >= 120 ? { san: san(m2ply(worst.k)), cp: worst.cp, move: worst.k + 1 } : null;
    function m2ply(k) { return typeof ctx.myMovePly === "function" ? ctx.myMovePly(k) : null; }

    const foeTag = opp.tag || opp.name || "your opponent";
    const rank = [opp.style, opp.rank].filter(Boolean).join(" ");
    let persona;
    if (R.draw) persona = { emoji: "🛡", title: "Held the Line", line: "A hard-fought draw — you didn't crack." };
    else if (!R.won) persona = { emoji: "📚", title: "Learning Round", line: "Not this time — but every loss teaches. See the turning point below." };
    else if (comeback) persona = { emoji: "🔥", title: "Comeback Kid", line: "You were on the ropes — and turned it around." };
    else if (/Master|Expert/.test(opp.rank || "")) persona = { emoji: "🐉", title: "Giant Slayer", line: `You took down ${foeTag}${rank ? ` — a ${rank}` : ""}.` };
    else if (accuracy != null && accuracy >= 90 && indepPct >= 60) persona = { emoji: "🎩", title: "The Maestro", line: "Precise — and mostly on your own." };
    else if (ctx.helpable && indepPct >= 75) persona = { emoji: "💪", title: "Solo Act", line: "You found the moves yourself." };
    else if (ctx.helpable && indepPct < 50) persona = { emoji: "🤝", title: "Well-Guided", line: "You leaned on the help and it paid off — next time, try needing it less." };
    else if (R.reason === "checkmate") persona = { emoji: "⚔", title: "The Finisher", line: "Closed it out with checkmate." };
    else persona = { emoji: "🏆", title: "Winner", line: "A solid win." };

    const badges = [];
    if (accuracy != null && accuracy >= 85) badges.push({ ic: "🎯", label: `${accuracy}% accuracy` });
    if (R.reason === "checkmate" && R.won) badges.push({ ic: "♚", label: "Checkmate" });
    if (ctx.helpable && indepPct >= 70) badges.push({ ic: "💪", label: `${indepPct}% your own` });
    if (ctx.lifelines > 0) badges.push({ ic: "🛟", label: `Opponent dug deep ×${ctx.lifelines}` });
    if (ctx.opening) badges.push({ ic: "📖", label: ctx.opening.name });
    if (fullMoves >= 40) badges.push({ ic: "🐢", label: `${fullMoves}-move epic` });
    if (bestCount >= 5) badges.push({ ic: "⭐", label: `${bestCount} best moves` });
    if (comeback) badges.push({ ic: "🔥", label: "Comeback" });

    const verb = R.draw ? "drew with" : R.won ? "beat" : "battled";
    const share = `I just ${verb} ${opp.name || "my opponent"}${rank ? ` (${rank})` : ""}${accuracy != null ? ` with ${accuracy}% accuracy` : ""} on Glassboard ♟️ — chess, in the open.`;
    return { R, persona, accuracy, indepPct, bestCount, fullMoves, opponent: opp, rank, opening: ctx.opening,
             turning, bestSan, best, worst: worstOut, lifelines: ctx.lifelines || 0, badges, share,
             helpable: !!ctx.helpable, score: ctx.score || null };
  }

  // Momentum sparkline — your-relative eval across your turns. Teal above the line
  // (ahead), red below (behind). Returns "" when there isn't enough to be meaningful.
  function sparkline(trail) {
    const vals = (trail || []).map((e) => (typeof e === "number" ? e : e.cp));
    const n = vals.length;
    if (n < 3) return "";
    const W = 300, H = 64, pad = 5, cap = 800;
    const clamp = (v) => Math.max(-cap, Math.min(cap, v));
    const x = (i) => pad + (i / (n - 1)) * (W - 2 * pad);
    const y = (v) => H / 2 - (clamp(v) / cap) * (H / 2 - pad);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const line = "M" + pts.join(" L");
    const area = `M${x(0).toFixed(1)},${(H / 2).toFixed(1)} L` + pts.join(" L") + ` L${x(n - 1).toFixed(1)},${(H / 2).toFixed(1)} Z`;
    const endV = vals[n - 1];
    const endColor = endV > 30 ? "#7ee0d6" : endV < -30 ? "#f2707e" : "#93a2c0";
    return `<svg class="rc-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}" aria-hidden="true">` +
      `<defs><linearGradient id="rcg" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="#7ee0d6" stop-opacity="0.35"/><stop offset="0.5" stop-color="#7ee0d6" stop-opacity="0.04"/>` +
        `<stop offset="0.5" stop-color="#f2707e" stop-opacity="0.04"/><stop offset="1" stop-color="#f2707e" stop-opacity="0.32"/></linearGradient></defs>` +
      `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="rgba(255,255,255,0.18)" stroke-width="1" stroke-dasharray="4 4"/>` +
      `<path d="${area}" fill="url(#rcg)"/>` +
      `<path d="${line}" fill="none" stroke="#dbe6f4" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
      `<circle cx="${x(n - 1).toFixed(1)}" cy="${y(endV).toFixed(1)}" r="3.5" fill="${endColor}"/></svg>`;
  }

  // The full recap body as HTML. Anything unmeasured is omitted, never invented.
  function html(r, trail) {
    const spark = sparkline(trail);
    const stat = (n, l) => `<div class="rc-stat"><div class="rc-num">${n}</div><div class="rc-lbl">${l}</div></div>`;
    const cards = [];
    if (r.turning) cards.push(`<div class="rc-card turn"><span class="rc-ic">🔀</span><div><b>Turning point</b><p>Move ${r.turning.move}${r.turning.san ? ` — <b>${esc(r.turning.san)}</b>` : ""} swung it your way (+${(r.turning.swing / 100).toFixed(1)}).</p></div></div>`);
    if (r.bestSan) cards.push(`<div class="rc-card best"><span class="rc-ic">⭐</span><div><b>Your best move</b><p><b>${esc(r.bestSan)}</b> — the engine's top choice${r.best && r.best.own ? ", and you found it on your own 💪" : "."}</p></div></div>`);
    if (r.worst) cards.push(`<div class="rc-card slip"><span class="rc-ic">😅</span><div><b>The one that got away</b><p>Move ${r.worst.move}${r.worst.san ? ` — <b>${esc(r.worst.san)}</b>` : ""} cost about ${(r.worst.cp / 100).toFixed(1)}. One to learn from.</p></div></div>`);
    if (r.lifelines > 0) cards.push(`<div class="rc-card"><span class="rc-ic">🛟</span><div><b>You had them sweating</b><p>Your opponent spent ${r.lifelines} lifeline${r.lifelines === 1 ? "" : "s"} — moments they dug deep because you were pushing.</p></div></div>`);
    const sc = r.score;
    return `<div class="rc-hero"><div class="rc-emoji">${r.persona.emoji}</div><div class="rc-title">${esc(r.persona.title)}</div><div class="rc-line">${esc(r.persona.line)}</div></div>` +
      `<div class="rc-story">You played ${r.opening ? `the <b>${esc(r.opening.name)}</b>` : "a game"} against <b>${esc(r.opponent.name || "your opponent")}</b>${r.rank ? ` <span class="rc-foe">(${esc(r.rank)})</span>` : ""}${r.R.reason ? ` — ${esc(r.R.won ? "won" : r.R.draw ? "drawn" : "lost")} by ${esc(r.R.reason)}` : ""} in ${r.fullMoves} moves.</div>` +
      `<div class="rc-stats">${r.accuracy != null ? stat(r.accuracy + "%", "accuracy") : ""}${r.helpable ? stat(r.indepPct + "%", "your own") : ""}${stat(r.fullMoves, "moves")}</div>` +
      (sc ? `<div class="rc-score"><div class="rc-score-top"><span class="rc-score-pts">+${sc.total}</span><span class="rc-score-lbl">points this game</span>` +
        (sc.ratingAfter != null ? `<span class="rc-rating">≈${sc.ratingAfter}</span>` : "") + `</div>` +
        `<div class="rc-score-split"><span class="rc-self">💪 ${sc.self} you</span><span class="rc-assist">🤝 ${sc.assist} help</span></div>` +
        (sc.lifetime != null ? `<div class="rc-score-total">Total play score: <b>${sc.lifetime.toLocaleString()}</b></div>` : "") + `</div>` : "") +
      (spark ? `<div class="rc-spark-wrap"><div class="rc-spark-head">📈 Momentum</div>${spark}<div class="rc-spark-cap"><span style="color:#7ee0d6">▲ you ahead</span> · <span style="color:#f2707e">▼ behind</span></div></div>` : "") +
      (r.badges.length ? `<div class="rc-badges">${r.badges.map((b) => `<span class="rc-badge">${b.ic} ${esc(b.label)}</span>`).join("")}</div>` : "") +
      (cards.length ? `<div class="rc-cards">${cards.join("")}</div>` : "") +
      `<div class="rc-actions"><button class="rc-share" id="rcShare">🔗 Share</button><button class="rc-again" id="rcAgain">↻ Play again</button></div>`;
  }

  global.GBRecap = { build, html, sparkline, esc };
})(window);
