var window = this, posted = [], onmsg = null;
function Worker() { this.postMessage = function (m) { posted.push(m); }; }
Object.defineProperty(Worker.prototype, "onmessage", { set: function (f) { onmsg = f; }, configurable: true });
var setInterval = function () { return 1; }, clearInterval = function () {};
load(SRC + 'sf.js');
var E = window.GBEngine;
function say(line) { onmsg({ data: line }); for (var i = 0; i < 30; i++) drainMicrotasks(); }
function pump() { for (var i = 0; i < 30; i++) drainMicrotasks(); }

E.init(); pump(); say("uciok");
print("nothing in flight -> cancel is a no-op : " + (E.cancel() === false));

var got = null;
E.bestMove("8/8/8/8/8/8/8/8 w - - 0 1", { skill: 20, movetime: 1400, kind: "advice" }).then(function (m) { got = m; });
pump();
print("advice search started                  : " + (posted.indexOf("go movetime 1400") !== -1));
print("cancelling the OPPONENT kind is ignored: " + (E.cancel("move") === false));
posted = [];
print("cancelling 'advice' stops the search   : " + (E.cancel("advice") === true && posted.indexOf("stop") !== -1));
say("bestmove e2e4");
print("stopped search still resolves          : " + (got === "e2e4") + "  (channel freed, stale result discarded upstream)");
print("after it ends, cancel is a no-op again  : " + (E.cancel("advice") === false));

// the opponent's own move must be untouchable by the advice cancel
posted = []; var mv = null;
E.bestMove("8/8/8/8/8/8/8/8 w - - 0 1", { skill: 20, movetime: 1400 }).then(function (m) { mv = m; });
pump();
posted = [];
E.cancel("advice");
print("\nopponent search survives advice cancel : " + (posted.indexOf("stop") === -1));
say("bestmove d2d4");
print("opponent move delivered intact         : " + (mv === "d2d4"));
