# Minimal WebSocket client: handshake + one masked text frame. Just enough to seat
# a guest in a room so we can prove a taken challenge leaves the Challenge Board.
import socket, base64, os, json, sys, struct, time

def ws_join(host, port, payload):
    s = socket.create_connection((host, port), timeout=5)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall((
        "GET / HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % (host, port, key)
    ).encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = s.recv(4096)
        if not chunk: raise RuntimeError("closed during handshake")
        buf += chunk
    if b"101" not in buf.split(b"\r\n")[0]:
        raise RuntimeError("no upgrade: " + buf.split(b"\r\n")[0].decode())
    data = json.dumps(payload).encode()
    mask = os.urandom(4)
    frame = b"\x81"                                  # FIN + text
    n = len(data)
    frame += bytes([0x80 | n]) if n < 126 else b"\xfe" + struct.pack(">H", n)
    frame += mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    s.sendall(frame)
    time.sleep(1.0)                                   # let the server seat us
    return s

host, port = "127.0.0.1", int(sys.argv[1])
sock = ws_join(host, port, {"t": "join", "room": sys.argv[2], "elo": int(sys.argv[3]),
                            "pid": sys.argv[4], "name": sys.argv[5]})
print("joined (socket held open)")
time.sleep(float(sys.argv[6]))
sock.close()
