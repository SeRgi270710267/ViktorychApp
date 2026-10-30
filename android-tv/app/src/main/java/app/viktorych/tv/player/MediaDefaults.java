package app.viktorych.tv.player;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.Settings;

/** On/off for the player and the screensaver. Both ship switched off in the
 *  manifest; "off" puts them back to exactly that state. */
public final class MediaDefaults {
    private MediaDefaults() {}

    static final String PREFS = "viktorych_tv_media";

    public static ComponentName player(Context c) { return new ComponentName(c, PlayerActivity.class); }
    public static ComponentName dream(Context c) { return new ComponentName(c, FeedDream.class); }

    public static boolean enabled(Context c, ComponentName n) {
        return c.getPackageManager().getComponentEnabledSetting(n) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    public static void enable(Context c, ComponentName n, boolean on) {
        c.getPackageManager().setComponentEnabledSetting(n,
            on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
            PackageManager.DONT_KILL_APP);
    }

    /** True when a YouTube link already opens straight in our player ("Always" was picked). */
    public static boolean isDefaultPlayer(Context c) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/watch?v=aqz-KE-bpKQ"));
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            ResolveInfo r = c.getPackageManager().resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY);
            return r != null && r.activityInfo != null && PlayerActivity.class.getName().equals(r.activityInfo.name);
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** True when the TV's screensaver is set to ours. Some TVs hide this setting; then false. */
    public static boolean isDefaultDream(Context c) {
        try {
            String s = Settings.Secure.getString(c.getContentResolver(), "screensaver_components");
            return s != null && s.contains(c.getPackageName() + "/") && s.contains("FeedDream");
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** Opens the TV's screensaver settings. Returns false when this TV has none. */
    public static boolean openDreamSettings(Context c) {
        String[] actions = {Settings.ACTION_DREAM_SETTINGS, "android.settings.DISPLAY_SETTINGS"};
        for (String a : actions) {
            Intent i = new Intent(a).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (c.getPackageManager().resolveActivity(i, 0) == null) continue;
            try { c.startActivity(i); return true; } catch (RuntimeException ignored) { /* next */ }
        }
        return false;
    }

    public static int savedCount(Context c) {
        return Playlist.count(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("dream", ""));
    }
}
