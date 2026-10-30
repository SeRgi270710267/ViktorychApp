package app.viktorych.tv.player;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;

import app.viktorych.tv.launcher.Ui;

/** The progress bar: grey track, lighter buffered part, red played part
 *  and a red dot, which grows when the bar has focus (left/right seek). */
final class Scrubber extends View {
    static final int RED = 0xFFFF0000;
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF r = new RectF();
    private long pos, dur;
    private int buf;

    Scrubber(Context c) {
        super(c);
        setFocusable(true);
    }

    void set(long pos, long dur, int buffered) {
        this.pos = pos; this.dur = dur; this.buf = buffered;
        invalidate();
    }

    @Override protected void onFocusChanged(boolean f, int dir, android.graphics.Rect prev) {
        super.onFocusChanged(f, dir, prev);
        invalidate();
    }

    @Override protected void onDraw(Canvas c) {
        float h = Ui.dp(getContext(), isFocused() ? 6 : 4);
        float cy = getHeight() / 2f;
        float w = getWidth();
        float rad = h / 2;
        float played = dur > 0 ? Math.min(1f, pos / (float) dur) : 0f;
        r.set(0, cy - h / 2, w, cy + h / 2);
        p.setColor(0x4DFFFFFF);
        c.drawRoundRect(r, rad, rad, p);
        if (buf > 0) {
            r.set(0, cy - h / 2, w * Math.min(100, buf) / 100f, cy + h / 2);
            p.setColor(0x80FFFFFF);
            c.drawRoundRect(r, rad, rad, p);
        }
        r.set(0, cy - h / 2, w * played, cy + h / 2);
        p.setColor(RED);
        c.drawRoundRect(r, rad, rad, p);
        float dot = Ui.dp(getContext(), isFocused() ? 9 : 6);
        c.drawCircle(Math.max(dot, Math.min(w - dot, w * played)), cy, dot, p);
    }
}
