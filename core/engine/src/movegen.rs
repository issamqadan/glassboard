//! Move generation: attack detection, pseudo-legal moves, and legal moves
//! (pseudo-legal filtered by king safety).

use crate::board::*;

const KNIGHT_OFFS: [(i32, i32); 8] = [
    (1, 2),
    (2, 1),
    (2, -1),
    (1, -2),
    (-1, -2),
    (-2, -1),
    (-2, 1),
    (-1, 2),
];
const KING_OFFS: [(i32, i32); 8] = [
    (1, 0),
    (1, 1),
    (0, 1),
    (-1, 1),
    (-1, 0),
    (-1, -1),
    (0, -1),
    (1, -1),
];
const BISHOP_DIRS: [(i32, i32); 4] = [(1, 1), (1, -1), (-1, 1), (-1, -1)];
const ROOK_DIRS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

#[inline]
fn on_board(file: i32, rank: i32) -> bool {
    (0..8).contains(&file) && (0..8).contains(&rank)
}

/// Locate `color`'s king. Panics if absent (should never happen for positions
/// reached through legal play).
pub fn king_square(b: &Board, color: Color) -> Square {
    for s in 0..64u8 {
        if let Some(p) = b.squares[s as usize] {
            if p.color == color && p.kind == PieceKind::King {
                return s;
            }
        }
    }
    panic!("king_square: no {:?} king on board", color);
}

/// Is square `s` attacked by any piece of color `by`?
pub fn is_attacked(b: &Board, s: Square, by: Color) -> bool {
    let f = file_of(s);
    let r = rank_of(s);

    // Pawns: a `by` pawn one rank toward its forward direction, on an adjacent
    // file, attacks `s`.
    let pr = if by == Color::White { r - 1 } else { r + 1 };
    for df in [-1, 1] {
        if on_board(f + df, pr) {
            if let Some(p) = b.squares[sq(f + df, pr) as usize] {
                if p.color == by && p.kind == PieceKind::Pawn {
                    return true;
                }
            }
        }
    }

    // Knights.
    for (df, dr) in KNIGHT_OFFS {
        if on_board(f + df, r + dr) {
            if let Some(p) = b.squares[sq(f + df, r + dr) as usize] {
                if p.color == by && p.kind == PieceKind::Knight {
                    return true;
                }
            }
        }
    }

    // King.
    for (df, dr) in KING_OFFS {
        if on_board(f + df, r + dr) {
            if let Some(p) = b.squares[sq(f + df, r + dr) as usize] {
                if p.color == by && p.kind == PieceKind::King {
                    return true;
                }
            }
        }
    }

    // Bishops / queens (diagonal rays).
    if ray_hits(b, f, r, &BISHOP_DIRS, by, PieceKind::Bishop) {
        return true;
    }
    // Rooks / queens (orthogonal rays).
    if ray_hits(b, f, r, &ROOK_DIRS, by, PieceKind::Rook) {
        return true;
    }
    false
}

/// Walk each direction in `dirs` from (f, r); return true if the first piece
/// met is a `by`-colored queen or the given `slider` kind.
fn ray_hits(b: &Board, f: i32, r: i32, dirs: &[(i32, i32)], by: Color, slider: PieceKind) -> bool {
    for (df, dr) in dirs {
        let mut nf = f + df;
        let mut nr = r + dr;
        while on_board(nf, nr) {
            if let Some(p) = b.squares[sq(nf, nr) as usize] {
                if p.color == by && (p.kind == PieceKind::Queen || p.kind == slider) {
                    return true;
                }
                break; // any piece blocks the ray
            }
            nf += df;
            nr += dr;
        }
    }
    false
}

/// All pseudo-legal moves for the side to move (may leave own king in check).
pub fn generate_pseudo(b: &Board) -> Vec<Move> {
    let mut moves = Vec::with_capacity(48);
    for s in 0..64u8 {
        if let Some(p) = b.squares[s as usize] {
            if p.color != b.side {
                continue;
            }
            match p.kind {
                PieceKind::Pawn => gen_pawn(b, s, &mut moves),
                PieceKind::Knight => gen_step(b, s, &KNIGHT_OFFS, &mut moves),
                PieceKind::King => {
                    gen_step(b, s, &KING_OFFS, &mut moves);
                    gen_castling(b, s, &mut moves);
                }
                PieceKind::Bishop => gen_slide(b, s, &BISHOP_DIRS, &mut moves),
                PieceKind::Rook => gen_slide(b, s, &ROOK_DIRS, &mut moves),
                PieceKind::Queen => {
                    gen_slide(b, s, &BISHOP_DIRS, &mut moves);
                    gen_slide(b, s, &ROOK_DIRS, &mut moves);
                }
            }
        }
    }
    moves
}

/// Legal moves: pseudo-legal moves after which the mover's king is not attacked.
pub fn generate_legal(b: &Board) -> Vec<Move> {
    let us = b.side;
    let mut legal = Vec::with_capacity(48);
    for m in generate_pseudo(b) {
        let mut nb = *b;
        nb.make_move(m);
        let ksq = king_square(&nb, us);
        if !is_attacked(&nb, ksq, us.opp()) {
            legal.push(m);
        }
    }
    legal
}

// --- piece-specific pseudo-move generators ---------------------------------

