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

    /// The handicap rung name for the assisted (White) side, given the ratings.
    #[wasm_bindgen(js_name = assistLevel)]
    pub fn assist_level(&self) -> String {
        level_name(recommended_level(self.engine_elo, self.human_elo)).to_string()
    }

    /// Compute assistance for the side to move at the handicap rung, record it
    /// to the glass-box (transparent — unless the rung is Off), and return it as
    /// JSON: `{level,inCheck,hanging:[sq],messages:[str],candidates:[{from,to,uci,score}],recommended}`.
    pub fn assist(&mut self, depth: u32) -> String {
        let level = recommended_level(self.engine_elo, self.human_elo);
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
                    "{{\"from\":{},\"to\":{},\"uci\":{},\"score\":{}}}",
                    c.mv.from,
                    c.mv.to,
                    json_str(&c.uci),
                    c.score
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let recommended = a
            .best
            .as_ref()
            .map(|c| json_str(&c.uci))
            .unwrap_or_else(|| "null".to_string());

        format!(
            "{{\"level\":{},\"inCheck\":{},\"hanging\":[{}],\"messages\":[{}],\"candidates\":[{}],\"recommended\":{}}}",
            json_str(level_name(level)),
            a.in_check,
            hanging,
            messages,
            candidates,
            recommended
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
