package app.viktorych.tv.mesh;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.zip.Deflater;
import java.util.zip.Inflater;

/** Bitchat wire packet (v1 and v2), written from the public protocol
 *  description (WHITEPAPER.md and BinaryProtocol.swift in the public-domain
 *  iOS app): version, type, ttl, 8-byte ms timestamp, flags, payload length,
 *  8-byte sender, optional 8-byte recipient, optional route (v2), payload,
 *  optional 64-byte Ed25519 signature, PKCS#7-style padding to 256/512/1024/2048. */
public final class Packet {
    public static final int ANNOUNCE = 0x01, MESSAGE = 0x02, LEAVE = 0x03,
        NOISE_HANDSHAKE = 0x10, NOISE_ENCRYPTED = 0x11, FRAGMENT = 0x20, REQUEST_SYNC = 0x21;
    static final int F_RECIPIENT = 0x01, F_SIGNATURE = 0x02, F_COMPRESSED = 0x04, F_ROUTE = 0x08, F_RSR = 0x10;
    static final int[] BLOCKS = { 256, 512, 1024, 2048 };
    static final int MAX_PAYLOAD = 1 << 20;
    public static final int COMPRESS_MIN = 100;

    public int version = 1, type, ttl = 7;
    public long timestamp;
    public byte[] sender = new byte[8], recipient, payload = new byte[0], signature;
    public List<byte[]> route;
    public boolean rsr;
    /** The payload exactly as it was on the wire (compressed form when the
     *  sender compressed), so signatures can be checked byte for byte. */
    byte[] wirePayload; int wireOriginalSize = -1;

    public Packet() {}
    public Packet(int type, byte[] sender, byte[] recipient, byte[] payload) {
        this.type = type; this.sender = fit8(sender); this.recipient = recipient == null ? null : fit8(recipient);
        this.payload = payload; this.timestamp = System.currentTimeMillis();
    }
    static byte[] fit8(byte[] b) { return Arrays.copyOf(b, 8); }

    static boolean shouldCompress(byte[] d) {
        if (d.length < COMPRESS_MIN) return false;
        HashSet<Byte> u = new HashSet<>(); for (byte b : d) u.add(b);
        return (double) u.size() / Math.min(d.length, 256) < 0.9;
    }
    static byte[] deflate(byte[] d) {
        Deflater df = new Deflater(Deflater.DEFAULT_COMPRESSION, true);
        df.setInput(d); df.finish();
        byte[] buf = new byte[d.length + d.length / 255 + 16]; int n = df.deflate(buf); boolean ok = df.finished(); df.end();
        return ok && n > 0 && n < d.length ? Arrays.copyOf(buf, n) : null;
    }
    static byte[] inflate(byte[] c, int size) {
        for (boolean raw : new boolean[] { true, false }) {
            Inflater in = new Inflater(raw);
            try { in.setInput(c); byte[] out = new byte[size]; int n = in.inflate(out); if (n == size) return out; }
            catch (Exception ignored) { /* try the other framing */ }
            finally { in.end(); }
        }
        return null;
    }

    public byte[] encode(boolean pad) { return encode(pad, false); }

    byte[] encode(boolean pad, boolean forSigning) {
        int lenBytes = version == 2 ? 4 : 2;
        byte[] body = payload; boolean comp = false; int orig = 0;
        if (wirePayload != null) { body = wirePayload; comp = wireOriginalSize >= 0; orig = wireOriginalSize; }
        else if (shouldCompress(payload)) { byte[] c = deflate(payload); if (c != null) { body = c; comp = true; orig = payload.length; } }
        boolean hasRoute = version >= 2 && route != null && !route.isEmpty();
        ByteArrayOutputStream o = new ByteArrayOutputStream(64 + body.length);
        o.write(version); o.write(type); o.write(forSigning ? 0 : ttl);
        for (int s = 56; s >= 0; s -= 8) o.write((int) (timestamp >>> s));
        int f = 0;
        if (recipient != null) f |= F_RECIPIENT;
        if (signature != null && !forSigning) f |= F_SIGNATURE;
        if (comp) f |= F_COMPRESSED;
        if (hasRoute) f |= F_ROUTE;
        if (rsr && !forSigning) f |= F_RSR;
        o.write(f);
        int len = body.length + (comp ? lenBytes : 0);
        if (version == 2) { o.write(len >>> 24); o.write(len >>> 16); }
        o.write(len >>> 8); o.write(len);
        o.write(sender, 0, 8);
        if (recipient != null) o.write(recipient, 0, 8);
        if (hasRoute) { o.write(route.size()); for (byte[] hop : route) o.write(fit8(hop), 0, 8); }
        if (comp) { if (version == 2) { o.write(orig >>> 24); o.write(orig >>> 16); } o.write(orig >>> 8); o.write(orig); }
        o.write(body, 0, body.length);
        if (signature != null && !forSigning) o.write(signature, 0, 64);
        byte[] d = o.toByteArray();
        return pad ? padTo(d) : d;
    }

