package app.viktorych.tv.player;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.service.dreams.DreamService;
import android.text.TextUtils;
import android.text.format.DateFormat;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.VideoView;

import java.util.Date;
import java.util.List;
import java.util.Random;

import app.viktorych.tv.R;
import app.viktorych.tv.launcher.Ui;

/** The TV screensaver: photos and short muted clips from the user's own
 *  feed with the post text, slowly zooming and fading like Google TV's
 *  ambient mode. Only runs while the TV shows its screensaver; nothing runs
 *  in the background. Off until picked in the TV's screensaver settings. */
public class FeedDream extends DreamService {
    private static final long PHOTO_MS = 12_000;
    private static final long CLIP_MAX_MS = 20_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Random random = new Random();
    private List<Playlist.Item> items;
    private int index = -1, failures;
    private ImageView[] pics;
    private int front;
    private VideoView clip;
    private TextView who, what, clock;
    private View caption;
    private final Runnable next = this::advance;
    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            clock.setText(DateFormat.getTimeFormat(FeedDream.this).format(new Date()));
            main.postDelayed(this, 15_000);
        }
    };

    private int d(float v) { return Ui.dp(this, v); }

    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);
        setFullscreen(true);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF000000);
        pics = new ImageView[]{new ImageView(this), new ImageView(this)};
        for (ImageView p : pics) {
            p.setScaleType(ImageView.ScaleType.CENTER_CROP);
            p.setAlpha(0f);
            root.addView(p, new FrameLayout.LayoutParams(-1, -1));
        }
        clip = new VideoView(this);
        clip.setVisibility(View.GONE);
        root.addView(clip, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));

        LinearLayout cap = new LinearLayout(this);
        cap.setOrientation(LinearLayout.VERTICAL);
        cap.setPadding(d(56), d(96), d(56), d(44));
        cap.setBackground(new GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, new int[]{0xB3000000, 0x00000000}));
        who = Ui.text(this, "", 15, Ui.TEXT_DIM, Ui.MEDIUM);
        what = Ui.text(this, "", 22, 0xFFFFFFFF, Ui.REGULAR);
        what.setSingleLine(false);
        what.setMaxLines(3);
        what.setEllipsize(TextUtils.TruncateAt.END);
        what.setLineSpacing(0, 1.15f);
        cap.addView(who);
        LinearLayout.LayoutParams wl = new LinearLayout.LayoutParams(d(620), -2);
        wl.topMargin = d(6);
        cap.addView(what, wl);
        caption = cap;
        root.addView(cap, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));

        clock = Ui.text(this, "", 40, 0xFFFFFFFF, Ui.REGULAR);
        clock.setShadowLayer(d(6), 0, 0, 0x99000000);
        FrameLayout.LayoutParams cl = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.END);
        cl.rightMargin = d(56); cl.bottomMargin = d(44);
        root.addView(clock, cl);
        setContentView(root);
    }

    @Override
    public void onDreamingStarted() {
        super.onDreamingStarted();
        main.post(ticker);
        items = Playlist.parse(getSharedPreferences(MediaDefaults.PREFS, Context.MODE_PRIVATE).getString("dream", ""));
        if (items.isEmpty()) { showEmpty(); return; }
        index = random.nextInt(items.size()) - 1;
        advance();
    }

    @Override
    public void onDreamingStopped() {
        main.removeCallbacksAndMessages(null);
        try { clip.stopPlayback(); } catch (RuntimeException ignored) { /* not playing */ }
        super.onDreamingStopped();
    }

    @Override
    public void onDetachedFromWindow() {
        main.removeCallbacksAndMessages(null);
        super.onDetachedFromWindow();
    }

    /** Nothing sent yet: our own colours, the clock, and how to fill it. */
    private void showEmpty() {
        ImageView p = pics[0];
        GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{0xFF0B1A2A, 0xFF1D9BF0, 0xFF101114});
        p.setImageDrawable(g);
        p.setAlpha(1f);
        who.setText(R.string.dream_label);
        what.setText(R.string.dream_empty);
        kenBurns(p);
    }

    private void advance() {
        main.removeCallbacks(next);
        if (items == null || items.isEmpty()) return;
        if (failures >= items.size()) { showEmpty(); return; }
        index = (index + 1) % items.size();
        Playlist.Item it = items.get(index);
        if (it.video) playClip(it); else loadPhoto(it);
    }

    private void loadPhoto(Playlist.Item it) {
        int side = Math.max(getResources().getDisplayMetrics().widthPixels, 1280);
        new Thread(() -> {
            Bitmap b = Img.load(it.url, side);
            main.post(() -> {
                if (b == null) { failures++; advance(); return; }
                failures = 0;
                clip.setVisibility(View.GONE);
                ImageView in = pics[1 - front], out = pics[front];
                front = 1 - front;
                in.setImageBitmap(b);
                in.animate().alpha(1f).setDuration(1200).start();
                out.animate().alpha(0f).setDuration(1200).start();
                kenBurns(in);
                caption(it);
                main.postDelayed(next, PHOTO_MS);
            });
        }, "dream-photo").start();
    }

    private void playClip(Playlist.Item it) {
        clip.setOnPreparedListener(mp -> {
            failures = 0;
            mp.setVolume(0f, 0f);
            mp.setLooping(false);
            for (ImageView p : pics) p.animate().alpha(0f).setDuration(600).start();
            clip.start();
            caption(it);
            int dur = mp.getDuration();
            main.postDelayed(next, dur > 0 ? Math.min(dur, CLIP_MAX_MS) : CLIP_MAX_MS);
        });
        clip.setOnCompletionListener(mp -> advance());
        clip.setOnErrorListener((mp, w, e) -> { failures++; clip.setVisibility(View.GONE); advance(); return true; });
        clip.setVisibility(View.VISIBLE);
        clip.setVideoURI(Uri.parse(it.url));
    }

    private void caption(Playlist.Item it) {
        who.setText(it.author);
        what.setText(it.text);
        caption.setVisibility(TextUtils.isEmpty(it.author) && TextUtils.isEmpty(it.text) ? View.GONE : View.VISIBLE);
    }

    /** Slow zoom towards a random point while the photo is up. */
    private void kenBurns(ImageView v) {
        Object old = v.getTag();
        if (old instanceof android.animation.Animator) ((android.animation.Animator) old).cancel();
        v.setPivotX(v.getWidth() * (0.2f + 0.6f * random.nextFloat()));
        v.setPivotY(v.getHeight() * (0.2f + 0.6f * random.nextFloat()));
        android.animation.ObjectAnimator a = android.animation.ObjectAnimator.ofPropertyValuesHolder(v,
            android.animation.PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.1f),
            android.animation.PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.1f));
        a.setDuration(PHOTO_MS + 1500);
        a.setInterpolator(null);
        a.start();
        v.setTag(a);
    }
}
