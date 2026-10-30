package app.viktorych.tv.alerts;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.List;
import java.util.Map;

import org.junit.Test;

public class AlertsTest {
    @Test
    public void jsonReadsAndQuotes() {
        Map<String, Object> m = Json.obj(Json.parse("{\"a\":[1,2.5,-3e2],\"b\":\"x\\\"y\\u00e9\\n\",\"c\":true,\"d\":null,\"e\":{}}"));
        List<Object> a = Json.arr(m.get("a"));
        assertEquals(3, a.size());
        assertEquals(-300.0, (Double) a.get(2), 0);
        assertEquals("x\"yé\n", Json.str(m, "b"));
        assertTrue(Json.bool(m, "c"));
        assertTrue(m.containsKey("d"));
        assertEquals("", Json.str(m, "missing"));
        assertEquals(0L, Json.num(m, "b"));
        assertEquals("\"a\\\"b\\\\c\\n\\u0001\"", Json.quote("a\"b\\c\n\u0001"));
        for (String bad : new String[] {"", "{", "[1,]", "{\"a\" 1}", "\"open", "{} x", "nul"}) {
            try { Json.parse(bad); fail(bad); } catch (IllegalArgumentException expected) { }
        }
        StringBuilder deep = new StringBuilder();
        for (int k = 0; k < 100; k++) deep.append('[');
        try { Json.parse(deep.toString()); fail("deep"); } catch (IllegalArgumentException expected) { }
    }

    @Test
    public void parsesTheServerAnswer() {
        String body = "{\"items\":[" +
            "{\"id\":\"n1\",\"kind\":\"dm\",\"at\":1000,\"read\":false,\"name\":\"Ana\",\"handle\":\"ana\",\"text\":\"hi\",\"avatar\":\"https://x/a.png\",\"hash\":\"#/messages\"}," +
            "{\"id\":\"n2\",\"kind\":\"mention\",\"at\":900,\"read\":true,\"name\":\"\",\"handle\":\"bo\",\"avatar\":\"http://insecure\"}," +
            "{\"id\":\"n3\",\"kind\":\"live\",\"at\":800,\"read\":false,\"name\":\"Cy\"}," +
            "{\"id\":\"n4\",\"kind\":\"like\",\"at\":700,\"read\":false,\"name\":\"Di\",\"others\":3}," +
            "{\"kind\":\"like\"}],\"unread\":3,\"cursor\":5}";
        AlertModel.View v = AlertModel.parse(body);
        assertEquals(4, v.notes.size());
        assertEquals(3, v.unread);
        AlertModel.Note n2 = v.notes.get(1);
        assertEquals("@bo", n2.who());
        assertEquals("", n2.avatar);
        assertEquals("https://x/a.png", v.notes.get(0).avatar);
        assertEquals(1, AlertModel.filter(v.notes, AlertModel.Tab.MESSAGES).size());
        assertEquals(1, AlertModel.filter(v.notes, AlertModel.Tab.MENTIONS).size());
        assertEquals(1, AlertModel.filter(v.notes, AlertModel.Tab.LIVE).size());
        assertEquals(4, AlertModel.filter(v.notes, AlertModel.Tab.ALL).size());
        assertEquals(0, AlertModel.unreadIn(v.notes, AlertModel.Tab.MENTIONS));
        assertEquals(3, AlertModel.unreadIn(v.notes, AlertModel.Tab.ALL));
        assertEquals(AlertModel.Line.LIKE_MANY, AlertModel.line("like", 3));
        assertEquals(AlertModel.Line.LIKE, AlertModel.line("like", 0));
        assertEquals(AlertModel.Line.OTHER, AlertModel.line("package", 0));
    }

    @Test
    public void timesLinksAndCodes() {
        long now = 10_000_000_000L;
        assertArrayEquals(new long[] {0, 0}, AlertModel.ago(now, now - 30_000));
        assertArrayEquals(new long[] {5, 1}, AlertModel.ago(now, now - 5 * 60_000));
        assertArrayEquals(new long[] {2, 2}, AlertModel.ago(now, now - 2 * 3_600_000));
        assertArrayEquals(new long[] {3, 3}, AlertModel.ago(now, now - 3 * 86_400_000L));
        assertArrayEquals(new long[] {2, 4}, AlertModel.ago(now, now - 15 * 86_400_000L));
        assertArrayEquals(new long[] {0, 0}, AlertModel.ago(now, now + 99_000));
        String start = "https://viktorychapp.pages.dev/?tv=1&src=tvapp&tvapp=9#/home";
        assertEquals("https://viktorychapp.pages.dev/?tv=1&src=tvapp&tvapp=9#/messages", AlertModel.siteUrl(start, "#/messages"));
        assertEquals("https://viktorychapp.pages.dev/?tv=1&src=tvapp&tvapp=9#/notifications", AlertModel.siteUrl(start, "javascript:alert(1)"));
        assertEquals("https://viktorychapp.pages.dev/?tv=1&src=tvapp&tvapp=9#/notifications", AlertModel.siteUrl(start, ""));
        assertEquals("https://example.workers.dev", AlertModel.apiFromConfig("window.X = {\n    api: \"https://example.workers.dev\",\n    gate: true }"));
        assertEquals("", AlertModel.apiFromConfig("    api: \"\","));
        assertEquals("", AlertModel.apiFromConfig("    api: \"http://plain.example\","));
        assertEquals("ABC2DE", AlertModel.cleanCode("abc-2de"));
        assertEquals("", AlertModel.cleanCode("ABC0DE"));
        assertEquals("", AlertModel.cleanCode("ABCDE"));
        assertEquals("ABC 2DE", AlertModel.showCode("abc2de"));
        assertEquals("viktorychapp.pages.dev/?pair=ABC2DE", AlertModel.pairAddress("ABC2DE"));
        assertEquals("viktorychapp.pages.dev/#/link-tv", AlertModel.pairAddress(null));
        assertFalse(AlertModel.pairAddress("ABC2DE").contains(" "));
    }
}
