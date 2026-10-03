//! Glassboard multiplayer server (M5 + lobby registry).
//!
//! WebSocket game play plus a small HTTP lobby API, on axum. Games persist in
//! memory with **identity-based seating** (host → White, guest → Black, keyed by
//! player id) so a player keeps their colour across reconnects and the lobby can
//! report status. Bind address: `PORT` → `GLASSBOARD_ADDR` → `0.0.0.0:9001`.
//!
//! HTTP:
//!   GET  /                      health / WebSocket upgrade
//!   POST /games  {id,pid,name,rating}   pre-register a game (host takes White)
//!   GET  /games?player=<pid>            list a player's games + status
//!
//! WebSocket (JSON text frames):
//!   client → server:  {"t":"join","room":"ID","elo":1200,"pid":"..","name":".."}
//!                     | {"t":"move","uci":"e2e4"} | {"t":"glass","summary":".."} | {"t":"reset"}
//!   server → client:  {"t":"joined","color":"white","fen":..} | {"t":"full"}
//!                     | {"t":"state",..} | {"t":"glass",..}

mod room;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        FromRef, Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use engine::Color;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tokio::sync::{broadcast, Mutex};
use tower_http::cors::CorsLayer;

use room::{GlassEntry, Player, Room, Seats};

struct RoomState {
    room: Room,
    tx: broadcast::Sender<String>,
    seats: Seats,
    /// Unix seconds when the room was created (for "started N ago" in the lobby).
    started: u64,
    /// "match" (declared handicap, ratings, measured) | "casual" (free, unlimited
    /// two-sided assistance, no ratings).
    mode: String,
    /// A pending casual takeback request — the colour that asked (awaiting the
    /// opponent's yes/no).
    pending_undo: Option<Color>,
}
type Rooms = Arc<Mutex<HashMap<String, RoomState>>>;

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// A registered player. `key` in the map is the username lowercased.
#[derive(Clone)]
struct Account {
    id: String,
    name: String,
    pin: String,
    rating: i32,
}
/// In-memory account registry. NOTE: Render's free tier wipes memory when the
/// server sleeps — swap this for Postgres (Neon) to make accounts durable.
type Players = Arc<Mutex<HashMap<String, Account>>>;

/// Account storage: durable Postgres (Neon) when DATABASE_URL is set, else an
/// in-memory registry (fine for local/dev; wiped when the server restarts).
#[derive(Clone)]
enum Store {
    Memory(Players),
    Pg(sqlx::PgPool),
}

struct AccountOut {
    id: String,
    name: String,
    rating: i32,
    returning: bool,
}
enum AccountErr {
    WrongPin,
    Server,
}

impl Store {
    /// Claim a username with a PIN, or sign back in with the same pair.
    async fn account(&self, name: &str, pin: &str, rating: i32) -> Result<AccountOut, AccountErr> {
        let key = name.to_lowercase();
        let id = format!("u_{key}");
        match self {
            Store::Memory(players) => {
                let mut map = players.lock().await;
                if let Some(acc) = map.get(&key) {
                    if acc.pin != pin {
                        return Err(AccountErr::WrongPin);
                    }
                    return Ok(AccountOut { id: acc.id.clone(), name: acc.name.clone(), rating: acc.rating, returning: true });
                }
                map.insert(key, Account { id: id.clone(), name: name.to_string(), pin: pin.to_string(), rating });
                Ok(AccountOut { id, name: name.to_string(), rating, returning: false })
            }
            Store::Pg(pool) => {
                let existing = sqlx::query("SELECT id, name, pin, rating FROM players WHERE key = $1")
                    .bind(&key)
                    .fetch_optional(pool)
                    .await
                    .map_err(|_| AccountErr::Server)?;
                if let Some(row) = existing {
                    let db_pin: String = row.get("pin");
                    if db_pin != pin {
                        return Err(AccountErr::WrongPin);
                    }
                    return Ok(AccountOut {
                        id: row.get("id"),
                        name: row.get("name"),
                        rating: row.get("rating"),
                        returning: true,
                    });
                }
                sqlx::query("INSERT INTO players (key, id, name, pin, rating) VALUES ($1, $2, $3, $4, $5)")
                    .bind(&key)
                    .bind(&id)
                    .bind(name)
                    .bind(pin)
                    .bind(rating)
                    .execute(pool)
                    .await
                    .map_err(|_| AccountErr::Server)?;
                Ok(AccountOut { id, name: name.to_string(), rating, returning: false })
            }
        }
    }
}

