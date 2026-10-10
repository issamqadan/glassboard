var window=this; load(SRC + 'strategies.js'); var S=window.GBStrategies;
// a real capture-shaped entry, exactly as gb-capture.js emits it
S.add({ id:"learned_r1bqk_17", name:"The Forced Knight Check", idea:"one legal reply",
        source:"learned", unlocked:true, phase:"middlegame", cat:"Tactics", cx:"Advanced",
        side:"black", demoFen:"r1bqkb1r/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1",
        demoUci:["e1g1","e5f3"], keyMove:"e5f3", legalAfter:1, byYou:false, how:["a","b"] });

// mirror strategy.html
var openingItems=(S.openings||[]).map(function(o){return Object.assign({kind:"opening",phase:"opening"},o);});
var planItems=(S.plans||[]).map(function(p){return Object.assign({kind:"plan"},p);});
var learnedItems=(S.learned||[]).map(function(e){return Object.assign({cx:"Advanced"},e,{kind:"learned",phase:"learned"});});
var list=openingItems.concat(planItems,learnedItems);
var PHASE_FILTERS=["All","Openings","Middlegame","Endgame"].concat(learnedItems.length?["Learned"]:[]);
var PHASE_ORDER=["learned","opening","middlegame","endgame"];
function matchesPhase(o,f){ if(f==="All")return true; if(f==="Openings")return o.kind==="opening";
  if(f==="Middlegame")return o.phase==="middlegame"; if(f==="Endgame")return o.phase==="endgame";
  if(f==="Learned")return o.kind==="learned"; return false; }

print("Learned chip shown        : " + (PHASE_FILTERS.indexOf("Learned")>=0));
print("Learned filter count      : " + list.filter(function(o){return matchesPhase(o,"Learned");}).length);
print("yours first in All view   : " + PHASE_ORDER[0]);
print("NOT mixed into Middlegame : " + (list.filter(function(o){return matchesPhase(o,"Middlegame");}).every(function(o){return o.kind!=="learned";})));
print("NOT mixed into Openings   : " + (list.filter(function(o){return matchesPhase(o,"Openings");}).every(function(o){return o.kind!=="learned";})));
var e=learnedItems[0];
print("demo replays from its FEN : " + (e.demoFen ? e.demoFen.split(" ")[0].slice(0,12)+"..." : "START (BUG)"));
print("badge condition           : " + (e.source==="learned"));
print("identify() still works    : " + (S.identify(["e2e4","e7e5","g1f3","b8c6","f1b5"])||{}).name);
print("every list item renders   : " + list.every(function(o){return !!o.name && !!o.idea;}));
