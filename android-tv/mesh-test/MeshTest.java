import app.viktorych.tv.mesh.*;
import java.security.*;
import java.security.spec.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import java.util.*;
import java.util.concurrent.*;

/** Plain-JVM checks for the TV mesh code. Run: android-tv/mesh-test/run.sh */
public class MeshTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "ok   " : "FAIL ") + what); if (!ok) fails++; }

    public static void main(String[] a) throws Exception {
        // X25519 against the JDK.
        for (int i = 0; i < 5; i++) {
            KeyPairGenerator g = KeyPairGenerator.getInstance("X25519");
            KeyPair k1 = g.generateKeyPair(), k2 = g.generateKeyPair();
            KeyAgreement ka = KeyAgreement.getInstance("X25519"); ka.init(k1.getPrivate()); ka.doPhase(k2.getPublic(), true);
            byte[] jdk = ka.generateSecret();
            byte[] priv1 = Arrays.copyOfRange(k1.getPrivate().getEncoded(), 16, 48);
            byte[] pub2 = Arrays.copyOfRange(k2.getPublic().getEncoded(), 12, 44);
            check(Arrays.equals(jdk, Crypto.x25519(priv1, pub2)), "x25519 matches JDK #" + i);
            check(Arrays.equals(Arrays.copyOfRange(k1.getPublic().getEncoded(), 12, 44), Crypto.x25519Public(priv1)), "x25519 public matches JDK #" + i);
        }
        // Ed25519 against the JDK.
        for (int i = 0; i < 3; i++) {
            byte[] seed = Crypto.random(32), msg = Crypto.random(10 + i * 100);
            byte[] pkcs8 = new byte[48]; byte[] hdr = Crypto.unhex("302e020100300506032b657004220420");
            System.arraycopy(hdr, 0, pkcs8, 0, 16); System.arraycopy(seed, 0, pkcs8, 16, 32);
            PrivateKey pk = KeyFactory.getInstance("Ed25519").generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
            Signature s = Signature.getInstance("Ed25519"); s.initSign(pk); s.update(msg); byte[] jsig = s.sign();
            check(Arrays.equals(jsig, Crypto.ed25519Sign(seed, msg)), "ed25519 signature matches JDK #" + i);
            byte[] pub = Crypto.ed25519Public(seed);
            byte[] x509 = new byte[44]; System.arraycopy(Crypto.unhex("302a300506032b6570032100"), 0, x509, 0, 12); System.arraycopy(pub, 0, x509, 12, 32);
            Signature v = Signature.getInstance("Ed25519"); v.initVerify(KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(x509))); v.update(msg);
            check(v.verify(jsig) && Crypto.ed25519Verify(pub, msg, jsig), "ed25519 verify #" + i);
            jsig[5] ^= 1; check(!Crypto.ed25519Verify(pub, msg, jsig), "ed25519 rejects tampered #" + i);
        }
        // ChaCha20-Poly1305 against the JDK.
        for (int len : new int[] { 0, 1, 63, 64, 65, 300 }) {
            byte[] key = Crypto.random(32), nonce = Crypto.random(12), ad = Crypto.random(len % 20), pt = Crypto.random(len);
            Cipher c = Cipher.getInstance("ChaCha20-Poly1305"); c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "ChaCha20"), new IvParameterSpec(nonce)); c.updateAAD(ad);
            byte[] jdk = c.doFinal(pt);
            check(Arrays.equals(jdk, Crypto.aeadSeal(key, nonce, ad, pt)), "chachapoly matches JDK len " + len);
            check(Arrays.equals(pt, Crypto.aeadOpen(key, nonce, ad, jdk)), "chachapoly opens len " + len);
        }
        // Noise XX between two of ours.
        byte[] s1 = Crypto.random(32), s2 = Crypto.random(32);
        Noise.Handshake i = new Noise.Handshake(true, s1, Crypto.x25519Public(s1)), r = new Noise.Handshake(false, s2, Crypto.x25519Public(s2));
        r.read(i.write()); i.read(r.write()); r.read(i.write());
        check(i.done() && r.done() && Arrays.equals(i.handshakeHash, r.handshakeHash), "noise XX completes");
        byte[] m1 = i.send.encrypt("hi".getBytes()), m2 = i.send.encrypt("there".getBytes());
        check("there".equals(new String(r.recv.decrypt(m2))) && "hi".equals(new String(r.recv.decrypt(m1))), "noise out-of-order decrypt");
        check(r.recv.decrypt(m1) == null, "noise replay rejected");

        // Noise XX interop with an independent implementation (python noiseprotocol), via files.
        if (a.length > 0) interop(a[0]);

        // BIP-340 test vector 0 and a geohash channel event for the node cross-check.
        byte[] sec3 = new byte[32]; sec3[31] = 3;
        check(Crypto.hex(NostrSign.publicKey(sec3)).equals("f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"), "bip340 public key vector 0");
        byte[] sig0 = NostrSign.sign(sec3, new byte[32], new byte[32]);
        check(Crypto.hex(sig0).equals("e907831f80848d1069a5371b402410364bdf1c5f8307b0084c55f1cE2dca821525f66a4a85ea8b71e482a74f382d2ce5ebeee8fdb2172f477df4900d310536c0".toLowerCase()), "bip340 signature vector 0");
        check(NostrSign.verify(NostrSign.publicKey(sec3), new byte[32], sig0), "bip340 verify vector 0");
        check(NostrSign.geohash(52.2297, 21.0122, 5).equals("u3qcn"), "geohash of a city centre");
        if (a.length > 0) {
            List<String[]> tags = new ArrayList<>(); tags.add(new String[] { "g", "u3qcn" }); tags.add(new String[] { "n", "tv \"q\"\n" });
            java.nio.file.Files.write(java.nio.file.Paths.get(a[0], "event.json"), NostrSign.event(Crypto.random(32), 20000, tags, "hi \u00e9 \ud83d\ude00 / \"x\"", 8).getBytes("UTF-8"));
        }

        // Packets: encode/decode, signing bytes ignore TTL, compression round trip.
        Packet p = new Packet(Packet.MESSAGE, Crypto.random(8), null, "hello mesh".getBytes());
        Packet q = Packet.decode(p.encode(false));
        check(q != null && "hello mesh".equals(new String(q.payload)) && q.timestamp == p.timestamp, "packet round trip");
        byte[] sb = p.signingBytes(); p.ttl = 3; check(Arrays.equals(sb, p.signingBytes()) && sb.length == 256, "signing bytes padded, ttl-free");
        StringBuilder big = new StringBuilder(); for (int k = 0; k < 40; k++) big.append("aaaa bbbb ");
        Packet z = new Packet(Packet.MESSAGE, Crypto.random(8), null, big.toString().getBytes());
        byte[] zb = z.encode(false); Packet zq = Packet.decode(zb);
        check(zb.length < 200 && zq != null && big.toString().equals(new String(zq.payload)), "compressed payload round trip");
        check(Arrays.equals(zq.signingBytes(), z.signingBytes()), "compressed signing bytes stable");
        Packet hs = new Packet(Packet.NOISE_HANDSHAKE, Crypto.random(8), Crypto.random(8), Crypto.random(32));
        byte[] hb = hs.encode(true); check(hb.length == 256 && Packet.decode(hb) != null && Packet.decode(hb).payload.length == 32, "padded noise packet decodes");

        // Three nodes in a line A - B - C: C hears A only through B's relay.
        MeshCore A = new MeshCore(Crypto.random(32), Crypto.random(32), "tv-a");
        MeshCore B = new MeshCore(Crypto.random(32), Crypto.random(32), "tv-b");
        MeshCore C = new MeshCore(Crypto.random(32), Crypto.random(32), "tv-c");
        wire(A, B, 512); wire(B, C, 100); // small MTU on B-C forces fragments
        BlockingQueue<String> got = new LinkedBlockingQueue<>();
        C.setListener(listen("C", got)); A.setListener(listen("A", got)); B.setListener(listen("B", got));
        A.announce(); C.announce(); Thread.sleep(800);
        check(C.peers().stream().anyMatch(x -> x.nickname.equals("tv-a") && x.verified), "C verified A's announce over relay");
        A.sendPublic("hello from A, a public message long enough to need a fragment on the small link");
        String pub = poll(got, "C:pub"); check(pub != null && pub.contains("hello from A") && pub.contains("verified=true"), "public message relayed and verified: " + pub);
        poll(got, "B:pub");
        A.sendPrivate(C.myHex, "secret for C");
        String pm = poll(got, "C:pm"); check(pm != null && pm.contains("secret for C"), "private message over relayed Noise: " + pm);
        String ack = poll(got, "A:delivered"); check(ack != null, "delivery ack back to A");
        check(B.relayed > 0, "B relayed " + B.relayed + " packets");
        A.shutdown(); B.shutdown(); C.shutdown();
        System.out.println(fails == 0 ? "ALL OK" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }

    static String poll(BlockingQueue<String> q, String prefix) throws Exception {
        long end = System.currentTimeMillis() + 5000; List<String> back = new ArrayList<>();
        try {
            while (System.currentTimeMillis() < end) {
                String s = q.poll(200, TimeUnit.MILLISECONDS);
                if (s == null) continue;
                if (s.startsWith(prefix)) return s;
                back.add(s);
            }
            return null;
        } finally { q.addAll(back); }
    }
    static MeshCore.Listener listen(String who, BlockingQueue<String> out) {
        return new MeshCore.Listener() {
            public void onPublic(MeshCore.Peer f, String t, long ts, boolean v) { out.add(who + ":pub " + f.nickname + " verified=" + v + " " + t); }
            public void onPrivate(MeshCore.Peer f, String id, String t, long ts) { out.add(who + ":pm " + f.nickname + " " + t); }
            public void onDelivered(String id) { out.add(who + ":delivered " + id); }
            public void onPeersChanged() {}
        };
    }
    static void wire(MeshCore x, MeshCore y, int mtu) {
        ExecutorService ex = Executors.newSingleThreadExecutor(), ey = Executors.newSingleThreadExecutor();
        MeshCore.Link[] lx = new MeshCore.Link[1], ly = new MeshCore.Link[1];
        lx[0] = new MeshCore.Link() { public void send(byte[] d) { if (d.length > mtu) throw new RuntimeException("too big " + d.length); byte[] c = d.clone(); ey.execute(() -> y.onData(ly[0], c)); } public int maxWrite() { return mtu; } };
        ly[0] = new MeshCore.Link() { public void send(byte[] d) { if (d.length > mtu) throw new RuntimeException("too big " + d.length); byte[] c = d.clone(); ex.execute(() -> x.onData(lx[0], c)); } public int maxWrite() { return mtu; } };
        x.addLink(lx[0]); y.addLink(ly[0]);
    }

    /** Files: dir/py_static (our view of the python responder's static pub) etc.
     *  Simple turn-taking: we write m1, python writes m2, we write m3, python writes a transport message. */
    static void interop(String dir) throws Exception {
        java.nio.file.Path d = java.nio.file.Paths.get(dir);
        byte[] s = Crypto.random(32);
        Noise.Handshake i = new Noise.Handshake(true, s, Crypto.x25519Public(s));
        java.nio.file.Files.write(d.resolve("m1"), i.write());
        byte[] m2 = waitFile(d.resolve("m2"));
        i.read(m2);
        java.nio.file.Files.write(d.resolve("m3.tmp"), i.write());
        java.nio.file.Files.move(d.resolve("m3.tmp"), d.resolve("m3"));
        byte[] t = waitFile(d.resolve("t1")); // python's raw transport ciphertext (counter 0)
        byte[] withNonce = new byte[t.length + 4]; System.arraycopy(t, 0, withNonce, 4, t.length);
        byte[] pt = i.recv.decrypt(withNonce);
        check(pt != null && "from python".equals(new String(pt)), "noise XX interop with python noiseprotocol");
        java.nio.file.Files.write(d.resolve("t2"), Arrays.copyOfRange(i.send.encrypt("from java".getBytes()), 4, 4 + 9 + 16));
    }
    static byte[] waitFile(java.nio.file.Path p) throws Exception {
        for (int k = 0; k < 100; k++) { if (java.nio.file.Files.exists(p)) { Thread.sleep(50); return java.nio.file.Files.readAllBytes(p); } Thread.sleep(100); }
        throw new RuntimeException("timeout " + p);
    }
}
