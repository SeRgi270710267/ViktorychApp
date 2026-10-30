package app.viktorych.tv.player;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import app.viktorych.tv.R;
import app.viktorych.tv.launcher.Ui;

/** ViktorychTV Player: one look for YouTube, X, Twitch and plain video or
 *  music links. Red progress bar like YouTube, round X-style buttons, and
 *  the post's text on top. Switched off until the user turns it on in
 *  "Make ViktorychTV your default", and Android still asks which app to use.
 *
 *  Remote: OK plays or pauses, left/right jump 10 seconds, up/down show the
 *  controls, Back hides them and then leaves. Media keys work too. */
public class PlayerActivity extends Activity implements Engine.Listener {
    private static final long HIDE_MS = 4000;
    private static final long STEP_MS = 10_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private Engine engine;
    private Links.Target target;
    private FrameLayout stage;
    private ImageView photo;
    private View chrome, top, bottom;
    private TextView source, author, body, now, total, live;
    private Scrubber scrubber;
    private Ui.RoundButton playBtn, muteBtn;
    private ProgressBar spinner;
    private boolean muted, ended, showing;
    private AudioManager audio;
    private String link;
    private final AudioManager.OnAudioFocusChangeListener focus = change -> {
        if (change == AudioManager.AUDIOFOCUS_LOSS && engine != null) { engine.pause(); showChrome(); }
    };
    private final Runnable tick = new Runnable() {
        @Override public void run() { update(); main.postDelayed(this, 250); }
    };
    private final Runnable hide = this::hideChrome;

