package app.viktorych.tv.mesh;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;

/** secp256k1 BIP-340 Schnorr and NIP-01 event ids, for Bitchat's Nostr
 *  location channels (kind 20000, tagged with a geohash). Pure Java. */
public final class NostrSign {
    private NostrSign() {}
    static final BigInteger P = new BigInteger("fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f", 16);
    static final BigInteger N = new BigInteger("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141", 16);
    static final BigInteger[] G = { new BigInteger("79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", 16),
        new BigInteger("483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8", 16) };

    static BigInteger[] add(BigInteger[] a, BigInteger[] b) {
        if (a == null) return b; if (b == null) return a;
        BigInteger l;
        if (a[0].equals(b[0])) {
            if (!a[1].equals(b[1]) || a[1].signum() == 0) return null;
            l = BigInteger.valueOf(3).multiply(a[0]).multiply(a[0]).multiply(a[1].shiftLeft(1).modInverse(P)).mod(P);
        } else l = b[1].subtract(a[1]).multiply(b[0].subtract(a[0]).modInverse(P)).mod(P);
        BigInteger x = l.multiply(l).subtract(a[0]).subtract(b[0]).mod(P);
        return new BigInteger[] { x, l.multiply(a[0].subtract(x)).subtract(a[1]).mod(P) };
    }
    static BigInteger[] mul(BigInteger k, BigInteger[] p) {
        BigInteger[] r = null;
        for (int i = k.bitLength() - 1; i >= 0; i--) { r = add(r, r); if (k.testBit(i)) r = add(r, p); }
        return r;
    }
    static byte[] b32(BigInteger x) {
        byte[] b = x.toByteArray(), o = new byte[32];
        int n = Math.min(32, b.length); System.arraycopy(b, b.length - n, o, 32 - n, n); return o;
    }
    static BigInteger num(byte[] b) { return new BigInteger(1, b); }
    static byte[] tagged(String tag, byte[]... parts) {
        byte[] t = Crypto.sha256(tag.getBytes(StandardCharsets.US_ASCII));
        byte[][] all = new byte[parts.length + 2][]; all[0] = t; all[1] = t; System.arraycopy(parts, 0, all, 2, parts.length);
        return Crypto.sha256(all);
    }
    static BigInteger[] liftX(BigInteger x) {
        if (x.compareTo(P) >= 0) return null;
        BigInteger c = x.modPow(BigInteger.valueOf(3), P).add(BigInteger.valueOf(7)).mod(P);
        BigInteger y = c.modPow(P.add(BigInteger.ONE).shiftRight(2), P);
        if (!y.modPow(BigInteger.valueOf(2), P).equals(c)) return null;
        return new BigInteger[] { x, y.testBit(0) ? P.subtract(y) : y };
    }

    public static byte[] publicKey(byte[] sec) { return b32(mul(num(sec), G)[0]); }

    public static byte[] sign(byte[] sec, byte[] msg32, byte[] aux32) {
        BigInteger d0 = num(sec);
        if (d0.signum() == 0 || d0.compareTo(N) >= 0) throw new IllegalArgumentException("bad key");
        BigInteger[] Pp = mul(d0, G);
        BigInteger d = Pp[1].testBit(0) ? N.subtract(d0) : d0;
        byte[] t = b32(d.xor(num(tagged("BIP0340/aux", aux32))));
        byte[] px = b32(Pp[0]);
        BigInteger k0 = num(tagged("BIP0340/nonce", t, px, msg32)).mod(N);
        if (k0.signum() == 0) throw new IllegalStateException("retry");
        BigInteger[] R = mul(k0, G);
        BigInteger k = R[1].testBit(0) ? N.subtract(k0) : k0;
        byte[] rx = b32(R[0]);
        BigInteger e = num(tagged("BIP0340/challenge", rx, px, msg32)).mod(N);
        byte[] sig = new byte[64];
        System.arraycopy(rx, 0, sig, 0, 32); System.arraycopy(b32(k.add(e.multiply(d)).mod(N)), 0, sig, 32, 32);
        return sig;
    }

