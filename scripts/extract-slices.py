#!/usr/bin/env python3
"""Rebuild the verbatim slices of web/main.js that the web tests load.

The tests exercise real code, not copies of it: each slice is cut out of the
source on every run, so a test can never pass against a stale duplicate of the
thing it checks.

Slices are BRACE-MATCHED from a function's signature rather than anchored on a
line of code inside the function. Anchored extraction broke twice when the code
it pointed at was edited — and an extractor that fails is a test that silently
stops protecting you.

Usage:  python3 scripts/extract-slices.py <output-dir>
"""
import sys
import os

SRC = "web/main.js"


def block(s, start_text):
    """Source from `start_text` through the brace closing its first `{`."""
    a = s.index(start_text)
    i = s.index("{", a)
    depth, j = 0, i
    while True:
        if s[j] == "{":
            depth += 1
        elif s[j] == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    return s[a:j + 1]


def main():
    if len(sys.argv) < 2:
        print("usage: extract-slices.py <output-dir>", file=sys.stderr)
        return 2
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    s = open(SRC).read()

    def write(name, text):
        with open(os.path.join(out, name), "w") as f:
            f.write(text)

    def fn(name):
        return block(s, "function %s(" % name)

    # The help/takeback allowance state plus spendHelp/scarceAvailable.
    start = s.index("let helpMax = 0;")
    end = s.index("\n}", s.index("  return true;\n}", s.index("function spendHelp"))) + 2
    write("bwire.js", s[start:end])

    write("assess.js", fn("assessPosition"))
    write("aiask.js", fn("maybeAiAsksForHelp"))

    # applyEngineMove + anyLegalMove + ensureTurnProgress, as one run of source.
    start = s.index("// Play `uci` for the engine.")
    end = s.index("\n}", s.index("  engineReply();", s.index("function ensureTurnProgress"))) + 2
    write("deadlock.js", s[start:end])

    # The level ladder + aiBoost, then adviceMovetime.
    start = s.index("const AI_LEVELS = [")
    end = s.index("\n}", s.index("return { lean, skill, movetime, depth, base: lvl.skill")) + 2
    write("extract.js", s[start:end] + "\n" + fn("adviceMovetime") + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
