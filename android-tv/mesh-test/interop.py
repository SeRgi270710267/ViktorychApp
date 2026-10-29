import os, sys, time
from noise.connection import NoiseConnection, Keypair
d = sys.argv[1]
def wait(n):
    p = os.path.join(d, n)
    for _ in range(100):
        if os.path.exists(p): time.sleep(0.05); return open(p, 'rb').read()
        time.sleep(0.1)
    raise SystemExit('timeout ' + n)
c = NoiseConnection.from_name(b'Noise_XX_25519_ChaChaPoly_SHA256')
c.set_as_responder(); c.set_keypair_from_private_bytes(Keypair.STATIC, os.urandom(32)); c.start_handshake()
c.read_message(wait('m1'))
open(os.path.join(d, 'm2'), 'wb').write(c.write_message())
c.read_message(wait('m3'))
assert c.handshake_finished
open(os.path.join(d, 't1'), 'wb').write(c.encrypt(b'from python'))
msg = c.decrypt(wait('t2'))
print('python got', msg.decode()); assert msg == b'from java'