/// Build the account store from the environment: Postgres if DATABASE_URL is set
/// (creating the table on first run), otherwise in-memory.
async fn build_store() -> Store {
    match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => {
            let pool = sqlx::postgres::PgPoolOptions::new()
                .max_connections(5)
                .connect(&url)
                .await
                .expect("connect to DATABASE_URL");
            sqlx::query(
                "CREATE TABLE IF NOT EXISTS players (\
                   key TEXT PRIMARY KEY, id TEXT NOT NULL, name TEXT NOT NULL, \
                   pin TEXT NOT NULL, rating INT NOT NULL)",
            )
            .execute(&pool)
            .await
            .expect("create players table");
            sqlx::query(
                "CREATE TABLE IF NOT EXISTS games (\
                   id TEXT PRIMARY KEY, fen TEXT NOT NULL, last_uci TEXT, \
                   resigned TEXT NOT NULL DEFAULT '', white_elo INT NOT NULL, black_elo INT NOT NULL, \
                   host_id TEXT, host_name TEXT, host_rating INT, \
                   guest_id TEXT, guest_name TEXT, guest_rating INT, \
                   glass TEXT NOT NULL DEFAULT '[]', started BIGINT NOT NULL, \
                   mode TEXT NOT NULL DEFAULT 'match')",
            )
            .execute(&pool)
            .await
            .expect("create games table");
            // Migrate older tables that predate a column.
            let _ = sqlx::query("ALTER TABLE games ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'match'")
                .execute(&pool)
                .await;
            // Per-player profile — the Player Model's learning signal.
            sqlx::query(
                "CREATE TABLE IF NOT EXISTS profiles (\
                   id TEXT PRIMARY KEY, moves BIGINT NOT NULL DEFAULT 0, \
                   hung BIGINT NOT NULL DEFAULT 0, missed BIGINT NOT NULL DEFAULT 0)",
            )
            .execute(&pool)
            .await
            .expect("create profiles table");
            // Solo vs-AI games: durable so a player can resume on any device. Only
            // in-progress games live here; a finished game is deleted by the client.
            sqlx::query(
                "CREATE TABLE IF NOT EXISTS ai_games (\
                   id TEXT PRIMARY KEY, pid TEXT NOT NULL, fen TEXT NOT NULL, \
                   human_elo INT NOT NULL, engine_elo INT NOT NULL, updated BIGINT NOT NULL)",
            )
            .execute(&pool)
            .await
            .expect("create ai_games table");
            // Playtest feedback — the exit-gate signal: did each player find the
            // game fun and fair? Collected centrally so both devices report in.
            sqlx::query(
                "CREATE TABLE IF NOT EXISTS feedback (\
                   ts BIGINT NOT NULL, game_id TEXT NOT NULL DEFAULT '', player TEXT NOT NULL DEFAULT '', \
                   mode TEXT NOT NULL DEFAULT '', fun INT NOT NULL, fair INT NOT NULL, note TEXT NOT NULL DEFAULT '')",
            )
            .execute(&pool)
            .await
            .expect("create feedback table");
            // Play scores — cumulative per player (Self + Assist = Total) + a light
            // strength rating. Fed by the client on every finished AI game.
            sqlx::query(
                "CREATE TABLE IF NOT EXISTS scores (\
                   player TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', total BIGINT NOT NULL DEFAULT 0, \
                   self_pts BIGINT NOT NULL DEFAULT 0, assist_pts BIGINT NOT NULL DEFAULT 0, \
                   games INT NOT NULL DEFAULT 0, wins INT NOT NULL DEFAULT 0, draws INT NOT NULL DEFAULT 0, \
                   losses INT NOT NULL DEFAULT 0, rating INT NOT NULL DEFAULT 0, updated BIGINT NOT NULL DEFAULT 0)",
            )
            .execute(&pool)
            .await
            .expect("create scores table");
            // Per-game results — the log admin aggregates (win-rate per level validates
            // that the AI actually plays at the level picked).
            sqlx::query(
                "CREATE TABLE IF NOT EXISTS results (\
                   ts BIGINT NOT NULL, player TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', \
                   level TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '', accuracy INT NOT NULL DEFAULT 0, \
                   style TEXT NOT NULL DEFAULT '', opening TEXT NOT NULL DEFAULT '', points INT NOT NULL DEFAULT 0)",
            )
            .execute(&pool)
            .await
            .expect("create results table");
            // Page hits — lightweight traffic/activity for the admin view (anonymous
            // device id + the chosen name; no PII beyond that).
            sqlx::query(
                "CREATE TABLE IF NOT EXISTS hits (\
                   ts BIGINT NOT NULL, page TEXT NOT NULL DEFAULT '', visitor TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '')",
            )
            .execute(&pool)
            .await
            .expect("create hits table");
            println!("Accounts + games: Postgres (durable)");
            Store::Pg(pool)
        }
        _ => {
            println!("Accounts: in-memory (set DATABASE_URL for durable accounts)");
            Store::Memory(Arc::new(Mutex::new(HashMap::new())))
        }
    }
}

// ---- durable game persistence (Postgres) ----

struct GameRow {
    id: String,
    fen: String,
    last_uci: Option<String>,
    resigned: String,
    white_elo: i32,
    black_elo: i32,
    host: Option<Player>,
    guest: Option<Player>,
    glass: String,
    started: i64,
    mode: String,
}
fn snapshot(id: &str, rs: &RoomState) -> GameRow {
    let resigned = match rs.room.resigned {
        Some(engine::Color::White) => "white",
        Some(engine::Color::Black) => "black",
        None => "",
    }
    .to_string();
    GameRow {
        id: id.to_string(),
        fen: rs.room.fen(),
        last_uci: rs.room.last_uci.clone(),
        resigned,
        white_elo: rs.room.white_elo,
        black_elo: rs.room.black_elo,
        host: rs.seats.host.clone(),
        guest: rs.seats.guest.clone(),
        glass: serde_json::to_string(&rs.room.glass).unwrap_or_else(|_| "[]".to_string()),
        started: rs.started as i64,
        mode: rs.mode.clone(),
    }
}
async fn save_snapshot(pool: &sqlx::PgPool, g: GameRow) {
    let hi = g.host.as_ref().map(|p| p.id.clone());
    let hn = g.host.as_ref().map(|p| p.name.clone());
    let hr = g.host.as_ref().map(|p| p.rating);
    let gi = g.guest.as_ref().map(|p| p.id.clone());
    let gn = g.guest.as_ref().map(|p| p.name.clone());
    let gr = g.guest.as_ref().map(|p| p.rating);
    let _ = sqlx::query(
        "INSERT INTO games (id,fen,last_uci,resigned,white_elo,black_elo,host_id,host_name,host_rating,guest_id,guest_name,guest_rating,glass,started,mode) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) \
         ON CONFLICT (id) DO UPDATE SET fen=$2,last_uci=$3,resigned=$4,white_elo=$5,black_elo=$6,host_id=$7,host_name=$8,host_rating=$9,guest_id=$10,guest_name=$11,guest_rating=$12,glass=$13,mode=$15",
    )
    .bind(g.id).bind(g.fen).bind(g.last_uci).bind(g.resigned).bind(g.white_elo).bind(g.black_elo)
    .bind(hi).bind(hn).bind(hr).bind(gi).bind(gn).bind(gr).bind(g.glass).bind(g.started).bind(g.mode)
    .execute(pool)
    .await;
}
/// Persist one room's current state (no-op unless Postgres is configured).
async fn persist_game(store: &Store, rooms: &Rooms, id: &str) {
    let pool = match store {
        Store::Pg(p) => p.clone(),
        _ => return,
    };
    let snap = { rooms.lock().await.get(id).map(|rs| snapshot(id, rs)) };
    if let Some(s) = snap {
        save_snapshot(&pool, s).await;
    }
}
async fn delete_game_db(store: &Store, id: &str) {
    if let Store::Pg(pool) = store {
        let _ = sqlx::query("DELETE FROM games WHERE id=$1").bind(id).execute(pool).await;
    }
}
/// Reload all saved games into fresh RoomStates on boot (so games survive restarts).
async fn load_all_games(pool: &sqlx::PgPool) -> Vec<(String, RoomState)> {
    let rows = match sqlx::query(
        "SELECT id,fen,last_uci,resigned,white_elo,black_elo,host_id,host_name,host_rating,guest_id,guest_name,guest_rating,glass,started,mode FROM games",
    )
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for row in rows {
        let id: String = row.get("id");
        let fen: String = row.get("fen");
        let resigned = match row.get::<String, _>("resigned").as_str() {
            "white" => Some(engine::Color::White),
            "black" => Some(engine::Color::Black),
            _ => None,
        };
        let glass: Vec<GlassEntry> = serde_json::from_str(&row.get::<String, _>("glass")).unwrap_or_default();
        let host = row.get::<Option<String>, _>("host_id").map(|id| Player {
            id,
            name: row.get::<Option<String>, _>("host_name").unwrap_or_default(),
            rating: row.get::<Option<i32>, _>("host_rating").unwrap_or(1500),
        });
        let guest = row.get::<Option<String>, _>("guest_id").map(|id| Player {
            id,
            name: row.get::<Option<String>, _>("guest_name").unwrap_or_default(),
            rating: row.get::<Option<i32>, _>("guest_rating").unwrap_or(1500),
        });
        let room = Room {
            board: engine::parse_fen(&fen),
            white_taken: host.is_some(),
            black_taken: guest.is_some(),
            white_elo: row.get("white_elo"),
            black_elo: row.get("black_elo"),
            last_uci: row.get("last_uci"),
            resigned,
            glass,
            history: Vec::new(), // not persisted; a fresh boot can't take back pre-restart moves
        };
        let rs = RoomState {
            room,
            tx: broadcast::channel(64).0,
            seats: Seats { host, guest },
            started: row.get::<i64, _>("started") as u64,
            mode: row.get::<Option<String>, _>("mode").unwrap_or_else(|| "match".to_string()),
            pending_undo: None,
        };
        out.push((id, rs));
    }
    out
}

