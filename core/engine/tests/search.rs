//! M1 acceptance: the engine must find known tactics and correctly recognize
//! terminal positions. These are the `strength-bench` seed checks — every
//! claim that the engine "plays" is backed here, not assumed.

use engine::{
    algebraic_to_sq, best_move, generate_legal, in_check, parse_fen, search, Board, MATE_THRESHOLD,
};

/// Mate in 1: the only mating move is Ra1-a8# (back-rank).
#[test]
fn finds_mate_in_one() {
    let b = parse_fen("6k1/5ppp/8/8/8/8/8/R6K w - - 0 1");
    let m = best_move(&b, 4).expect("a move exists");
    assert_eq!(m.from, algebraic_to_sq("a1"), "should move the a1 rook");
    assert_eq!(m.to, algebraic_to_sq("a8"), "…to a8 for mate");

    let r = search(&b, 4);
    assert!(
        r.score >= MATE_THRESHOLD,
        "should report a forced mate, got score {}",
        r.score
    );
}

/// Simple material win: the black queen on d4 hangs to Rd1xd4.
#[test]
fn wins_the_hanging_queen() {
    let b = parse_fen("4k3/8/8/8/3q4/8/8/3RK3 w - - 0 1");
    let m = best_move(&b, 4).expect("a move exists");
    assert_eq!(
        m.to,
        algebraic_to_sq("d4"),
        "should capture the undefended queen on d4"
    );
}

/// Checkmate detection: Black is mated (Ra8#, pawns block the escape).
#[test]
fn detects_checkmate() {
    let b = parse_fen("R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1");
    assert!(generate_legal(&b).is_empty(), "mated side has no legal moves");
    assert!(in_check(&b), "mated side is in check");

    let r = search(&b, 3);
    assert!(r.best.is_none(), "no move to return when mated");
    assert!(
        r.score <= -MATE_THRESHOLD,
        "mated side scores near -MATE, got {}",
        r.score
    );
}

/// Stalemate detection: Black to move has no legal move but is not in check.
#[test]
fn detects_stalemate() {
    let b = parse_fen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    assert!(generate_legal(&b).is_empty(), "stalemated side has no moves");
    assert!(!in_check(&b), "stalemated side is NOT in check");

    let r = search(&b, 3);
    assert!(r.best.is_none());
    assert_eq!(r.score, 0, "stalemate is a draw (score 0)");
}

/// Sanity: from the opening the engine returns a legal move at depth 4.
#[test]
fn plays_a_legal_opening_move() {
    let b = Board::startpos();
    let m = best_move(&b, 4).expect("engine returns a move");
    let legal = generate_legal(&b);
    assert!(legal.contains(&m), "returned move must be legal");
}
