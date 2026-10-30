package app.viktorych.tv.player;

import android.view.View;

/** One way of playing something: a native video view or an embedded web
 *  player. The player's controls only talk to this. */
interface Engine {
    interface Listener {
        void onReady();
        void onEnded();
        void onError(String why);
    }

    View view();
    void load(Listener l);
    void play();
    void pause();
    boolean playing();
    long position();      // ms
    long duration();      // ms, 0 when unknown
    int buffered();       // percent
    boolean live();
    void seekTo(long ms);
    void setMuted(boolean muted);
    void release();
}
