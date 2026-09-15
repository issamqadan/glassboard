//! Engine-validated game room — the pure, testable core of the multiplayer
//! server. The server is the *authority*: every move is checked against
//! `glassboard-engine` here, so a malicious or buggy client cannot make an
//! illegal move. Network plumbing lives in `main.rs`.

use engine::*;
use serde::{Deserialize, Serialize};

/// One transparent assistance record, kept so late joiners see the full history.
#[derive(Clone, Serialize, Deserialize)]
pub struct GlassEntry {
    pub side: String,
    pub summary: String,
}

/// A single two-player game room.
pub struct Room {
    pub board: Board,
    pub white_taken: bool,
    pub black_taken: bool,
    pub white_elo: i32,
    pub black_elo: i32,
    pub last_uci: Option<String>,
    /// Set when a player resigns — that colour loses.
    pub resigned: Option<Color>,
    /// Full glass-box history for this game (replayed to anyone who joins).
    pub glass: Vec<GlassEntry>,
}

impl Default for Room {
    fn default() -> Self {
        Self::new()
    }
}

impl Room {
    pub fn new() -> Self {
        Room {
            board: Board::startpos(),
            white_taken: false,
            black_taken: false,
            white_elo: 1500,
            black_elo: 1500,
            last_uci: None,
            resigned: None,
            glass: Vec::new(),
        }
    }

    /// Record a piece of assistance shown to `side` (for the glass-box history).
    pub fn push_glass(&mut self, side: &str, summary: &str) {
        self.glass.push(GlassEntry {
            side: side.to_string(),
            summary: summary.to_string(),
        });
    }

    /// Seat a joining player: first gets White, second Black, third is refused.
    pub fn join(&mut self, elo: i32) -> Option<Color> {
        let elo = if elo > 0 { elo } else { 1500 };
        if !self.white_taken {
            self.white_taken = true;
            self.white_elo = elo;
            Some(Color::White)
        } else if !self.black_taken {
            self.black_taken = true;
            self.black_elo = elo;
            Some(Color::Black)
        } else {
            None
        }
    }

    /// Free a seat when a player disconnects (so they can rejoin).
    pub fn leave(&mut self, who: Color) {
        match who {
            Color::White => self.white_taken = false,
            Color::Black => self.black_taken = false,
        }
    }

    pub fn reset(&mut self) {
        self.board = Board::startpos();
        self.last_uci = None;
        self.resigned = None;
        self.glass.clear();
    }

    /// `who` resigns — that colour loses. First resignation sticks.
    pub fn resign(&mut self, who: Color) {
        if self.resigned.is_none() {
            self.resigned = Some(who);
        }
    }

    /// Game outcome: (over, winner "white"|"black"|"" for draw, reason).
    pub fn outcome(&self) -> (bool, &'static str, &'static str) {
        if let Some(c) = self.resigned {
            let winner = match c {
                Color::White => "black",
                Color::Black => "white",
            };
            return (true, winner, "resignation");
        }
        match self.status() {
            "checkmate" => {
                // The side to move is checkmated → the other side wins.
                let winner = match self.board.side {
                    Color::White => "black",
                    Color::Black => "white",
                };
                (true, winner, "checkmate")
            }
            "stalemate" => (true, "", "stalemate"),
            "fifty-move" => (true, "", "fifty-move rule"),
            _ => (false, "", ""),
        }
    }

    /// Apply `who`'s move given in coordinate notation. Rejects out-of-turn or
    /// illegal moves — the server never trusts the client's word for legality.
    pub fn apply_move(&mut self, who: Color, uci: &str) -> Result<(), String> {
        if self.resigned.is_some() || self.status() != "ongoing" {
            return Err("game is over".into());
        }
        if self.board.side != who {
            return Err("not your turn".into());
        }
        let mv = parse_uci(&self.board, uci).ok_or_else(|| "illegal move".to_string())?;
        self.board.make_move(mv);
        self.last_uci = Some(uci.to_string());
        Ok(())
    }

    pub fn fen(&self) -> String {
        to_fen(&self.board)
    }

    pub fn turn(&self) -> &'static str {
        match self.board.side {
            Color::White => "white",
            Color::Black => "black",
        }
    }

    pub fn status(&self) -> &'static str {
        if generate_legal(&self.board).is_empty() {
            if in_check(&self.board) {
                "checkmate"
            } else {
                "stalemate"
            }
        } else if self.board.halfmove >= 100 {
            "fifty-move"
        } else {
            "ongoing"
        }
    }
}

/// A seated player's identity (for the lobby / registry).
#[derive(Clone)]
pub struct Player {
    pub id: String,
    pub name: String,
    pub rating: i32,
}

