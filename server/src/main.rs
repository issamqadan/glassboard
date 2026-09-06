//! Glassboard multiplayer server (M5).
//!
//! A minimal WebSocket relay with room codes. Two players join the same room
//! (first = White, second = Black); the server validates every move against the
//! engine (see `room.rs`) and broadcasts the resulting position to both. Runs
//! anywhere Rust runs — locally (`ws://<your-LAN-ip>:9001`) or on a free server
//! host — no domain required.
//!
//! Protocol (JSON text frames):
//!   client → server:  {"t":"join","room":"ABCD","elo":1200} | {"t":"move","uci":"e2e4"} | {"t":"reset"}
//!   server → client:  {"t":"joined","color":"white","fen":...} | {"t":"full"}
//!                     {"t":"state","fen":...,"turn":...,"status":...,"last":...,"white_elo":..,"black_elo":..}

mod room;

use std::collections::HashMap;
use std::sync::Arc;

use engine::Color;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, Mutex};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

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
    Joined { color: String, fen: String },
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
    let addr = std::env::var("GLASSBOARD_ADDR").unwrap_or_else(|_| "0.0.0.0:9001".to_string());
    let rooms: Rooms = Arc::new(Mutex::new(HashMap::new()));
    let listener = TcpListener::bind(&addr).await.expect("failed to bind");
    println!("Glassboard multiplayer server listening on ws://{addr}");

    while let Ok((stream, peer)) = listener.accept().await {
        let rooms = rooms.clone();
        tokio::spawn(async move {
            if let Err(e) = handle(stream, rooms).await {
                eprintln!("connection {peer} ended: {e}");
            }
        });
    }
}

async fn handle(stream: TcpStream, rooms: Rooms) -> Result<(), Box<dyn std::error::Error>> {
    let ws = accept_async(stream).await?;
    let (mut write, mut read) = ws.split();

    // First frame must be a join.
    let first = match read.next().await {
        Some(Ok(Message::Text(t))) => t,
        _ => return Ok(()),
    };
    let (room_code, elo) = match serde_json::from_str::<ClientMsg>(&first) {
        Ok(ClientMsg::Join { room, elo }) => (room, elo),
        _ => return Ok(()),
    };

    // Seat the player and grab the room's broadcast handle.
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
                let _ = write
                    .send(Message::Text(serde_json::to_string(&ServerMsg::Full)?))
                    .await;
                return Ok(());
            }
        }
    };
    let color_str = match color {
        Color::White => "white",
        Color::Black => "black",
    };

    // Tell this client which seat it took.
    let fen0 = rooms.lock().await.get(&room_code).map(|rs| rs.room.fen()).unwrap_or_default();
    write
        .send(Message::Text(serde_json::to_string(&ServerMsg::Joined {
            color: color_str.to_string(),
            fen: fen0,
        })?))
        .await?;

    // Fan-out: room broadcasts → this socket.
    let mut rx = tx.subscribe();
    let mut forward = tokio::spawn(async move {
        while let Ok(out) = rx.recv().await {
            if write.send(Message::Text(out)).await.is_err() {
                break;
            }
        }
    });

    // Push the current position to everyone (syncs both seats / a rejoin).
    broadcast_state(&rooms, &room_code).await;

    // Handle this client's messages until it disconnects.
    loop {
        tokio::select! {
            _ = &mut forward => break,
            incoming = read.next() => {
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
                                    // Ignore illegal/out-of-turn moves (client validates too).
                                    let _ = rs.room.apply_move(color, &uci);
                                }
                            }
                            broadcast_state(&rooms, &room_code).await;
                        }
                        Ok(ClientMsg::Glass { summary }) => {
                            // Relay the assistance event to both players (glass-box).
                            let map = rooms.lock().await;
                            if let Some(rs) = map.get(&room_code) {
                                let _ = rs.tx.send(
                                    serde_json::to_string(&ServerMsg::Glass {
                                        side: color_str.to_string(),
                                        summary,
                                    })
                                    .unwrap_or_default(),
                                );
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
    Ok(())
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
        if let Ok(json) = serde_json::to_string(&msg) {
            let _ = rs.tx.send(json);
        }
    }
}