// ---- Player Model: the per-move learning signal ----

fn uci_to_sq(uci: &str) -> Option<u8> {
    let b = uci.as_bytes();
    if b.len() < 4 {
        return None;
    }
    let f = b[2].wrapping_sub(b'a');
    let r = b[3].wrapping_sub(b'1');
    if f < 8 && r < 8 {
        Some(r * 8 + f)
    } else {
        None
    }
}
/// Did `mover` leave a (non-pawn) piece hanging after their move?
fn left_piece_hanging(b: &engine::Board, mover: Color) -> bool {
    let opp = mover.opp();
    (0..64u8).any(|s| match b.squares[s as usize] {
        Some(p) => {
            p.color == mover
                && p.kind != engine::PieceKind::Pawn
                && p.kind != engine::PieceKind::King
                && engine::is_attacked(b, s, opp)
                && !engine::is_attacked(b, s, mover)
        }
        None => false,
    })
}
/// Was a free (non-pawn) enemy piece available before the move that `mover` skipped?
fn missed_free_capture(before: &engine::Board, mover: Color, played_to: u8) -> bool {
    let opp = mover.opp();
    (0..64u8).any(|s| match before.squares[s as usize] {
        Some(p) => {
            p.color == opp
                && p.kind != engine::PieceKind::Pawn
                && p.kind != engine::PieceKind::King
                && s != played_to
                && engine::is_attacked(before, s, mover)
                && !engine::is_attacked(before, s, opp)
        }
        None => false,
    })
}
async fn record_move(store: &Store, id: &str, hung: bool, missed: bool) {
    if id.is_empty() {
        return;
    }
    if let Store::Pg(pool) = store {
        let _ = sqlx::query(
            "INSERT INTO profiles (id, moves, hung, missed) VALUES ($1, 1, $2, $3) \
             ON CONFLICT (id) DO UPDATE SET moves = profiles.moves + 1, hung = profiles.hung + $2, missed = profiles.missed + $3",
        )
        .bind(id)
        .bind(hung as i64)
        .bind(missed as i64)
        .execute(pool)
        .await;
    }
}
async fn get_profile_row(store: &Store, id: &str) -> (i64, i64, i64) {
    if let Store::Pg(pool) = store {
        if let Ok(Some(r)) = sqlx::query("SELECT moves, hung, missed FROM profiles WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
        {
            return (r.get("moves"), r.get("hung"), r.get("missed"));
        }
    }
    (0, 0, 0)
}
async fn profile(
    State(store): State<Store>,
    Query(q): Query<HashMap<String, String>>,
) -> Json<serde_json::Value> {
    let id = q.get("player").cloned().unwrap_or_default();
    let (moves, hung, missed) = get_profile_row(&store, &id).await;
    Json(serde_json::json!({ "moves": moves, "hung": hung, "missed": missed }))
}

/// A move played off-server (e.g. the local vs-AI board). The client sends the
/// position before the move and the move itself; we classify with the *same*
/// logic as online play so the Player Model learns from every game, not just
/// multiplayer ones. Only the human's own moves should be posted here.
#[derive(serde::Deserialize)]
struct RecordReq {
    player: String,
    fen: String,
    uci: String,
}
async fn record(State(store): State<Store>, Json(req): Json<RecordReq>) -> Json<serde_json::Value> {
    let before = engine::parse_fen(&req.fen);
    let mover = before.side;
    if let Some(mv) = room::parse_uci(&before, &req.uci) {
        let played_to = uci_to_sq(&req.uci).unwrap_or(64);
        let mut after = before;
        after.make_move(mv);
        let hung = left_piece_hanging(&after, mover);
        let missed = missed_free_capture(&before, mover, played_to);
        record_move(&store, &req.player, hung, missed).await;
        return Json(serde_json::json!({ "ok": true, "hung": hung, "missed": missed }));
    }
    Json(serde_json::json!({ "ok": false }))
}

#[derive(Clone)]
struct AppState {
    rooms: Rooms,
    store: Store,
}
impl FromRef<AppState> for Rooms {
    fn from_ref(s: &AppState) -> Rooms {
        s.rooms.clone()
    }
}
impl FromRef<AppState> for Store {
    fn from_ref(s: &AppState) -> Store {
        s.store.clone()
    }
}

static NEXT_ANON: AtomicU64 = AtomicU64::new(1);

fn new_room_state() -> RoomState {
    RoomState {
        room: Room::new(),
        tx: broadcast::channel(64).0,
        seats: Seats::default(),
        started: now_secs(),
        mode: "match".to_string(),
        pending_undo: None,
    }
}

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum ClientMsg {
    Join {
        room: String,
        #[serde(default)]
        elo: i32,
        #[serde(default)]
        pid: String,
        #[serde(default)]
        name: String,
    },
    Move {
        uci: String,
    },
    Glass {
        summary: String,
    },
    Reset,
    Resign,
    /// Casual takeback: ask the opponent to allow taking back your last move.
    UndoRequest,
    /// Answer to a takeback request.
    UndoResponse {
        accept: bool,
    },
}

#[derive(Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum ServerMsg {
    Joined {
        color: String,
        fen: String,
    },
    Full,
    State {
        fen: String,
        turn: String,
        status: String,
        last: Option<String>,
        white_elo: i32,
        black_elo: i32,
        white_name: String,
        black_name: String,
        /// "white" | "black" | "" (draw); set once the game is over.
        winner: String,
        /// "checkmate" | "stalemate" | "resignation" | "fifty-move rule" | "".
        reason: String,
        /// "match" | "casual".
        mode: String,
    },
    Glass {
        side: String,
        summary: String,
    },
    /// A takeback was requested by `from` ("white"|"black") — the opponent decides.
    UndoAsk {
        from: String,
    },
    /// Result of a takeback request (accepted → the board also reverts via State).
    Undo {
        accepted: bool,
        by: String,
    },
}

