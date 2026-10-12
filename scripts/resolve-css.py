#!/usr/bin/env python3
"""Resolve a stylesheet FOR ONE VIEWPORT: flatten @media, substitute viewport units.

Why this exists — and it is the most important lesson in this repo's tooling:

    macOS QuickLook (`qlmanage`) is the only WebKit renderer available here, and it
    lays out HTML at a DESKTOP viewport width no matter what thumbnail size you ask
    for. Putting the page inside a 393px-wide <div> makes it LOOK like a phone but
    `@media (max-width: 860px)` is evaluated against the WINDOW, so it never matches.

    Three mobile layout regressions shipped after I "verified them in WebKit". The
    renders were real — they were just rendering the DESKTOP stylesheet in a
    phone-shaped box. A verification tool that silently tests the wrong thing is
    worse than no tool, because it manufactures confidence.

So: evaluate every @media condition here, in Python, against the device we claim to
be testing, and inline the matching blocks IN PLACE (cascade order preserved) while
dropping the rest. Then substitute what else depends on the viewport — vh/dvh/vw and
env() safe areas — so the remaining CSS is viewport-independent and QuickLook's own
window size cannot change the outcome.

What this does NOT model: scrolling, the collapsing Safari URL bar (dvh is resolved
to the full height given), and anything JavaScript does at runtime. It answers
"where do the boxes land at 393x660 under the mobile stylesheet", faithfully.

Usage:  resolve_css(css, width, height) -> css
        python3 scripts/resolve-css.py <css> <w> <h>   # prints to stdout
"""
import re
import sys


def _feature(name, value, w, h, dark):
    """Evaluate one media feature. Unknown features are treated as NOT matching,
    which is the safe direction: a rule is dropped rather than wrongly applied."""
    name = name.strip().lower()
    value = (value or "").strip().lower()

    def px(v):
        m = re.match(r"^([\d.]+)\s*px$", v)
        if m:
            return float(m.group(1))
        m = re.match(r"^([\d.]+)\s*r?em$", v)
        if m:
            return float(m.group(1)) * 16
        return None

    if name in ("min-width", "max-width", "width"):
        v = px(value)
        if v is None:
            return False
        return w >= v if name == "min-width" else (w <= v if name == "max-width" else w == v)
    if name in ("min-height", "max-height", "height"):
        v = px(value)
        if v is None:
            return False
        return h >= v if name == "min-height" else (h <= v if name == "max-height" else h == v)
    if name == "orientation":
        return value == ("portrait" if h >= w else "landscape")
    if name == "prefers-color-scheme":
        return value == ("dark" if dark else "light")
    if name == "prefers-reduced-motion":
        return value in ("no-preference", "")
    if name == "hover":
        return value == "none"          # a phone has no hover
    if name == "pointer":
        return value == "coarse"
    if name == "display-mode":
        return value == "browser"
    return False


def _query_matches(q, w, h, dark):
    """One comma-separated query, e.g. `screen and (max-width: 860px)`."""
    q = q.strip().lower()
    if q.startswith("not "):
        return not _query_matches(q[4:], w, h, dark)
    ok = True
    for part in re.split(r"\band\b", q):
        part = part.strip()
        if not part:
            continue
        if part in ("screen", "all", "only screen", "only all"):
            continue
        if part == "print":
            return False
        m = re.match(r"^\(\s*([a-z-]+)\s*(?::\s*(.+?))?\s*\)$", part)
        if not m:
            return False
        ok = ok and _feature(m.group(1), m.group(2), w, h, dark)
    return ok


def _matches(cond, w, h, dark):
    return any(_query_matches(q, w, h, dark) for q in cond.split(","))


def _units(css, w, h):
    """Substitute every viewport-dependent value with the device's own pixels."""
    def rep(m):
        n, unit = float(m.group(1)), m.group(2)
        base = w if unit.endswith("vw") else h
        return "%.3fpx" % (n * base / 100.0)
    css = re.sub(r"(?<![\w.-])([\d.]+)(dvh|svh|lvh|vh|dvw|svw|lvw|vw)\b", rep, css)
    # env() safe areas: use the declared fallback, else 0. QuickLook has no notch;
    # a REAL device adds its inset on top, which only ever pushes content further
    # from the edge, so treating it as 0 is the tight (pessimistic) case for the
    # question "does everything fit".
    css = re.sub(r"env\(\s*safe-area-inset-[a-z]+\s*(?:,\s*([^()]*?)\s*)?\)",
                 lambda m: (m.group(1) or "0px"), css)
    return css


def resolve_css(css, w, h, dark=True):
    out, i, n = [], 0, len(css)
    while i < n:
        j = css.find("@media", i)
        if j < 0:
            out.append(css[i:])
            break
        out.append(css[i:j])
        k = css.index("{", j)
        cond = css[j + len("@media"):k]
        depth, m = 0, k
        while m < n:
            if css[m] == "{":
                depth += 1
            elif css[m] == "}":
                depth -= 1
                if depth == 0:
                    break
            m += 1
        body = css[k + 1:m]
        if _matches(cond, w, h, dark):
            # Inlined IN PLACE so the cascade order is exactly what a browser sees.
            out.append("\n/* @media%s MATCHED */\n%s\n" % (cond.rstrip(), body))
        else:
            out.append("\n/* @media%s dropped */\n" % cond.strip())
        i = m + 1
    return _units("".join(out), w, h)


def _self_test():
    """Guard the guard. If this ever regresses, the renderer goes back to showing
    desktop CSS in a phone-shaped box — which is exactly how three broken mobile
    layouts got reported as verified."""
    css = ("a{color:red}\n"
           "@media (max-width: 860px){ .m{display:block} }\n"
           "@media (min-width: 861px){ .d{display:grid} }\n"
           "@media (max-width: 860px) and (max-height: 700px){ .short{top:1px} }\n"
           "@media (prefers-color-scheme: dark){ .k{color:#fff} }\n"
           ".v{height:calc(100dvh - 300px);width:50vw;bottom:env(safe-area-inset-bottom, 8px)}\n")
    phone = resolve_css(css, 393, 660)
    tall = resolve_css(css, 393, 800)
    desk = resolve_css(css, 1280, 900)
    checks = [
        ("phone keeps the mobile block", ".m{display:block}" in phone),
        ("phone drops the desktop block", ".d{display:grid}" not in phone),
        ("short phone keeps the short-screen block", ".short{top:1px}" in phone),
        ("tall phone drops the short-screen block", ".short{top:1px}" not in tall),
        ("desktop drops the mobile block", ".m{display:block}" not in desk),
        ("desktop keeps the desktop block", ".d{display:grid}" in desk),
        ("dark scheme matches", ".k{color:#fff}" in phone),
        ("dvh resolved", "calc(660.000px - 300px)" in phone),
        ("vw resolved", "196.500px" in phone),
        ("env() falls back", "bottom:8px" in phone),
    ]
    bad = [n for n, ok in checks if not ok]
    for n, ok in checks:
        print(("  ok   " if ok else "  FAIL ") + n)
    return 1 if bad else 0


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        sys.exit(_self_test())
    if len(sys.argv) < 4:
        print("usage: resolve-css.py <css-file> <width> <height>", file=sys.stderr)
        sys.exit(2)
    sys.stdout.write(resolve_css(open(sys.argv[1]).read(), int(sys.argv[2]), int(sys.argv[3])))
