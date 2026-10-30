package app.viktorych.tv.pad;

/** Controller buttons in one order, with Android key codes (values copied
 *  from android.view.KeyEvent so this stays plain Java). */
public final class PadButton {
    private PadButton() {}

    public static final int A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7,
        L3 = 8, R3 = 9, UP = 10, DOWN = 11, LEFT = 12, RIGHT = 13, START = 14, VIEW = 15;
    public static final int COUNT = 16;
    public static final String[] IDS = { "A", "B", "X", "Y", "LB", "RB", "LT", "RT", "L3", "R3", "UP", "DOWN", "LEFT", "RIGHT", "START", "VIEW" };
    public static final String[] XBOX = { "A", "B", "X", "Y", "LB", "RB", "LT", "RT", "LS", "RS", "D-pad up", "D-pad down", "D-pad left", "D-pad right", "Menu", "View" };
    public static final String[] PLAYSTATION = { "Cross", "Circle", "Square", "Triangle", "L1", "R1", "L2", "R2", "L3", "R3", "D-pad up", "D-pad down", "D-pad left", "D-pad right", "Options", "Create" };

    /** KeyEvent codes for gamepad buttons. */
    static final int KEYCODE_DPAD_UP = 19, KEYCODE_DPAD_DOWN = 20, KEYCODE_DPAD_LEFT = 21, KEYCODE_DPAD_RIGHT = 22,
        KEYCODE_BUTTON_A = 96, KEYCODE_BUTTON_B = 97, KEYCODE_BUTTON_X = 99, KEYCODE_BUTTON_Y = 100,
        KEYCODE_BUTTON_L1 = 102, KEYCODE_BUTTON_R1 = 103, KEYCODE_BUTTON_L2 = 104, KEYCODE_BUTTON_R2 = 105,
        KEYCODE_BUTTON_THUMBL = 106, KEYCODE_BUTTON_THUMBR = 107, KEYCODE_BUTTON_START = 108, KEYCODE_BUTTON_SELECT = 109,
        KEYCODE_BACK = 4;

    /** Our button for an Android gamepad key code, or -1. Back from a controller is View. */
    public static int fromKeyCode(int code) {
        switch (code) {
            case KEYCODE_BUTTON_A: return A;
            case KEYCODE_BUTTON_B: return B;
            case KEYCODE_BUTTON_X: return X;
            case KEYCODE_BUTTON_Y: return Y;
            case KEYCODE_BUTTON_L1: return LB;
            case KEYCODE_BUTTON_R1: return RB;
            case KEYCODE_BUTTON_L2: return LT;
            case KEYCODE_BUTTON_R2: return RT;
            case KEYCODE_BUTTON_THUMBL: return L3;
            case KEYCODE_BUTTON_THUMBR: return R3;
            case KEYCODE_DPAD_UP: return UP;
            case KEYCODE_DPAD_DOWN: return DOWN;
            case KEYCODE_DPAD_LEFT: return LEFT;
            case KEYCODE_DPAD_RIGHT: return RIGHT;
            case KEYCODE_BUTTON_START: return START;
            case KEYCODE_BUTTON_SELECT: return VIEW;
            case KEYCODE_BACK: return VIEW;
            default: return -1;
        }
    }

    public static int byId(String id) {
        for (int i = 0; i < COUNT; i++) if (IDS[i].equals(id)) return i;
        return -1;
    }

    /** True for PlayStation pads: Sony's USB vendor id or a Sony-style name. */
    public static boolean playstation(String name, int vendorId) {
        if (vendorId == 0x054C) return true;
        String n = name == null ? "" : name.toLowerCase(java.util.Locale.ROOT);
        return n.contains("sony") || n.contains("playstation") || n.contains("dualsense") || n.contains("dualshock") || n.contains("ps4") || n.contains("ps5") || n.equals("wireless controller");
    }
}
