package app.viktorych.tv.tune;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.os.Build;
import android.view.Display;
import android.view.Window;
import android.view.WindowManager;

/** The two TV display settings the page cannot set by itself:
 *  - frame-rate matching: while a video plays, switch the TV to a mode with
 *    the same resolution whose refresh rate is a whole multiple of the
 *    video's frame rate (24p film on a 24/48 Hz mode, 25p on 50 Hz), and back
 *    to the TV's own mode when the video stops;
 *  - HDR / wide colour: ask for the wide-gamut (or HDR, Android 14+) window
 *    colour mode so HDR video is not flattened to SDR.
 *  Both are off unless the page turned them on (from the TV tuning step or
 *  Settings), and both stay inside this app's window. */
public final class DisplayTune {
    private static final String FILE = "viktorychtv_tune";
    private final Activity activity;
    private final SharedPreferences sp;
    private int matched = 0;

    public DisplayTune(Activity a) {
        activity = a;
        sp = a.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public boolean frameMatch() { return sp.getBoolean("frameMatch", false); }
    public boolean hdr() { return sp.getBoolean("hdr", false); }

    /** passthrough and padHints are kept for the app's own screens (the
     *  native player and the controller screen); the WebView itself cannot
     *  bitstream surround audio. */
    public void set(boolean frameMatch, boolean hdr, boolean passthrough, boolean padHints) {
        sp.edit().putBoolean("frameMatch", frameMatch).putBoolean("hdr", hdr)
            .putBoolean("passthrough", passthrough).putBoolean("padHints", padHints).apply();
        if (!frameMatch) reset();
        applyColor();
    }

    /** Call on the UI thread. */
    public void applyColor() {
        if (Build.VERSION.SDK_INT < 26) return;
        Window w = activity.getWindow();
        int want = ActivityInfo.COLOR_MODE_DEFAULT;
        if (hdr()) want = Build.VERSION.SDK_INT >= 34 ? 2 /* COLOR_MODE_HDR */ : ActivityInfo.COLOR_MODE_WIDE_COLOR_GAMUT;
        try { w.setColorMode(want); } catch (Throwable ignored) { /* not on this TV */ }
    }

    /** A video started at about fps frames per second. Call on the UI thread. */
    public void match(double fps) {
        if (!frameMatch() || Build.VERSION.SDK_INT < 23 || fps < 10 || fps > 125) return;
        Display d = activity.getWindowManager().getDefaultDisplay();
        Display.Mode cur = d.getMode();
        Display.Mode best = null;
        double bestErr = 1e9;
        for (Display.Mode m : d.getSupportedModes()) {
            if (m.getPhysicalWidth() != cur.getPhysicalWidth() || m.getPhysicalHeight() != cur.getPhysicalHeight()) continue;
            double hz = m.getRefreshRate();
            double k = Math.round(hz / fps);
            if (k < 1) continue;
            double err = Math.abs(hz - k * fps) / fps;
            // Prefer an exact multiple, then the lowest such rate (fewer repeats).
            double score = err * 100 + k * 0.01;
            if (err < 0.01 && score < bestErr) { bestErr = score; best = m; }
        }
        if (best == null || best.getModeId() == cur.getModeId()) return;
        WindowManager.LayoutParams lp = activity.getWindow().getAttributes();
        if (lp.preferredDisplayModeId == best.getModeId()) return;
        lp.preferredDisplayModeId = best.getModeId();
        activity.getWindow().setAttributes(lp);
        matched = best.getModeId();
    }

    /** The video stopped: give the TV its own mode back. Call on the UI thread. */
    public void reset() {
        if (Build.VERSION.SDK_INT < 23 || matched == 0) return;
        WindowManager.LayoutParams lp = activity.getWindow().getAttributes();
        lp.preferredDisplayModeId = 0;
        activity.getWindow().setAttributes(lp);
        matched = 0;
    }
}
