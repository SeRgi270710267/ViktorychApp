package app.viktorych.tv.channels;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import app.viktorych.tv.alerts.Json;

/** The ViktorychMusic loop as a TV channel: reads loop/current.json, picks a
 *  playlist this TV can play, works out where "now" is in the loop (the same
 *  sum the site uses, so the TV and the site play the same moment) and lays out
 *  guide blocks. Pure Java so it can be unit tested. */
public final class LoopModel {
    private LoopModel() {}

    /** The public pointer the site reads too. Never cached. */
    public static final String CURRENT = "https://pub-bf9b5e3ebb2b421aa49e7af484f3c22d.r2.dev/loop/current.json";
    static final String HOST = "pub-bf9b5e3ebb2b421aa49e7af484f3c22d.r2.dev";

    /** Guide blocks are this long, and the guide is filled this far ahead. */
    public static final long BLOCK_MS = 60L * 60L * 1000L;
    public static final int BLOCKS_AHEAD = 12;

    public static final class Station {
        public final boolean live;
        /** AAC playlist when there is one (every Android TV plays it), else the main one. */
        public final String url;
        public final String version;
        public final double duration;
        public final double epoch;

        Station(boolean live, String url, String version, double duration, double epoch) {
            this.live = live;
            this.url = url;
            this.version = version;
            this.duration = duration;
            this.epoch = epoch;
        }

        /** Seconds into the loop at this moment, 0 when the loop has no length. */
        public double position(long nowMs) {
            if (!(duration > 0) || Double.isNaN(epoch) || Double.isInfinite(epoch)) return 0;
            double t = nowMs / 1000.0 - epoch;
            double p = ((t % duration) + duration) % duration;
            return p > duration - 0.5 ? 0 : p;
        }
    }

    /** Parses current.json. Returns null for anything unusable: not live, no
     *  playlist, a playlist off the loop's own host, or a missing length. */
    public static Station parse(String text) {
        Map<String, Object> m;
        try { m = Json.obj(Json.parse(text)); } catch (IllegalArgumentException e) { return null; }
        if (!Json.bool(m, "live")) return null;
        String main = Json.str(m, "url");
        String aac = Json.str(m, "fallback");
        String url = playlist(aac) ? aac : playlist(main) ? main : "";
        if (url.isEmpty()) return null;
        double duration = dbl(m.get("duration"));
        double epoch = dbl(m.get("epoch"));
        if (!(duration > 0) || Double.isNaN(epoch)) return null;
        String version = Json.str(m, "version");
        if (!version.matches("[A-Za-z0-9._-]{1,40}")) version = "";
        return new Station(true, url, version, duration, epoch);
    }

    /** An https .m3u8 on the loop's own host, nothing else. */
    static boolean playlist(String u) {
        if (u == null || u.length() > 300) return false;
        String head = "https://" + HOST + "/";
        if (!u.startsWith(head)) return false;
        String path = u.substring(head.length());
        return path.matches("[A-Za-z0-9._/-]+\\.m3u8") && !path.contains("..");
    }

    private static double dbl(Object v) { return v instanceof Double ? (Double) v : Double.NaN; }

    /** Guide blocks [start, end] in ms: the block holding now, then the next
     *  BLOCKS_AHEAD - 1, each one hour on the hour. */
    public static List<long[]> blocks(long nowMs) {
        List<long[]> out = new ArrayList<>();
        long start = nowMs - (nowMs % BLOCK_MS);
        for (int i = 0; i < BLOCKS_AHEAD; i++) {
            out.add(new long[] {start, start + BLOCK_MS});
            start += BLOCK_MS;
        }
        return out;
    }

    /** "12:05 / 36:48" style progress through the loop. */
    public static String clock(double seconds) {
        long s = Math.max(0, (long) seconds);
        long h = s / 3600, m = (s / 60) % 60, r = s % 60;
        return h > 0 ? h + ":" + two(m) + ":" + two(r) : m + ":" + two(r);
    }

    private static String two(long v) { return v < 10 ? "0" + v : String.valueOf(v); }
}
