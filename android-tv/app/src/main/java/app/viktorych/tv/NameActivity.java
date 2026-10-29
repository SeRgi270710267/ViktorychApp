package app.viktorych.tv;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

/** viktorychtv://name?preset=media&title=Living%20room from the site. */
public class NameActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Uri uri = getIntent() != null ? getIntent().getData() : null;
        if (uri != null) {
            String preset = uri.getQueryParameter("preset");
            String title = uri.getQueryParameter("title");
            Names.apply(this, preset, title);
            Toast.makeText(this, R.string.name_saved, Toast.LENGTH_SHORT).show();
        }
        finish();
    }
}
