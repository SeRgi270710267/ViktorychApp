package app.viktorych.tv.launcher;

import android.app.Activity;
import android.app.role.RoleManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.provider.Settings;

/** Which TV jobs ViktorychTV does by default. Every one is off until the
 *  user turns it on, and Android always asks the user to confirm. */
public final class Defaults {
    private Defaults() {}

    static final String PREFS = "viktorych_tv_launcher";

    static ComponentName home(Context c) { return new ComponentName(c, HomeActivity.class); }

    /** The home screen is switched off in the manifest, so the TV never asks
     *  "which home?" until the user picks it on the defaults screen. */
    static boolean homeEnabled(Context c) {
        int s = c.getPackageManager().getComponentEnabledSetting(home(c));
        return s == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    static void enableHome(Context c, boolean on) {
        c.getPackageManager().setComponentEnabledSetting(home(c),
            on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
            PackageManager.DONT_KILL_APP);
    }

    static boolean isDefaultHome(Context c) {
        try {
            Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
            ResolveInfo r = c.getPackageManager().resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY);
            return r != null && r.activityInfo != null && c.getPackageName().equals(r.activityInfo.packageName)
                && HomeActivity.class.getName().equals(r.activityInfo.name);
        } catch (RuntimeException e) {
            return false;
        }
    }

    static boolean can(Context c, Intent i) {
        return i != null && c.getPackageManager().resolveActivity(i, 0) != null;
    }

    /** Opens the system's own way to pick the home app. Returns false when
     *  this TV has none (most Google TV models), so the guide is shown. */
    static boolean askForHome(Activity a, int requestCode) {
        enableHome(a, true);
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                RoleManager rm = a.getSystemService(RoleManager.class);
                if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_HOME) && !rm.isRoleHeld(RoleManager.ROLE_HOME)) {
                    Intent r = rm.createRequestRoleIntent(RoleManager.ROLE_HOME);
                    if (can(a, r)) { a.startActivityForResult(r, requestCode); return true; }
                }
            } catch (RuntimeException ignored) { /* fall through */ }
        }
        Intent s = new Intent(Settings.ACTION_HOME_SETTINGS);
        if (can(a, s)) {
            try { a.startActivity(s); return true; } catch (RuntimeException ignored) { /* fall through */ }
        }
        return false;
    }

    /** Back to the TV's own home: switching our home screen off makes Android
     *  fall back to the stock one. ViktorychTV stays as a normal app. */
    static void useStockHome(Context c) {
        enableHome(c, false);
    }
}
