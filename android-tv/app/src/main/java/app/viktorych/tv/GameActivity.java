package app.viktorych.tv;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.hardware.input.InputManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Choreographer;
import android.view.Gravity;
import android.view.InputDevice;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

import app.viktorych.tv.pad.HintView;
import app.viktorych.tv.pad.PadAction;
import app.viktorych.tv.pad.PadButton;
import app.viktorych.tv.pad.PadLayout;
import app.viktorych.tv.pad.PadMapper;
import app.viktorych.tv.pad.PadMath;
import app.viktorych.tv.pad.PadModes;
import app.viktorych.tv.pad.PadPrefs;
import app.viktorych.tv.pad.TouchInjector;

/** ReGone with a controller: viktorychtv://game/regone.
 *  Always our own WebView (never Chrome), because only inside our own view can
 *  the app turn controller input into real key presses and touches. ReGone does
 *  not read gamepads, so the sticks and buttons are remapped to its keyboard
 *  keys and its own touch controller (ReGoneMobile.js). */
public class GameActivity extends Activity implements PadMapper.Out, Choreographer.FrameCallback {
    static final String GAME_URL = "https://nzlay.com/ReGone/game/index.html";
    private static final int SRC_KEY = 1, SRC_AXIS = 2;

    /** Watches ReGone's touch-controller mode and where its buttons are. Read only. */
    private static final String HOOK_JS = "(function(){if(window.__vtvPad)return;window.__vtvPad=1;var B=window.ViktorychPad;if(!B)return;"
        + "function R(s){var e=document.querySelector(s);if(!e)return null;var r=e.getBoundingClientRect();return r.width>0?[r.left,r.top,r.width,r.height]:null}"
        + "function L(){try{B.layout(JSON.stringify({w:innerWidth,h:innerHeight,fire:R('#rg-actions [data-action=\"1\"]'),aim:R('#rg-actions [data-action=\"2\"]'),"
        + "menu:R('#rg-top [data-action=\"25\"]'),wprev:R('#rg-watch [data-action=\"2\"]'),wview:R('#rg-watch [data-action=\"24\"]'),wnext:R('#rg-watch [data-action=\"1\"]'),"
        + "stick:R('#rg-stick'),look:R('#rg-look')}))}catch(e){}}"
        + "var last=-9;function hook(){var T=window.ReGoneTouch;if(!T||!T.mode)return false;if(T.mode.__vtv)return true;var o=T.mode;"
        + "var w=function(n){var r=o.apply(this,arguments);if(n!==last){last=n;try{B.mode(n)}catch(e){}requestAnimationFrame(L)}return r};w.__vtv=1;T.mode=w;try{B.ready()}catch(e){}return true}"
        + "var tries=0,t=setInterval(function(){if(hook()||++tries>240)clearInterval(t)},500);addEventListener('resize',function(){setTimeout(L,250)});setTimeout(L,1500)})();";

    private FrameLayout root;
    private WebView web;
    private View custom;
    private WebChromeClient.CustomViewCallback customDone;
    private HintView hint;
    private ScrollView menuScroll;
    private LinearLayout menu;
    private final List<View> rows = new ArrayList<>();
    private int menuPage = -1; // -1 closed, 0 main, 1 controls
    private PadAction capture;

    private final TouchInjector touch = new TouchInjector();
    private final PadModes modes = new PadModes();
    private PadMapper mapper;
    private PadPrefs prefs;
    private String deviceKey;
    private boolean playstation;
    private float dp;

    // Controller state.
    private float lx, ly, rx, ry;
    private final int[] srcMask = new int[PadButton.COUNT];
    private final boolean[] moveKeys = new boolean[4];
    private final HashSet<Integer> keysDown = new HashSet<>();
    private long lastFrame, lookIdleSince;
    private boolean looking, cursorPressed;
    private float cursorX = -1, cursorY = -1;

