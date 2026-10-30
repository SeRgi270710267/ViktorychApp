package app.viktorych.tv.alerts;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** What the alerts panel shows, worked out from the site's own /v1/notifications
 *  answer. Pure Java (no Android) so it is unit tested. */
public final class AlertModel {
    public enum Tab { ALL, MESSAGES, MENTIONS, LIVE }

    /** Which sentence a row reads, e.g. LIKE: "{name} liked your post". */
    public enum Line { LIKE, LIKE_MANY, REPOST, REPOST_MANY, QUOTE, REPLY, MENTION, DM, DISCORD, FOLLOW, FOLLOW_REQUEST,
        FOLLOW_ACCEPT, FRIEND_REQUEST, FRIEND_ACCEPT, LIVE, BIRTHDAY, POST, OTHER }

    public static final class Note {
        public final String id, kind, name, handle, text, avatar, hash;
        public final long at;
        public final boolean read;
        public final int others;
        public Note(String id, String kind, String name, String handle, String text, String avatar, String hash, long at, boolean read, int others) {
            this.id = id; this.kind = kind; this.name = name; this.handle = handle; this.text = text;
            this.avatar = avatar; this.hash = hash; this.at = at; this.read = read; this.others = others;
        }
        /** The name to show: display name, else @handle, else nothing. */
        public String who() { return !name.isEmpty() ? name : handle.isEmpty() ? "" : "@" + handle; }
    }

    public static final class View {
        public final List<Note> notes;
        public final int unread;
        public View(List<Note> notes, int unread) { this.notes = notes; this.unread = unread; }
    }

    private AlertModel() {}

    public static View parse(String body) {
        Map<String, Object> root = Json.obj(Json.parse(body));
        List<Note> out = new ArrayList<>();
        for (Object o : Json.arr(root.get("items"))) {
            Map<String, Object> m = Json.obj(o);
            String id = Json.str(m, "id");
            if (id.isEmpty()) continue;
            String avatar = Json.str(m, "avatar");
            if (!avatar.startsWith("https://")) avatar = "";
            out.add(new Note(id, Json.str(m, "kind"), clip(Json.str(m, "name"), 80), clip(Json.str(m, "handle"), 80),
                clip(Json.str(m, "text"), 280), avatar, Json.str(m, "hash"), Json.num(m, "at"),
                Json.bool(m, "read"), (int) Math.max(0, Json.num(m, "others"))));
        }
        return new View(out, (int) Math.max(0, Json.num(root, "unread")));
    }

    public static Tab tab(String kind) {
        switch (kind) {
            case "dm": case "discord": return Tab.MESSAGES;
            case "mention": case "reply": case "quote": return Tab.MENTIONS;
            case "live": return Tab.LIVE;
            default: return Tab.ALL;
        }
    }

    public static List<Note> filter(List<Note> all, Tab t) {
        if (t == Tab.ALL) return all;
        List<Note> out = new ArrayList<>();
        for (Note n : all) if (tab(n.kind) == t) out.add(n);
        return out;
    }

    public static int unreadIn(List<Note> all, Tab t) {
        int n = 0;
        for (Note x : filter(all, t)) if (!x.read) n++;
        return n;
    }

    public static Line line(String kind, int others) {
        switch (kind) {
            case "like": return others > 0 ? Line.LIKE_MANY : Line.LIKE;
            case "repost": return others > 0 ? Line.REPOST_MANY : Line.REPOST;
            case "quote": return Line.QUOTE;
            case "reply": return Line.REPLY;
            case "mention": return Line.MENTION;
            case "dm": return Line.DM;
            case "discord": return Line.DISCORD;
            case "follow": return Line.FOLLOW;
            case "follow_request": return Line.FOLLOW_REQUEST;
            case "follow_accept": return Line.FOLLOW_ACCEPT;
            case "friend_request": return Line.FRIEND_REQUEST;
            case "friend_accept": return Line.FRIEND_ACCEPT;
            case "live": return Line.LIVE;
            case "birthday": return Line.BIRTHDAY;
            case "post": return Line.POST;
            default: return Line.OTHER;
        }
    }

    /** {count, unit} where unit is 0 now, 1 minutes, 2 hours, 3 days, 4 weeks. */
    public static long[] ago(long now, long at) {
        long s = Math.max(0, (now - at) / 1000);
        if (s < 60) return new long[] {0, 0};
        if (s < 3600) return new long[] {s / 60, 1};
        if (s < 86400) return new long[] {s / 3600, 2};
        if (s < 7 * 86400) return new long[] {s / 86400, 3};
        return new long[] {s / (7 * 86400), 4};
    }

    /** The app's start address with the alert's own page (#/...) instead of home. */
    public static String siteUrl(String startUrl, String hash) {
        int cut = startUrl.indexOf('#');
        String base = cut < 0 ? startUrl : startUrl.substring(0, cut);
        String h = hash == null || !hash.startsWith("#/") || hash.length() > 300 ? "#/notifications" : hash;
        return base + h;
    }

    private static final Pattern API = Pattern.compile("\\bapi\\s*:\\s*\"(https://[A-Za-z0-9.-]+(?::\\d+)?)/?\"");

    /** The account server address from the published accounts.config.js. */
    public static String apiFromConfig(String js) {
        if (js == null) return "";
        Matcher m = API.matcher(js);
        while (m.find()) if (!m.group(1).isEmpty()) return m.group(1);
        return "";
    }

    /** "ABC2DE" shown as "ABC 2DE" so it is easy to read across a room. */
    public static String showCode(String code) {
        String c = cleanCode(code);
        return c.length() == 6 ? c.substring(0, 3) + " " + c.substring(3) : c;
    }

    /** The site's code alphabet (no 0/O, 1/I/L); anything else means no code. */
    public static String cleanCode(String code) {
        String c = code == null ? "" : code.replaceAll("[\\s-]", "").toUpperCase(java.util.Locale.ROOT);
        if (c.length() != 6) return "";
        for (int k = 0; k < c.length(); k++) if ("ABCDEFGHJKMNPQRSTUVWXYZ23456789".indexOf(c.charAt(k)) < 0) return "";
        return c;
    }

    /** What to type on the phone: the site with the code in it. The site's own
     *  short-link script turns ?pair=CODE into its Link a TV page. */
    public static String pairAddress(String code) {
        String c = cleanCode(code);
        return c.isEmpty() ? "viktorychapp.pages.dev/#/link-tv" : "viktorychapp.pages.dev/?pair=" + c;
    }

    static String clip(String v, int max) { return v.length() <= max ? v : v.substring(0, max); }
}
