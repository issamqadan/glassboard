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

/// Pawns of `color` that have no friendly pawn on an adjacent file (isolated).
fn isolated_of(b: &Board, color: Color) -> Vec<Square> {
    let mut has_file = [false; 8];
    for s in 0..64u8 {
        if let Some(p) = b.squares[s as usize] {
            if p.color == color && p.kind == PieceKind::Pawn {
                has_file[file_of(s) as usize] = true;
            }
        }
    }
    let mut out = Vec::new();
    for s in 0..64u8 {
        if let Some(p) = b.squares[s as usize] {
            if p.color == color && p.kind == PieceKind::Pawn {
                let f = file_of(s) as usize;
                let left = f > 0 && has_file[f - 1];
                let right = f < 7 && has_file[f + 1];
                if !left && !right {
                    out.push(s);
                }
            }
        }
    }
    out
}
fn open_file(b: &Board, file: i32) -> bool {
    !(0..64u8).any(|s| matches!(b.squares[s as usize], Some(p) if p.kind == PieceKind::Pawn && file_of(s) == file))
}
fn has_rook(b: &Board, color: Color) -> bool {
    b.squares.iter().flatten().any(|p| p.color == color && p.kind == PieceKind::Rook)
}
/// A bishop of `color` fianchettoed on g2/b2 (White) or g7/b7 (Black).
fn fianchetto_bishop(b: &Board, color: Color) -> Option<Square> {
    let sqs: [Square; 2] = if color == Color::White { [14, 9] } else { [54, 49] };
    sqs.into_iter()
        .find(|&s| matches!(b.squares[s as usize], Some(p) if p.color == color && p.kind == PieceKind::Bishop))
}
/// Is `sq` defended by one of `side`'s pawns (diagonally behind it)?
fn pawn_defends(b: &Board, sq: Square, side: Color) -> bool {
    let f = file_of(sq);
    let br = if side == Color::White { rank_of(sq) - 1 } else { rank_of(sq) + 1 };
    if !(0..8).contains(&br) {
        return false;
    }
    [-1i32, 1].into_iter().any(|df| {
        let nf = f + df;
        (0..8).contains(&nf)
            && matches!(b.squares[(br * 8 + nf) as usize], Some(p) if p.color == side && p.kind == PieceKind::Pawn)
    })
}
/// Could any enemy pawn ever advance to attack `sq`? (No → it's a true outpost.)
fn enemy_pawn_can_hit(b: &Board, sq: Square, side: Color) -> bool {
    let f = file_of(sq);
    let r = rank_of(sq);
    let opp = side.opp();
    for df in [-1i32, 1] {
        let nf = f + df;
        if !(0..8).contains(&nf) {
            continue;
        }
        for rr in 0..8i32 {
            let ahead = if side == Color::White { rr > r } else { rr < r };
            if ahead
                && matches!(b.squares[(rr * 8 + nf) as usize], Some(p) if p.color == opp && p.kind == PieceKind::Pawn)
            {
                return true;
            }
        }
    }
    false
}
/// Back-rank home squares of `color`'s pieces (skip the king) — a piece still
/// sitting here past the opening is likely the worst-placed one.
fn home_pieces(color: Color) -> [(Square, PieceKind); 7] {
    use PieceKind::*;
    if color == Color::White {
        [(0, Rook), (1, Knight), (2, Bishop), (3, Queen), (5, Bishop), (6, Knight), (7, Rook)]
    } else {
        [(56, Rook), (57, Knight), (58, Bishop), (59, Queen), (61, Bishop), (62, Knight), (63, Rook)]
    }
}
/// A protected, unassailable advanced square is a knight outpost.
fn is_outpost(b: &Board, sq: Square, side: Color) -> bool {
    let r = rank_of(sq);
    let advanced = if side == Color::White { r >= 4 } else { r <= 3 };
    advanced && pawn_defends(b, sq, side) && !enemy_pawn_can_hit(b, sq, side)
}

fn pick(ranked: &[(Move, i32)], pred: impl Fn(&Move) -> bool) -> Option<Move> {
    ranked.iter().map(|(m, _)| *m).find(|m| pred(m))
}

