//! Perft correctness tests against the standard reference positions.
//!
//! The default suite uses moderate depths so `cargo test` stays fast. The
//! deeper (multi-million-node) checks are `#[ignore]`d; run them in release:
//!
//! ```text
//! cargo test --release -- --ignored
//! ```

use engine::{parse_fen, perft, to_fen, Board, STARTPOS_FEN};

// The six canonical perft positions.
const STARTPOS: &str = STARTPOS_FEN;
const KIWIPETE: &str = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
const POS3: &str = "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1";
const POS4: &str = "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1";
const POS5: &str = "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8";
const POS6: &str = "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10";

fn check(fen: &str, depth: u32, expected: u64) {
    let b = parse_fen(fen);
    let got = perft(&b, depth);
    assert_eq!(
        got, expected,
        "perft({depth}) mismatch for {fen:?}: got {got}, expected {expected}"
    );
}

#[test]
fn fen_round_trips() {
    for fen in [STARTPOS, KIWIPETE, POS3, POS4, POS5, POS6] {
        assert_eq!(to_fen(&parse_fen(fen)), fen, "FEN round-trip failed");
    }
}

#[test]
fn perft_startpos() {
    check(STARTPOS, 1, 20);
    check(STARTPOS, 2, 400);
    check(STARTPOS, 3, 8_902);
    check(STARTPOS, 4, 197_281);
}

#[test]
fn perft_kiwipete() {
    check(KIWIPETE, 1, 48);
    check(KIWIPETE, 2, 2_039);
    check(KIWIPETE, 3, 97_862);
}

#[test]
fn perft_pos3() {
    check(POS3, 1, 14);
    check(POS3, 2, 191);
    check(POS3, 3, 2_812);
    check(POS3, 4, 43_238);
}

#[test]
fn perft_pos4() {
    check(POS4, 1, 6);
    check(POS4, 2, 264);
    check(POS4, 3, 9_467);
}

#[test]
fn perft_pos5() {
    check(POS5, 1, 44);
    check(POS5, 2, 1_486);
    check(POS5, 3, 62_379);
}

#[test]
fn perft_pos6() {
    check(POS6, 1, 46);
    check(POS6, 2, 2_079);
    check(POS6, 3, 89_890);
}

// --- deep checks: run with `cargo test --release -- --ignored` --------------

#[test]
#[ignore = "deep perft; run in release with --ignored"]
fn perft_deep() {
    check(STARTPOS, 5, 4_865_609);
    check(STARTPOS, 6, 119_060_324);
    check(KIWIPETE, 4, 4_085_603);
    check(POS3, 5, 674_624);
    check(POS4, 4, 422_333);
    check(POS5, 4, 2_103_487);
    check(POS6, 4, 3_894_594);
}

// Silence unused-import warning when only the deep test references Board.
#[allow(dead_code)]
fn _uses_board() -> Board {
    Board::startpos()
}
