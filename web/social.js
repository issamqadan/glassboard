// Glassboard — platform-agnostic social / rivalry layer.
//
// The UI depends ONLY on this provider interface, never on where the data
// comes from. The default provider derives rivals from Glassboard's own game
// records, but the same shapes can be backed by Apple Game Center, Google Play
// Games, Steam, etc. — implement the interface, register it, and the roster,
// head-to-head, and challenge flows work unchanged.
//
// Types (abstract — not tied to any backend):
//   Rival  = { id, name, rating|null, wins, losses, draws, played, lastPlayed(ms), mode }
//   GameRef= a past game record (opaque to the UI beyond a few display fields)
//
// Provider interface:
//   id                       -> string            (provider name, e.g. "glassboard")
//   capabilities()           -> { directInvite, presence }
//   rivals(games, meName)    -> Rival[]           (most-recent first)
//   recordVs(games, rivalId) -> { w, l, d }       (head-to-head, for in-game UI)
//   historyWith(games,rivId) -> GameRef[]         (past games vs this rival)
//   rivalKey(gameRecord)     -> string            (stable id for a game's opponent)
//
// `games` is dependency-injected by the caller so the provider stays decoupled
// from storage. A Game Center provider would ignore `games` and read its own
// friends/matches APIs instead — the UI code doesn't change.
(function () {
  const rivalKey = (g) => g.oppId || ("name:" + ((g.oppName || "Opponent").trim().toLowerCase()));

  function deriveRivals(games) {
    const by = {};
    for (const g of games || []) {
      if (!g.oppName && !g.oppId) continue; // no opponent yet (open invite)
      const id = rivalKey(g);
      const r = by[id] || (by[id] = {
        id, name: g.oppName || "Opponent", rating: g.oppRating || null,
        wins: 0, losses: 0, draws: 0, played: 0, lastPlayed: 0, mode: g.mode || "match",
        online: false, lastSeen: 0, _results: [],
      });
      r.played++;
      if (g.oppRating) r.rating = g.oppRating;
      if (g.oppName) r.name = g.oppName;
      const t = g.started ? g.started * 1000 : (g.created || 0);
      if (t > r.lastPlayed) r.lastPlayed = t;
      if (g.over) {
        const myColor = g.color || "white";
        const res = !g.winner ? "D" : (g.winner === myColor ? "W" : "L");
        if (res === "W") r.wins++; else if (res === "L") r.losses++; else r.draws++;
        r._results.push({ t, res });
      }
    }
    // Streak (from the most recent decided games) and the last result.
    for (const r of Object.values(by)) {
      r._results.sort((a, b) => b.t - a.t);
      r.lastResult = r._results.length ? r._results[0].res : null;
      let n = 0;
      for (const x of r._results) { if (x.res === r.lastResult) n++; else break; }
      r.streak = r.lastResult ? { type: r.lastResult, n } : null;
      delete r._results;
    }
    return Object.values(by).sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  const GlassboardSocial = {
    id: "glassboard",
    // We can address a challenge by identity, but delivery is a shared invite
    // link (no push). A Game Center provider would set directInvite:true.
    capabilities: () => ({ directInvite: false, presence: false }),
    rivalKey,
    rivals: (games) => deriveRivals(games),
    recordVs: (games, id) => {
      const r = deriveRivals(games).find((x) => x.id === id);
      return r ? { w: r.wins, l: r.losses, d: r.draws } : { w: 0, l: 0, d: 0 };
    },
    historyWith: (games, id) => (games || []).filter((g) => rivalKey(g) === id)
      .sort((a, b) => ((b.started || 0) - (a.started || 0))),
  };

  // The active provider. Swap via gbSocialUse(provider) to back the same UI
  // with a different platform.
  window.gbSocial = GlassboardSocial;
  window.gbSocialUse = (p) => { if (p && p.rivals) window.gbSocial = p; };
})();
