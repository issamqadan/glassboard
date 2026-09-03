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

/// A candidate move with its engine score (centipawns, side-to-move relative).
#[derive(Clone, Debug)]
pub struct Candidate {
    pub mv: Move,
    pub uci: String,
    pub score: i32,
}

/// The assistance produced for a position at a given rung. Fields are populated
/// progressively: a higher rung fills everything a lower rung would, plus more.
#[derive(Clone, Debug)]
pub struct Assistance {
    pub level: AssistLevel,
    /// Is the side to move in check?
    pub in_check: bool,
    /// Own pieces that are attacked and undefended (awareness+).
    pub hanging: Vec<Square>,
    /// Human-readable threat explanations (coaching+).
    pub messages: Vec<String>,
    /// Ranked candidate moves (suggestion+).
    pub candidates: Vec<Candidate>,
    /// The single recommended move (guided+).
    pub best: Option<Candidate>,
    /// The move to auto-play (autopilot only).
    pub autoplay: Option<Move>,
}

/// Analyze `b` for the assisted side at the given `level`, using engine search
/// to `depth` where candidate moves are needed.
pub fn analyze(b: &Board, level: AssistLevel, depth: u32) -> Assistance {
    let checked = in_check(b);

    let hanging = if level >= AssistLevel::Awareness {
        hanging_pieces(b, b.side)
    } else {
        Vec::new()
    };

    let mut messages = Vec::new();
    if level >= AssistLevel::Coaching {
        if checked {
            messages.push("You are in check — you must respond.".to_string());
        }
        for &s in &hanging {
            if let Some(p) = b.squares[s as usize] {
                messages.push(format!(
                    "Your {} on {} is attacked and undefended.",
                    kind_name(p.kind),
                    sq_to_algebraic(s)
                ));
            }
        }
        if messages.is_empty() {
            messages.push("No immediate threats detected.".to_string());
        }
    }

    let candidates = if level >= AssistLevel::Suggestion {
        rank_moves(b, depth)
            .into_iter()
            .take(3)
            .map(|(mv, score)| Candidate {
                uci: to_uci(mv),
                mv,
                score,
            })
            .collect()
    } else {
        Vec::new()
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
        hanging,
        messages,
        candidates,
        best,
        autoplay,
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
            format!("Awareness: {} hanging piece(s) highlighted.", a.hanging.len())
        }
        AssistLevel::Coaching => format!("Coaching: {} message(s) shown.", a.messages.len()),
        AssistLevel::Suggestion => {
            format!("Suggestion: {} candidate move(s) shown.", a.candidates.len())
        }
        AssistLevel::Guided => format!(
            "Guided: recommended {}.",
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
