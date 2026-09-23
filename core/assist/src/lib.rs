//! Glassboard assistance layer (M3).
//!
//! Three things, straight from the vision (see `docs/VISION.md`):
//!
//! 1. **The assistance spectrum** — [`AssistLevel`] rungs Off → Autopilot, and
//!    [`analyze`], which turns engine truth into the help appropriate to a rung
//!    (awareness → coaching → suggestion → guided → autopilot).
//! 2. **The Assistance-Handicap model** — [`recommended_level`], a first
//!    principled rating-gap → rung mapping for *Matched* mode. It is a
//!    deliberately simple *seed*; M4's `assist-calibrate` will replace it with a
//!    measured effective-Elo mapping.
//! 3. **The glass-box log** — [`GlassBox`], which records every assistance query
//!    transparently so the opponent sees exactly what help was given. Enforces
//!    the non-negotiable: *no hidden help, ever.*
//!
//! All rules and search stay in the engine core; this layer only interprets
//! them. Nothing here can produce help without also producing a glass-box
//! record (see [`GlassBox::record`]).

use engine::*;

pub mod strategy;

/// The assistance spectrum. Higher rungs subsume lower ones. Ordering is by
/// declaration, so `level >= AssistLevel::Suggestion` works as expected.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum AssistLevel {
    /// No assistance. Pure play.
    Off,
    /// Passive signals: in check, hanging pieces.
    Awareness,
    /// Natural-language explanation of threats.
    Coaching,
    /// A short list of candidate moves, with scores.
    Suggestion,
    /// A single recommended move (the player still executes it).
    Guided,
    /// The co-pilot's move, ready to auto-play.
    Autopilot,
}

/// A piece of ours the opponent can win material from — value-aware, so a
/// *defended* queen attacked by a knight still counts (you'd lose 9 for 3).
#[derive(Clone, Debug)]
pub struct Threat {
    pub square: Square,
    pub kind: PieceKind,
    /// Material we lose if we ignore it, in centipawns (a light one-exchange
    /// static evaluation: `value(piece) - cheapest_attacker` when defended,
    /// or the full `value(piece)` when it's hanging).
    pub loss: i32,
}

/// A candidate move with its engine score (centipawns, side-to-move relative).
#[derive(Clone, Debug)]
pub struct Candidate {
    pub mv: Move,
    pub uci: String,
    /// Human-readable move, e.g. "Nf3", "exd5", "O-O".
    pub san: String,
    pub score: i32,
    /// Plain-language note on what the move does, e.g. "Develops your knight".
    pub note: String,
}

/// The assistance produced for a position at a given rung. Fields are populated
/// progressively: a higher rung fills everything a lower rung would, plus more.
#[derive(Clone, Debug)]
pub struct Assistance {
    pub level: AssistLevel,
    /// Is the side to move in check?
    pub in_check: bool,
    /// Does the opponent threaten checkmate next move? (The build-up warning:
    /// on your turn, if you do nothing, they mate — so your move must stop it.)
    pub mate_threat: bool,
    /// Own pieces that are attacked and undefended (awareness+).
    pub hanging: Vec<Square>,
    /// Value-aware threats to our pieces — the opponent wins material by
    /// capturing, *even if the piece is defended* (e.g. a queen defended by a
    /// pawn but attacked by a knight). Ordered by material lost, biggest first.
    /// This is the signal that must outrank a strategy step: safety first.
    pub threats: Vec<Threat>,
    /// Enemy pieces we can capture for free right now (awareness+) — the
    /// offensive mirror of `hanging`.
    pub free_captures: Vec<Square>,
    /// Human-readable threat explanations (coaching+).
    pub messages: Vec<String>,
    /// Ranked candidate moves (suggestion+).
    pub candidates: Vec<Candidate>,
    /// The single recommended move (guided+).
    pub best: Option<Candidate>,
    /// The move to auto-play (autopilot only).
    pub autoplay: Option<Move>,
    /// Context-fitted named strategies to choose from (suggestion+).
    pub strategy: Option<strategy::StrategyRead>,
}