/// The best ranked move that serves the plan — but only if it's essentially as
/// good as the engine's best move (within ~0.4 pawns). A plan must never cost
/// material: a chessmaster follows a plan by playing the *best move consistent
/// with it*, not a worse "themed" move. If nothing thematic is near-best, we fall
/// back to the engine's best move (still sound; the plan's steps/arrows teach the
/// idea). This keeps "follow the plan" as strong as "play the best move".
const PLAN_SLACK: i32 = 40;
fn plan_move(ranked: &[(Move, i32)], top_score: i32, pred: impl Fn(&Move) -> bool) -> Move {
    ranked
        .iter()
        .find(|(m, s)| pred(m) && *s + PLAN_SLACK >= top_score)
        .map(|(m, _)| *m)
        .unwrap_or(ranked[0].0)
}
fn kind_at(b: &Board, sq: Square) -> Option<PieceKind> {
    b.squares[sq as usize].map(|p| p.kind)
}
/// Does `m` get us out of danger — i.e. after it, the worst material we can lose
/// drops below `threshold`? (Moved the piece to safety, defended it, or took the
/// attacker.) Used so the "save your piece" plan recommends a move that works.
fn move_saves(b: &Board, m: &Move, side: Color, threshold: i32) -> bool {
    let mut nb = *b;
    nb.make_move(*m);
    crate::threatened_pieces(&nb, side).first().map(|t| t.loss).unwrap_or(0) < threshold
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
    let top_score = ranked[0].1;
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

    // --- Safety first: save a piece under real threat (a chessmaster deals with
    // threats before pursuing plans). Highest fit so it leads when material is
    // genuinely at risk. The recommended move is already safety-reranked. ---
    if let Some(t) = crate::threatened_pieces(b, side).into_iter().next() {
        if t.loss >= 200 {
            let (sq, loss, word) = (t.square, t.loss, piece_word(t.kind));
            let rec = plan_move(ranked, top_score, |m| move_saves(b, m, side, loss));
            if move_saves(b, &rec, side, loss) {
                out.push(mk(
                    "save_piece",
                    &format!("Save your {word}"),
                    "A piece is under attack — get it safe (move it, defend it, or take the attacker) before anything else.",
                    96,
                    rec,
                    format!("Gets your {word} out of danger — safety comes first."),
                    vec![PlanArrow { from: rec.from, to: rec.to, kind: ArrowKind::Support }],
                    vec![sq],
                    vec![
                        step("Deal with the threat", false),
                        step("Get every piece safe and defended", false),
                        step("Then get on with your plan", false),
                    ],
                ));
            }
        }
    }

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
        let rec = plan_move(ranked, top_score, |m| develops(b, m, side) || m.flag == Flag::Castle);
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
            // Offer only if a *sound* central push exists (within the blunder guard).
            let rec = plan_move(ranked, top_score, |m| center_push(b, m));
            if center_push(b, &rec) {
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

    // --- Make a pawn break (proactive: open lines / relieve a cramp) ---
    if ph != "endgame" {
        let rec = plan_move(ranked, top_score, |m| pawn_break(b, m, side));
        if pawn_break(b, &rec, side) {
            out.push(mk(
                "pawn_break",
                "Make a pawn break",
                "Advance a pawn to challenge theirs — a break opens lines for your pieces and frees a cramped position.",
                32 + if ph == "middlegame" { 10 } else { 0 },
                rec,
                format!(
                    "Pushes to {} to challenge their pawns — prepares to open the position.",
                    sq_to_algebraic(rec.to)
                ),
                vec![PlanArrow { from: rec.from, to: rec.to, kind: ArrowKind::Attack }],
                vec![rec.to],
                vec![
                    step("Back the break with a piece or pawn", false),
                    step("Play the break", false),
                    step("Use the open line you created", false),
                ],
            ));
        }
    }

    // --- Attack the King (middlegame, exposed enemy king) ---
    if ph == "middlegame" {
        let opp_castled = is_castled(b, opp);
        let opp_home = king_square(b, opp) == king_home(opp);
        let my_developed = 4 - undeveloped(b, side, &[PieceKind::Knight, PieceKind::Bishop]);
        if (!opp_castled || opp_home) && my_developed >= 2 {
            let rec = plan_move(ranked, top_score, |m| toward_king(m, opp_king));
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
        let rec = plan_move(ranked, top_score, |m| b.squares[m.to as usize].is_some());
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
            let rec = plan_move(ranked, top_score, |m| passers.contains(&m.from) && forward_pawn(b, m, side));
            if passers.contains(&rec.from) && forward_pawn(b, &rec, side) {
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

    // --- Attack the isolated pawn (structural: opponent has an isolani) ---
    let opp_iso = isolated_of(b, opp);
    if let Some(&pawn) = opp_iso.iter().min_by_key(|&&s| (file_of(s) - 4).abs().min((file_of(s) - 3).abs())) {
        let block_sq = if opp == Color::White { pawn.saturating_add(8) } else { pawn.wrapping_sub(8) };
        let rec = plan_move(ranked, top_score, |m| m.to == pawn || m.to == block_sq);
        let mut rings = vec![pawn];
        if block_sq < 64 {
            rings.push(block_sq);
        }
        out.push(mk(
            "iso_attack",
            "Attack the isolated pawn",
            "Their pawn has no neighbour to defend it — blockade it with a knight, pile up, and win it.",
            44,
            rec,
            "Targets the weak isolated pawn — blockade it, then win it.".to_string(),
            vec![PlanArrow { from: rec.from, to: rec.to, kind: ArrowKind::Attack }],
            rings,
            vec![
                step("Blockade it with a knight", false),
                step("Pile up attackers on it", false),
                step("Win the weak pawn", false),
            ],
        ));
    }

    // --- Seize the open file (structural: a fully open file + a rook) ---
    if has_rook(b, side) {
        if let Some(file) = (0..8i32).find(|&f| open_file(b, f)) {
            let rec = plan_move(ranked, top_score, |m| kind_at(b, m.from) == Some(PieceKind::Rook) && file_of(m.to) == file);
            let fname = (b'a' + file as u8) as char;
            out.push(mk(
                "open_file",
                "Seize the open file",
                "An open file is a highway for your rooks — occupy it, double up, and invade.",
                33,
                rec,
                format!("Puts a rook on the open {fname}-file — control it and invade the 7th."),
                vec![PlanArrow { from: rec.from, to: rec.to, kind: ArrowKind::Support }],
                vec![rec.to],
                vec![
                    step("Put a rook on the open file", false),
                    step("Double your rooks", false),
                    step("Invade the 7th rank", false),
                ],
            ));
        }
    }

    // --- Kingside pawn storm (enemy king castled short, in the middlegame) ---
    if ph == "middlegame" {
        let kf = file_of(opp_king);
        let kr = rank_of(opp_king);
        let enemy_short = kf >= 5
            && ((side == Color::White && kr >= 6) || (side == Color::Black && kr <= 1));
        if enemy_short {
            let rec = pick(ranked, |m| {
                kind_at(b, m.from) == Some(PieceKind::Pawn) && file_of(m.from) >= 5 && forward_pawn(b, m, side)
            })
            .unwrap_or(top);
            out.push(mk(
                "pawn_storm",
                "Kingside pawn storm",
                "Their king is castled kingside — roll your g- and h-pawns up the board to tear open its cover.",
                36,
                rec,
                "Advances a kingside pawn — the storm that cracks their king open.".to_string(),
                vec![PlanArrow { from: rec.from, to: rec.to, kind: ArrowKind::Attack }],
                vec![opp_king],
                vec![
                    step("Advance your g/h pawns", false),
                    step("Pry open the king's cover", false),
                    step("Break through with your pieces", false),
                ],
            ));
        }
    }

    // --- The long diagonal (a fianchettoed bishop) ---
    if let Some(bsq) = fianchetto_bishop(b, side) {
        let rec = plan_move(ranked, top_score, |m| m.from == bsq);
        out.push(mk(
            "fianchetto",
            "The long diagonal",
            "Your fianchettoed bishop rakes the long diagonal — keep it open and aim it at their king.",
            29,
            rec,
            "Works the long diagonal — your bishop is a long-range sniper on their position.".to_string(),
            vec![PlanArrow { from: bsq, to: opp_king, kind: ArrowKind::Attack }],
            vec![opp_king],
            vec![
                step("Keep the long diagonal open", false),
                step("Aim the bishop at their king", false),
                step("Add pieces to the attack", false),
            ],
        ));
    }

    // --- Establish a knight outpost (a protected, unassailable advanced square) ---
    if ph != "opening" {
        let is_outpost_move = |m: &Move| {
            kind_at(b, m.from) == Some(PieceKind::Knight) && is_outpost(b, m.to, side)
        };
        let rec = plan_move(ranked, top_score, is_outpost_move);
        if is_outpost_move(&rec) {
            out.push(mk(
                "outpost",
                "Plant a knight outpost",
                "A knight on a protected square no pawn can chase is a monster — park it deep in their position.",
                42,
                rec,
                format!("Lands your knight on {} — a protected outpost that cramps their game.", sq_to_algebraic(rec.to)),
                vec![PlanArrow { from: rec.from, to: rec.to, kind: ArrowKind::Support }],
                vec![rec.to],
                vec![
                    step("Post the knight on the strong square", false),
                    step("Support it with a pawn", pawn_defends(b, rec.to, side)),
                    step("Use it to pressure weaknesses", false),
                ],
            ));
        }
    }

    // --- Rook to the 7th (a rook that can reach the 7th/2nd rank) ---
    if ph != "opening" && has_rook(b, side) {
        let seventh = if side == Color::White { 6 } else { 1 };
        let to_seventh = |m: &Move| kind_at(b, m.from) == Some(PieceKind::Rook) && rank_of(m.to) == seventh;
        let rec = plan_move(ranked, top_score, to_seventh);
        if to_seventh(&rec) {
            out.push(mk(
                "rook_seventh",
                "Rook to the 7th",
                "A rook on the 7th rank feasts on pawns and pins their king back — get one there.",
                39,
                rec,
                "Swings a rook to the 7th rank — it attacks pawns and traps their king.".to_string(),
                vec![PlanArrow { from: rec.from, to: rec.to, kind: ArrowKind::Attack }],
                vec![rec.to],
                vec![
                    step("Get a rook to the 7th rank", false),
                    step("Gobble the pawns there", false),
                    step("Double rooks on the 7th if you can", false),
                ],
            ));
        }
    }

    // --- Improve your worst piece (universal: activate a stuck piece) ---
    if ph != "opening" {
        let stuck = home_pieces(side).into_iter().find(|&(sq, k)| {
            matches!(b.squares[sq as usize], Some(p) if p.color == side && p.kind == k)
                && ranked.iter().any(|(m, _)| m.from == sq)
        });
        if let Some((sq, k)) = stuck {
            let rec = plan_move(ranked, top_score, |m| m.from == sq);
            if rec.from == sq {
                out.push(mk(
                    "improve",
                    "Improve your worst piece",
                    "The classic principle: find your least-active piece and give it a better square. Every piece should work.",
                    27,
                    rec,
                    format!("Activates your {} — it was sitting idle; bring it into the game.", piece_word(k)),
                    vec![PlanArrow { from: rec.from, to: rec.to, kind: ArrowKind::Dev }],
                    vec![rec.to],
                    vec![
                        step("Spot your least-active piece", false),
                        step("Find it a better square", false),
                        step("Get every piece working", false),
                    ],
                ));
            }
        }
    }

    out.sort_by(|a, b| b.fit.cmp(&a.fit));
    out.truncate(5); // present several plans so the player can choose one at any point

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
/// A pawn *break* (lever): a push that ends up attacking an enemy pawn — the
/// classic proactive way to open lines and break a cramped structure. (A capture
/// is a different plan; here we mean the push that creates the contact.)
fn pawn_break(b: &Board, m: &Move, color: Color) -> bool {
    if !forward_pawn(b, m, color) || b.squares[m.to as usize].is_some() {
        return false; // must be a quiet push, not a capture
    }
    let f = file_of(m.to);
    let ar = if color == Color::White { rank_of(m.to) + 1 } else { rank_of(m.to) - 1 };
    if !(0..8).contains(&ar) {
        return false;
    }
    [-1i32, 1].into_iter().any(|df| {
        let nf = f + df;
        (0..8).contains(&nf)
            && matches!(b.squares[(ar * 8 + nf) as usize], Some(p) if p.color == color.opp() && p.kind == PieceKind::Pawn)
    })
}

/// A plain read of what the opponent is up to — their most salient plan/threat.
/// This is P3 (reading the opponent): surface an incoming plan before it lands.
fn opponent_read(b: &Board, side: Color) -> Option<String> {
    let opp = side.opp();
    // 1. Most urgent: one of our pieces is hanging → they're threatening it.
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
    // 2. An attack is building on OUR king — pressure on its zone, or a pawn
    //    storm rolling toward it. Warn before it breaks through.
    if phase(b) != "opening" {
        let myk = king_square(b, side);
        let kf = file_of(myk);
        let kr = rank_of(myk);
        let zone_hits = (-1..=1i32)
            .flat_map(|df| (-1..=1i32).map(move |dr| (df, dr)))
            .filter(|&(df, dr)| {
                let f = kf + df;
                let r = kr + dr;
                (0..8).contains(&f)
                    && (0..8).contains(&r)
                    && is_attacked(b, (r * 8 + f) as Square, opp)
            })
            .count();
        let stormers = (0..64u8)
            .filter(|&s| {
                matches!(b.squares[s as usize], Some(p) if p.color == opp && p.kind == PieceKind::Pawn)
                    && (file_of(s) - kf).abs() <= 2
                    && if side == Color::White { rank_of(s) <= 4 } else { rank_of(s) >= 3 }
            })
            .count();
        if zone_hits >= 3 || stormers >= 2 {
            return Some(
                "Your opponent is building an attack on your king — bring pieces back to defend and watch for a pawn break."
                    .to_string(),
            );
        }
    }
    // 3. A rook bearing down an open file → invasion coming.
    for f in 0..8i32 {
        if open_file(b, f)
            && (0..64u8).any(|s| {
                matches!(b.squares[s as usize], Some(p) if p.color == opp && p.kind == PieceKind::Rook && file_of(s) == f)
            })
        {
            let fc = (b'a' + f as u8) as char;
            return Some(format!(
                "Your opponent has a rook on the open {fc}-file — contest it before they invade."
            ));
        }
    }
    // 4. Their king is stuck in the centre → they're behind on safety.
    if king_square(b, opp) == king_home(opp) && phase(b) == "middlegame" {
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
    fn pawn_push_that_hits_a_pawn_is_a_break() {
        // White Pc2, Black Pd5. c2-c4 lands attacking d5 → a break; c2-c3 doesn't.
        let b = parse_fen("4k3/8/8/3p4/8/8/2P5/4K3 w - - 0 1");
        let c4 = Move { from: 10, to: 26, promo: None, flag: Flag::DoublePush };
        assert!(pawn_break(&b, &c4, Color::White));
        let c3 = Move { from: 10, to: 18, promo: None, flag: Flag::Normal };
        assert!(!pawn_break(&b, &c3, Color::White));
    }

    #[test]
    fn plans_never_recommend_a_blunder() {
        // A free queen is on offer (Rxd5). Every plan's recommended move must be
        // within the blunder guard of the engine's best — no plan should hand
        // back a bad "themed" move that ignores the win.
        for fen in [
            "4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1",
            "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
        ] {
            let b = parse_fen(fen);
            let ranked = ranked(&b);
            let top = ranked[0].1;
            let s = strategize(&b, &ranked);
            for st in &s.strategies {
                let sc = ranked
                    .iter()
                    .find(|(m, _)| crate::to_uci(*m) == st.move_uci)
                    .map(|(_, sc)| *sc)
                    .unwrap_or(top);
                assert!(sc + 130 >= top, "plan '{}' recommended {} ({} vs best {})", st.id, st.move_san, sc, top);
            }
        }
    }

    #[test]
    fn isolated_pawn_is_targeted() {
        // Black has an isolated d5 pawn (no c/e pawns), defended by its king so
        // it's not simply loose — the plan is to target the isolani. White to move.
        let b = parse_fen("8/8/4k3/3p4/8/8/3RK3/8 w - - 0 1");
        let s = strategize(&b, &ranked(&b));
        assert!(s.strategies.iter().any(|x| x.id == "iso_attack"));
    }

    #[test]
    fn opponent_king_attack_is_read() {
        // Black pawns storming White's castled king on g1 → warn of the attack.
        let b = parse_fen("6k1/8/8/8/6pp/8/8/6K1 w - - 0 1");
        let s = strategize(&b, &ranked(&b));
        assert!(
            s.opponent.as_deref().map(|t| t.contains("attack on your king")).unwrap_or(false),
            "expected a king-attack read, got {:?}",
            s.opponent
        );
    }

    #[test]
    fn free_piece_is_top_plan() {
        // White rook on d1, Black queen undefended on d5 → win the loose piece.
        let b = parse_fen("4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1");
        let s = strategize(&b, &ranked(&b));
        assert_eq!(s.strategies.first().map(|x| x.id), Some("win_material"));
    }
}
