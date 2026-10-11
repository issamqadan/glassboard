//! Verify can_mate() against the positions FIDE 6.9 actually turns on: when a
//! player flags, can their opponent mate AT ALL? Getting this wrong turns a draw
//! into a loss (or the reverse) at the most painful possible moment.
//!
//!   cargo run --release -p glassboard-engine --bin matebench
use engine::*;

fn main() {
    let cases: [(&str, Color, bool, &str); 10] = [
        ("8/8/4k3/8/8/4K3/8/8 w - - 0 1",            Color::White, false, "bare king"),
        ("8/8/4k3/8/8/4K3/8/7N w - - 0 1",           Color::White, false, "K+N cannot mate"),
        ("8/8/4k3/8/8/4K3/8/7B w - - 0 1",           Color::White, false, "K+B cannot mate"),
        ("8/8/4k3/8/8/4K3/8/6NN w - - 0 1",          Color::White, true,  "K+N+N can (helpmate)"),
        ("8/8/4k3/8/8/4K3/8/6BB w - - 0 1",          Color::White, true,  "K+B+B can"),
        ("8/8/4k3/8/8/4K3/8/6BN w - - 0 1",          Color::White, true,  "K+B+N can"),
        ("8/8/4k3/8/8/4K3/P7/8 w - - 0 1",           Color::White, true,  "a pawn promotes"),
        ("8/8/4k3/8/8/4K3/8/R7 w - - 0 1",           Color::White, true,  "a rook mates"),
        ("8/8/4k3/8/8/4K3/8/Q7 w - - 0 1",           Color::White, true,  "a queen mates"),
        ("7b/8/4k3/8/8/4K3/8/7B w - - 0 1",          Color::Black, false, "the OTHER side's bishop doesn't count"),
    ];
    let mut bad = 0;
    for (fen, side, want, why) in cases {
        let b = parse_fen(fen);
        let got = can_mate(&b, side);
        let ok = got == want;
        if !ok {
            bad += 1;
        }
        println!("  {:<5} {:<34} {:?} can mate = {:<5} {}",
                 if ok { "ok" } else { "FAIL" }, why, side, got, if ok { "" } else { "<-- WRONG" });
    }
    // A real endgame: Black flags with only a king; White has K+B only -> DRAW.
    let b = parse_fen("8/8/8/4k3/8/8/8/4KB2 w - - 0 1");
    println!("\n  flag-fall adjudication:");
    println!("    Black flags, White has K+B  -> {}", if can_mate(&b, Color::White) { "White wins" } else { "DRAW (correct)" });
    let b2 = parse_fen("8/8/8/4k3/8/8/8/4KR2 w - - 0 1");
    println!("    Black flags, White has K+R  -> {}", if can_mate(&b2, Color::White) { "White wins (correct)" } else { "DRAW" });
    println!("\n{}", if bad == 0 { "all cases correct" } else { "FAILURES: see above" });
    std::process::exit(if bad == 0 { 0 } else { 1 });
}