    /** The bytes Bitchat signs: TTL 0, no signature, no RSR flag, padded. */
    public byte[] signingBytes() { return encode(true, true); }

    static byte[] padTo(byte[] d) {
        int target = d.length;
        for (int b : BLOCKS) if (d.length + 16 <= b) { target = b; break; }
        int need = target - d.length;
        if (need <= 0 || need > 255) return d;
        byte[] p = Arrays.copyOf(d, target); Arrays.fill(p, d.length, target, (byte) need);
        return p;
    }
    static byte[] unpad(byte[] d) {
        if (d.length == 0) return d;
        int n = d[d.length - 1] & 255;
        if (n == 0 || n > d.length) return d;
        for (int i = d.length - n; i < d.length; i++) if ((d[i] & 255) != n) return d;
        return Arrays.copyOf(d, d.length - n);
    }

    public static Packet decode(byte[] d) {
        Packet p = decodeCore(d);
        if (p != null) return p;
        byte[] u = unpad(d);
        return u.length == d.length ? null : decodeCore(u);
    }

    static Packet decodeCore(byte[] d) {
        try {
            if (d.length < 14 + 8) return null;
            int i = 0; Packet p = new Packet();
            p.version = d[i++] & 255; if (p.version != 1 && p.version != 2) return null;
            int lenBytes = p.version == 2 ? 4 : 2;
            p.type = d[i++] & 255; p.ttl = d[i++] & 255;
            long ts = 0; for (int k = 0; k < 8; k++) ts = (ts << 8) | (d[i++] & 255); p.timestamp = ts;
            int f = d[i++] & 255;
            long len = 0; for (int k = 0; k < lenBytes; k++) len = (len << 8) | (d[i++] & 255);
            if (len > MAX_PAYLOAD) return null;
            p.sender = Arrays.copyOfRange(d, i, i + 8); i += 8;
            if ((f & F_RECIPIENT) != 0) { if (i + 8 > d.length) return null; p.recipient = Arrays.copyOfRange(d, i, i + 8); i += 8; }
            if (p.version >= 2 && (f & F_ROUTE) != 0) {
                int c = d[i++] & 255; p.route = new ArrayList<>();
                for (int k = 0; k < c; k++) { if (i + 8 > d.length) return null; p.route.add(Arrays.copyOfRange(d, i, i + 8)); i += 8; }
            }
            p.rsr = (f & F_RSR) != 0;
            if ((f & F_COMPRESSED) != 0) {
                if (len < lenBytes) return null;
                int orig = 0; for (int k = 0; k < lenBytes; k++) orig = (orig << 8) | (d[i++] & 255);
                int clen = (int) len - lenBytes;
                if (orig < 0 || orig > MAX_PAYLOAD || clen <= 0 || i + clen > d.length || orig > clen * 50) return null;
                p.wirePayload = Arrays.copyOfRange(d, i, i + clen); p.wireOriginalSize = orig; i += clen;
                p.payload = inflate(p.wirePayload, orig);
                if (p.payload == null) return null;
            } else {
                if (i + len > d.length) return null;
                p.payload = Arrays.copyOfRange(d, i, i + (int) len); i += (int) len;
                p.wirePayload = p.payload;
            }
            if ((f & F_SIGNATURE) != 0) { if (i + 64 > d.length) return null; p.signature = Arrays.copyOfRange(d, i, i + 64); i += 64; }
            return p;
        } catch (ArrayIndexOutOfBoundsException e) { return null; }
    }

