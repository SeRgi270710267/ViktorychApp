package app.viktorych.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Runs right after this app is updated (normal or custom build), so the
 *  home screen shows the right name without opening the app first. */
public class Replaced extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        if (i != null && Intent.ACTION_MY_PACKAGE_REPLACED.equals(i.getAction())) Names.sync(c);
    }
}
