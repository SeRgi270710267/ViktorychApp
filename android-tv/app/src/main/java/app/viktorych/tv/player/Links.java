package app.viktorych.tv.player;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Works out what a shared or opened link is: a YouTube video, an X post,
 *  a Twitch channel or video, or a plain media file. Pure Java so it can be
 *  unit tested without a TV. */
public final class Links {
    private Links() {}

    public enum Kind { YOUTUBE, X_POST, TWITCH_CHANNEL, TWITCH_VIDEO, MEDIA, NONE }

    public static final class Target {
        public final Kind kind;
        public final String id;      // video id, post id, channel name, or the media URL
        public final int startSec;   // where to start (YouTube t=, Twitch t=)
        public final boolean music;  // music.youtube.com or an audio file
        Target(Kind kind, String id, int startSec, boolean music) {
            this.kind = kind; this.id = id; this.startSec = startSec; this.music = music;
        }
        @Override public String toString() { return kind + ":" + id + (startSec > 0 ? "@" + startSec : "") + (music ? " music" : ""); }
    }

    private static final Pattern YT_ID = Pattern.compile("^[A-Za-z0-9_-]{11}$");
    private static final Pattern X_STATUS = Pattern.compile("^/(?:i/web/|[A-Za-z0-9_]{1,15}/)?status(?:es)?/(\\d{5,25})");
    private static final Pattern TWITCH_VOD = Pattern.compile("^/videos/(\\d+)");
    private static final Pattern TWITCH_CHAN = Pattern.compile("^/([A-Za-z0-9_]{3,25})/?$");
    private static final Pattern MEDIA_EXT = Pattern.compile("\\.(mp4|m4v|webm|mkv|mov|m3u8|mpd|ts|mp3|m4a|aac|ogg|oga|opus|flac|wav)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern AUDIO_EXT = Pattern.compile("\\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)$", Pattern.CASE_INSENSITIVE);

    /** @param mime the intent's type, or null. */
    public static Target parse(String url, String mime) {
        if (url == null) return none();
        String u = url.trim();
        String m = mime == null ? "" : mime.toLowerCase(Locale.ROOT);
        String scheme = scheme(u);
        if (scheme.equals("content") || scheme.equals("file")) {
            return m.startsWith("video/") || m.startsWith("audio/") || MEDIA_EXT.matcher(path(u)).find()
                ? new Target(Kind.MEDIA, u, 0, m.startsWith("audio/") || AUDIO_EXT.matcher(path(u)).find()) : none();
        }
        if (!scheme.equals("http") && !scheme.equals("https")) return none();
        String host = host(u);
        String path = path(u);
        String query = query(u);
        if (host.equals("youtu.be")) {
            String id = firstSegment(path);
            return YT_ID.matcher(id).matches() ? new Target(Kind.YOUTUBE, id, time(param(query, "t")), false) : none();
        }
        if (host.equals("youtube.com") || host.endsWith(".youtube.com") || host.equals("youtube-nocookie.com") || host.endsWith(".youtube-nocookie.com")) {
            boolean music = host.startsWith("music.");
            String id = param(query, "v");
            if (id == null) {
                String[] seg = path.split("/");
                if (seg.length >= 3 && (seg[1].equals("shorts") || seg[1].equals("embed") || seg[1].equals("live") || seg[1].equals("v"))) id = seg[2];
            }
            if (id == null || !YT_ID.matcher(id).matches()) return none();
            String t = param(query, "t");
            if (t == null) t = param(query, "start");
            return new Target(Kind.YOUTUBE, id, time(t), music);
        }
        if (host.equals("x.com") || host.endsWith(".x.com") || host.equals("twitter.com") || host.endsWith(".twitter.com")
                || host.equals("fxtwitter.com") || host.equals("vxtwitter.com") || host.equals("fixupx.com")) {
            Matcher mm = X_STATUS.matcher(path);
            return mm.find() ? new Target(Kind.X_POST, mm.group(1), 0, false) : none();
        }
        if (host.equals("twitch.tv") || host.endsWith(".twitch.tv")) {
            Matcher v = TWITCH_VOD.matcher(path);
            if (v.find()) return new Target(Kind.TWITCH_VIDEO, v.group(1), time(param(query, "t")), false);
            if (host.equals("player.twitch.tv")) {
                String vid = param(query, "video");
                if (vid != null) return new Target(Kind.TWITCH_VIDEO, vid.replaceFirst("^v", ""), time(param(query, "time")), false);
                String ch = param(query, "channel");
                return ch != null ? new Target(Kind.TWITCH_CHANNEL, ch.toLowerCase(Locale.ROOT), 0, false) : none();
            }
            Matcher c = TWITCH_CHAN.matcher(path);
            if (c.find()) {
                String ch = c.group(1).toLowerCase(Locale.ROOT);
                if (!ch.equals("directory") && !ch.equals("videos") && !ch.equals("settings") && !ch.equals("downloads")) return new Target(Kind.TWITCH_CHANNEL, ch, 0, false);
            }
            return none();
        }
        if (m.startsWith("video/") || m.startsWith("audio/") || m.contains("mpegurl") || MEDIA_EXT.matcher(path).find()) {
            return new Target(Kind.MEDIA, u, 0, m.startsWith("audio/") || AUDIO_EXT.matcher(path).find());
        }
        return none();
    }

