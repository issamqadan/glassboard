//! The strategy layer — context-aware, multi-step **plans** (not just single
//! moves). Given a position it detects the game phase, scores a library of named
//! strategies by how well they fit the board *right now*, and returns the top
//! few for the assisted side to choose from — each with a visual plan (arrows +
//! target squares), a step tracker, and a concrete first move. Plus an
//! opponent-intent read. All deterministic (measurable); LLM phrasing can come
//! later. Nothing here is hidden — the chosen plan is glass-box like all help.

use crate::to_uci;
use engine::*;

/// How a plan arrow reads on the board.
#[derive(Clone, Copy, Debug)]
pub enum ArrowKind {
    Dev,
    Attack,
    Support,
    Castle,
}
impl ArrowKind {
    pub fn tag(self) -> &'static str {
        match self {
            ArrowKind::Dev => "dev",
            ArrowKind::Attack => "attack",
            ArrowKind::Support => "support",
            ArrowKind::Castle => "castle",
        }
    }
}

#[derive(Clone, Debug)]
pub struct PlanArrow {
    pub from: Square,
    pub to: Square,
    pub kind: ArrowKind,
}
#[derive(Clone, Debug)]
pub struct PlanStep {
    pub text: String,
    pub done: bool,
}

/// A named, context-fitted plan.
#[derive(Clone, Debug)]
pub struct Strategy {
    pub id: &'static str,
    pub name: String,
    pub idea: String,
    /// How well this plan fits the current position (higher = better).
    pub fit: i32,
    pub arrows: Vec<PlanArrow>,
    pub rings: Vec<Square>,
    pub steps: Vec<PlanStep>,
    pub move_uci: String,
    pub move_san: String,
    pub move_note: String,
}

#[derive(Clone, Debug)]
pub struct StrategyRead {
    pub phase: &'static str,
    /// Top strategies by fit (already sorted, best first).
    pub strategies: Vec<Strategy>,
    /// What the opponent seems to be doing / threatening.
    pub opponent: Option<String>,
}

// ---- board-reading helpers ----

fn minor_home(color: Color) -> [Square; 4] {
    match color {
        Color::White => [1, 6, 2, 5],   // b1, g1, c1, f1
        Color::Black => [57, 62, 58, 61], // b8, g8, c8, f8
    }
}
fn undeveloped(b: &Board, color: Color, kinds: &[PieceKind]) -> i32 {
    let mut n = 0;
    for &sq in minor_home(color).iter() {
        if let Some(p) = b.squares[sq as usize] {
            if p.color == color && kinds.contains(&p.kind) {
                n += 1;
            }
        }
    }
    n
}
fn king_home(color: Color) -> Square {
    if color == Color::White { 4 } else { 60 }
}
fn is_castled(b: &Board, color: Color) -> bool {
    let k = king_square(b, color);
    match color {
        Color::White => k == 6 || k == 2,
        Color::Black => k == 62 || k == 58,
    }
}
fn count_all(b: &Board, kind: PieceKind) -> i32 {
    b.squares.iter().flatten().filter(|p| p.kind == kind).count() as i32
}
fn nonking_material(b: &Board, color: Color) -> i32 {
    b.squares
        .iter()
        .flatten()
        .filter(|p| p.color == color && p.kind != PieceKind::King)
        .map(|p| material(p.kind))
        .sum()
}
/// Enemy pieces we attack that they leave undefended — free to win.
fn loose_enemy(b: &Board, side: Color) -> Vec<Square> {
    let opp = side.opp();
    (0..64u8)
        .filter(|&s| match b.squares[s as usize] {
            Some(p) => {
                p.color == opp
                    && p.kind != PieceKind::King
                    && is_attacked(b, s, side)
                    && !is_attacked(b, s, opp)
            }
            None => false,
        })
        .collect()
}
/// Our pieces the opponent attacks and we don't defend — under threat.
fn own_hanging(b: &Board, side: Color) -> Vec<Square> {
    (0..64u8)
        .filter(|&s| match b.squares[s as usize] {
            Some(p) => {
                p.color == side
                    && p.kind != PieceKind::King
                    && is_attacked(b, s, side.opp())
                    && !is_attacked(b, s, side)
            }
            None => false,
        })
        .collect()
}
fn passed_pawns(b: &Board, color: Color) -> Vec<Square> {
    let mut out = Vec::new();
    for s in 0..64u8 {
        match b.squares[s as usize] {
            Some(p) if p.color == color && p.kind == PieceKind::Pawn => {
                let f = file_of(s);
                let r = rank_of(s);
                let mut blocked = false;
                for es in 0..64u8 {
                    if let Some(ep) = b.squares[es as usize] {
                        if ep.color == color.opp() && ep.kind == PieceKind::Pawn {
                            let ef = file_of(es);
                            let er = rank_of(es);
                            let ahead = if color == Color::White { er > r } else { er < r };
                            if (ef - f).abs() <= 1 && ahead {
                                blocked = true;
                                break;
                            }
                        }
                    }
                }
                if !blocked {
                    out.push(s);
                }
            }
            _ => {}
        }
    }
    out
}
fn phase(b: &Board) -> &'static str {
    let queens = count_all(b, PieceKind::Queen);
    let heavy_minor = count_all(b, PieceKind::Rook)
        + count_all(b, PieceKind::Knight)
        + count_all(b, PieceKind::Bishop);
    let undev = undeveloped(b, Color::White, &[PieceKind::Knight, PieceKind::Bishop])
        + undeveloped(b, Color::Black, &[PieceKind::Knight, PieceKind::Bishop]);
    if b.fullmove <= 10 && undev >= 4 {
        "opening"
    } else if (queens == 0 && heavy_minor <= 6) || heavy_minor <= 4 {
        "endgame"
    } else {
        "middlegame"
    }
}

