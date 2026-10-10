var window = this;
load(SRC + 'gb-assist-ui.js'); load(SRC + 'gb-capture.js'); load(TESTDIR + '/fakegame.js');
var C = window.GBCapture;

function run(label, hist, myColor) {
  var r = C.detect({ history: hist, Game: Game, myColor: myColor || "white", trail: [] });
  if (!r) { print(label + "\n  -> nothing captured"); return null; }
  print(label);
  print("  name    : " + r.name);
  print("  motifs  : " + r.motifs.join(", "));
  print("  key move: " + r.keyMove + "   byYou=" + r.byYou + "   demo=" + r.demoUci.length + " moves from its own FEN");
  print("  idea    : " + r.idea.slice(0, 96) + "…");
  print("  how[0]  : " + r.how[0]);
  return r;
}

// A knight walking to e6, where it hits the queen on d8 and the bishop on f8.
var fork = ["e2e4","e7e5","g1f3","b8c6","f3g5","g8f6","g5e6"];
var a = run("--- a game containing a FORK ---", fork);

// A knight given up on e5, recaptured at once, and the queen won a few moves later.
var sac = ["e2e4","e7e5","g1f3","d7d6","f3e5","d6e5","d1h5","d8h4","h5h4"];
var b = run("\n--- a game containing a paid-off SACRIFICE ---", sac);

print("\n--- selection ---");
print("  fork game picked      : " + (a && a.motifs.indexOf("fork") !== -1 ? "fork ✓" : "(" + (a && a.motifs.join("/")) + ")"));
print("  sacrifice outscores it: " + (b && b.motifs.indexOf("sacrifice") !== -1 ? "sacrifice ✓" : "(" + (b && b.motifs.join("/")) + ")"));

print("\n--- the honesty rule still holds ---");
print("  a quiet game claims nothing : " +
  (C.detect({ history: ["e2e4","e7e5","g1f3","b8c6","b1c3","g8f6","f1e2","f8e7"], Game: Game, myColor: "white", trail: [] }) ? "CLAIMED SOMETHING (wrong)" : "nothing, correct"));
print("  too short to judge          : " +
  (C.detect({ history: ["e2e4","e7e5"], Game: Game, myColor: "white", trail: [] }) ? "CLAIMED (wrong)" : "nothing, correct"));
print("  no engine -> no claim       : " +
  (C.detect({ history: fork, Game: null, myColor: "white" }) ? "CLAIMED (wrong)" : "nothing, correct"));
print("\n--- grading ---");
print("  fork      -> " + C.detect({history:["e2e4","e7e5","g1f3","b8c6","f3g5","g8f6","g5e6"],Game:Game,myColor:"white",trail:[]}).cx);
print("  sacrifice -> " + C.detect({history:["e2e4","e7e5","g1f3","d7d6","f3e5","d6e5","d1h5","d8h4","h5h4"],Game:Game,myColor:"white",trail:[]}).cx);
