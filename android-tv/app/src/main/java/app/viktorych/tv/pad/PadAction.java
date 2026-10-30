package app.viktorych.tv.pad;

/** What a button does in a match. Keys are ReGone's default keyboard keys;
 *  fire and aim press ReGone's own touch buttons. */
public enum PadAction {
    JUMP(62), CROUCH(31), RELOAD(46), USE(33), SPRINT(59), PRONE(52), BINOCULARS(54),
    BUY(30), INSPECT(35), MELEE(8), SCOREBOARD(61), FIRE(-1), AIM(-1),
    WEAPON_NEXT(-1), WEAPON_PREV(-1), MENU(-1), NONE(-1);

    /** Android KeyEvent code sent to the game, or -1 when it is not a plain key.
     *  62 Space, 31 C, 46 R, 33 E, 59 Left Shift, 52 X, 54 Z, 30 B, 35 G, 8 "1", 61 Tab. */
    public final int key;

    PadAction(int key) { this.key = key; }

    /** Weapon slots 1 melee, 2 secondary, 3 primary, 4 tactical (KeyEvent 8..11). */
    public static final int[] SLOT_KEYS = { 8, 9, 10, 11 };
    public static final int KEY_W = 51, KEY_A = 29, KEY_S = 47, KEY_D = 32, KEY_ESCAPE = 111,
        KEY_UP = 19, KEY_DOWN = 20, KEY_LEFT = 21, KEY_RIGHT = 22, KEY_SHIFT_LEFT = 59;
}
