# Two real WebSocket players negotiating the terms mid-game, against the real server.
import socket, base64, os, json, struct, time, sys

class WS:
    def __init__(self, port):
        self.s = socket.create_connection(("127.0.0.1", port), timeout=6)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % key).encode())
        buf = b""
        while b"\r\n\r\n" not in buf: buf += self.s.recv(4096)
        assert b"101" in buf.split(b"\r\n")[0], buf[:80]
        self.buf = buf.split(b"\r\n\r\n", 1)[1]
    def send(self, obj):
        d = json.dumps(obj).encode(); m = os.urandom(4); n = len(d)
        f = b"\x81" + (bytes([0x80 | n]) if n < 126 else b"\xfe" + struct.pack(">H", n))
        self.s.sendall(f + m + bytes(b ^ m[i % 4] for i, b in enumerate(d)))
    def recv_all(self, secs=1.2):
        out, end = [], time.time() + secs
        self.s.settimeout(0.3)
        while time.time() < end:
            try: self.buf += self.s.recv(65536)
            except Exception: pass
            while True:
                if len(self.buf) < 2: break
                b1, b2 = self.buf[0], self.buf[1]
                ln = b2 & 0x7F; off = 2
                if ln == 126: ln = struct.unpack(">H", self.buf[2:4])[0]; off = 4
                elif ln == 127: ln = struct.unpack(">Q", self.buf[2:10])[0]; off = 10
                if len(self.buf) < off + ln: break
                payload = self.buf[off:off+ln]; self.buf = self.buf[off+ln:]
                if b1 & 0x0F == 1:
                    try: out.append(json.loads(payload.decode()))
                    except Exception: pass
        return out