#[tokio::main]
async fn main() {
    let rooms: Rooms = Arc::new(Mutex::new(HashMap::new()));
    let store = build_store().await;
    // Restore saved games so they survive redeploys and idle spin-downs.
    if let Store::Pg(pool) = &store {
        let loaded = load_all_games(pool).await;
        let n = loaded.len();
        {
            let mut map = rooms.lock().await;
            for (id, rs) in loaded {
                map.insert(id, rs);
            }
        }
        println!("Restored {n} game(s) from Postgres");
    }
    let app = Router::new()
        .route("/", get(root))
        .route("/games", get(list_games).post(create_game))
        .route("/games/delete", post(delete_game))
        .route("/ai-games", get(list_ai_games).post(upsert_ai_game))
        .route("/ai-games/delete", post(delete_ai_game))
        .route("/feedback", get(list_feedback).post(post_feedback))
        .route("/account", post(account))
        .route("/profile", get(profile))
        .route("/record", post(record))
        .route("/score", post(post_score))
        .route("/hit", post(post_hit))
        .route("/admin", get(admin_stats))
        .layer(CorsLayer::permissive())
        .with_state(AppState { rooms, store });

    let addr = std::env::var("PORT")
        .ok()
        .map(|p| format!("0.0.0.0:{p}"))
        .or_else(|| std::env::var("GLASSBOARD_ADDR").ok())
        .unwrap_or_else(|| "0.0.0.0:9001".to_string());

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("failed to bind");
    println!("Glassboard server listening on {addr}");
    axum::serve(listener, app).await.expect("server error");
}

// ---------------- HTTP lobby API ----------------

#[derive(Deserialize)]
struct CreateReq {
    id: String,
    #[serde(default)]
    pid: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    rating: i32,
    #[serde(default)]
    mode: String,
}

#[derive(Serialize)]
struct GameSummary {
    id: String,
    status: String,
    color: String,
    my_rating: i32,
    opp_name: Option<String>,
    opp_rating: Option<i32>,
    /// Opponent's stable identity — so rivalries key by player, not by name.
    opp_id: Option<String>,
    /// Current board position, so the lobby can render a live preview.
    fen: String,
    /// Whose move it is: "white" | "black".
    turn: String,
    /// Unix seconds when the game was created.
    started: u64,
    /// Game over? (checkmate/stalemate/resignation/fifty-move)
    over: bool,
    /// "white" | "black" | "" — winner once over.
    winner: String,
    /// How it ended, if over.
    reason: String,
    /// "match" | "casual".
    mode: String,
}

/// Pre-register a game so the host holds White before sharing the invite link.
async fn create_game(
    State(rooms): State<Rooms>,
    State(store): State<Store>,
    Json(b): Json<CreateReq>,
) -> Json<serde_json::Value> {
    let status = {
        let mut map = rooms.lock().await;
        let rs = map.entry(b.id.clone()).or_insert_with(new_room_state);
        if rs.seats.host.is_none() {
            rs.seats.host = Some(Player {
                id: b.pid.clone(),
                name: b.name.clone(),
                rating: b.rating,
            });
            rs.room.white_elo = b.rating;
            if b.mode == "casual" || b.mode == "match" {
                rs.mode = b.mode.clone();
            }
        }
        rs.seats.status().to_string()
    };
    persist_game(&store, &rooms, &b.id).await;
    Json(serde_json::json!({ "id": b.id, "status": status }))
}

#[derive(Deserialize)]
struct DeleteReq {
    id: String,
    #[serde(default)]
    pid: String,
}

/// Host-only: delete a game room entirely (gone for both players).
async fn delete_game(
    State(rooms): State<Rooms>,
    State(store): State<Store>,
    Json(b): Json<DeleteReq>,
) -> Json<serde_json::Value> {
    let is_host = {
        let mut map = rooms.lock().await;
        let is_host = map
            .get(&b.id)
            .and_then(|rs| rs.seats.host.as_ref())
            .map(|h| h.id == b.pid)
            .unwrap_or(false);
        if is_host {
            map.remove(&b.id);
        }
        is_host
    };
    if is_host {
        delete_game_db(&store, &b.id).await;
    }
    Json(serde_json::json!({ "deleted": is_host }))
}

/// List the games a player is in, with status (for the lobby / notifications).
async fn list_games(
    State(rooms): State<Rooms>,
    Query(q): Query<HashMap<String, String>>,
) -> Json<Vec<GameSummary>> {
    let player = q.get("player").cloned().unwrap_or_default();
    let map = rooms.lock().await;
    let mut out = Vec::new();
    for (id, rs) in map.iter() {
        let host_is = rs.seats.host.as_ref().map(|h| h.id == player).unwrap_or(false);
        let guest_is = rs.seats.guest.as_ref().map(|g| g.id == player).unwrap_or(false);
        if !host_is && !guest_is {
            continue;
        }
        let (color, me, opp) = if host_is {
            ("white", &rs.seats.host, &rs.seats.guest)
        } else {
            ("black", &rs.seats.guest, &rs.seats.host)
        };
        let (over, winner, reason) = rs.room.outcome();
        out.push(GameSummary {
            id: id.clone(),
            status: rs.seats.status().to_string(),
            color: color.to_string(),
            my_rating: me.as_ref().map(|p| p.rating).unwrap_or(0),
            opp_name: opp.as_ref().map(|p| p.name.clone()),
            opp_rating: opp.as_ref().map(|p| p.rating),
            opp_id: opp.as_ref().map(|p| p.id.clone()),
            fen: rs.room.fen(),
            turn: rs.room.turn().to_string(),
            started: rs.started,
            over,
            winner: winner.to_string(),
            reason: reason.to_string(),
            mode: rs.mode.clone(),
        });
    }
    Json(out)
}