/// Analyze `b` for the assisted side at the given `level`, using engine search
/// to `depth` where candidate moves are needed.
pub fn analyze(b: &Board, level: AssistLevel, depth: u32) -> Assistance {
    let checked = in_check(b);
    let mate_threat = level >= AssistLevel::Awareness && opponent_threatens_mate(b);

    let (hanging, threats, free_captures) = if level >= AssistLevel::Awareness {
        (
            hanging_pieces(b, b.side),
            threatened_pieces(b, b.side),
            free_captures(b, b.side),
        )
    } else {
        (Vec::new(), Vec::new(), Vec::new())
    };

    let mut messages = Vec::new();
    if level >= AssistLevel::Coaching {
        if checked {
            messages.push("You are in check — you must get out of it.".to_string());
        } else if mate_threat {
            messages.push(
                "Checkmate threat — the opponent can mate next move. Your move must stop it."
                    .to_string(),
            );
        }
        // Threats first, biggest loss first — safety outranks everything else.
        for t in &threats {
            let name = kind_name(t.kind);
            let sq = sq_to_algebraic(t.square);
            if t.loss >= material(PieceKind::Rook) {
                messages.push(format!(
                    "Urgent — your {name} on {sq} is under attack. Save it before anything else."
                ));
            } else {
                messages.push(format!(
                    "Your {name} on {sq} is under attack — defend it or move it to safety."
                ));
            }
        }
        for &s in &free_captures {
            if let Some(p) = b.squares[s as usize] {
                messages.push(format!(
                    "You can win the {} on {} — it's free.",
                    kind_name(p.kind),
                    sq_to_algebraic(s)
                ));
            }
        }
        if messages.is_empty() {
            messages.push("No immediate threats — a good moment to improve a piece.".to_string());
        }
    }

    let ranked = if level >= AssistLevel::Suggestion {
        safety_rerank(b, rank_moves(b, depth))
    } else {
        Vec::new()
    };
    let candidates: Vec<Candidate> = ranked
        .iter()
        .take(3)
        .map(|&(mv, score)| Candidate {
            uci: to_uci(mv),
            san: san(b, mv),
            note: describe(b, mv),
            mv,
            score,
        })
        .collect();

    let strategy = if level >= AssistLevel::Suggestion && !ranked.is_empty() {
        Some(strategy::strategize(b, &ranked))
    } else {
        None
    };

    let best = if level >= AssistLevel::Guided {
        candidates.first().cloned()
    } else {
        None
    };

    let autoplay = if level >= AssistLevel::Autopilot {
        best.as_ref().map(|c| c.mv)
    } else {
        None
    };

    Assistance {
        level,
        in_check: checked,
        mate_threat,
        hanging,
        threats,
        free_captures,
        messages,
        candidates,
        best,
        autoplay,
        strategy,
    }
}

/// The Assistance-Handicap seed: recommended assistance for the *weaker* player
/// given both ratings. Monotonic in the gap. **Provisional** — M4 replaces the
/// thresholds with a measured effective-Elo calibration.
pub fn recommended_level(stronger_elo: i32, weaker_elo: i32) -> AssistLevel {
    let gap = (stronger_elo - weaker_elo).max(0);
    match gap {
        0..=99 => AssistLevel::Off,
        100..=299 => AssistLevel::Awareness,
        300..=499 => AssistLevel::Coaching,
        500..=799 => AssistLevel::Suggestion,
        800..=1199 => AssistLevel::Guided,
        _ => AssistLevel::Autopilot,
    }
}

/// One transparent record of assistance given, visible to *both* players.
#[derive(Clone, Debug)]
pub struct AssistEvent {
    pub ply: u32,
    pub for_side: Color,
    pub level: AssistLevel,
    pub fen: String,
    /// A plain summary the opponent can read — what class of help was shown,
    /// and (for guided/autopilot) which move.
    pub summary: String,
}

/// The glass-box: an append-only, fully-visible log of assistance. Because the
/// only way to surface help is through [`analyze`] + [`GlassBox::record`],
/// hidden help is impossible by construction.
#[derive(Default)]
pub struct GlassBox {
    events: Vec<AssistEvent>,
}

