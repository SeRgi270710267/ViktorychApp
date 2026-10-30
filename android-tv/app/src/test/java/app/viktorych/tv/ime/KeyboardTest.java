package app.viktorych.tv.ime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.List;

import org.junit.Test;

import app.viktorych.tv.search.SearchLinks;

public class KeyboardTest {
    private static String row(List<KeyLayout.Key> r) {
        StringBuilder b = new StringBuilder();
        for (KeyLayout.Key k : r) b.append(k.code == KeyLayout.Code.TEXT ? k.text : "[" + k.code + "]");
        return b.toString();
    }

    @Test
    public void layoutsForEveryLanguage() {
        List<List<KeyLayout.Key>> en = KeyLayout.build("en", KeyLayout.Mode.LETTERS, false, 0, true);
        assertEquals(5, en.size());
        assertEquals("1234567890", row(en.get(0)));
        assertEquals("qwertyuiop", row(en.get(1)));
        assertEquals("[SHIFT]zxcvbnm,.", row(en.get(3)));
        assertEquals("[SYMBOLS][LANGUAGE][EMOJI][SPACE][DELETE][VOICE][ENTER]", row(en.get(4)));
        assertEquals("QWERTYUIOP", row(KeyLayout.build("en", KeyLayout.Mode.LETTERS, true, 0, true).get(1)));
        assertEquals("asdfghjklñ", row(KeyLayout.build("es", KeyLayout.Mode.LETTERS, false, 0, true).get(2)));
        assertEquals("ЙЦУКЕНГШЩЗХ", row(KeyLayout.build("ru", KeyLayout.Mode.LETTERS, true, 0, true).get(1)));
        List<List<KeyLayout.Key>> hi = KeyLayout.build("hi", KeyLayout.Mode.LETTERS, false, 0, true);
        assertEquals("कखगघचछजझटठ", row(hi.get(1)));
        assertTrue(row(KeyLayout.build("hi", KeyLayout.Mode.LETTERS, true, 0, true).get(3)).contains("क्ष"));
        // Without a recognizer there is no mic key and space takes its room.
        assertFalse(row(KeyLayout.build("en", KeyLayout.Mode.LETTERS, false, 0, false).get(4)).contains("VOICE"));
        assertEquals("en", KeyLayout.nextLang("hi"));
        assertEquals("es", KeyLayout.nextLang("en"));
    }

    @Test
    public void rowsFillTheWidth() {
        for (String lang : KeyLayout.LANGS) {
            for (KeyLayout.Mode m : KeyLayout.Mode.values()) {
                for (List<KeyLayout.Key> r : KeyLayout.build(lang, m, false, 0, true)) {
                    KeyLayout.Key last = r.get(r.size() - 1);
                    assertEquals(0f, r.get(0).x, 1e-4);
                    assertEquals(1f, last.x + last.w, 1e-4);
                }
            }
        }
    }

    @Test
    public void emojiPagesWrap() {
        List<List<KeyLayout.Key>> e0 = KeyLayout.build("en", KeyLayout.Mode.EMOJI, false, 0, true);
        List<List<KeyLayout.Key>> e2 = KeyLayout.build("en", KeyLayout.Mode.EMOJI, false, 2, true);
        List<List<KeyLayout.Key>> em = KeyLayout.build("en", KeyLayout.Mode.EMOJI, false, -1, true);
        assertEquals(e0.get(0).get(0).text, e2.get(0).get(0).text);
        assertEquals(KeyLayout.EMOJI[1][0], em.get(0).get(0).text);
        assertEquals("[LETTERS][PAGE_PREV][PAGE_NEXT][SPACE][DELETE][ENTER]", row(e0.get(4)));
    }

    @Test
    public void remoteMoves() {
        List<List<KeyLayout.Key>> en = KeyLayout.build("en", KeyLayout.Mode.LETTERS, false, 0, true);
        // Left from the first key wraps to the last.
        assertEquals(9, KeyLayout.move(en, 1, 0, 0, -1)[1]);
        // Down from "t" lands on "g", down from "g" on "v"-ish column, down again on space.
        int[] g = KeyLayout.move(en, 1, 4, 1, 0);
        assertEquals("g", en.get(g[0]).get(g[1]).text);
        int[] bottom = KeyLayout.move(en, 3, 5, 1, 0);
        assertEquals(KeyLayout.Code.SPACE, en.get(bottom[0]).get(bottom[1]).code);
        // Up from the top row wraps to the bottom row.
        assertEquals(4, KeyLayout.move(en, 0, 0, -1, 0)[0]);
        // Down from the bottom row wraps to the numbers.
        assertEquals(0, KeyLayout.move(en, 4, 0, 1, 0)[0]);
    }

    @Test
    public void searchLinks() {
        String start = "https://viktorychapp.pages.dev/?tv=1&src=tvapp&tvapp=7#/home";
        assertEquals("https://viktorychapp.pages.dev/?tv=1&src=tvapp&tvapp=7#/explore?q=cats%20%26%20dogs",
            SearchLinks.url(start, "  cats &  dogs \n"));
        assertEquals("%D0%BA%D0%BE%D1%82", SearchLinks.encode("кот"));
        assertEquals("a-_.!~*'()", SearchLinks.encode("a-_.!~*'()"));
        assertEquals("%23%2F%3F", SearchLinks.encode("#/?"));
        StringBuilder big = new StringBuilder();
        for (int i = 0; i < 300; i++) big.append('x');
        assertEquals(SearchLinks.MAX_QUERY, SearchLinks.clean(big.toString()).length());
    }

    @Test
    public void recentSearches() {
        String s = "";
        s = SearchLinks.remember(s, "news");
        s = SearchLinks.remember(s, "music");
        s = SearchLinks.remember(s, "NEWS");
        assertEquals("NEWS\nmusic", s);
        for (int i = 0; i < 20; i++) s = SearchLinks.remember(s, "q" + i);
        assertEquals(SearchLinks.MAX_RECENT, SearchLinks.parse(s).size());
        assertEquals("q19", SearchLinks.parse(s).get(0));
        List<String> m = SearchLinks.matching("bigq1\nq1\nother", "q1");
        assertEquals("q1", m.get(0));
        assertEquals("bigq1", m.get(1));
        assertEquals(2, m.size());
        assertTrue(SearchLinks.parse(null).isEmpty());
    }
}
