var window=this; load(SRC + 'strategies.js'); var S=window.GBStrategies;
var hist=["e2e4","c7c5"];
print("identify BEFORE learning : " + (S.identify(hist)||{}).name);
S.add({ id:"learned_x", name:"The Forced Knight Check", idea:"...", phase:"middlegame",
        cat:"Tactics", cx:"Advanced", side:"black", demoFen:"...", demoUci:["e5f3"] });
print("identify AFTER learning  : " + (function(){ try { return (S.identify(hist)||{}).name; } catch(e){ return "THREW: "+e; } })());
print("learned list length      : " + S.learned.length);
print("openings untouched       : " + S.openings.filter(function(o){return o.source==='learned';}).length + " learned entries in OPENINGS (want 0)");
S.add({ id:"learned_x", name:"dup" }); print("duplicate ignored        : " + (S.learned.length===1));
