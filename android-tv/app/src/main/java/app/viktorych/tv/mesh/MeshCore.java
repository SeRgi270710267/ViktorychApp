package app.viktorych.tv.mesh;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Bitchat-compatible mesh logic with no Android code in it, so it can be
 *  tested on a plain JVM: signed announces, public chat, TTL relay with
 *  de-duplication and jitter, fragments, and Noise XX private messages.
 *  Links (Bluetooth connections) are added by BleMesh. */
public final class MeshCore {
    public interface Link { void send(byte[] data); int maxWrite(); }
    public interface Listener {
        void onPublic(Peer from, String text, long ts, boolean verified);
        void onPrivate(Peer from, String id, String text, long ts);
        void onDelivered(String messageId);
        void onPeersChanged();
    }
    public static final class Peer {
        public final String id; public String nickname = "?"; public byte[] noiseKey, signingKey;
        public long lastSeen; public boolean verified;
        Peer(String id) { this.id = id; }
    }

    public static final int TTL = 7;
    static final long SEEN_MS = 5 * 60_000L, PEER_MS = 60_000L, MAX_AGE_MS = 6 * 3600_000L;
    static final byte[] BROADCAST = { -1, -1, -1, -1, -1, -1, -1, -1 };

    final byte[] noisePriv, noisePub, edSeed, edPub, myId;
    public final String myHex;
    volatile String nickname;
    final List<Link> links = new CopyOnWriteArrayList<>();
    final Map<String, Peer> peers = new HashMap<>();
    final LinkedHashMap<String, Long> seen = new LinkedHashMap<String, Long>(256, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, Long> e) { return size() > 1000; }
    };
    final Map<String, Noise.Handshake> handshakes = new HashMap<>();
    final Map<String, Noise.Handshake> sessions = new HashMap<>();
    final Map<String, List<String[]>> queued = new HashMap<>();
    final Map<String, Assembly> assemblies = new HashMap<>();
    /** Encrypted packets that overtook the last handshake message on the mesh. */
    final Map<String, List<byte[]>> early = new HashMap<>();
    final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    volatile Listener listener;
    public volatile long relayed, received;

    static final class Assembly { byte[][] parts; int have; long started; int type; }

    public MeshCore(byte[] noisePriv, byte[] edSeed, String nickname) {
        this.noisePriv = noisePriv; this.noisePub = Crypto.x25519Public(noisePriv);
        this.edSeed = edSeed; this.edPub = Crypto.ed25519Public(edSeed);
        this.myId = Arrays.copyOf(Crypto.sha256(noisePub), 8); this.myHex = Crypto.hex(myId);
        this.nickname = nickname;
    }
    public void setListener(Listener l) { listener = l; }
    public void setNickname(String n) { nickname = n; }
    public String fingerprint() { return Crypto.hex(Crypto.sha256(noisePub)); }
    public void addLink(Link l) { links.add(l); }
    public void removeLink(Link l) { links.remove(l); }
    public int linkCount() { return links.size(); }
    public void shutdown() { timer.shutdownNow(); }

    public synchronized List<Peer> peers() {
        long now = System.currentTimeMillis(); List<Peer> out = new ArrayList<>();
        for (Iterator<Peer> it = peers.values().iterator(); it.hasNext(); ) {
            Peer p = it.next();
            if (now - p.lastSeen > PEER_MS) it.remove(); else out.add(p);
        }
        return out;
    }

    /* ---------------- sending ---------------- */
    Packet signed(Packet p) { p.signature = Crypto.ed25519Sign(edSeed, p.signingBytes()); return p; }

    public void announce() {
        Packet.Announce a = new Packet.Announce();
        a.nickname = nickname; a.noiseKey = noisePub; a.signingKey = edPub;
        Packet p = signed(new Packet(Packet.ANNOUNCE, myId, null, a.encode()));
        markSeen(p); broadcast(p, null);
    }
    public void leave() {
        Packet p = new Packet(Packet.LEAVE, myId, null, new byte[0]);
        broadcast(p, null);
    }
    public void sendPublic(String text) {
        Packet p = signed(new Packet(Packet.MESSAGE, myId, null, text.getBytes(StandardCharsets.UTF_8)));
        markSeen(p); broadcast(p, null);
    }
    /** Returns the message id; delivery is reported through onDelivered. */
    public String sendPrivate(String peerHex, String text) {
        String id = UUID.randomUUID().toString().toUpperCase();
        Noise.Handshake s;
        synchronized (this) { s = sessions.get(peerHex); if (s == null) { queue(peerHex, id, text); } }
        if (s != null) sendEncrypted(peerHex, s, Packet.privateMessage(id, text));
        else startHandshake(peerHex);
        return id;
    }
    synchronized void queue(String peer, String id, String text) {
        List<String[]> q = queued.get(peer); if (q == null) queued.put(peer, q = new ArrayList<>());
        if (q.size() < 50) q.add(new String[] { id, text });
    }
    void startHandshake(String peerHex) {
        Noise.Handshake h;
        synchronized (this) {
            if (handshakes.containsKey(peerHex)) return;
            h = new Noise.Handshake(true, noisePriv, noisePub); handshakes.put(peerHex, h);
        }
        sendDirected(Packet.NOISE_HANDSHAKE, peerHex, h.write());
    }
    void sendEncrypted(String peerHex, Noise.Handshake s, byte[] noisePayload) {
        sendDirected(Packet.NOISE_ENCRYPTED, peerHex, s.send.encrypt(noisePayload));
    }
    void sendDirected(int type, String peerHex, byte[] payload) {
        Packet p = new Packet(type, myId, Crypto.unhex(peerHex), payload);
        markSeen(p); broadcast(p, null);
    }

    void broadcast(Packet p, Link except) {
        boolean noise = p.type == Packet.NOISE_HANDSHAKE || p.type == Packet.NOISE_ENCRYPTED;
        byte[] data = p.encode(noise);
        for (Link l : links) {
            if (l == except) continue;
            int max = l.maxWrite();
            if (data.length <= max) { l.send(data); continue; }
            int chunk = Math.max(32, Math.min(469, max - 64));
            for (Packet f : Packet.fragment(p, data, chunk)) l.send(f.encode(false));
        }
    }

    /* ---------------- receiving ---------------- */
    static String key(Packet p) {
        return Crypto.hex(p.sender) + "-" + p.timestamp + "-" + p.type + "-" + Crypto.hex(Arrays.copyOf(Crypto.sha256(p.payload), 8));
    }
    synchronized boolean markSeen(Packet p) {
        long now = System.currentTimeMillis(); String k = key(p);
        Long t = seen.get(k);
        if (t != null && now - t < SEEN_MS) return false;
        seen.put(k, now); return true;
    }

    public void onData(Link from, byte[] data) {
        Packet p = Packet.decode(data);
        if (p == null) return;
        handle(from, p);
    }

    void handle(Link from, Packet p) {
        if (Arrays.equals(p.sender, myId)) return;
        if (!markSeen(p)) return;
        long now = System.currentTimeMillis();
        if (p.type != Packet.FRAGMENT && Math.abs(now - p.timestamp) > MAX_AGE_MS) return;
        received++;
        boolean forMe = p.recipient != null && Arrays.equals(p.recipient, myId);
        boolean broadcast = p.recipient == null || Arrays.equals(p.recipient, BROADCAST);
        String sender = Crypto.hex(p.sender);
        switch (p.type) {
            case Packet.ANNOUNCE: onAnnounce(p, sender); break;
            case Packet.MESSAGE: if (broadcast) onMessage(p, sender); break;
            case Packet.LEAVE: synchronized (this) { peers.remove(sender); } notifyPeers(); break;
            case Packet.NOISE_HANDSHAKE: if (forMe) onHandshake(sender, p.payload); break;
            case Packet.NOISE_ENCRYPTED: if (forMe) onEncrypted(sender, p.payload); break;
            case Packet.FRAGMENT: onFragment(from, p); break;
            default: break; // sync, files, boards...: relayed but not shown
        }
        if (!forMe && p.type != Packet.REQUEST_SYNC) relay(from, p);
    }

    void relay(Link from, Packet p) {
        if (p.ttl <= 1) return;
        int cap = links.size() >= 6 && p.recipient == null ? 5 : TTL;
        p.ttl = Math.min(p.ttl - 1, cap);
        if (links.size() < 2 && from != null) return; // nobody else to tell
        boolean directed = p.recipient != null;
        long delay = directed ? 10 + Crypto.RNG.nextInt(30) : 10 + Crypto.RNG.nextInt(links.size() >= 6 ? 400 : 210);
        try { timer.schedule(() -> { relayed++; broadcast(p, from); }, delay, TimeUnit.MILLISECONDS); }
        catch (RuntimeException ignored) { /* shut down */ }
    }

    void onAnnounce(Packet p, String sender) {
        Packet.Announce a = Packet.Announce.decode(p.payload);
        if (a == null || a.noiseKey.length != 32 || a.signingKey.length != 32) return;
        // The peer id must be the first 8 bytes of the Noise key's SHA-256.
        if (!Crypto.hex(Arrays.copyOf(Crypto.sha256(a.noiseKey), 8)).equals(sender)) return;
        boolean ok = Crypto.ed25519Verify(a.signingKey, p.signingBytes(), p.signature);
        if (!ok) return;
        synchronized (this) {
            Peer peer = peers.get(sender);
            if (peer == null || System.currentTimeMillis() - peer.lastSeen > PEER_MS) sessions.remove(sender); // back after a gap: new session
            if (peer == null) peers.put(sender, peer = new Peer(sender));
            peer.nickname = a.nickname; peer.noiseKey = a.noiseKey; peer.signingKey = a.signingKey;
            peer.lastSeen = System.currentTimeMillis(); peer.verified = true;
        }
        notifyPeers();
    }

    void onMessage(Packet p, String sender) {
        Peer peer; synchronized (this) { peer = peers.get(sender); }
        boolean verified = peer != null && peer.signingKey != null && Crypto.ed25519Verify(peer.signingKey, p.signingBytes(), p.signature);
        if (peer == null) { peer = new Peer(sender); peer.nickname = "anon" + sender.substring(0, 4); }
        else if (!verified) return; // a known peer's name with a bad signature: drop it
        else peer.lastSeen = System.currentTimeMillis();
        Listener l = listener;
        if (l != null) l.onPublic(peer, new String(p.payload, StandardCharsets.UTF_8), p.timestamp, verified);
    }

    void onHandshake(String sender, byte[] msg) {
        byte[] reply = null; boolean established = false;
        synchronized (this) {
            Noise.Handshake h = handshakes.get(sender);
            try {
                if (msg.length == 32) {
                    // A first message. If both sides started, the lower peer id stays initiator.
                    if (h != null && h.initiator && myHex.compareTo(sender) < 0) return;
                    h = new Noise.Handshake(false, noisePriv, noisePub);
                    h.read(msg); reply = h.write(); handshakes.put(sender, h);
                } else if (h != null) {
                    h.read(msg);
                    if (h.initiator) reply = h.write();
                } else return;
                if (h.done()) { handshakes.remove(sender); sessions.put(sender, h); established = true; }
            } catch (RuntimeException e) { handshakes.remove(sender); return; }
        }
        if (reply != null) sendDirected(Packet.NOISE_HANDSHAKE, sender, reply);
        if (established) {
            List<byte[]> e; synchronized (this) { e = early.remove(sender); }
            if (e != null) for (byte[] ct : e) onEncrypted(sender, ct);
            flush(sender);
        }
    }

    void flush(String peer) {
        List<String[]> q; Noise.Handshake s;
        synchronized (this) { q = queued.remove(peer); s = sessions.get(peer); }
        if (q == null || s == null) return;
        for (String[] m : q) sendEncrypted(peer, s, Packet.privateMessage(m[0], m[1]));
    }

    void onEncrypted(String sender, byte[] ct) {
        Noise.Handshake s;
        synchronized (this) {
            s = sessions.get(sender);
            if (s == null) {
                if (handshakes.containsKey(sender)) {
                    List<byte[]> e = early.get(sender); if (e == null) early.put(sender, e = new ArrayList<>());
                    if (e.size() < 20) e.add(ct);
                }
                return;
            }
        }
        byte[] pt = s.recv.decrypt(ct);
        if (pt == null || pt.length == 0) return;
        Listener l = listener;
        int type = pt[0] & 255;
        if (type == 0x01) {
            String[] m = Packet.parsePrivateMessage(pt, 1);
            if (m == null) return;
            Peer peer; synchronized (this) { peer = peers.get(sender); }
            if (peer == null) { peer = new Peer(sender); peer.nickname = "anon" + sender.substring(0, 4); }
            if (l != null) l.onPrivate(peer, m[0], m[1], System.currentTimeMillis());
            byte[] ack = m[0].getBytes(StandardCharsets.UTF_8), d = new byte[ack.length + 1];
            d[0] = 0x03; System.arraycopy(ack, 0, d, 1, ack.length);
            sendEncrypted(sender, s, d);
        } else if (type == 0x03 && l != null) {
            l.onDelivered(new String(pt, 1, pt.length - 1, StandardCharsets.UTF_8));
        }
    }

    void onFragment(Link from, Packet p) {
        byte[] d = p.payload;
        if (d.length < 14) return;
        String id = Crypto.hex(Arrays.copyOf(d, 8));
        int idx = ((d[8] & 255) << 8) | (d[9] & 255), total = ((d[10] & 255) << 8) | (d[11] & 255);
        if (total == 0 || total > 2300 || idx >= total) return;
        byte[] whole = null;
        synchronized (this) {
            long now = System.currentTimeMillis();
            for (Iterator<Assembly> it = assemblies.values().iterator(); it.hasNext(); ) if (now - it.next().started > 30_000) it.remove();
            Assembly a = assemblies.get(id);
            if (a == null) {
                if (assemblies.size() >= 128) return;
                a = new Assembly(); a.parts = new byte[total][]; a.started = now; a.type = d[12] & 255; assemblies.put(id, a);
            }
            if (a.parts.length != total || a.parts[idx] != null) return;
            a.parts[idx] = Arrays.copyOfRange(d, 13, d.length); a.have++;
            if (a.have == total) {
                assemblies.remove(id); int n = 0; for (byte[] x : a.parts) n += x.length;
                if (n > (1 << 20)) return;
                whole = new byte[n]; int o = 0; for (byte[] x : a.parts) { System.arraycopy(x, 0, whole, o, x.length); o += x.length; }
            }
        }
        if (whole != null) {
            Packet inner = Packet.decode(whole);
            if (inner != null) handleInner(from, inner);
        }
    }
    /** A reassembled packet: process it but do not relay it again (its fragments were relayed). */
    void handleInner(Link from, Packet p) {
        p.ttl = 1;
        handle(from, p);
    }

    void notifyPeers() { Listener l = listener; if (l != null) l.onPeersChanged(); }
}
