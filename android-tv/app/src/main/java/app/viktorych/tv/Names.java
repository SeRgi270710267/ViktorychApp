package app.viktorych.tv;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

/** The home-screen name and the in-app title. Android only lets an app pick
 *  between launcher entries declared in its manifest (the aliases), so the
 *  home-screen name is one of a few presets. The recents title is free text. */
final class Names {
    static final String[] PRESETS = {"default", "media", "browser", "player", "notes"};
    private static final String PREFS = "viktorych_tv";

    private Names() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean known(String preset) {
        for (String p : PRESETS) if (p.equals(preset)) return true;
        return false;
    }

    static String alias(String preset) {
        return "Launcher" + Character.toUpperCase(preset.charAt(0)) + preset.substring(1);
    }

    static String preset(Context c) {
        String p = prefs(c).getString("preset", "default");
        return known(p) ? p : "default";
    }

    static String title(Context c) {
        return prefs(c).getString("title", "");
    }

    /** Free text, trimmed to 40 characters, no control characters. */
    static String cleanTitle(String raw) {
        if (raw == null) return "";
        String t = raw.replaceAll("[\\p{Cc}\\p{Cf}]", "").replaceAll("\\s+", " ").trim();
        if (t.codePointCount(0, t.length()) > 40) t = t.substring(0, t.offsetByCodePoints(0, 40)).trim();
        return t;
    }

    /** A custom build always shows its own name, so it keeps the default entry on.
     *  The chosen preset is still saved and comes back if the normal app is installed. */
    static String shown(String preset) {
        return BuildConfig.CUSTOM ? "default" : preset;
    }

    /** Enabled entries survive app updates, so after any install put the right one back. */
    static void sync(Context c) {
        try { enable(c, shown(preset(c))); } catch (RuntimeException ignored) { /* keep what is there */ }
    }

    static void apply(Context c, String preset, String title) {
        if (preset != null && known(preset)) {
            enable(c, shown(preset));
            prefs(c).edit().putString("preset", preset).apply();
        }
        if (title != null) prefs(c).edit().putString("title", cleanTitle(title)).apply();
    }

    private static void enable(Context c, String preset) {
        {
            PackageManager pm = c.getPackageManager();
            // Turn the new entry on first so the app always has a launcher entry.
            for (int pass = 0; pass < 2; pass++) {
                for (String p : PRESETS) {
                    boolean on = p.equals(preset);
                    if ((pass == 0) != on) continue;
                    pm.setComponentEnabledSetting(new ComponentName(c, c.getPackageName() + "." + alias(p)),
                        on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        PackageManager.DONT_KILL_APP);
                }
            }
        }
    }

    /** Recents shows this instead of the app label when set. */
    static void label(Activity a) {
        String t = title(a);
        if (t.isEmpty() || Build.VERSION.SDK_INT < 21) return;
        try {
            if (Build.VERSION.SDK_INT >= 28) a.setTaskDescription(new ActivityManager.TaskDescription(t));
            else a.setTaskDescription(new ActivityManager.TaskDescription(t, null));
        } catch (RuntimeException ignored) { /* some launchers refuse */ }
    }
}
