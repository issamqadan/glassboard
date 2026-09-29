// Glassboard opponent engine: Stockfish 11 (classical, netless) as a same-origin
// Web Worker. Gives credible, engine-grade strength per level via Skill Level
// (this build has no UCI_Elo). One request at a time (the game is turn-based); a
// Rust-core fallback in main.js covers the case where this fails to load.
(function (global) {
  let worker = null;
  let readyP = null;
  let pendingResolve = null; // callback for the in-flight `go`
  let pvBuf = null;          // when set, we're collecting MultiPV candidates

  function ensure() {
    if (readyP) return readyP;
    readyP = new Promise((resolve, reject) => {
      let uciok = false, tries = 0, iv = null;
      try {
        worker = new Worker("./vendor/stockfish/stockfish.js");
      } catch (e) { reject(e); return; }
      worker.onmessage = (e) => {
        const line = typeof e.data === "string" ? e.data : (e.data && e.data.data) || "";
        if (!uciok) {
          if (line.indexOf("uciok") === 0) { uciok = true; if (iv) clearInterval(iv); worker.postMessage("ucinewgame"); resolve(); }
          return;
        }
        // While collecting candidates, record the best line per MultiPV index.
        if (pvBuf && line.indexOf("info ") === 0 && line.indexOf(" multipv ") !== -1) {
          const p = line.split(/\s+/);
          const mi = p.indexOf("multipv"), si = p.indexOf("score"), vi = p.indexOf("pv");
          if (mi !== -1 && vi !== -1 && p[vi + 1]) {
            let cp = 0;
            if (si !== -1) {
              if (p[si + 1] === "cp") cp = parseInt(p[si + 2], 10) || 0;
              else if (p[si + 1] === "mate") cp = (parseInt(p[si + 2], 10) || 0) >= 0 ? 100000 : -100000;
            }
            pvBuf[parseInt(p[mi + 1], 10)] = { uci: p[vi + 1], cp: cp };
          }
        }
        if (line.indexOf("bestmove") === 0) {
          const mv = line.split(/\s+/)[1] || null;
          const cb = pendingResolve; pendingResolve = null;
          const collected = pvBuf; pvBuf = null;
          if (!cb) return;
          if (collected) {
            const arr = Object.keys(collected).map(Number).sort((a, b) => a - b).map((k) => collected[k]);
            cb(arr.length ? arr : (mv && mv !== "(none)" ? [{ uci: mv, cp: 0 }] : []));
          } else {
            cb(mv && mv !== "(none)" ? mv : null);
          }
        }
      };
      worker.onerror = () => { if (iv) clearInterval(iv); reject(new Error("stockfish worker error")); };
      // The wasm compiles asynchronously; an early "uci" is dropped, so retry.
      worker.postMessage("uci");
      iv = setInterval(() => { if (uciok) { clearInterval(iv); return; } if (tries++ > 24) { clearInterval(iv); reject(new Error("stockfish: no uciok")); return; } worker.postMessage("uci"); }, 450);
    });
    return readyP;
  }

  const clampSkill = (s) => Math.max(0, Math.min(20, s == null ? 20 : s | 0));
  function position(opts, fen) {
    // Send the FULL move history when we have it, so Stockfish sees (and avoids /
    // claims) repetitions and the 50-move count — not just a bare position.
    if (opts.moves && opts.moves.length) worker.postMessage("position startpos moves " + opts.moves.join(" "));
    else worker.postMessage("position fen " + fen);
  }

  // Ask for the single best move from `fen` at a given Skill Level (0-20). `depth`
  // caps search for the weakest rungs; otherwise `movetime` (ms) keeps replies snappy.
  // Calls are SERIALIZED (one `go` at a time) so the opponent-move and the
  // full-strength assist request never collide on the single UCI channel.
  let chain = Promise.resolve();
  function runBestMove(fen, opts) {
    return ensure().then(() => new Promise((resolve) => {
      pendingResolve = resolve; pvBuf = null;
      worker.postMessage("setoption name MultiPV value 1");
      worker.postMessage("setoption name Skill Level value " + clampSkill(opts.skill));
      position(opts, fen);
      if (opts.depth) worker.postMessage("go depth " + (opts.depth | 0));
      else worker.postMessage("go movetime " + (opts.movetime ? opts.movetime | 0 : 400));
    }));
  }
  // Ask for the top-N candidate moves (MultiPV) with their evals — the raw material
  // for giving the opponent a playing STYLE (pick among the near-best by personality).
  function runCandidates(fen, opts) {
    return ensure().then(() => new Promise((resolve) => {
      pendingResolve = resolve; pvBuf = {};
      const n = Math.max(1, Math.min(6, opts.multipv || 4));
      worker.postMessage("setoption name MultiPV value " + n);
      worker.postMessage("setoption name Skill Level value " + clampSkill(opts.skill));
      position(opts, fen);
      worker.postMessage("go movetime " + (opts.movetime ? opts.movetime | 0 : 600));
    }));
  }
  function bestMove(fen, opts) {
    opts = opts || {};
    const p = chain.then(() => runBestMove(fen, opts), () => runBestMove(fen, opts));
    chain = p.catch(() => {});
    return p;
  }
  function bestMoves(fen, opts) {
    opts = opts || {};
    const p = chain.then(() => runCandidates(fen, opts), () => runCandidates(fen, opts));
    chain = p.catch(() => {});
    return p;
  }

  function newGame() { if (worker) worker.postMessage("ucinewgame"); }

  global.GBEngine = { init: ensure, bestMove, bestMoves, newGame };
})(window);
