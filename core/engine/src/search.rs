//! Search: negamax alpha-beta with quiescence, iterative deepening, a
//! **transposition table** (Zobrist-keyed) and TT-move + MVV-LVA ordering.
//! The TT both remembers exact/bounded scores (cheap cutoffs on transpositions)
//! and supplies the best move first for ordering — the single biggest strength
//! gain over plain alpha-beta. Correctness-first; time management can come later.

use crate::board::*;
use crate::eval::{eval, material};
use crate::movegen::{generate_legal, is_attacked, king_square};
use std::sync::OnceLock;

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

// ---- Zobrist hashing ------------------------------------------------------

struct Zob {
    piece: [[u64; 64]; 12],
    side: u64,
    castle: [u64; 16],
    ep: [u64; 8],
}
static ZOB: OnceLock<Zob> = OnceLock::new();
fn zob() -> &'static Zob {
    ZOB.get_or_init(|| {
        // splitmix64 with a fixed seed → deterministic keys, no external crate.
        let mut s: u64 = 0x243F_6A88_85A3_08D3;
        let mut rnd = || {
            s = s.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut z = s;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            z ^ (z >> 31)
        };
        let mut piece = [[0u64; 64]; 12];
        for k in 0..12 {
            for sq in 0..64 {
                piece[k][sq] = rnd();
            }
        }
        let side = rnd();
        let mut castle = [0u64; 16];
        for c in castle.iter_mut() {
            *c = rnd();
        }
        let mut ep = [0u64; 8];
        for e in ep.iter_mut() {
            *e = rnd();
        }
        Zob { piece, side, castle, ep }
    })
}
fn pidx(p: Piece) -> usize {
    let k = match p.kind {
        PieceKind::Pawn => 0,
        PieceKind::Knight => 1,
        PieceKind::Bishop => 2,
        PieceKind::Rook => 3,
        PieceKind::Queen => 4,
        PieceKind::King => 5,
    };
    k * 2 + if p.color == Color::White { 0 } else { 1 }
}
fn zobrist(b: &Board) -> u64 {
    let z = zob();
    let mut h = 0u64;
    for s in 0..64 {
        if let Some(p) = b.squares[s] {
            h ^= z.piece[pidx(p)][s];
        }
    }
    if b.side == Color::Black {
        h ^= z.side;
    }
    h ^= z.castle[(b.castling & 15) as usize];
    if let Some(ep) = b.ep {
        h ^= z.ep[file_of(ep) as usize];
    }
    h
}

// ---- Transposition table --------------------------------------------------

#[derive(Clone, Copy)]
enum Bound {
    Exact,
    Lower, // fail-high: the true score is >= stored
    Upper, // fail-low:  the true score is <= stored
}
#[derive(Clone, Copy)]
struct TtEntry {
    key: u64,
    depth: u8,
    score: i32,
    bound: Bound,
    mv: Move,
}
struct Tt {
    e: Vec<Option<TtEntry>>,
    mask: usize,
}
impl Tt {
    fn new() -> Self {
        let n = 1usize << 19; // ~512k entries; a few MB, fine for WASM
        Tt { e: vec![None; n], mask: n - 1 }
    }
    fn probe(&self, key: u64) -> Option<TtEntry> {
        self.e[key as usize & self.mask].filter(|x| x.key == key)
    }
    fn store(&mut self, key: u64, depth: u32, score: i32, bound: Bound, mv: Move) {
        let i = key as usize & self.mask;
        let replace = match self.e[i] {
            None => true,
            Some(x) => x.key != key || depth as u8 >= x.depth, // depth-preferred
        };
        if replace {
            self.e[i] = Some(TtEntry { key, depth: depth as u8, score, bound, mv });
        }
    }
}
// Mate scores encode distance-from-root (via ply); store/read them relative to
// the node so a TT hit at a different ply stays correct.
fn to_tt(score: i32, ply: i32) -> i32 {
    if score >= MATE_THRESHOLD {
        score + ply
    } else if score <= -MATE_THRESHOLD {
        score - ply
    } else {
        score
    }
}
fn from_tt(score: i32, ply: i32) -> i32 {
    if score >= MATE_THRESHOLD {
        score - ply
    } else if score <= -MATE_THRESHOLD {
        score + ply
    } else {
        score
    }
}

// ---- Search ---------------------------------------------------------------