fn pick(ranked: &[(Move, i32)], pred: impl Fn(&Move) -> bool) -> Option<Move> {
    ranked.iter().map(|(m, _)| *m).find(|m| pred(m))
}
fn kind_at(b: &Board, sq: Square) -> Option<PieceKind> {
    b.squares[sq as usize].map(|p| p.kind)
}
fn piece_word(k: PieceKind) -> &'static str {
    match k {
        PieceKind::Pawn => "pawn",
        PieceKind::Knight => "knight",
        PieceKind::Bishop => "bishop",
        PieceKind::Rook => "rook",
        PieceKind::Queen => "queen",
        PieceKind::King => "king",
    }
}

/// Detect strategies for the side to move, using pre-ranked moves (best first).
pub fn strategize(b: &Board, ranked: &[(Move, i32)]) -> StrategyRead {
    let ph = phase(b);
    let side = b.side;
    let opp = side.opp();
    let mut out: Vec<Strategy> = Vec::new();

    if ranked.is_empty() {
        return StrategyRead { phase: ph, strategies: out, opponent: None };
    }
    let top = ranked[0].0;
    let castle_mv = pick(ranked, |m| m.flag == Flag::Castle);
    let opp_king = king_square(b, opp);

    let mk = |id, name: &str, idea: &str, fit, rec: Move, note: String,
              arrows: Vec<PlanArrow>, rings: Vec<Square>, steps: Vec<PlanStep>|
     -> Strategy {
        Strategy {
            id,
            name: name.to_string(),
            idea: idea.to_string(),
            fit,
            arrows,
            rings,
            steps,
            move_uci: to_uci(rec),
            move_san: san(b, rec),
            move_note: note,
        }
    };
    let step = |text: &str, done: bool| PlanStep { text: text.to_string(), done };

    // --- Win the loose piece (tactics first) ---
    let loose = loose_enemy(b, side);
    if let Some(&target) = loose
        .iter()
        .max_by_key(|&&s| kind_at(b, s).map(material).unwrap_or(0))
    {
        // A capture of that square, if we have one ranked.
        if let Some(cap) = pick(ranked, |m| m.to == target) {
            let vk = kind_at(b, target).map(piece_word).unwrap_or("piece");
            out.push(mk(
                "win_material",
                "Win the loose piece",
                "Your opponent left a piece undefended — take it and bank the material.",
                90,
                cap,
                format!("Captures the undefended {vk} — free material."),
                vec![PlanArrow { from: cap.from, to: cap.to, kind: ArrowKind::Attack }],
                vec![target],
                vec![
                    step("Take the loose piece", false),
                    step("Consolidate — get safe", false),
                    step("Convert your extra material", false),
                ],
            ));
        }
    }

    // --- Develop & Castle (opening) ---
    let undev_kn = undeveloped(b, side, &[PieceKind::Knight]);
    let undev_bi = undeveloped(b, side, &[PieceKind::Bishop]);
    let castled = is_castled(b, side);
    if undev_kn + undev_bi > 0 || (!castled && castle_mv.is_some()) {
        let mut fit = 30 + 12 * (undev_kn + undev_bi);
        if !castled && castle_mv.is_some() {
            fit += 22;
        }
        if ph == "opening" {
            fit += 15;
        }
        let rec = pick(ranked, |m| develops(b, m, side))
            .or(castle_mv)
            .unwrap_or(top);
        let mut arrows = vec![PlanArrow {
            from: rec.from,
            to: rec.to,
            kind: if rec.flag == Flag::Castle { ArrowKind::Castle } else { ArrowKind::Dev },
        }];
        let mut rings = vec![rec.to];
        if rec.flag != Flag::Castle {
            if let Some(c) = castle_mv {
                arrows.push(PlanArrow { from: c.from, to: c.to, kind: ArrowKind::Castle });
                rings.push(c.to);
            }
        }
        let note = if rec.flag == Flag::Castle {
            "Castles — your king reaches safety and your rook joins the game.".to_string()
        } else {
            format!(
                "Develops your {} — a piece into the game, part of the plan.",
                kind_at(b, rec.from).map(piece_word).unwrap_or("piece")
            )
        };
        out.push(mk(
            "develop",
            "Develop & Castle",
            "Get your last pieces into the game and tuck your king away — the #1 opening priority.",
            fit,
            rec,
            note,
            arrows,
            rings,
            vec![
                step("Develop your knights", undev_kn == 0),
                step("Develop your bishops", undev_bi == 0),
                step("Castle your king", castled),
            ],
        ));
    }

    // --- Seize the Centre (opening / early middlegame) ---
    if ph != "endgame" {
        let center = [27u8, 28, 35, 36]; // d4 e4 d5 e5
        let own_center = center
            .iter()
            .filter(|&&s| matches!(b.squares[s as usize], Some(p) if p.color == side && p.kind == PieceKind::Pawn))
            .count() as i32;
        if own_center < 2 {
            if let Some(rec) = pick(ranked, |m| center_push(b, m)) {
                out.push(mk(
                    "center",
                    "Seize the Centre",
                    "Plant a pawn in the middle — central space cramps your opponent and frees your pieces.",
                    28 + (2 - own_center) * 8 + if ph == "opening" { 10 } else { 0 },
                    rec,
                    "Stakes a claim in the centre — the pawn there controls key squares.".to_string(),
                    vec![PlanArrow { from: rec.from, to: rec.to, kind: ArrowKind::Dev }],
                    center.iter().copied().filter(|&s| s == rec.to).collect(),
                    vec![
                        step("Put a pawn in the centre", own_center > 0),
                        step("Support it with pieces/pawns", false),
                        step("Contest your opponent's centre", false),
                    ],
                ));
            }
        }
    }

    // --- Attack the King (middlegame, exposed enemy king) ---
    if ph == "middlegame" {
        let opp_castled = is_castled(b, opp);
        let opp_home = king_square(b, opp) == king_home(opp);
        let my_developed = 4 - undeveloped(b, side, &[PieceKind::Knight, PieceKind::Bishop]);
        if (!opp_castled || opp_home) && my_developed >= 2 {
            let rec = pick(ranked, |m| toward_king(m, opp_king)).unwrap_or(top);
            out.push(mk(
                "attack_king",
                "Attack the King",
                "Their king is exposed in the centre — throw your pieces at it before they get safe.",
                34 + if opp_home { 24 } else { 0 } + my_developed * 3,
                rec,
                "Brings a piece toward the enemy king — building the attack.".to_string(),
                vec![PlanArrow { from: rec.from, to: rec.to, kind: ArrowKind::Attack }],
                vec![opp_king],
                vec![
                    step("Aim pieces at the enemy king", false),
                    step("Open a line to it", false),
                    step("Break through", false),
                ],
            ));
        }
    }

    // --- Simplify — you're ahead (material lead) ---
    let lead = nonking_material(b, side) - nonking_material(b, opp);
    if lead >= 200 && ph != "opening" {
        // Prefer an equal trade (a capture) to reduce material while ahead.
        let rec = pick(ranked, |m| b.squares[m.to as usize].is_some()).unwrap_or(top);
        out.push(mk(
            "simplify",
            "Simplify — you're ahead",
            "You're up material — trade pieces (not pawns) to steer toward an easily winning endgame.",
            26 + lead / 120,
            rec,
            "Trades pieces down — every swap makes your extra material count for more.".to_string(),
            vec![PlanArrow { from: rec.from, to: rec.to, kind: ArrowKind::Support }],
            vec![rec.to],
            vec![
                step("Trade pieces, keep pawns", false),
                step("Avoid complications", false),
                step("Reach a winning endgame", false),
            ],
        ));
    }

    // --- Push the Passed Pawn (endgame) ---
    if ph == "endgame" {
        let passers = passed_pawns(b, side);
        if !passers.is_empty() {
            if let Some(rec) = pick(ranked, |m| passers.contains(&m.from) && forward_pawn(b, m, side)) {
                let promo_file = file_of(rec.to);
                let promo_sq = if side == Color::White { (56 + promo_file) as u8 } else { promo_file as u8 };
                out.push(mk(
                    "passer",
                    "Push the Passed Pawn",
                    "You have a pawn no enemy pawn can stop — march it toward promotion.",
                    40,
                    rec,
                    "Advances your passed pawn — one step closer to a new queen.".to_string(),
                    vec![PlanArrow { from: rec.from, to: rec.to, kind: ArrowKind::Dev }],
                    vec![promo_sq],
                    vec![
                        step("Advance the passed pawn", false),
                        step("Support it with your king/rook", false),
                        step("Promote to a queen", false),
                    ],
                ));
            }
        }
    }

    out.sort_by(|a, b| b.fit.cmp(&a.fit));
    out.truncate(3);

    StrategyRead { phase: ph, strategies: out, opponent: opponent_read(b, side) }
}

