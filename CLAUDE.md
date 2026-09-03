# CLAUDE.md — Operating Agreement for Glassboard

This file governs how Claude Code works in this repository. It derives from and must stay
consistent with **[docs/VISION.md](docs/VISION.md)** — the founding document. When this file
and the vision conflict, the vision wins and this file should be corrected.

**Last updated:** 2026-08-30 · **Status:** Living document, expected to grow with the project.

---

## What we're building (one line)

**Glassboard** — *"Chess, in the open."* Chess where AI assistance is a **first-class,
transparent, adjustable** part of gameplay — a fair handicap between unequal players, designed
so the weaker player learns to need it less. Full context: [docs/VISION.md](docs/VISION.md).

## Non-negotiable guardrails (the spine)

Every change must respect these. When in doubt, stop and check against the vision.

1. **No hidden help, ever.** Any assistance a player receives must be visible to their
   opponent. Never build a path where AI help can be secret. Full glass-box is the default.
2. **Defaults protect fairness.** The most equalizing, most transparent configuration is
   always the free default. Extra control is *earned* through progression, never assumed.
3. **Strength is measured, not assumed.** Any claim about playing strength or assistance
   calibration must be backed by a reproducible measurement (perft, test suites, SPRT,
   self-play Elo) — never by vibes.
4. **Assistance is a ladder down, not a crutch.** Prefer designs that help players improve and
   need less help over time.

If a requested change appears to violate one of these, say so explicitly and propose an
alternative rather than silently implementing it.

## How to work here

- **Read the vision first** for any feature-level work. Cite which vision section a change
  serves.
- **Measurement discipline:** changes that affect playing strength must be validated with the
  strength tooling (see `strength-bench` skill once it exists). No unmeasured strength claims.
- **Small, verifiable steps.** Chess engines fail silently; prefer incremental changes each
  backed by a correctness check (e.g. perft for move-gen).
- **Transparency by construction:** when building any assistance feature, build the
  both-sides-visible surface in the same change — not as a follow-up.

## Tech stack

**DECIDED (2026-09-03).** Principle: **Portable Core + Thin Platform Shells** — full detail in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

- **Core:** **Rust** → compiled to **WebAssembly** (web) + **native** (desktop/mobile/console).
  Holds engine, rules, assistance spectrum, handicap calc, transparency log, and neural inference.
- **Training:** **Python + PyTorch** (offline; ships only trained weights to the core).
- **Shells:** **Web first — TypeScript + React** over the WASM core; Tauri/native/console later.

The core exists so behavior — the handicap, and the glass-box log — is **identical on every
platform**. That is a fairness requirement, not just convenience.

## Build / test / run commands

_To be filled in once the tech stack is chosen and the first scaffold exists._

## Repository layout

```
docs/
  VISION.md        # Founding document — the anchor. Start here.
  ARCHITECTURE.md  # (planned) system design; deferred until stack is chosen
CLAUDE.md          # This file — operating agreement
.claude/
  skills/          # (planned) repo-specific Claude Code skills — see roster below
```

## Skills roster (planned)

Repo-specific skills that encode the disciplines the vision demands:

- **`vision-check`** — review a change against the vision non-negotiables. (Buildable now.)
- **`transparency-audit`** — verify assistance features are visible to both players. (Stub now.)
- **`strength-bench`** — run the strength ruler: perft, tactical suites, self-play Elo, SPRT.
- **`assist-calibrate`** — validate an assistance rung hits its intended effective-Elo offset.

## Open decisions (decide before deep implementation)

1. ~~**Tech stack**~~ — ✅ **DECIDED 2026-09-03** (Portable Core + Thin Shells; see Tech stack
   above and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).
2. **Strength ruler baseline** — which measurement suites and self-play protocol define "plays
   strongly," and the target Elo band.
3. **Assistance rung spec** — the concrete definition of each rung and how it maps to an
   effective-Elo offset.
4. **Progression/unlock design** — milestones that unlock control over the handicap and
   transparency dials.
