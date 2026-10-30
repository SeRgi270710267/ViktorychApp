package app.viktorych.tv.launcher;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.List;

/** One 16:9 banner tile. On focus the card grows 15 %, gets a white edge and
 *  a soft glow, and the app name shows under it, as on Google TV. */
@SuppressLint("ViewConstructor")
final class Tile extends FrameLayout {
    final FrameLayout card;
    final TextView label;
    String key;
    boolean folder;
    boolean lifted;     // Move mode

    Tile(Context c) {
        super(c);
        setFocusable(true);
        setClipChildren(false);
        setClipToPadding(false);
        int w = Ui.dp(c, Spec.TILE_W), h = Ui.dp(c, Spec.TILE_H);
        card = new FrameLayout(c);
        GradientDrawable bg = Ui.round(Ui.PANEL_TILE, Ui.dp(c, Spec.RADIUS));
        card.setBackground(bg);
        card.setClipToOutline(true);
        card.setPivotX(w / 2f);
        card.setPivotY(h / 2f);
        addView(card, new LayoutParams(w, h));
        label = Ui.text(c, "", 12, Ui.TEXT, Ui.REGULAR);
        label.setGravity(Gravity.CENTER_HORIZONTAL);
        label.setEllipsize(TextUtils.TruncateAt.END);
        label.setAlpha(0f);
        LayoutParams lp = new LayoutParams(w + Ui.dp(c, 20), LayoutParams.WRAP_CONTENT);
        lp.topMargin = h + Ui.dp(c, 12);
        lp.leftMargin = -Ui.dp(c, 10);
        addView(label, lp);
        setOnFocusChangeListener((v, f) -> focus(f));
    }

    void focus(boolean f) {
        Context c = getContext();
        Ui.scale(card, f ? Spec.FOCUS_SCALE : 1f);
        label.animate().alpha(f ? 1f : 0f).setDuration(Spec.FOCUS_MS).start();
        GradientDrawable edge = new GradientDrawable();
        edge.setCornerRadius(Ui.dp(c, Spec.RADIUS));
        edge.setColor(0);
        if (f || lifted) edge.setStroke(Ui.dp(c, 2), lifted ? Ui.ACCENT : 0xD9FFFFFF);
        card.setForeground(edge);
        card.setElevation(f ? Ui.dp(c, 10) : 0);
        if (Build.VERSION.SDK_INT >= 28) {
            card.setOutlineAmbientShadowColor(0xCCFFFFFF);
            card.setOutlineSpotShadowColor(0xCCFFFFFF);
        }
        setZ(f ? 1f : 0f);
    }

    void setLifted(boolean on) {
        lifted = on;
        focus(hasFocus() || isFocused());
    }

    /** An app: its banner fills the card; an app without one shows its icon and name. */
    void bindApp(Apps.App a) {
        key = a.key;
        folder = false;
        card.removeAllViews();
        label.setText(a.label);
        setContentDescription(a.label);
        Context c = getContext();
        if (a.banner != null) {
            ImageView iv = new ImageView(c);
            iv.setImageDrawable(a.banner);
            iv.setScaleType(ImageView.ScaleType.FIT_XY);
            card.addView(iv, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        } else {
            LinearLayout col = new LinearLayout(c);
            col.setOrientation(LinearLayout.VERTICAL);
            col.setGravity(Gravity.CENTER);
            ImageView iv = new ImageView(c);
            iv.setImageDrawable(a.icon);
            col.addView(iv, new LinearLayout.LayoutParams(Ui.dp(c, 36), Ui.dp(c, 36)));
            TextView t = Ui.text(c, a.label, 12, Ui.TEXT, Ui.MEDIUM);
            t.setEllipsize(TextUtils.TruncateAt.END);
            t.setPadding(Ui.dp(c, 8), Ui.dp(c, 6), Ui.dp(c, 8), 0);
            col.addView(t);
            card.addView(col, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        }
    }

    /** A folder: the same size as an app, with up to four of its banners in a 2 x 2 grid. */
    void bindFolder(LauncherModel.Entry f, List<Drawable> art, CharSequence name) {
        key = f.key;
        folder = true;
        card.removeAllViews();
        label.setText(name);
        setContentDescription(name);
        Context c = getContext();
        int pad = Ui.dp(c, 6), gap = Ui.dp(c, 4);
        int cw = (Ui.dp(c, Spec.TILE_W) - 2 * pad - gap) / 2;
        int ch = (Ui.dp(c, Spec.TILE_H) - 2 * pad - gap) / 2;
        for (int i = 0; i < 4; i++) {
            View cell;
            if (i < art.size() && art.get(i) != null) {
                ImageView iv = new ImageView(c);
                iv.setImageDrawable(art.get(i));
                iv.setScaleType(ImageView.ScaleType.FIT_XY);
                iv.setBackground(Ui.round(0xFF4A4D53, Ui.dp(c, 3)));
                iv.setClipToOutline(true);
                cell = iv;
            } else {
                cell = new View(c);
                cell.setBackground(Ui.round(0xFF44474D, Ui.dp(c, 3)));
            }
            LayoutParams lp = new LayoutParams(cw, ch);
            lp.leftMargin = pad + (i % 2) * (cw + gap);
            lp.topMargin = pad + (i / 2) * (ch + gap);
            card.addView(cell, lp);
        }
    }
}
