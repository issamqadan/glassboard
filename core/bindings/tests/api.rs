//! Native tests for the WASM binding layer. The `#[wasm_bindgen]` methods are
//! ordinary Rust when compiled for the host, so we can exercise the exact API
//! the browser calls — square indexing, move application, engine reply, and
//! status — without a browser.

use glassboard_wasm::Game;

#[test]
fn startpos_board_string_is_correct() {
    let g = Game::new();
    let s = g.board_string();
    let b = s.as_bytes();
    assert_eq!(s.len(), 64);
    assert_eq!(b[0], b'R', "a1 is a white rook");
    assert_eq!(b[4], b'K', "e1 is the white king");
    assert_eq!(b[56], b'r', "a8 is a black rook");
    assert_eq!(b[60], b'k', "e8 is the black king");
    assert_eq!(g.side_to_move(), "white");
    assert_eq!(g.status(), "ongoing");
}

#[test]
fn knight_targets_from_b1() {
    let g = Game::new();
    let mut tos = g.legal_to(1); // b1
    tos.sort();
    assert_eq!(tos, vec![16, 18], "Nb1 can reach a3 (16) and c3 (18)");
}

#[test]
fn play_move_then_engine_replies() {
    let mut g = Game::new();
    assert!(g.make_move(12, 28, None), "e2-e4 is legal"); // e2=12, e4=28
    assert_eq!(g.side_to_move(), "black");

    let reply = g.engine_move(3);
    assert!(reply.len() >= 4, "engine returns a coordinate move, got {reply:?}");
    assert_eq!(g.side_to_move(), "white");
    assert_eq!(g.status(), "ongoing");
}

#[test]
fn rejects_illegal_move() {
    let mut g = Game::new();
    // a1 rook cannot jump to a4 through its own pawn.
    assert!(!g.make_move(0, 24, None));
    assert_eq!(g.side_to_move(), "white", "illegal move does not change turn");
}

#[test]
fn assist_and_glassbox_expose_help() {
    let mut g = Game::new();
    g.set_ratings(1000, 2000); // gap 1000 -> Guided
    assert_eq!(g.assist_level(), "guided");

    let json = g.assist(3);
    assert!(json.contains("\"level\":\"guided\""), "assist JSON: {json}");
    assert!(json.contains("\"candidates\""), "assist JSON: {json}");
    assert!(json.contains("\"recommended\""), "assist JSON: {json}");

    let glass = g.glassbox();
    assert!(glass.starts_with('['), "glassbox is a JSON array: {glass}");
    assert!(glass.contains("Guided"), "glassbox records the help: {glass}");
}
