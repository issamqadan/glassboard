# Glassboard multiplayer server (M5)

A minimal, engine-validated WebSocket server for two-player online games. The
server is the **authority**: every move is checked against `glassboard-engine`,
so a client can't make an illegal move. It relays the position and the glass-box
to both players. No domain required — run it locally or on a free server host.

## Run locally

```sh
cargo run                 # listens on ws://0.0.0.0:9001
cargo test                # room-logic tests
```

Override the bind address with `GLASSBOARD_ADDR`, e.g.
`GLASSBOARD_ADDR=0.0.0.0:8080 cargo run`.

## Play

1. Start this server, and serve the web app: `(cd ../web && python3 -m http.server 8000)`.
2. Open `http://localhost:8000/multiplayer.html` in two browser windows.
3. Both enter the **same Room** code and click **Connect** (first = White, second = Black).

### Two devices on the same Wi-Fi

1. Find your machine's LAN IP: `ipconfig getifaddr en0` (e.g. `192.168.1.20`).
2. Your friend opens `http://192.168.1.20:8000/multiplayer.html`.
3. Set the **Server** field to `ws://192.168.1.20:9001` in both browsers, same room.

## Protocol (JSON text frames)

- client → server: `{"t":"join","room":"CODE","elo":1200}` · `{"t":"move","uci":"e2e4"}` ·
  `{"t":"glass","summary":"..."}` · `{"t":"reset"}`
- server → client: `{"t":"joined","color":"white","fen":"..."}` · `{"t":"full"}` ·
  `{"t":"state","fen":...,"turn":...,"status":...,"last":...,"white_elo":..,"black_elo":..}` ·
  `{"t":"glass","side":...,"summary":...}`

## Deploy to a free host (Fly.io)

Fly gives a `*.fly.dev` hostname with TLS (so browsers on an HTTPS site can use
`wss://`). Outline (see docs/DEPLOY.md for the full walk-through):

1. Install flyctl, `fly auth signup`.
2. From the repo root, `fly launch` (Rust is auto-detected; set the internal port
   to `9001`, or set `GLASSBOARD_ADDR=0.0.0.0:8080` and use 8080).
3. `fly deploy` → you get `wss://glassboard-xxxx.fly.dev`. Put that in the web
   app's **Server** field.
