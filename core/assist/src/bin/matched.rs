//! Glassboard "Matched" mode CLI — makes the M3 assistance layer tangible.
//!
//! You play White (the assisted, typically weaker side); the engine plays Black
//! (the stronger opponent). The Assistance-Handicap is computed from the two
//! ratings, and on every one of your turns you see the assistance for your rung
//! plus the running glass-box log — the same transparent record both players
//! see. At the Autopilot rung the co-pilot plays for you (still logged), so a
//! large-gap game runs on its own.
//!
//! Usage:
//!   cargo run -p glassboard-assist --bin matched -- [your_elo] [engine_elo] [depth] [max_plies]
//!
//! Enter moves in coordinate notation: e2e4, g1f3, e7e8q. Type `quit` to exit.

use assist::*;
use engine::*;
use std::env;
use std::io::{self, Write};

const HUMAN: Color = Color::White;

fn main() {
    let a: Vec<String> = env::args().collect();
    let human_elo: i32 = a.get(1).and_then(|s| s.parse().ok()).unwrap_or(1200);
    let engine_elo: i32 = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(2000);
    let depth: u32 = a.get(3).and_then(|s| s.parse().ok()).unwrap_or(3);
    let max_plies: u32 = a.get(4).and_then(|s| s.parse().ok()).unwrap_or(300);

    let level = recommended_level(engine_elo, human_elo);
    let gap = (engine_elo - human_elo).max(0);
    println!("Glassboard — Matched mode");
    println!(
        "You (White) {human_elo}  vs  Engine (Black) {engine_elo}   gap {gap}  →  assistance = {level:?}\n"
    );

    let mut board = Board::startpos();
    let mut glass = GlassBox::new();
    print_board(&board);

    for ply in 0..max_plies {
        if let Some(msg) = terminal_message(&board) {
            println!("\n{msg}");
            break;
        }

        if board.side == HUMAN {
            let a = analyze(&board, level, depth);
            glass.record(ply, HUMAN, &a, &board);
            print_assistance(&a);
            print_glassbox(&glass);

            if level == AssistLevel::Autopilot {
                let m = a.autoplay.expect("autopilot move");
                println!("\n[autopilot] plays {}", to_uci(m));
                board.make_move(m);
            } else {
                match read_human_move(&board) {
                    Some(m) => board.make_move(m),
                    None => {
                        println!("\n(end of input) — goodbye");
                        return;
                    }
                }
            }
            print_board(&board);
        } else {
            let r = search(&board, depth);
            let m = r.best.expect("legal move");
            println!("\nEngine (Black, unassisted) plays {}   (score {:+})", to_uci(m), r.score);
            board.make_move(m);
            print_board(&board);
        }
    }
}

/// Read a legal move from stdin, or `None` on EOF/`quit`.
fn read_human_move(board: &Board) -> Option<Move> {
    let legal = generate_legal(board);
    loop {
        print!("\nYour move (e.g. e2e4): ");
        io::stdout().flush().ok();
        let mut line = String::new();
        if io::stdin().read_line(&mut line).unwrap_or(0) == 0 {
            return None;
        }
        let input = line.trim();
        if input == "quit" {
            return None;
        }
        if let Some(m) = parse_move(input, &legal) {
            return Some(m);
        }
        println!("illegal or unrecognized move: {input:?}");
    }
}

fn print_assistance(a: &Assistance) {
    println!("\n┌─ Assistance ({:?}) ─ shown only to the assisted player", a.level);
    if a.level >= AssistLevel::Awareness {
        if a.in_check {
            println!("│  ⚠ you are in check");
        }
        if a.hanging.is_empty() {
            println!("│  no hanging pieces");
        } else {
            let sqs: Vec<String> = a.hanging.iter().map(|s| sq_to_algebraic(*s)).collect();
            println!("│  ⚠ hanging: {}", sqs.join(", "));
        }
    }
    if a.level >= AssistLevel::Coaching {
        for m in &a.messages {
            println!("│  • {m}");
        }
    }
    if a.level >= AssistLevel::Suggestion && !a.candidates.is_empty() {
        println!("│  candidate moves:");
        for c in &a.candidates {
            println!("│    {} ({:+})", c.uci, c.score);
        }
    }
    if a.level >= AssistLevel::Guided {
        if let Some(b) = &a.best {
            println!("│  ➤ recommended: {} ({:+})", b.uci, b.score);
        }
    }
    println!("└─");
}

fn print_glassbox(g: &GlassBox) {
    println!("\n╔═ Glass-box ═ visible to BOTH players");
    if g.is_empty() {
        println!("║  (no assistance used yet)");
    } else {
        for e in g.events() {
            println!("║  ply {:>3} · {:?} · {}", e.ply, e.for_side, e.summary);
        }
    }
    println!("╚═");
}

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
    println!("   a b c d e f g h   ({:?} to move)", b.side);
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

fn to_uci(m: Move) -> String {
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
    let b = s.as_bytes();
    if b.len() != 2 {
        return None;
    }
    let file = b[0].wrapping_sub(b'a');
    let rank = b[1].wrapping_sub(b'1');
    if file < 8 && rank < 8 {
        Some(sq(file as i32, rank as i32))
    } else {
        None
    }
}
