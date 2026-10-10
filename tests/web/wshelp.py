import sys, time
sys.path.insert(0, sys.argv[2])
from wsmode import WS
port = int(sys.argv[1])

def st(ms):
    for m in reversed(ms):
        if m.get("t") == "state": return m
    return None

host, guest = WS(port), WS(port)                      # 1600 vs 900 -> a 700 gap
host.send({"t":"join","room":"h1","elo":1600,"pid":"p_h","name":"Issam"}); time.sleep(0.7)
guest.send({"t":"join","room":"h1","elo":900,"pid":"p_g","name":"Maya"}); time.sleep(0.9)
host.recv_all(0.7); guest.recv_all(0.5)

s = st(host.recv_all(0.6)) or {}
print("before signing      : help W=%s B=%s (unset until the contract is signed)" % (s.get("help_max_white"), s.get("help_max_black")))
host.send({"t":"ready","ready":True}); time.sleep(0.4)
guest.send({"t":"ready","ready":True}); time.sleep(0.8)
s = st(host.recv_all(1.2) + guest.recv_all(0.6))
print("signed, 700-pt gap  : help max W=%s B=%s   takebacks W=%s B=%s" % (
    s.get("help_max_white"), s.get("help_max_black"), s.get("tb_max_white"), s.get("tb_max_black")))

# --- spending is once per ply ---
guest.send({"t":"helpspend","ply":0}); time.sleep(0.5)
s = st(guest.recv_all(0.8)); print("\nBlack spends at ply 0 : left=%s (of %s)" % (s.get("help_black"), s.get("help_max_black")))
guest.send({"t":"helpspend","ply":0}); time.sleep(0.5)
s = st(guest.recv_all(0.8)); print("  looks again, same ply: left=%s   <- not charged twice" % s.get("help_black"))
guest.send({"t":"helpspend","ply":2}); time.sleep(0.5)
s = st(guest.recv_all(0.8)); print("  a new ply            : left=%s" % s.get("help_black"))
print("  White untouched      : left=%s" % s.get("help_white"))

# --- exhaust it, then ask ---
for p in range(4, 40, 2):
    guest.send({"t":"helpspend","ply":p}); time.sleep(0.12)
time.sleep(0.6)
s = st(guest.recv_all(1.0)); print("\nafter spending freely : left=%s   (floors at 0, never negative)" % s.get("help_black"))
guest.send({"t":"helprequest"}); time.sleep(0.6)
hm = host.recv_all(0.9)
ask = [m for m in hm if m.get("t") == "helpask"]
print("the opponent is ASKED : %s (from=%s)" % (bool(ask), ask[0]["from"] if ask else "-"))
host.send({"t":"helpresponse","accept":False}); time.sleep(0.6)
gm = guest.recv_all(1.0)
g = [m for m in gm if m.get("t") == "helpgrant"]
print("refusal relayed       : accepted=%s" % (g[0]["accepted"] if g else "NO MSG"))
print("refusal is on record  : %s" % next((m["summary"] for m in gm if m.get("t")=="glass"), "NOT LOGGED"))
s = st(gm) or {}
print("  still at zero       : left=%s" % s.get("help_black"))
guest.send({"t":"helprequest"}); time.sleep(0.4); host.recv_all(0.4)
host.send({"t":"helpresponse","accept":True}); time.sleep(0.7)
gm = guest.recv_all(1.2); s = st(gm)
print("granted +2            : left=%s of %s" % (s.get("help_black"), s.get("help_max_black")))

# --- takebacks are counted, and a match now has them at all ---
print("\n--- takebacks (mode=%s) ---" % s.get("mode"))
host.send({"t":"move","uci":"e2e4"}); time.sleep(0.5); host.recv_all(0.4); guest.recv_all(0.3)
guest.send({"t":"move","uci":"e7e5"}); time.sleep(0.5); host.recv_all(0.4); guest.recv_all(0.3)
allowed = 0
for i in range(5):
    guest.send({"t":"undorequest"}); time.sleep(0.5)
    asked = [m for m in host.recv_all(0.7) if m.get("t") == "undoask"]
    if not asked:
        print("  request %d: not even relayed  <- allowance used up" % (i+1)); break
    host.send({"t":"undoresponse","accept":True}); time.sleep(0.6)
    r = [m for m in guest.recv_all(0.9) if m.get("t") == "undo"]
    if r and r[0].get("accepted"): allowed += 1
    host.send({"t":"move","uci":"e2e4"}); time.sleep(0.4); host.recv_all(0.3); guest.recv_all(0.2)
    guest.send({"t":"move","uci":"e7e5"}); time.sleep(0.4); host.recv_all(0.3); guest.recv_all(0.2)
s = st(host.recv_all(0.6) + guest.recv_all(0.4)) or s
print("  takebacks allowed   : %d, server says %s left of %s" % (allowed, s.get("tb_black"), s.get("tb_max_black")))
print("  stopped at the agreement : %s" % (allowed <= (s.get("tb_max_black") or 0)))
