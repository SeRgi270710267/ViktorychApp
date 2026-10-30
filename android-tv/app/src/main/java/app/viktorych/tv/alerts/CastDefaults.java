package app.viktorych.tv.alerts;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;

/** The optional Cast screen: on or off from the defaults screen. It shares this TV's
 *  link with Alerts; turning off the last of the two signs the TV out. */
public final class CastDefaults {
    private CastDefaults() {}

    static ComponentName part(Context c) { return new ComponentName(c, CastActivity.class); }

    public static boolean enabled(Context c) {
        return c.getPackageManager().getComponentEnabledSetting(part(c)) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    public static void enable(Context c, boolean on) {
        if (!on && !AlertsDefaults.enabled(c)) Session.unlink(c);
        c.getPackageManager().setComponentEnabledSetting(part(c),
            on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
            PackageManager.DONT_KILL_APP);
    }

    public static boolean linked(Context c) { return Session.linked(c); }

    public static String accountName(Context c) { return Session.accountName(c); }

    public static void unlink(Context c) { Session.unlink(c); }

    public static void open(Context c) {
        if (enabled(c)) c.startActivity(new Intent(c, CastActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
}
