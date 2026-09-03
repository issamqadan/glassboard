//! Board representation, pieces, moves, and move-making (copy-make).

/// Side to move / piece color.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Color {
    White,
    Black,
}

impl Color {
    #[inline]
    pub fn opp(self) -> Color {
        match self {
            Color::White => Color::Black,
            Color::Black => Color::White,
        }
    }
}

/// The six piece types.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PieceKind {
    Pawn,
    Knight,
    Bishop,
    Rook,
    Queen,
    King,
}

/// A colored piece.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Piece {
    pub color: Color,
    pub kind: PieceKind,
}

/// A board square index, 0..=63. `a1 = 0`, `h1 = 7`, `a8 = 56`, `h8 = 63`
/// (index = rank * 8 + file, with rank 0 = rank "1", file 0 = file "a").
pub type Square = u8;

/// Build a square index from `file` (0..=7) and `rank` (0..=7).
#[inline]
pub fn sq(file: i32, rank: i32) -> Square {
    (rank * 8 + file) as Square
}

/// File (0..=7) of a square.
#[inline]
pub fn file_of(s: Square) -> i32 {
    (s % 8) as i32
}

/// Rank (0..=7) of a square.
#[inline]
pub fn rank_of(s: Square) -> i32 {
    (s / 8) as i32
}

// Castling-rights bit flags.
pub const CASTLE_WK: u8 = 1; // White kingside
pub const CASTLE_WQ: u8 = 2; // White queenside
pub const CASTLE_BK: u8 = 4; // Black kingside
pub const CASTLE_BQ: u8 = 8; // Black queenside

/// Per-square mask AND-ed into castling rights whenever a square is a move's
/// `from` or `to`. Moving a king/rook off its home square — or capturing a
/// rook on its home square — removes the corresponding right.
const fn castle_masks() -> [u8; 64] {
    let mut m = [0b1111u8; 64];
    m[0] &= !CASTLE_WQ; // a1
    m[4] &= !(CASTLE_WK | CASTLE_WQ); // e1
    m[7] &= !CASTLE_WK; // h1
    m[56] &= !CASTLE_BQ; // a8
    m[60] &= !(CASTLE_BK | CASTLE_BQ); // e8
    m[63] &= !CASTLE_BK; // h8
    m
}
pub const CASTLE_MASK: [u8; 64] = castle_masks();

/// Special handling a move needs at make-time.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Flag {
    Normal,
    DoublePush,
    EnPassant,
    Castle,
}

/// A chess move. Promotions carry `promo = Some(kind)`; the destination being
/// occupied distinguishes a capture (no separate flag needed for perft).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Move {
    pub from: Square,
    pub to: Square,
    pub promo: Option<PieceKind>,
    pub flag: Flag,
}

/// A full board position. `Copy` so move-making can use copy-make.
#[derive(Clone, Copy)]
pub struct Board {
    pub squares: [Option<Piece>; 64],
    pub side: Color,
    pub castling: u8,
    pub ep: Option<Square>, // en-passant target square, if any
    pub halfmove: u16,      // halfmove clock (for the 50-move rule)
    pub fullmove: u16,
}

impl Board {
    /// An empty board with White to move and no rights.
    pub fn empty() -> Board {
        Board {
            squares: [None; 64],
            side: Color::White,
            castling: 0,
            ep: None,
            halfmove: 0,
            fullmove: 1,
        }
    }

    /// Apply `m` in place (copy-make: callers clone the board first).
    pub fn make_move(&mut self, m: Move) {
        let mover = self.squares[m.from as usize].expect("make_move: empty from-square");
        let is_capture = self.squares[m.to as usize].is_some() || m.flag == Flag::EnPassant;
        let is_pawn = mover.kind == PieceKind::Pawn;

        // Remove the pawn captured en passant (it sits behind the target square).
        if m.flag == Flag::EnPassant {
            let cap = if mover.color == Color::White {
                m.to - 8
            } else {
                m.to + 8
            };
            self.squares[cap as usize] = None;
        }

        // Move the rook when castling.
        if m.flag == Flag::Castle {
            let r = rank_of(m.from);
            let (rook_from, rook_to) = if file_of(m.to) == 6 {
                (sq(7, r), sq(5, r)) // kingside: h-file rook to f-file
            } else {
                (sq(0, r), sq(3, r)) // queenside: a-file rook to d-file
            };
            self.squares[rook_to as usize] = self.squares[rook_from as usize];
            self.squares[rook_from as usize] = None;
        }

        // Move the piece (handling promotion).
        self.squares[m.from as usize] = None;
        let placed = match m.promo {
            Some(k) => Piece {
                color: mover.color,
                kind: k,
            },
            None => mover,
        };
        self.squares[m.to as usize] = Some(placed);

        // Update castling rights from the squares touched.
        self.castling &= CASTLE_MASK[m.from as usize] & CASTLE_MASK[m.to as usize];

        // Set the en-passant target only on a double pawn push.
        self.ep = if m.flag == Flag::DoublePush {
            Some(if mover.color == Color::White {
                m.from + 8
            } else {
                m.from - 8
            })
        } else {
            None
        };

        // Clocks and side to move.
        if is_capture || is_pawn {
            self.halfmove = 0;
        } else {
            self.halfmove += 1;
        }
        if self.side == Color::Black {
            self.fullmove += 1;
        }
        self.side = self.side.opp();
    }
}
