#!/usr/bin/env python3
"""Render the game screen's LAYOUT at real phone sizes, using the real stylesheet.

There is no browser in this environment, which is why three layout changes shipped
broken — the arithmetic said "fits" and the screen said otherwise. macOS QuickLook
(`qlmanage`) renders HTML through WebKit, including flexbox, so this builds a
faithful static harness of the game screen and renders it at the viewport sizes
that matter.

What it is: the real web/style.css, the real DOM structure of <main class="game">,
filled with representative content (strips, an 8x8 board, the guidance card, the
chooser). What it is NOT: the live app — no WASM, no JS, no engine. It answers
"where do the boxes land and does anything overflow", which is exactly the question
that kept being answered wrong.

Usage:  python3 scripts/render-mobile.py [outdir]
"""
import os
import subprocess
import sys

W_H = [(393, 660), (430, 800), (360, 640)]

BOARD_SQUARES = "".join(
    f'<div class="sq {"light" if (r + c) % 2 else "dark"}">'
    f'{"<span class=piece>♟</span>" if r in (1, 6) else ""}</div>'
    for r in range(8) for c in range(8)
)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
resolve_css = import_module("resolve-css").resolve_css
_WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
RAW = open(os.path.join(_WEB, "style.css")).read()
# The app nav and the mobile TAB BAR are styled inside nav.js, not style.css. The
# harness used to invent its own 52px tab bar, which is how the sheet shipped
# sitting UNDER the real 64px one. Pull the actual rules in.
_nav = open(os.path.join(_WEB, "nav.js")).read()
_i = _nav.index("const css = `") + len("const css = `")
NAVCSS = _nav[_i:_nav.index("`", _i)]
RAW = RAW + "\n/* ---- from nav.js ---- */\n" + NAVCSS


def page(w, h, state):
    """state: "peek" | "choose" | "guide" — the three sheet states."""
    """One device frame: the game screen as it is actually composed."""
    APP_NAV, TAB_BAR, RESERVE = 58, 64, 430   # nav.js's own figures
    gameh = h - APP_NAV - TAB_BAR
    # the real board rule: two media queries, the <=700px-tall one reserving more
    reserve = 360 if h <= 700 else 300
    boardw = min(w - 28, max(248, h - reserve))
    app_nav = APP_NAV
    sheeth = h - 232  # the real max-height: calc(100dvh - 232px)
    # The stylesheet is RESOLVED for this exact device: @media flattened, vh/vw and
    # env() substituted. Without this the renderer silently used desktop CSS.
    appcss = resolve_css(RAW, w, h)

    guide = (
        '<div id="glassLens" class="glass-lens">'
        '<div class="gl-plan-head"><span class="gp-ic">&#9822;</span>'
        '<b class="gp-name">Develop &amp; Castle</b><span class="gp-prog">1/3</span>'
        '<button class="gp-change" id="lensChange">Change strategy</button></div>'
        '<div class="gl-plan-now"><b>Now:</b> Develop your bishops</div>'
        '<div class="gl-plan-bar"><span style="width:33%"></span></div>'
        '<ol class="gl-steps open">'
        '<li class="gl-step done"><span class="gs-dot">&#10003;</span><span>Develop your knights</span></li>'
        '<li class="gl-step now"><span class="gs-dot">&#9656;</span><span>Develop your bishops</span></li>'
        '<li class="gl-step todo"><span class="gs-dot"></span><span>Castle your king</span></li></ol>'
        '<button class="gl-steps-toggle">Hide the plan &#9650;</button>'
        '<div class="gl-r1"><span class="gl-label">Build your position</span>'
        '<span class="gl-tag t-best">Best move</span>'
        '<button class="gl-explain">&#128161;</button><button class="gl-log">&#128220;</button></div>'
        '<div class="gl-why">The engine rates this highest here.</div>'
        '<div class="gl-actions"><button class="gl-playmove">&#9654; e4</button>'
        '<button class="gl-show">&#128065;</button><button class="gl-more">&#8943;</button></div>'
        '<button class="gl-planalt">&#129517; Play your plan instead &#8212; Nc3'
        '<small>advances &#8220;Develop your knights&#8221;</small></button>'
        '</div>'
    )
    chooser = (
        '<div id="planPanel" class="plan-panel chooser">'
        '<div class="pp-head"><span class="pp-ic">&#129517;</span><b>Choose a strategy</b>'
        '<button class="pp-x">&#10005;</button></div>'
        '<div class="pp-choices open">'
        '<button class="pp-choice"><span class="pc-ic">&#9816;</span><span class="pc-txt">'
        '<b>Develop &amp; Castle<span class="pc-prog">0/3 met</span></b>'
        '<small>Get your last pieces into the game and tuck your king away.</small></span></button>'
        '<button class="pp-choice"><span class="pc-ic">&#9635;</span><span class="pc-txt">'
        '<b>Seize the Centre<span class="pc-prog">0/3 met</span></b>'
        '<small>Plant a pawn in the middle &#8212; central space cramps your opponent.</small></span></button>'
        '<button class="pp-choice"><span class="pc-ic">&#9876;</span><span class="pc-txt">'
        '<b>Attack the King<span class="pc-prog">0/4 met</span></b>'
        '<small>Aim your pieces at the enemy king and open a line.</small></span></button>'
        '</div></div>'
    )
    body = {"peek": guide, "choose": chooser, "guide": guide}[state]
    opencls = "peek" if state == "peek" else "open"
    chev = "&#9662;" if state != "peek" else "&#9652;"
    card = (
        f'<div id="assistSheet" class="assist-sheet {opencls}">'
        '<div class="as-head"><span class="as-grip"></span>'
        '<button class="as-peek"><span class="ap-main"><span class="ap-ic">&#9822;</span>'
        f'<b>Develop &amp; Castle</b><span class="ap-prog">1/3</span><span class="ap-chev">{chev}</span></span>'
        '<span class="ap-now">Develop your bishops</span></button>'
        '<button class="as-quick">&#9654; e4</button></div>'
        f'<div class="as-body">{body}</div></div>'
    )
    strip = ('<div class="pstrip {cls} has-clock"><span class="ps-id">'
             '<span class="dot {dot}"></span>{icon} <b>{name}</b></span>'
             '<span class="ps-pips"><span class="ps-budget">🤝 6/8</span></span>'
             '<span class="ps-caps">{caps}</span>'
             '<span class="ps-lead">+3</span><span class="ps-clock">4:58</span></div>')
    caps = ('<span class="cap-tray"><span class="cap-pc black">♟</span>'
            '<span class="cap-pc black">♞</span><span class="cap-more">+2</span></span>')
    return f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>{appcss}</style>
