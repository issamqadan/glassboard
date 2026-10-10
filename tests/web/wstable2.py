import sys, time
sys.path.insert(0, sys.argv[2])
from wsmode import WS
port = int(sys.argv[1])

def last_state(ms):
    for m in reversed(ms):
        if m.get("t") == "state": return m
    return None

# --- 1. the host alone must not be able to start ---
host = WS(port)
host.send({"t":"join","room":"t2","elo":1600,"pid":"p_h","name":"Issam"}); time.sleep(0.8)
st = last_state(host.recv_all(1.0))
print("host alone -> at the table        : %s" % st.get("at_table"))
host.send({"t":"move","uci":"e2e4"}); time.sleep(0.6)
st = last_state(host.recv_all(0.9)) or st
print("host can't move before signing    : %s   <- the hole that let a game skip the contract" % (st.get("last") is None))

host.send({"t":"ready","ready":True}); time.sleep(0.6)
st = last_state(host.recv_all(0.9))
print("host signs, still waiting         : at_table=%s W=%s" % (st.get("at_table"), st.get("ready_white")))
host.send({"t":"move","uci":"e2e4"}); time.sleep(0.6)
st = last_state(host.recv_all(0.9)) or st
print("one signature still can't start   : %s" % (st.get("last") is None))

# --- 2. guest joins, changes the terms -> signatures must be void ---
guest = WS(port)
guest.send({"t":"join","room":"t2","elo":900,"pid":"p_g","name":"Maya"}); time.sleep(1.0)
host.recv_all(0.8); guest.recv_all(0.6)
guest.send({"t":"moderequest","mode":"casual"}); time.sleep(0.6)
host.recv_all(0.8)
host.send({"t":"moderesponse","accept":True}); time.sleep(0.8)
st = last_state(host.recv_all(1.2) + guest.recv_all(0.6))
print("\nterms changed to %-7s         : W signed=%s B signed=%s  <- want False/False" % (st.get("mode"), st.get("ready_white"), st.get("ready_black")))
print("still at the table after change    : %s" % st.get("at_table"))

# --- 3. both re-sign the NEW contract and play ---
host.send({"t":"ready","ready":True}); time.sleep(0.4)
guest.send({"t":"ready","ready":True}); time.sleep(0.8)
st = last_state(host.recv_all(1.2) + guest.recv_all(0.6))
print("both signed the new terms          : at_table=%s mode=%s" % (st.get("at_table"), st.get("mode")))
host.send({"t":"move","uci":"e2e4"}); time.sleep(0.7)
st = last_state(host.recv_all(1.0) + guest.recv_all(0.5))
print("game plays                         : last=%s turn=%s" % (st.get("last"), st.get("turn")))

# --- 4. a mode change AFTER the game starts must NOT void anything/stall play ---
guest.send({"t":"moderequest","mode":"match"}); time.sleep(0.5)
host.recv_all(0.6)
host.send({"t":"moderesponse","accept":True}); time.sleep(0.8)
st = last_state(host.recv_all(1.2) + guest.recv_all(0.6))
print("mid-game term change doesn't stall : at_table=%s mode=%s (game continues)" % (st.get("at_table"), st.get("mode")))
