var window = this; load(SRC + 'gb-terms.js');
// the exact replacements now in multiplayer.js / portal.html
var RUNGS = GBTerms.RUNGS.map(function(r){return [r.under, r.name, r.desc];});
var tierFor = function(gap){ var r = GBTerms.rungForGap(gap); return [r.under, r.name, r.desc]; };
function rungForGap(g){ return GBTerms.rungForGap(g).name; }
var TIERS = GBTerms.RUNGS.map(function(r){return {max:r.under,name:r.name,text:r.desc.charAt(0).toUpperCase()+r.desc.slice(1)+'.'};});
var SHORT = GBTerms.RUNGS.map(function(r){return r.short;});
print("RUNGS shape preserved (6 rows of 3) : " + (RUNGS.length===6 && RUNGS.every(function(r){return r.length===3;})));
print("destructure `const [,name,desc]`    : " + (function(){ var a=tierFor(700); return a[1]+" / "+a[2]; })());
print("rungForGap still returns a string   : " + (typeof rungForGap(700)) + " = " + rungForGap(700));
print("ladder row for the lobby display    : " + TIERS.length + " rows, all with short labels: " + SHORT.every(Boolean));
print("  level 0: " + TIERS[0].name + " — " + SHORT[0]);
print("  level 3: " + TIERS[3].name + " — " + SHORT[3]);
print("  level 5: " + TIERS[5].name + " — " + SHORT[5]);
print("every row has text                  : " + TIERS.every(function(t){return !!t.text && !!t.name;}));
