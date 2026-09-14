//! Standard Algebraic Notation (SAN) — the human-readable move format
//! (e.g. `Nf3`, `exd5`, `O-O`, `e8=Q`, `Qxh7#`). Used by the assistance layer so
//! suggestions read like chess, not coordinates.

use crate::board::*;
use crate::fen::sq_to_algebraic;
use crate::movegen::{generate_legal, is_attacked, king_square};

/// The letter used for a piece in SAN (pawns have none in normal moves).
pub fn piece_letter(k: PieceKind) -> char {
    match k {
        PieceKind::King => 'K',
        PieceKind::Queen => 'Q',
        PieceKind::Rook => 'R',
        PieceKind::Bishop => 'B',
        PieceKind::Knight => 'N',
        PieceKind::Pawn => 'P',
    }
}

/// Render `mv` (assumed legal in `b`) as SAN.
pub fn san(b: &Board, mv: Move) -> String {
    if mv.flag == Flag::Castle {
        let base = if file_of(mv.to) == 6 { "O-O" } else { "O-O-O" };
        return format!("{base}{}", check_suffix(b, mv));
    }

    let piece = match b.squares[mv.from as usize] {
        Some(p) => p,
        None => return String::new(),
    };
    let is_capture = b.squares[mv.to as usize].is_some() || mv.flag == Flag::EnPassant;
    let file_c = |s: Square| (b'a' + file_of(s) as u8) as char;
    let rank_c = |s: Square| (b'1' + rank_of(s) as u8) as char;

    let mut out = String::new();
    if piece.kind == PieceKind::Pawn {
        if is_capture {
            out.push(file_c(mv.from));
            out.push('x');
        }
        out.push_str(&sq_to_algebraic(mv.to));
        if let Some(k) = mv.promo {
            out.push('=');
            out.push(piece_letter(k));
        }
    } else {
        out.push(piece_letter(piece.kind));
        // Disambiguate against other same-kind pieces that can also reach `to`.
        let others: Vec<Move> = generate_legal(b)
            .into_iter()
            .filter(|m| {
                m.to == mv.to
                    && m.from != mv.from
                    && b.squares[m.from as usize]
                        .map(|p| p.kind == piece.kind)
                        .unwrap_or(false)
            })
            .collect();
        if !others.is_empty() {
            let same_file = others.iter().any(|m| file_of(m.from) == file_of(mv.from));
            let same_rank = others.iter().any(|m| rank_of(m.from) == rank_of(mv.from));
            if !same_file {
                out.push(file_c(mv.from));
            } else if !same_rank {
                out.push(rank_c(mv.from));
            } else {
                out.push(file_c(mv.from));
                out.push(rank_c(mv.from));
            }
        }
        if is_capture {
            out.push('x');
        }
        out.push_str(&sq_to_algebraic(mv.to));
    }
    out.push_str(&check_suffix(b, mv));
    out
}

/// "+" for check, "#" for checkmate, "" otherwise.
fn check_suffix(b: &Board, mv: Move) -> &'static str {
    let mut nb = *b;
    nb.make_move(mv);
    let opp = nb.side; // side to move after our move = the opponent
    let ksq = king_square(&nb, opp);
    if is_attacked(&nb, ksq, opp.opp()) {
        if generate_legal(&nb).is_empty() {
            "#"
        } else {
            "+"
        }
    } else {
        ""
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fen::{algebraic_to_sq, parse_fen};

    fn find(b: &Board, from: &str, to: &str) -> Move {
        let f = algebraic_to_sq(from);
        let t = algebraic_to_sq(to);
        generate_legal(b)
            .into_iter()
            .find(|m| m.from == f && m.to == t)
            .expect("legal move")
    }

    #[test]
    fn basic_san() {
        let b = Board::startpos();
        assert_eq!(san(&b, find(&b, "g1", "f3")), "Nf3");
        assert_eq!(san(&b, find(&b, "e2", "e4")), "e4");
        assert_eq!(san(&b, find(&b, "b1", "c3")), "Nc3");
    }

    #[test]
    fn capture_and_mate() {
        // Back-rank mate: Ra1-a8#.
        let b = parse_fen("6k1/5ppp/8/8/8/8/8/R6K w - - 0 1");
        assert_eq!(san(&b, find(&b, "a1", "a8")), "Ra8#");
        // A pawn capture with check is written like exd5 (+ suffix if it checks).
        let c = parse_fen("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
        assert_eq!(san(&c, find(&c, "e4", "d5")), "exd5");
    }
}