/// Identity-based seating for a game: host takes White, guest takes Black.
/// Seats are keyed by player id, so a player keeps their colour across
/// disconnects/reconnects, and a third distinct player is refused.
#[derive(Default)]
pub struct Seats {
    pub host: Option<Player>,
    pub guest: Option<Player>,
}

impl Seats {
    /// Seat `p`, returning the assigned colour (or `None` if the game is full).
    pub fn seat(&mut self, p: Player) -> Option<Color> {
        match &self.host {
            None => {
                self.host = Some(p);
                return Some(Color::White);
            }
            Some(h) if h.id == p.id => {
                self.host = Some(p);
                return Some(Color::White);
            }
            _ => {}
        }
        match &self.guest {
            None => {
                self.guest = Some(p);
                return Some(Color::Black);
            }
            Some(g) if g.id == p.id => {
                self.guest = Some(p);
                return Some(Color::Black);
            }
            _ => {}
        }
        None
    }

    /// "open" (nobody), "waiting" (host only), or "active" (both seated).
    pub fn status(&self) -> &'static str {
        if self.guest.is_some() {
            "active"
        } else if self.host.is_some() {
            "waiting"
        } else {
            "open"
        }
    }
}

/// Parse a coordinate move (e2e4, e7e8q) into a legal `Move` for `b`, or `None`.
pub fn parse_uci(b: &Board, uci: &str) -> Option<Move> {
    if uci.len() < 4 {
        return None;
    }
    let from = square_of(&uci[0..2])?;
    let to = square_of(&uci[2..4])?;
    let promo = uci.chars().nth(4).and_then(|c| match c.to_ascii_lowercase() {
        'n' => Some(PieceKind::Knight),
        'b' => Some(PieceKind::Bishop),
        'r' => Some(PieceKind::Rook),
        'q' => Some(PieceKind::Queen),
        _ => None,
    });
    generate_legal(b)
        .into_iter()
        .find(|m| m.from == from && m.to == to && m.promo == promo)
}

fn square_of(s: &str) -> Option<Square> {
    let b = s.as_bytes();
    if b.len() != 2 {
        return None;
    }
    let file = b[0].wrapping_sub(b'a');
    let rank = b[1].wrapping_sub(b'1');
    if file < 8 && rank < 8 {
        Some(sq(file as i32, rank as i32))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seats_two_then_refuses() {
        let mut r = Room::new();
        assert_eq!(r.join(1200), Some(Color::White));
        assert_eq!(r.join(1600), Some(Color::Black));
        assert_eq!(r.join(1500), None, "third player is refused");
        assert_eq!(r.white_elo, 1200);
        assert_eq!(r.black_elo, 1600);
    }

    #[test]
    fn enforces_turn_order_and_legality() {
        let mut r = Room::new();
        assert!(r.apply_move(Color::White, "e2e4").is_ok());
        assert!(
            r.apply_move(Color::White, "d2d4").is_err(),
            "White cannot move twice in a row"
        );
        assert!(
            r.apply_move(Color::Black, "e7e9").is_err(),
            "illegal move rejected"
        );
        assert!(r.apply_move(Color::Black, "e7e5").is_ok());
        assert_eq!(r.turn(), "white");
        assert_eq!(r.last_uci.as_deref(), Some("e7e5"));
    }

    #[test]
    fn starts_ongoing() {
        assert_eq!(Room::new().status(), "ongoing");
    }

    fn p(id: &str, rating: i32) -> Player {
        Player { id: id.into(), name: id.to_uppercase(), rating }
    }

    #[test]
    fn seating_is_identity_based() {
        let mut s = Seats::default();
        assert_eq!(s.status(), "open");
        assert_eq!(s.seat(p("a", 1800)), Some(Color::White));
        assert_eq!(s.status(), "waiting");
        // host reconnects → keeps White (rating can update)
        assert_eq!(s.seat(p("a", 1810)), Some(Color::White));
        assert_eq!(s.seat(p("b", 1200)), Some(Color::Black));
        assert_eq!(s.status(), "active");
        // guest reconnects → keeps Black
        assert_eq!(s.seat(p("b", 1205)), Some(Color::Black));
        assert_eq!(s.host.as_ref().unwrap().rating, 1810);
        assert_eq!(s.guest.as_ref().unwrap().rating, 1205);
        // a third distinct player is refused
        assert_eq!(s.seat(p("c", 1500)), None);
    }

    #[test]
    fn glass_log_accumulates_and_resets() {
        let mut r = Room::new();
        assert!(r.glass.is_empty());
        r.push_glass("white", "Suggestion: 3 candidate move(s) shown.");
        r.push_glass("black", "Guided: recommended e2e4.");
        assert_eq!(r.glass.len(), 2);
        assert_eq!(r.glass[0].side, "white");
        r.reset();
        assert!(r.glass.is_empty(), "reset clears the glass log");
    }
}