fn gen_step(b: &Board, from: Square, offs: &[(i32, i32)], moves: &mut Vec<Move>) {
    let color = b.squares[from as usize].unwrap().color;
    let f = file_of(from);
    let r = rank_of(from);
    for (df, dr) in offs {
        if !on_board(f + df, r + dr) {
            continue;
        }
        let to = sq(f + df, r + dr);
        match b.squares[to as usize] {
            Some(tp) if tp.color == color => {} // own piece blocks
            _ => moves.push(Move {
                from,
                to,
                promo: None,
                flag: Flag::Normal,
            }),
        }
    }
}

fn gen_slide(b: &Board, from: Square, dirs: &[(i32, i32)], moves: &mut Vec<Move>) {
    let color = b.squares[from as usize].unwrap().color;
    let f = file_of(from);
    let r = rank_of(from);
    for (df, dr) in dirs {
        let mut nf = f + df;
        let mut nr = r + dr;
        while on_board(nf, nr) {
            let to = sq(nf, nr);
            match b.squares[to as usize] {
                None => moves.push(Move {
                    from,
                    to,
                    promo: None,
                    flag: Flag::Normal,
                }),
                Some(tp) => {
                    if tp.color != color {
                        moves.push(Move {
                            from,
                            to,
                            promo: None,
                            flag: Flag::Normal,
                        });
                    }
                    break; // ray blocked either way
                }
            }
            nf += df;
            nr += dr;
        }
    }
}

fn gen_pawn(b: &Board, from: Square, moves: &mut Vec<Move>) {
    let color = b.squares[from as usize].unwrap().color;
    let f = file_of(from);
    let r = rank_of(from);
    let dir = if color == Color::White { 1 } else { -1 };
    let start_rank = if color == Color::White { 1 } else { 6 };
    let promo_rank = if color == Color::White { 7 } else { 0 };

    // Forward pushes.
    let r1 = r + dir;
    if on_board(f, r1) && b.squares[sq(f, r1) as usize].is_none() {
        push_pawn_move(from, sq(f, r1), r1 == promo_rank, Flag::Normal, moves);
        if r == start_rank {
            let r2 = r + 2 * dir;
            if b.squares[sq(f, r2) as usize].is_none() {
                moves.push(Move {
                    from,
                    to: sq(f, r2),
                    promo: None,
                    flag: Flag::DoublePush,
                });
            }
        }
    }

    // Captures (including en passant).
    for df in [-1, 1] {
        let cf = f + df;
        let cr = r + dir;
        if !on_board(cf, cr) {
            continue;
        }
        let to = sq(cf, cr);
        match b.squares[to as usize] {
            Some(tp) if tp.color != color => {
                push_pawn_move(from, to, cr == promo_rank, Flag::Normal, moves);
            }
            None if Some(to) == b.ep => moves.push(Move {
                from,
                to,
                promo: None,
                flag: Flag::EnPassant,
            }),
            _ => {}
        }
    }
}

/// Push a pawn move, expanding to the four promotions when it reaches the last rank.
fn push_pawn_move(from: Square, to: Square, is_promo: bool, flag: Flag, moves: &mut Vec<Move>) {
    if is_promo {
        for k in [
            PieceKind::Queen,
            PieceKind::Rook,
            PieceKind::Bishop,
            PieceKind::Knight,
        ] {
            moves.push(Move {
                from,
                to,
                promo: Some(k),
                flag: Flag::Normal,
            });
        }
    } else {
        moves.push(Move {
            from,
            to,
            promo: None,
            flag,
        });
    }
}

/// Castling moves. Requires the right, empty squares between, the king not
/// currently in check, and the king not passing through an attacked square.
/// The destination square's safety is enforced by `generate_legal`.
fn gen_castling(b: &Board, from: Square, moves: &mut Vec<Move>) {
    let color = b.squares[from as usize].unwrap().color;
    let r = if color == Color::White { 0 } else { 7 };
    let home = sq(4, r);
    if from != home {
        return;
    }
    let enemy = color.opp();
    if is_attacked(b, home, enemy) {
        return; // cannot castle out of check
    }
    let (right_k, right_q) = if color == Color::White {
        (CASTLE_WK, CASTLE_WQ)
    } else {
        (CASTLE_BK, CASTLE_BQ)
    };

    // Kingside: squares f,g empty; rook on h; king passes through f.
    if b.castling & right_k != 0
        && b.squares[sq(5, r) as usize].is_none()
        && b.squares[sq(6, r) as usize].is_none()
        && !is_attacked(b, sq(5, r), enemy)
        && is_rook(b, sq(7, r), color)
    {
        moves.push(Move {
            from: home,
            to: sq(6, r),
            promo: None,
            flag: Flag::Castle,
        });
    }

    // Queenside: squares b,c,d empty; rook on a; king passes through d.
    if b.castling & right_q != 0
        && b.squares[sq(3, r) as usize].is_none()
        && b.squares[sq(2, r) as usize].is_none()
        && b.squares[sq(1, r) as usize].is_none()
        && !is_attacked(b, sq(3, r), enemy)
        && is_rook(b, sq(0, r), color)
    {
        moves.push(Move {
            from: home,
            to: sq(2, r),
            promo: None,
            flag: Flag::Castle,
        });
    }
}

#[inline]
fn is_rook(b: &Board, s: Square, color: Color) -> bool {
    matches!(
        b.squares[s as usize],
        Some(Piece { color: c, kind: PieceKind::Rook }) if c == color
    )
}