fn develops(b: &Board, m: &Move, color: Color) -> bool {
    b.squares[m.from as usize]
        .map(|p| (p.kind == PieceKind::Knight || p.kind == PieceKind::Bishop) && minor_home(color).contains(&m.from))
        .unwrap_or(false)
}
fn center_push(b: &Board, m: &Move) -> bool {
    b.squares[m.from as usize].map(|p| p.kind == PieceKind::Pawn).unwrap_or(false)
        && [27u8, 28, 35, 36].contains(&m.to)
}
fn toward_king(m: &Move, opp_king: Square) -> bool {
    let df = (file_of(m.to) - file_of(opp_king)).abs();
    let dr = (rank_of(m.to) - rank_of(opp_king)).abs();
    df.max(dr) <= 2 && !(df == 0 && dr == 0)
}
fn forward_pawn(b: &Board, m: &Move, color: Color) -> bool {
    b.squares[m.from as usize].map(|p| p.kind == PieceKind::Pawn).unwrap_or(false)
        && if color == Color::White {
            rank_of(m.to) > rank_of(m.from)
        } else {
            rank_of(m.to) < rank_of(m.from)
        }
}

/// A plain read of what the opponent is doing — their most salient plan/threat.
fn opponent_read(b: &Board, side: Color) -> Option<String> {
    // Most urgent: one of our pieces is hanging → they're threatening it.
    let hanging = own_hanging(b, side);
    if let Some(&s) = hanging
        .iter()
        .max_by_key(|&&s| kind_at(b, s).map(material).unwrap_or(0))
    {
        let w = kind_at(b, s).map(piece_word).unwrap_or("piece");
        return Some(format!(
            "Your opponent is threatening your {w} on {} — defend it or move it.",
            sq_to_algebraic(s)
        ));
    }
    // Their king is stuck in the centre → they're behind on safety.
    let opp = side.opp();
    if king_square(b, opp) == king_home(opp)
        && phase(b) == "middlegame"
    {
        return Some("Your opponent hasn't castled — their king is exposed in the centre.".to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine::fen::parse_fen;

    fn ranked(b: &Board) -> Vec<(Move, i32)> {
        rank_moves(b, 3)
    }

    #[test]
    fn opening_offers_development() {
        // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6, White to move.
        let b = parse_fen("r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
        let s = strategize(&b, &ranked(&b));
        assert_eq!(s.phase, "opening");
        assert!(s.strategies.iter().any(|x| x.id == "develop" || x.id == "center"));
        // every strategy carries a concrete first move
        assert!(s.strategies.iter().all(|x| !x.move_san.is_empty()));
    }

    #[test]
    fn free_piece_is_top_plan() {
        // White rook on d1, Black queen undefended on d5 → win the loose piece.
        let b = parse_fen("4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1");
        let s = strategize(&b, &ranked(&b));
        assert_eq!(s.strategies.first().map(|x| x.id), Some("win_material"));
    }
}