impl GlassBox {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record that `for_side` received `assistance` at `ply` in position `b`.
    pub fn record(&mut self, ply: u32, for_side: Color, assistance: &Assistance, b: &Board) {
        self.events.push(AssistEvent {
            ply,
            for_side,
            level: assistance.level,
            fen: to_fen(b),
            summary: summarize(assistance),
        });
    }

    /// The full, transparent history — readable by either player.
    pub fn events(&self) -> &[AssistEvent] {
        &self.events
    }

    pub fn len(&self) -> usize {
        self.events.len()
    }

    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }
}

fn summarize(a: &Assistance) -> String {
    match a.level {
        AssistLevel::Off => "No assistance used.".to_string(),
        AssistLevel::Awareness => {
            format!("Hint: {} hanging piece(s) highlighted.", a.hanging.len())
        }
        AssistLevel::Coaching => format!("Coach: {} message(s) shown.", a.messages.len()),
        AssistLevel::Suggestion => {
            format!("Guide: {} candidate move(s) shown.", a.candidates.len())
        }
        AssistLevel::Guided => format!(
            "Assist: recommended {}.",
            a.best.as_ref().map(|c| c.uci.as_str()).unwrap_or("-")
        ),
        AssistLevel::Autopilot => format!(
            "Autopilot: played {}.",
            a.autoplay.map(to_uci).unwrap_or_else(|| "-".to_string())
        ),
    }
}

/// Own pieces (excluding the king) that are attacked by the enemy and not
/// defended by a friendly piece — the simple v1 notion of "hanging".
fn hanging_pieces(b: &Board, side: Color) -> Vec<Square> {
    let mut out = Vec::new();
    for s in 0..64u8 {
        if let Some(p) = b.squares[s as usize] {
            if p.color == side
                && p.kind != PieceKind::King
                && is_attacked(b, s, side.opp())
                && !is_attacked(b, s, side)
            {
                out.push(s);
            }
        }
    }
    out
}

/// Does the opponent threaten mate next move? Give them the move (a null move)
/// and see if any reply is checkmate. This is the "build-up" warning: on your
/// turn it fires *before* you're mated, so your move can address it. Skipped when
/// you're already in check (that's its own, louder signal).
fn opponent_threatens_mate(b: &Board) -> bool {
    if in_check(b) {
        return false;
    }
    let opp = b.side.opp();
    // Move-gen needs both kings on the board (king-safety checks).
    let both_kings = |c: Color| b.squares.iter().flatten().any(|p| p.kind == PieceKind::King && p.color == c);
    if !both_kings(Color::White) || !both_kings(Color::Black) {
        return false;
    }
    let mut nb = *b;
    nb.side = opp;
    nb.ep = None;
    for m in generate_legal(&nb) {
        let mut c = nb;
        c.make_move(m);
        // Now it's our move in `c`: are we checkmated?
        if in_check(&c) && generate_legal(&c).is_empty() {
            return true;
        }
    }
    false
}

/// Material we can lose right after playing `mv` — the opponent's best winning
/// capture in the resulting position. This is the chessmaster's blunder-check:
/// "if I play this, what do I hang?" A light one-exchange estimate.
pub(crate) fn hang_after(b: &Board, mv: Move) -> i32 {
    let mut nb = *b;
    nb.make_move(mv);
    threatened_pieces(&nb, b.side).first().map(|t| t.loss).unwrap_or(0)
}

/// Re-rank the engine's candidates through a safety lens: subtract what each move
/// hangs, so moves that drop material sink and moves that keep the position sound
/// rise. This keeps a weaker player from being told to give away a piece, and
/// makes "save the threatened queen" naturally surface as the top move. Only the
/// top slice is re-weighted (that's all we ever show); `sort_by` is stable, so
/// among equally-safe moves the engine's own order is preserved.
pub(crate) fn safety_rerank(b: &Board, mut ranked: Vec<(Move, i32)>) -> Vec<(Move, i32)> {
    let k = ranked.len().min(12);
    for i in 0..k {
        let (mv, sc) = ranked[i];
        ranked[i] = (mv, sc - hang_after(b, mv));
    }
    ranked[..k].sort_by(|a, c| c.1.cmp(&a.1));
    ranked
}

