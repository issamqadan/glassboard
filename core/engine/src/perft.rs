//! Perft — the move-generation correctness gate.
//!
//! `perft(depth)` counts the leaf nodes of the legal-move tree to a fixed
//! depth. Matching the well-known reference counts is strong evidence the
//! move generator (including castling, en passant, promotions, and pins) is
//! correct. This is the M0 acceptance test and the foundation for every later
//! strength claim — see the vision's "strength is measured, not assumed."

use crate::board::{Board, Move};
use crate::movegen::generate_legal;

/// Count legal-move-tree leaf nodes at the given `depth`.
pub fn perft(b: &Board, depth: u32) -> u64 {
    if depth == 0 {
        return 1;
    }
    let moves = generate_legal(b);
    if depth == 1 {
        return moves.len() as u64;
    }
    let mut nodes = 0;
    for m in moves {
        let mut nb = *b;
        nb.make_move(m);
        nodes += perft(&nb, depth - 1);
    }
    nodes
}

/// Perft split by first move — the standard debugging aid for locating a
/// discrepancy (compare per-move subtotals against a reference engine).
pub fn perft_divide(b: &Board, depth: u32) -> Vec<(Move, u64)> {
    let mut out = Vec::new();
    for m in generate_legal(b) {
        let mut nb = *b;
        nb.make_move(m);
        let n = if depth <= 1 { 1 } else { perft(&nb, depth - 1) };
        out.push((m, n));
    }
    out
}
