# Architecture — Glassboard

> **Status:** Governing document. Describes the *how*. Must stay consistent with
> [VISION.md](VISION.md) (the *why/what*); when they conflict, the vision wins.
> **Last updated:** 2026-09-03

---

## 1. Guiding principle: Portable Core + Thin Platform Shells

Put **everything that defines the game** — engine, rules, the assistance spectrum, the
handicap calculation, and the transparency/glass-box log — into **one portable core**. Make
each platform's UI as **thin** as possible (render + input only).

Two payoffs, and the second is a vision requirement:

1. **"Web now, console later" is cheap** — every new platform reuses the same core.
2. **Behavior is identical everywhere.** The handicap must compute the *same* on every
   platform, and every bit of assistance must be logged to the glass-box *the same way*. If
   the rules lived in each shell, fairness would drift per platform. The portable core makes
   the non-negotiables structurally true.

## 2. Layers

| Layer | Tech | Responsibility |
|-------|------|----------------|
| **Core** | **Rust** → compiled to **WebAssembly** (web) and **native** (desktop/mobile/console) | Board representation, legal move generation, search, evaluation, the assistance spectrum, the Assistance-Handicap calculation, the transparency log, and **neural inference**. The entire brain, written once. |
| **Training** | **Python + PyTorch** | Offline self-play and network training. Runs *off* the client; its only output shipped to users is **trained network weights**, which the Rust core loads for inference. Never ships as a runtime dependency. |
| **Shells** | **Web first: TypeScript + React** over the WASM core. Later: **Tauri** (desktop, Rust-native), **React Native / native** (mobile), native bindings (console). | Rendering + input only. Each shell is a thin face over the same core. Web is first: the glass-box, both-sides-visible experience is a natural web fit and ships to real users fastest. |

## 3. Key architectural decisions

- **Neural inference lives in the core, not Python.** Training happens in Python; the trained
  net is exported (embedded weights / a portable format) and evaluated *inside* the Rust core
  — the way modern engines run NNUE in-engine. This keeps the client dependency-free and
  identical across platforms.
- **The rung↔mode mapping lives in the core.** Players choose a **mode** (Classic / Matched /
  Open / Adaptive / Training — see VISION.md §3); the core maps that to the assistance
  spectrum, computes the handicap, and decides what help (if any) is produced.
- **Transparency is a core service, not a UI feature.** Every assistance invocation writes to
  a **glass-box log** in the core that *both* players' shells render. Assistance that isn't
  logged is impossible by construction — enforcing "no hidden help, ever."
- **Strength is measured in the core's test harness.** Perft (move-gen correctness), tactical
  suites, and self-play/SPRT live alongside the engine so every strength claim is reproducible
  (VISION.md non-negotiable #3).

## 4. Planned repository layout

```
glassboard/
├── core/                 # Rust portable core (cargo workspace)
│   ├── engine/           #   board, movegen, search, eval
│   ├── assist/           #   assistance spectrum, handicap calc, transparency log
│   ├── nn/               #   neural inference (loads trained weights)
│   └── bindings/         #   wasm-bindgen (web) + FFI (native)
├── training/             # Python + PyTorch: self-play, training, weight export
├── web/                  # TypeScript + React shell (first platform)
├── docs/                 # VISION.md, ARCHITECTURE.md
├── .claude/skills/       # repo-specific Claude Code skills
└── CLAUDE.md             # operating agreement
```

## 5. Roadmap (each milestone ends at something verifiable)

| # | Milestone | Done when… |
|---|-----------|-----------|
| **M0** | **Core scaffold: board + legal move generation** | **Perft** matches known node counts for standard positions. (The correctness gate.) |
| **M1** | Search + basic evaluation | Engine plays legal, non-trivial games; baseline strength measured on tactical suites. |
| **M2** | WASM binding + minimal web shell | You can play a full **Classic** game in the browser against the core. |
| **M3** | Assistance layer + glass-box log | **Matched** mode with a first handicap model; awareness/coaching rungs; both-sides-visible transparency surface. |
| **M4** | Neural eval (train in Python, infer in Rust) | *Tunable* strength to a target level; `assist-calibrate` skill validates a rung's effective-Elo offset. |
| **M5** | Progression + remaining modes | Unlocks; Open / Adaptive / Training modes. |

## 6. Toolchain (to confirm at M0)

- **Rust** stable + `cargo`; `wasm-bindgen` / `wasm-pack` for the web target.
- **Python** 3.12+ with **PyTorch** for `training/`.
- **Node + TypeScript + React** (Vite) for `web/`.
- Testing: `cargo test` (incl. perft), plus a strength-bench harness (the `strength-bench`
  skill) for suites and SPRT.
