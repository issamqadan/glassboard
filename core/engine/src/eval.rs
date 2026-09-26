//! Static evaluation: material + piece-square tables.
//!
//! Returns a score in centipawns from the **side-to-move's** perspective
//! (positive = better for the player to move). This is deliberately simple for
//! M1 — a strong, tunable neural evaluation replaces/augments it in M4.

use crate::board::*;

/// Material value of a piece kind, in centipawns.
pub fn material(kind: PieceKind) -> i32 {
    match kind {
        PieceKind::Pawn => 100,
        PieceKind::Knight => 320,
        PieceKind::Bishop => 330,
        PieceKind::Rook => 500,
        PieceKind::Queen => 900,
        PieceKind::King => 0, // kings are never counted for material balance
    }
}

/// Full static evaluation of `b`, side-to-move relative. Material + piece-square
/// tables, plus cheap, high-value positional terms (bishop pair, pawn structure,
/// rook files, king shield, tempo) so play is genuinely better at the same depth.
pub fn eval(b: &Board) -> i32 {
    let mut score = 0i32; // from White's perspective first

    // Pass 1: per-file pawn counts (for structure + rook files).
    let mut wpawn = [0i32; 8];
    let mut bpawn = [0i32; 8];
    for s in 0..64usize {
        if let Some(p) = b.squares[s] {
            if p.kind == PieceKind::Pawn {
                let f = (s & 7) as usize;
                if p.color == Color::White { wpawn[f] += 1 } else { bpawn[f] += 1 }
            }
        }
    }

    // Pass 2: material + PST, bishop count, rook-file bonus.
    let (mut wbishops, mut bbishops) = (0i32, 0i32);
    for s in 0..64usize {
        if let Some(p) = b.squares[s] {
            let mut v = material(p.kind) + pst_value(p, s as u8);
            let f = (s & 7) as usize;
            match p.kind {
                PieceKind::Bishop => { if p.color == Color::White { wbishops += 1 } else { bbishops += 1 } }
                PieceKind::Rook => {
                    // open file (no pawns) → strong; half-open (no friendly pawns) → good.
                    let own = if p.color == Color::White { wpawn[f] } else { bpawn[f] };
                    let opp = if p.color == Color::White { bpawn[f] } else { wpawn[f] };
                    if own == 0 { v += if opp == 0 { 22 } else { 11 } }
                }
                _ => {}
            }
            if p.color == Color::White { score += v } else { score -= v }
        }
    }

    // Bishop pair — a real, lasting edge.
    if wbishops >= 2 { score += 30 }
    if bbishops >= 2 { score -= 30 }

    // Pawn structure: doubled and isolated pawns are weaknesses.
    for f in 0..8usize {
        if wpawn[f] > 1 { score -= 16 * (wpawn[f] - 1) }
        if bpawn[f] > 1 { score += 16 * (bpawn[f] - 1) }
        let w_iso = wpawn[f] > 0 && (f == 0 || wpawn[f - 1] == 0) && (f == 7 || wpawn[f + 1] == 0);
        let b_iso = bpawn[f] > 0 && (f == 0 || bpawn[f - 1] == 0) && (f == 7 || bpawn[f + 1] == 0);
        if w_iso { score -= 13 * wpawn[f] }
        if b_iso { score += 13 * bpawn[f] }
    }

    // King safety: reward pawns sheltering the king (a simple pawn-shield count).
    score += king_shield(b, Color::White, &wpawn);
    score -= king_shield(b, Color::Black, &bpawn);

    // Tempo: a small bonus for having the move.
    let white_rel = if b.side == Color::White { score + 12 } else { score - 12 };
    if b.side == Color::White { white_rel } else { -white_rel }
}

/// Pawn shield in front of the castled king: count friendly pawns on the king's
/// file and its neighbours, on the rank(s) just ahead. Cheap king-safety proxy.
fn king_shield(b: &Board, color: Color, _pawns: &[i32; 8]) -> i32 {
    let mut ks = 64u8;
    for s in 0..64u8 {
        if matches!(b.squares[s as usize], Some(p) if p.color == color && p.kind == PieceKind::King) {
            ks = s;
            break;
        }
    }
    if ks == 64 { return 0; }
    let kf = file_of(ks);
    let kr = rank_of(ks);
    // Only meaningful when the king is tucked back (not marched up the board).
    let home = if color == Color::White { kr <= 1 } else { kr >= 6 };
    if !home { return 0; }
    let mut shield = 0;
    for df in -1..=1i32 {
        let f = kf + df;
        if !(0..8).contains(&f) { continue; }
        for dr in 1..=2i32 {
            let r = if color == Color::White { kr + dr } else { kr - dr };
            if !(0..8).contains(&r) { continue; }
            if matches!(b.squares[(r * 8 + f) as usize], Some(p) if p.color == color && p.kind == PieceKind::Pawn) {
                shield += if dr == 1 { 10 } else { 5 };
            }
        }
    }
    shield
}

/// Piece-square bonus for a piece on a square. Tables are stored a8-first
/// (rank 8 → rank 1). Our square index is a1-first, so a White piece reads
/// `table[s ^ 56]` (flip rank) and a Black piece reads `table[s]` (mirrored).
fn pst_value(p: Piece, s: Square) -> i32 {
    let table: &[i32; 64] = match p.kind {
        PieceKind::Pawn => &PST_PAWN,
        PieceKind::Knight => &PST_KNIGHT,
        PieceKind::Bishop => &PST_BISHOP,
        PieceKind::Rook => &PST_ROOK,
        PieceKind::Queen => &PST_QUEEN,
        PieceKind::King => &PST_KING,
    };
    let idx = if p.color == Color::White {
        (s ^ 56) as usize
    } else {
        s as usize
    };
    table[idx]
}

#[rustfmt::skip]
const PST_PAWN: [i32; 64] = [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
];

#[rustfmt::skip]
const PST_KNIGHT: [i32; 64] = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
];

#[rustfmt::skip]
const PST_BISHOP: [i32; 64] = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
];

#[rustfmt::skip]
const PST_ROOK: [i32; 64] = [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
];

#[rustfmt::skip]
const PST_QUEEN: [i32; 64] = [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
];

#[rustfmt::skip]
const PST_KING: [i32; 64] = [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
];
