package app.viktorych.tv.pad;

/** Which action each button has. Start always opens our menu so it can never be lost. */
public final class PadLayout {
    private final PadAction[] map = new PadAction[PadButton.COUNT];

    public PadLayout() { reset(); }

    public static PadAction defaultFor(int button) {
        switch (button) {
            case PadButton.A: return PadAction.JUMP;
            case PadButton.B: return PadAction.CROUCH;
            case PadButton.X: return PadAction.RELOAD;
            case PadButton.Y: return PadAction.USE;
            case PadButton.LB: return PadAction.WEAPON_PREV;
            case PadButton.RB: return PadAction.WEAPON_NEXT;
            case PadButton.LT: return PadAction.AIM;
            case PadButton.RT: return PadAction.FIRE;
            case PadButton.L3: return PadAction.SPRINT;
            case PadButton.R3: return PadAction.MELEE;
            case PadButton.UP: return PadAction.BINOCULARS;
            case PadButton.DOWN: return PadAction.PRONE;
            case PadButton.LEFT: return PadAction.BUY;
            case PadButton.RIGHT: return PadAction.INSPECT;
            case PadButton.START: return PadAction.MENU;
            case PadButton.VIEW: return PadAction.SCOREBOARD;
            default: return PadAction.NONE;
        }
    }

    public void reset() { for (int i = 0; i < PadButton.COUNT; i++) map[i] = defaultFor(i); }

    public PadAction get(int button) {
        return button >= 0 && button < PadButton.COUNT ? map[button] : PadAction.NONE;
    }

    /** First button bound to an action, or -1. */
    public int buttonFor(PadAction action) {
        for (int i = 0; i < PadButton.COUNT; i++) if (map[i] == action) return i;
        return -1;
    }

    /** Binds action to button. The button's old action moves to the button that
     *  had this action, so nothing is lost. Start and the menu cannot be moved. */
    public boolean bind(int button, PadAction action) {
        if (button < 0 || button >= PadButton.COUNT || button == PadButton.START) return false;
        if (action == PadAction.MENU || action == null) return false;
        int had = buttonFor(action);
        PadAction old = map[button];
        map[button] = action;
        if (had >= 0 && had != button) map[had] = old;
        return true;
    }

    /** "A=JUMP,B=CROUCH,…" */
    public String save() {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < PadButton.COUNT; i++) {
            if (i > 0) b.append(',');
            b.append(PadButton.IDS[i]).append('=').append(map[i].name());
        }
        return b.toString();
    }

    /** Reads save(); unknown parts keep their defaults. */
    public static PadLayout load(String text) {
        PadLayout l = new PadLayout();
        if (text == null || text.isEmpty()) return l;
        for (String part : text.split(",")) {
            int eq = part.indexOf('=');
            if (eq <= 0) continue;
            int b = PadButton.byId(part.substring(0, eq).trim());
            if (b < 0 || b == PadButton.START) continue;
            try {
                PadAction a = PadAction.valueOf(part.substring(eq + 1).trim());
                if (a != PadAction.MENU) l.map[b] = a;
            } catch (IllegalArgumentException ignored) { /* an action from a newer app */ }
        }
        return l;
    }
}
