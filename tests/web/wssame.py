import sys, time
sys.path.insert(0, sys.argv[2])
from wsmode import WS
port = int(sys.argv[1])

def colour(ms):
    for m in ms:
        if m.get("t") == "joined": return m.get("color")
        if m.get("t") == "full": return "FULL"
    return None

# Same device = same gb_pid in localStorage. This is the sender opening their own
# invite link in another tab.
a = WS(port); a.send({"t":"join","room":"same1","elo":1600,"pid":"p_device","name":"Issam"}); time.sleep(0.8)
b = WS(port); b.send({"t":"join","room":"same1","elo":900,"pid":"p_device","name":"Issam"}); time.sleep(1.0)
ca, cb = colour(a.recv_all(1.0)), colour(b.recv_all(1.0))
print("SAME pid (one browser): tab A=%s  tab B=%s   <- %s" % (ca, cb, "BOTH THE SAME SIDE — unusable" if ca == cb else "ok"))

# Two genuinely different players.
c = WS(port); c.send({"t":"join","room":"diff1","elo":1600,"pid":"p_one","name":"Issam"}); time.sleep(0.8)
d = WS(port); d.send({"t":"join","room":"diff1","elo":900,"pid":"p_two","name":"Maya"}); time.sleep(1.0)
cc, cd = colour(c.recv_all(1.0)), colour(d.recv_all(1.0))
print("DIFFERENT pids        : A=%s  B=%s   <- %s" % (cc, cd, "ok, opposite sides" if cc != cd else "BROKEN"))
