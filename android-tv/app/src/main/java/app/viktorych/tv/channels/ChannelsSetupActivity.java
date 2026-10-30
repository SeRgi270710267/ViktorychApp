package app.viktorych.tv.channels;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import app.viktorych.tv.R;
import app.viktorych.tv.launcher.Ui;

/** Adds the ViktorychMusic channel and its guide to the TV. The TV's Live
 *  Channels app opens this when someone adds our source, and the defaults
 *  screen opens it right after the row is turned on. */
public class ChannelsSetupActivity extends Activity {
    private final Handler main = new Handler(Looper.getMainLooper());
    private TextView status;
    private LinearLayout buttons;
    private int gen;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        FrameLayout disc = new FrameLayout(this);
        disc.setBackground(Ui.oval(Ui.ACCENT));
        disc.addView(Ui.icon(this, R.drawable.ch_live_tv, 44, 0xFFFFFFFF),
            new FrameLayout.LayoutParams(Ui.dp(this, 44), Ui.dp(this, 44), Gravity.CENTER));
        col.addView(disc, new LinearLayout.LayoutParams(Ui.dp(this, 88), Ui.dp(this, 88)));
        TextView title = Ui.text(this, getString(R.string.ch_setup_title), 28, Ui.TEXT, Ui.MEDIUM);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, Ui.dp(this, 24), 0, 0);
        col.addView(title);
        TextView body = Ui.text(this, getString(R.string.ch_setup_body), 16, Ui.TEXT_DIM, Ui.REGULAR);
        body.setGravity(Gravity.CENTER);
        body.setPadding(0, Ui.dp(this, 12), 0, 0);
        col.addView(body, new LinearLayout.LayoutParams(Ui.dp(this, 620), -2));
        status = Ui.text(this, getString(R.string.ch_setup_adding), 18, 0xFF8AB4F8, Ui.REGULAR);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0, Ui.dp(this, 24), 0, 0);
        col.addView(status);
        buttons = new LinearLayout(this);
        buttons.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(-2, -2);
        bl.topMargin = Ui.dp(this, 24);
        col.addView(buttons, bl);
        root.addView(col, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        setContentView(root);
        run();
    }

    private void run() {
        final int g = ++gen;
        status.setText(getString(R.string.ch_setup_adding));
        buttons.removeAllViews();
        new Thread(() -> {
            long id;
            try { id = ChannelSync.sync(getApplicationContext()); } catch (RuntimeException e) { id = -1; }
            final long done = id;
            main.post(() -> { if (g == gen && !isFinishing()) finished(done); });
        }, "tv-channels-setup").start();
    }

    private void finished(long id) {
        buttons.removeAllViews();
        if (id < 0) {
            status.setText(getString(R.string.ch_setup_failed));
            button(getString(R.string.ch_try_again), this::run).requestFocus();
            return;
        }
        setResult(RESULT_OK);
        status.setText(getString(R.string.ch_setup_done));
        button(getString(R.string.ch_watch), () -> {
            if (!ChannelsDefaults.watch(this, id)) status.setText(getString(R.string.ch_no_live_app));
            else finish();
        }).requestFocus();
        button(getString(R.string.ch_done), this::finish);
    }

    private TextView button(String label, Runnable r) {
        TextView b = Ui.pill(this, label, false);
        b.setBackground(Ui.focusBg(Ui.round(Ui.FOCUS, Ui.dp(this, 20)), Ui.round(0xFF3C4043, Ui.dp(this, 20))));
        b.setOnClickListener(v -> r.run());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, Ui.dp(this, 40));
        lp.leftMargin = Ui.dp(this, 8);
        lp.rightMargin = Ui.dp(this, 8);
        buttons.addView(b, lp);
        return b;
    }

    @Override
    protected void onDestroy() {
        gen++;
        main.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
