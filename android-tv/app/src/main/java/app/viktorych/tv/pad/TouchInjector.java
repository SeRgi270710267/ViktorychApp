package app.viktorych.tv.pad;

import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;

/** Multi-finger touches sent straight into our own WebView. They arrive in the
 *  page as real (trusted) touch and pointer events, which ReGone accepts. */
public final class TouchInjector {
    private final LinkedHashMap<Integer, float[]> down = new LinkedHashMap<>();
    private long downTime;
    private View target;

    public void target(View v) {
        if (v != target) cancel();
        target = v;
    }

    public boolean isDown(int id) { return down.containsKey(id); }

    public float[] where(int id) { return down.get(id); }

    public void press(int id, float x, float y) {
        if (down.containsKey(id)) { move(id, x, y); return; }
        down.put(id, new float[] { x, y });
        if (down.size() == 1) {
            downTime = SystemClock.uptimeMillis();
            send(MotionEvent.ACTION_DOWN);
        } else {
            send(MotionEvent.ACTION_POINTER_DOWN | (index(id) << MotionEvent.ACTION_POINTER_INDEX_SHIFT));
        }
    }

    public void move(int id, float x, float y) {
        float[] p = down.get(id);
        if (p == null) return;
        p[0] = x;
        p[1] = y;
        send(MotionEvent.ACTION_MOVE);
    }

    public void release(int id) {
        if (!down.containsKey(id)) return;
        if (down.size() == 1) send(MotionEvent.ACTION_UP);
        else send(MotionEvent.ACTION_POINTER_UP | (index(id) << MotionEvent.ACTION_POINTER_INDEX_SHIFT));
        down.remove(id);
    }

    /** Lifts every finger (menu opened, app paused). */
    public void cancel() {
        if (down.isEmpty()) return;
        send(MotionEvent.ACTION_CANCEL);
        down.clear();
    }

    private int index(int id) {
        int i = 0;
        for (Integer k : down.keySet()) { if (k == id) return i; i++; }
        return 0;
    }

    private void send(int action) {
        if (target == null || down.isEmpty()) return;
        int n = down.size();
        MotionEvent.PointerProperties[] props = new MotionEvent.PointerProperties[n];
        MotionEvent.PointerCoords[] coords = new MotionEvent.PointerCoords[n];
        int i = 0;
        for (Map.Entry<Integer, float[]> e : new ArrayList<>(down.entrySet())) {
            MotionEvent.PointerProperties p = new MotionEvent.PointerProperties();
            p.id = e.getKey();
            p.toolType = MotionEvent.TOOL_TYPE_FINGER;
            props[i] = p;
            MotionEvent.PointerCoords c = new MotionEvent.PointerCoords();
            c.x = e.getValue()[0];
            c.y = e.getValue()[1];
            c.pressure = 1f;
            c.size = 0.05f;
            coords[i] = c;
            i++;
        }
        MotionEvent ev = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, n, props, coords,
            0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
        target.dispatchTouchEvent(ev);
        ev.recycle();
    }
}
