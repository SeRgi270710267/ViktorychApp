package app.viktorych.tv.launcher;

/** Sizes of the "Apps only" home screen, in dp on a 960 x 540 dp TV screen
 *  (1080p TVs run at xhdpi). Measured from 1080p captures of the current
 *  Google TV Apps only home: 5 banner tiles a row, 16:9, a pill tab bar with
 *  the profile picture on the left and round buttons on the right. */
public final class Spec {
    private Spec() {}

    public static final int SCREEN_W = 960, SCREEN_H = 540;
    public static final int EDGE = 58;              // left and right content margin
    public static final int BAR_TOP = 34;           // top of the tab pills
    public static final int PILL_H = 40;
    public static final int AVATAR = 32;
    public static final int AVATAR_GAP = 13;        // profile picture to first pill
    public static final int ROUND = 32;             // round buttons on the right
    public static final int ROUND_GAP = 12;

    public static final int COLS = 5;
    public static final int TILE_W = 150, TILE_H = 84; // 16:9 banner (Android TV banner is 320 x 180 px)
    public static final int GAP_X = 22;
    public static final int ROW_PITCH = 137;        // top of one row to the next
    public static final int RADIUS = 7;
    public static final float FOCUS_SCALE = 1.15f;
    public static final int FOCUS_MS = 150;

    public static final int HERO_H = 470;           // highlight area above "Your apps"
    public static final int LABEL_GAP = 24;         // "Your apps" label above the first row
    public static final int GRID_TOP_SCROLLED = 120; // where the focused row sits once scrolled
    public static final int PANEL_W = 271;          // quick settings panel

    /** x of column c, so 5 columns fill 960 - 2 * 58 (= 844) dp. */
    public static int colX(int c) { return EDGE + c * (TILE_W + GAP_X); }

    public static int rowY(int r) { return r * ROW_PITCH; }

    public static int rows(int count) { return (count + COLS - 1) / COLS; }

    /** Grid width: 5 * 150 + 4 * 22 = 838 dp, which centres in the 844 dp body. */
    public static int gridWidth() { return COLS * TILE_W + (COLS - 1) * GAP_X; }
}
