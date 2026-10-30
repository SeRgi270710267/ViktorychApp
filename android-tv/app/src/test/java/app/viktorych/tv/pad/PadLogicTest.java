package app.viktorych.tv.pad;

import static org.junit.Assert.*;

import java.util.ArrayList;
import java.util.List;

import org.junit.Test;

public class PadLogicTest {
    static final class Rec implements PadMapper.Out {
        final List<String> log = new ArrayList<>();
        public void key(int code, boolean down) { log.add((down ? "k+" : "k-") + code); }
        public void touch(int target, boolean down) { log.add((down ? "t+" : "t-") + target); }
        public void overlay() { log.add("overlay"); }
        public void toggleMode() { log.add("toggle"); }
    }

    @Test public void deadZoneIgnoresWobbleAndRescales() {
        assertArrayEquals(new float[] { 0, 0 }, PadMath.deadZone(0.1f, 0.05f, 0.15f), 0f);
        float[] full = PadMath.deadZone(1f, 0f, 0.15f);
        assertEquals(1f, full[0], 1e-5);
        float[] half = PadMath.deadZone(0.575f, 0f, 0.15f);
        assertEquals(0.5f, half[0], 1e-4);
        float[] diag = PadMath.deadZone(-0.6f, 0.6f, 0.15f);
        assertTrue(diag[0] < 0 && diag[1] > 0);
        assertEquals(Math.abs(diag[0]), diag[1], 1e-5);
    }

    @Test public void curveKeepsDirectionAndSoftensSmallTilts() {
        float[] v = PadMath.curve(new float[] { 0.5f, 0f }, 2f);
        assertEquals(0.25f, v[0], 1e-5);
        float[] one = PadMath.curve(new float[] { 0f, -1f }, 2f);
        assertEquals(-1f, one[1], 1e-5);
        assertArrayEquals(new float[] { 0, 0 }, PadMath.curve(new float[] { 0, 0 }, 2f), 0f);
    }

    @Test public void lookUsesSensitivityAndInvert() {
        float[] a = PadMath.look(1f, 0f, 5, false, 0.1f);
        assertEquals(PadMath.LOOK_SPEED * 0.1f, a[0], 1e-3);
        float[] b = PadMath.look(1f, 0f, 10, false, 0.1f);
        assertEquals(a[0] * 2, b[0], 1e-3);
        float[] up = PadMath.look(0f, -1f, 5, false, 0.1f);
        float[] inv = PadMath.look(0f, -1f, 5, true, 0.1f);
        assertEquals(-up[1], inv[1], 1e-5);
        assertArrayEquals(new float[] { 0, 0 }, PadMath.look(0.1f, 0.1f, 5, false, 0.1f), 0f);
        assertEquals(1, PadMath.sensitivity(99) / 2, 0); // clamps to 10
    }

    @Test public void moveKeysHaveHysteresis() {
        boolean[] none = new boolean[4];
        boolean[] fwd = PadMath.moveKeys(0f, -0.8f, none);
        assertTrue(fwd[0]);
        assertFalse(fwd[1] || fwd[2] || fwd[3]);
        // Easing back to 45% keeps W held (release is below 35% after the dead zone).
        assertTrue(PadMath.moveKeys(0f, -0.5f, fwd)[0]);
        assertFalse(PadMath.moveKeys(0f, -0.5f, none)[0]);
        assertFalse(PadMath.moveKeys(0f, -0.2f, fwd)[0]);
        boolean[] right = PadMath.moveKeys(0.9f, 0f, none);
        assertTrue(right[3]);
        assertTrue(PadMath.trigger(0.6f, false));
        assertTrue(PadMath.trigger(0.4f, true));
        assertFalse(PadMath.trigger(0.4f, false));
    }

    @Test public void buttonCodesMapToButtons() {
        assertEquals(PadButton.A, PadButton.fromKeyCode(96));
        assertEquals(PadButton.RT, PadButton.fromKeyCode(105));
        assertEquals(PadButton.START, PadButton.fromKeyCode(108));
        assertEquals(PadButton.VIEW, PadButton.fromKeyCode(109));
        assertEquals(PadButton.UP, PadButton.fromKeyCode(19));
        assertEquals(-1, PadButton.fromKeyCode(29));
        assertTrue(PadButton.playstation("Sony Interactive Entertainment Wireless Controller", 0));
        assertTrue(PadButton.playstation("x", 0x054C));
        assertFalse(PadButton.playstation("Xbox Wireless Controller", 0x045E));
    }

