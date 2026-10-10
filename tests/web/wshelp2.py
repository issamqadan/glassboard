import sys, time
sys.path.insert(0, sys.argv[2])
from wsmode import WS
port = int(sys.argv[1])
def st(ms):
    for m in reversed(ms):
        if m.get("t") == "state": return m
    return None
host, guest = WS(port), WS(port)
host.send({"t":"join","room":"h2","elo":1600,"pid":"p_h","name":"I"}); time.sleep(0.7)
guest.send({"t":"join","room":"h2","elo":900,"pid":"p_g","name":"M"}); time.sleep(0.9)
host.recv_all(0.6); guest.recv_all(0.4)
host.send({"t":"ready","ready":True}); time.sleep(0.3)
guest.send({"t":"ready","ready":True}); time.sleep(0.8)
s = st(guest.recv_all(1.0) + host.recv_all(0.5))
print("signed: help %s, takebacks %s" % (s.get("help_max_black"), s.get("tb_max_black")))
guest.send({"t":"helpspend","ply":0}); time.sleep(0.5)
s = st(guest.recv_all(0.9))
print("FIRST spend (ply 0) : left=%s of %s   <- must be one less" % (s.get("help_black"), s.get("help_max_black")))
print("  charged correctly : %s" % (s.get("help_black") == s.get("help_max_black") - 1))
guest.send({"t":"helpspend","ply":0}); time.sleep(0.4)
s2 = st(guest.recv_all(0.8)) or s
print("  same ply again    : left=%s (unchanged: %s)" % (s2.get("help_black"), s2.get("help_black") == s.get("help_black")))
# takebacks, reading a FRESH state after each
host.send({"t":"move","uci":"e2e4"}); time.sleep(0.4); host.recv_all(0.3); guest.recv_all(0.2)
guest.send({"t":"move","uci":"e7e5"}); time.sleep(0.4); host.recv_all(0.3); guest.recv_all(0.2)
guest.send({"t":"undorequest"}); time.sleep(0.5); host.recv_all(0.5)
host.send({"t":"undoresponse","accept":True}); time.sleep(0.7)
s3 = st(guest.recv_all(1.0) + host.recv_all(0.5))
print("\nafter 1 takeback    : %s left of %s  (used %s)" % (s3.get("tb_black"), s3.get("tb_max_black"), s3.get("tb_max_black") - s3.get("tb_black")))
print("  counted on the server : %s" % (s3.get("tb_black") == s3.get("tb_max_black") - 1))
