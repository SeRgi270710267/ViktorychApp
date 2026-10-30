package app.viktorych.tv.search;

import android.app.Activity;
import android.app.SearchManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

import app.viktorych.tv.R;
import app.viktorych.tv.launcher.Ui;

/** Feed search. A search from the TV's own search, a suggestion, or this
 *  screen opens the app's Explore search for it. */
public final class SearchActivity extends Activity {
    private static final int REQ_VOICE = 7;
    private EditText field;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (handle(getIntent())) { finish(); return; }
        build();
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (handle(i)) finish();
    }

    /** True when the intent already carries a search to run. */
    private boolean handle(Intent i) {
        if (i == null) return false;
        String q = null;
        if (Intent.ACTION_SEARCH.equals(i.getAction())) {
            q = i.getStringExtra(SearchManager.QUERY);
            if (q == null) q = i.getStringExtra(SearchManager.EXTRA_DATA_KEY);
        } else if ("com.google.android.gms.actions.SEARCH_ACTION".equals(i.getAction())) {
            q = i.getStringExtra(SearchManager.QUERY);
        }
        q = SearchLinks.clean(q);
        if (q.isEmpty()) return false;
        try { SearchDefaults.openSite(this, q); } catch (RuntimeException ignored) { }
        return true;
    }

    private int d(float v) { return Ui.dp(this, v); }

    private void build() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(d(80), d(56), d(80), d(40));
        root.addView(col, new FrameLayout.LayoutParams(-1, -1));

        TextView title = Ui.text(this, getString(R.string.srch_title), 28, Ui.TEXT, Ui.REGULAR);
        col.addView(title);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(-1, d(56));
        bl.topMargin = d(24);
        col.addView(bar, bl);

        boolean voice = !getPackageManager().queryIntentActivities(
            new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH), PackageManager.MATCH_DEFAULT_ONLY).isEmpty();
        if (voice) {
            Ui.RoundButton mic = Ui.roundButton(this, R.drawable.kb_mic, getString(R.string.srch_voice));
            mic.setOnClickListener(v -> voice());
            LinearLayout.LayoutParams ml = new LinearLayout.LayoutParams(d(48), d(48));
            ml.rightMargin = d(16);
            bar.addView(mic, ml);
        }

        field = new EditText(this);
        field.setSingleLine(true);
        field.setHint(R.string.srch_hint);
        field.setHintTextColor(Ui.TEXT_DIM);
        field.setTextColor(Ui.TEXT);
        field.setTextSize(18);
        field.setInputType(InputType.TYPE_CLASS_TEXT);
        field.setImeOptions(EditorInfo.IME_ACTION_SEARCH | EditorInfo.IME_FLAG_NO_EXTRACT_UI | EditorInfo.IME_FLAG_NO_FULLSCREEN);
        field.setPadding(d(24), 0, d(24), 0);
        GradientDrawable focused = Ui.round(0xFF3C4043, d(28));
        focused.setStroke(d(2), Ui.FOCUS);
        field.setBackground(Ui.focusBg(focused, Ui.round(0xFF2B2E33, d(28))));
        field.setOnEditorActionListener((v, action, ev) -> {
            boolean go = action == EditorInfo.IME_ACTION_SEARCH
                || (ev != null && ev.getKeyCode() == KeyEvent.KEYCODE_ENTER && ev.getAction() == KeyEvent.ACTION_UP);
            if (go) run(field.getText().toString());
            return go;
        });
        bar.addView(field, new LinearLayout.LayoutParams(0, -1, 1f));

        Ui.RoundButton go = Ui.roundButton(this, R.drawable.kb_find, getString(R.string.kb_search));
        go.setOnClickListener(v -> run(field.getText().toString()));
        LinearLayout.LayoutParams gl = new LinearLayout.LayoutParams(d(48), d(48));
        gl.leftMargin = d(16);
        bar.addView(go, gl);

        List<String> recent = SearchLinks.parse(SearchDefaults.recent(this));
        if (!recent.isEmpty()) {
            TextView h = Ui.text(this, getString(R.string.srch_recent), 14, Ui.TEXT_DIM, Ui.MEDIUM);
            LinearLayout.LayoutParams hl = new LinearLayout.LayoutParams(-2, -2);
            hl.topMargin = d(32);
            col.addView(h, hl);
            HorizontalScrollView hs = new HorizontalScrollView(this);
            hs.setHorizontalScrollBarEnabled(false);
            hs.setClipToPadding(false);
            LinearLayout pills = new LinearLayout(this);
            pills.setPadding(0, d(12), 0, d(12));
            hs.addView(pills);
            List<String> all = new ArrayList<>(recent);
            for (String q : all) {
                TextView p = Ui.pill(this, q, false);
                p.setOnClickListener(v -> run(q));
                LinearLayout.LayoutParams pl = new LinearLayout.LayoutParams(-2, d(40));
                pl.rightMargin = d(12);
                pills.addView(p, pl);
            }
            TextView clear = Ui.pill(this, getString(R.string.srch_clear), false);
            clear.setOnClickListener(v -> { SearchDefaults.clearRecent(this); recreate(); });
            pills.addView(clear, new LinearLayout.LayoutParams(-2, d(40)));
            col.addView(hs, new LinearLayout.LayoutParams(-1, -2));
        }

        TextView note = Ui.text(this, getString(R.string.srch_note), 13, Ui.TEXT_DIM, Ui.REGULAR);
        note.setSingleLine(false);
        LinearLayout.LayoutParams nl = new LinearLayout.LayoutParams(-1, -2);
        nl.topMargin = d(24);
        col.addView(note, nl);

        setContentView(root);
        field.requestFocus();
        field.post(() -> {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(field, InputMethodManager.SHOW_IMPLICIT);
        });
    }

    private void run(String q) {
        if (SearchLinks.clean(q).isEmpty()) return;
        try { SearchDefaults.openSite(this, q); } catch (RuntimeException ignored) { }
        finish();
    }

    private void voice() {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_WEB_SEARCH)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try { startActivityForResult(i, REQ_VOICE); } catch (ActivityNotFoundException ignored) { }
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        if (req != REQ_VOICE || result != RESULT_OK || data == null) return;
        ArrayList<String> heard = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (heard != null && !heard.isEmpty()) {
            field.setText(heard.get(0));
            run(heard.get(0));
        }
    }
}
