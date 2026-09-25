//! WebAssembly bindings for Glassboard (M2 + M3).
//!
//! Exposes a `Game` object to JavaScript. Squares are a1=0 .. h8=63 (matching
//! the engine). The web shell is a *thin* view: all rules, search, assistance,
//! and the glass-box live in Rust, so behavior is identical to native. The
//! assistance API returns small JSON strings to keep the JS boundary simple and
//! dependency-free. See docs/ARCHITECTURE.md.

use assist::*;
use engine::*;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Game {
    board: Board,
    glass: GlassBox,
    human_elo: i32,
    engine_elo: i32,
    ply: u32,
    /// Testing override: force a rung regardless of ratings (None = use ratings).
    assist_override: Option<AssistLevel>,
}

#[wasm_bindgen]
impl Game {
    /// New game at the standard starting position.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Game {
        Game {
            board: Board::startpos(),
            glass: GlassBox::new(),
            human_elo: 1200,
            engine_elo: 1700,
            ply: 0,
            assist_override: None,
        }
    }

    /// Build a game from a FEN string.
    #[wasm_bindgen(js_name = fromFen)]
    pub fn from_fen(fen: &str) -> Game {
        Game {
            board: parse_fen(fen),
            glass: GlassBox::new(),
            human_elo: 1200,
            engine_elo: 1700,
            ply: 0,
            assist_override: None,
        }
    }

    /// Current position as FEN.
    pub fn fen(&self) -> String {
        to_fen(&self.board)
    }

    /// 64-char board string (index 0 = a1 .. 63 = h8). Uppercase = White,
    /// lowercase = Black, '.' = empty.
    #[wasm_bindgen(js_name = boardString)]
    pub fn board_string(&self) -> String {
        let mut s = String::with_capacity(64);
        for i in 0..64 {
            s.push(match self.board.squares[i] {
                Some(p) => piece_char(p),
                None => '.',
            });
        }
        s
    }

    /// "white" or "black".
    #[wasm_bindgen(js_name = sideToMove)]
    pub fn side_to_move(&self) -> String {
        color_name(self.board.side).to_string()
    }

    /// Is the side to move in check?
    #[wasm_bindgen(js_name = inCheck)]
    pub fn in_check(&self) -> bool {
        engine::in_check(&self.board)
    }

    /// Destination squares of every legal move from `from` (for highlighting).
    #[wasm_bindgen(js_name = legalTo)]
    pub fn legal_to(&self, from: u8) -> Vec<u8> {
        generate_legal(&self.board)
            .into_iter()
            .filter(|m| m.from == from)
            .map(|m| m.to)
            .collect()
    }

    /// Would a `from`->`to` move be a promotion?
    #[wasm_bindgen(js_name = isPromotion)]
    pub fn is_promotion(&self, from: u8, to: u8) -> bool {
        generate_legal(&self.board)
            .into_iter()
            .any(|m| m.from == from && m.to == to && m.promo.is_some())
    }

    /// Play `from`->`to`. `promo` is "q"/"r"/"b"/"n" or empty (defaults to
    /// queen). Returns true if legal and applied.
    #[wasm_bindgen(js_name = makeMove)]
    pub fn make_move(&mut self, from: u8, to: u8, promo: Option<String>) -> bool {
        let want = promo.as_deref().and_then(parse_promo);
        let candidates: Vec<Move> = generate_legal(&self.board)
            .into_iter()
            .filter(|m| m.from == from && m.to == to)
            .collect();
        if candidates.is_empty() {
            return false;
        }
        let chosen = if let Some(k) = want {
            candidates.iter().copied().find(|m| m.promo == Some(k))
        } else {
            candidates
                .iter()
                .copied()
                .find(|m| m.promo.is_none())
                .or_else(|| candidates.iter().copied().find(|m| m.promo == Some(PieceKind::Queen)))
                .or_else(|| candidates.first().copied())
        };
        match chosen {
            Some(m) => {
                self.board.make_move(m);
                self.ply += 1;
                true
            }
            None => false,
        }
    }

    /// Let the engine choose and play a move at `depth`. Returns the move in
    /// coordinate notation, or "" if the game is over.
    #[wasm_bindgen(js_name = engineMove)]
    pub fn engine_move(&mut self, depth: u32) -> String {
        if generate_legal(&self.board).is_empty() {
            return String::new();
        }
        match search(&self.board, depth).best {
            Some(m) => {
                let u = move_uci(m);
                self.board.make_move(m);
                self.ply += 1;
                u
            }
            None => String::new(),
        }
    }

    /// Strength telemetry: the search score (centipawns, side-to-move relative)
    /// of the current position at `depth` — the value of playing the best move.
    #[wasm_bindgen(js_name = bestScore)]
    pub fn best_score(&self, depth: u32) -> i32 {
        if generate_legal(&self.board).is_empty() {
            return if engine::in_check(&self.board) { -30000 } else { 0 };
        }
        search(&self.board, depth).score
    }

    /// The search score of a SPECIFIC move (side-to-move relative). Compared with
    /// `bestScore`, `bestScore - scoreMove` is the move's centipawn loss — how far
    /// from best it was. Used to measure assistance/play quality in real games.
    /// Returns i32::MIN sentinel (-2_000_000) if the move isn't legal.
    #[wasm_bindgen(js_name = scoreMove)]
    pub fn score_move(&self, from: u8, to: u8, depth: u32) -> i32 {
        match generate_legal(&self.board)
            .into_iter()
            .find(|m| m.from == from && m.to == to)
        {
            Some(m) => {
                let mut nb = self.board;
                nb.make_move(m);
                -search(&nb, depth.saturating_sub(1)).score
            }
            None => -2_000_000,
        }
    }

    /// The opponent plays at a chosen strength: `elo` maps to a search depth and a
    /// move-variety spread. Higher elo → deeper search + tighter choice (stronger,
    /// more strategic); lower elo → shallower + more variety (weaker, more human,
    /// occasional slips). `rand` is a float in [0,1) from JS (the engine has no
    /// RNG). NOTE: strength is a heuristic ladder, not a calibrated Elo (P4).
    #[wasm_bindgen(js_name = engineMoveByElo)]
    pub fn engine_move_by_elo(&mut self, elo: i32, rand: f64) -> String {
        if generate_legal(&self.board).is_empty() {
            return String::new();
        }
        let (depth, spread) = strength_for_elo(elo);
        let ranked = rank_moves(&self.board, depth);
        if ranked.is_empty() {
            return String::new();
        }
        let top = ranked[0].1;
        // Wider spread early so openings vary; the level's own spread otherwise.
        let spread = if self.board.fullmove <= 6 { spread + 35 } else { spread };
        let pool: Vec<Move> = ranked
            .iter()
            .filter(|(_, s)| top - *s <= spread)
            .map(|(m, _)| *m)
            .collect();
        let idx = ((rand.clamp(0.0, 0.999) * pool.len() as f64) as usize).min(pool.len() - 1);
        let m = pool[idx];
        let u = move_uci(m);
        self.board.make_move(m);
        self.ply += 1;
        u
    }

    /// The search depth to give the ASSISTANCE for an opponent of this `elo` — a
    /// notch deeper than the opponent (capped), so following the help lifts the
    /// assisted player above the opponent. That is the handicap made real.
    #[wasm_bindgen(js_name = assistDepthFor)]
    pub fn assist_depth_for(elo: i32) -> u32 {
        (strength_for_elo(elo).0 + 1).min(4).max(3)
    }

    /// "ongoing" | "checkmate" | "stalemate" | "fifty-move".
    pub fn status(&self) -> String {
        if generate_legal(&self.board).is_empty() {
            if engine::in_check(&self.board) {
                "checkmate"
            } else {
                "stalemate"
            }
        } else if self.board.halfmove >= 100 {
            "fifty-move"
        } else {
            "ongoing"
        }
        .to_string()
    }

    // --- assistance (M3) ---------------------------------------------------

    /// Set both ratings; the Assistance-Handicap is derived from these.
    #[wasm_bindgen(js_name = setRatings)]
    pub fn set_ratings(&mut self, human_elo: i32, engine_elo: i32) {
        self.human_elo = human_elo;
        self.engine_elo = engine_elo;
    }

    /// Testing override: force the assistance rung regardless of ratings (still
    /// glass-boxed). Pass a rung name ("awareness".."autopilot", or "strategy" =
    /// suggestion); "" or an unknown value clears it (back to rating-derived).
    #[wasm_bindgen(js_name = setAssistOverride)]
    pub fn set_assist_override(&mut self, level: &str) {
        self.assist_override = level_from_name(level);
    }

    fn effective_level(&self) -> AssistLevel {
        self.assist_override
            .unwrap_or_else(|| recommended_level(self.engine_elo, self.human_elo))
    }

    /// The handicap rung name for the side to move, given ratings (or override).
    #[wasm_bindgen(js_name = assistLevel)]
    pub fn assist_level(&self) -> String {
        level_name(self.effective_level()).to_string()
    }

    /// Compute assistance for the side to move at the handicap rung, record it
    /// to the glass-box (transparent — unless the rung is Off), and return it as
    /// JSON: `{level,inCheck,hanging:[sq],messages:[str],candidates:[{from,to,uci,score}],recommended}`.
    pub fn assist(&mut self, depth: u32) -> String {
        let level = self.effective_level();
        let a = analyze(&self.board, level, depth);
        if level != AssistLevel::Off {
            self.glass.record(self.ply, self.board.side, &a, &self.board);
        }

        let hanging = a
            .hanging
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let free_captures = a
            .free_captures
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let threats = a
            .threats
            .iter()
            .map(|t| {
                format!(
                    "{{\"sq\":{},\"kind\":{},\"loss\":{}}}",
                    t.square,
                    json_str(&piece_kind_letter(t.kind).to_string()),
                    t.loss
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let messages = a
            .messages
            .iter()
            .map(|m| json_str(m))
            .collect::<Vec<_>>()
            .join(",");
        let candidates = a
            .candidates
            .iter()
            .map(|c| {
                format!(
                    "{{\"from\":{},\"to\":{},\"uci\":{},\"san\":{},\"score\":{},\"note\":{}}}",
                    c.mv.from,
                    c.mv.to,
                    json_str(&c.uci),
                    json_str(&c.san),
                    c.score,
                    json_str(&c.note)
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let recommended = a
            .best
            .as_ref()
            .map(|c| json_str(&c.uci))
            .unwrap_or_else(|| "null".to_string());

        let strategy = match &a.strategy {
            Some(sr) => {
                let strats = sr
                    .strategies
                    .iter()
                    .map(|s| {
                        let arrows = s
                            .arrows
                            .iter()
                            .map(|ar| {
                                format!(
                                    "{{\"from\":{},\"to\":{},\"kind\":{}}}",
                                    ar.from,
                                    ar.to,
                                    json_str(ar.kind.tag())
                                )
                            })
                            .collect::<Vec<_>>()
                            .join(",");
                        let rings = s
                            .rings
                            .iter()
                            .map(|r| r.to_string())
                            .collect::<Vec<_>>()
                            .join(",");
                        let steps = s
                            .steps
                            .iter()
                            .map(|st| format!("{{\"text\":{},\"done\":{}}}", json_str(&st.text), st.done))
                            .collect::<Vec<_>>()
                            .join(",");
                        format!(
                            "{{\"id\":{},\"name\":{},\"idea\":{},\"fit\":{},\"arrows\":[{}],\"rings\":[{}],\"steps\":[{}],\"moveUci\":{},\"moveSan\":{},\"moveNote\":{}}}",
                            json_str(s.id),
                            json_str(&s.name),
                            json_str(&s.idea),
                            s.fit,
                            arrows,
                            rings,
                            steps,
                            json_str(&s.move_uci),
                            json_str(&s.move_san),
                            json_str(&s.move_note)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                let opponent = sr
                    .opponent
                    .as_ref()
                    .map(|o| json_str(o))
                    .unwrap_or_else(|| "null".to_string());
                format!(
                    "{{\"phase\":{},\"opponent\":{},\"strategies\":[{}]}}",
                    json_str(sr.phase),
                    opponent,
                    strats
                )
            }
            None => "null".to_string(),
        };

        format!(
            "{{\"level\":{},\"inCheck\":{},\"mateThreat\":{},\"hanging\":[{}],\"threats\":[{}],\"freeCaptures\":[{}],\"messages\":[{}],\"candidates\":[{}],\"recommended\":{},\"strategy\":{}}}",
            json_str(level_name(level)),
            a.in_check,
            a.mate_threat,
            hanging,
            threats,
            free_captures,
            messages,
            candidates,
            recommended,
            strategy
        )
    }

    /// The glass-box log as JSON: `[{ply,side,level,summary}]`. Visible to both.
    pub fn glassbox(&self) -> String {
        let items = self
            .glass
            .events()
            .iter()
            .map(|e| {
                format!(
                    "{{\"ply\":{},\"side\":{},\"level\":{},\"summary\":{}}}",
                    e.ply,
                    json_str(color_name(e.for_side)),
                    json_str(level_name(e.level)),
                    json_str(&e.summary)
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        format!("[{items}]")
    }
}

impl Default for Game {
    fn default() -> Self {
        Game::new()
    }
}

/// Map a chosen rating to (search depth, move-variety spread in centipawns).
/// A heuristic ladder — deeper + tighter as the level rises. Absolute Elo is
/// aspirational; the point is a clear, monotonic difficulty curve (P4 will
/// calibrate real strength).
fn strength_for_elo(elo: i32) -> (u32, i32) {
    match elo {
        i if i <= 700 => (1, 250),   // Beginner — very shallow, lots of slips
        i if i <= 1100 => (2, 140),  // Casual
        i if i <= 1500 => (2, 60),   // Intermediate
        i if i <= 1900 => (3, 30),   // Club
        i if i <= 2300 => (3, 10),   // Expert
        _ => (4, 0),                 // Master — deepest, always the best move
    }
}

fn parse_promo(s: &str) -> Option<PieceKind> {
    match s.chars().next()?.to_ascii_lowercase() {
        'q' => Some(PieceKind::Queen),
        'r' => Some(PieceKind::Rook),
        'b' => Some(PieceKind::Bishop),
        'n' => Some(PieceKind::Knight),
        _ => None,
    }
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

fn piece_kind_letter(k: PieceKind) -> char {
    match k {
        PieceKind::Pawn => 'p',
        PieceKind::Knight => 'n',
        PieceKind::Bishop => 'b',
        PieceKind::Rook => 'r',
        PieceKind::Queen => 'q',
        PieceKind::King => 'k',
    }
}

fn color_name(c: Color) -> &'static str {
    match c {
        Color::White => "white",
        Color::Black => "black",
    }
}

fn level_name(l: AssistLevel) -> &'static str {
    match l {
        AssistLevel::Off => "off",
        AssistLevel::Awareness => "awareness",
        AssistLevel::Coaching => "coaching",
        AssistLevel::Suggestion => "suggestion",
        AssistLevel::Guided => "guided",
        AssistLevel::Autopilot => "autopilot",
    }
}

fn level_from_name(s: &str) -> Option<AssistLevel> {
    match s.to_ascii_lowercase().as_str() {
        "off" => Some(AssistLevel::Off),
        "awareness" => Some(AssistLevel::Awareness),
        "coaching" => Some(AssistLevel::Coaching),
        "suggestion" | "strategy" => Some(AssistLevel::Suggestion),
        "guided" => Some(AssistLevel::Guided),
        "autopilot" => Some(AssistLevel::Autopilot),
        _ => None,
    }
}

fn move_uci(m: Move) -> String {
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

/// Minimal JSON string encoder (quotes + escapes). Inputs are controlled
/// engine strings, so only quote/backslash/newline need escaping.
fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}
