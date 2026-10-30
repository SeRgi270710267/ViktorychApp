package app.viktorych.tv.player;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** The screensaver's photos and clips, as sent by the site. Plain text, one
 *  item per line: kind TAB url TAB author TAB text (tabs and new lines in
 *  text are turned into spaces). Pure Java so it can be tested. */
final class Playlist {
    static final int MAX = 60;

    static final class Item {
        final boolean video;
        final String url, author, text;
        Item(boolean video, String url, String author, String text) {
            this.video = video; this.url = url; this.author = author; this.text = text;
        }
    }

    private Playlist() {}

    /** Keeps only https items, at most MAX, with short text. */
    static List<Item> parse(String raw) {
        List<Item> out = new ArrayList<>();
        if (raw == null) return out;
        for (String line : raw.split("\n")) {
            String[] f = line.split("\t", -1);
            if (f.length < 2) continue;
            String kind = f[0].trim().toLowerCase(Locale.ROOT);
            if (!kind.equals("i") && !kind.equals("v")) continue;
            String url = f[1].trim();
            if (!url.startsWith("https://") || url.length() > 2048 || url.contains(" ")) continue;
            String author = f.length > 2 ? clip(f[2], 60) : "";
            String text = f.length > 3 ? clip(f[3], 280) : "";
            out.add(new Item(kind.equals("v"), url, author, text));
            if (out.size() >= MAX) break;
        }
        return out;
    }

    static String write(List<Item> items) {
        StringBuilder b = new StringBuilder();
        for (Item it : items) {
            b.append(it.video ? 'v' : 'i').append('\t').append(it.url).append('\t')
                .append(it.author.replaceAll("[\\t\\n\\r]", " ")).append('\t')
                .append(it.text.replaceAll("[\\t\\n\\r]", " ")).append('\n');
        }
        return b.toString();
    }

    static int count(String raw) { return parse(raw).size(); }

    private static String clip(String s, int max) {
        String t = s.replaceAll("[\\t\\r\\n]+", " ").replaceAll("\\s+", " ").trim();
        return t.length() > max ? t.substring(0, max - 1).trim() + "\u2026" : t;
    }
}
