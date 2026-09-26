// Glassboard engine worker — runs the *deep* searches off the main thread so the
// board never freezes while the engine (or the assistance) is thinking. The main
// thread keeps its own WASM instance for instant operations (board string, move
// legality, making moves); this worker holds a SEPARATE instance used only to
// search a position sent as a FEN. Nothing here mutates shared state — every
// request rebuilds the position from the FEN, searches, and returns a value.
import init, { Game } from "./pkg/glassboard_wasm.js";

let booted = false;
const ready = init().then(() => { booted = true; });

self.onmessage = async (e) => {
  const { id, op, args } = e.data || {};
  if (!booted) await ready;
  try {
    let result;
    switch (op) {
      case "bestMove": {
        // The opponent's move at a chosen strength. engineMoveByElo needs only the
        // board (from the FEN) + elo + a random seed from the caller.
        const g = Game.fromFen(args.fen);
        result = g.engineMoveByElo(args.elo, args.rand);
        break;
      }
      case "analyze": {
        // Assistance for the side to move. assist() depends on the ratings and the
        // chosen assist override, so replay them onto this throwaway position.
        const g = Game.fromFen(args.fen);
        g.setRatings(args.humanElo, args.engineElo);
        g.setAssistOverride(args.override);
        result = g.assist(args.depth); // JSON string
        break;
      }
      case "bestScore": {
        const g = Game.fromFen(args.fen);
        result = g.bestScore(args.depth);
        break;
      }
      case "scoreMove": {
        const g = Game.fromFen(args.fen);
        result = g.scoreMove(args.from, args.to, args.depth);
        break;
      }
      default:
        throw new Error("unknown op: " + op);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
