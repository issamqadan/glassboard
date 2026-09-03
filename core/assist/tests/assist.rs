//! M3 acceptance: the assistance layer must interpret the position correctly,
//! the handicap model must be sane and monotonic, and the glass-box must record
//! every bit of help.

use assist::*;
use engine::{algebraic_to_sq, parse_fen, Board, Color};

/// Awareness flags an attacked, undefended piece. Here the white queen on d4 is
/// attacked by the knight on b5 and defended by nothing.
#[test]
fn awareness_flags_hanging_queen() {
    let b = parse_fen("4k3/8/8/1n6/3Q4/8/8/4K3 w - - 0 1");
    let a = analyze(&b, AssistLevel::Awareness, 1);
    assert!(
        a.hanging.contains(&algebraic_to_sq("d4")),
        "the hanging queen on d4 should be flagged, got {:?}",
        a.hanging
    );
}

/// Coaching explains a check in words.
#[test]
fn coaching_explains_check() {
    let b = parse_fen("4k3/8/8/8/7b/8/8/4K3 w - - 0 1"); // Bh4+ hits e1
    let a = analyze(&b, AssistLevel::Coaching, 1);
    assert!(a.in_check, "white is in check");
    assert!(
        a.messages.iter().any(|m| m.to_lowercase().contains("check")),
        "coaching should mention the check, got {:?}",
        a.messages
    );
}

/// Suggestion offers the winning capture first: the black queen on d4 hangs to
/// Rd1xd4.
#[test]
fn suggestion_ranks_the_winning_capture_first() {
    let b = parse_fen("4k3/8/8/8/3q4/8/8/3RK3 w - - 0 1");
    let a = analyze(&b, AssistLevel::Suggestion, 4);
    let top = a.candidates.first().expect("candidates exist");
    assert_eq!(
        top.mv.to,
        algebraic_to_sq("d4"),
        "top candidate should capture the queen on d4, got {}",
        top.uci
    );
}

/// Autopilot yields a concrete move to play.
#[test]
fn autopilot_provides_a_move() {
    let a = analyze(&Board::startpos(), AssistLevel::Autopilot, 2);
    assert!(a.autoplay.is_some(), "autopilot must produce a move");
}

/// The handicap model equalizes: equal ratings → no help; wider gaps → more,
/// never less.
#[test]
fn handicap_is_zero_at_parity_and_monotonic() {
    assert_eq!(recommended_level(1500, 1500), AssistLevel::Off);

    let mut prev = AssistLevel::Off;
    for gap in (0..2000).step_by(50) {
        let lvl = recommended_level(1000 + gap, 1000);
        assert!(
            lvl >= prev,
            "assistance must not decrease as the gap grows (gap {gap}: {lvl:?} < {prev:?})"
        );
        prev = lvl;
    }
    // A ~1000-point gap warrants strong, but not maximal, help.
    assert_eq!(recommended_level(2200, 1200), AssistLevel::Guided);
}

/// Every bit of help is recorded transparently for both sides to see.
#[test]
fn glass_box_records_help() {
    let b = Board::startpos();
    let a = analyze(&b, AssistLevel::Guided, 3);

    let mut glass = GlassBox::new();
    assert!(glass.is_empty());
    glass.record(0, Color::White, &a, &b);

    assert_eq!(glass.len(), 1);
    let ev = &glass.events()[0];
    assert_eq!(ev.level, AssistLevel::Guided);
    assert_eq!(ev.for_side, Color::White);
    assert!(
        ev.summary.contains("Guided"),
        "opponent-visible summary should describe the help, got {:?}",
        ev.summary
    );
}