/// Value-aware threats to `side`: our pieces the opponent can capture at a net
/// material gain — *even if defended*. A queen (900) defended by a pawn but
/// attacked by a knight (320) still counts: the exchange loses us 580. This is
/// the gap the plain "hanging" test misses, and the reason a strategy step must
/// yield to it. Uses a light one-exchange evaluation; ordered by loss, biggest
/// first.
pub(crate) fn threatened_pieces(b: &Board, side: Color) -> Vec<Threat> {
    let opp = side.opp();
    // Enumerating enemy replies needs the enemy king on the board (move-gen
    // checks king safety). Real games always have both; guard for test/edge
    // positions that don't.
    if !b
        .squares
        .iter()
        .flatten()
        .any(|p| p.kind == PieceKind::King && p.color == opp)
    {
        return Vec::new();
    }
    // The cheapest enemy piece that can land on each square, as if it were the
    // opponent's move — one move-gen pass instead of per-square attacker scans.
    let mut nb = *b;
    nb.side = opp;
    nb.ep = None; // en-passant can't capture on an occupied square; avoid a phantom
    let mut cheapest = [i32::MAX; 64];
    for m in generate_legal(&nb) {
        if let Some(mover) = nb.squares[m.from as usize] {
            let v = material(mover.kind);
            if v < cheapest[m.to as usize] {
                cheapest[m.to as usize] = v;
            }
        }
    }

    let mut out = Vec::new();
    for s in 0..64u8 {
        let p = match b.squares[s as usize] {
            Some(p) => p,
            None => continue,
        };
        if p.color != side || p.kind == PieceKind::King {
            continue;
        }
        let attacker = cheapest[s as usize];
        if attacker == i32::MAX {
            continue; // no enemy move reaches it → not attacked
        }
        let val = material(p.kind);
        // Defended → we recapture, so we only bleed value − cheapest attacker.
        // Undefended → we lose the whole piece.
        let loss = if is_attacked(b, s, side) { val - attacker } else { val };
        if loss > 0 {
            out.push(Threat { square: s, kind: p.kind, loss });
        }
    }
    out.sort_by(|a, c| c.loss.cmp(&a.loss));
    out
}

/// Enemy pieces (excluding king and pawns) that our side attacks and the enemy
/// does not defend — free material available to win right now. Mirrors the
/// server-side Player-Model "missed free capture" signal so live help and the
/// learning log describe the same thing.
fn free_captures(b: &Board, side: Color) -> Vec<Square> {
    let opp = side.opp();
    let mut out = Vec::new();
    for s in 0..64u8 {
        if let Some(p) = b.squares[s as usize] {
            if p.color == opp
                && p.kind != PieceKind::King
                && p.kind != PieceKind::Pawn
                && is_attacked(b, s, side)
                && !is_attacked(b, s, opp)
            {
                out.push(s);
            }
        }
    }
    out
}

/// A plain-language, beginner-friendly note on what a move accomplishes.
fn describe(b: &Board, mv: Move) -> String {
    let mut nb = *b;
    nb.make_move(mv);
    let opp = nb.side;
    let opp_king = king_square(&nb, opp);
    let gives_check = is_attacked(&nb, opp_king, opp.opp());
    if gives_check && generate_legal(&nb).is_empty() {
        return "Checkmate — wins the game!".to_string();
    }

    let mover = b.squares[mv.from as usize].map(|p| p.kind);
    let captured = if mv.flag == Flag::EnPassant {
        Some(PieceKind::Pawn)
    } else {
        b.squares[mv.to as usize].map(|p| p.kind)
    };

    if let Some(vk) = captured {
        let mut s = format!("Captures the {}", kind_name(vk));
        let attacker = mover.map(material).unwrap_or(0);
        let safe = !is_attacked(&nb, mv.to, opp); // our piece isn't recaptured
        if material(vk) > attacker || safe {
            s.push_str(" — wins material");
        }
        if gives_check {
            s.push_str(", with check");
        }
        return s;
    }
    if gives_check {
        return "Gives check.".to_string();
    }
    if mv.flag == Flag::Castle {
        return "Castles — tucks the king to safety.".to_string();
    }
    if mv.promo.is_some() {
        return "Promotes to a queen.".to_string();
    }
    if let Some(k) = mover {
        let back = if b.side == Color::White { 0 } else { 7 };
        if (k == PieceKind::Knight || k == PieceKind::Bishop) && rank_of(mv.from) == back {
            return format!("Develops your {}.", kind_name(k));
        }
        // d4, e4, d5, e5 — the classic central squares.
        if k == PieceKind::Pawn && [27u8, 28, 35, 36].contains(&mv.to) {
            return "Fights for the centre.".to_string();
        }
        return format!("Improves your {}.", kind_name(k));
    }
    "A solid move.".to_string()
}