/// Score every legal move to `depth` and return them best-first. Used by the
/// assistance layer to offer ranked candidate moves. Full window per move so the
/// scores are directly comparable; the shared TT speeds transpositions.
pub fn rank_moves(b: &Board, depth: u32) -> Vec<(Move, i32)> {
    let mut nodes = 0u64;
    let mut tt = Tt::new();
    let mut scored: Vec<(Move, i32)> = generate_legal(b)
        .into_iter()
        .map(|m| {
            let mut nb = *b;
            nb.make_move(m);
            let s = -negamax(&nb, depth.saturating_sub(1), 1, -INF, INF, &mut nodes, &mut tt);
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
    let mut tt = Tt::new();

    for d in 1..=max_depth {
        let mut moves = generate_legal(b);
        if moves.is_empty() {
            let s = if in_check(b) { -MATE } else { 0 };
            return SearchResult { best: None, score: s, nodes: total_nodes, depth: d };
        }
        // Order by the TT/PV move from the previous iteration, then captures.
        let tt_move = best.or_else(|| tt.probe(zobrist(b)).map(|e| e.mv));
        order(b, &mut moves, tt_move);

        let mut alpha = -INF;
        let beta = INF;
        let mut local_best = -INF;
        let mut local_move = None;
        let mut nodes = 0u64;
        for m in moves {
            let mut nb = *b;
            nb.make_move(m);
            let s = -negamax(&nb, d - 1, 1, -beta, -alpha, &mut nodes, &mut tt);
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
        if let Some(m) = best {
            tt.store(zobrist(b), d, to_tt(score, 0), Bound::Exact, m);
        }
        if score.abs() >= MATE_THRESHOLD {
            break; // a forced mate is found — no need to search deeper
        }
    }

    SearchResult { best, score, nodes: total_nodes, depth: max_depth }
}

fn negamax(b: &Board, depth: u32, ply: i32, mut alpha: i32, beta: i32, nodes: &mut u64, tt: &mut Tt) -> i32 {
    *nodes += 1;

    let mut moves = generate_legal(b);
    if moves.is_empty() {
        return if in_check(b) { -(MATE - ply) } else { 0 };
    }
    if depth == 0 {
        return quiesce(b, alpha, beta, nodes);
    }

    let alpha_orig = alpha;
    let key = zobrist(b);
    let mut tt_move: Option<Move> = None;
    if let Some(e) = tt.probe(key) {
        tt_move = Some(e.mv);
        if e.depth as u32 >= depth {
            let sc = from_tt(e.score, ply);
            match e.bound {
                Bound::Exact => return sc,
                Bound::Lower => {
                    if sc >= beta {
                        return sc;
                    }
                }
                Bound::Upper => {
                    if sc <= alpha {
                        return sc;
                    }
                }
            }
        }
    }

    // Null-move pruning: give the opponent a free move; if we're still so good
    // that even then we'd exceed beta, this node is too strong to be relevant —
    // cut it. Skipped in check and in pawn-only endgames (zugzwang risk).
    if depth >= 3 && beta < MATE_THRESHOLD && !in_check(b) && has_non_pawn_material(b, b.side) {
        let mut nb = *b;
        nb.side = nb.side.opp();
        nb.ep = None;
        let r = 2; // reduction
        let s = -negamax(&nb, depth.saturating_sub(1 + r), ply + 1, -beta, -beta + 1, nodes, tt);
        if s >= beta {
            return beta;
        }
    }

    order(b, &mut moves, tt_move);
    let mut best = -INF;
    let mut best_move = moves[0];
    for m in moves {
        let mut nb = *b;
        nb.make_move(m);
        let s = -negamax(&nb, depth - 1, ply + 1, -beta, -alpha, nodes, tt);
        if s > best {
            best = s;
            best_move = m;
        }
        if best > alpha {
            alpha = best;
        }
        if alpha >= beta {
            break; // beta cutoff
        }
    }

    let bound = if best <= alpha_orig {
        Bound::Upper
    } else if best >= beta {
        Bound::Lower
    } else {
        Bound::Exact
    };
    tt.store(key, depth, to_tt(best, ply), bound, best_move);
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
    order(b, &mut caps, None);

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

/// Does `side` have a piece other than pawns (and the king)? Null-move pruning is
/// unsafe without one (zugzwang), so we gate on it.
fn has_non_pawn_material(b: &Board, side: Color) -> bool {
    b.squares.iter().flatten().any(|p| {
        p.color == side && p.kind != PieceKind::Pawn && p.kind != PieceKind::King
    })
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
        b.squares[m.to as usize].map(|p| material(p.kind)).unwrap_or(0)
    };
    let attacker = b.squares[m.from as usize].map(|p| material(p.kind)).unwrap_or(0);
    victim * 10 - attacker
}

/// Order the TT/PV move first, then captures (MVV-LVA), then quiet moves.
fn order(b: &Board, moves: &mut [Move], tt_move: Option<Move>) {
    moves.sort_by_key(|m| {
        if Some(*m) == tt_move {
            -2_000_000
        } else if is_capture(b, m) {
            -(1_000_000 + mvv_lva(b, m))
        } else {
            0
        }
    });
}
