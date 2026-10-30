package app.viktorych.tv.pad;

/** Play (in a match), cursor (menus) or spectate. Follows ReGone's own touch
 *  controller mode when the page reports it (0 menu, 2 match, 3 spectating);
 *  Start + View switches by hand until the game changes mode again. */
public final class PadModes {
    public static final int PLAY = 0, CURSOR = 1, SPECTATE = 2;

    private int game = -1;
    private int manual = -1;

    /** The game reported its touch mode. Returns true when our mode changed. */
    public boolean onGameMode(int mode) {
        int before = current();
        if (mode != game) { game = mode; manual = -1; }
        return current() != before;
    }

    /** Start + View. Returns the new mode. */
    public int toggle() {
        manual = current() == CURSOR ? PLAY : CURSOR;
        return manual;
    }

    public boolean automatic() { return game >= 0 && manual < 0; }

    public int gameMode() { return game; }

    public int current() {
        if (manual >= 0) return manual;
        if (game == 2) return PLAY;
        if (game == 3) return SPECTATE;
        return CURSOR; // menus, and before the game says anything
    }
}
