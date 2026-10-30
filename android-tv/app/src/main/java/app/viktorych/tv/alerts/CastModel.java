package app.viktorych.tv.alerts;

import java.util.Locale;
import java.util.Map;

import app.viktorych.tv.player.Links;

/** What the Cast screen does with a link sent from the phone. Pure Java so it can
 *  be unit tested without a TV. */
public final class CastModel {
    private CastModel() {}

    /** SITE opens in the app, PLAY in the player (or the TV's own app for it),
     *  NONE is refused: this screen never opens arbitrary web pages. */
    public enum Kind { SITE, PLAY, NONE }

    public static final class Item {
        public final String url, title;
        public final long at;
        Item(String url, String title, long at) { this.url = url; this.title = title; this.at = at; }
    }

    /** Waiting for a cast: at least 3 s between checks, at most 15 s. */
    public static long intervalMs(String body) {
        try {
            long s = Json.num(Json.obj(Json.parse(body)), "interval");
            return Math.max(3, Math.min(15, s == 0 ? 4 : s)) * 1000L;
        } catch (RuntimeException e) {
            return 4000;
        }
    }

    /** The item in a /v1/tv-cast/next answer, or null. */
    public static Item item(String body) {
        try {
            Map<String, Object> it = Json.obj(Json.obj(Json.parse(body)).get("item"));
            String url = Json.str(it, "url").trim();
            if (url.isEmpty() || url.length() > 2000) return null;
            String title = Json.str(it, "title").replaceAll("[\\p{Cntrl}]", " ").trim();
            return new Item(url, AlertModel.clip(title, 120), Json.num(it, "at"));
        } catch (RuntimeException e) {
            return null;
        }
    }

    public static Kind kind(String url, String startUrl) {
        if (url == null || startUrl == null) return Kind.NONE;
        String u = url.trim();
        if (!u.regionMatches(true, 0, "https://", 0, 8) || u.length() > 2000) return Kind.NONE;
        String host = host(u);
        if (host.isEmpty() || userInfo(u)) return Kind.NONE;
        if (host.equals(host(startUrl))) return Kind.SITE;
        return Links.parse(u, null).kind == Links.Kind.NONE ? Kind.NONE : Kind.PLAY;
    }

    private static boolean userInfo(String u) {
        int start = u.indexOf("://") + 3;
        int end = start;
        while (end < u.length() && "/?#".indexOf(u.charAt(end)) < 0) end++;
        return u.substring(start, end).indexOf('@') >= 0;
    }

    static String host(String u) {
        int start = u.indexOf("://");
        if (start < 0) return "";
        start += 3;
        int end = start;
        while (end < u.length() && "/?#".indexOf(u.charAt(end)) < 0) end++;
        String h = u.substring(start, end);
        int at = h.lastIndexOf('@');
        if (at >= 0) h = h.substring(at + 1);
        int colon = h.indexOf(':');
        if (colon >= 0) h = h.substring(0, colon);
        return h.toLowerCase(Locale.ROOT);
    }
}
