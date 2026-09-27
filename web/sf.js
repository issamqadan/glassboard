// Glassboard opponent engine: Stockfish 11 (classical, netless) as a same-origin
// Web Worker. Gives credible, engine-grade strength per level via Skill Level
// (this build has no UCI_Elo). One request at a time (the game is turn-based); a
// Rust-core fallback in main.js covers the case where this fails to load.
(function (global) {
  let worker = null;
  let readyP = null;
  let pendingResolve = null; // bestmove callback for the in-flight `go`

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
        if (line.indexOf("bestmove") === 0) {
          const mv = line.split(/\s+/)[1];
          const cb = pendingResolve; pendingResolve = null;
          if (cb) cb(mv && mv !== "(none)" ? mv : null);
        }
      };
      worker.onerror = () => { if (iv) clearInterval(iv); reject(new Error("stockfish worker error")); };
      // The wasm compiles asynchronously; an early "uci" is dropped, so retry.
      worker.postMessage("uci");
      iv = setInterval(() => { if (uciok) { clearInterval(iv); return; } if (tries++ > 24) { clearInterval(iv); reject(new Error("stockfish: no uciok")); return; } worker.postMessage("uci"); }, 450);
    });
    return readyP;
  }

  // Ask for the best move from `fen` at a given Skill Level (0-20). `depth` caps
  // search for the weakest rungs; otherwise `movetime` (ms) keeps replies snappy.
  // Calls are SERIALIZED (one `go` at a time) so the opponent-move and the
  // full-strength assist request never collide on the single UCI channel.
  let chain = Promise.resolve();
  function runBestMove(fen, opts) {
    return ensure().then(() => new Promise((resolve) => {
      pendingResolve = resolve;
      const skill = Math.max(0, Math.min(20, opts.skill == null ? 20 : opts.skill | 0));
      worker.postMessage("setoption name Skill Level value " + skill);
      worker.postMessage("position fen " + fen);
      if (opts.depth) worker.postMessage("go depth " + (opts.depth | 0));
      else worker.postMessage("go movetime " + (opts.movetime ? opts.movetime | 0 : 400));
    }));
  }
  function bestMove(fen, opts) {
    opts = opts || {};
    const p = chain.then(() => runBestMove(fen, opts), () => runBestMove(fen, opts));
    chain = p.catch(() => {});
    return p;
  }

  function newGame() { if (worker) worker.postMessage("ucinewgame"); }

  global.GBEngine = { init: ensure, bestMove, newGame };
})(window);