    /* ---------- TLV payloads ---------- */
    public static final class Announce {
        public String nickname; public byte[] noiseKey, signingKey; public List<byte[]> neighbors = new ArrayList<>();
        public byte[] encode() {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] n = utf8Cut(nickname, 255);
            tlv(o, 1, n); tlv(o, 2, noiseKey); tlv(o, 3, signingKey);
            if (!neighbors.isEmpty()) {
                ByteArrayOutputStream nb = new ByteArrayOutputStream();
                for (int k = 0; k < neighbors.size() && k < 10; k++) nb.write(neighbors.get(k), 0, 8);
                tlv(o, 4, nb.toByteArray());
            }
            return o.toByteArray();
        }
        public static Announce decode(byte[] d) {
            Announce a = new Announce(); int i = 0;
            while (i + 2 <= d.length) {
                int t = d[i++] & 255, l = d[i++] & 255;
                if (i + l > d.length) return null;
                byte[] v = Arrays.copyOfRange(d, i, i + l); i += l;
                if (t == 1) a.nickname = new String(v, StandardCharsets.UTF_8);
                else if (t == 2) a.noiseKey = v;
                else if (t == 3) a.signingKey = v;
                else if (t == 4 && l % 8 == 0) for (int k = 0; k < l; k += 8) a.neighbors.add(Arrays.copyOfRange(v, k, k + 8));
            }
            return a.nickname == null || a.noiseKey == null || a.signingKey == null ? null : a;
        }
    }

    /** Noise payload 0x01: TLV 0x00 message id, 0x01 content. */
    public static byte[] privateMessage(String id, String content) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.write(0x01); tlv(o, 0, utf8Cut(id, 255)); tlv(o, 1, utf8Cut(content, 255));
        return o.toByteArray();
    }
    /** Returns {id, content} or null. */
    public static String[] parsePrivateMessage(byte[] d, int from) {
        String id = null, c = null; int i = from;
        while (i + 2 <= d.length) {
            int t = d[i++] & 255, l = d[i++] & 255;
            if (i + l > d.length || t > 1) return null;
            String v = new String(d, i, l, StandardCharsets.UTF_8); i += l;
            if (t == 0) id = v; else c = v;
        }
        return id == null || c == null ? null : new String[] { id, c };
    }

    static void tlv(ByteArrayOutputStream o, int t, byte[] v) { o.write(t); o.write(v.length); o.write(v, 0, v.length); }
    static byte[] utf8Cut(String s, int max) {
        byte[] b = s.getBytes(StandardCharsets.UTF_8);
        if (b.length <= max) return b;
        int n = max; while (n > 0 && (b[n] & 0xC0) == 0x80) n--; // keep whole characters
        return Arrays.copyOf(b, n);
    }

    /* ---------- fragments: 8-byte id, u16 index, u16 total, original type, chunk ---------- */
    public static List<Packet> fragment(Packet p, byte[] full, int chunk) {
        List<Packet> out = new ArrayList<>(); byte[] id = Crypto.random(8);
        int total = (full.length + chunk - 1) / chunk;
        for (int k = 0; k < total; k++) {
            int a = k * chunk, b = Math.min(full.length, a + chunk);
            byte[] pl = new byte[13 + (b - a)];
            System.arraycopy(id, 0, pl, 0, 8);
            pl[8] = (byte) (k >> 8); pl[9] = (byte) k; pl[10] = (byte) (total >> 8); pl[11] = (byte) total; pl[12] = (byte) p.type;
            System.arraycopy(full, a, pl, 13, b - a);
            Packet f = new Packet(FRAGMENT, p.sender, p.recipient, pl); f.timestamp = p.timestamp; f.ttl = p.ttl;
            out.add(f);
        }
        return out;
    }
}
