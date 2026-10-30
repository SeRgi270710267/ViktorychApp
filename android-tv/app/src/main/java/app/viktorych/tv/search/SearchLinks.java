package app.viktorych.tv.search;

import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.List;

/** Search links into the site and the list of recent searches.
 *  Pure Java so it can be unit tested. */
public final class SearchLinks {
    public static final int MAX_RECENT = 12;
    public static final int MAX_QUERY = 200;

    private SearchLinks() {}

    /** The site's Explore search for this query, on top of the app's start URL. */
    public static String url(String startUrl, String query) {
        String base = startUrl;
        int hash = base.indexOf('#');
        if (hash >= 0) base = base.substring(0, hash);
        return base + "#/explore?q=" + encode(clean(query));
    }

    /** One line, trimmed, no control characters, capped. */
    public static String clean(String q) {
        if (q == null) return "";
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < q.length(); i++) {
            char ch = q.charAt(i);
            b.append(Character.isISOControl(ch) ? ' ' : ch);
        }
        String s = b.toString().replaceAll("\\s+", " ").trim();
        if (s.length() > MAX_QUERY) s = s.substring(0, MAX_QUERY).trim();
        return s;
    }

    /** Same as JavaScript's encodeURIComponent. */
    public static String encode(String s) {
        StringBuilder b = new StringBuilder();
        for (byte x : s.getBytes(Charset.forName("UTF-8"))) {
            int c = x & 0xFF;
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || "-_.!~*'()".indexOf(c) >= 0) {
                b.append((char) c);
            } else {
                b.append('%').append("0123456789ABCDEF".charAt(c >> 4)).append("0123456789ABCDEF".charAt(c & 15));
            }
        }
        return b.toString();
    }

    /** Recent searches are stored one per line, newest first. */
    public static List<String> parse(String stored) {
        List<String> out = new ArrayList<>();
        if (stored == null) return out;
        for (String line : stored.split("\n")) {
            String q = clean(line);
            if (!q.isEmpty() && !containsIgnoreCase(out, q) && out.size() < MAX_RECENT) out.add(q);
        }
        return out;
    }

    public static String remember(String stored, String query) {
        String q = clean(query);
        List<String> list = parse(stored);
        if (q.isEmpty()) return join(list);
        for (int i = list.size() - 1; i >= 0; i--) if (list.get(i).equalsIgnoreCase(q)) list.remove(i);
        list.add(0, q);
        while (list.size() > MAX_RECENT) list.remove(list.size() - 1);
        return join(list);
    }

    /** Recent searches that start with what was typed (or contain it), for suggestions. */
    public static List<String> matching(String stored, String typed) {
        String t = clean(typed).toLowerCase();
        List<String> starts = new ArrayList<>(), contains = new ArrayList<>();
        for (String q : parse(stored)) {
            String l = q.toLowerCase();
            if (t.isEmpty() || l.startsWith(t)) starts.add(q);
            else if (l.contains(t)) contains.add(q);
        }
        starts.addAll(contains);
        return starts;
    }

    private static boolean containsIgnoreCase(List<String> l, String q) {
        for (String s : l) if (s.equalsIgnoreCase(q)) return true;
        return false;
    }

    private static String join(List<String> l) {
        StringBuilder b = new StringBuilder();
        for (String s : l) { if (b.length() > 0) b.append('\n'); b.append(s); }
        return b.toString();
    }
}
