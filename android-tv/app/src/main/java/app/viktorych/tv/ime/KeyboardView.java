package app.viktorych.tv.ime;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;
import android.view.View;

import java.util.List;

import app.viktorych.tv.R;
import app.viktorych.tv.launcher.Ui;

/** Draws the keys and the remote's highlight. One view, so moving the
 *  highlight is instant and the remote never loses focus to a stray key. */
public final class KeyboardView extends View {
    private static final int KEY = 0xFF3C4043;
    private static final int KEY_SPECIAL = 0xFF2B2E33;
    private static final int PANEL_BG = 0xFF202124;

    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint label = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF r = new RectF();
    private final float gap, radius, rowH, pad;
    private List<List<KeyLayout.Key>> rows;
    private int row, col;
    private boolean shift;
    private String enterLabel = "";
    private final Drawable shiftIcon, deleteIcon, voiceIcon, emojiIcon, enterIcon;

    public KeyboardView(Context c) {
        super(c);
        gap = Ui.dp(c, 6);
        radius = Ui.dp(c, 8);
        rowH = Ui.dp(c, 42);
        pad = Ui.dp(c, 12);
        label.setTypeface(Ui.MEDIUM);
        label.setTextAlign(Paint.Align.CENTER);
        shiftIcon = c.getDrawable(R.drawable.kb_shift);
        deleteIcon = c.getDrawable(R.drawable.kb_backspace);
        voiceIcon = c.getDrawable(R.drawable.kb_mic);
        emojiIcon = c.getDrawable(R.drawable.kb_emoji);
        enterIcon = c.getDrawable(R.drawable.kb_enter);
        setBackgroundColor(PANEL_BG);
        setFocusable(false);
    }

    public void setRows(List<List<KeyLayout.Key>> rows, boolean shift) {
        this.rows = rows;
        this.shift = shift;
        if (row >= rows.size()) row = rows.size() - 1;
        if (col >= rows.get(row).size()) col = rows.get(row).size() - 1;
        requestLayout();
        invalidate();
    }

    public void setEnterLabel(String s) { enterLabel = s == null ? "" : s; invalidate(); }

    public int row() { return row; }
    public int col() { return col; }
    public void select(int r, int c) { row = r; col = c; invalidate(); }
    public KeyLayout.Key current() { return rows.get(row).get(col); }
    public List<List<KeyLayout.Key>> rows() { return rows; }

    @Override
    protected void onMeasure(int w, int h) {
        int n = rows == null ? 5 : rows.size();
        int height = (int) (pad * 2 + n * rowH + (n - 1) * gap);
        setMeasuredDimension(MeasureSpec.getSize(w), height);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        if (rows == null) return;
        // Keep the keys to a comfortable width on a wide TV, centred like Gboard.
        float maxW = Ui.dp(getContext(), 760);
        float width = Math.min(getWidth() - pad * 2, maxW);
        float left = (getWidth() - width) / 2f;
        for (int i = 0; i < rows.size(); i++) {
            List<KeyLayout.Key> keys = rows.get(i);
            float top = pad + i * (rowH + gap);
            for (int j = 0; j < keys.size(); j++) {
                KeyLayout.Key k = keys.get(j);
                boolean focused = i == row && j == col;
                r.set(left + k.x * width + gap / 2, top, left + (k.x + k.w) * width - gap / 2, top + rowH);
                boolean special = k.code != KeyLayout.Code.TEXT && k.code != KeyLayout.Code.SPACE;
                boolean active = k.code == KeyLayout.Code.SHIFT && shift;
                fill.setColor(focused ? Ui.FOCUS : active ? Ui.ACCENT : special ? KEY_SPECIAL : KEY);
                canvas.drawRoundRect(r, radius, radius, fill);
                int fg = focused ? Ui.TEXT_ON_LIGHT : Ui.TEXT;
                Drawable icon = iconFor(k);
                if (icon != null && !(k.code == KeyLayout.Code.ENTER && !enterLabel.isEmpty())) {
                    int s = (int) (rowH * 0.55f);
                    int cx = (int) r.centerX(), cy = (int) r.centerY();
                    icon.setBounds(cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2);
                    icon.setTint(fg);
                    icon.draw(canvas);
                    continue;
                }
                String t = k.code == KeyLayout.Code.ENTER ? enterLabel : k.code == KeyLayout.Code.SPACE ? "" : k.text;
                boolean emoji = k.code == KeyLayout.Code.TEXT && Character.isSurrogate(t.isEmpty() ? 'a' : t.charAt(0));
                label.setTextSize(Ui.dp(getContext(), emoji ? 22 : special ? 15 : 19));
                label.setColor(fg);
                Paint.FontMetrics fm = label.getFontMetrics();
                canvas.drawText(t, r.centerX(), r.centerY() - (fm.ascent + fm.descent) / 2, label);
            }
        }
    }

    private Drawable iconFor(KeyLayout.Key k) {
        switch (k.code) {
            case SHIFT: return shiftIcon;
            case DELETE: return deleteIcon;
            case VOICE: return voiceIcon;
            case EMOJI: return emojiIcon;
            case ENTER: return enterIcon;
            default: return null;
        }
    }
}
