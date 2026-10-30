package app.viktorych.tv.launcher;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.TextView;

/** Colours, type and small view builders shared by the launcher screens. */
final class Ui {
    private Ui() {}

    // Google TV's dark surface palette (Material dark grey tones).
    static final int BG = 0xFF101114;
    static final int TEXT = 0xFFE8EAED;
    static final int TEXT_DIM = 0xB3E8EAED;
    static final int TEXT_ON_LIGHT = 0xFF202124;
    static final int PILL_SELECTED = 0xFF3C4043;
    static final int ROUND_BG = 0x33FFFFFF;
    static final int PANEL = 0xFF2B2E33;
    static final int PANEL_TILE = 0xFF3A3D43;
    static final int FOCUS = 0xFFFFFFFF;
    static final int ACCENT = 0xFF1D9BF0;

    static final Typeface MEDIUM = Typeface.create("sans-serif-medium", Typeface.NORMAL);
    static final Typeface REGULAR = Typeface.create("sans-serif", Typeface.NORMAL);

    static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    static TextView text(Context c, CharSequence s, float sp, int color, Typeface tf) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setTypeface(tf);
        t.setIncludeFontPadding(false);
        t.setSingleLine(true);
        return t;
    }

    static GradientDrawable round(int color, float radius) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(radius);
        return g;
    }

    static GradientDrawable oval(int color) {
        GradientDrawable g = new GradientDrawable();
        g.setShape(GradientDrawable.OVAL);
        g.setColor(color);
        return g;
    }

    /** White when focused, otherwise the given colour (pills and round buttons). */
    static StateListDrawable focusBg(Drawable focused, Drawable normal) {
        StateListDrawable s = new StateListDrawable();
        s.addState(new int[]{android.R.attr.state_focused}, focused);
        s.addState(new int[]{}, normal);
        return s;
    }

    static ImageView icon(Context c, int res, int sizeDp, int color) {
        ImageView v = new ImageView(c);
        v.setImageResource(res);
        v.setColorFilter(color);
        v.setScaleType(ImageView.ScaleType.FIT_CENTER);
        return v;
    }

    /** Round 32 dp button with a Material icon; white with a dark icon when focused (as on Google TV). */
    static RoundButton roundButton(Context c, int res, CharSequence desc) {
        RoundButton b = new RoundButton(c, res);
        b.setContentDescription(desc);
        return b;
    }

    static final class RoundButton extends ImageView {
        RoundButton(Context c, int res) {
            super(c);
            setImageResource(res);
            setScaleType(ScaleType.CENTER_INSIDE);
            int p = dp(c, 7);
            setPadding(p, p, p, p);
            setFocusable(true);
            setBackground(focusBg(oval(FOCUS), oval(ROUND_BG)));
            setColorFilter(TEXT);
            setOnFocusChangeListener((v, f) -> {
                setColorFilter(f ? TEXT_ON_LIGHT : TEXT);
                animate().scaleX(f ? 1.1f : 1f).scaleY(f ? 1.1f : 1f).setDuration(Spec.FOCUS_MS).start();
            });
        }
    }

    /** A tab pill ("Home"): grey when it is the current tab, white when focused. */
    static TextView pill(Context c, CharSequence s, boolean selected) {
        TextView t = text(c, s, 16, TEXT, MEDIUM);
        t.setGravity(Gravity.CENTER);
        t.setFocusable(true);
        int h = dp(c, 16);
        t.setPadding(h, 0, h, 0);
        float r = dp(c, Spec.PILL_H / 2f);
        t.setBackground(focusBg(round(FOCUS, r), round(selected ? PILL_SELECTED : Color.TRANSPARENT, r)));
        t.setOnFocusChangeListener((v, f) -> t.setTextColor(f ? TEXT_ON_LIGHT : TEXT));
        return t;
    }

    static void scale(View v, float s) {
        v.animate().scaleX(s).scaleY(s).setDuration(Spec.FOCUS_MS)
            .setInterpolator(new android.view.animation.DecelerateInterpolator()).start();
    }
}
