package app.viktorych.tv.pad;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;

import java.util.ArrayList;
import java.util.List;

/** The control hints strip along the bottom, and the menu cursor. */
public final class HintView extends View {
    /** One hint: a button (or -1 left stick, -2 right stick) and its label. */
    public static final class Hint {
        final int button;
        final String label;
        public Hint(int button, String label) { this.button = button; this.label = label; }
    }

    private final List<Hint> hints = new ArrayList<>();
    private boolean ps;
    private boolean showHints;
    private boolean showCursor;
    private float cursorX, cursorY;
    private boolean cursorDown;
    private final float dp;
    private final Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);

    public HintView(Context c) {
        super(c);
        dp = c.getResources().getDisplayMetrics().density;
        bg.setColor(0xB3000000);
        text.setColor(0xFFE7E9EA);
        text.setTextSize(13 * dp);
        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeWidth(2.5f * dp);
        ring.setColor(0xFFFFFFFF);
        setWillNotDraw(false);
        setFocusable(false);
        setClickable(false);
    }

    public void hints(List<Hint> list, boolean playstation) {
        hints.clear();
        hints.addAll(list);
        ps = playstation;
        invalidate();
    }

    public void showHints(boolean on) { showHints = on; invalidate(); }

    public boolean hintsShown() { return showHints; }

    public void cursor(boolean on, float x, float y, boolean pressed) {
        showCursor = on;
        cursorX = x;
        cursorY = y;
        cursorDown = pressed;
        invalidate();
    }

    @Override
    protected void onDraw(Canvas c) {
        if (showCursor) {
            Paint shadow = new Paint(ring);
            shadow.setColor(0x99000000);
            shadow.setStrokeWidth(5 * dp);
            c.drawCircle(cursorX, cursorY, 11 * dp, shadow);
            c.drawCircle(cursorX, cursorY, 11 * dp, ring);
            Paint dot = new Paint(Paint.ANTI_ALIAS_FLAG);
            dot.setColor(0xFFFFFFFF);
            c.drawCircle(cursorX, cursorY, (cursorDown ? 7 : 2.5f) * dp, dot);
        }
        if (!showHints || hints.isEmpty()) return;
        float g = 22 * dp, gap = 8 * dp, pad = 14 * dp, sep = 18 * dp;
        float total = pad * 2;
        for (Hint h : hints) total += g + gap + text.measureText(h.label) + sep;
        total -= sep;
        float x = Math.max(8 * dp, (getWidth() - total) / 2f);
        float h = 40 * dp;
        float y = getHeight() - h - 20 * dp;
        c.drawRoundRect(new RectF(x, y, x + total, y + h), h / 2, h / 2, bg);
        x += pad;
        float cy = y + h / 2;
        Paint.FontMetrics fm = text.getFontMetrics();
        for (Hint hint : hints) {
            if (hint.button == -1 || hint.button == -2) Glyphs.stick(c, hint.button == -1, x + g / 2, cy, g, 0xFFE7E9EA);
            else Glyphs.draw(c, hint.button, ps, x + g / 2, cy, g, 0xFFE7E9EA, false);
            x += g + gap;
            c.drawText(hint.label, x, cy - (fm.ascent + fm.descent) / 2f, text);
            x += text.measureText(hint.label) + sep;
        }
    }
}
