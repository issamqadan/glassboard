//! FEN parsing and formatting.

use crate::board::*;

/// Standard starting position.
pub const STARTPOS_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

impl Board {
    /// The standard starting position.
    pub fn startpos() -> Board {
        parse_fen(STARTPOS_FEN)
    }
}

/// Parse a FEN string into a `Board`. Panics on malformed input (M0 keeps this
/// strict; graceful error handling can come later).
pub fn parse_fen(fen: &str) -> Board {
    let parts: Vec<&str> = fen.split_whitespace().collect();
    assert!(parts.len() >= 4, "FEN needs at least 4 fields: {fen:?}");

    let mut squares = [None; 64];
    for (i, row) in parts[0].split('/').enumerate() {
        let rank = 7 - i as i32; // first FEN row is rank 8
        let mut file = 0i32;
        for ch in row.chars() {
            if let Some(d) = ch.to_digit(10) {
                file += d as i32;
            } else {
                squares[sq(file, rank) as usize] = Some(char_to_piece(ch));
                file += 1;
            }
        }
    }

    let side = if parts[1] == "w" {
        Color::White
    } else {
        Color::Black
    };

    let mut castling = 0u8;
    if parts[2] != "-" {
        for ch in parts[2].chars() {
            match ch {
                'K' => castling |= CASTLE_WK,
                'Q' => castling |= CASTLE_WQ,
                'k' => castling |= CASTLE_BK,
                'q' => castling |= CASTLE_BQ,
                _ => {}
            }
        }
    }

    let ep = if parts[3] == "-" {
        None
    } else {
        Some(algebraic_to_sq(parts[3]))
    };
    let halfmove = parts.get(4).and_then(|s| s.parse().ok()).unwrap_or(0);
    let fullmove = parts.get(5).and_then(|s| s.parse().ok()).unwrap_or(1);

    Board {
        squares,
        side,
        castling,
        ep,
        halfmove,
        fullmove,
    }
}

/// Format a `Board` back into a FEN string.
pub fn to_fen(b: &Board) -> String {
    let mut s = String::new();
    for rank in (0..8).rev() {
        let mut empty = 0;
        for file in 0..8 {
            match b.squares[sq(file, rank) as usize] {
                Some(p) => {
                    if empty > 0 {
                        s.push_str(&empty.to_string());
                        empty = 0;
                    }
                    s.push(piece_to_char(p));
                }
                None => empty += 1,
            }
        }
        if empty > 0 {
            s.push_str(&empty.to_string());
        }
        if rank > 0 {
            s.push('/');
        }
    }

    s.push(' ');
    s.push(if b.side == Color::White { 'w' } else { 'b' });

    s.push(' ');
    if b.castling == 0 {
        s.push('-');
    } else {
        if b.castling & CASTLE_WK != 0 {
            s.push('K');
        }
        if b.castling & CASTLE_WQ != 0 {
            s.push('Q');
        }
        if b.castling & CASTLE_BK != 0 {
            s.push('k');
        }
        if b.castling & CASTLE_BQ != 0 {
            s.push('q');
        }
    }

    s.push(' ');
    match b.ep {
        Some(e) => s.push_str(&sq_to_algebraic(e)),
        None => s.push('-'),
    }

    s.push(' ');
    s.push_str(&b.halfmove.to_string());
    s.push(' ');
    s.push_str(&b.fullmove.to_string());
    s
}

fn char_to_piece(ch: char) -> Piece {
    let color = if ch.is_ascii_uppercase() {
        Color::White
    } else {
        Color::Black
    };
    let kind = match ch.to_ascii_lowercase() {
        'p' => PieceKind::Pawn,
        'n' => PieceKind::Knight,
        'b' => PieceKind::Bishop,
        'r' => PieceKind::Rook,
        'q' => PieceKind::Queen,
        'k' => PieceKind::King,
        other => panic!("invalid FEN piece char: {other:?}"),
    };
    Piece { color, kind }
}

fn piece_to_char(p: Piece) -> char {
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

/// Convert e.g. "e3" to a square index.
pub fn algebraic_to_sq(a: &str) -> Square {
    let bytes = a.as_bytes();
    let file = (bytes[0] - b'a') as i32;
    let rank = (bytes[1] - b'1') as i32;
    sq(file, rank)
}

/// Convert a square index to e.g. "e3".
pub fn sq_to_algebraic(s: Square) -> String {
    let file = (b'a' + file_of(s) as u8) as char;
    let rank = (b'1' + rank_of(s) as u8) as char;
    format!("{file}{rank}")
}