    public static boolean verify(byte[] pub32, byte[] msg32, byte[] sig) {
        try {
            if (sig.length != 64 || pub32.length != 32) return false;
            BigInteger[] Pp = liftX(num(pub32)); if (Pp == null) return false;
            BigInteger r = num(Arrays.copyOf(sig, 32)), s = num(Arrays.copyOfRange(sig, 32, 64));
            if (r.compareTo(P) >= 0 || s.compareTo(N) >= 0) return false;
            BigInteger e = num(tagged("BIP0340/challenge", Arrays.copyOf(sig, 32), pub32, msg32)).mod(N);
            BigInteger[] R = add(mul(s, G), mul(N.subtract(e), Pp));
            return R != null && !R[1].testBit(0) && R[0].equals(r);
        } catch (RuntimeException ex) { return false; }
    }

    /** NIP-01 JSON string escaping (the exact form event ids are hashed over). */
    public static String quote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                case '\b': b.append("\\b"); break;
                case '\f': b.append("\\f"); break;
                default: if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
            }
        }
        return b.append('"').toString();
    }
    public static String tagsJson(List<String[]> tags) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < tags.size(); i++) {
            if (i > 0) b.append(',');
            b.append('['); String[] t = tags.get(i);
            for (int j = 0; j < t.length; j++) { if (j > 0) b.append(','); b.append(quote(t[j])); }
            b.append(']');
        }
        return b.append(']').toString();
    }
    public static byte[] eventId(String pubHex, long createdAt, int kind, List<String[]> tags, String content) {
        String ser = "[0," + quote(pubHex) + "," + createdAt + "," + kind + "," + tagsJson(tags) + "," + quote(content) + "]";
        return Crypto.sha256(ser.getBytes(StandardCharsets.UTF_8));
    }
    static int leadingZeroBits(byte[] h) {
        int n = 0; for (byte b : h) { if (b == 0) { n += 8; continue; } n += Integer.numberOfLeadingZeros(b & 255) - 24; break; } return n;
    }

    /** A signed event as JSON, with a NIP-13 proof-of-work nonce tag of
     *  {@code bits} difficulty (Bitchat asks 8 bits for geohash chat). */
    public static String event(byte[] sec, int kind, List<String[]> tags, String content, int bits) {
        String pub = Crypto.hex(publicKey(sec));
        long now = System.currentTimeMillis() / 1000;
        byte[] id = null;
        if (bits > 0) {
            String[] nonce = { "nonce", "0", String.valueOf(bits) }; tags.add(nonce);
            for (long i = 0; i < 2_000_000; i++) {
                nonce[1] = Long.toString(i);
                id = eventId(pub, now, kind, tags, content);
                if (leadingZeroBits(id) >= bits) break;
            }
        } else id = eventId(pub, now, kind, tags, content);
        byte[] sig = sign(sec, id, Crypto.random(32));
        return "{\"id\":\"" + Crypto.hex(id) + "\",\"pubkey\":\"" + pub + "\",\"created_at\":" + now + ",\"kind\":" + kind
            + ",\"tags\":" + tagsJson(tags) + ",\"content\":" + quote(content) + ",\"sig\":\"" + Crypto.hex(sig) + "\"}";
    }

    /* ---------- geohash ---------- */
    static final String B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    public static boolean isGeohash(String g) {
        if (g == null || g.length() < 2 || g.length() > 12) return false;
        for (char c : g.toCharArray()) if (B32.indexOf(c) < 0) return false;
        return true;
    }
    public static String geohash(double lat, double lon, int len) {
        double[] la = { -90, 90 }, lo = { -180, 180 }; StringBuilder g = new StringBuilder(); boolean even = true; int bit = 0, ch = 0;
        while (g.length() < len) {
            double[] r = even ? lo : la; double v = even ? lon : lat, mid = (r[0] + r[1]) / 2;
            if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch <<= 1; r[1] = mid; }
            even = !even;
            if (++bit == 5) { g.append(B32.charAt(ch)); bit = 0; ch = 0; }
        }
        return g.toString();
    }
}
