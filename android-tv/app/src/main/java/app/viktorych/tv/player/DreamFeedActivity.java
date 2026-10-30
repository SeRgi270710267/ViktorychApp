package app.viktorych.tv.player;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

import java.util.List;

import app.viktorych.tv.R;
import app.viktorych.tv.launcher.DefaultsActivity;

/** viktorychtv://dream?d=...: the site hands over photos and clips from the
 *  user's own feed for the screensaver. Saved on this TV only. If the
 *  screensaver is not on yet, the defaults screen opens so it can be. */
public class DreamFeedActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Uri u = getIntent().getData();
        if (u != null && "dream".equals(u.getHost())) {
            if (u.getQueryParameter("clear") != null) {
                getSharedPreferences(MediaDefaults.PREFS, Context.MODE_PRIVATE).edit().remove("dream").apply();
                Toast.makeText(this, R.string.dream_cleared, Toast.LENGTH_SHORT).show();
            } else {
                List<Playlist.Item> items = Playlist.parse(u.getQueryParameter("d"));
                if (!items.isEmpty()) {
                    getSharedPreferences(MediaDefaults.PREFS, Context.MODE_PRIVATE).edit()
                        .putString("dream", Playlist.write(items)).apply();
                    Toast.makeText(this, getResources().getQuantityString(R.plurals.dream_saved, items.size(), items.size()), Toast.LENGTH_LONG).show();
                    if (!MediaDefaults.enabled(this, MediaDefaults.dream(this))) {
                        startActivity(new Intent(this, DefaultsActivity.class).putExtra("focus", "dream"));
                    }
                }
            }
        }
        finish();
    }
}