// ---- solo vs-AI games: durable, cross-device, client-driven ----

#[derive(Deserialize)]
struct AiUpsert {
    id: String,
    #[serde(default)]
    pid: String,
    fen: String,
    #[serde(default)]
    human_elo: i32,
    #[serde(default)]
    engine_elo: i32,
}

#[derive(Serialize)]
struct AiGameOut {
    id: String,
    fen: String,
    human_elo: i32,
    engine_elo: i32,
    updated: i64,
}

/// Create or update a solo AI game's snapshot. Keyed by id; owned by pid.
async fn upsert_ai_game(State(store): State<Store>, Json(b): Json<AiUpsert>) -> Json<serde_json::Value> {
    if let Store::Pg(pool) = &store {
        let _ = sqlx::query(
            "INSERT INTO ai_games (id,pid,fen,human_elo,engine_elo,updated) VALUES ($1,$2,$3,$4,$5,$6) \
             ON CONFLICT (id) DO UPDATE SET fen=EXCLUDED.fen, human_elo=EXCLUDED.human_elo, \
             engine_elo=EXCLUDED.engine_elo, updated=EXCLUDED.updated",
        )
        .bind(&b.id)
        .bind(&b.pid)
        .bind(&b.fen)
        .bind(b.human_elo)
        .bind(b.engine_elo)
        .bind(now_secs() as i64)
        .execute(pool)
        .await;
    }
    Json(serde_json::json!({ "ok": true }))
}

/// List a player's in-progress AI games (most recently played first).
async fn list_ai_games(State(store): State<Store>, Query(q): Query<HashMap<String, String>>) -> Json<Vec<AiGameOut>> {
    let player = q.get("player").cloned().unwrap_or_default();
    let mut out = Vec::new();
    if let Store::Pg(pool) = &store {
        if let Ok(rows) = sqlx::query(
            "SELECT id,fen,human_elo,engine_elo,updated FROM ai_games WHERE pid=$1 ORDER BY updated DESC",
        )
        .bind(&player)
        .fetch_all(pool)
        .await
        {
            for r in rows {
                out.push(AiGameOut {
                    id: r.get("id"),
                    fen: r.get("fen"),
                    human_elo: r.get("human_elo"),
                    engine_elo: r.get("engine_elo"),
                    updated: r.get("updated"),
                });
            }
        }
    }
    Json(out)
}

/// Remove a finished (or abandoned) AI game.
async fn delete_ai_game(State(store): State<Store>, Json(b): Json<DeleteReq>) -> Json<serde_json::Value> {
    if let Store::Pg(pool) = &store {
        let _ = sqlx::query("DELETE FROM ai_games WHERE id=$1").bind(&b.id).execute(pool).await;
    }
    Json(serde_json::json!({ "deleted": true }))
}

// ---- playtest feedback (the exit-gate signal) ----

#[derive(Deserialize)]
struct FeedbackReq {
    #[serde(default)]
    game_id: String,
    #[serde(default)]
    player: String,
    #[serde(default)]
    mode: String,
    fun: bool,
    fair: bool,
    #[serde(default)]
    note: String,
}

