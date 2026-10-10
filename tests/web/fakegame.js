// TEST DOUBLE for the WASM Game: moves pieces without checking legality, and
// derives check from the SAME attack tables the app uses. Enough to exercise
// detect()'s motif selection; it is not a chess engine and isn't pretending to be.
var START = "RNBQKBNRPPPPPPPP................................pppppppprnbqkbnr";
function Game() { this.b = START.split(""); this.side = "w"; }
Game.prototype.makeMove = function (from, to, promo) {
  var pc = this.b[from];
  if (!pc || pc === ".") return false;
  this.b[to] = promo ? (pc === pc.toUpperCase() ? promo.toUpperCase() : promo.toLowerCase()) : pc;
  this.b[from] = ".";
  this.side = this.side === "w" ? "b" : "w";
  return true;
};
Game.prototype.boardString = function () { return this.b.join(""); };
Game.prototype.fen = function () { return this.b.join("") + " " + this.side; };
Game.prototype.inCheck = function () {            // is the side TO MOVE in check?
  var want = this.side === "w" ? "K" : "k", ks = -1;
  for (var i = 0; i < 64; i++) if (this.b[i] === want) ks = i;
  if (ks < 0) return false;
  for (var j = 0; j < 64; j++) {
    var c = this.b[j];
    if (!c || c === ".") continue;
    var cWhite = c === c.toUpperCase();
    if (cWhite === (this.side === "w")) continue;
    if (GBAssistUI.pieceAttacks(this.b.join(""), j, c).indexOf(ks) !== -1) return true;
  }
  return false;
};
Game.prototype.legalTo = function (i) {           // pseudo-legal, side to move only
  var c = this.b[i];
  if (!c || c === ".") return [];
  if ((c === c.toUpperCase()) !== (this.side === "w")) return [];
  var self = this;
  return GBAssistUI.pieceAttacks(this.b.join(""), i, c).filter(function (t) {
    var d = self.b[t];
    return !(d && d !== "." && (d === d.toUpperCase()) === (c === c.toUpperCase()));
  });
};
Game.fromFen = function (fen) {
  var g = new Game(); var parts = String(fen).split(" ");
  g.b = parts[0].split(""); g.side = parts[1] === "b" ? "b" : "w"; return g;
};
