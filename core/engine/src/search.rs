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

const MAX_PLY: usize = 64;

/// Holds the per-search state that powers strong move ordering and reductions:
/// the transposition table, killer moves (quiet moves that caused a cutoff at a
/// ply), and a history table (quiet moves that have been good, by from→to).
struct Searcher {
    tt: Tt,
    killers: [[Option<Move>; 2]; MAX_PLY],
    history: [[i32; 64]; 64],
    nodes: u64,
}

impl Searcher {
    fn new() -> Self {
        Searcher { tt: Tt::new(), killers: [[None; 2]; MAX_PLY], history: [[0; 64]; 64], nodes: 0 }
    }

    fn negamax(&mut self, b: &Board, depth: u32, ply: i32, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;

        let mut moves = generate_legal(b);
        if moves.is_empty() {
            return if in_check(b) { -(MATE - ply) } else { 0 };
        }
        if depth == 0 {
            return self.quiesce(b, alpha, beta);
        }

        let alpha_orig = alpha;
        let key = zobrist(b);
        let mut tt_move: Option<Move> = None;
        if let Some(e) = self.tt.probe(key) {
            tt_move = Some(e.mv);
            if e.depth as u32 >= depth {
                let sc = from_tt(e.score, ply);
                match e.bound {
                    Bound::Exact => return sc,
                    Bound::Lower => if sc >= beta { return sc },
                    Bound::Upper => if sc <= alpha { return sc },
                }
            }
        }

        let node_in_check = in_check(b);

        // Null-move pruning (not in check, needs a piece to avoid zugzwang).
        if depth >= 3 && beta < MATE_THRESHOLD && !node_in_check && has_non_pawn_material(b, b.side) {
            let mut nb = *b;
            nb.side = nb.side.opp();
            nb.ep = None;
            let s = -self.negamax(&nb, depth.saturating_sub(3), ply + 1, -beta, -beta + 1);
            if s >= beta {
                return beta;
            }
        }

        self.order(b, &mut moves, tt_move, ply);
        let mut best = -INF;
        let mut best_move = moves[0];
        let plyi = ply as usize;
        for (i, &m) in moves.iter().enumerate() {
            let mut nb = *b;
            nb.make_move(m);
            let quiet = !is_capture(b, &m) && m.promo.is_none();
            let gives_check = in_check(&nb);
            let s;
            // Late-move reduction: search late, quiet, non-checking moves shallower
            // first; only spend full depth if they beat alpha.
            if i >= 3 && depth >= 3 && quiet && !node_in_check && !gives_check {
                let reduced = -self.negamax(&nb, depth - 2, ply + 1, -beta, -alpha);
                s = if reduced > alpha {
                    -self.negamax(&nb, depth - 1, ply + 1, -beta, -alpha)
                } else {
                    reduced
                };
            } else {
                s = -self.negamax(&nb, depth - 1, ply + 1, -beta, -alpha);
            }
            if s > best {
                best = s;
                best_move = m;
            }
            if best > alpha {
                alpha = best;
            }
            if alpha >= beta {
                // Beta cutoff by a quiet move → reward it (killer + history) so it's
                // tried earlier next time.
                if quiet && plyi < MAX_PLY {
                    if self.killers[plyi][0] != Some(m) {
                        self.killers[plyi][1] = self.killers[plyi][0];
                        self.killers[plyi][0] = Some(m);
                    }
                    self.history[m.from as usize][m.to as usize] += (depth * depth) as i32;
                }
                break;
            }
        }

        let bound = if best <= alpha_orig {
            Bound::Upper
        } else if best >= beta {
            Bound::Lower
        } else {
            Bound::Exact
        };
        self.tt.store(key, depth, to_tt(best, ply), bound, best_move);
        best
    }

    fn quiesce(&mut self, b: &Board, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;
        let stand = eval(b);
        if stand >= beta {
            return beta;
        }
        if stand > alpha {
            alpha = stand;
        }
        let mut caps: Vec<Move> = generate_legal(b).into_iter().filter(|m| is_capture(b, m)).collect();
        caps.sort_by_key(|m| -(1_000_000 + mvv_lva(b, m)));
        for m in caps {
            let mut nb = *b;
            nb.make_move(m);
            let s = -self.quiesce(&nb, -beta, -alpha);
            if s >= beta {
                return beta;
            }
            if s > alpha {
                alpha = s;
            }
        }
        alpha
    }

    /// Order: TT/PV move, then captures (MVV-LVA), then killers, then quiet moves
    /// by their history score.
    fn order(&self, b: &Board, moves: &mut [Move], tt_move: Option<Move>, ply: i32) {
        let plyi = ply as usize;
        let (k0, k1) = if plyi < MAX_PLY {
            (self.killers[plyi][0], self.killers[plyi][1])
        } else {
            (None, None)
        };
        moves.sort_by_key(|m| {
            let sc = if Some(*m) == tt_move {
                10_000_000
            } else if is_capture(b, m) {
                1_000_000 + mvv_lva(b, m)
            } else if Some(*m) == k0 {
                900_000
            } else if Some(*m) == k1 {
                800_000
            } else {
                self.history[m.from as usize][m.to as usize]
            };
            -sc
        });
    }
}

/// Score every legal move to `depth`, best-first (for the assistance layer).
pub fn rank_moves(b: &Board, depth: u32) -> Vec<(Move, i32)> {
    let mut s = Searcher::new();
    let mut scored: Vec<(Move, i32)> = generate_legal(b)
        .into_iter()
        .map(|m| {
            let mut nb = *b;
            nb.make_move(m);
            let sc = -s.negamax(&nb, depth.saturating_sub(1), 1, -INF, INF);
            (m, sc)
        })
        .collect();
    scored.sort_by(|a, b| b.1.cmp(&a.1));
    scored
}

/// Search `b` to `max_depth` with iterative deepening; returns the best move.
pub fn search(b: &Board, max_depth: u32) -> SearchResult {
    let mut s = Searcher::new();
    let mut best: Option<Move> = None;
    let mut score = 0;

    for d in 1..=max_depth {
        let mut moves = generate_legal(b);
        if moves.is_empty() {
            let sc = if in_check(b) { -MATE } else { 0 };
            return SearchResult { best: None, score: sc, nodes: s.nodes, depth: d };
        }
        let tt_move = best.or_else(|| s.tt.probe(zobrist(b)).map(|e| e.mv));
        s.order(b, &mut moves, tt_move, 0);

        let mut alpha = -INF;
        let beta = INF;
        let mut local_best = -INF;
        let mut local_move = None;
        for &m in &moves {
            let mut nb = *b;
            nb.make_move(m);
            let sc = -s.negamax(&nb, d - 1, 1, -beta, -alpha);
            if sc > local_best {
                local_best = sc;
                local_move = Some(m);
            }
            if local_best > alpha {
                alpha = local_best;
            }
        }

        best = local_move;
        score = local_best;
        if let Some(m) = best {
            s.tt.store(zobrist(b), d, to_tt(score, 0), Bound::Exact, m);
        }
        if score.abs() >= MATE_THRESHOLD {
            break;
        }
    }

    SearchResult { best, score, nodes: s.nodes, depth: max_depth }
}

/// Does `side` have a piece other than pawns (and the king)? Null-move pruning is
/// unsafe without one (zugzwang), so we gate on it.
fn has_non_pawn_material(b: &Board, side: Color) -> bool {
    b.squares.iter().flatten().any(|p| p.color == side && p.kind != PieceKind::Pawn && p.kind != PieceKind::King)
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
