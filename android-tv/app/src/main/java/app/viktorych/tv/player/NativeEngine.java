package app.viktorych.tv.player;

import android.content.Context;
import android.media.MediaPlayer;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.VideoView;

/** Plays a file or stream with Android's own player (mp4, webm, HLS, mp3...). */
final class NativeEngine implements Engine {
    private final Context ctx;
    private final Uri uri;
    private final int startMs;
    private final FrameLayout box;
    private final VideoView video;
    private MediaPlayer mp;
    private boolean muted;
    private boolean prepared;

    NativeEngine(Context c, Uri uri, int startMs) {
        this.ctx = c;
        this.uri = uri;
        this.startMs = startMs;
        box = new FrameLayout(c);
        video = new VideoView(c);
        video.setFocusable(false);
        box.addView(video, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
    }

    @Override public View view() { return box; }

    @Override public void load(Listener l) {
        video.setOnPreparedListener(p -> {
            mp = p;
            prepared = true;
            applyVolume();
            if (startMs > 0) video.seekTo(startMs);
            video.start();
            l.onReady();
        });
        video.setOnCompletionListener(p -> l.onEnded());
        video.setOnErrorListener((p, what, extra) -> { l.onError("media " + what + "/" + extra); return true; });
        video.setVideoURI(uri);
    }

    @Override public void play() { video.start(); }
    @Override public void pause() { if (video.canPause()) video.pause(); }
    @Override public boolean playing() { return video.isPlaying(); }
    @Override public long position() { return prepared ? video.getCurrentPosition() : 0; }
    @Override public long duration() { int d = prepared ? video.getDuration() : 0; return d > 0 ? d : 0; }
    @Override public int buffered() { return video.getBufferPercentage(); }
    @Override public boolean live() { return prepared && video.getDuration() <= 0; }
    @Override public void seekTo(long ms) { if (prepared && video.canSeekForward()) video.seekTo((int) Math.max(0, Math.min(ms, duration()))); }

    @Override public void setMuted(boolean m) { muted = m; applyVolume(); }

    private void applyVolume() {
        if (mp == null) return;
        try { float v = muted ? 0f : 1f; mp.setVolume(v, v); } catch (IllegalStateException ignored) { /* released */ }
    }

    @Override public void release() {
        try { video.stopPlayback(); } catch (RuntimeException ignored) { /* already gone */ }
        mp = null;
    }
}
