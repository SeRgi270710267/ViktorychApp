package app.viktorych.tv.pad;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;

/** Outline controller glyphs drawn in the current colour (filled when active),
 *  in the same thin-stroke style as the app's X-style icons. */
public final class Glyphs {
    private Glyphs() {}

    public static void draw(Canvas c, int button, boolean ps, float cx, float cy, float size, int color, boolean active) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        p.setStyle(active ? Paint.Style.FILL_AND_STROKE : Paint.Style.STROKE);
        p.setStrokeWidth(Math.max(2f, size * 0.08f));
        p.setStrokeJoin(Paint.Join.ROUND);
        p.setStrokeCap(Paint.Cap.ROUND);
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setColor(active ? 0xFF000000 : color);
        text.setTextAlign(Paint.Align.CENTER);
        text.setFakeBoldText(true);
        float r = size / 2f;
        switch (button) {
            case PadButton.A: case PadButton.B: case PadButton.X: case PadButton.Y:
                c.drawCircle(cx, cy, r * 0.9f, p);
                if (ps) psFace(c, button, cx, cy, r * 0.45f, active ? 0xFF000000 : color, p.getStrokeWidth());
                else label(c, text, PadButton.IDS[button], cx, cy, r * 0.95f);
                return;
            case PadButton.LB: case PadButton.RB: {
                RectF box = new RectF(cx - r, cy - r * 0.5f, cx + r, cy + r * 0.5f);
                c.drawRoundRect(box, r * 0.25f, r * 0.25f, p);
                label(c, text, ps ? (button == PadButton.LB ? "L1" : "R1") : PadButton.IDS[button], cx, cy, r * 0.7f);
                return;
            }
            case PadButton.LT: case PadButton.RT: {
                Path t = new Path();
                t.moveTo(cx - r * 0.75f, cy + r * 0.8f);
                t.lineTo(cx - r * 0.75f, cy - r * 0.2f);
                t.quadTo(cx - r * 0.75f, cy - r * 0.9f, cx, cy - r * 0.9f);
                t.quadTo(cx + r * 0.75f, cy - r * 0.9f, cx + r * 0.75f, cy - r * 0.2f);
                t.lineTo(cx + r * 0.75f, cy + r * 0.8f);
                t.close();
                c.drawPath(t, p);
                label(c, text, ps ? (button == PadButton.LT ? "L2" : "R2") : PadButton.IDS[button], cx, cy + r * 0.1f, r * 0.65f);
                return;
            }
            case PadButton.L3: case PadButton.R3:
                c.drawCircle(cx, cy, r * 0.9f, p);
                Paint ring = new Paint(p);
                ring.setStyle(Paint.Style.STROKE);
                ring.setColor(active ? 0xFF000000 : color);
                c.drawCircle(cx, cy, r * 0.5f, ring);
                label(c, text, button == PadButton.L3 ? "L" : "R", cx, cy, r * 0.6f);
                return;
            case PadButton.UP: case PadButton.DOWN: case PadButton.LEFT: case PadButton.RIGHT: {
                float a = r * 0.32f;
                Path plus = new Path();
                plus.moveTo(cx - a, cy - r); plus.lineTo(cx + a, cy - r); plus.lineTo(cx + a, cy - a);
                plus.lineTo(cx + r, cy - a); plus.lineTo(cx + r, cy + a); plus.lineTo(cx + a, cy + a);
                plus.lineTo(cx + a, cy + r); plus.lineTo(cx - a, cy + r); plus.lineTo(cx - a, cy + a);
                plus.lineTo(cx - r, cy + a); plus.lineTo(cx - r, cy - a); plus.lineTo(cx - a, cy - a);
                plus.close();
                Paint outline = new Paint(p);
                outline.setStyle(Paint.Style.STROKE);
                c.drawPath(plus, outline);
                Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
                fill.setColor(color);
                float ox = button == PadButton.LEFT ? -r * 0.66f : button == PadButton.RIGHT ? r * 0.66f : 0;
                float oy = button == PadButton.UP ? -r * 0.66f : button == PadButton.DOWN ? r * 0.66f : 0;
                c.drawRect(cx + ox - a * 0.7f, cy + oy - a * 0.7f, cx + ox + a * 0.7f, cy + oy + a * 0.7f, fill);
                return;
            }
            case PadButton.START: case PadButton.VIEW: {
                RectF pill = new RectF(cx - r * 0.8f, cy - r * 0.55f, cx + r * 0.8f, cy + r * 0.55f);
                c.drawRoundRect(pill, r * 0.55f, r * 0.55f, p);
                Paint lines = new Paint(p);
                lines.setStyle(Paint.Style.STROKE);
                lines.setColor(active ? 0xFF000000 : color);
                lines.setStrokeWidth(p.getStrokeWidth() * 0.8f);
                if (button == PadButton.START) {
                    for (int i = -1; i <= 1; i++) c.drawLine(cx - r * 0.35f, cy + i * r * 0.22f, cx + r * 0.35f, cy + i * r * 0.22f, lines);
                } else {
                    c.drawRect(cx - r * 0.35f, cy - r * 0.25f, cx + r * 0.1f, cy + r * 0.12f, lines);
                    c.drawRect(cx - r * 0.1f, cy - r * 0.08f, cx + r * 0.35f, cy + r * 0.28f, lines);
                }
                return;
            }
            default:
                c.drawCircle(cx, cy, r * 0.9f, p);
        }
    }

    /** A stick glyph (left or right) with an arrow ring, for "move" and "look" hints. */
    public static void stick(Canvas c, boolean left, float cx, float cy, float size, int color) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(Math.max(2f, size * 0.08f));
        float r = size / 2f;
        c.drawCircle(cx, cy, r * 0.9f, p);
        c.drawCircle(cx, cy, r * 0.45f, p);
        Paint t = new Paint(Paint.ANTI_ALIAS_FLAG);
        t.setColor(color);
        t.setTextAlign(Paint.Align.CENTER);
        t.setFakeBoldText(true);
        label(c, t, left ? "L" : "R", cx, cy, r * 0.55f);
    }

    private static void label(Canvas c, Paint text, String s, float cx, float cy, float h) {
        text.setTextSize(h);
        Paint.FontMetrics fm = text.getFontMetrics();
        c.drawText(s, cx, cy - (fm.ascent + fm.descent) / 2f, text);
    }

    private static void psFace(Canvas c, int button, float cx, float cy, float r, int color, float stroke) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(stroke);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setStrokeJoin(Paint.Join.ROUND);
        switch (button) {
            case PadButton.A: // cross
                c.drawLine(cx - r, cy - r, cx + r, cy + r, p);
                c.drawLine(cx - r, cy + r, cx + r, cy - r, p);
                break;
            case PadButton.B: // circle
                c.drawCircle(cx, cy, r, p);
                break;
            case PadButton.X: // square
                c.drawRect(cx - r * 0.85f, cy - r * 0.85f, cx + r * 0.85f, cy + r * 0.85f, p);
                break;
            default: { // triangle
                Path t = new Path();
                t.moveTo(cx, cy - r);
                t.lineTo(cx + r, cy + r * 0.75f);
                t.lineTo(cx - r, cy + r * 0.75f);
                t.close();
                c.drawPath(t, p);
            }
        }
    }
}
