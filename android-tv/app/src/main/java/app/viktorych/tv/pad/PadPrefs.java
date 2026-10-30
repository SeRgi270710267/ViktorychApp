package app.viktorych.tv.pad;

import android.content.Context;
import android.content.SharedPreferences;

/** Settings for one controller (by its Android device descriptor). */
public final class PadPrefs {
    private static final String FILE = "viktorychtv_pad";
    private final SharedPreferences sp;
    private final String key;

    public PadPrefs(Context c, String device) {
        sp = c.getSharedPreferences(FILE, Context.MODE_PRIVATE);
        key = "d" + Integer.toHexString(device == null ? 0 : device.hashCode()) + ".";
    }

    public PadLayout layout() { return PadLayout.load(sp.getString(key + "layout", "")); }
    public void layout(PadLayout l) { sp.edit().putString(key + "layout", l.save()).apply(); }
    public int sensitivity() { return sp.getInt(key + "sens", 5); }
    public void sensitivity(int s) { sp.edit().putInt(key + "sens", Math.max(1, Math.min(10, s))).apply(); }
    public boolean invert() { return sp.getBoolean(key + "invert", false); }
    public void invert(boolean on) { sp.edit().putBoolean(key + "invert", on).apply(); }
    /** Move with ReGone's touch joystick instead of W A S D (fallback). */
    public boolean stickMove() { return sp.getBoolean(key + "stick", false); }
    public void stickMove(boolean on) { sp.edit().putBoolean(key + "stick", on).apply(); }
    /** null = by device name, else "xbox" or "ps". */
    public String glyphs() { return sp.getString(key + "glyphs", null); }
    public void glyphs(String g) { sp.edit().putString(key + "glyphs", g).apply(); }
}
