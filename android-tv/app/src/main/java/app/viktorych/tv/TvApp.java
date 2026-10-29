package app.viktorych.tv;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;

/** Keeps the right home-screen entry on and puts the chosen in-app title on every task. */
public class TvApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        Names.sync(this);
        registerActivityLifecycleCallbacks(new ActivityLifecycleCallbacks() {
            @Override public void onActivityCreated(Activity a, Bundle b) { Names.label(a); }
            @Override public void onActivityStarted(Activity a) {}
            @Override public void onActivityResumed(Activity a) { Names.label(a); }
            @Override public void onActivityPaused(Activity a) {}
            @Override public void onActivityStopped(Activity a) {}
            @Override public void onActivitySaveInstanceState(Activity a, Bundle b) {}
            @Override public void onActivityDestroyed(Activity a) {}
        });
    }
}