<style>
  /* main.game's own height still measures the WINDOW, so it is pinned to what
     this device leaves between the app nav and the tab bar. */
  .frame main.game {{ height: {gameh}px; max-height: {gameh}px; margin-top: {app_nav}px; }}
  .frame main.game .board-wrap {{ width: {boardw}px; }}
  /* position:fixed must resolve against the DEVICE FRAME, not QuickLook's window,
     so the frame is made a containing block (transform, below). */
  .frame .assist-sheet {{ max-height: {sheeth}px; }}
</style>
<style>
  /* the device frame itself — NOT app CSS */
  html,body{{margin:0;background:#05070c}}
  .frame{{width:{w}px;height:{h}px;overflow:hidden;position:relative;transform:translate(0);
    border:2px solid #ff3b30;margin:6px;background:var(--bg,#0e1420)}}
  .frame .lbl{{position:absolute;right:2px;top:2px;z-index:99;background:#ff3b30;color:#fff;
    font:10px/1.4 -apple-system,sans-serif;padding:1px 5px;border-radius:3px}}
  /* nav.js styles .gbnav and .gbtabs itself — nothing invented here. */
  .board{{display:grid;grid-template-columns:repeat(8,1fr);aspect-ratio:1}}
  .sq{{aspect-ratio:1;display:grid;place-items:center;font-size:13px}}
  .sq.light{{background:#b6c0d0}} .sq.dark{{background:#3b465c}}
</style></head><body>
<div class="frame"><span class="lbl">{w}x{h} {state}</span>
  <div class="gbnav"><a class="gbnav-brand"><span class="gbnav-mark">&#9822;</span> Glassboard</a></div>
  <main class="game">
    <div class="gamebar"><div class="gb-actions">
      <span class="pill eval-pill">+0.2</span><span class="pill">💪 1902?</span>
      <span class="pill">Assist</span><button class="gb-btn">↩ Takeback</button>
      <span class="gb-btn">⚙</span></div></div>
    <div class="layout">
      <div class="board-col">
        {strip.format(cls='opp', dot='black', icon='🎲', name='Jester Nox', caps=caps)}
        <div class="board-wrap"><div class="board">{BOARD_SQUARES}</div></div>
        {strip.format(cls='you', dot='white', icon='👤', name='You', caps=caps)}
      </div>
      <aside class="panels">{card}</aside>
    </div>
  </main>
  <div class="gbtabs">
    <a class="gbtab"><span class="gbtab-ic">&#127968;</span><span>Lobby</span></a>
    <a class="gbtab on"><span class="gbtab-ic">&#129302;</span><span>Play AI</span></a>
    <a class="gbtab"><span class="gbtab-ic">&#9823;</span><span>Learn</span></a>
    <a class="gbtab"><span class="gbtab-ic">&#128214;</span><span>Strategies</span></a>
    <a class="gbtab"><span class="gbtab-ic">&#8943;</span><span>More</span></a></div>
</div></body></html>"""


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/gb-render"
    os.makedirs(out, exist_ok=True)
    made = []
    for w, h in W_H:
        for state in ("peek", "choose", "guide"):
            name = f"m{w}x{h}-{state}.html"
            path = os.path.join(out, name)
            with open(path, "w") as f:
                f.write(page(w, h, state))
            made.append(path)
    # QuickLook renders at a requested max dimension; ask for enough to read text.
    subprocess.run(["qlmanage", "-t", "-s", "900", "-o", out] + made,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    pngs = sorted(p for p in os.listdir(out) if p.endswith(".png"))
    print("rendered %d frames into %s" % (len(pngs), out))
    for p in pngs:
        print("   " + os.path.join(out, p))


if __name__ == "__main__":
    main()
