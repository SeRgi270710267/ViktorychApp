package app.viktorych.tv.mesh;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import org.json.JSONArray;
import org.json.JSONObject;

/** Bitchat location channels over public Nostr relays: kind 20000 events
 *  tagged ["g", geohash] and ["n", nickname]. A tiny WebSocket client so the
 *  TV app needs no extra library. Only runs while the chat screen is open
 *  and an area is set. */
public final class NostrRelay {
    public interface Listener { void onArea(String pubkey, String nick, String text, long ts, boolean mine); void onRelays(int up, int total); }
    public static final String[] DEFAULT_RELAYS = { "wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://offchain.pub" };

    final byte[] sec; final String pubHex; final String geohash; final Listener listener;
    final List<Conn> conns = new ArrayList<>();
    final Set<String> seen = Collections.synchronizedSet(new LinkedHashSet<String>());
    volatile boolean stopped;

    public NostrRelay(byte[] sec, String geohash, List<String> relays, Listener l) {
        this.sec = sec; this.pubHex = Crypto.hex(NostrSign.publicKey(sec)); this.geohash = geohash; this.listener = l;
        for (String r : relays) if (r.startsWith("wss://") && conns.size() < 6) conns.add(new Conn(r));
    }
    public void start() { for (Conn c : conns) c.start(); }
    public void stop() { stopped = true; for (Conn c : conns) c.close(); }
    public int up() { int n = 0; for (Conn c : conns) if (c.open) n++; return n; }
    void changed() { Listener l = listener; if (l != null) l.onRelays(up(), conns.size()); }

    /** Signs (with 8-bit proof of work, as Bitchat asks) and sends to every open relay. */
    public void send(String nick, String text) {
        List<String[]> tags = new ArrayList<>();
        tags.add(new String[] { "g", geohash });
        if (nick != null && !nick.isEmpty()) tags.add(new String[] { "n", nick });
        String ev = NostrSign.event(sec, 20000, tags, text, 8);
        String msg = "[\"EVENT\"," + ev + "]";
        for (Conn c : conns) c.sendText(msg);
    }

    void onMessage(String raw) {
        try {
            JSONArray a = new JSONArray(raw);
            if (!"EVENT".equals(a.optString(0))) return;
            JSONObject e = a.getJSONObject(2);
            String id = e.getString("id");
            if (!seen.add(id)) return;
            if (seen.size() > 2000) { synchronized (seen) { java.util.Iterator<String> it = seen.iterator(); for (int i = 0; i < 500 && it.hasNext(); i++) { it.next(); it.remove(); } } }
            if (e.getInt("kind") != 20000) return;
            JSONArray tags = e.getJSONArray("tags"); List<String[]> tl = new ArrayList<>(); String g = null, nick = "";
            for (int i = 0; i < tags.length(); i++) {
                JSONArray t = tags.getJSONArray(i); String[] s = new String[t.length()];
                for (int j = 0; j < s.length; j++) s[j] = t.getString(j);
                tl.add(s);
                if (s.length > 1 && "g".equals(s[0])) g = s[1];
                if (s.length > 1 && "n".equals(s[0])) nick = s[1];
            }
            if (!geohash.equals(g)) return;
            String pub = e.getString("pubkey"), content = e.getString("content");
            long ts = e.getLong("created_at");
            byte[] want = NostrSign.eventId(pub, ts, 20000, tl, content);
            if (!Crypto.hex(want).equals(id)) return;
            if (!NostrSign.verify(Crypto.unhex(pub), want, Crypto.unhex(e.getString("sig")))) return;
            Listener l = listener;
            if (l != null) l.onArea(pub, nick, content, ts * 1000, pub.equals(pubHex));
        } catch (Exception ignored) { /* not an event we can show */ }
    }

    final class Conn implements Runnable {
        final String url; volatile boolean open; volatile Socket sock; volatile OutputStream out; Thread thread;
        Conn(String url) { this.url = url; }
        void start() { thread = new Thread(this, "nostr"); thread.setDaemon(true); thread.start(); }
        void close() { try { Socket s = sock; if (s != null) s.close(); } catch (IOException ignored) { /* closing */ } }

        @Override public void run() {
            long backoff = 3000;
            while (!stopped) {
                try {
                    connect();
                    backoff = 3000;
                    long since = System.currentTimeMillis() / 1000 - 3600;
                    sendText("[\"REQ\",\"vk-geo\",{\"kinds\":[20000],\"#g\":[\"" + geohash + "\"],\"since\":" + since + ",\"limit\":100}]");
                    readLoop();
                } catch (Exception ignored) { /* reconnect below */ }
                open = false; changed(); close();
                if (stopped) break;
                try { Thread.sleep(backoff); } catch (InterruptedException e) { break; }
                backoff = Math.min(backoff * 2, 120_000);
            }
        }

