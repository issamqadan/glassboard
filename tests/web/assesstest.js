var window = this; load(SRC + 'gb-terms.js'); load(SRC + 'gb-help-budget.js');
var assistData = null, assistFen = "", lastEval = null, evalTrail = [];
var board = "RNBQKBNR" + "PPPPPPPP" + ".".repeat(32) + "pppppppp" + "rnbqkbnr";
var FEN = "now";
var game = { boardString: function(){return board;}, fen: function(){return FEN;}, bestScore: function(){return 7;} };
load(TESTDIR + '/assess.js');

print("--- where the number comes from ---");
print("  nothing computed yet            : src=" + assessPosition().src + " cp=" + assessPosition().cp + "  (depth-2 fallback)");
assistData = { candidates:[{score:420}] }; assistFen = "OLD_POSITION";
print("  advice exists but for the WRONG  ");
print("  position                        : src=" + assessPosition().src + " cp=" + assessPosition().cp + "  <- must NOT quote 420");
lastEval = 380;
print("  falls back to the last deep read: src=" + assessPosition().src + " cp=" + assessPosition().cp);
assistFen = "now";
print("  advice is for THIS position     : src=" + assessPosition().src + " cp=" + assessPosition().cp + "  (depth 4-5)");

print("\n--- trend and phase come along ---");
evalTrail = [{ply:4,cp:-20},{ply:6,cp:60},{ply:8,cp:260},{ply:10,cp:420}];
var a = assessPosition();
print("  trend over your last turns      : " + a.trend + "cp (" + (a.trend > 0 ? "climbing" : "slipping") + ")");
print("  phase from material on the board: " + a.phase);
board = "K" + ".".repeat(46) + "k" + ".".repeat(16);
print("  bare kings                      : " + assessPosition().phase);
board = "RNBQKBNR" + "PPPPPPPP" + ".".repeat(32) + "pppppppp" + "rnbqkbnr";
assistData = { candidates:[{score:420}], mateThreat:true };
print("  danger flag from the engine     : " + assessPosition().danger);

print("\n--- the decisions it now drives ---");
var B = window.GBHelpBudget;
function h(o){ var r=B.aiVerdict(o); return (r.grant?"GRANT":"REFUSE") + " — " + r.line; }
print("  you 1 move from mate, asking    : " + h({cp:-200,danger:true,skill:20,style:"aggressive"}));
print("  AI 4.2 up, quotes its read      : " + h({cp:420,skill:20,style:"balanced"}));
print("  level but you've been climbing  : " + h({cp:30,trend:-200,skill:2,style:"positional"}));
function t(o){ var r=B.aiTakebackVerdict(o); return (r.grant?"ALLOW ":"REFUSE") + " — " + r.line; }
print("  2nd takeback, tight endgame     : " + t({cp:40,phase:"endgame",usedSoFar:1,allowance:3,skill:2,style:"positional"}));
print("  2nd takeback, AI 3.0 up         : " + t({cp:300,phase:"middlegame",usedSoFar:1,allowance:3,skill:20,style:"aggressive"}));
function rc(o){ var r=B.recommend(o); return r.advise.toUpperCase().padEnd(6) + " — " + r.line; }
print("\n  advice when YOU are threatened  : " + rc({cp:300,danger:true}));
print("  advice when level but slipping  : " + rc({cp:-50,trend:-220}));
print("  advice in a close endgame       : " + rc({cp:20,phase:"endgame"}));
