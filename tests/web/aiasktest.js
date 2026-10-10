var window = this; load(SRC + 'gb-terms.js'); load(SRC + 'gb-help-budget.js');
// stubs
var firstGame=false, aiAsking=false, resigned=false, aiResigned=false, flagged=false;
var aiTokens=0, aiAskedCount=0, aiGrantedCount=0, aiAskedAtIdx=-9;
var uciHistory=new Array(30), moveReview=new Array(15), playerHelpLog=[];
var aiStyle="balanced", AI_PLEA={balanced:"x"}, shown=null, painted=0;
var sense=300;
var game={ status:function(){return "ongoing";}, sideToMove:function(){return "white";}, bestScore:function(){return sense;} };
var humanColor="white";
function escapeHtml(s){return s;} function aiName(){return "Luna Flip";} function paint(){painted++;}
var els={aiAsk:{hidden:true},aiAskWho:{},aiAskPlea:{},aiAskRec:{}};
var document={ getElementById:function(id){ return els[id]; } };
// maybeAiAsksForHelp now waits for a DEEP read of the position, so the test must
// provide it. Resolves synchronously; drainMicrotasks() below flushes the chain.
function assessPositionDeep() { return Promise.resolve({ cp: sense, trend: 0, phase: "middlegame", danger: false, src: "deep" }); }
load(TESTDIR + '/aiask.js');

function reset(o){ o=o||{}; aiAsking=false; aiTokens=o.tokens==null?0:o.tokens; aiAskedCount=o.asked||0;
  aiAskedAtIdx=o.at==null?-9:o.at; uciHistory=new Array(o.plies==null?30:o.plies);
  moveReview=new Array(o.rev==null?15:o.rev); sense=o.sense==null?300:o.sense; els.aiAsk.hidden=true;
  game.sideToMove=function(){return o.turn||"white";}; }

function tryAsk(label, o){ reset(o); maybeAiAsksForHelp(); for (var d=0; d<40; d++) drainMicrotasks(); print("  " + label + ": " + (els.aiAsk.hidden ? "stays quiet" : "ASKS")); }
print("--- when the opponent asks you ---");
tryAsk("out of lifelines and losing   ", {});
tryAsk("still has its own lifelines   ", {tokens:2});
tryAsk("losing but still in the opening", {plies:8});
tryAsk("out of lifelines but WINNING  ", {sense:-300});
tryAsk("position is level             ", {sense:40});
tryAsk("already asked twice           ", {asked:2});
tryAsk("asked very recently           ", {at:13});
tryAsk("it's the engine's turn        ", {turn:"black"});
reset({}); maybeAiAsksForHelp(); for (var dd=0; dd<40; dd++) drainMicrotasks();
print("\n  the request is logged for the glass box : " + (playerHelpLog.length > 0 ? "\"" + playerHelpLog[0].note + "\"" : "NO"));
print("  Glassboard's advice is attached        : " + (els.aiAskRec.innerHTML || "").slice(0, 72) + "…");
