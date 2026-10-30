package app.viktorych.tv.alerts;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;

/** This TV's own sign-in for the alerts panel, made with the site's "Link a TV" code.
 *  The session stays in this app's private storage; nothing runs in the background.
 *  All calls block, so callers run them off the main thread. */
final class Session {
    static final String PREFS = "viktorych_tv_alerts";
    private static final String CONFIG = "https://viktorychapp.pages.dev/accounts.config.js";
    private static final Charset UTF8 = Charset.forName("UTF-8");

    static final class Reply {
        final int status;
        final String body;
        Reply(int status, String body) { this.status = status; this.body = body; }
    }

    private Session() {}

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static boolean linked(Context c) { return !prefs(c).getString("token", "").isEmpty(); }

    static String accountName(Context c) { return prefs(c).getString("name", ""); }

    /** The account server, read from the site's published config (kept for a day). */
    static String api(Context c) throws IOException {
        SharedPreferences p = prefs(c);
        String api = p.getString("api", "");
        if (!api.isEmpty() && System.currentTimeMillis() - p.getLong("apiAt", 0) < 24L * 3600 * 1000) return api;
        Reply r = http("GET", CONFIG, null, null);
        String found = r.status == 200 ? AlertModel.apiFromConfig(r.body) : "";
        if (found.isEmpty()) {
            if (!api.isEmpty()) return api;
            throw new IOException("no server");
        }
        p.edit().putString("api", found).putLong("apiAt", System.currentTimeMillis()).apply();
        return found;
    }

    static Reply start(Context c) throws IOException {
        return http("POST", api(c) + "/v1/tv-pair/start", "{}", null);
    }

    static Reply poll(Context c, String secret) throws IOException {
        return http("POST", api(c) + "/v1/tv-pair/poll", "{\"poll\":" + Json.quote(secret) + "}", null);
    }

    /** Keeps the session from a successful poll. */
    static void save(Context c, String token, String name) {
        prefs(c).edit().putString("token", token).putString("name", name).apply();
    }

    static Reply notes(Context c) throws IOException {
        return authed(c, "GET", "/v1/notifications", null);
    }

    static Reply markAllRead(Context c) throws IOException {
        return authed(c, "POST", "/v1/notifications/read", "{\"all\":true}");
    }

    /** Forgets the session now and signs it out on the server in the background
     *  (one short request, best effort). */
    static void unlink(Context c) {
        SharedPreferences p = prefs(c);
        String token = p.getString("token", "");
        p.edit().remove("token").remove("name").apply();
        if (token.isEmpty()) return;
        Context app = c.getApplicationContext();
        new Thread(() -> {
            try { http("POST", api(app) + "/v1/logout", "{}", token); } catch (IOException | RuntimeException ignored) { }
        }, "alerts-unlink").start();
    }

    private static Reply authed(Context c, String method, String path, String body) throws IOException {
        String token = prefs(c).getString("token", "");
        if (token.isEmpty()) return new Reply(401, "");
        Reply r = http(method, api(c) + path, body, token);
        // The account signed this TV out (or the session ran out): back to linking.
        if (r.status == 401) prefs(c).edit().remove("token").remove("name").apply();
        return r;
    }

    static Reply http(String method, String url, String body, String token) throws IOException {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        try {
            h.setRequestMethod(method);
            h.setConnectTimeout(10000);
            h.setReadTimeout(15000);
            h.setUseCaches(false);
            h.setRequestProperty("Accept", "application/json");
            if (token != null) h.setRequestProperty("Authorization", "Bearer " + token);
            if (body != null) {
                h.setDoOutput(true);
                h.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                try (OutputStream o = h.getOutputStream()) { o.write(body.getBytes(UTF8)); }
            }
            int status = h.getResponseCode();
            InputStream in = status >= 400 ? h.getErrorStream() : h.getInputStream();
            return new Reply(status, in == null ? "" : read(in));
        } finally {
            h.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream i = in) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n, total = 0;
            while ((n = i.read(buf)) > 0) {
                total += n;
                if (total > 4 * 1024 * 1024) throw new IOException("too large");
                b.write(buf, 0, n);
            }
            return new String(b.toByteArray(), UTF8);
        }
    }
}