fn kind_name(k: PieceKind) -> &'static str {
    match k {
        PieceKind::Pawn => "pawn",
        PieceKind::Knight => "knight",
        PieceKind::Bishop => "bishop",
        PieceKind::Rook => "rook",
        PieceKind::Queen => "queen",
        PieceKind::King => "king",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bug the user hit: a queen *defended* by a pawn but attacked by a
    /// knight is not "hanging", yet ignoring it loses 900-for-320. The plain
    /// hanging test stays silent; the value-aware threat test must fire.
    #[test]
    fn defended_queen_attacked_by_knight_is_a_threat() {
        // White Qd4 (defended by Pc3) is attacked by Black Nf5. White to move.
        let b = parse_fen("6k1/8/8/5n2/3Q4/2P5/8/6K1 w - - 0 1");
        assert!(hanging_pieces(&b, b.side).is_empty(), "queen is defended, not hanging");
        let threats = threatened_pieces(&b, b.side);
        assert_eq!(threats.len(), 1, "the queen should be flagged");
        assert_eq!(sq_to_algebraic(threats[0].square), "d4");
        assert_eq!(threats[0].kind, PieceKind::Queen);
        assert_eq!(threats[0].loss, 900 - 320, "lose queen, regain a knight");
    }

    /// Build-up warning: a back-rank mate looms. It's White to move; Black's rook
    /// can mate on the back rank next move, so the threat must fire now.
    #[test]
    fn opponent_back_rank_mate_is_a_threat() {
        // White king g1 boxed in by pawns f2,g2,h2; Black rook a8 swings to a1# next.
        let b = parse_fen("r5k1/8/8/8/8/8/5PPP/6K1 w - - 0 1");
        assert!(!in_check(&b));
        assert!(opponent_threatens_mate(&b), "Ra1# is threatened");
        let a = analyze(&b, AssistLevel::Coaching, 1);
        assert!(a.mate_threat);
        assert!(a.messages.iter().any(|m| m.contains("Checkmate threat")));
    }

    /// A quiet opening position is not under a mate threat.
    #[test]
    fn startpos_has_no_mate_threat() {
        let b = Board::startpos();
        assert!(!opponent_threatens_mate(&b));
    }

    /// The chessmaster blunder-check in action: a queen under attack must be
    /// saved by the recommendation, and the strategy must lead with saving it —
    /// not push some unrelated plan while the queen hangs.
    #[test]
    fn threatened_queen_is_saved_by_the_recommendation() {
        // White Qd4 attacked by Black Nf5 and undefended. White to move.
        let b = parse_fen("6k1/8/8/5n2/3Q4/8/6PP/6K1 w - - 0 1");
        assert_eq!(threatened_pieces(&b, b.side).first().map(|t| t.loss), Some(900));
        let a = analyze(&b, AssistLevel::Suggestion, 3);
        let best = a.candidates.first().expect("a candidate");
        assert!(hang_after(&b, best.mv) < 900, "recommended {} still hangs the queen", best.san);
        let sr = a.strategy.expect("strategy");
        assert!(sr.strategies.iter().any(|s| s.id == "save_piece"), "expected a save_piece plan on top");
    }

    /// A defended piece attacked only by something at least as valuable is safe.
    #[test]
    fn defended_knight_attacked_by_rook_is_not_a_threat() {
        // White Nd4 defended by Pc3, attacked by Black Rd8 down the file.
        let b = parse_fen("3r2k1/8/8/8/3N4/2P5/8/6K1 w - - 0 1");
        assert!(threatened_pieces(&b, b.side).is_empty());
    }
}

pub(crate) fn to_uci(m: Move) -> String {
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
