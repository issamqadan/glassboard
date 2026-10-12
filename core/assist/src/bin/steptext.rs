//! Verify that a half-finished objective visibly moves. "Develop your knights"
//! was `done` only when BOTH knights were out, so after 1.Nc3 the plan still read
//! 0/3 and the strategy appeared to be following nothing.
//!
//!   cargo run --release -p glassboard-assist --bin steptext
use engine::*;

fn main() {
    let cases = [
        ("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "start, no knights out"),
        // White to move in every case: strategize() reads the plan for the SIDE TO
        // MOVE, so a 'b' here would have been testing Black's development instead.
        ("rnbqkbnr/pppppppp/8/8/8/2N5/PPPPPPPP/R1BQKBNR w KQkq - 1 2", "ONE knight out (after Nc3)"),
        ("rnbqkbnr/pppppppp/8/8/8/2N2N2/PPPPPPPP/R1BQKB1R w KQkq - 1 3", "both knights out"),
        ("rnbqkbnr/pppppppp/8/8/8/2N2N2/PPPPPPPP/R1BQ1RK1 w kq - 1 5", "knights out and castled"),
    ];
    for (fen, label) in cases {
        let b = parse_fen(fen);
        // strategize() takes the ranked move list the engine would hand it; a
        // shallow rank is enough here — we are checking the step TEXT, not the move.
        let ranked = rank_moves(&b, 2);
        let read = assist::strategy::strategize(&b, &ranked);
        let dev = read.strategies.iter().find(|s| s.id == "develop");
        match dev {
            Some(s) => {
                let done = s.steps.iter().filter(|x| x.done).count();
                println!("  {:<34} {}/{}", label, done, s.steps.len());
                for st in &s.steps {
                    println!("       {} {}", if st.done { "[x]" } else { "[ ]" }, st.text);
                }
            }
            None => println!("  {:<34} (develop plan not offered here)", label),
        }
    }
}