    private static Target none() { return new Target(Kind.NONE, "", 0, false); }

    /** "90", "90s", "1m30s", "1h2m3s" or "01:30" in seconds. */
    public static int time(String t) {
        if (t == null || t.isEmpty()) return 0;
        try {
            if (t.matches("\\d+")) return Integer.parseInt(t);
            if (t.matches("\\d+(:\\d{1,2}){1,2}")) {
                int s = 0;
                for (String p : t.split(":")) s = s * 60 + Integer.parseInt(p);
                return s;
            }
            Matcher m = Pattern.compile("^(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?$").matcher(t.toLowerCase(Locale.ROOT));
            if (m.find()) {
                int h = m.group(1) == null ? 0 : Integer.parseInt(m.group(1));
                int mi = m.group(2) == null ? 0 : Integer.parseInt(m.group(2));
                int s = m.group(3) == null ? 0 : Integer.parseInt(m.group(3));
                return h * 3600 + mi * 60 + s;
            }
        } catch (NumberFormatException ignored) { /* too big */ }
        return 0;
    }

    /** 75 -> "1:15", 3725 -> "1:02:05". */
    public static String clock(long ms) {
        long s = Math.max(0, ms / 1000);
        long h = s / 3600, m = (s % 3600) / 60, sec = s % 60;
        return h > 0 ? String.format(Locale.ROOT, "%d:%02d:%02d", h, m, sec) : String.format(Locale.ROOT, "%d:%02d", m, sec);
    }

    static String scheme(String u) {
        int i = u.indexOf(':');
        return i > 0 ? u.substring(0, i).toLowerCase(Locale.ROOT) : "";
    }

    static String host(String u) {
        int s = u.indexOf("://");
        if (s < 0) return "";
        String rest = u.substring(s + 3);
        int e = firstOf(rest, "/?#");
        String h = (e < 0 ? rest : rest.substring(0, e)).toLowerCase(Locale.ROOT);
        int at = h.lastIndexOf('@');
        if (at >= 0) h = h.substring(at + 1);
        int colon = h.indexOf(':');
        if (colon >= 0) h = h.substring(0, colon);
        return h.startsWith("www.") ? h.substring(4) : h.startsWith("m.") ? h.substring(2) : h;
    }

    static String path(String u) {
        int s = u.indexOf("://");
        String rest = s < 0 ? u.substring(u.indexOf(':') + 1) : u.substring(s + 3);
        int p = s < 0 ? 0 : rest.indexOf('/');
        if (p < 0) return "/";
        String path = rest.substring(p);
        int e = firstOf(path, "?#");
        return e < 0 ? path : path.substring(0, e);
    }

    static String query(String u) {
        int q = u.indexOf('?');
        if (q < 0) return "";
        int h = u.indexOf('#', q);
        return h < 0 ? u.substring(q + 1) : u.substring(q + 1, h);
    }

    static String param(String query, String name) {
        for (String kv : query.split("&")) {
            int eq = kv.indexOf('=');
            String k = eq < 0 ? kv : kv.substring(0, eq);
            if (k.equals(name)) return eq < 0 ? "" : decode(kv.substring(eq + 1));
        }
        return null;
    }

    private static String decode(String s) {
        try { return java.net.URLDecoder.decode(s, "UTF-8"); } catch (Exception e) { return s; }
    }

    private static String firstSegment(String path) {
        String p = path.startsWith("/") ? path.substring(1) : path;
        int e = p.indexOf('/');
        return e < 0 ? p : p.substring(0, e);
    }

    private static int firstOf(String s, String chars) {
        int best = -1;
        for (char c : chars.toCharArray()) {
            int i = s.indexOf(c);
            if (i >= 0 && (best < 0 || i < best)) best = i;
        }
        return best;
    }
}