    @Test public void defaultLayoutMatchesTheGameKeys() {
        PadLayout l = new PadLayout();
        assertEquals(PadAction.JUMP, l.get(PadButton.A));
        assertEquals(62, PadAction.JUMP.key);      // Space
        assertEquals(31, PadAction.CROUCH.key);    // C
        assertEquals(46, PadAction.RELOAD.key);    // R
        assertEquals(33, PadAction.USE.key);       // E
        assertEquals(59, PadAction.SPRINT.key);    // Left Shift
        assertEquals(52, PadAction.PRONE.key);     // X
        assertEquals(54, PadAction.BINOCULARS.key);// Z
        assertEquals(30, PadAction.BUY.key);       // B
        assertEquals(35, PadAction.INSPECT.key);   // G
        assertEquals(61, PadAction.SCOREBOARD.key);// Tab
        assertEquals(PadAction.FIRE, l.get(PadButton.RT));
        assertEquals(PadAction.AIM, l.get(PadButton.LT));
        assertEquals(PadAction.SPRINT, l.get(PadButton.L3));
        assertEquals(PadAction.BINOCULARS, l.get(PadButton.UP));
        assertEquals(PadAction.PRONE, l.get(PadButton.DOWN));
        assertEquals(PadAction.BUY, l.get(PadButton.LEFT));
        assertEquals(PadAction.INSPECT, l.get(PadButton.RIGHT));
        assertEquals(PadAction.MENU, l.get(PadButton.START));
        assertEquals(PadAction.SCOREBOARD, l.get(PadButton.VIEW));
    }

    @Test public void remapSwapsAndSurvivesSaveLoad() {
        PadLayout l = new PadLayout();
        assertTrue(l.bind(PadButton.B, PadAction.JUMP));
        assertEquals(PadAction.JUMP, l.get(PadButton.B));
        assertEquals(PadAction.CROUCH, l.get(PadButton.A));
        assertFalse(l.bind(PadButton.START, PadAction.JUMP));
        assertFalse(l.bind(PadButton.A, PadAction.MENU));
        PadLayout back = PadLayout.load(l.save());
        assertEquals(l.save(), back.save());
        PadLayout odd = PadLayout.load("A=FLY,START=JUMP,B=RELOAD,junk");
        assertEquals(PadAction.JUMP, odd.get(PadButton.A));
        assertEquals(PadAction.MENU, odd.get(PadButton.START));
        assertEquals(PadAction.RELOAD, odd.get(PadButton.B));
        l.reset();
        assertEquals(new PadLayout().save(), l.save());
    }

    @Test public void modesFollowTheGameAndManualToggle() {
        PadModes m = new PadModes();
        assertEquals(PadModes.CURSOR, m.current());
        assertFalse(m.automatic());
        assertTrue(m.onGameMode(2));
        assertEquals(PadModes.PLAY, m.current());
        assertTrue(m.automatic());
        assertEquals(PadModes.CURSOR, m.toggle());
        assertFalse(m.automatic());
        assertFalse(m.onGameMode(2)); // same game mode: manual choice stays
        assertEquals(PadModes.CURSOR, m.current());
        assertTrue(m.onGameMode(3));
        assertEquals(PadModes.SPECTATE, m.current());
        m.onGameMode(0);
        assertEquals(PadModes.CURSOR, m.current());
    }

    @Test public void mapperPlaysKeysTouchesAndWeapons() {
        PadModes m = new PadModes();
        m.onGameMode(2);
        PadMapper p = new PadMapper(new PadLayout(), m);
        Rec r = new Rec();
        p.button(PadButton.A, true, r);
        p.button(PadButton.A, false, r);
        p.button(PadButton.RT, true, r);
        p.button(PadButton.RT, false, r);
        p.button(PadButton.RB, true, r);
        p.button(PadButton.RB, false, r);
        p.button(PadButton.LB, true, r);
        p.button(PadButton.LB, true, r); // repeat ignored while held
        assertEquals(java.util.Arrays.asList("k+62", "k-62", "t+1", "t-1", "k+11", "k-11", "k+10", "k-10"), r.log);
    }

