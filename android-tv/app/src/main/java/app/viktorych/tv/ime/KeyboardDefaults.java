package app.viktorych.tv.ime;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.Settings;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;

/** On/off for the remote keyboard. It ships switched off in the manifest;
 *  "off" puts it back to exactly that state. */
public final class KeyboardDefaults {
    private KeyboardDefaults() {}

    public static ComponentName keyboard(Context c) { return new ComponentName(c, TvKeyboard.class); }

    public static boolean enabled(Context c) {
        return c.getPackageManager().getComponentEnabledSetting(keyboard(c)) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    public static void enable(Context c, boolean on) {
        c.getPackageManager().setComponentEnabledSetting(keyboard(c),
            on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
            PackageManager.DONT_KILL_APP);
    }

    /** True when the TV lists our keyboard as one you can pick. */
    public static boolean allowedBySystem(Context c) {
        try {
            InputMethodManager imm = (InputMethodManager) c.getSystemService(Context.INPUT_METHOD_SERVICE);
            for (InputMethodInfo i : imm.getEnabledInputMethodList()) {
                if (i.getComponent().equals(keyboard(c))) return true;
            }
        } catch (RuntimeException ignored) { }
        return false;
    }

    /** True when our keyboard is the one the TV uses. */
    public static boolean isDefault(Context c) {
        try {
            String id = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.DEFAULT_INPUT_METHOD);
            ComponentName n = id == null ? null : ComponentName.unflattenFromString(id);
            return keyboard(c).equals(n);
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** Next step towards using it: the TV's keyboard list first, then the picker. */
    public static void nextStep(Context c) {
        if (!allowedBySystem(c)) {
            Intent i = new Intent(Settings.ACTION_INPUT_METHOD_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { c.startActivity(i); return; } catch (RuntimeException ignored) { /* fall through */ }
        }
        showPicker(c);
    }

    public static void showPicker(Context c) {
        try {
            ((InputMethodManager) c.getSystemService(Context.INPUT_METHOD_SERVICE)).showInputMethodPicker();
        } catch (RuntimeException ignored) { }
    }

    public static void openKeyboardSettings(Context c) {
        try {
            c.startActivity(new Intent(Settings.ACTION_INPUT_METHOD_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (RuntimeException ignored) { }
    }
}
