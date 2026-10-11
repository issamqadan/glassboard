# The authoritative clock, end to end against a real server.
import sys, time, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wsmode import WS
port = int(sys.argv[1])
fails = []
def check(label, got, want):
    ok = got == want
    if not ok: fails.append(label)
    print("  %-42s %s%s" % (label, got, "" if ok else "   FAIL (want %s)" % (want,)))
def st(ms):
    for m in reversed(ms):
        if m.get("t") == "state": return m
    return None

import json, urllib.request
def post(path, body):
    r = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path),
        data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(r))
def get(path):
    return json.load(urllib.request.urlopen("http://127.0.0.1:%d%s" % (port, path)))

print("--- a 1-minute, +2s game, signed by both players ---")
post("/games", {"id":"ck1","pid":"p_h","name":"I","rating":1500,"mode":"match","minutes":1,"increment":2})
host, guest = WS(port), WS(port)
host.send({"t":"join","room":"ck1","elo":1500,"pid":"p_h","name":"I"}); time.sleep(0.6)
guest.send({"t":"join","room":"ck1","elo":1500,"pid":"p_g","name":"M"}); time.sleep(0.8)
host.recv_all(0.5); guest.recv_all(0.4)
s = st(host.recv_all(0.5)) or {}
check("before signing, clock not started", s.get("clock_active", ""), "")
host.send({"t":"ready","ready":True}); time.sleep(0.3)
guest.send({"t":"ready","ready":True}); time.sleep(0.8)
s = st(host.recv_all(1.0) + guest.recv_all(0.5))
check("signed: control advertised", "%s+%s" % (s.get("minutes"), s.get("increment")), "1+2")
check("signed: both start at 60s", (s.get("white_ms"), s.get("black_ms")), (60000, 60000))
check("signed: White's clock is running", s.get("clock_active"), "white")

print("\n--- only the mover is charged, and the increment lands ---")
time.sleep(3.0)
host.send({"t":"move","uci":"e2e4"}); time.sleep(0.6)
s = st(host.recv_all(1.0) + guest.recv_all(0.5))
w, b = s.get("white_ms"), s.get("black_ms")
print("    white=%dms black=%dms active=%s" % (w, b, s.get("clock_active")))
check("White charged ~3s then credited +2s", 56000 < w <= 59500, True)
check("Black's clock untouched", b, 60000)
check("clock handed to Black", s.get("clock_active"), "black")

print("\n--- an illegal move costs nothing and keeps the clock ---")
before = (s.get("white_ms"), s.get("black_ms"), s.get("clock_active"))
guest.send({"t":"move","uci":"e2e4"})   # not Black's piece
time.sleep(0.6)
s2 = st(guest.recv_all(0.8)) or s
check("clock still Black's after an illegal move", s2.get("clock_active"), "black")
check("no increment granted for an illegal move", s2.get("black_ms") <= 60000, True)

print("\n--- THE FLAG FALLS WITH NOBODY CONNECTED ---")
post("/games", {"id":"ck2","pid":"p_h2","name":"I","rating":1500,"mode":"match","minutes":1,"increment":0})
h2, g2 = WS(port), WS(port)
h2.send({"t":"join","room":"ck2","elo":1500,"pid":"p_h2","name":"I"}); time.sleep(0.5)
g2.send({"t":"join","room":"ck2","elo":1500,"pid":"p_g2","name":"M"}); time.sleep(0.7)
h2.recv_all(0.4); g2.recv_all(0.3)
h2.send({"t":"ready","ready":True}); time.sleep(0.25)
g2.send({"t":"ready","ready":True}); time.sleep(0.7)
h2.recv_all(0.6)
h2.s.close(); g2.s.close()          # BOTH players disconnect
print("    both sockets closed; waiting for White's minute to expire…")
time.sleep(62)
rows = get("/games?player=p_h2")
r = rows[0] if rows else {}
check("lobby reports the game over", r.get("over"), True)
check("the flagged side lost on time", (r.get("winner"), r.get("reason")), ("black", "timeout"))
print("\n%s" % ("ALL PASSED" if not fails else "FAILED: " + ", ".join(fails)))
sys.exit(1 if fails else 0)
