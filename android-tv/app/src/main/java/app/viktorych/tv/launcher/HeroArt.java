package app.viktorych.tv.launcher;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.view.View;

/** The highlight artwork behind the hero, drawn in code (our own art, no
 *  third-party images): soft colour light on the right with a big "V" mark,
 *  fading into the background on the left and bottom like Google TV's hero. */
final class HeroArt extends View {
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path v = new Path();

    HeroArt(Context c) { super(c); }

    @Override
    protected void onDraw(Canvas c) {
        int w = getWidth(), h = getHeight();
        if (w == 0 || h == 0) return;
        c.drawColor(Ui.BG);
        blob(c, w * 0.72f, h * 0.38f, h * 0.75f, 0xAA1D9BF0);
        blob(c, w * 0.92f, h * 0.15f, h * 0.55f, 0x997B3FE4);
        blob(c, w * 0.60f, h * 0.80f, h * 0.50f, 0x66F91880);
        // The "V" mark.
        float s = h * 0.62f, cx = w * 0.74f, top = h * 0.16f;
        v.reset();
        v.moveTo(cx - s * 0.50f, top);
        v.lineTo(cx - s * 0.22f, top);
        v.lineTo(cx, top + s * 0.70f);
        v.lineTo(cx + s * 0.22f, top);
        v.lineTo(cx + s * 0.50f, top);
        v.lineTo(cx + s * 0.13f, top + s);
        v.lineTo(cx - s * 0.13f, top + s);
        v.close();
        p.setShader(null);
        p.setColor(0xF2FFFFFF);
        c.drawPath(v, p);
        // Fade into the page: left to right, then bottom.
        p.setShader(new LinearGradient(0, 0, w * 0.62f, 0, new int[]{Ui.BG, Ui.BG, 0x00101114}, new float[]{0f, 0.45f, 1f}, Shader.TileMode.CLAMP));
        c.drawRect(0, 0, w, h, p);
        p.setShader(new LinearGradient(0, h * 0.55f, 0, h, 0x00101114, Ui.BG, Shader.TileMode.CLAMP));
        c.drawRect(0, 0, w, h, p);
        p.setShader(new LinearGradient(0, 0, 0, h * 0.22f, 0x99101114, 0x00101114, Shader.TileMode.CLAMP));
        c.drawRect(0, 0, w, h, p);
        p.setShader(null);
    }

    private void blob(Canvas c, float x, float y, float r, int color) {
        p.setShader(new RadialGradient(x, y, r, color, color & 0x00FFFFFF, Shader.TileMode.CLAMP));
        c.drawCircle(x, y, r, p);
    }
}
