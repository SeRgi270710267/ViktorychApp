package app.viktorych.tv.alerts;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** A small strict JSON reader and string quoter, pure Java so the unit tests can run it.
 *  Objects become Map, arrays List, numbers Double, plus String, Boolean and null. */
public final class Json {
    private final String s;
    private int i;

    private Json(String s) { this.s = s; }

    public static Object parse(String text) {
        if (text == null) throw new IllegalArgumentException("empty");
        Json p = new Json(text);
        p.ws();
        Object v = p.value(0);
        p.ws();
        if (p.i != p.s.length()) throw new IllegalArgumentException("trailing data");
        return v;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> obj(Object v) { return v instanceof Map ? (Map<String, Object>) v : new LinkedHashMap<>(); }

    @SuppressWarnings("unchecked")
    public static List<Object> arr(Object v) { return v instanceof List ? (List<Object>) v : new ArrayList<>(); }

    public static String str(Map<String, Object> m, String k) { Object v = m.get(k); return v instanceof String ? (String) v : ""; }

    public static long num(Map<String, Object> m, String k) { Object v = m.get(k); return v instanceof Double ? (long) (double) (Double) v : 0L; }

    public static boolean bool(Map<String, Object> m, String k) { return Boolean.TRUE.equals(m.get(k)); }

    /** "text" with JSON escapes, for request bodies. */
    public static String quote(String v) {
        StringBuilder b = new StringBuilder("\"");
        for (int k = 0; k < v.length(); k++) {
            char c = v.charAt(k);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    private Object value(int depth) {
        if (depth > 64) throw new IllegalArgumentException("too deep");
        if (i >= s.length()) throw new IllegalArgumentException("end");
        char c = s.charAt(i);
        if (c == '{') {
            i++;
            Map<String, Object> m = new LinkedHashMap<>();
            ws();
            if (peek('}')) { i++; return m; }
            while (true) {
                ws();
                String k = string();
                ws(); expect(':'); ws();
                m.put(k, value(depth + 1));
                ws();
                if (peek(',')) { i++; continue; }
                expect('}');
                return m;
            }
        }
        if (c == '[') {
            i++;
            List<Object> l = new ArrayList<>();
            ws();
            if (peek(']')) { i++; return l; }
            while (true) {
                ws();
                l.add(value(depth + 1));
                ws();
                if (peek(',')) { i++; continue; }
                expect(']');
                return l;
            }
        }
        if (c == '"') return string();
        if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
        if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
        if (s.startsWith("null", i)) { i += 4; return null; }
        int start = i;
        while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
        if (start == i) throw new IllegalArgumentException("unexpected " + c);
        return Double.valueOf(s.substring(start, i));
    }

    private String string() {
        expect('"');
        StringBuilder b = new StringBuilder();
        while (true) {
            if (i >= s.length()) throw new IllegalArgumentException("open string");
            char c = s.charAt(i++);
            if (c == '"') return b.toString();
            if (c != '\\') { b.append(c); continue; }
            if (i >= s.length()) throw new IllegalArgumentException("open escape");
            char e = s.charAt(i++);
            switch (e) {
                case '"': b.append('"'); break;
                case '\\': b.append('\\'); break;
                case '/': b.append('/'); break;
                case 'b': b.append('\b'); break;
                case 'f': b.append('\f'); break;
                case 'n': b.append('\n'); break;
                case 'r': b.append('\r'); break;
                case 't': b.append('\t'); break;
                case 'u':
                    if (i + 4 > s.length()) throw new IllegalArgumentException("bad escape");
                    b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                    i += 4;
                    break;
                default: throw new IllegalArgumentException("bad escape");
            }
        }
    }

    private void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
    private boolean peek(char c) { return i < s.length() && s.charAt(i) == c; }
    private void expect(char c) {
        if (!peek(c)) throw new IllegalArgumentException("expected " + c);
        i++;
    }
}
