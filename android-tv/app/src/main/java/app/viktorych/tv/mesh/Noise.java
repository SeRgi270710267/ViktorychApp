package app.viktorych.tv.mesh;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Noise_XX_25519_ChaChaPoly_SHA256 with an empty prologue, as Bitchat uses
 *  for private chats. Transport messages carry Bitchat's 4-byte big-endian
 *  nonce prefix so out-of-order mesh delivery still decrypts, with a sliding
 *  replay window. */
public final class Noise {
    static final byte[] NAME = "Noise_XX_25519_ChaChaPoly_SHA256".getBytes(StandardCharsets.US_ASCII);

    /** One direction of an established session. */
    public static final class Cipher {
        final byte[] k; long n; long highest = -1; long window; // bit i = highest - i seen
        Cipher(byte[] k) { this.k = k; }
        public synchronized byte[] encrypt(byte[] pt) {
            long cur = n++;
            if (cur > 0xFFFFFFFEL) throw new IllegalStateException("rekey");
            byte[] ct = Crypto.aeadSeal(k, Crypto.noiseNonce(cur), new byte[0], pt);
            byte[] out = new byte[4 + ct.length];
            out[0] = (byte) (cur >>> 24); out[1] = (byte) (cur >>> 16); out[2] = (byte) (cur >>> 8); out[3] = (byte) cur;
            System.arraycopy(ct, 0, out, 4, ct.length);
            return out;
        }
        public synchronized byte[] decrypt(byte[] in) {
            if (in.length < 20) return null;
            long nn = ((in[0] & 255L) << 24) | ((in[1] & 255L) << 16) | ((in[2] & 255L) << 8) | (in[3] & 255L);
            if (highest >= 0 && nn <= highest) {
                long back = highest - nn;
                if (back >= 64 || ((window >>> back) & 1) == 1) return null; // too old or replayed
            }
            byte[] pt = Crypto.aeadOpen(k, Crypto.noiseNonce(nn), new byte[0], Arrays.copyOfRange(in, 4, in.length));
            if (pt == null) return null;
            if (nn > highest) { long sh = highest < 0 ? 64 : nn - highest; window = sh >= 64 ? 1 : (window << sh) | 1; highest = nn; }
            else window |= 1L << (highest - nn);
            return pt;
        }
    }

    public static final class Handshake {
        final boolean initiator;
        final byte[] sPriv, sPub;
        byte[] ePriv, ePub, re, rs;
        byte[] h, ck, k; long n;
        int step; // messages processed so far (0..3)
        public Cipher send, recv;
        public byte[] handshakeHash;

        public Handshake(boolean initiator, byte[] staticPriv, byte[] staticPub) {
            this.initiator = initiator; sPriv = staticPriv; sPub = staticPub;
            h = NAME.length <= 32 ? Arrays.copyOf(NAME, 32) : Crypto.sha256(NAME);
            ck = h.clone();
            mixHash(new byte[0]); // empty prologue
        }
        public boolean done() { return step >= 3; }
        public byte[] remoteStatic() { return rs; }

        void mixHash(byte[] d) { h = Crypto.sha256(h, d); }
        void mixKey(byte[] ikm) {
            byte[] t = Crypto.hmac256(ck, ikm);
            ck = Crypto.hmac256(t, new byte[] { 1 });
            k = Arrays.copyOf(Crypto.hmac256(t, ck, new byte[] { 2 }), 32); n = 0;
        }
        byte[] encryptAndHash(byte[] p) {
            byte[] c = k == null ? p : Crypto.aeadSeal(k, Crypto.noiseNonce(n++), h, p);
            mixHash(c); return c;
        }
        byte[] decryptAndHash(byte[] c) {
            byte[] p;
            if (k == null) p = c;
            else { p = Crypto.aeadOpen(k, Crypto.noiseNonce(n), h, c); if (p == null) throw new IllegalArgumentException("bad handshake"); n++; }
            mixHash(c); return p;
        }
        static byte[] cat(byte[]... a) { int l = 0; for (byte[] x : a) l += x.length; byte[] o = new byte[l]; int p = 0; for (byte[] x : a) { System.arraycopy(x, 0, o, p, x.length); p += x.length; } return o; }

        /** Writes the next handshake message (empty payload). */
        public byte[] write() {
            if (initiator && step == 0) {
                ePriv = Crypto.random(32); ePub = Crypto.x25519Public(ePriv);
                mixHash(ePub); byte[] pl = encryptAndHash(new byte[0]);
                step = 1; return cat(ePub, pl);
            }
            if (!initiator && step == 1) {
                ePriv = Crypto.random(32); ePub = Crypto.x25519Public(ePriv);
                mixHash(ePub);
                mixKey(Crypto.x25519(ePriv, re));          // ee
                byte[] s = encryptAndHash(sPub);
                mixKey(Crypto.x25519(sPriv, re));          // es
                byte[] pl = encryptAndHash(new byte[0]);
                step = 2; return cat(ePub, s, pl);
            }
            if (initiator && step == 2) {
                byte[] s = encryptAndHash(sPub);
                mixKey(Crypto.x25519(sPriv, re));          // se
                byte[] pl = encryptAndHash(new byte[0]);
                step = 3; finish(); return cat(s, pl);
            }
            throw new IllegalStateException("not our turn");
        }

        /** Reads the next handshake message. Throws on a bad message. */
        public void read(byte[] m) {
            if (!initiator && step == 0) {
                if (m.length < 32) throw new IllegalArgumentException("short");
                re = Arrays.copyOf(m, 32); mixHash(re);
                decryptAndHash(Arrays.copyOfRange(m, 32, m.length));
                step = 1; return;
            }
            if (initiator && step == 1) {
                if (m.length < 32 + 48 + 16) throw new IllegalArgumentException("short");
                re = Arrays.copyOf(m, 32); mixHash(re);
                mixKey(Crypto.x25519(ePriv, re));          // ee
                rs = decryptAndHash(Arrays.copyOfRange(m, 32, 80));
                mixKey(Crypto.x25519(ePriv, rs));          // es
                decryptAndHash(Arrays.copyOfRange(m, 80, m.length));
                step = 2; return;
            }
            if (!initiator && step == 2) {
                if (m.length < 48 + 16) throw new IllegalArgumentException("short");
                rs = decryptAndHash(Arrays.copyOf(m, 48));
                mixKey(Crypto.x25519(ePriv, rs));          // se
                decryptAndHash(Arrays.copyOfRange(m, 48, m.length));
                step = 3; finish(); return;
            }
            throw new IllegalStateException("unexpected handshake message");
        }

        void finish() {
            handshakeHash = h.clone();
            byte[] t = Crypto.hmac256(ck, new byte[0]);
            byte[] k1 = Crypto.hmac256(t, new byte[] { 1 });
            byte[] k2 = Crypto.hmac256(t, k1, new byte[] { 2 });
            send = new Cipher(initiator ? k1 : k2); recv = new Cipher(initiator ? k2 : k1);
            ePriv = null;
        }
    }
}
