# Deploy — Glassboard (invite-only test)

How to put the current web app online, behind an invite gate, for early testers.

> **Scope today:** the deployed app is fully client-side (WASM). Testers can play
> the **assisted game vs the engine** — the handicap, tiered assistance, and
> glass-box — with **no backend**. Human-vs-human *across devices* needs the
> multiplayer server (a later milestone); the two-window hotseat only syncs on
> one machine.

## 0. Build the static bundle

```sh
./scripts/build-web.sh
```

This compiles the Rust core to WASM into `web/pkg/` and leaves the publishable
static site in `web/`. (`web/pkg/` is git-ignored; CI or this script regenerates
it.)

## 1. Host: Cloudflare Pages (free, fast, custom domain, auto-HTTPS)

Fastest path — direct upload, no build config needed since we build locally:

1. Install wrangler once: `npm i -g wrangler` (or use `npx wrangler`).
   - No Node? Use the **Netlify** alternative in §4, or the Cloudflare dashboard
     "Direct Upload" (drag the `web/` folder).
2. `./scripts/build-web.sh`
3. `wrangler pages deploy web --project-name=glassboard`
4. First run prompts a Cloudflare login and creates the `glassboard` Pages project.

You'll get a `*.pages.dev` URL immediately.

## 2. Point your domain (glassboard.gg)

In the Cloudflare Pages project → **Custom domains** → add `glassboard.gg` (and/or
`play.glassboard.gg`). Follow the DNS instructions (easiest if the domain's
nameservers are on Cloudflare). HTTPS is automatic.

## 3. Invite-only gate: Cloudflare Access (free ≤ 50 users)

This is the zero-code way to keep it private to your testers:

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → add a
   self-hosted app for `glassboard.gg`.
2. Policy: **Allow** → **Emails** → paste your testers' email addresses (or
   **Emails ending in** a domain).
3. Save. Now visitors must verify their email (one-time PIN) before the site
   loads; everyone else is blocked. Remove the app to go public later.

## 4. Alternative host: Netlify (no CLI needed)

1. `./scripts/build-web.sh`
2. Drag the `web/` folder onto <https://app.netlify.com/drop>.
3. Add the custom domain in Site settings. (Netlify password protection is a paid
   add-on; for free invite-gating prefer Cloudflare Access above.)

## 5. Optional: automate on push (GitHub Actions)

`.github/workflows/deploy-web.yml` builds the WASM and deploys to Cloudflare Pages
on every push to `main`. Set these repo secrets first
(Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — a token with the **Pages: Edit** permission.
- `CLOUDFLARE_ACCOUNT_ID` — from the Cloudflare dashboard URL / Workers & Pages page.

Until those secrets exist, the workflow is inert (it only runs on push and will
fail fast without them) — the manual path in §1 works regardless.

## Local testing (all modes, no host, no domain)

- **vs the engine:** `(cd web && python3 -m http.server 8000)` → <http://localhost:8000>
- **hotseat, two windows (same machine):** open
  `http://localhost:8000/twoplayer.html` in two windows; pick White in one, Black
  in the other.
- **online multiplayer (two devices):**
  1. Terminal 1 — server: `(cd server && cargo run)` → `ws://…:9001`
  2. Terminal 2 — web: `(cd web && python3 -m http.server 8000)`
  3. Two browsers → `http://localhost:8000/multiplayer.html`, same **Room**, Connect.
  4. **Same Wi-Fi with a friend:** they open `http://<your-LAN-ip>:8000/multiplayer.html`
     and set the **Server** field to `ws://<your-LAN-ip>:9001`
     (find your IP with `ipconfig getifaddr en0`).

## Multiplayer server on a free host (for play over the internet)

The static site can live on Pages/Netlify, but the WebSocket **server** needs a
real server host. Free options that give a URL + TLS (`wss://`): **Fly.io**
(`*.fly.dev`), Railway, Render.

Outline (Fly.io): install `flyctl` → `fly auth signup` → deploy the `server/`
crate → get `wss://<name>.fly.dev` → paste that into the web app's **Server**
field. Because the server depends on the workspace (`../core/engine`), the
reliable build is a small **Dockerfile** — ask me to generate the `Dockerfile`
+ `fly.toml` when you're ready to deploy the server, and I'll wire it up.

## Notes

- **No server cost** for the static (vs-AI) phase — static hosting is free.
- Cache busting: after redeploying, testers may need a hard refresh (⌘⇧R) for
  updated `main.js` / `style.css`.
- Keep the invite list small; Cloudflare Access free tier covers up to 50 seats.
