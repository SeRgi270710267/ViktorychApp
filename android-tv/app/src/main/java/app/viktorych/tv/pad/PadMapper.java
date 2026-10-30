package app.viktorych.tv.pad;

/** Turns controller button presses into keys, touches and app actions.
 *  Pure logic: the activity does the injecting through Out. */
public final class PadMapper {
    /** Touch targets: ReGone's own on-screen buttons. */
    public static final int T_FIRE = 1, T_AIM = 2, T_MENU = 3, T_WATCH_PREV = 4, T_WATCH_VIEW = 5,
        T_WATCH_NEXT = 6, T_STICK = 7, T_LOOK = 8, T_CURSOR = 9;

    public interface Out {
        void key(int keyCode, boolean down);
        void touch(int target, boolean down);
        void overlay();
        void toggleMode();
    }

    private PadLayout layout;
    private final PadModes modes;
    /** What each held button pressed, so the release matches even if the mode changed. */
    private final Object[] held = new Object[PadButton.COUNT];
    private boolean startHeld, viewHeld, chord;
    private int slot = 2; // primary weapon

    public PadMapper(PadLayout layout, PadModes modes) {
        this.layout = layout;
        this.modes = modes;
    }

    public void setLayout(PadLayout l) { layout = l; }

    public PadLayout layout() { return layout; }

    public int slot() { return slot; }

    public void button(int b, boolean down, Out out) {
        if (b < 0 || b >= PadButton.COUNT) return;
        if (b == PadButton.START) { start(down, out); return; }
        if (b == PadButton.VIEW) {
            viewHeld = down;
            if (down && startHeld) { chord = true; out.toggleMode(); return; }
            if (!down && !startHeld) chord = false;
        }
        if (down) {
            if (held[b] != null) return;
            Object what = pressFor(b);
            if (what == null) return;
            held[b] = what;
            apply(what, true, out);
        } else {
            Object what = held[b];
            held[b] = null;
            if (what != null) apply(what, false, out);
        }
    }

    private void start(boolean down, Out out) {
        if (down) {
            startHeld = true;
            if (viewHeld) {
                chord = true;
                Object v = held[PadButton.VIEW];
                held[PadButton.VIEW] = null;
                if (v != null) apply(v, false, out);
                out.toggleMode();
            }
            return;
        }
        startHeld = false;
        if (!chord) out.overlay();
        if (!viewHeld) chord = false;
    }

    /** The controller went away: let go of everything and forget a half-pressed Start + View. */
    public void forget(Out out) {
        releaseAll(out);
        startHeld = viewHeld = chord = false;
    }

    /** Lets go of everything (mode switch, menu opened, focus lost). */
    public void releaseAll(Out out) {
        for (int i = 0; i < PadButton.COUNT; i++) {
            Object what = held[i];
            held[i] = null;
            if (what != null) apply(what, false, out);
        }
    }

    /** Key codes are Integers, touch targets are int[]{target}, weapon cycling is a PadAction. */
    Object pressFor(int b) {
        int mode = modes.current();
        if (mode == PadModes.CURSOR) {
            switch (b) {
                case PadButton.A: case PadButton.RT: return new int[] { T_CURSOR };
                case PadButton.B: return PadAction.KEY_ESCAPE;
                case PadButton.UP: return PadAction.KEY_UP;
                case PadButton.DOWN: return PadAction.KEY_DOWN;
                case PadButton.LEFT: return PadAction.KEY_LEFT;
                case PadButton.RIGHT: return PadAction.KEY_RIGHT;
                case PadButton.VIEW: return PadAction.SCOREBOARD.key;
                default: return null;
            }
        }
        if (mode == PadModes.SPECTATE) {
            switch (b) {
                case PadButton.RT: return new int[] { T_WATCH_NEXT };
                case PadButton.LT: return new int[] { T_WATCH_PREV };
                case PadButton.A: return new int[] { T_WATCH_VIEW };
                case PadButton.VIEW: return PadAction.SCOREBOARD.key;
                default: return null;
            }
        }
        PadAction a = layout.get(b);
        switch (a) {
            case FIRE: return new int[] { T_FIRE };
            case AIM: return new int[] { T_AIM };
            case WEAPON_NEXT: case WEAPON_PREV: return a;
            case NONE: case MENU: return null;
            default: return a.key;
        }
    }

    private void apply(Object what, boolean down, Out out) {
        if (what instanceof Integer) out.key((Integer) what, down);
        else if (what instanceof int[]) out.touch(((int[]) what)[0], down);
        else if (what == PadAction.WEAPON_NEXT || what == PadAction.WEAPON_PREV) {
            if (!down) return;
            int n = PadAction.SLOT_KEYS.length;
            slot = (slot + (what == PadAction.WEAPON_NEXT ? 1 : n - 1)) % n;
            out.key(PadAction.SLOT_KEYS[slot], true);
            out.key(PadAction.SLOT_KEYS[slot], false);
        }
    }
}