/// Record one player's post-game read: fun? fair? (+ an optional note.)
async fn post_feedback(State(store): State<Store>, Json(b): Json<FeedbackReq>) -> Json<serde_json::Value> {
    if let Store::Pg(pool) = &store {
        let note: String = b.note.chars().take(500).collect();
        let _ = sqlx::query(
            "INSERT INTO feedback (ts,game_id,player,mode,fun,fair,note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(now_secs() as i64)
        .bind(&b.game_id)
        .bind(&b.player)
        .bind(&b.mode)
        .bind(b.fun as i32)
        .bind(b.fair as i32)
        .bind(&note)
        .execute(pool)
        .await;
    }
    Json(serde_json::json!({ "ok": true }))
}

/// Read recent feedback (newest first) — for reviewing playtest results.
async fn list_feedback(State(store): State<Store>) -> Json<serde_json::Value> {
    let mut rows = Vec::new();
    if let Store::Pg(pool) = &store {
        if let Ok(rs) = sqlx::query(
            "SELECT ts,game_id,player,mode,fun,fair,note FROM feedback ORDER BY ts DESC LIMIT 200",
        )
        .fetch_all(pool)
        .await
        {
            for r in rs {
                rows.push(serde_json::json!({
                    "ts": r.get::<i64, _>("ts"),
                    "game_id": r.get::<String, _>("game_id"),
                    "player": r.get::<String, _>("player"),
                    "mode": r.get::<String, _>("mode"),
                    "fun": r.get::<i32, _>("fun") != 0,
                    "fair": r.get::<i32, _>("fair") != 0,
                    "note": r.get::<String, _>("note"),
                }));
            }
        }
    }
    Json(serde_json::json!({ "feedback": rows }))
}

// ---- play scores + admin --------------------------------------------------

#[derive(Deserialize)]
struct ScoreReq {
    #[serde(default)]
    player: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    level: String,
    #[serde(default)]
    result: String, // "win" | "draw" | "loss"
    #[serde(default)]
    accuracy: i32,
    #[serde(default)]
    style: String,
    #[serde(default)]
    opening: String,
    #[serde(default)]
    points: i64,
    #[serde(default, rename = "self")]
    self_pts: i64,
    #[serde(default)]
    assist: i64,
    #[serde(default)]
    rating: i32,
}
/// One finished AI game from the client: append to the results log and accumulate
/// the player's cumulative score. (Client sends per-game deltas; server sums.)
async fn post_score(State(store): State<Store>, Json(b): Json<ScoreReq>) -> Json<serde_json::Value> {
    if b.player.is_empty() {
        return Json(serde_json::json!({ "ok": false }));
    }
    if let Store::Pg(pool) = &store {
        let ts = now_secs() as i64;
        let (w, d, l) = ((b.result == "win") as i32, (b.result == "draw") as i32, (b.result == "loss") as i32);
        let _ = sqlx::query(
            "INSERT INTO results (ts,player,name,level,result,accuracy,style,opening,points) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(ts).bind(&b.player).bind(&b.name).bind(&b.level).bind(&b.result)
        .bind(b.accuracy).bind(&b.style).bind(&b.opening).bind(b.points as i32)
        .execute(pool).await;
        let _ = sqlx::query(
            "INSERT INTO scores (player,name,total,self_pts,assist_pts,games,wins,draws,losses,rating,updated) \
             VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10) \
             ON CONFLICT (player) DO UPDATE SET name=EXCLUDED.name, total=scores.total+EXCLUDED.total, \
               self_pts=scores.self_pts+EXCLUDED.self_pts, assist_pts=scores.assist_pts+EXCLUDED.assist_pts, \
               games=scores.games+1, wins=scores.wins+EXCLUDED.wins, draws=scores.draws+EXCLUDED.draws, \
               losses=scores.losses+EXCLUDED.losses, rating=EXCLUDED.rating, updated=EXCLUDED.updated",
        )
        .bind(&b.player).bind(&b.name).bind(b.points).bind(b.self_pts).bind(b.assist)
        .bind(w).bind(d).bind(l).bind(b.rating).bind(ts)
        .execute(pool).await;
    }
    Json(serde_json::json!({ "ok": true }))
}

#[derive(Deserialize)]
struct HitReq {
    #[serde(default)]
    page: String,
    #[serde(default)]
    visitor: String,
    #[serde(default)]
    name: String,
}
/// A page view (anonymous). Fire-and-forget from the client on each page load.
async fn post_hit(State(store): State<Store>, Json(b): Json<HitReq>) -> Json<serde_json::Value> {
    if let Store::Pg(pool) = &store {
        let page: String = b.page.chars().take(40).collect();
        let name: String = b.name.chars().take(40).collect();
        let visitor: String = b.visitor.chars().take(64).collect();
        let _ = sqlx::query("INSERT INTO hits (ts,page,visitor,name) VALUES ($1,$2,$3,$4)")
            .bind(now_secs() as i64).bind(&page).bind(&visitor).bind(&name)
            .execute(pool).await;
    }
    Json(serde_json::json!({ "ok": true }))
}

/// Admin dashboard data — gated by the ADMIN_KEY env var (?key=...). Aggregates the
/// leaderboard, per-level win-rates (validates AI calibration), top openings, recent
/// games, and page-hit traffic. Returns {error} unless the key matches.
async fn admin_stats(State(store): State<Store>, Query(q): Query<HashMap<String, String>>) -> Json<serde_json::Value> {
    let key = q.get("key").cloned().unwrap_or_default();
    let admin = std::env::var("ADMIN_KEY").unwrap_or_default();
    if admin.is_empty() || key != admin {
        return Json(serde_json::json!({ "error": "unauthorized" }));
    }
    let (mut players, mut levels, mut openings, mut recent) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let (mut games_total, mut players_total) = (0i64, 0i64);
    if let Store::Pg(pool) = &store {
        if let Ok(rs) = sqlx::query("SELECT name,total,self_pts,assist_pts,games,wins,draws,losses,rating FROM scores ORDER BY total DESC LIMIT 200").fetch_all(pool).await {
            for r in rs {
                players.push(serde_json::json!({
                    "name": r.get::<String,_>("name"), "total": r.get::<i64,_>("total"),
                    "self": r.get::<i64,_>("self_pts"), "assist": r.get::<i64,_>("assist_pts"),
                    "games": r.get::<i32,_>("games"), "wins": r.get::<i32,_>("wins"),
                    "draws": r.get::<i32,_>("draws"), "losses": r.get::<i32,_>("losses"), "rating": r.get::<i32,_>("rating"),
                }));
            }
        }
        if let Ok(rs) = sqlx::query("SELECT level, COUNT(*)::bigint AS games, SUM(CASE WHEN result='win' THEN 1 ELSE 0 END)::bigint AS wins, SUM(CASE WHEN result='draw' THEN 1 ELSE 0 END)::bigint AS draws, AVG(accuracy)::float8 AS acc FROM results GROUP BY level ORDER BY games DESC").fetch_all(pool).await {
            for r in rs {
                levels.push(serde_json::json!({
                    "level": r.get::<String,_>("level"), "games": r.get::<i64,_>("games"),
                    "wins": r.get::<i64,_>("wins"), "draws": r.get::<i64,_>("draws"),
                    "acc": r.try_get::<f64, _>("acc").unwrap_or(0.0),
                }));
            }
        }
        if let Ok(rs) = sqlx::query("SELECT opening, COUNT(*)::bigint AS n FROM results WHERE opening <> '' GROUP BY opening ORDER BY n DESC LIMIT 20").fetch_all(pool).await {
            for r in rs { openings.push(serde_json::json!({ "opening": r.get::<String,_>("opening"), "n": r.get::<i64,_>("n") })); }
        }
        if let Ok(rs) = sqlx::query("SELECT ts,name,level,result,accuracy,style,opening FROM results ORDER BY ts DESC LIMIT 50").fetch_all(pool).await {
            for r in rs {
                recent.push(serde_json::json!({
                    "ts": r.get::<i64,_>("ts"), "name": r.get::<String,_>("name"), "level": r.get::<String,_>("level"),
                    "result": r.get::<String,_>("result"), "accuracy": r.get::<i32,_>("accuracy"),
                    "style": r.get::<String,_>("style"), "opening": r.get::<String,_>("opening"),
                }));
            }
        }
        games_total = sqlx::query("SELECT COUNT(*)::bigint AS n FROM results").fetch_one(pool).await.map(|r| r.get::<i64, _>("n")).unwrap_or(0);
        players_total = sqlx::query("SELECT COUNT(*)::bigint AS n FROM scores").fetch_one(pool).await.map(|r| r.get::<i64, _>("n")).unwrap_or(0);
    }
    // ---- playtest verdicts: THE POC EXIT-GATE SIGNAL ----
    // "an unequal pair plays a full game and both independently say it was fun and
    // fair". Surfaced here because a bare 👍/👍 carries no note, so it was invisible
    // in the Forum (which only lists entries that have one).
    let (mut fun_yes, mut fun_no, mut fair_yes, mut fair_no) = (0i64, 0i64, 0i64, 0i64);
    let mut verdicts = Vec::new();
    if let Store::Pg(pool) = &store {
        if let Ok(r) = sqlx::query(
            "SELECT SUM(CASE WHEN fun=1 THEN 1 ELSE 0 END)::bigint AS fy, \
                    SUM(CASE WHEN fun=0 THEN 1 ELSE 0 END)::bigint AS fn2, \
                    SUM(CASE WHEN fair=1 THEN 1 ELSE 0 END)::bigint AS ry, \
                    SUM(CASE WHEN fair=0 THEN 1 ELSE 0 END)::bigint AS rn \
             FROM feedback WHERE mode NOT LIKE 'forum:%'").fetch_one(pool).await {
            fun_yes = r.try_get::<i64,_>("fy").unwrap_or(0);
            fun_no = r.try_get::<i64,_>("fn2").unwrap_or(0);
            fair_yes = r.try_get::<i64,_>("ry").unwrap_or(0);
            fair_no = r.try_get::<i64,_>("rn").unwrap_or(0);
        }
        if let Ok(rs) = sqlx::query(
            "SELECT ts,game_id,mode,fun,fair,note FROM feedback WHERE mode NOT LIKE 'forum:%' ORDER BY ts DESC LIMIT 50")
            .fetch_all(pool).await {
            for r in rs {
                verdicts.push(serde_json::json!({
                    "ts": r.get::<i64,_>("ts"), "game": r.get::<String,_>("game_id"),
                    "mode": r.get::<String,_>("mode"), "fun": r.get::<i32,_>("fun") != 0,
                    "fair": r.get::<i32,_>("fair") != 0, "note": r.get::<String,_>("note"),
                }));
            }
        }
    }

    // ---- traffic / activity ----
    let now = now_secs() as i64;
    let (mut hits_total, mut visitors_total, mut hits_24h, mut hits_7d, mut active_now) = (0i64, 0i64, 0i64, 0i64, 0i64);
    let (mut pages, mut activity) = (Vec::new(), Vec::new());
    if let Store::Pg(pool) = &store {
        hits_total = sqlx::query("SELECT COUNT(*)::bigint AS n FROM hits").fetch_one(pool).await.map(|r| r.get::<i64, _>("n")).unwrap_or(0);
        visitors_total = sqlx::query("SELECT COUNT(DISTINCT visitor)::bigint AS n FROM hits").fetch_one(pool).await.map(|r| r.get::<i64, _>("n")).unwrap_or(0);
        hits_24h = sqlx::query("SELECT COUNT(*)::bigint AS n FROM hits WHERE ts >= $1").bind(now - 86400).fetch_one(pool).await.map(|r| r.get::<i64, _>("n")).unwrap_or(0);
        hits_7d = sqlx::query("SELECT COUNT(*)::bigint AS n FROM hits WHERE ts >= $1").bind(now - 604800).fetch_one(pool).await.map(|r| r.get::<i64, _>("n")).unwrap_or(0);
        active_now = sqlx::query("SELECT COUNT(DISTINCT visitor)::bigint AS n FROM hits WHERE ts >= $1").bind(now - 300).fetch_one(pool).await.map(|r| r.get::<i64, _>("n")).unwrap_or(0);
        if let Ok(rs) = sqlx::query("SELECT page, COUNT(*)::bigint AS n, COUNT(DISTINCT visitor)::bigint AS u FROM hits GROUP BY page ORDER BY n DESC LIMIT 30").fetch_all(pool).await {
            for r in rs { pages.push(serde_json::json!({ "page": r.get::<String,_>("page"), "n": r.get::<i64,_>("n"), "visitors": r.get::<i64,_>("u") })); }
        }
        if let Ok(rs) = sqlx::query("SELECT ts,page,name,visitor FROM hits ORDER BY ts DESC LIMIT 60").fetch_all(pool).await {
            for r in rs { activity.push(serde_json::json!({ "ts": r.get::<i64,_>("ts"), "page": r.get::<String,_>("page"), "name": r.get::<String,_>("name"), "visitor": r.get::<String,_>("visitor") })); }
        }
    }
    Json(serde_json::json!({ "ok": true,
        "totals": { "games": games_total, "players": players_total, "hits": hits_total, "visitors": visitors_total, "hits24h": hits_24h, "hits7d": hits_7d, "activeNow": active_now },
        "players": players, "levels": levels, "openings": openings, "recent": recent,
        "playtest": { "funYes": fun_yes, "funNo": fun_no, "fairYes": fair_yes, "fairNo": fair_no, "verdicts": verdicts },
        "pages": pages, "activity": activity }))
}

#[derive(Deserialize)]
struct AccountReq {
    name: String,
    pin: String,
    #[serde(default)]
    rating: i32,
}

/// Claim a username with a PIN, or sign back in with the same pair. Returns a
/// stable player id so the same account is one identity across devices.
async fn account(State(store): State<Store>, Json(req): Json<AccountReq>) -> impl IntoResponse {
    let name = req.name.trim().to_string();
    let pin = req.pin.trim().to_string();
    if name.is_empty() || name.chars().count() > 24 {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error":"Enter a name (1–24 characters)."})));
    }
    if pin.len() != 4 || !pin.chars().all(|c| c.is_ascii_digit()) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error":"PIN must be exactly 4 digits."})));
    }
    let rating = if (100..=3200).contains(&req.rating) { req.rating } else { 1200 };
    match store.account(&name, &pin, rating).await {
        Ok(o) => (
            if o.returning { StatusCode::OK } else { StatusCode::CREATED },
            Json(serde_json::json!({"id": o.id, "name": o.name, "rating": o.rating, "returning": o.returning})),
        ),
        Err(AccountErr::WrongPin) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({"error":"That name is taken — wrong PIN."})),
        ),
        Err(AccountErr::Server) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error":"Server error — please try again."})),
        ),
    }
}

