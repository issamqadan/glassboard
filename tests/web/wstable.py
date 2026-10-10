import sys, time, json
sys.path.insert(0, sys.argv[2])
from wsmode import WS  # reuse the client
port = int(sys.argv[1])
host, guest = WS(port), WS(port)
host.send({"t":"join","room":"tbl1","elo":1600,"pid":"p_h","name":"Issam"}); time.sleep(0.6)
guest.send({"t":"join","room":"tbl1","elo":900,"pid":"p_g","name":"Maya"}); time.sleep(1.0)

def last_state(ms):
    for m in reversed(ms):
        if m.get("t") == "state": return m
    return None

st = last_state(host.recv_all(1.0) + guest.recv_all(0.6))
print("both seated -> at the table      : %s  (signed: W=%s B=%s)" % (st.get("at_table"), st.get("ready_white"), st.get("ready_black")))

# try to move WITHOUT signing — the server must refuse
host.send({"t":"move","uci":"e2e4"}); time.sleep(0.7)
st2 = last_state(host.recv_all(1.0) + guest.recv_all(0.5)) or st
print("move before signing is refused   : %s  (fen unchanged: %s)" % (st2.get("last") is None, st2["fen"].split()[0].endswith("RNBQKBNR")))

# ONE player signs — still not started
host.send({"t":"ready","ready":True}); time.sleep(0.7)
st3 = last_state(host.recv_all(1.0) + guest.recv_all(0.5))
print("one signature is not enough      : at_table=%s W=%s B=%s" % (st3.get("at_table"), st3.get("ready_white"), st3.get("ready_black")))
host.send({"t":"move","uci":"e2e4"}); time.sleep(0.6)
st4 = last_state(host.recv_all(0.9)) or st3
print("still refused with one signature : %s" % (st4.get("last") is None))

# second signature opens the game
guest.send({"t":"ready","ready":True}); time.sleep(0.8)
ms = host.recv_all(1.2) + guest.recv_all(0.6)
st5 = last_state(ms)
print("both signed -> table closes      : at_table=%s" % st5.get("at_table"))
gl = [m for m in ms if m.get("t") == "glass"]
print("signing is logged to the glass box: %s" % (gl[-1]["summary"][:66] + "…" if gl else "NOT LOGGED"))

# now the move lands
host.send({"t":"move","uci":"e2e4"}); time.sleep(0.7)
st6 = last_state(host.recv_all(1.0) + guest.recv_all(0.5))
print("the game plays normally          : last=%s turn=%s" % (st6.get("last"), st6.get("turn")))