        void connect() throws IOException {
            URI u = URI.create(url); String host = u.getHost(); int port = u.getPort() > 0 ? u.getPort() : 443;
            Socket raw = new Socket(); raw.connect(new InetSocketAddress(host, port), 10_000);
            SSLSocket s = (SSLSocket) ((SSLSocketFactory) SSLSocketFactory.getDefault()).createSocket(raw, host, port, true);
            javax.net.ssl.SSLParameters sp = s.getSSLParameters();
            sp.setEndpointIdentificationAlgorithm("HTTPS"); // certificate must match the relay's name
            s.setSSLParameters(sp);
            s.startHandshake();
            // Android before 7 ignores the line above, so check the name by hand there.
            if (android.os.Build.VERSION.SDK_INT < 24 && !HttpsURLConnection.getDefaultHostnameVerifier().verify(host, s.getSession())) { s.close(); throw new IOException("host"); }
            s.setSoTimeout(90_000);
            sock = s;
            String key = android.util.Base64.encodeToString(Crypto.random(16), android.util.Base64.NO_WRAP);
            String path = u.getRawPath() == null || u.getRawPath().isEmpty() ? "/" : u.getRawPath();
            String req = "GET " + path + " HTTP/1.1\r\nHost: " + host + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                + "Sec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n\r\n";
            OutputStream o = s.getOutputStream(); o.write(req.getBytes(StandardCharsets.US_ASCII)); o.flush();
            InputStream in = s.getInputStream(); StringBuilder head = new StringBuilder();
            while (!head.toString().endsWith("\r\n\r\n")) { int c = in.read(); if (c < 0 || head.length() > 8192) throw new IOException("eof"); head.append((char) c); }
            if (!head.toString().startsWith("HTTP/1.1 101")) throw new IOException("no upgrade");
            out = o; open = true; changed();
        }

        void readLoop() throws IOException {
            InputStream in = sock.getInputStream(); ByteArrayOutputStream msg = new ByteArrayOutputStream();
            while (!stopped) {
                int b0;
                try { b0 = in.read(); }
                catch (java.net.SocketTimeoutException idle) { frame(9, new byte[0]); continue; } // keep the link alive
                int b1 = in.read(); if (b0 < 0 || b1 < 0) throw new IOException("eof");
                int op = b0 & 15; long len = b1 & 127;
                if (len == 126) len = (in.read() << 8) | in.read();
                else if (len == 127) { len = 0; for (int i = 0; i < 8; i++) len = (len << 8) | in.read(); }
                if (len > 1 << 20) throw new IOException("too big");
                byte[] mask = (b1 & 128) != 0 ? readN(in, 4) : null;
                byte[] data = readN(in, (int) len);
                if (mask != null) for (int i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
                if (op == 8) throw new IOException("closed");
                if (op == 9) { frame(10, data); continue; }
                if (op == 10) continue;
                msg.write(data, 0, data.length);
                if ((b0 & 128) != 0) { onMessage(new String(msg.toByteArray(), StandardCharsets.UTF_8)); msg.reset(); }
            }
        }
        byte[] readN(InputStream in, int n) throws IOException {
            byte[] b = new byte[n]; int o = 0;
            while (o < n) { int r = in.read(b, o, n - o); if (r < 0) throw new IOException("eof"); o += r; }
            return b;
        }
        void sendText(final String s) {
            if (!open) return;
            new Thread(() -> { try { frame(1, s.getBytes(StandardCharsets.UTF_8)); } catch (IOException e) { close(); } }, "nostr-send").start();
        }
        synchronized void frame(int op, byte[] data) throws IOException {
            OutputStream o = out; if (o == null) throw new IOException("closed");
            ByteArrayOutputStream f = new ByteArrayOutputStream(); f.write(128 | op);
            if (data.length < 126) f.write(128 | data.length);
            else if (data.length < 65536) { f.write(128 | 126); f.write(data.length >> 8); f.write(data.length); }
            else { f.write(128 | 127); for (int i = 7; i >= 0; i--) f.write((int) ((long) data.length >> (8 * i))); }
            byte[] m = Crypto.random(4); f.write(m);
            for (int i = 0; i < data.length; i++) f.write(data[i] ^ m[i & 3]);
            o.write(f.toByteArray()); o.flush();
        }
    }
}
