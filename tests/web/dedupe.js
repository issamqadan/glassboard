var window = this, store = {};
var localStorage = { getItem: function (k) { return store[k] || null; },
                     setItem: function (k, v) { store[k] = v; } };
load(SRC + 'gb-assist-ui.js'); load(SRC + 'gb-capture.js');
var C = window.GBCapture;
function L(kind, piece, swing, id) { return { id: id, kind: kind, piece: piece, swing: swing, name: "The " + piece + " " + kind, motifs: [kind] }; }

print("first knight fork              : " + (C.save(L("fork","knight",300,"a")) ? "saved" : "skipped"));
print("another, WEAKER knight fork    : " + (C.save(L("fork","knight",100,"b")) ? "saved (noise)" : "skipped — already known"));
var s3 = C.save(L("fork","knight",900,"c"));
print("a much CLEARER knight fork     : " + (s3 ? "saved, sharpened=" + !!s3.sharpened : "skipped"));
print("a BISHOP pin is a new lesson   : " + (C.save(L("pin","bishop",200,"d")) ? "saved" : "skipped"));
print("a KNIGHT fork again, weaker    : " + (C.save(L("fork","knight",50,"e")) ? "saved (noise)" : "skipped"));
print("a QUEEN sacrifice              : " + (C.save(L("sacrifice","queen",1200,"f")) ? "saved" : "skipped"));
var all = C.list();
print("\nshelf now holds " + all.length + " DISTINCT lessons:");
all.forEach(function (e) { print("  " + e.name + "  (swing " + e.swing + ")"); });
print("\nno duplicate pattern          : " + (new Set(all.map(function(e){return e.kind+":"+e.piece;})).size === all.length));
print("best example of the fork kept : " + (all.filter(function(e){return e.kind==="fork";})[0].swing === 900));
