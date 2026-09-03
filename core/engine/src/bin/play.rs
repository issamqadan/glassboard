//! Glassboard terminal CLI (Milestone "A"): play the engine, or watch it play
//! itself. Pure Rust — a quick, playable front-end over the M0/M1 core that
//! doubles as a manual test harness before the WASM/web shell (M2).
//!
//! Usage:
//!   cargo run -p glassboard-engine --bin play -- play [depth] [white|black]
//!   cargo run -p glassboard-engine --bin play -- selfplay [depth] [max_plies]
//!
//! In `play`, enter moves in coordinate notation: `e2e4`, `g1f3`, `e7e8q`
//! (promotion piece appended). Type `quit` to exit.

use engine::*;
use std::env;
use std::io::{self, Write};

fn main() {
    let args: Vec<String> = env::args().collect();
    let mode = args.get(1).map(String::as_str).unwrap_or("selfplay");
    let depth: u32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(4);

    match mode {
        "selfplay" => {
            let max_plies: u32 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(200);
            self_play(depth, max_plies);
        }
        "play" => {
            let human = match args.get(3).map(String::as_str) {
                Some(s) if s.starts_with('b') => Color::Black,
                _ => Color::White,
            };
            human_vs_engine(depth, human);
        }
        other => {
            eprintln!("unknown mode {other:?}; use `play` or `selfplay`");
        }
    }
}

fn self_play(depth: u32, max_plies: u32) {
    println!("Glassboard self-play — depth {depth}, up to {max_plies} plies\n");
    let mut b = Board::startpos();
    print_board(&b);

    for ply in 0..max_plies {
        if let Some(msg) = terminal_message(&b) {
            println!("\n{msg}");
            return;
        }
        let r = search(&b, depth);
        let m = r.best.expect("legal move exists");
        let mover = b.side;
        b.make_move(m);
        println!(
            "\nmove {}: {:?} plays {}   (score {:+}, {} nodes)",
            ply / 2 + 1,
            mover,
            move_to_uci(m),
            r.score,
            r.nodes
        );
        print_board(&b);
    }
    println!("\nReached the {max_plies}-ply cap — adjudicated draw.");
}

fn human_vs_engine(depth: u32, human: Color) {
    println!("You are {human:?}. Engine searches to depth {depth}. Type `quit` to exit.\n");
    let mut b = Board::startpos();
    print_board(&b);

    loop {
        if let Some(msg) = terminal_message(&b) {
            println!("\n{msg}");
            return;
        }

        if b.side == human {
            print!("\nYour move (e.g. e2e4, e7e8q): ");
            io::stdout().flush().ok();
            let mut line = String::new();
            if io::stdin().read_line(&mut line).unwrap_or(0) == 0 {
                println!("\n(end of input) — goodbye");
                return;
            }
            let input = line.trim();
            if input == "quit" {
                return;
            }
            let legal = generate_legal(&b);
            match parse_move(input, &legal) {
                Some(m) => {
                    b.make_move(m);
                    print_board(&b);
                }
                None => println!("illegal or unrecognized move: {input:?} — try again"),
            }
        } else {
            let r = search(&b, depth);
            let m = r.best.expect("legal move exists");
            println!("\nEngine plays {}   (score {:+})", move_to_uci(m), r.score);
            b.make_move(m);
            print_board(&b);
        }
    }
}

/// Returns a game-over message if `b` is terminal, else `None`.
fn terminal_message(b: &Board) -> Option<String> {
    if generate_legal(b).is_empty() {
        return Some(if in_check(b) {
            format!("Checkmate — {:?} wins.", b.side.opp())
        } else {
            "Stalemate — draw.".to_string()
        });
    }
    if b.halfmove >= 100 {
        return Some("Draw by the fifty-move rule.".to_string());
    }
    None
}

fn print_board(b: &Board) {
    println!();
    for rank in (0..8).rev() {
        print!("{}  ", rank + 1);
        for file in 0..8 {
            let ch = match b.squares[sq(file, rank) as usize] {
                Some(p) => piece_char(p),
                None => '.',
            };
            print!("{ch} ");
        }
        println!();
    }
    println!("   a b c d e f g h");
    println!("   {:?} to move", b.side);
}

fn piece_char(p: Piece) -> char {
    let c = match p.kind {
        PieceKind::Pawn => 'p',
        PieceKind::Knight => 'n',
        PieceKind::Bishop => 'b',
        PieceKind::Rook => 'r',
        PieceKind::Queen => 'q',
        PieceKind::King => 'k',
    };
    if p.color == Color::White {
        c.to_ascii_uppercase()
    } else {
        c
    }
}

fn move_to_uci(m: Move) -> String {
    let mut s = format!("{}{}", sq_to_algebraic(m.from), sq_to_algebraic(m.to));
    if let Some(k) = m.promo {
        s.push(match k {
            PieceKind::Knight => 'n',
            PieceKind::Bishop => 'b',
            PieceKind::Rook => 'r',
            PieceKind::Queen => 'q',
            _ => '?',
        });
    }
    s
}

fn parse_move(input: &str, legal: &[Move]) -> Option<Move> {
    if input.len() < 4 {
        return None;
    }
    let from = sq_from(&input[0..2])?;
    let to = sq_from(&input[2..4])?;
    let promo = input.chars().nth(4).and_then(|c| match c.to_ascii_lowercase() {
        'n' => Some(PieceKind::Knight),
        'b' => Some(PieceKind::Bishop),
        'r' => Some(PieceKind::Rook),
        'q' => Some(PieceKind::Queen),
        _ => None,
    });
    legal
        .iter()
        .copied()
        .find(|m| m.from == from && m.to == to && m.promo == promo)
}

fn sq_from(s: &str) -> Option<Square> {
    let bytes = s.as_bytes();
    if bytes.len() != 2 {
        return None;
    }
    let file = bytes[0].wrapping_sub(b'a');
    let rank = bytes[1].wrapping_sub(b'1');
    if file < 8 && rank < 8 {
        Some(sq(file as i32, rank as i32))
    } else {
        None
    }
}
