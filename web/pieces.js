// Glassboard chess piece set — clean, modern SVG silhouettes.
// Two-tone, driven by CSS custom properties so a piece adapts to White/Black
// (and any board) from the outside:  --pf = fill,  --ps = outline/stroke.
// Exposes a single global:  pieceSVG("N")  ->  "<svg …>…</svg>".
(function (global) {
  // Shared foot: a neck trapezoid + a rounded base bar, used by most pieces.
  const BASE =
    '<path d="M13.5 33.2 L31.5 33.2 L29.6 38 L15.4 38 Z"/>' +
    '<rect x="11.3" y="37" width="22.4" height="3.9" rx="1.95"/>';
  const BAR = '<rect x="11.3" y="37" width="22.4" height="3.9" rx="1.95"/>';

  const BODY = {
    // Pawn — head + shoulders + base.
    p:
      '<circle cx="22.5" cy="15" r="5.4"/>' +
      '<path d="M17.6 33.2 C 17.6 26 20 22 22.5 22 C 25 22 27.4 26 27.4 33.2 Z"/>' +
      BASE,

    // Rook — three crenellations, straight body, base.
    r:
      '<path d="M12.5 12 L16 12 L16 15 L19.5 15 L19.5 12 L25.5 12 L25.5 15 ' +
      'L29 15 L29 12 L32.5 12 L32.5 19 L30 21 L30 33.2 L15 33.2 L15 21 L12.5 19 Z"/>' +
      BASE,

    // Bishop — top ball, mitre, diagonal slit, collar, base.
    b:
      '<circle cx="22.5" cy="8.6" r="2.3"/>' +
      '<path d="M22.5 11 C 16.5 14 16 24 22.5 30 C 29 24 28.5 14 22.5 11 Z"/>' +
      '<path d="M18.8 16 L26.2 16" fill="none" stroke-width="1.5"/>' +
      '<rect x="15.8" y="29" width="13.4" height="3.2" rx="1.6"/>' +
      BASE,

    // Knight — left-facing horse head + eye + base.
    n:
      '<path d="M24 10 C24 9 22.5 8.5 21 9.5 C19.5 10.5 18.5 12 17.5 14 ' +
      'C16.5 16 15 18 13.5 19.5 C12 21 11.5 22.5 12.5 23.5 ' +
      'C13.5 24.5 15.5 24 17 23.3 C18.5 22.6 19.8 22.2 20.5 23 ' +
      'C21 23.8 20.3 25.2 19 26.4 C16.8 28.4 15 30.4 15 33.2 ' +
      'L31 33.2 C31 29 31 24 30 20 C29 16 27 12.5 25.8 11.5 ' +
      'C25.2 11 24.6 10.5 24 10 Z"/>' +
      '<circle cx="17.6" cy="16.4" r="1.05" fill="var(--ps)" stroke="none"/>' +
      BASE,

    // Queen — five-point crown, zig-zag body, band, base.
    q:
      '<circle cx="10.5" cy="13" r="2.1"/><circle cx="17" cy="10" r="2.1"/>' +
      '<circle cx="22.5" cy="8.4" r="2.3"/><circle cx="28" cy="10" r="2.1"/>' +
      '<circle cx="34.5" cy="13" r="2.1"/>' +
      '<path d="M11 13.6 L14.6 27 L30.4 27 L34 13.6 L28 21.6 L22.5 11.6 L17 21.6 Z"/>' +
      '<rect x="14" y="26.4" width="17" height="3" rx="1.5"/>' +
      '<path d="M15.4 29.4 L29.6 29.4 L31.5 33.2 L13.5 33.2 Z"/>' +
      BAR,

    // King — cross, crown body, base.
    k:
      '<rect x="21" y="6.4" width="3" height="9.6" rx="1.4"/>' +
      '<rect x="18.4" y="9.2" width="8.2" height="3" rx="1.4"/>' +
      '<path d="M15 33.2 C 13.2 25 17 20.5 22.5 23.6 C 28 20.5 31.8 25 30 33.2 Z"/>' +
      BASE,
  };

  function pieceSVG(ch) {
    const k = (ch || "").toLowerCase();
    if (!BODY[k]) return "";
    return (
      '<svg class="pc-svg" viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      BODY[k] +
      "</svg>"
    );
  }

  global.pieceSVG = pieceSVG;
})(typeof window !== "undefined" ? window : this);
