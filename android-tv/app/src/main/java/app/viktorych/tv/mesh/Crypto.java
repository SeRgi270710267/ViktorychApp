package app.viktorych.tv.mesh;

import java.math.BigInteger;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Small, dependency-free crypto for the Bitchat-compatible mesh: X25519,
 *  Ed25519, ChaCha20-Poly1305 (RFC 8439), SHA-256/512 and HMAC-SHA256.
 *  Android only ships these natively on new versions, and TV boxes are often
 *  Android 7-11, so they are written out here. BigInteger keeps the code short
 *  and readable; the mesh only does a handful of operations per minute.
 *  Checked against the JDK's own providers by scripts/bitchat_mesh_test.sh. */
public final class Crypto {
    private Crypto() {}
    public static final SecureRandom RNG = new SecureRandom();
    static final BigInteger P = BigInteger.ONE.shiftLeft(255).subtract(BigInteger.valueOf(19));
    static final BigInteger TWO = BigInteger.valueOf(2);

    public static byte[] random(int n) { byte[] b = new byte[n]; RNG.nextBytes(b); return b; }

    public static byte[] sha256(byte[]... parts) { return digest("SHA-256", parts); }
    public static byte[] sha512(byte[]... parts) { return digest("SHA-512", parts); }
    private static byte[] digest(String alg, byte[]... parts) {
        try { MessageDigest md = MessageDigest.getInstance(alg); for (byte[] p : parts) md.update(p); return md.digest(); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static byte[] hmac256(byte[] key, byte[]... parts) {
        // An empty HMAC key equals an all-zero key (HMAC pads keys with zeros).
        try { Mac m = Mac.getInstance("HmacSHA256"); m.init(new SecretKeySpec(key.length == 0 ? new byte[32] : key, "HmacSHA256"));
            for (byte[] p : parts) m.update(p); return m.doFinal(); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    static BigInteger le(byte[] b) {
        byte[] r = new byte[b.length + 1];
        for (int i = 0; i < b.length; i++) r[b.length - i] = b[i];
        return new BigInteger(r);
    }
    static byte[] le(BigInteger x, int len) {
        byte[] be = x.toByteArray(); byte[] out = new byte[len];
        for (int i = 0; i < len && i < be.length; i++) out[i] = be[be.length - 1 - i];
        return out;
    }

    /* ---------------- X25519 (RFC 7748) ---------------- */
    static final BigInteger A24 = BigInteger.valueOf(121665);

    public static byte[] x25519(byte[] scalar, byte[] u) {
        byte[] k = scalar.clone();
        k[0] &= (byte) 248; k[31] &= 127; k[31] |= 64;
        byte[] uu = u.clone(); uu[31] &= 127;
        BigInteger kk = le(k), x1 = le(uu).mod(P);
        BigInteger x2 = BigInteger.ONE, z2 = BigInteger.ZERO, x3 = x1, z3 = BigInteger.ONE;
        int swap = 0;
        for (int t = 254; t >= 0; t--) {
            int kt = kk.testBit(t) ? 1 : 0;
            swap ^= kt;
            if (swap == 1) { BigInteger a = x2; x2 = x3; x3 = a; a = z2; z2 = z3; z3 = a; }
            swap = kt;
            BigInteger A = x2.add(z2), AA = A.multiply(A).mod(P), B = x2.subtract(z2), BB = B.multiply(B).mod(P);
            BigInteger E = AA.subtract(BB), C = x3.add(z3), D = x3.subtract(z3);
            BigInteger DA = D.multiply(A).mod(P), CB = C.multiply(B).mod(P);
            BigInteger s = DA.add(CB), d = DA.subtract(CB);
            x3 = s.multiply(s).mod(P);
            z3 = x1.multiply(d.multiply(d)).mod(P);
            x2 = AA.multiply(BB).mod(P);
            z2 = E.multiply(AA.add(A24.multiply(E))).mod(P);
        }
        if (swap == 1) { x2 = x3; z2 = z3; }
        BigInteger r = x2.multiply(z2.modPow(P.subtract(TWO), P)).mod(P);
        return le(r, 32);
    }
    static final byte[] BASE9 = new byte[32];
    static { BASE9[0] = 9; }
    public static byte[] x25519Public(byte[] priv) { return x25519(priv, BASE9); }

    /* ---------------- Ed25519 (RFC 8032) ---------------- */
    static final BigInteger L = BigInteger.ONE.shiftLeft(252).add(new BigInteger("27742317777372353535851937790883648493"));
    static final BigInteger D = BigInteger.valueOf(-121665).multiply(BigInteger.valueOf(121666).modInverse(P)).mod(P);
    static final BigInteger SQRTM1 = TWO.modPow(P.subtract(BigInteger.ONE).shiftRight(2), P);
    static final BigInteger[] BASE;
    static {
        BigInteger by = BigInteger.valueOf(4).multiply(BigInteger.valueOf(5).modInverse(P)).mod(P);
        BigInteger bx = recoverX(by, 0);
        BASE = new BigInteger[] { bx, by, BigInteger.ONE, bx.multiply(by).mod(P) };
    }
    static BigInteger recoverX(BigInteger y, int sign) {
        if (y.compareTo(P) >= 0) return null;
        BigInteger y2 = y.multiply(y).mod(P);
        BigInteger x2 = y2.subtract(BigInteger.ONE).multiply(D.multiply(y2).add(BigInteger.ONE).modInverse(P)).mod(P);
        if (x2.signum() == 0) return sign == 1 ? null : BigInteger.ZERO;
        BigInteger x = x2.modPow(P.add(BigInteger.valueOf(3)).shiftRight(3), P);
        if (x.multiply(x).subtract(x2).mod(P).signum() != 0) x = x.multiply(SQRTM1).mod(P);
        if (x.multiply(x).subtract(x2).mod(P).signum() != 0) return null;
        if ((x.testBit(0) ? 1 : 0) != sign) x = P.subtract(x);
        return x;
    }
    static BigInteger[] padd(BigInteger[] p, BigInteger[] q) {
        BigInteger a = p[1].subtract(p[0]).multiply(q[1].subtract(q[0])).mod(P);
        BigInteger b = p[1].add(p[0]).multiply(q[1].add(q[0])).mod(P);
        BigInteger c = TWO.multiply(p[3]).multiply(q[3]).mod(P).multiply(D).mod(P);
        BigInteger d = TWO.multiply(p[2]).multiply(q[2]).mod(P);
        BigInteger e = b.subtract(a), f = d.subtract(c), g = d.add(c), h = b.add(a);
        return new BigInteger[] { e.multiply(f).mod(P), g.multiply(h).mod(P), f.multiply(g).mod(P), e.multiply(h).mod(P) };
    }
    static BigInteger[] pmul(BigInteger s, BigInteger[] p) {
        BigInteger[] q = { BigInteger.ZERO, BigInteger.ONE, BigInteger.ONE, BigInteger.ZERO };
        for (int i = s.bitLength() - 1; i >= 0; i--) { q = padd(q, q); if (s.testBit(i)) q = padd(q, p); }
        return q;
    }
    static byte[] encodePoint(BigInteger[] p) {
        BigInteger zi = p[2].modInverse(P);
        BigInteger x = p[0].multiply(zi).mod(P), y = p[1].multiply(zi).mod(P);
        byte[] out = le(y, 32);
        if (x.testBit(0)) out[31] |= (byte) 0x80;
        return out;
    }
    static BigInteger[] decodePoint(byte[] s) {
        if (s == null || s.length != 32) return null;
        byte[] c = s.clone(); int sign = (c[31] >> 7) & 1; c[31] &= 127;
        BigInteger y = le(c); BigInteger x = recoverX(y, sign);
        if (x == null) return null;
        return new BigInteger[] { x, y, BigInteger.ONE, x.multiply(y).mod(P) };
    }
    private static BigInteger clampScalar(byte[] h) {
        byte[] a = Arrays.copyOf(h, 32); a[0] &= (byte) 248; a[31] &= 63; a[31] |= 64; return le(a);
    }
    public static byte[] ed25519Public(byte[] seed) { return encodePoint(pmul(clampScalar(sha512(seed)), BASE)); }
    public static byte[] ed25519Sign(byte[] seed, byte[] msg) {
        byte[] h = sha512(seed); BigInteger a = clampScalar(h);
        byte[] A = encodePoint(pmul(a, BASE));
        BigInteger r = le(sha512(Arrays.copyOfRange(h, 32, 64), msg)).mod(L);
        byte[] R = encodePoint(pmul(r, BASE));
        BigInteger k = le(sha512(R, A, msg)).mod(L);
        byte[] S = le(r.add(k.multiply(a)).mod(L), 32);
        byte[] sig = new byte[64]; System.arraycopy(R, 0, sig, 0, 32); System.arraycopy(S, 0, sig, 32, 32);
        return sig;
    }
    public static boolean ed25519Verify(byte[] pub, byte[] msg, byte[] sig) {
        try {
            if (pub == null || sig == null || sig.length != 64 || pub.length != 32) return false;
            BigInteger[] A = decodePoint(pub); if (A == null) return false;
            byte[] Rb = Arrays.copyOfRange(sig, 0, 32);
            BigInteger S = le(Arrays.copyOfRange(sig, 32, 64)); if (S.compareTo(L) >= 0) return false;
            if (decodePoint(Rb) == null) return false;
            BigInteger k = le(sha512(Rb, pub, msg)).mod(L);
            byte[] lhs = encodePoint(pmul(S, BASE));
            byte[] rhs = encodePoint(padd(decodePoint(Rb), pmul(k, A)));
            return Arrays.equals(lhs, rhs);
        } catch (RuntimeException e) { return false; }
    }

    /* ---------------- ChaCha20-Poly1305 (RFC 8439) ---------------- */
    private static int rotl(int v, int c) { return (v << c) | (v >>> (32 - c)); }
    private static int rd(byte[] b, int o) { return (b[o] & 255) | (b[o + 1] & 255) << 8 | (b[o + 2] & 255) << 16 | (b[o + 3] & 255) << 24; }
    static void chachaBlock(byte[] key, int counter, byte[] nonce, byte[] out) {
        int[] s = new int[16];
        s[0] = 0x61707865; s[1] = 0x3320646e; s[2] = 0x79622d32; s[3] = 0x6b206574;
        for (int i = 0; i < 8; i++) s[4 + i] = rd(key, i * 4);
        s[12] = counter; s[13] = rd(nonce, 0); s[14] = rd(nonce, 4); s[15] = rd(nonce, 8);
        int[] x = s.clone();
        for (int i = 0; i < 10; i++) {
            qr(x, 0, 4, 8, 12); qr(x, 1, 5, 9, 13); qr(x, 2, 6, 10, 14); qr(x, 3, 7, 11, 15);
            qr(x, 0, 5, 10, 15); qr(x, 1, 6, 11, 12); qr(x, 2, 7, 8, 13); qr(x, 3, 4, 9, 14);
        }
        for (int i = 0; i < 16; i++) { int v = x[i] + s[i]; out[i * 4] = (byte) v; out[i * 4 + 1] = (byte) (v >> 8); out[i * 4 + 2] = (byte) (v >> 16); out[i * 4 + 3] = (byte) (v >> 24); }
    }
    private static void qr(int[] x, int a, int b, int c, int d) {
        x[a] += x[b]; x[d] = rotl(x[d] ^ x[a], 16); x[c] += x[d]; x[b] = rotl(x[b] ^ x[c], 12);
        x[a] += x[b]; x[d] = rotl(x[d] ^ x[a], 8); x[c] += x[d]; x[b] = rotl(x[b] ^ x[c], 7);
    }
    static byte[] chacha(byte[] key, int counter, byte[] nonce, byte[] in) {
        byte[] out = new byte[in.length], ks = new byte[64];
        for (int off = 0; off < in.length; off += 64, counter++) {
            chachaBlock(key, counter, nonce, ks);
            for (int i = 0; i < 64 && off + i < in.length; i++) out[off + i] = (byte) (in[off + i] ^ ks[i]);
        }
        return out;
    }
    static final BigInteger P130 = BigInteger.ONE.shiftLeft(130).subtract(BigInteger.valueOf(5));
    static final BigInteger CLAMP = new BigInteger("0ffffffc0ffffffc0ffffffc0fffffff", 16);
    static byte[] poly1305(byte[] key, byte[] msg) {
        BigInteger r = le(Arrays.copyOfRange(key, 0, 16)).and(CLAMP), s = le(Arrays.copyOfRange(key, 16, 32)), acc = BigInteger.ZERO;
        for (int i = 0; i < msg.length; i += 16) {
            byte[] blk = Arrays.copyOfRange(msg, i, Math.min(i + 16, msg.length));
            byte[] n = Arrays.copyOf(blk, blk.length + 1); n[blk.length] = 1;
            acc = acc.add(le(n)).multiply(r).mod(P130);
        }
        return le(acc.add(s), 16);
    }
    private static byte[] macData(byte[] ad, byte[] ct) {
        int pa = (16 - ad.length % 16) % 16, pc = (16 - ct.length % 16) % 16;
        byte[] m = new byte[ad.length + pa + ct.length + pc + 16];
        System.arraycopy(ad, 0, m, 0, ad.length);
        System.arraycopy(ct, 0, m, ad.length + pa, ct.length);
        int o = ad.length + pa + ct.length + pc;
        long la = ad.length, lc = ct.length;
        for (int i = 0; i < 8; i++) { m[o + i] = (byte) (la >>> (8 * i)); m[o + 8 + i] = (byte) (lc >>> (8 * i)); }
        return m;
    }
    public static byte[] aeadSeal(byte[] key, byte[] nonce12, byte[] ad, byte[] pt) {
        byte[] polyKey = new byte[64]; chachaBlock(key, 0, nonce12, polyKey);
        byte[] ct = chacha(key, 1, nonce12, pt);
        byte[] tag = poly1305(Arrays.copyOf(polyKey, 32), macData(ad, ct));
        byte[] out = Arrays.copyOf(ct, ct.length + 16); System.arraycopy(tag, 0, out, ct.length, 16);
        return out;
    }
    /** Returns null when the tag does not match. */
    public static byte[] aeadOpen(byte[] key, byte[] nonce12, byte[] ad, byte[] in) {
        if (in.length < 16) return null;
        byte[] ct = Arrays.copyOf(in, in.length - 16), tag = Arrays.copyOfRange(in, in.length - 16, in.length);
        byte[] polyKey = new byte[64]; chachaBlock(key, 0, nonce12, polyKey);
        if (!MessageDigest.isEqual(tag, poly1305(Arrays.copyOf(polyKey, 32), macData(ad, ct)))) return null;
        return chacha(key, 1, nonce12, ct);
    }
    /** Noise nonce: 4 zero bytes then the 64-bit counter, little-endian. */
    public static byte[] noiseNonce(long n) {
        byte[] b = new byte[12]; for (int i = 0; i < 8; i++) b[4 + i] = (byte) (n >>> (8 * i)); return b;
    }

    public static String hex(byte[] b) { StringBuilder s = new StringBuilder(); for (byte x : b) s.append(String.format("%02x", x & 255)); return s.toString(); }
    public static byte[] unhex(String h) { byte[] b = new byte[h.length() / 2]; for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(h.substring(i * 2, i * 2 + 2), 16); return b; }
}
