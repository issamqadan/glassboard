var window = this; load(SRC + 'gb-terms.js'); var T = window.GBTerms;
// the two existing ladders, copied verbatim from web/multiplayer.js for comparison
var RUNGS = [[100,"Off"],[300,"Hint"],[500,"Coach"],[800,"Guide"],[1200,"Assist"],[Infinity,"Autopilot"]];
var tierFor = function (gap) { var g = Math.abs(gap); for (var i=0;i<RUNGS.length;i++) if (g < RUNGS[i][0]) return RUNGS[i]; return RUNGS[RUNGS.length-1]; };
var rungForGap = function (g) { g = Math.max(0,g); return g<100?"Off":g<300?"Hint":g<500?"Coach":g<800?"Guide":g<1200?"Assist":"Autopilot"; };
var NAME = { off:"Off", hint:"Hint", coach:"Coach", guide:"Guide", assist:"Assist", autopilot:"Autopilot" };

var bad = 0, n = 0;
// Valid gaps are non-negative. Both legacy ladders must agree with the shared one.
[0,1,99,100,101,299,300,301,499,500,799,800,1199,1200,1201,3000].forEach(function (g) {
  var mine = NAME[T.rungForGap(g).key], a = tierFor(g)[1], b = rungForGap(g);
  n++;
  if (mine !== a || mine !== b) { bad++; print("  FAIL gap " + g + ": shared=" + mine + " tierFor=" + a + " rungForGap=" + b); }
});
// A NEGATIVE gap is where the old rungForGap was wrong: it used Math.max(0,g)
// where it meant Math.abs(g), so it returned "Off" (no help) for a -700 gap. The
// bug never fired because its only caller pre-abs'ed the value. The shared ladder
// must use abs — that's the fix, so it is asserted rather than reported as a diff.
if (NAME[T.rungForGap(-700).key] !== "Guide") { bad++; print("  FAIL negative gap not abs()'d"); }
if (rungForGap(-700) !== "Off") print("  (note: legacy rungForGap still mishandles a negative gap — latent, unused)");
print("shared ladder matches BOTH existing ladders: " + (bad === 0 ? n + "/" + n + " boundaries" : bad + " mismatches"));

var maya = { name: "Maya", rating: 900 }, issam = { name: "Issam", rating: 1600 };
var c = T.contract(issam, maya, "match", 10);
print("\nmatch, 700-pt gap -> " + c.headline);
print("  weaker is the lower rating : " + (c.weaker.name === "Maya"));
print("  rung                       : " + c.rung.name + " (gap " + c.gap + ")");
var even = T.contract({name:"A",rating:1500}, {name:"B",rating:1540}, "match", 0);
print("40-pt gap          -> " + even.headline + "  | even=" + even.even);
var cas = T.contract(issam, maya, "casual", 5);
print("casual             -> " + cas.headline + "  | rung=" + cas.rung);

print("\nconsequence BEFORE you take it:");
print("  weaker taker : " + T.previewForTaker(issam, maya, "match", 10).text);
print("  stronger taker: " + T.previewForTaker(maya, issam, "match", 10).text);
print("  casual        : " + T.previewForTaker(issam, maya, "casual", 0).text);
print("\nwant labels: " + Object.keys(T.WANTS).map(function(k){return T.wantOf(k).ic+" "+T.wantOf(k).label;}).join(" · "));
print("unknown want falls back to  : " + T.wantOf("nonsense").label);
