package app.viktorych.tv.alerts;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.FrameLayout;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import app.viktorych.tv.BuildConfig;
import app.viktorych.tv.R;
import app.viktorych.tv.launcher.Ui;
import app.viktorych.tv.player.MediaDefaults;

/** Cast: links sent from a phone signed in to the same account open here. It uses
 *  this TV's own link (the same one as Alerts) and our account server, no Chromecast.
 *  It only checks for a cast while it is on screen, every few seconds, and pauses
 *  by itself after half an hour without one. */
public final class CastActivity extends AlertsActivity {
    private static final long IDLE_MS = 30 * 60_000L;
    private static final ExecutorService NET = Executors.newSingleThreadExecutor();

    private TextView state, last;
    private long every = 4000, idleSince;
    private boolean listening;

    @Override protected int linkIcon() { return R.drawable.al_cast; }
    @Override protected int linkTitle() { return R.string.cs_link_title; }
    @Override protected int linkNote() { return R.string.cs_link_note; }

    @Override
    protected void showLinked() {
        root.removeAllViews();
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(d(80), d(56), d(80), d(32));
        col.addView(Ui.icon(this, R.drawable.al_cast, 48, Ui.TEXT), new LinearLayout.LayoutParams(d(48), d(48)));
        TextView title = Ui.text(this, getString(R.string.cs_ready), 30, Ui.TEXT, Ui.REGULAR);
        title.setPadding(0, d(16), 0, 0);
        col.addView(title);
        TextView who = Ui.text(this, getString(R.string.cs_linked, Session.accountName(this)), 15, Ui.TEXT_DIM, Ui.REGULAR);
        who.setPadding(0, d(6), 0, 0);
        col.addView(who);
        TextView steps = Ui.text(this, getString(R.string.cs_steps), 18, Ui.TEXT, Ui.REGULAR);
        steps.setSingleLine(false);
        steps.setPadding(0, d(24), 0, 0);
        col.addView(steps);
        state = Ui.text(this, getString(R.string.cs_waiting), 16, 0xFF8AB4F8, Ui.REGULAR);
        state.setSingleLine(false);
        state.setPadding(0, d(24), 0, 0);
        col.addView(state);
        last = Ui.text(this, "", 14, Ui.TEXT_DIM, Ui.REGULAR);
        last.setPadding(0, d(8), 0, 0);
        col.addView(last);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        TextView done = Ui.pill(this, getString(R.string.cs_done), false);
        done.setOnClickListener(v -> finish());
        buttons.addView(done, new LinearLayout.LayoutParams(-2, d(40)));
        TextView out = Ui.pill(this, getString(R.string.cs_sign_out), false);
        out.setOnClickListener(v -> {
            listening = false;
            Session.unlink(this);
            gen++;
            main.removeCallbacksAndMessages(null);
            showLink();
        });
        LinearLayout.LayoutParams op = new LinearLayout.LayoutParams(-2, d(40));
        op.leftMargin = d(12);
        buttons.addView(out, op);
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-2, -2);
        bp.topMargin = d(28);
        col.addView(buttons, bp);
        TextView note = Ui.text(this, getString(R.string.cs_note), 13, Ui.TEXT_DIM, Ui.REGULAR);
        note.setSingleLine(false);
        note.setPadding(0, d(24), 0, 0);
        col.addView(note);
        root.addView(col, new FrameLayout.LayoutParams(-1, -1));
        done.requestFocus();
        idleSince = System.currentTimeMillis();
        listening = true;
        check();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (listening) Session.castStop(this);
        listening = false;
    }

    private void later() {
        final int g = gen;
        main.postDelayed(() -> { if (g == gen && visible && listening) check(); }, every);
    }

    private void check() {
        if (System.currentTimeMillis() - idleSince > IDLE_MS) { pause(); return; }
        final int g = gen;
        NET.execute(() -> {
            int st = -1;
            String body = "";
            try {
                Session.Reply r = Session.castNext(this);
                st = r.status;
                body = r.body;
            } catch (IOException | RuntimeException e) { st = -1; }
            final int fst = st;
            final String fb = body;
            main.post(() -> {
                if (g != gen || !visible || !listening) return;
                if (fst == 401) { listening = false; showLink(); return; }
                if (fst == 200) {
                    every = CastModel.intervalMs(fb);
                    CastModel.Item item = CastModel.item(fb);
                    if (item != null) { open(item); return; }
                    state.setText(R.string.cs_waiting);
                } else {
                    state.setText(fst == 429 ? R.string.al_busy : R.string.al_offline);
                    every = 15000;
                }
                later();
            });
        });
    }

    private void pause() {
        listening = false;
        Session.castStop(this);
        state.setText(R.string.cs_paused);
        TextView again = Ui.pill(this, getString(R.string.cs_keep), false);
        again.setOnClickListener(v -> { gen++; showLinked(); });
        ((LinearLayout) state.getParent()).addView(again, ((LinearLayout) state.getParent()).indexOfChild(last) + 1, new LinearLayout.LayoutParams(-2, d(40)));
        again.requestFocus();
    }

    private void open(CastModel.Item item) {
        idleSince = System.currentTimeMillis();
        String label = item.title.isEmpty() ? CastModel.host(item.url) : item.title;
        CastModel.Kind kind = CastModel.kind(item.url, BuildConfig.START_URL);
        if (kind == CastModel.Kind.NONE) {
            state.setText(getString(R.string.cs_refused, CastModel.host(item.url)));
            later();
            return;
        }
        last.setText(getString(R.string.cs_last, label));
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(item.url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (kind == CastModel.Kind.SITE) i.setClassName(this, "app.viktorych.tv.TvLauncherActivity");
        else if (MediaDefaults.enabled(this, MediaDefaults.player(this))) i.setComponent(MediaDefaults.player(this));
        try {
            state.setText(getString(R.string.cs_opening, label));
            startActivity(i);
        } catch (ActivityNotFoundException | SecurityException e) {
            state.setText(R.string.cs_no_player);
            later();
        }
    }
}