    // Page layout in CSS px (from the hook), and its scale to view px.
    private float cssW, cssH;
    private final float[][] rects = new float[10][];
    private boolean hooked;

    private final Runnable hideHints = () -> { if (hint != null) hint.showHints(false); };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        dp = getResources().getDisplayMetrics().density;
        mapper = new PadMapper(new PadLayout(), modes);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        hint = new HintView(this);
        root.addView(hint, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        buildMenu();
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setUserAgentString(s.getUserAgentString() + " ViktorychTV/" + BuildConfig.VERSION_CODE);
        web.addJavascriptInterface(new Bridge(), "ViktorychPad");
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (custom != null) { callback.onCustomViewHidden(); return; }
                releaseInputs();
                custom = view;
                customDone = callback;
                root.addView(view, 1, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                web.setVisibility(View.INVISIBLE);
                touch.target(view);
                hideBars();
            }

            @Override
            public void onHideCustomView() {
                if (custom == null) return;
                releaseInputs();
                root.removeView(custom);
                custom = null;
                web.setVisibility(View.VISIBLE);
                touch.target(web);
                if (customDone != null) customDone.onCustomViewHidden();
                customDone = null;
                hideBars();
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) { return route(req.getUrl()); }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) { return route(Uri.parse(url)); }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (nzlay(Uri.parse(url))) view.evaluateJavascript(HOOK_JS, null);
            }
        });
        touch.target(web);
        pickDevice(firstPad());
        if (firstPad() == null) Toast.makeText(this, R.string.pad_no_pad, Toast.LENGTH_LONG).show();
        if (state != null) web.restoreState(state);
        else web.loadUrl(GAME_URL);
        web.requestFocus();
        hideBars();
        refreshHints(true);
    }

    static boolean nzlay(Uri u) {
        String h = u == null || u.getHost() == null ? "" : u.getHost();
        return "nzlay.com".equals(h) || h.endsWith(".nzlay.com");
    }

    private boolean route(Uri uri) {
        if (uri == null) return true;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme();
        if (("https".equals(scheme) || "http".equals(scheme)) && nzlay(uri)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException ignored) { /* nothing on this TV opens it */ }
        return true;
    }

    // ---------- Controllers ----------

    private static boolean isPad(InputDevice d) {
        if (d == null || d.isVirtual()) return false;
        int s = d.getSources();
        return (s & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD || (s & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
    }

    private static InputDevice firstPad() {
        for (int id : InputDevice.getDeviceIds()) {
            InputDevice d = InputDevice.getDevice(id);
            if (isPad(d)) return d;
        }
        return null;
    }

    /** Settings follow the controller in use (stored per device). */
    private void pickDevice(InputDevice d) {
        String key = d == null ? "none" : d.getDescriptor();
        if (key.equals(deviceKey)) return;
        deviceKey = key;
        prefs = new PadPrefs(this, key);
        String g = prefs.glyphs();
        playstation = g != null ? "ps".equals(g) : d != null && PadButton.playstation(d.getName(), d.getVendorId());
        mapper.releaseAll(this);
        mapper.setLayout(prefs.layout());
        refreshHints(false);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        boolean pad = KeyEvent.isGamepadButton(code) || isPad(e.getDevice());
        int b = pad ? PadButton.fromKeyCode(code) : -1;
        if (b >= 0) {
            pickDevice(e.getDevice());
            if (e.getRepeatCount() > 0) return true;
            if (e.getAction() == KeyEvent.ACTION_DOWN) setButton(b, SRC_KEY, true);
            else if (e.getAction() == KeyEvent.ACTION_UP) setButton(b, SRC_KEY, false);
            return true;
        }
        if (pad && KeyEvent.isGamepadButton(code)) return true; // Guide and other extras: swallow
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE && menuPage >= 0) {
            // The TV remote's Back opens our menu (and steps back inside it).
            if (e.getAction() == KeyEvent.ACTION_UP) { if (menuPage < 0) openMenu(); else menuBack(); }
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent e) {
        int src = e.getSource();
        boolean joy = (src & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK || (src & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD;
        if (!joy || e.getAction() != MotionEvent.ACTION_MOVE) return super.dispatchGenericMotionEvent(e);
        InputDevice d = e.getDevice();
        pickDevice(d);
        lx = e.getAxisValue(MotionEvent.AXIS_X);
        ly = e.getAxisValue(MotionEvent.AXIS_Y);
        boolean zr = d == null || d.getMotionRange(MotionEvent.AXIS_RZ, src) != null;
        rx = e.getAxisValue(zr ? MotionEvent.AXIS_Z : MotionEvent.AXIS_RX);
        ry = e.getAxisValue(zr ? MotionEvent.AXIS_RZ : MotionEvent.AXIS_RY);
        float lt = Math.max(e.getAxisValue(MotionEvent.AXIS_LTRIGGER), e.getAxisValue(MotionEvent.AXIS_BRAKE));
        float rt = Math.max(e.getAxisValue(MotionEvent.AXIS_RTRIGGER), e.getAxisValue(MotionEvent.AXIS_GAS));
        setButton(PadButton.LT, SRC_AXIS, PadMath.trigger(lt, (srcMask[PadButton.LT] & SRC_AXIS) != 0));
        setButton(PadButton.RT, SRC_AXIS, PadMath.trigger(rt, (srcMask[PadButton.RT] & SRC_AXIS) != 0));
        float hx = e.getAxisValue(MotionEvent.AXIS_HAT_X), hy = e.getAxisValue(MotionEvent.AXIS_HAT_Y);
        setButton(PadButton.LEFT, SRC_AXIS, hx < -0.5f);
        setButton(PadButton.RIGHT, SRC_AXIS, hx > 0.5f);
        setButton(PadButton.UP, SRC_AXIS, hy < -0.5f);
        setButton(PadButton.DOWN, SRC_AXIS, hy > 0.5f);
        return true;
    }

    /** A button is down while any source (key event or axis) holds it. */
    private void setButton(int b, int src, boolean on) {
        int before = srcMask[b];
        srcMask[b] = on ? before | src : before & ~src;
        boolean was = before != 0, now = srcMask[b] != 0;
        if (was != now) button(b, now);
    }

    private void button(int b, boolean down) {
        if (capture != null) {
            if (!down) return;
            if (b != PadButton.START) {
                PadLayout l = mapper.layout();
                l.bind(b, capture);
                prefs.layout(l);
            }
            capture = null;
            showMenu(1);
            return;
        }
        if (menuPage >= 0) { menuButton(b, down); return; }
        mapper.button(b, down, this);
    }

    // ---------- PadMapper.Out ----------

    private View target() { return custom != null ? custom : web; }

    @Override
    public void key(int code, boolean down) {
        if (code == PadAction.KEY_SHIFT_LEFT) {
            if (down) keysDown.add(code); else keysDown.remove(code);
        }
        int meta = keysDown.contains(PadAction.KEY_SHIFT_LEFT) ? KeyEvent.META_SHIFT_ON | KeyEvent.META_SHIFT_LEFT_ON : 0;
        long now = SystemClock.uptimeMillis();
        KeyEvent ev = new KeyEvent(now, now, down ? KeyEvent.ACTION_DOWN : KeyEvent.ACTION_UP, code, 0, meta,
            KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0, InputDevice.SOURCE_KEYBOARD);
        if (down) keysDown.add(code); else keysDown.remove(code);
        target().dispatchKeyEvent(ev);
    }

    @Override
    public void touch(int t, boolean down) {
        if (t == PadMapper.T_CURSOR) {
            cursorPressed = down;
            if (down) touch.press(t, cursorX, cursorY); else touch.release(t);
            hint.cursor(true, cursorX, cursorY, down);
            return;
        }
        if (!down) { touch.release(t); return; }
        float[] p = spot(t);
        touch.press(t, p[0], p[1]);
    }

    @Override
    public void overlay() { openMenu(); }

    @Override
    public void toggleMode() {
        releaseInputs();
        int m = modes.toggle();
        Toast.makeText(this, modeName(m), Toast.LENGTH_SHORT).show();
        refreshHints(true);
    }

    // ---------- Page layout ----------

    private float scale() {
        float w = cssW > 0 ? cssW : target().getWidth() / dp;
        return w > 0 ? target().getWidth() / w : dp;
    }

    private float cssWidth() { return cssW > 0 ? cssW : target().getWidth() / dp; }
    private float cssHeight() { return cssH > 0 ? cssH : target().getHeight() / dp; }

    /** View-pixel centre of one of ReGone's touch buttons. */
    private float[] spot(int t) {
        float k = scale();
        float[] r = t < rects.length ? rects[t] : null;
        if (r != null) return new float[] { (r[0] + r[2] / 2) * k, (r[1] + r[3] / 2) * k };
        float[] f = PadMath.fallback(t, cssWidth(), cssHeight());
        return new float[] { f[0] * k, f[1] * k };
    }

    private void readLayout(String json) {
        try {
            JSONObject o = new JSONObject(json);
            cssW = (float) o.optDouble("w", 0);
            cssH = (float) o.optDouble("h", 0);
            String[] names = { null, "fire", "aim", "menu", "wprev", "wview", "wnext", "stick", "look" };
            for (int i = 1; i < names.length; i++) {
                JSONArray a = o.optJSONArray(names[i]);
                if (a != null && a.length() == 4 && a.optDouble(2) > 0) rects[i] = new float[] { (float) a.optDouble(0), (float) a.optDouble(1), (float) a.optDouble(2), (float) a.optDouble(3) };
            }
        } catch (Exception ignored) { /* keep the last good layout */ }
    }

    private void gameMode(int m) {
        if (modes.onGameMode(m)) {
            releaseInputs();
            refreshHints(true);
        }
    }

    // ---------- Frame loop: sticks ----------

    @Override
    public void doFrame(long nanos) {
        long now = SystemClock.uptimeMillis();
        float dt = lastFrame == 0 ? 0.016f : Math.min(0.1f, (now - lastFrame) / 1000f);
        lastFrame = now;
        if (menuPage < 0 && capture == null) sticks(dt, now);
        Choreographer.getInstance().postFrameCallback(this);
    }

    private void sticks(float dt, long now) {
        int mode = modes.current();
        View v = target();
        float w = v.getWidth(), h = v.getHeight();
        if (w <= 0) return;
        if (mode == PadModes.CURSOR) {
            if (cursorX < 0) { cursorX = w / 2; cursorY = h / 2; }
            float[] a = PadMath.curve(PadMath.deadZone(rx, ry, PadMath.DEAD_ZONE), 1.6f);
            float[] b = PadMath.curve(PadMath.deadZone(lx, ly, PadMath.DEAD_ZONE), 1.6f);
            float vx = Math.abs(a[0]) + Math.abs(a[1]) > 0 ? a[0] : b[0];
            float vy = Math.abs(a[0]) + Math.abs(a[1]) > 0 ? a[1] : b[1];
            if (vx != 0 || vy != 0) {
                float speed = PadMath.CURSOR_SPEED * w * PadMath.sensitivity(prefs.sensitivity()) * dt;
                cursorX = Math.max(0, Math.min(w - 1, cursorX + vx * speed));
                cursorY = Math.max(0, Math.min(h - 1, cursorY + vy * speed));
                if (cursorPressed) touch.move(PadMapper.T_CURSOR, cursorX, cursorY);
                hint.cursor(true, cursorX, cursorY, cursorPressed);
            }
            return;
        }
        if (mode != PadModes.PLAY) return;
        // Left stick: W A S D, or ReGone's own on-screen joystick.
        if (prefs.stickMove()) {
            float[] m = PadMath.deadZone(lx, ly, PadMath.DEAD_ZONE);
            if (m[0] == 0 && m[1] == 0) touch.release(PadMapper.T_STICK);
            else {
                float[] c = spot(PadMapper.T_STICK);
                float radius = 60 * PadMath.unit(cssHeight()) * scale();
                touch.press(PadMapper.T_STICK, c[0] + m[0] * radius, c[1] + m[1] * radius);
            }
        } else {
            boolean[] next = PadMath.moveKeys(lx, ly, moveKeys);
            int[] codes = { PadAction.KEY_W, PadAction.KEY_A, PadAction.KEY_S, PadAction.KEY_D };
            for (int i = 0; i < 4; i++) if (next[i] != moveKeys[i]) { moveKeys[i] = next[i]; key(codes[i], next[i]); }
        }
        // Right stick: hold one finger in ReGone's look area and drag it.
        float[] d = PadMath.look(rx, ry, prefs.sensitivity(), prefs.invert(), dt);
        if (d[0] == 0 && d[1] == 0) {
            if (looking && now - lookIdleSince > 120) { touch.release(PadMapper.T_LOOK); looking = false; }
            return;
        }
        lookIdleSince = now;
        float k = scale();
        float cw = cssWidth(), ch = cssHeight();
        if (!touch.isDown(PadMapper.T_LOOK)) {
            touch.press(PadMapper.T_LOOK, cw * 0.55f * k, ch * 0.35f * k);
            looking = true;
            return;
        }
        float[] p = touch.where(PadMapper.T_LOOK);
        float nx = p[0] + d[0] * k, ny = p[1] + d[1] * k;
        touch.move(PadMapper.T_LOOK, nx, ny);
        // Near the edge of the look area: lift and start again from the middle next frame.
        if (nx < cw * 0.38f * k || nx > cw * 0.98f * k || ny < ch * 0.14f * k || ny > ch * 0.97f * k) touch.release(PadMapper.T_LOOK);
    }

    private void releaseInputs() { releaseInputs(false); }

    /** Lets go of every key and finger. With forget, also drops what the controller holds (it went away). */
    private void releaseInputs(boolean forget) {
        mapper.releaseAll(this);
        int[] codes = { PadAction.KEY_W, PadAction.KEY_A, PadAction.KEY_S, PadAction.KEY_D };
        for (int i = 0; i < 4; i++) if (moveKeys[i]) { moveKeys[i] = false; key(codes[i], false); }
        for (Integer k : new ArrayList<>(keysDown)) key(k, false);
        touch.cancel();
        looking = false;
        cursorPressed = false;
        if (!forget) return;
        mapper.forget(this);
        java.util.Arrays.fill(srcMask, 0);
        lx = ly = rx = ry = 0;
    }

    /** A controller that disconnects mid-match must not leave anything pressed. */
    private final InputManager.InputDeviceListener devices = new InputManager.InputDeviceListener() {
        @Override public void onInputDeviceAdded(int id) { }
        @Override public void onInputDeviceChanged(int id) { }
        @Override public void onInputDeviceRemoved(int id) { releaseInputs(true); }
    };

    // ---------- Hints ----------

    private String modeName(int m) {
        return getString(m == PadModes.PLAY ? R.string.pad_mode_play : m == PadModes.SPECTATE ? R.string.pad_mode_watch : R.string.pad_mode_cursor);
    }

    private void refreshHints(boolean show) {
        if (hint == null || mapper == null) return;
        List<HintView.Hint> list = new ArrayList<>();
        int mode = modes.current();
        PadLayout l = mapper.layout();
        if (mode == PadModes.PLAY) {
            list.add(new HintView.Hint(-1, getString(R.string.hint_move)));
            list.add(new HintView.Hint(-2, getString(R.string.hint_look)));
            PadAction[] shown = { PadAction.FIRE, PadAction.AIM, PadAction.JUMP, PadAction.CROUCH, PadAction.RELOAD, PadAction.USE, PadAction.WEAPON_NEXT };
            for (PadAction a : shown) {
                int b = l.buttonFor(a);
                if (b >= 0) list.add(new HintView.Hint(b, actionName(a)));
            }
        } else if (mode == PadModes.SPECTATE) {
            list.add(new HintView.Hint(PadButton.RT, getString(R.string.hint_next)));
            list.add(new HintView.Hint(PadButton.LT, getString(R.string.hint_prev)));
            list.add(new HintView.Hint(PadButton.A, getString(R.string.hint_view)));
        } else {
            list.add(new HintView.Hint(-2, getString(R.string.hint_cursor)));
            list.add(new HintView.Hint(PadButton.A, getString(R.string.hint_tap)));
            list.add(new HintView.Hint(PadButton.B, getString(R.string.hint_back)));
            list.add(new HintView.Hint(PadButton.VIEW, getString(R.string.hint_switch)));
        }
        list.add(new HintView.Hint(PadButton.START, getString(R.string.hint_menu)));
        hint.hints(list, playstation);
        if (cursorX < 0 && target().getWidth() > 0) { cursorX = target().getWidth() / 2f; cursorY = target().getHeight() / 2f; }
        hint.cursor(mode == PadModes.CURSOR && menuPage < 0, cursorX, cursorY, false);
        if (show) {
            hint.showHints(true);
            hint.removeCallbacks(hideHints);
            hint.postDelayed(hideHints, 8000);
        }
    }

    String actionName(PadAction a) {
        switch (a) {
            case JUMP: return getString(R.string.act_jump);
            case CROUCH: return getString(R.string.act_crouch);
            case RELOAD: return getString(R.string.act_reload);
            case USE: return getString(R.string.act_use);
            case SPRINT: return getString(R.string.act_sprint);
            case PRONE: return getString(R.string.act_prone);
            case BINOCULARS: return getString(R.string.act_binoculars);
            case BUY: return getString(R.string.act_buy);
            case INSPECT: return getString(R.string.act_inspect);
            case MELEE: return getString(R.string.act_melee);
            case SCOREBOARD: return getString(R.string.act_scoreboard);
            case FIRE: return getString(R.string.act_fire);
            case AIM: return getString(R.string.act_aim);
            case WEAPON_NEXT: return getString(R.string.act_weapon_next);
            case WEAPON_PREV: return getString(R.string.act_weapon_prev);
            case MENU: return getString(R.string.hint_menu);
            default: return getString(R.string.act_none);
        }
    }

    // ---------- Our menu (Start) ----------

    private void buildMenu() {
        menuScroll = new ScrollView(this);
        menuScroll.setVisibility(View.GONE);
        GradientDrawable panel = new GradientDrawable();
        panel.setColor(0xF2000000);
        panel.setCornerRadius(16 * dp);
        panel.setStroke((int) dp, 0xFF2F3336);
        menuScroll.setBackground(panel);
        menu = new LinearLayout(this);
        menu.setOrientation(LinearLayout.VERTICAL);
        int p = (int) (12 * dp);
        menu.setPadding(p, p, p, p);
        menuScroll.addView(menu);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams((int) (420 * dp), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        root.addView(menuScroll, lp);
    }

    private void openMenu() {
        releaseInputs();
        showMenu(0);
    }

    private void closeMenu() {
        menuPage = -1;
        capture = null;
        menuScroll.setVisibility(View.GONE);
        web.requestFocus();
        hideBars();
        refreshHints(false);
    }

    private void menuBack() {
        if (capture != null) { capture = null; showMenu(1); return; }
        if (menuPage == 1) showMenu(0); else closeMenu();
    }

    private TextView row(String text, View.OnClickListener click, Runnable left, Runnable right) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextColor(0xFFE7E9EA);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        int p = (int) (12 * dp);
        t.setPadding(p + p / 2, p, p, p);
        t.setFocusable(true);
        t.setFocusableInTouchMode(true);
        StateListDrawable bg = new StateListDrawable();
        GradientDrawable on = new GradientDrawable();
        on.setCornerRadius(24 * dp);
        on.setColor(0x26FFFFFF);
        on.setStroke((int) (2 * dp), 0xFFFFFFFF);
        GradientDrawable off = new GradientDrawable();
        off.setCornerRadius(24 * dp);
        off.setColor(0x00000000);
        bg.addState(new int[] { android.R.attr.state_focused }, on);
        bg.addState(new int[] {}, off);
        t.setBackground(bg);
        if (click != null) t.setOnClickListener(click);
        if (left != null || right != null) {
            t.setOnKeyListener((v, code, e) -> {
                if (e.getAction() != KeyEvent.ACTION_DOWN) return false;
                if (code == KeyEvent.KEYCODE_DPAD_LEFT && left != null) { left.run(); return true; }
                if (code == KeyEvent.KEYCODE_DPAD_RIGHT && right != null) { right.run(); return true; }
                return false;
            });
            t.setTag(new Runnable[] { left, right });
        }
        menu.addView(t, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        rows.add(t);
        return t;
    }

    private void title(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextColor(0xFFFFFFFF);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        t.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        int p = (int) (12 * dp);
        t.setPadding(p + p / 2, p / 2, p, p);
        menu.addView(t);
    }

    private void showMenu(int page) {
        int focus = menuPage == page ? Math.max(0, rows.indexOf(getCurrentFocus())) : 0;
        menuPage = page;
        menu.removeAllViews();
        rows.clear();
        hint.cursor(false, 0, 0, false);
        hint.showHints(false);
        if (page == 0) {
            title(getString(R.string.pad_title));
            row(getString(R.string.pad_resume), v -> closeMenu(), null, null);
            row(getString(R.string.pad_game_menu), v -> { closeMenu(); tapGameMenu(); }, null, null);
            row(getString(R.string.pad_mode, modeName(modes.current())), v -> { closeMenu(); toggleMode(); }, null, null);
            row(getString(R.string.pad_controls), v -> showMenu(1), null, null);
            Runnable down = () -> { prefs.sensitivity(prefs.sensitivity() - 1); showMenu(0); };
            Runnable up = () -> { prefs.sensitivity(prefs.sensitivity() + 1); showMenu(0); };
            row(getString(R.string.pad_sensitivity, prefs.sensitivity()), v -> { prefs.sensitivity(prefs.sensitivity() % 10 + 1); showMenu(0); }, down, up);
            row(getString(prefs.invert() ? R.string.pad_invert_on : R.string.pad_invert_off), v -> { prefs.invert(!prefs.invert()); showMenu(0); }, null, null);
            row(getString(prefs.stickMove() ? R.string.pad_move_stick : R.string.pad_move_keys), v -> { prefs.stickMove(!prefs.stickMove()); showMenu(0); }, null, null);
            row(getString(R.string.pad_glyphs, getString(playstation ? R.string.pad_glyphs_ps : R.string.pad_glyphs_xbox)), v -> {
                playstation = !playstation;
                prefs.glyphs(playstation ? "ps" : "xbox");
                showMenu(0);
            }, null, null);
            row(getString(R.string.pad_show_hints), v -> { closeMenu(); refreshHints(true); }, null, null);
            row(getString(R.string.pad_exit), v -> finish(), null, null);
        } else {
            title(getString(R.string.pad_controls));
            String[] names = playstation ? PadButton.PLAYSTATION : PadButton.XBOX;
            PadLayout l = mapper.layout();
            for (PadAction a : PadAction.values()) {
                if (a == PadAction.MENU || a == PadAction.NONE) continue;
                int b = l.buttonFor(a);
                String label = actionName(a) + "  ·  " + (b >= 0 ? names[b] : getString(R.string.act_none));
                if (capture == a) label = getString(R.string.pad_press, actionName(a));
                row(label, v -> { capture = a; showMenu(1); }, null, null);
            }
            row(getString(R.string.pad_reset), v -> { PadLayout fresh = new PadLayout(); mapper.setLayout(fresh); prefs.layout(fresh); showMenu(1); }, null, null);
            row(getString(R.string.pad_back), v -> showMenu(0), null, null);
        }
        menuScroll.setVisibility(View.VISIBLE);
        View f = rows.get(Math.min(focus, rows.size() - 1));
        f.requestFocus();
    }

    /** Controller input while our menu is open: D-pad moves, A picks, B goes back. */
    private void menuButton(int b, boolean down) {
        if (!down) return;
        View f = getCurrentFocus();
        int i = rows.indexOf(f);
        switch (b) {
            case PadButton.UP: if (i > 0) rows.get(i - 1).requestFocus(); else if (!rows.isEmpty()) rows.get(rows.size() - 1).requestFocus(); break;
            case PadButton.DOWN: if (i >= 0 && i < rows.size() - 1) rows.get(i + 1).requestFocus(); else if (!rows.isEmpty()) rows.get(0).requestFocus(); break;
            case PadButton.LEFT: case PadButton.RIGHT:
                if (f != null && f.getTag() instanceof Runnable[]) {
                    Runnable r = ((Runnable[]) f.getTag())[b == PadButton.LEFT ? 0 : 1];
                    if (r != null) r.run();
                }
                break;
            case PadButton.A: if (f != null) f.performClick(); break;
            case PadButton.B: case PadButton.START: menuBack(); break;
            default: break;
        }
    }

    /** Opens ReGone's own menu: its Menu touch button, or Escape. */
    private void tapGameMenu() {
        if (rects[PadMapper.T_MENU] != null || modes.gameMode() >= 2) {
            float[] p = spot(PadMapper.T_MENU);
            touch.press(PadMapper.T_MENU, p[0], p[1]);
            web.postDelayed(() -> touch.release(PadMapper.T_MENU), 80);
        } else {
            key(PadAction.KEY_ESCAPE, true);
            key(PadAction.KEY_ESCAPE, false);
        }
    }

    // ---------- Lifecycle ----------

    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    public void onWindowFocusChanged(boolean has) {
        super.onWindowFocusChanged(has);
        if (has) hideBars(); else releaseInputs(true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        hideBars();
        lastFrame = 0;
        InputManager im = (InputManager) getSystemService(INPUT_SERVICE);
        if (im != null) im.registerInputDeviceListener(devices, null);
        Choreographer.getInstance().postFrameCallback(this);
    }

    @Override
    protected void onPause() {
        Choreographer.getInstance().removeFrameCallback(this);
        InputManager im = (InputManager) getSystemService(INPUT_SERVICE);
        if (im != null) im.unregisterInputDeviceListener(devices);
        releaseInputs(true);
        web.onPause();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (menuPage < 0) openMenu(); else menuBack();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    /** Called by the hook in ReGone's page. Only numbers and button boxes come in. */
    final class Bridge {
        @JavascriptInterface public void mode(final int m) { runOnUiThread(() -> { if (nzlay(Uri.parse(String.valueOf(web.getUrl())))) gameMode(m); }); }
        @JavascriptInterface public void layout(final String json) {
            if (json == null || json.length() > 4000) return;
            runOnUiThread(() -> { if (nzlay(Uri.parse(String.valueOf(web.getUrl())))) readLayout(json); });
        }
        @JavascriptInterface public void ready() { runOnUiThread(() -> hooked = true); }
    }
}
