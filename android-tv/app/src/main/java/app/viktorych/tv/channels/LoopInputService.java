package app.viktorych.tv.channels;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.tv.TvInputManager;
import android.media.tv.TvInputService;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.Surface;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import app.viktorych.tv.R;
import app.viktorych.tv.launcher.Ui;

/** The ViktorychMusic loop as a channel in the TV's own Live Channels app and
 *  guide. Android binds it only while someone watches the channel, so it plays
 *  only then; it does nothing in the background. Ships turned off. */
public class LoopInputService extends TvInputService {
    @Override
    public Session onCreateSession(String inputId) {
        return new LoopSession(this);
    }

    static final class LoopSession extends Session {
        private final Context ctx;
        private final Handler main = new Handler(Looper.getMainLooper());
        private MediaPlayer player;
        private float volume = 1f;
        private int gen;
        private LoopModel.Station station;
        private long tunedAt;
        private TextView state;
        private TextView clock;

        LoopSession(Context c) {
            super(c);
            ctx = c;
            setOverlayViewEnabled(true);
        }

        @Override
        public View onCreateOverlayView() {
            FrameLayout root = new FrameLayout(ctx);
            GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[] {0xFF0B1A2A, 0xFF101114});
            root.setBackground(bg);
            LinearLayout col = new LinearLayout(ctx);
            col.setOrientation(LinearLayout.VERTICAL);
            col.setGravity(Gravity.CENTER_HORIZONTAL);
            FrameLayout disc = new FrameLayout(ctx);
            disc.setBackground(Ui.oval(Ui.ACCENT));
            disc.addView(Ui.icon(ctx, R.drawable.ch_radio, 64, 0xFFFFFFFF),
                new FrameLayout.LayoutParams(Ui.dp(ctx, 64), Ui.dp(ctx, 64), Gravity.CENTER));
            col.addView(disc, new LinearLayout.LayoutParams(Ui.dp(ctx, 140), Ui.dp(ctx, 140)));
            TextView name = Ui.text(ctx, ctx.getString(R.string.ch_station), 34, Ui.TEXT, Ui.MEDIUM);
            name.setPadding(0, Ui.dp(ctx, 24), 0, 0);
            col.addView(name);
            TextView live = Ui.text(ctx, ctx.getString(R.string.ch_live_chip), 13, 0xFFFFFFFF, Ui.MEDIUM);
            live.setBackground(Ui.round(0xFFE0245E, Ui.dp(ctx, 6)));
            live.setPadding(Ui.dp(ctx, 10), Ui.dp(ctx, 3), Ui.dp(ctx, 10), Ui.dp(ctx, 3));
            LinearLayout.LayoutParams ll = new LinearLayout.LayoutParams(-2, -2);
            ll.topMargin = Ui.dp(ctx, 12);
            col.addView(live, ll);
            state = Ui.text(ctx, ctx.getString(R.string.ch_tuning), 18, Ui.TEXT_DIM, Ui.REGULAR);
            state.setGravity(Gravity.CENTER);
            state.setPadding(0, Ui.dp(ctx, 18), 0, 0);
            col.addView(state);
            clock = Ui.text(ctx, "", 16, Ui.TEXT_DIM, Ui.REGULAR);
            clock.setPadding(0, Ui.dp(ctx, 8), 0, 0);
            col.addView(clock);
            root.addView(col, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
            return root;
        }

        @Override
        public boolean onSetSurface(Surface surface) {
            // Sound only: nothing is drawn on the video surface.
            return true;
        }

        @Override
        public void onSetStreamVolume(float v) {
            volume = v;
            if (player != null) player.setVolume(v, v);
        }

        @Override
        public void onSetCaptionEnabled(boolean enabled) { }

        @Override
        public boolean onTune(Uri channelUri) {
            stop();
            final int g = ++gen;
            notifyVideoUnavailable(TvInputManager.VIDEO_UNAVAILABLE_REASON_TUNING);
            show(ctx.getString(R.string.ch_tuning));
            new Thread(() -> {
                LoopModel.Station s = ChannelSync.station();
                try { ChannelSync.sync(ctx); } catch (RuntimeException e) { /* the guide waits for next time */ }
                main.post(() -> { if (g == gen) start(s, g); });
            }, "tv-channels-tune").start();
            return true;
        }

        private void start(LoopModel.Station s, int g) {
            if (s == null) {
                notifyVideoUnavailable(TvInputManager.VIDEO_UNAVAILABLE_REASON_UNKNOWN);
                show(ctx.getString(R.string.ch_offline));
                return;
            }
            station = s;
            MediaPlayer mp = new MediaPlayer();
            player = mp;
            try {
                mp.setAudioStreamType(AudioManager.STREAM_MUSIC);
                mp.setDataSource(s.url);
            } catch (Exception e) {
                failed(g);
                return;
            }
            mp.setVolume(volume, volume);
            mp.setOnPreparedListener(p -> {
                if (g != gen) return;
                // Join the loop where the site is, counting the time it took to get here.
                tunedAt = SystemClock.elapsedRealtime();
                int at = (int) (s.position(System.currentTimeMillis()) * 1000);
                if (at > 1000) p.seekTo(at);
                p.start();
                notifyVideoUnavailable(Build.VERSION.SDK_INT >= 24 ? 4 /* AUDIO_ONLY */ : TvInputManager.VIDEO_UNAVAILABLE_REASON_UNKNOWN);
                show(ctx.getString(R.string.ch_playing));
                tick(g);
            });
            mp.setOnCompletionListener(p -> { if (g == gen) onTune(null); });
            mp.setOnErrorListener((p, what, extra) -> { failed(g); return true; });
            mp.prepareAsync();
        }

        private void failed(int g) {
            if (g != gen) return;
            stop();
            notifyVideoUnavailable(TvInputManager.VIDEO_UNAVAILABLE_REASON_UNKNOWN);
            show(ctx.getString(R.string.ch_offline));
        }

        private void tick(int g) {
            if (g != gen || player == null || station == null) return;
            try {
                if (clock != null) clock.setText(LoopModel.clock(player.getCurrentPosition() / 1000.0) + " / " + LoopModel.clock(station.duration));
            } catch (IllegalStateException ignored) { }
            main.postDelayed(() -> tick(g), 1000);
        }

        private void show(String s) {
            if (state != null) state.setText(s);
            if (clock != null && !ctx.getString(R.string.ch_playing).equals(s)) clock.setText("");
        }

        private void stop() {
            gen++;
            main.removeCallbacksAndMessages(null);
            if (player != null) {
                try { player.release(); } catch (RuntimeException ignored) { }
                player = null;
            }
        }

        @Override
        public void onRelease() {
            stop();
        }
    }
}
