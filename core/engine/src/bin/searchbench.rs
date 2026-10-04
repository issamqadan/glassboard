//! Measure what one search actually costs, so latency claims are measured and not
//! guessed. Used 2026-10-04 to size the per-move search budget in the web shell:
//! the shell queues several searches per move on ONE worker, so the queue depth
//! times this number is the lag the player feels.
//!
//!   cargo run --release -p glassboard-engine --bin searchbench
use engine::*;
use std::time::Instant;

const POSITIONS: [(&str, &str); 4] = [
    ("opening",    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"),
    ("early",      "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"),
    ("middlegame", "r2q1rk1/pp1bbppp/2np1n2/2p1p3/2B1P3/2NP1N2/PPPQ1PPP/R1B2RK1 w - - 0 10"),
    ("endgame",    "8/5pk1/6p1/4P3/3K1P2/8/8/8 w - - 0 40"),
];

fn main() {
    println!("{:<12} {:>9} {:>9} {:>9}", "position", "depth 3", "depth 4", "depth 5");
    let mut tot = [0f64; 3];
    for (name, fen) in POSITIONS {
        let mut row = [0f64; 3];
        for (i, d) in [3u32, 4, 5].into_iter().enumerate() {
            let b = parse_fen(fen);
            let t = Instant::now();
            let _ = search(&b, d);
            row[i] = t.elapsed().as_secs_f64() * 1000.0;
            tot[i] += row[i];
        }
        println!("{:<12} {:>8.0}ms {:>8.0}ms {:>8.0}ms", name, row[0], row[1], row[2]);
    }
    let n = POSITIONS.len() as f64;
    println!("{:<12} {:>8.0}ms {:>8.0}ms {:>8.0}ms   <- native mean", "MEAN", tot[0]/n, tot[1]/n, tot[2]/n);
    println!("\nWASM in a browser worker is slower than native; treat these as a floor.");
}