    private int d(float v) { return Ui.dp(this, v); }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        Intent i = getIntent();
        Uri data = i.getData();
        String url = data != null ? data.toString() : i.getStringExtra(Intent.EXTRA_TEXT);
        target = Links.parse(url, i.getType());
        link = url;
        if (target.kind == Links.Kind.NONE) {
            // A page on one of these sites that is not a video (a channel list,
            // a profile...): give it to the browser instead.
            openElsewhere();
            return;
        }
        build();
        audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audio != null) audio.requestAudioFocus(focus, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        start();
    }

    private void build() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF000000);
        stage = new FrameLayout(this);
        root.addView(stage, new FrameLayout.LayoutParams(-1, -1));
        photo = new ImageView(this);
        photo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        photo.setVisibility(View.GONE);
        root.addView(photo, new FrameLayout.LayoutParams(-1, -1));
        spinner = new ProgressBar(this);
        root.addView(spinner, new FrameLayout.LayoutParams(d(48), d(48), Gravity.CENTER));

        FrameLayout ch = new FrameLayout(this);
        chrome = ch;

        // Top: where it is from, who posted it, and what they wrote.
        LinearLayout t = new LinearLayout(this);
        t.setOrientation(LinearLayout.VERTICAL);
        t.setPadding(d(48), d(32), d(48), d(48));
        t.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[]{0xCC000000, 0x00000000}));
        source = Ui.text(this, "", 12, 0xFFFFFFFF, Ui.MEDIUM);
        source.setPadding(d(8), d(3), d(8), d(3));
        source.setBackground(Ui.round(sourceColor(), d(4)));
        t.addView(source, new LinearLayout.LayoutParams(-2, -2));
        author = Ui.text(this, "", 16, Ui.TEXT, Ui.MEDIUM);
        LinearLayout.LayoutParams al = new LinearLayout.LayoutParams(-1, -2);
        al.topMargin = d(12);
        t.addView(author, al);
        body = Ui.text(this, "", 20, 0xFFFFFFFF, Ui.REGULAR);
        body.setSingleLine(false);
        body.setMaxLines(4);
        body.setEllipsize(TextUtils.TruncateAt.END);
        body.setLineSpacing(0, 1.15f);
        LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(d(640), -2);
        bl.topMargin = d(6);
        t.addView(body, bl);
        top = t;
        ch.addView(t, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));

        // Bottom: time, red bar, length, then the round buttons.
        LinearLayout bt = new LinearLayout(this);
        bt.setOrientation(LinearLayout.VERTICAL);
        bt.setPadding(d(48), d(56), d(48), d(28));
        bt.setBackground(new GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, new int[]{0xE6000000, 0x00000000}));
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        now = Ui.text(this, "0:00", 14, 0xFFFFFFFF, Ui.MEDIUM);
        bar.addView(now, new LinearLayout.LayoutParams(d(64), -2));
        live = Ui.text(this, getString(R.string.mp_live), 12, 0xFFFFFFFF, Ui.MEDIUM);
        live.setPadding(d(6), d(2), d(6), d(2));
        live.setBackground(Ui.round(Scrubber.RED, d(3)));
        live.setVisibility(View.GONE);
        bar.addView(live, new LinearLayout.LayoutParams(-2, -2));
        scrubber = new Scrubber(this);
        scrubber.setContentDescription(getString(R.string.mp_seek));
        bar.addView(scrubber, new LinearLayout.LayoutParams(0, d(24), 1f));
        total = Ui.text(this, "0:00", 14, Ui.TEXT_DIM, Ui.MEDIUM);
        total.setGravity(Gravity.END);
        bar.addView(total, new LinearLayout.LayoutParams(d(64), -2));
        bt.addView(bar, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        Ui.RoundButton back = button(R.drawable.mp_rewind, R.string.mp_rewind, 44);
        back.setOnClickListener(v -> seekBy(-STEP_MS));
        playBtn = button(R.drawable.mp_pause, R.string.mp_pause, 56);
        playBtn.setOnClickListener(v -> toggle());
        Ui.RoundButton fwd = button(R.drawable.mp_forward, R.string.mp_forward, 44);
        fwd.setOnClickListener(v -> seekBy(STEP_MS));
        muteBtn = button(R.drawable.mp_volume, R.string.mp_mute, 44);
        muteBtn.setOnClickListener(v -> toggleMute());
        View spacer = new View(this);
        row.addView(spacer, new LinearLayout.LayoutParams(d(44 + 16), 1));
        row.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1f));
        row.addView(back, sized(44));
        row.addView(playBtn, sized(56));
        row.addView(fwd, sized(44));
        row.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1f));
        row.addView(muteBtn, sized(44));
        LinearLayout.LayoutParams rl = new LinearLayout.LayoutParams(-1, -2);
        rl.topMargin = d(14);
        bt.addView(row, rl);
        bottom = bt;
        ch.addView(bt, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
        root.addView(ch, new FrameLayout.LayoutParams(-1, -1));

        source.setText(sourceName());
        setContentView(root);
        playBtn.requestFocus();
        showChrome();
    }

    private Ui.RoundButton button(int icon, int desc, int size) {
        Ui.RoundButton b = Ui.roundButton(this, icon, getString(desc));
        int p = d(size >= 56 ? 14 : 10);
        b.setPadding(p, p, p, p);
        return b;
    }

    private LinearLayout.LayoutParams sized(int size) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(d(size), d(size));
        lp.leftMargin = d(8); lp.rightMargin = d(8);
        return lp;
    }

    private String sourceName() {
        switch (target.kind) {
            case YOUTUBE: return target.music ? "YouTube Music" : "YouTube";
            case X_POST: return "X";
            case TWITCH_CHANNEL:
            case TWITCH_VIDEO: return "Twitch";
            default: return getString(target.music ? R.string.mp_music : R.string.mp_video);
        }
    }

    private int sourceColor() {
        switch (target.kind) {
            case YOUTUBE: return Scrubber.RED;
            case X_POST: return 0xFF2F3336;
            case TWITCH_CHANNEL:
            case TWITCH_VIDEO: return 0xFF9146FF;
            default: return 0xFF3C4043;
        }
    }

    private void start() {
        switch (target.kind) {
            case YOUTUBE:
            case TWITCH_CHANNEL:
            case TWITCH_VIDEO:
                if (target.kind != Links.Kind.YOUTUBE) author.setText(target.kind == Links.Kind.TWITCH_CHANNEL ? target.id : "");
                attach(new WebEngine(this, target));
                break;
            case X_POST:
                new Thread(() -> {
                    XPost p = XPost.fetch(target.id);
                    Bitmap pic = p != null && p.videoUrl == null ? Img.load(p.photoUrl, 1920) : null;
                    main.post(() -> onXPost(p, pic));
                }, "x-post").start();
                break;
            default:
                Uri u = Uri.parse(target.id);
                String name = u.getLastPathSegment();
                body.setText(name == null ? "" : name);
                if (target.music) showMusicArt();
                attach(new NativeEngine(this, u, target.startSec * 1000));
        }
    }

    private void onXPost(XPost p, Bitmap pic) {
        if (isFinishing()) return;
        if (p == null || (p.videoUrl == null && pic == null)) {
            if (p != null && !TextUtils.isEmpty(p.text)) {
                // A text-only post: show it, there is nothing to play.
                spinner.setVisibility(View.GONE);
                author.setText(p.author);
                body.setMaxLines(12);
                body.setText(p.text);
                bottom.setVisibility(View.GONE);
                return;
            }
            onError("x");
            return;
        }
        author.setText(p.author);
        body.setText(p.text);
        if (p.videoUrl != null) {
            attach(new NativeEngine(this, Uri.parse(p.videoUrl), 0));
        } else {
            spinner.setVisibility(View.GONE);
            photo.setImageBitmap(pic);
            photo.setVisibility(View.VISIBLE);
            bottom.setVisibility(View.GONE);
            main.removeCallbacks(hide);
        }
    }

    private void showMusicArt() {
        LinearLayout art = new LinearLayout(this);
        art.setOrientation(LinearLayout.VERTICAL);
        art.setGravity(Gravity.CENTER);
        FrameLayout sq = new FrameLayout(this);
        sq.setBackground(new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{0xFF3A1C71, 0xFFD76D77}));
        ((GradientDrawable) sq.getBackground()).setCornerRadius(d(16));
        sq.addView(Ui.icon(this, R.drawable.mp_play_circle, 72, 0xFFFFFFFF), new FrameLayout.LayoutParams(d(72), d(72), Gravity.CENTER));
        art.addView(sq, new LinearLayout.LayoutParams(d(220), d(220)));
        stage.addView(art, new FrameLayout.LayoutParams(-1, -1));
    }

    private void attach(Engine e) {
        engine = e;
        stage.addView(e.view(), 0, new FrameLayout.LayoutParams(-1, -1));
        e.load(this);
        main.post(tick);
    }

    @Override public void onReady() {
        spinner.setVisibility(View.GONE);
        if (muted) engine.setMuted(true);
        showChrome();
    }

    @Override public void onEnded() {
        ended = true;
        showChrome();
        main.removeCallbacks(hide);
    }

    @Override public void onError(String why) {
        Toast.makeText(this, target.kind == Links.Kind.X_POST ? R.string.mp_x_failed : R.string.mp_error, Toast.LENGTH_LONG).show();
        openElsewhere();
    }

    /** Opens the link in the TV's browser (never back in this player), then closes. */
    private void openElsewhere() {
        if (link != null && (link.startsWith("https://") || link.startsWith("http://"))) {
            try {
                Intent v = new Intent(Intent.ACTION_VIEW, Uri.parse(link));
                v.addCategory(Intent.CATEGORY_BROWSABLE);
                v.setSelector(Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER));
                startActivity(v);
            } catch (RuntimeException e) {
                Toast.makeText(this, R.string.mp_error, Toast.LENGTH_LONG).show();
            }
        } else {
            Toast.makeText(this, R.string.mp_error, Toast.LENGTH_LONG).show();
        }
        finish();
    }

    private void update() {
        if (engine == null) return;
        boolean isLive = engine.live();
        long pos = engine.position(), dur = engine.duration();
        live.setVisibility(isLive ? View.VISIBLE : View.GONE);
        now.setVisibility(isLive ? View.GONE : View.VISIBLE);
        total.setVisibility(isLive ? View.INVISIBLE : View.VISIBLE);
        scrubber.setVisibility(isLive ? View.INVISIBLE : View.VISIBLE);
        now.setText(Links.clock(pos));
        total.setText(Links.clock(dur));
        scrubber.set(pos, dur, engine.buffered());
        boolean p = engine.playing();
        playBtn.setImageResource(p ? R.drawable.mp_pause : R.drawable.mp_play);
        playBtn.setContentDescription(getString(p ? R.string.mp_pause : R.string.mp_play));
        if (engine instanceof WebEngine && target.kind == Links.Kind.YOUTUBE && body.getText().length() == 0) {
            String t = ((WebEngine) engine).title();
            if (!TextUtils.isEmpty(t)) body.setText(t);
        }
    }

    private void toggle() {
        if (engine == null) return;
        if (ended) { ended = false; engine.seekTo(0); engine.play(); }
        else if (engine.playing()) engine.pause();
        else engine.play();
        update();
        showChrome();
    }

    private void seekBy(long ms) {
        if (engine == null || engine.live()) return;
        engine.seekTo(engine.position() + ms);
        update();
        showChrome();
    }

    private void toggleMute() {
        muted = !muted;
        if (engine != null) engine.setMuted(muted);
        muteBtn.setImageResource(muted ? R.drawable.mp_volume_off : R.drawable.mp_volume);
        muteBtn.setContentDescription(getString(muted ? R.string.mp_unmute : R.string.mp_mute));
        showChrome();
    }

    private void showChrome() {
        showing = true;
        chrome.animate().alpha(1f).setDuration(150).start();
        main.removeCallbacks(hide);
        if (engine != null && engine.playing() && !ended) main.postDelayed(hide, HIDE_MS);
    }

    private void hideChrome() {
        if (engine == null || !engine.playing() || bottom.getVisibility() != View.VISIBLE) return;
        showing = false;
        chrome.animate().alpha(0f).setDuration(250).start();
        playBtn.requestFocus();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (e.getAction() != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(e);
        int k = e.getKeyCode();
        switch (k) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK: toggle(); return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY: if (engine != null) engine.play(); showChrome(); return true;
            case KeyEvent.KEYCODE_MEDIA_PAUSE: if (engine != null) engine.pause(); showChrome(); return true;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: seekBy(STEP_MS); return true;
            case KeyEvent.KEYCODE_MEDIA_REWIND: seekBy(-STEP_MS); return true;
            case KeyEvent.KEYCODE_MEDIA_STOP: finish(); return true;
            case KeyEvent.KEYCODE_BACK:
                if (showing && engine != null && engine.playing()) { hideChrome(); return true; }
                return super.dispatchKeyEvent(e);
            default: break;
        }
        boolean dpad = k == KeyEvent.KEYCODE_DPAD_LEFT || k == KeyEvent.KEYCODE_DPAD_RIGHT || k == KeyEvent.KEYCODE_DPAD_UP
            || k == KeyEvent.KEYCODE_DPAD_DOWN || k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER;
        if (!dpad) return super.dispatchKeyEvent(e);
        if (!showing) {
            // Hidden controls: the remote works the video directly.
            if (k == KeyEvent.KEYCODE_DPAD_LEFT) { seekBy(-STEP_MS); return true; }
            if (k == KeyEvent.KEYCODE_DPAD_RIGHT) { seekBy(STEP_MS); return true; }
            if (k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER) { toggle(); return true; }
            showChrome();
            playBtn.requestFocus();
            return true;
        }
        showChrome();
        if (scrubber.isFocused() && (k == KeyEvent.KEYCODE_DPAD_LEFT || k == KeyEvent.KEYCODE_DPAD_RIGHT)) {
            // Holding the button jumps further the longer it is held.
            long step = STEP_MS * (1 + Math.min(5, e.getRepeatCount() / 4));
            seekBy(k == KeyEvent.KEYCODE_DPAD_LEFT ? -step : step);
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (engine != null) engine.pause();
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        if (engine != null) engine.release();
        if (audio != null) audio.abandonAudioFocus(focus);
        super.onDestroy();
    }
}
