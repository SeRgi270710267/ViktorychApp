package app.viktorych.tv.pad;

/** Stick and trigger maths. No Android classes, so it runs in JVM unit tests. */
public final class PadMath {
    private PadMath() {}

    /** Stick dead zone (fraction of full tilt). Smaller wobble is ignored. */
    public static final float DEAD_ZONE = 0.15f;
    /** Movement keys press past this tilt and let go below RELEASE (no flicker). */
    public static final float PRESS = 0.5f;
    public static final float RELEASE = 0.35f;
    /** Triggers count as pressed past this pull. */
    public static final float TRIGGER_ON = 0.5f;
    public static final float TRIGGER_OFF = 0.35f;
    /** Look speed curve: tilt^CURVE, so small tilts aim finely. */
    public static final float CURVE = 2.0f;
    /** Look speed at full tilt and sensitivity 5, in CSS pixels per second. */
    public static final float LOOK_SPEED = 900f;
    /** Cursor speed at full tilt, in screen fractions per second. */
    public static final float CURSOR_SPEED = 0.9f;

    /** Radial dead zone: returns {x, y} rescaled so the edge of the dead zone is 0
     *  and full tilt is 1, keeping the direction. */
    public static float[] deadZone(float x, float y, float zone) {
        float m = (float) Math.sqrt(x * x + y * y);
        if (m <= zone || m == 0f) return new float[] { 0f, 0f };
        float scaled = Math.min(1f, (m - zone) / (1f - zone));
        return new float[] { x / m * scaled, y / m * scaled };
    }

    /** Speed curve on a dead-zoned stick: keeps the direction, bends the length. */
    public static float[] curve(float[] v, float power) {
        float m = (float) Math.sqrt(v[0] * v[0] + v[1] * v[1]);
        if (m == 0f) return new float[] { 0f, 0f };
        float bent = (float) Math.pow(Math.min(1f, m), power);
        return new float[] { v[0] / m * bent, v[1] / m * bent };
    }

    /** Sensitivity 1..10 to a speed factor; 5 is 1.0. */
    public static float sensitivity(int level) {
        int s = Math.max(1, Math.min(10, level));
        return s / 5f;
    }

    /** Look delta in CSS pixels for one frame. invertY flips up and down. */
    public static float[] look(float x, float y, int sensitivity, boolean invertY, float seconds) {
        float[] v = curve(deadZone(x, y, DEAD_ZONE), CURVE);
        float k = LOOK_SPEED * sensitivity(sensitivity) * Math.max(0f, Math.min(0.1f, seconds));
        return new float[] { v[0] * k, (invertY ? -v[1] : v[1]) * k };
    }

    /** A digital key from one stick axis with hysteresis. */
    public static boolean digital(float value, boolean wasOn) {
        return wasOn ? value > RELEASE : value > PRESS;
    }

    /** A trigger (0..1) as a button, with hysteresis. */
    public static boolean trigger(float value, boolean wasOn) {
        return wasOn ? value > TRIGGER_OFF : value > TRIGGER_ON;
    }

    /** Movement keys W, A, S, D from the left stick (y is down-positive). */
    public static boolean[] moveKeys(float x, float y, boolean[] was) {
        float[] v = deadZone(x, y, DEAD_ZONE);
        return new boolean[] {
            digital(-v[1], was[0]), // W
            digital(-v[0], was[1]), // A
            digital(v[1], was[2]),  // S
            digital(v[0], was[3])   // D
        };
    }

    /** ReGone's touch layout unit (CSS px): clamp(.75px, .23vh, 1px). */
    public static float unit(float cssHeight) {
        return Math.max(0.75f, Math.min(1f, cssHeight * 0.0023f));
    }

    /** Centres (CSS px) of ReGone's touch buttons from the sizes in ReGoneMobile.js,
     *  used when the page did not report a layout. Returns {x, y}. */
    public static float[] fallback(int target, float w, float h) {
        float u = unit(h);
        switch (target) {
            case PadMapper.T_FIRE: return new float[] { w - 18 - 64 * u - 44 * u, h - 24 - 92 * u - 44 * u };
            case PadMapper.T_AIM: return new float[] { w - 18 - 78 * u - 27 * u, h - 24 - 188 * u - 27 * u };
            case PadMapper.T_MENU: return new float[] { w - 130, 32 };
            case PadMapper.T_WATCH_PREV: return new float[] { w / 2 - 84, h - 42 };
            case PadMapper.T_WATCH_VIEW: return new float[] { w / 2, h - 42 };
            case PadMapper.T_WATCH_NEXT: return new float[] { w / 2 + 84, h - 42 };
            case PadMapper.T_STICK: return new float[] { 34 + 70 * u, h - 38 - 70 * u };
            default: return new float[] { w * 0.55f, h * 0.35f };
        }
    }
}
