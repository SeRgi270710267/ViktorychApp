package app.viktorych.tv.ime;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/** The keys of the TV keyboard and how the remote moves between them.
 *  Pure Java so the layouts and the moves can be unit tested. */
public final class KeyLayout {
    /** What a key does. TEXT keys type their label. */
    public enum Code { TEXT, SHIFT, SYMBOLS, LETTERS, LANGUAGE, EMOJI, SPACE, DELETE, VOICE, ENTER, PAGE_PREV, PAGE_NEXT }

    public static final class Key {
        public final Code code;
        public final String text;
        public final float weight;
        /** Left edge and width as a share of the row, filled by layout(). */
        public float x, w;
        Key(Code code, String text, float weight) { this.code = code; this.text = text; this.weight = weight; }
        public float center() { return x + w / 2f; }
        @Override public String toString() { return code == Code.TEXT ? text : code.name(); }
    }

    public enum Mode { LETTERS, SYMBOLS, EMOJI }

    public static final String[] LANGS = {"en", "es", "ru", "hi"};

    private static final String[][] LETTERS = {
        // en
        {"qwertyuiop", "asdfghjkl'", "zxcvbnm,."},
        // es
        {"qwertyuiop", "asdfghjklñ", "zxcvbnm,."},
        // ru
        {"йцукенгшщзх", "фывапролджэ", "ячсмитьбю."},
    };
    // Hindi: consonants, shift gives vowels and signs.
    private static final String[][] HI = {
        {"क ख ग घ च छ ज झ ट ठ", "ड ढ ण त थ द ध न प फ", "ब भ म य र ल व स ह ।"},
        {"अ आ इ ई उ ऊ ए ऐ ओ औ", "ा ि ी ु ू े ै ो ौ ं", "् ः ँ श ष ऋ ृ क्ष ज्ञ ?"},
    };
    private static final String[] SYMBOLS = {"@#$%&-+()/", "*\"':;!?_=\\", "~`|<>[]{}€"};
    static final String[][] EMOJI = {
        {"😀", "😂", "🥹", "😍", "🥰", "😘", "😎", "🤩", "🥳", "😇",
         "🤔", "🙄", "😴", "😭", "😡", "🤯", "😱", "🤗", "🤫", "😬",
         "👍", "👎", "👏", "🙌", "🙏", "💪", "👀", "🫶", "✌️", "🤝",
         "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "🔥"},
        {"🎉", "✨", "⭐", "🌟", "💯", "✅", "❌", "⚡", "💥", "🎯",
         "🎮", "🎬", "🎵", "🎧", "📺", "📸", "🎤", "🏆", "⚽", "🏀",
         "🍕", "🍔", "🍟", "🍿", "🍩", "☕", "🍺", "🍷", "🎂", "🍓",
         "🐶", "🐱", "🦊", "🐼", "🐸", "🦄", "🌈", "☀️", "🌙", "❄️"},
    };

    private KeyLayout() {}

    static int mod(int a, int n) { int m = a % n; return m < 0 ? m + n : m; }

    public static String langLabel(String lang) {
        switch (lang) {
            case "es": return "ES";
            case "ru": return "RU";
            case "hi": return "हि";
            default: return "EN";
        }
    }

    public static String nextLang(String lang) {
        int i = Arrays.asList(LANGS).indexOf(lang);
        return LANGS[(i + 1) % LANGS.length];
    }

    /** @param page emoji page, ignored in other modes. */
    public static List<List<Key>> build(String lang, Mode mode, boolean shift, int page, boolean voice) {
        List<List<Key>> rows = new ArrayList<>();
        if (mode == Mode.EMOJI) {
            String[] e = EMOJI[mod(page, EMOJI.length)];
            for (int r = 0; r < 4; r++) {
                List<Key> row = new ArrayList<>();
                for (int c = 0; c < 10; c++) row.add(new Key(Code.TEXT, e[r * 10 + c], 1));
                rows.add(row);
            }
            List<Key> bottom = new ArrayList<>();
            bottom.add(new Key(Code.LETTERS, "ABC", 1.5f));
            bottom.add(new Key(Code.PAGE_PREV, "‹", 1));
            bottom.add(new Key(Code.PAGE_NEXT, "›", 1));
            bottom.add(new Key(Code.SPACE, " ", 3.5f));
            bottom.add(new Key(Code.DELETE, "", 1.5f));
            bottom.add(new Key(Code.ENTER, "", 1.5f));
            rows.add(bottom);
            return layout(rows);
        }
        rows.add(textRow("1234567890"));
        if (mode == Mode.SYMBOLS) {
            rows.add(textRow(SYMBOLS[0]));
            rows.add(textRow(SYMBOLS[1]));
            List<Key> r3 = textRow(SYMBOLS[2]);
            rows.add(r3);
        } else if (lang.equals("hi")) {
            String[] hi = HI[shift ? 1 : 0];
            rows.add(spacedRow(hi[0]));
            rows.add(spacedRow(hi[1]));
            List<Key> r3 = spacedRow(hi[2]);
            r3.add(0, new Key(Code.SHIFT, "", 1));
            rows.add(r3);
        } else {
            String[] l = LETTERS[lang.equals("es") ? 1 : lang.equals("ru") ? 2 : 0];
            for (int i = 0; i < 3; i++) {
                String s = shift ? l[i].toUpperCase(new Locale(lang)) : l[i];
                List<Key> row = textRow(s);
                if (i == 2) row.add(0, new Key(Code.SHIFT, "", 1));
                rows.add(row);
            }
        }
        List<Key> bottom = new ArrayList<>();
        bottom.add(new Key(mode == Mode.SYMBOLS ? Code.LETTERS : Code.SYMBOLS, mode == Mode.SYMBOLS ? "ABC" : "?123", 1.5f));
        bottom.add(new Key(Code.LANGUAGE, langLabel(lang), 1));
        bottom.add(new Key(Code.EMOJI, "", 1));
        bottom.add(new Key(Code.SPACE, " ", voice ? 3.5f : 4.5f));
        bottom.add(new Key(Code.DELETE, "", 1.5f));
        if (voice) bottom.add(new Key(Code.VOICE, "", 1));
        bottom.add(new Key(Code.ENTER, "", 1.5f));
        rows.add(bottom);
        return layout(rows);
    }

    private static List<Key> textRow(String chars) {
        List<Key> row = new ArrayList<>();
        int i = 0;
        while (i < chars.length()) {
            int cp = chars.codePointAt(i);
            row.add(new Key(Code.TEXT, new String(Character.toChars(cp)), 1));
            i += Character.charCount(cp);
        }
        return row;
    }

    private static List<Key> spacedRow(String chars) {
        List<Key> row = new ArrayList<>();
        for (String s : chars.split(" ")) row.add(new Key(Code.TEXT, s, 1));
        return row;
    }

    /** Every row spans the full width; keys share it by weight. */
    private static List<List<Key>> layout(List<List<Key>> rows) {
        for (List<Key> row : rows) {
            float total = 0;
            for (Key k : row) total += k.weight;
            float x = 0;
            for (Key k : row) {
                k.x = x / total;
                k.w = k.weight / total;
                x += k.weight;
            }
        }
        return rows;
    }

    /** Remote moves: left/right wrap within a row, up/down go to the key
     *  nearest above or below. Returns {row, col}. */
    public static int[] move(List<List<Key>> rows, int row, int col, int dRow, int dCol) {
        if (dCol != 0) {
            int n = rows.get(row).size();
            return new int[]{row, mod(col + dCol, n)};
        }
        int nr = mod(row + dRow, rows.size());
        float c = rows.get(row).get(Math.min(col, rows.get(row).size() - 1)).center();
        List<Key> target = rows.get(nr);
        int best = 0;
        float bestD = Float.MAX_VALUE;
        for (int i = 0; i < target.size(); i++) {
            Key k = target.get(i);
            float dd = c >= k.x && c <= k.x + k.w ? 0 : Math.abs(k.center() - c);
            if (dd < bestD) { bestD = dd; best = i; }
        }
        return new int[]{nr, best};
    }
}
