//! Glassboard multiplayer server (M5).
//!
//! A minimal WebSocket relay with room codes, built on axum so it also answers
//! plain HTTP GET `/` (a health check for hosts) and binds the `PORT` a host
//! assigns. Two players join the same room (first = White, second = Black); the
//! server validates every move against the engine (see `room.rs`) and broadcasts
//! the resulting position — plus the glass-box — to both.
//!
//! Bind address: `PORT` (host-provided) → `GLASSBOARD_ADDR` → `0.0.0.0:9001`.
//!
//! Protocol (JSON text frames):
//!   client → server:  {"t":"join","room":"ABCD","elo":1200} | {"t":"move","uci":"e2e4"}
//!                     | {"t":"glass","summary":"..."} | {"t":"reset"}
//!   server → client:  {"t":"joined","color":"white","fen":...} | {"t":"full"}
//!                     | {"t":"state",...} | {"t":"glass","side":...,"summary":...}

mod room;

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use engine::Color;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, Mutex};

use room::Room;

struct RoomState {
    room: Room,
    tx: broadcast::Sender<String>,
}
type Rooms = Arc<Mutex<HashMap<String, RoomState>>>;

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum ClientMsg {
    Join {
        room: String,
        #[serde(default)]
        elo: i32,
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
    },
    Glass {
        side: String,
        summary: String,
    },
}

#[tokio::main]
async fn main() {
    let rooms: Rooms = Arc::new(Mutex::new(HashMap::new()));
    let app = Router::new().route("/", get(root)).with_state(rooms);

    let addr = std::env::var("PORT")
        .ok()
        .map(|p| format!("0.0.0.0:{p}"))
        .or_else(|| std::env::var("GLASSBOARD_ADDR").ok())
        .unwrap_or_else(|| "0.0.0.0:9001".to_string());

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("failed to bind");
    println!("Glassboard multiplayer server listening on {addr}");
    axum::serve(listener, app).await.expect("server error");
}

/// A WebSocket upgrade runs the game; a plain GET is a health check.
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
    let (room_code, elo) = match serde_json::from_str::<ClientMsg>(&first) {
        Ok(ClientMsg::Join { room, elo }) => (room, elo),
        _ => return,
    };

    // Seat the player and grab the room broadcast handle.
    let (color, tx) = {
        let mut map = rooms.lock().await;
        let rs = map.entry(room_code.clone()).or_insert_with(|| {
            let (tx, _) = broadcast::channel(64);
            RoomState {
                room: Room::new(),
                tx,
            }
        });
        match rs.room.join(elo) {
            Some(c) => (c, rs.tx.clone()),
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

    // Fan-out: room broadcasts → this socket.
    let mut rx = tx.subscribe();
    let mut forward = tokio::spawn(async move {
        while let Ok(out) = rx.recv().await {
            if sink.send(Message::Text(out)).await.is_err() {
                break;
            }
        }
    });

    // Push current position to everyone.
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
                            let map = rooms.lock().await;
                            if let Some(rs) = map.get(&room_code) {
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

    // Free the seat so the player can rejoin.
    {
        let mut map = rooms.lock().await;
        if let Some(rs) = map.get_mut(&room_code) {
            rs.room.leave(color);
        }
    }
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
        };
        let _ = rs.tx.send(json(&msg));
    }
}

fn json<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_default()
}
