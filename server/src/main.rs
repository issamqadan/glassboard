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

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use engine::Color;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, Mutex};
use tower_http::cors::CorsLayer;

use room::{Player, Room, Seats};

struct RoomState {
    room: Room,
    tx: broadcast::Sender<String>,
    seats: Seats,
}
type Rooms = Arc<Mutex<HashMap<String, RoomState>>>;

static NEXT_ANON: AtomicU64 = AtomicU64::new(1);

fn new_room_state() -> RoomState {
    RoomState {
        room: Room::new(),
        tx: broadcast::channel(64).0,
        seats: Seats::default(),
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
    },
    Glass {
        side: String,
        summary: String,
    },
}

#[tokio::main]
async fn main() {
    let rooms: Rooms = Arc::new(Mutex::new(HashMap::new()));
    let app = Router::new()
        .route("/", get(root))
        .route("/games", get(list_games).post(create_game))
        .layer(CorsLayer::permissive())
        .with_state(rooms);

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
}

#[derive(Serialize)]
struct GameSummary {
    id: String,
    status: String,
    color: String,
    my_rating: i32,
    opp_name: Option<String>,
    opp_rating: Option<i32>,
}

/// Pre-register a game so the host holds White before sharing the invite link.
async fn create_game(State(rooms): State<Rooms>, Json(b): Json<CreateReq>) -> Json<serde_json::Value> {
    let mut map = rooms.lock().await;
    let rs = map.entry(b.id.clone()).or_insert_with(new_room_state);
    if rs.seats.host.is_none() {
        rs.seats.host = Some(Player {
            id: b.pid.clone(),
            name: b.name.clone(),
            rating: b.rating,
        });
        rs.room.white_elo = b.rating;
    }
    Json(serde_json::json!({ "id": b.id, "status": rs.seats.status() }))
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
        out.push(GameSummary {
            id: id.clone(),
            status: rs.seats.status().to_string(),
            color: color.to_string(),
            my_rating: me.as_ref().map(|p| p.rating).unwrap_or(0),
            opp_name: opp.as_ref().map(|p| p.name.clone()),
            opp_rating: opp.as_ref().map(|p| p.rating),
        });
    }
    Json(out)
}

// ---------------- WebSocket game ----------------

async fn root(ws: Option<WebSocketUpgrade>, State(rooms): State<Rooms>) -> axum::response::Response {
    match ws {
        Some(ws) => ws.on_upgrade(move |socket| handle(socket, rooms)),
        None => "Glassboard multiplayer server — connect via WebSocket.".into_response(),
    }
}

async fn handle(socket: WebSocket, rooms: Rooms) {
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
                            {
                                let mut map = rooms.lock().await;
                                if let Some(rs) = map.get_mut(&room_code) {
                                    let _ = rs.room.apply_move(color, &uci);
                                }
                            }
                            broadcast_state(&rooms, &room_code).await;
                        }
                        Ok(ClientMsg::Glass { summary }) => {
                            let mut map = rooms.lock().await;
                            if let Some(rs) = map.get_mut(&room_code) {
                                rs.room.push_glass(color_str, &summary);
                                let _ = rs.tx.send(json(&ServerMsg::Glass {
                                    side: color_str.to_string(),
                                    summary,
                                }));
                            }
                        }
                        Ok(ClientMsg::Reset) => {
                            {
                                let mut map = rooms.lock().await;
                                if let Some(rs) = map.get_mut(&room_code) {
                                    rs.room.reset();
                                }
                            }
                            broadcast_state(&rooms, &room_code).await;
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
        let msg = ServerMsg::State {
            fen: rs.room.fen(),
            turn: rs.room.turn().to_string(),
            status: rs.room.status().to_string(),
            last: rs.room.last_uci.clone(),
            white_elo: rs.room.white_elo,
            black_elo: rs.room.black_elo,
            white_name: rs.seats.host.as_ref().map(|p| p.name.clone()).unwrap_or_default(),
            black_name: rs.seats.guest.as_ref().map(|p| p.name.clone()).unwrap_or_default(),
        };
        let _ = rs.tx.send(json(&msg));
    }
}

fn json<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_default()
}
