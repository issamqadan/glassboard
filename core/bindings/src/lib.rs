//! WebAssembly bindings for the Glassboard engine (M2).
//!
//! Exposes a small `Game` object to JavaScript. Squares are indexed a1=0 ..
//! h8=63 (matching the engine). The web shell is a *thin* view over this — all
//! rules, search, and (later) assistance/transparency stay in the core, so
//! behavior is identical to the native build. See docs/ARCHITECTURE.md.

use engine::*;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Game {
    board: Board,
}

#[wasm_bindgen]
impl Game {
    /// New game at the standard starting position.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Game {
        Game {
            board: Board::startpos(),
        }
    }

    /// Build a game from a FEN string.
    #[wasm_bindgen(js_name = fromFen)]
    pub fn from_fen(fen: &str) -> Game {
        Game {
            board: parse_fen(fen),
        }
    }

    /// Current position as FEN.
    pub fn fen(&self) -> String {
        to_fen(&self.board)
    }

    /// 64-char board string (index 0 = a1 .. 63 = h8). Uppercase = White,
    /// lowercase = Black, '.' = empty.
    #[wasm_bindgen(js_name = boardString)]
    pub fn board_string(&self) -> String {
        let mut s = String::with_capacity(64);
        for i in 0..64 {
            s.push(match self.board.squares[i] {
                Some(p) => piece_char(p),
                None => '.',
            });
        }
        s
    }

    /// "white" or "black".
    #[wasm_bindgen(js_name = sideToMove)]
    pub fn side_to_move(&self) -> String {
        match self.board.side {
            Color::White => "white",
            Color::Black => "black",
        }
        .to_string()
    }

    /// Is the side to move in check?
    #[wasm_bindgen(js_name = inCheck)]
    pub fn in_check(&self) -> bool {
        engine::in_check(&self.board)
    }

    /// Destination squares of every legal move from `from` (for highlighting).
    #[wasm_bindgen(js_name = legalTo)]
    pub fn legal_to(&self, from: u8) -> Vec<u8> {
        generate_legal(&self.board)
            .into_iter()
            .filter(|m| m.from == from)
            .map(|m| m.to)
            .collect()
    }

    /// Would a `from`->`to` move be a promotion? (UI can offer a picker.)
    #[wasm_bindgen(js_name = isPromotion)]
    pub fn is_promotion(&self, from: u8, to: u8) -> bool {
        generate_legal(&self.board)
            .into_iter()
            .any(|m| m.from == from && m.to == to && m.promo.is_some())
    }

    /// Play `from`->`to`. `promo` is "q"/"r"/"b"/"n" or empty (defaults to
    /// queen for a promotion). Returns true if the move was legal and applied.
    #[wasm_bindgen(js_name = makeMove)]
    pub fn make_move(&mut self, from: u8, to: u8, promo: Option<String>) -> bool {
        let want = promo.as_deref().and_then(parse_promo);
        let candidates: Vec<Move> = generate_legal(&self.board)
            .into_iter()
            .filter(|m| m.from == from && m.to == to)
            .collect();
        if candidates.is_empty() {
            return false;
        }
        let chosen = if let Some(k) = want {
            candidates.iter().copied().find(|m| m.promo == Some(k))
        } else {
            candidates
                .iter()
                .copied()
                .find(|m| m.promo.is_none())
                .or_else(|| candidates.iter().copied().find(|m| m.promo == Some(PieceKind::Queen)))
                .or_else(|| candidates.first().copied())
        };
        match chosen {
            Some(m) => {
                self.board.make_move(m);
                true
            }
            None => false,
        }
    }

    /// Let the engine choose and play a move at `depth`. Returns the move in
    /// coordinate notation (e.g. "b8c6"), or "" if the game is already over.
    #[wasm_bindgen(js_name = engineMove)]
    pub fn engine_move(&mut self, depth: u32) -> String {
        if generate_legal(&self.board).is_empty() {
            return String::new();
        }
        match search(&self.board, depth).best {
            Some(m) => {
                let u = move_uci(m);
                self.board.make_move(m);
                u
            }
            None => String::new(),
        }
    }

    /// "ongoing" | "checkmate" | "stalemate" | "fifty-move".
    pub fn status(&self) -> String {
        if generate_legal(&self.board).is_empty() {
            if engine::in_check(&self.board) {
                "checkmate"
            } else {
                "stalemate"
            }
        } else if self.board.halfmove >= 100 {
            "fifty-move"
        } else {
            "ongoing"
        }
        .to_string()
    }
}

impl Default for Game {
    fn default() -> Self {
        Game::new()
    }
}

fn parse_promo(s: &str) -> Option<PieceKind> {
    match s.chars().next()?.to_ascii_lowercase() {
        'q' => Some(PieceKind::Queen),
        'r' => Some(PieceKind::Rook),
        'b' => Some(PieceKind::Bishop),
        'n' => Some(PieceKind::Knight),
        _ => None,
    }
}

fn piece_char(p: Piece) -> char {
    let c = match p.kind {
        PieceKind::Pawn => 'p',
        PieceKind::Knight => 'n',
        PieceKind::Bishop => 'b',
        PieceKind::Rook => 'r',
        PieceKind::Queen => 'q',
        PieceKind::King => 'k',
    };
    if p.color == Color::White {
        c.to_ascii_uppercase()
    } else {
        c
    }
}

fn move_uci(m: Move) -> String {
    let mut s = format!("{}{}", sq_to_algebraic(m.from), sq_to_algebraic(m.to));
    if let Some(k) = m.promo {
        s.push(match k {
            PieceKind::Knight => 'n',
            PieceKind::Bishop => 'b',
            PieceKind::Rook => 'r',
            PieceKind::Queen => 'q',
            _ => '?',
        });
    }
    s
}
