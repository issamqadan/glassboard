//! Engine-validated game room — the pure, testable core of the multiplayer
//! server. The server is the *authority*: every move is checked against
//! `glassboard-engine` here, so a malicious or buggy client cannot make an
//! illegal move. Network plumbing lives in `main.rs`.

use engine::*;

/// A single two-player game room.
pub struct Room {
    pub board: Board,
    pub white_taken: bool,
    pub black_taken: bool,
    pub white_elo: i32,
    pub black_elo: i32,
    pub last_uci: Option<String>,
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
        }
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
    }

    /// Apply `who`'s move given in coordinate notation. Rejects out-of-turn or
    /// illegal moves — the server never trusts the client's word for legality.
    pub fn apply_move(&mut self, who: Color, uci: &str) -> Result<(), String> {
        if self.status() != "ongoing" {
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
}
