---
name: deploy-hosting-gotchas
description: "Glassboard deploy/hosting facts — free Pages needs a PUBLIC repo; empty commits don't deploy; game data is in Neon, not GitHub"
metadata: 
  node_type: memory
  type: reference
  originSessionId: c65ecd65-db19-49ae-aedc-6cff58478ed3
  modified: 2026-09-20T00:25:37.674Z
---

Glassboard hosting (learned the hard way 2026-09-20):

- **The client** deploys to **GitHub Pages** via `.github/workflows/pages.yml`
  (builds WASM with `scripts/build-web.sh` → `wasm-pack`, publishes `web/`).
  Live URL: **https://issamqadan.github.io/glassboard/**. Source must be
  **Settings → Pages → Source = "GitHub Actions"** (NOT "Deploy from a branch" —
  the built `pkg/` is gitignored and only exists in CI).
- **Free GitHub Pages requires a PUBLIC repo.** Flipping the repo private
  unpublishes the site AND resets the Pages source → site 404s. Going public
  again does NOT auto-re-enable it; you must re-set Source = GitHub Actions.
  If Issam ever wants the repo private, move hosting to **Cloudflare Pages**
  (free, serves private repos; `deploy-web.yml` is the scaffold — needs a CF
  account + CF_API_TOKEN + CF_ACCOUNT_ID secrets), don't just flip visibility.
- **The pages.yml `on.push.paths` filter is `core/**`, `web/**`,
  `scripts/build-web.sh`, `.github/workflows/pages.yml`.** An **empty commit
  triggers NOTHING** — to force a redeploy, change a real file under those paths
  (or use the Actions "Run workflow" / "Re-run all jobs" button).
- **Game DATA is NOT in GitHub.** Accounts/games/profiles/rivals live in **Neon
  Postgres** behind the **Render** server (playglassboard.onrender.com). Repo
  visibility flips can't touch it. Render auto-deploys from GitHub too, but the
  running server + Neon persist regardless.
- The "**Deploy web**" workflow (`deploy-web.yml`, Cloudflare) is an UNUSED second
  target that fails on every push (missing secrets) — safe to delete to stop the
  red X noise. The real one is "**Deploy to GitHub Pages**".
- Deployed `.wasm` on Pages sits behind a CDN edge cache — verify freshness with a
  hard cache-bust (`?x=<timestamp+nanos>`), not `?cb=$RANDOM`.
