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
        };
        let rs = RoomState {
            room,
            tx: broadcast::channel(64).0,
            seats: Seats { host, guest },
            started: row.get::<i64, _>("started") as u64,
            mode: row.get::<Option<String>, _>("mode").unwrap_or_else(|| "match".to_string()),
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
        .route("/account", post(account))
        .route("/profile", get(profile))
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
