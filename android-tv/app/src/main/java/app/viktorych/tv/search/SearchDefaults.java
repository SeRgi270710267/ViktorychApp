package app.viktorych.tv.search;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;

import app.viktorych.tv.BuildConfig;

/** On/off for feed search: the search screen and the results the TV's own
 *  search can show. Both ship switched off; "off" puts them back. */
public final class SearchDefaults {
    private SearchDefaults() {}

    static final String PREFS = "viktorych_tv_search";

    static ComponentName[] parts(Context c) {
        return new ComponentName[]{
            new ComponentName(c, SearchActivity.class),
            new ComponentName(c, SuggestProvider.class),
        };
    }

    public static boolean enabled(Context c) {
        return c.getPackageManager().getComponentEnabledSetting(parts(c)[0]) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    public static void enable(Context c, boolean on) {
        for (ComponentName n : parts(c)) {
            c.getPackageManager().setComponentEnabledSetting(n,
                on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
                PackageManager.DONT_KILL_APP);
        }
        if (!on) c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    public static void open(Context c) {
        try {
            c.startActivity(new Intent(c, SearchActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (RuntimeException ignored) { }
    }

    static String recent(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("recent", "");
    }

    static void clearRecent(Context c) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("recent").apply();
    }

    /** Opens the site's search in the app, exactly as the app opens itself. */
    static void openSite(Context c, String query) {
        String q = SearchLinks.clean(query);
        if (q.isEmpty()) return;
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        p.edit().putString("recent", SearchLinks.remember(p.getString("recent", ""), q)).apply();
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(SearchLinks.url(BuildConfig.START_URL, q)))
            .setClassName(c, "app.viktorych.tv.TvLauncherActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        c.startActivity(i);
    }
}