    @Test public void startOpensMenuAndStartViewToggles() {
        PadModes m = new PadModes();
        m.onGameMode(2);
        PadMapper p = new PadMapper(new PadLayout(), m);
        Rec r = new Rec();
        p.button(PadButton.START, true, r);
        p.button(PadButton.START, false, r);
        assertEquals(java.util.Arrays.asList("overlay"), r.log);
        r.log.clear();
        p.button(PadButton.VIEW, true, r);   // Tab down
        p.button(PadButton.START, true, r);  // chord: Tab up, toggle
        p.button(PadButton.START, false, r); // no menu
        p.button(PadButton.VIEW, false, r);  // nothing more
        assertEquals(java.util.Arrays.asList("k+61", "k-61", "toggle"), r.log);
        r.log.clear();
        p.button(PadButton.START, true, r);
        p.button(PadButton.VIEW, true, r);
        p.button(PadButton.VIEW, false, r);
        p.button(PadButton.START, false, r);
        assertEquals(java.util.Arrays.asList("toggle"), r.log);
    }

    @Test public void cursorAndSpectateModes() {
        PadModes m = new PadModes();
        PadMapper p = new PadMapper(new PadLayout(), m);
        Rec r = new Rec();
        p.button(PadButton.A, true, r);
        p.button(PadButton.A, false, r);
        p.button(PadButton.B, true, r);
        p.button(PadButton.X, true, r); // nothing in menus
        assertEquals(java.util.Arrays.asList("t+" + PadMapper.T_CURSOR, "t-" + PadMapper.T_CURSOR, "k+111"), r.log);
        r.log.clear();
        m.onGameMode(3);
        p.button(PadButton.RT, true, r);
        p.button(PadButton.LT, true, r);
        p.releaseAll(r);
        assertTrue(r.log.containsAll(java.util.Arrays.asList("t+" + PadMapper.T_WATCH_NEXT, "t+" + PadMapper.T_WATCH_PREV, "t-" + PadMapper.T_WATCH_NEXT, "t-" + PadMapper.T_WATCH_PREV, "k-111")));
    }

    @Test public void releaseAfterModeChangeLetsGoOfWhatWasPressed() {
        PadModes m = new PadModes();
        m.onGameMode(2);
        PadMapper p = new PadMapper(new PadLayout(), m);
        Rec r = new Rec();
        p.button(PadButton.RT, true, r);
        m.onGameMode(0);
        p.button(PadButton.RT, false, r);
        assertEquals(java.util.Arrays.asList("t+1", "t-1"), r.log);
    }

    @Test public void fallbackButtonsSitInsideTheScreen() {
        float w = 960, h = 540;
        int[] targets = { PadMapper.T_FIRE, PadMapper.T_AIM, PadMapper.T_MENU, PadMapper.T_STICK, PadMapper.T_WATCH_VIEW };
        for (int t : targets) {
            float[] c = PadMath.fallback(t, w, h);
            assertTrue(c[0] > 0 && c[0] < w && c[1] > 0 && c[1] < h);
        }
        float[] fire = PadMath.fallback(PadMapper.T_FIRE, w, h);
        assertTrue(fire[0] > w * 0.6f && fire[1] > h * 0.4f);
        assertEquals(0.75f, PadMath.unit(100), 1e-6);
        assertEquals(1f, PadMath.unit(1000), 1e-6);
    }

    @Test
    public void forgetDropsAHalfPressedStart() {
        PadModes modes = new PadModes();
        modes.onGameMode(2);
        PadMapper m = new PadMapper(new PadLayout(), modes);
        final java.util.List<String> log = new java.util.ArrayList<>();
        PadMapper.Out out = new PadMapper.Out() {
            public void key(int k, boolean d) { log.add("k" + (d ? "+" : "-") + k); }
            public void touch(int t, boolean d) { log.add("t" + (d ? "+" : "-") + t); }
            public void overlay() { log.add("menu"); }
            public void toggleMode() { log.add("toggle"); }
        };
        m.button(PadButton.START, true, out);
        m.button(PadButton.A, true, out);
        m.forget(out);
        assertEquals(java.util.Arrays.asList("k+62", "k-62"), log);
        log.clear();
        m.button(PadButton.VIEW, true, out); // Start is no longer held: no mode switch
        assertTrue(!log.contains("toggle"));
    }
}
