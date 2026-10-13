#!/usr/bin/env python3
"""Catch `const`/`let` used BEFORE it is declared, inside the same function.

The bug this exists for (web/multiplayer.js, shipped 2026-10-14):

    const opp = S.playerStripHTML({ clock: ctl ? GBClock.fmt(oppMs) : "", ... });
    ...
    const ctl = state.minutes > 0;          // declared AFTER the line that reads it

`const` is hoisted but stays in the temporal dead zone, so reading it first throws
`ReferenceError: Cannot access 'ctl' before initialization` at RUNTIME ONLY. It
parses cleanly, so `checkModuleSyntax` passes and every test that doesn't execute
that exact line passes too. In a human game it threw on the second of fourteen
renderers in paint(), and because paint() had no error handling it silently took
out the player strips, the captures, the Glass Lens, the coach, the strategy
panel, the move list, the glass log, the budget and the status line. The visible
symptom was "the game play did not include the assistance".

The check: for every top-level `function` in a file, look at the declarations made
directly in its body and flag any whose name is READ earlier in that same body.
Uses inside a nested function are ignored — those run later, which is legitimate
and the usual source of false positives.

KNOWN LIMITATION: strings are blanked with a simple scanner, so prose inside a
NESTED template literal (a `${ ... `text` ... }` inside another template) can leak
through and be reported as a variable read. Two such false positives exist today
(main.js renderPlanPanel `x`, helpBudgetHtml `refused`). A template-aware scanner
was tried and it stopped detecting the real renderPlayers bug, which is the wrong
trade: this check exists to catch that class, so it keeps the two false alarms
rather than risk a silent miss. Run it as an advisory check, read the output.

Usage:  python3 scripts/check-tdz.py web/main.js web/multiplayer.js
"""
import re
import sys


def _blank_nested(body):
    """Replace nested function/arrow bodies with spaces, keeping offsets intact.

    A name used inside a callback is fine — the callback runs after the
    declaration — so those uses must not be treated as early reads."""
    out = list(body)
    i, n = 0, len(body)
    while i < n:
        hit = None
        if body.startswith("function", i) and (i == 0 or not body[i - 1].isalnum()):
            hit = i
        elif body.startswith("=>", i):
            hit = i
        if hit is not None:
            b = body.find("{", hit)
            if b != -1 and body[hit:b].count(";") == 0 and body[hit:b].count(")") <= 2:
                depth, j = 0, b
                while j < n:
                    if body[j] == "{":
                        depth += 1
                    elif body[j] == "}":
                        depth -= 1
                        if depth == 0:
                            break
                    j += 1
                for k in range(b, min(j + 1, n)):
                    out[k] = " "
                i = j + 1
                continue
        i += 1
    return "".join(out)


def _strings_out(s):
    """Blank string and comment contents so names inside them aren't 'uses'."""
    out, i, n = list(s), 0, len(s)
    while i < n:
        c = s[i]
        if c in "\"'`":
            j = i + 1
            while j < n and s[j] != c:
                if s[j] == "\\":
                    j += 1
                j += 1
            for k in range(i, min(j + 1, n)):
                out[k] = " "
            i = j + 1
        elif False:
            j = i + 1
            while j < n and s[j] != c:
                if s[j] == "\\":
                    j += 1
                j += 1
            for k in range(i, min(j + 1, n)):
                out[k] = " "
            i = j + 1
        elif s.startswith("//", i):
            j = s.find("\n", i)
            j = n if j < 0 else j
            for k in range(i, j):
                out[k] = " "
            i = j
        elif s.startswith("/*", i):
            j = s.find("*/", i)
            j = n if j < 0 else j + 2
            for k in range(i, j):
                out[k] = " "
            i = j
        else:
            i += 1
    return "".join(out)


def check(path):
    src = open(path).read()
    clean = _strings_out(src)
    problems = []
    for m in re.finditer(r"\nfunction\s+([A-Za-z_$][\w$]*)\s*\(", clean):
        fname = m.group(1)
        b = clean.find("{", m.end())
        if b < 0:
            continue
        depth, j = 0, b
        while j < len(clean):
            if clean[j] == "{":
                depth += 1
            elif clean[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        body = clean[b:j]
        scan = _blank_nested(body)
        # Brace depth at every offset. Only declarations in the FUNCTION'S OWN
        # scope (depth 1) are considered: a `let rank` inside one branch of an
        # if/else, or inside a for-header, is a different binding from a `rank`
        # used in the other branch, and flagging those was pure noise. Any use
        # that executes before a depth-1 declaration is a genuine dead-zone read,
        # whatever block it sits in — which is exactly the renderPlayers case,
        # where the read was two levels deep inside an object literal.
        depths, dep = [0] * len(scan), 0
        for ix, ch in enumerate(scan):
            if ch == "{":
                dep += 1
            depths[ix] = dep
            if ch == "}":
                dep -= 1
        for d in re.finditer(r"\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=", scan):
            if depths[d.start()] != 1:
                continue
            name = d.group(1)
            for u in re.finditer(r"\b%s\b" % re.escape(name), scan):
                if u.start() >= d.start(1):
                    break
                # `lvl.skill` is a PROPERTY, not a read of the variable `skill`.
                # Property access and object keys are the two big false-positive
                # sources; a linter that cries wolf gets ignored and then misses
                # the one real bug, which is the whole point of having it.
                before = scan[:u.start()].rstrip()
                if before.endswith(".") or before.endswith("?."):
                    continue
                # The match IS a declaration (`const ov = ...`), not a read of it.
                # Skipping it also lets the shadow rule below see that binding when
                # it checks the uses that follow.
                if re.search(r"\b(?:const|let)\s*$", before):
                    continue
                after = scan[u.end():].lstrip()
                if after.startswith(":") and (before.endswith("{") or before.endswith(",")):
                    continue
                # SHADOWING: `if (sim) { const ov = ...; ov.style... }` followed by
                # an outer `const ov` later. The inner use reads the inner binding
                # and is perfectly legal. If the name was already declared deeper
                # than the declaration under test, this use isn't ours.
                shadowed = False
                for sd in re.finditer(r"\b(?:const|let)\s+%s\b" % re.escape(name), scan[:u.start()]):
                    if depths[sd.start()] > 1:
                        shadowed = True
                        break
                if shadowed:
                    continue
                line = src.count("\n", 0, b + u.start()) + 1
                problems.append((line, fname, name))
                break
    return problems


def main(paths):
    bad = 0
    for p in paths:
        probs = check(p)
        if probs:
            bad += len(probs)
            for line, fn, name in probs:
                print("  FAIL %s:%d  `%s` is read before it is declared in %s()"
                      % (p, line, name, fn))
        else:
            print("  ok   %s has no use-before-declaration" % p)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["web/main.js", "web/multiplayer.js"]))
