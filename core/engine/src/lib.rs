//! Glassboard chess engine core (M0).
//!
//! M0 scope: board representation, FEN parsing, legal move generation, and
//! `perft` (the correctness gate). Search, evaluation, and neural inference
//! arrive in later milestones — see `docs/ARCHITECTURE.md`.
//!
//! Design note: M0 favors *correctness over speed*. The board is a simple
//! mailbox, moves are made with copy-make, and legal moves are pseudo-legal
//! moves filtered by king safety. `perft` proves this correct before any
//! optimization (bitboards / make-unmake) lands in M1.

pub mod board;
pub mod eval;
pub mod fen;
pub mod movegen;
pub mod perft;
pub mod search;

pub use board::*;
pub use eval::{eval, material};
pub use fen::*;
pub use movegen::{generate_legal, generate_pseudo, is_attacked, king_square};
pub use perft::{perft, perft_divide};
pub use search::{best_move, in_check, search, SearchResult, MATE, MATE_THRESHOLD};
