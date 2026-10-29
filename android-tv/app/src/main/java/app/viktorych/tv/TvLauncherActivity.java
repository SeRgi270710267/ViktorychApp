package app.viktorych.tv;

import android.content.Intent;
import android.net.Uri;

import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.androidbrowserhelper.trusted.TwaLauncher;

/** Opens the site in Chrome as a Trusted Web Activity, or in TvWebActivity
 *  when there is no Chrome. Tells the site what this install is. */
public class TvLauncherActivity extends LauncherActivity {
    @Override
    protected Uri getLaunchingUrl() {
        Uri base = super.getLaunchingUrl();
        return withAppInfo(this, base);
    }

    static Uri withAppInfo(android.content.Context c, Uri base) {
        if (base == null) base = Uri.parse(BuildConfig.START_URL);
        if (!BuildConfig.APP_HOST.equals(base.getHost())) return base;
        String frag = base.getEncodedFragment();
        Uri.Builder b = base.buildUpon().fragment(null);
        if (base.getQueryParameter("tvapp") == null) b.appendQueryParameter("tvapp", String.valueOf(BuildConfig.VERSION_CODE));
        if (base.getQueryParameter("src") == null) b.appendQueryParameter("src", "tvapp");
        if (BuildConfig.CUSTOM) {
            // The site keeps these so "Update" can rebuild with the same name.
            b.appendQueryParameter("tvlabel", BuildConfig.CUSTOM_LABEL);
            b.appendQueryParameter("tvicon", BuildConfig.CUSTOM_ICON);
        }
        b.appendQueryParameter("tvpreset", Names.preset(c));
        Uri out = b.build();
        return frag != null ? out.buildUpon().encodedFragment(frag).build() : out;
    }

    @Override
    protected TwaLauncher.FallbackStrategy getFallbackStrategy() {
        return (context, builder, providerPackage, done) -> {
            Intent i = new Intent(context, TvWebActivity.class);
            i.setData(builder.getUri());
            context.startActivity(i);
            if (done != null) done.run();
        };
    }
}
