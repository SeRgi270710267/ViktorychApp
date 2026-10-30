package app.viktorych.tv.alerts;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;

/** The optional alerts panel: on or off from the defaults screen. Off also signs this
 *  TV's panel out, so turning it off leaves nothing behind. */
public final class AlertsDefaults {
    private AlertsDefaults() {}

    static ComponentName part(Context c) { return new ComponentName(c, AlertsActivity.class); }

    public static boolean enabled(Context c) {
        return c.getPackageManager().getComponentEnabledSetting(part(c)) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    public static void enable(Context c, boolean on) {
        if (!on) unlink(c);
        c.getPackageManager().setComponentEnabledSetting(part(c),
            on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
            PackageManager.DONT_KILL_APP);
    }

    public static boolean linked(Context c) { return Session.linked(c); }

    public static String accountName(Context c) { return Session.accountName(c); }

    /** Signs this TV's panel out (on the server too) and forgets the session. */
    public static void unlink(Context c) { Session.unlink(c); }

    public static void open(Context c) {
        if (enabled(c)) c.startActivity(new Intent(c, AlertsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
}
