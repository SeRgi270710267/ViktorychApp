package app.viktorych.tv.channels;

import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.tv.TvContract;

/** The optional Live channels input: on or off from the defaults screen. Off
 *  also takes our channel out of the TV's channel list. */
public final class ChannelsDefaults {
    private ChannelsDefaults() {}

    static ComponentName[] parts(Context c) {
        return new ComponentName[] {
            new ComponentName(c, LoopInputService.class),
            new ComponentName(c, ChannelsSetupActivity.class),
        };
    }

    public static boolean enabled(Context c) {
        return c.getPackageManager().getComponentEnabledSetting(parts(c)[0]) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    public static void enable(Context c, boolean on) {
        Context app = c.getApplicationContext();
        if (!on) new Thread(() -> ChannelSync.clear(app), "tv-channels-clear").start();
        for (ComponentName p : parts(c)) {
            c.getPackageManager().setComponentEnabledSetting(p,
                on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
                PackageManager.DONT_KILL_APP);
        }
    }

    /** Opens our setup screen, which adds the channel and its guide. */
    public static void setup(Context c) {
        if (enabled(c)) c.startActivity(new Intent(c, ChannelsSetupActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    /** Opens the TV's own Live Channels app on our channel. False when this TV has none. */
    public static boolean watch(Context c, long channelId) {
        if (channelId < 0) return false;
        try {
            c.startActivity(new Intent(Intent.ACTION_VIEW, TvContract.buildChannelUri(channelId)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }
}