// ---------------- WebSocket game ----------------

async fn root(
    ws: Option<WebSocketUpgrade>,
    State(rooms): State<Rooms>,
    State(store): State<Store>,
) -> axum::response::Response {
    match ws {
        Some(ws) => ws.on_upgrade(move |socket| handle(socket, rooms, store)),
        None => "Glassboard multiplayer server — connect via WebSocket.".into_response(),
    }
}

async fn handle(socket: WebSocket, rooms: Rooms, store: Store) {
    let (mut sink, mut stream) = socket.split();

    // First frame must be a join.
    let first = match stream.next().await {
        Some(Ok(Message::Text(t))) => t,
        _ => return,
    };
    let (room_code, player) = match serde_json::from_str::<ClientMsg>(&first) {
        Ok(ClientMsg::Join {
            room,
            elo,
            pid,
            name,
        }) => {
            let id = if pid.is_empty() {
                format!("anon{}", NEXT_ANON.fetch_add(1, Ordering::Relaxed))
            } else {
                pid
            };
            let name = if name.trim().is_empty() {
                "Player".to_string()
            } else {
                name
            };
            (
                room,
                Player {
                    id,
                    name,
                    rating: elo.max(1),
                },
            )
        }
        _ => return,
    };

    // Seat by identity; grab the room broadcast handle + glass history.
    let (color, tx, glass_history) = {
        let mut map = rooms.lock().await;
        let rs = map.entry(room_code.clone()).or_insert_with(new_room_state);
        match rs.seats.seat(player.clone()) {
            Some(c) => {
                match c {
                    Color::White => rs.room.white_elo = player.rating,
                    Color::Black => rs.room.black_elo = player.rating,
                }
                (c, rs.tx.clone(), rs.room.glass.clone())
            }
            None => {
                let _ = sink.send(Message::Text(json(&ServerMsg::Full))).await;
                return;
            }
        }
    };
    let color_str = match color {
        Color::White => "white",
        Color::Black => "black",
    };

    // Tell this client its seat.
    let fen0 = rooms
        .lock()
        .await
        .get(&room_code)
        .map(|rs| rs.room.fen())
        .unwrap_or_default();
    if sink
        .send(Message::Text(json(&ServerMsg::Joined {
            color: color_str.to_string(),
            fen: fen0,
        })))
        .await
        .is_err()
    {
        return;
    }

    // Replay the glass-box history so late joiners see all prior assistance.
    for e in &glass_history {
        if sink
            .send(Message::Text(json(&ServerMsg::Glass {
                side: e.side.clone(),
                summary: e.summary.clone(),
            })))
            .await
            .is_err()
        {
            return;
        }
    }

    // Fan-out: room broadcasts → this socket.
    let mut rx = tx.subscribe();
    let mut forward = tokio::spawn(async move {
        while let Ok(out) = rx.recv().await {
            if sink.send(Message::Text(out)).await.is_err() {
                break;
            }
        }
    });

    broadcast_state(&rooms, &room_code).await;
    persist_game(&store, &rooms, &room_code).await;

    loop {
        tokio::select! {
            _ = &mut forward => break,
            incoming = stream.next() => {
                let msg = match incoming {
                    Some(Ok(m)) => m,
                    _ => break,
                };
                if let Message::Text(t) = msg {
                    match serde_json::from_str::<ClientMsg>(&t) {
                        Ok(ClientMsg::Move { uci }) => {
                            // Apply the move and, if legal, read the Player-Model signal.
                            let signal = {
                                let mut map = rooms.lock().await;
                                if let Some(rs) = map.get_mut(&room_code) {
                                    let before = rs.room.board;
                                    let played_to = uci_to_sq(&uci);
                                    if rs.room.apply_move(color, &uci).is_ok() {
                                        let after = rs.room.board;
                                        Some((
                                            left_piece_hanging(&after, color),
                                            played_to.map(|t| missed_free_capture(&before, color, t)).unwrap_or(false),
                                        ))
                                    } else {
                                        None
                                    }
                                } else {
                                    None
                                }
                            };
                            if let Some((hung, missed)) = signal {
                                record_move(&store, &player.id, hung, missed).await;
                            }
                            broadcast_state(&rooms, &room_code).await;
                            persist_game(&store, &rooms, &room_code).await;
                        }
                        Ok(ClientMsg::Glass { summary }) => {
                            {
                                let mut map = rooms.lock().await;
                                if let Some(rs) = map.get_mut(&room_code) {
                                    rs.room.push_glass(color_str, &summary);
                                    let _ = rs.tx.send(json(&ServerMsg::Glass {
                                        side: color_str.to_string(),
                                        summary,
                                    }));
                                }
                            }
                            persist_game(&store, &rooms, &room_code).await;
                        }
                        Ok(ClientMsg::Reset) => {
                            {
                                let mut map = rooms.lock().await;
                                if let Some(rs) = map.get_mut(&room_code) {
                                    rs.room.reset();
                                }
                            }
                            broadcast_state(&rooms, &room_code).await;
                            persist_game(&store, &rooms, &room_code).await;
                        }
                        Ok(ClientMsg::Resign) => {
                            {
                                let mut map = rooms.lock().await;
                                if let Some(rs) = map.get_mut(&room_code) {
                                    rs.room.resign(color);
                                }
                            }
                            broadcast_state(&rooms, &room_code).await;
                            persist_game(&store, &rooms, &room_code).await;
                        }
                        // Casual takeback: relay the request to the opponent to decide.
                        Ok(ClientMsg::UndoRequest) => {
                            let mut map = rooms.lock().await;
                            if let Some(rs) = map.get_mut(&room_code) {
                                if rs.mode == "casual" && !rs.room.history.is_empty()
                                    && rs.room.resigned.is_none() && rs.pending_undo.is_none()
                                {
                                    rs.pending_undo = Some(color);
                                    let _ = rs.tx.send(json(&ServerMsg::UndoAsk { from: color_str.to_string() }));
                                }
                            }
                        }
                        // The opponent's yes/no. On yes, revert to before the requester's
                        // last move; the server stays authoritative.
                        Ok(ClientMsg::UndoResponse { accept }) => {
                            let did = {
                                let mut map = rooms.lock().await;
                                if let Some(rs) = map.get_mut(&room_code) {
                                    match rs.pending_undo {
                                        Some(req) if req != color => {
                                            rs.pending_undo = None;
                                            if accept {
                                                let n = if rs.room.board.side == req { 2 } else { 1 };
                                                let n = n.min(rs.room.history.len());
                                                let ok = rs.room.undo(n);
                                                let _ = rs.tx.send(json(&ServerMsg::Undo { accepted: true, by: color_str.to_string() }));
                                                ok
                                            } else {
                                                let _ = rs.tx.send(json(&ServerMsg::Undo { accepted: false, by: color_str.to_string() }));
                                                false
                                            }
                                        }
                                        _ => false,
                                    }
                                } else {
                                    false
                                }
                            };
                            if did {
                                broadcast_state(&rooms, &room_code).await;
                                persist_game(&store, &rooms, &room_code).await;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    // Identity-based seating: keep the seat on disconnect so the player can
    // reconnect with the same colour (and the game stays in the lobby).
    forward.abort();
}

async fn broadcast_state(rooms: &Rooms, code: &str) {
    let map = rooms.lock().await;
    if let Some(rs) = map.get(code) {
        let (_, winner, reason) = rs.room.outcome();
        let msg = ServerMsg::State {
            fen: rs.room.fen(),
            turn: rs.room.turn().to_string(),
            status: rs.room.status().to_string(),
            last: rs.room.last_uci.clone(),
            white_elo: rs.room.white_elo,
            black_elo: rs.room.black_elo,
            white_name: rs.seats.host.as_ref().map(|p| p.name.clone()).unwrap_or_default(),
            black_name: rs.seats.guest.as_ref().map(|p| p.name.clone()).unwrap_or_default(),
            winner: winner.to_string(),
            reason: reason.to_string(),
            mode: rs.mode.clone(),
        };
        let _ = rs.tx.send(json(&msg));
    }
}

fn json<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_default()
}
