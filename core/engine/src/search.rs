//! Search: negamax alpha-beta with quiescence, MVV-LVA move ordering, and
//! iterative deepening. Correctness-first (M1); transposition tables, better
//! pruning, and time management can come later.

use crate::board::*;
use crate::eval::{eval, material};
use crate::movegen::{generate_legal, is_attacked, king_square};

/// Score assigned to being checkmated (adjusted by distance so shorter mates
/// are preferred). Scores with `abs >= MATE_THRESHOLD` denote a forced mate.
pub const MATE: i32 = 30_000;
pub const MATE_THRESHOLD: i32 = MATE - 1_000;
const INF: i32 = 1_000_000;

/// Result of a search: the chosen move, its score (side-to-move relative),
/// nodes visited, and the depth reached.
pub struct SearchResult {
    pub best: Option<Move>,
    pub score: i32,
    pub nodes: u64,
    pub depth: u32,
}

/// Is the side to move currently in check?
pub fn in_check(b: &Board) -> bool {
    let k = king_square(b, b.side);
    is_attacked(b, k, b.side.opp())
}

/// Convenience: the best move for `b` searched to `depth`.
pub fn best_move(b: &Board, depth: u32) -> Option<Move> {
    search(b, depth).best
}

/// Score every legal move to `depth` and return them best-first. Used by the
/// assistance layer to offer ranked candidate moves. Each move is searched with
/// a full window so the scores are directly comparable.
pub fn rank_moves(b: &Board, depth: u32) -> Vec<(Move, i32)> {
    let mut nodes = 0u64;
    let mut scored: Vec<(Move, i32)> = generate_legal(b)
        .into_iter()
        .map(|m| {
            let mut nb = *b;
            nb.make_move(m);
            let s = -negamax(&nb, depth.saturating_sub(1), 1, -INF, INF, &mut nodes);
            (m, s)
        })
        .collect();
    scored.sort_by(|a, b| b.1.cmp(&a.1));
    scored
}

/// Search `b` to `max_depth` with iterative deepening; returns the best move.
pub fn search(b: &Board, max_depth: u32) -> SearchResult {
    let mut best: Option<Move> = None;
    let mut score = 0;
    let mut total_nodes = 0u64;

    for d in 1..=max_depth {
        let mut moves = generate_legal(b);
        if moves.is_empty() {
            let s = if in_check(b) { -MATE } else { 0 };
            return SearchResult {
                best: None,
                score: s,
                nodes: total_nodes,
                depth: d,
            };
        }
        order(b, &mut moves);
        // Search the previous iteration's best move first (cheap PV ordering).
        if let Some(bm) = best {
            if let Some(pos) = moves.iter().position(|m| *m == bm) {
                moves.swap(0, pos);
            }
        }

        let mut alpha = -INF;
        let beta = INF;
        let mut local_best = -INF;
        let mut local_move = None;
        let mut nodes = 0u64;
        for m in moves {
            let mut nb = *b;
            nb.make_move(m);
            let s = -negamax(&nb, d - 1, 1, -beta, -alpha, &mut nodes);
            if s > local_best {
                local_best = s;
                local_move = Some(m);
            }
            if local_best > alpha {
                alpha = local_best;
            }
        }

        best = local_move;
        score = local_best;
        total_nodes += nodes;

        // A forced mate is found — no need to search deeper.
        if score.abs() >= MATE_THRESHOLD {
            break;
        }
    }

    SearchResult {
        best,
        score,
        nodes: total_nodes,
        depth: max_depth,
    }
}

fn negamax(b: &Board, depth: u32, ply: i32, mut alpha: i32, beta: i32, nodes: &mut u64) -> i32 {
    *nodes += 1;

    let mut moves = generate_legal(b);
    if moves.is_empty() {
        // Checkmate (distance-adjusted) or stalemate.
        return if in_check(b) { -(MATE - ply) } else { 0 };
    }
    if depth == 0 {
        return quiesce(b, alpha, beta, nodes);
    }

    order(b, &mut moves);
    let mut best = -INF;
    for m in moves {
        let mut nb = *b;
        nb.make_move(m);
        let s = -negamax(&nb, depth - 1, ply + 1, -beta, -alpha, nodes);
        if s > best {
            best = s;
        }
        if best > alpha {
            alpha = best;
        }
        if alpha >= beta {
            break; // beta cutoff
        }
    }
    best
}

/// Quiescence search: extend along captures so the static eval is only trusted
/// in "quiet" positions (avoids the horizon effect on tactics).
fn quiesce(b: &Board, mut alpha: i32, beta: i32, nodes: &mut u64) -> i32 {
    *nodes += 1;

    let stand = eval(b);
    if stand >= beta {
        return beta;
    }
    if stand > alpha {
        alpha = stand;
    }

    let mut caps: Vec<Move> = generate_legal(b)
        .into_iter()
        .filter(|m| is_capture(b, m))
        .collect();
    order(b, &mut caps);

    for m in caps {
        let mut nb = *b;
        nb.make_move(m);
        let s = -quiesce(&nb, -beta, -alpha, nodes);
        if s >= beta {
            return beta;
        }
        if s > alpha {
            alpha = s;
        }
    }
    alpha
}

#[inline]
fn is_capture(b: &Board, m: &Move) -> bool {
    b.squares[m.to as usize].is_some() || m.flag == Flag::EnPassant
}

/// MVV-LVA-ish key: most valuable victim, least valuable attacker.
fn mvv_lva(b: &Board, m: &Move) -> i32 {
    let victim = if m.flag == Flag::EnPassant {
        material(PieceKind::Pawn)
    } else {
        b.squares[m.to as usize]
            .map(|p| material(p.kind))
            .unwrap_or(0)
    };
    let attacker = b.squares[m.from as usize]
        .map(|p| material(p.kind))
        .unwrap_or(0);
    victim * 10 - attacker
}

/// Order captures (by MVV-LVA) ahead of quiet moves.
fn order(b: &Board, moves: &mut [Move]) {
    moves.sort_by_key(|m| {
        if is_capture(b, m) {
            -(1_000_000 + mvv_lva(b, m)) // captures first, best captures earliest
        } else {
            0
        }
    });
}
