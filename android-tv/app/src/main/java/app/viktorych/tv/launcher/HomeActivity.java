package app.viktorych.tv.launcher;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import android.text.InputType;
import android.text.format.DateFormat;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;

import app.viktorych.tv.R;

/** The optional home screen. Only reachable once the user makes ViktorychTV
 *  the TV's home app on the defaults screen; the regular app is untouched
 *  and opens in one click from the hero, the top bar and its own tile.
 *  Layout copies Google TV's "Apps only" home (see Spec). */
public class HomeActivity extends Activity {
    static final String KEY_ORDER = "order";

    private SharedPreferences prefs;
    private LauncherModel model;
    private Map<String, Apps.App> apps;
    private String ourKey;

    private FrameLayout root;
    private Scroller scroll;
    private FrameLayout page;
    private TextView clock, smallLabel, bigLabel;
    private ImageView caret;
    private View header;
    private View openButton, homePill;
    private final List<Tile> tiles = new ArrayList<>();
    private FrameLayout panel, folderLayer;
    private String openFolder;
    private Tile moving;
    private TextView hint;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private final BroadcastReceiver packages = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { reload(null); }
    };

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (clock != null) clock.setText(DateFormat.getTimeFormat(HomeActivity.this).format(new Date()));
            ui.postDelayed(this, 60_000 - System.currentTimeMillis() % 60_000);
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences(Defaults.PREFS, MODE_PRIVATE);
        root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        setContentView(root);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        reload(null);
        if (openButton != null) openButton.requestFocus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_PACKAGE_ADDED);
        f.addAction(Intent.ACTION_PACKAGE_REMOVED);
        f.addAction(Intent.ACTION_PACKAGE_CHANGED);
        f.addDataScheme("package");
        registerReceiver(packages, f);
        ui.post(tick);
        String focus = focusedKey();
        reload(focus);
    }

    @Override
    protected void onPause() {
        super.onPause();
        try { unregisterReceiver(packages); } catch (RuntimeException ignored) { /* not registered */ }
        ui.removeCallbacks(tick);
        endMove();
    }

    /** Home pressed while already home: back to the top, like Google TV. */
    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        closeLayers();
        if (scroll != null) scroll.smoothScrollTo(0, 0);
        if (openButton != null) openButton.requestFocus();
    }

    @Override
    public void onBackPressed() {
        if (moving != null) { endMove(); return; }
        if (closeLayers()) return;
        if (scroll != null && scroll.getScrollY() > 0) {
            scroll.smoothScrollTo(0, 0);
            if (openButton != null) openButton.requestFocus();
        }
        // A home screen never closes on Back.
    }

    private boolean closeLayers() {
        boolean any = false;
        if (panel != null) { root.removeView(panel); panel = null; any = true; setPageFocusable(true); }
        if (folderLayer != null) { root.removeView(folderLayer); folderLayer = null; openFolder = null; any = true; setPageFocusable(true); }
        return any;
    }

    private String focusedKey() {
        View f = getCurrentFocus();
        return f instanceof Tile ? ((Tile) f).key : null;
    }

    // ---------------------------------------------------------------- build

    private void reload(String focusKey) {
        apps = Apps.load(this);
        Intent mine = Apps.ourApp(this);
        ourKey = mine != null && mine.getComponent() != null
            ? mine.getComponent().getPackageName() + "/" + mine.getComponent().getClassName() : null;
        model = LauncherModel.load(prefs.getString(KEY_ORDER, null));
        model.reconcile(new ArrayList<>(apps.keySet()), ourKey);
        save();
        build();
        if (focusKey != null) focusTile(focusKey);
        if (openFolder != null) showFolder(openFolder, null);
    }

    private void save() { prefs.edit().putString(KEY_ORDER, model.save()).apply(); }

    private int d(float v) { return Ui.dp(this, v); }

    private CharSequence ourLabel() {
        try { return getPackageManager().getApplicationLabel(getApplicationInfo()); } catch (RuntimeException e) { return "ViktorychTV"; }
    }

    private void build() {
        root.removeAllViews();
        tiles.clear();
        scroll = new Scroller(this);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        scroll.setClipChildren(false);
        scroll.setSmoothScrollingEnabled(true);
        page = new FrameLayout(this);
        page.setClipChildren(false);
        page.setClipToPadding(false);
        scroll.addView(page, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Hero artwork: the right part of the top of the page.
        HeroArt art = new HeroArt(this);
        place(page, art, 0, 0, Spec.SCREEN_W, Spec.HERO_H + 30);

        buildTopBar();
        buildHero();

        smallLabel = Ui.text(this, getString(R.string.lx_your_apps), 13, Ui.TEXT_DIM, Ui.REGULAR);
        place(page, smallLabel, Spec.EDGE, Spec.HERO_H - 4, -2, -2);

        int gridTop = Spec.HERO_H + Spec.LABEL_GAP;
        for (int i = 0; i < model.entries.size(); i++) {
            Tile t = tileFor(model.entries.get(i));
            final int row = i / Spec.COLS;
            t.setOnFocusChangeListener((v, f) -> { t.focus(f); if (f) scrollToRow(row); });
            place(page, t, Spec.colX(i % Spec.COLS), gridTop + Spec.rowY(row), Spec.TILE_W, Spec.TILE_H + 40);
            tiles.add(t);
        }
        int rows = Math.max(1, Spec.rows(model.entries.size()));
        // Room so the last row can scroll up to its resting place.
        View spacer = new View(this);
        place(page, spacer, 0, gridTop + Spec.rowY(rows - 1), 1, Spec.SCREEN_H);
        for (int i = 0; i < tiles.size(); i++) {
            if (i < Spec.COLS) tiles.get(i).setNextFocusUpId(openButton.getId());
        }
        openButton.setNextFocusDownId(tiles.isEmpty() ? View.NO_ID : tiles.get(0).getId());

        // Fixed header shown once the grid is scrolled: caret and big "Your apps".
        // Rows above the focused one slide under it, as on Google TV.
        header = new View(this);
        header.setBackground(new android.graphics.drawable.GradientDrawable(
            android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{Ui.BG, Ui.BG, Ui.BG, Ui.BG, Ui.BG, Ui.BG, Ui.BG, Ui.BG, Ui.BG, 0x00101114}));
        header.setAlpha(0f);
        root.addView(header, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, d(Spec.GRID_TOP_SCROLLED - 8)));
        caret = Ui.icon(this, R.drawable.lx_expand_less, 18, Ui.TEXT);
        caret.setAlpha(0f);
        FrameLayout.LayoutParams cl = new FrameLayout.LayoutParams(d(24), d(24), Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        cl.topMargin = d(17);
        root.addView(caret, cl);
        bigLabel = Ui.text(this, getString(R.string.lx_your_apps), 22, Ui.TEXT, Ui.REGULAR);
        bigLabel.setAlpha(0f);
        place(root, bigLabel, Spec.EDGE, 64, -2, -2);
    }

    private Tile tileFor(LauncherModel.Entry e) {
        Tile t = new Tile(this);
        t.setId(View.generateViewId());
        if (e.folder) {
            List<Drawable> art = new ArrayList<>();
            for (String k : e.apps) { Apps.App a = apps.get(k); if (a != null) art.add(a.banner != null ? a.banner : a.icon); }
            t.bindFolder(e, art, folderName(e));
            t.setOnClickListener(v -> showFolder(e.key, null));
        } else {
            Apps.App a = apps.get(e.key);
            if (a != null) t.bindApp(a);
            t.setOnClickListener(v -> launch(e.key));
        }
        t.setOnLongClickListener(v -> { menu(t, null); return true; });
        return t;
    }

    private String folderName(LauncherModel.Entry f) {
        if (f.name != null && !f.name.isEmpty()) return f.name;
        int n = 1;
        for (LauncherModel.Entry e : model.entries) { if (e == f) break; if (e.folder) n++; }
        return getString(R.string.lx_folder_default, n);
    }

    private void buildTopBar() {
        int barMid = Spec.BAR_TOP + Spec.PILL_H / 2;
        // Profile picture: our mark in a circle; opens the app.
        TextView avatar = Ui.text(this, "V", 15, 0xFFFFFFFF, Ui.MEDIUM);
        avatar.setGravity(Gravity.CENTER);
        avatar.setFocusable(true);
        avatar.setContentDescription(getString(R.string.lx_profile));
        avatar.setBackground(Ui.focusBg(Ui.oval(Ui.FOCUS), Ui.oval(Ui.ACCENT)));
        avatar.setOnFocusChangeListener((v, f) -> { avatar.setTextColor(f ? Ui.ACCENT : 0xFFFFFFFF); Ui.scale(avatar, f ? 1.1f : 1f); });
        avatar.setOnClickListener(v -> openOurApp());
        place(page, avatar, Spec.EDGE, barMid - Spec.AVATAR / 2, Spec.AVATAR, Spec.AVATAR);

        LinearLayout tabs = new LinearLayout(this);
        tabs.setOrientation(LinearLayout.HORIZONTAL);
        homePill = Ui.pill(this, getString(R.string.lx_home_tab), true);
        homePill.setId(View.generateViewId());
        homePill.setOnClickListener(v -> { scroll.smoothScrollTo(0, 0); openButton.requestFocus(); });
        tabs.addView(homePill, new LinearLayout.LayoutParams(-2, d(Spec.PILL_H)));
        TextView appTab = Ui.pill(this, ourLabel(), false);
        appTab.setOnClickListener(v -> openOurApp());
        LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(-2, d(Spec.PILL_H));
        tl.leftMargin = d(4);
        tabs.addView(appTab, tl);
        place(page, tabs, Spec.EDGE + Spec.AVATAR + Spec.AVATAR_GAP, Spec.BAR_TOP, -2, Spec.PILL_H);

        // Right side: search, inputs, settings, then the clock where Google TV puts its name.
        LinearLayout right = new LinearLayout(this);
        right.setOrientation(LinearLayout.HORIZONTAL);
        right.setGravity(Gravity.CENTER_VERTICAL);
        View search = Ui.roundButton(this, R.drawable.lx_search, getString(R.string.lx_search));
        search.setOnClickListener(v -> search());
        View inputs = Ui.roundButton(this, R.drawable.lx_input, getString(R.string.lx_inputs));
        inputs.setOnClickListener(v -> inputs());
        View gear = Ui.roundButton(this, R.drawable.lx_settings, getString(R.string.lx_settings));
        gear.setOnClickListener(v -> showPanel());
        for (View v : new View[]{search, inputs, gear}) {
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(d(Spec.ROUND), d(Spec.ROUND));
            lp.leftMargin = d(Spec.ROUND_GAP);
            right.addView(v, lp);
        }
        clock = Ui.text(this, "", 18, Ui.TEXT_DIM, Ui.REGULAR);
        LinearLayout.LayoutParams ck = new LinearLayout.LayoutParams(-2, -2);
        ck.leftMargin = d(14);
        right.addView(clock, ck);
        clock.setText(DateFormat.getTimeFormat(this).format(new Date()));
        FrameLayout.LayoutParams rl = new FrameLayout.LayoutParams(-2, d(Spec.ROUND), Gravity.TOP | Gravity.END);
        rl.topMargin = d(barMid - Spec.ROUND / 2f);
        rl.rightMargin = d(Spec.EDGE);
        page.addView(right, rl);
    }

    private void buildHero() {
        TextView kicker = Ui.text(this, getString(R.string.lx_hero_kicker), 12, Ui.TEXT_DIM, Ui.MEDIUM);
        place(page, kicker, Spec.EDGE, 252, -2, -2);
        TextView title = Ui.text(this, ourLabel(), 30, Ui.TEXT, Ui.REGULAR);
        place(page, title, Spec.EDGE, 268, 520, -2);
        TextView sub = Ui.text(this, getString(R.string.lx_hero_sub), 15, Ui.TEXT, Ui.MEDIUM);
        place(page, sub, Spec.EDGE, 320, 520, -2);
        TextView desc = Ui.text(this, getString(R.string.lx_hero_desc), 13, Ui.TEXT_DIM, Ui.REGULAR);
        place(page, desc, Spec.EDGE, 353, 520, -2);
        TextView open = Ui.text(this, getString(R.string.lx_open), 17, Ui.TEXT_ON_LIGHT, Ui.MEDIUM);
        open.setGravity(Gravity.CENTER);
        open.setFocusable(true);
        open.setId(View.generateViewId());
        float r = d(21.5f);
        open.setBackground(Ui.focusBg(Ui.round(Ui.FOCUS, r), Ui.round(0xFFDADCE0, r)));
        open.setPadding(d(24), 0, d(24), 0);
        open.setOnFocusChangeListener((v, f) -> { Ui.scale(open, f ? 1.06f : 1f); if (f) scroll.smoothScrollTo(0, 0); });
        open.setOnClickListener(v -> openOurApp());
        place(page, open, Spec.EDGE - 3, 395, -2, 43);
        openButton = open;
        open.setNextFocusUpId(homePill.getId());
    }

    /** Absolute placement in dp; -2 means wrap content. */
    private void place(FrameLayout parent, View v, int x, int y, int w, int h) {
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(w == -2 ? -2 : d(w), h == -2 ? -2 : d(h));
        lp.leftMargin = d(x);
        lp.topMargin = d(y);
        parent.addView(v, lp);
    }

    private void scrollToRow(int row) {
        int y = d(Spec.HERO_H + Spec.LABEL_GAP + Spec.rowY(row) - Spec.GRID_TOP_SCROLLED);
        scroll.smoothScrollTo(0, Math.max(0, y));
    }

    /** Scrolled past the hero: the top bar goes with the page and the fixed
     *  caret and "Your apps" heading fade in, as on Google TV. */
    private void onScrolled(int y) {
        float t = Math.max(0f, Math.min(1f, (y - d(Spec.HERO_H - 160)) / (float) d(120)));
        if (header != null) header.setAlpha(t);
        if (caret != null) caret.setAlpha(t);
        if (bigLabel != null) bigLabel.setAlpha(t);
        if (smallLabel != null) smallLabel.setAlpha(1f - t);
    }

    private void focusTile(String key) {
        for (Tile t : tiles) if (key.equals(t.key)) { t.requestFocus(); return; }
    }

    private void setPageFocusable(boolean on) {
        if (scroll != null) scroll.setDescendantFocusability(on ? ViewGroup.FOCUS_AFTER_DESCENDANTS : ViewGroup.FOCUS_BLOCK_DESCENDANTS);
    }

    // -------------------------------------------------------------- actions

    private void launch(String key) {
        if (key.equals(ourKey)) { openOurApp(); return; }
        Apps.App a = apps.get(key);
        if (a == null) return;
        start(Apps.launchIntent(a));
    }

    /** The regular ViktorychTV app, opened exactly as from the TV's own home. */
    private void openOurApp() {
        start(Apps.ourApp(this));
    }

    private boolean start(Intent i) {
        if (i == null) return false;
        try { startActivity(i); return true; }
        catch (RuntimeException e) { Toast.makeText(this, R.string.lx_not_available, Toast.LENGTH_SHORT).show(); return false; }
    }

    /** System search: Google TV's search, then the assistant, then voice. */
    private void search() {
        Intent[] tries = {
            new Intent("android.search.action.GLOBAL_SEARCH").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            new Intent(Intent.ACTION_ASSIST).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            new Intent(RecognizerIntent.ACTION_WEB_SEARCH).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        };
        for (Intent i : tries) if (Defaults.can(this, i) && start(i)) return;
        Toast.makeText(this, R.string.lx_not_available, Toast.LENGTH_SHORT).show();
    }

    /** The TV's input picker (HDMI and so on) where the TV has one. */
    private void inputs() {
        Intent[] tries = {
            new Intent("com.android.tv.action.VIEW_INPUTS"),
            new Intent("android.settings.TV_INPUT_SETTINGS"),
            new Intent("com.android.tv.settings.inputs.InputsActivity"),
        };
        for (Intent i : tries) {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (Defaults.can(this, i) && start(i)) return;
        }
        Toast.makeText(this, R.string.lx_no_inputs, Toast.LENGTH_SHORT).show();
    }

    private void settings(String action) {
        Intent i = new Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (!Defaults.can(this, i)) i = new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        start(i);
    }

    @Override
    public boolean onKeyDown(int code, KeyEvent e) {
        if (code == KeyEvent.KEYCODE_SEARCH) { search(); return true; }
        if (code == KeyEvent.KEYCODE_MENU) {
            View f = getCurrentFocus();
            if (f instanceof Tile) { menu((Tile) f, openFolder); return true; }
        }
        return super.onKeyDown(code, e);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (moving != null && e.getAction() == KeyEvent.ACTION_DOWN) {
            int step = 0;
            switch (e.getKeyCode()) {
                case KeyEvent.KEYCODE_DPAD_LEFT: step = -1; break;
                case KeyEvent.KEYCODE_DPAD_RIGHT: step = 1; break;
                case KeyEvent.KEYCODE_DPAD_UP: step = -Spec.COLS; break;
                case KeyEvent.KEYCODE_DPAD_DOWN: step = Spec.COLS; break;
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                case KeyEvent.KEYCODE_BACK:
                    endMove();
                    return true;
                default: return true;
            }
            moveBy(step);
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    // ----------------------------------------------------------- move mode

    private void startMove(Tile t) {
        moving = t;
        t.setLifted(true);
        hint = Ui.text(this, getString(R.string.lx_move_hint), 14, Ui.TEXT, Ui.MEDIUM);
        hint.setBackground(Ui.round(Ui.PANEL, d(18)));
        hint.setPadding(d(16), d(9), d(16), d(9));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        lp.bottomMargin = d(24);
        root.addView(hint, lp);
    }

    private void moveBy(int step) {
        String key = moving.key;
        boolean changed;
        if (openFolder != null) {
            int fi = model.indexOfFolder(openFolder);
            if (fi < 0) { endMove(); return; }
            int from = model.entries.get(fi).apps.indexOf(key);
            changed = model.moveInFolder(openFolder, from, from + step);
        } else {
            int from = indexOfKey(key);
            changed = model.move(from, from + step);
        }
        if (!changed) return;
        save();
        if (openFolder != null) { showFolder(openFolder, key); }
        else { build(); focusTile(key); }
        View f = getCurrentFocus();
        if (f instanceof Tile) { moving = (Tile) f; moving.setLifted(true); }
        if (hint != null) { root.removeView(hint); root.addView(hint); }
    }

    private int indexOfKey(String key) {
        for (int i = 0; i < model.entries.size(); i++) if (model.entries.get(i).key.equals(key)) return i;
        return -1;
    }

    private void endMove() {
        if (moving == null) return;
        moving.setLifted(false);
        moving = null;
        if (hint != null) { root.removeView(hint); hint = null; }
        save();
    }

    // -------------------------------------------------------------- menus

    private void menu(Tile t, String inFolder) {
        List<String> labels = new ArrayList<>();
        List<Runnable> acts = new ArrayList<>();
        if (t.folder) {
            LauncherModel.Entry f = model.entries.get(model.indexOfFolder(t.key));
            labels.add(getString(R.string.lx_menu_open)); acts.add(() -> showFolder(t.key, null));
            labels.add(getString(R.string.lx_menu_move)); acts.add(() -> startMove(t));
            labels.add(getString(R.string.lx_menu_rename)); acts.add(() -> rename(f));
            labels.add(getString(R.string.lx_menu_ungroup)); acts.add(() -> { model.ungroup(f.key); save(); build(); });
        } else {
            final String key = t.key;
            Apps.App a = apps.get(key);
            labels.add(getString(R.string.lx_menu_open)); acts.add(() -> launch(key));
            labels.add(getString(R.string.lx_menu_move)); acts.add(() -> startMove(t));
            if (inFolder != null) {
                labels.add(getString(R.string.lx_menu_remove_folder));
                acts.add(() -> { model.removeFromFolder(inFolder, key); save(); closeLayers(); build(); focusTile(key); });
            } else {
                labels.add(getString(R.string.lx_menu_add_folder)); acts.add(() -> pickFolder(key));
            }
            if (a != null) {
                labels.add(getString(R.string.lx_menu_info));
                acts.add(() -> start(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", a.component.getPackageName(), null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
            }
        }
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle(t.label.getText())
            .setItems(labels.toArray(new CharSequence[0]), (dlg, which) -> acts.get(which).run())
            .show();
    }

    private void pickFolder(String key) {
        List<LauncherModel.Entry> fs = model.folders();
        List<CharSequence> labels = new ArrayList<>();
        labels.add(getString(R.string.lx_menu_new_folder));
        for (LauncherModel.Entry f : fs) labels.add(folderName(f));
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle(R.string.lx_menu_add_folder)
            .setItems(labels.toArray(new CharSequence[0]), (dlg, which) -> {
                String id;
                if (which == 0) id = model.newFolder(key, "");
                else { id = fs.get(which - 1).key; model.addToFolder(key, id); }
                save();
                build();
                if (id != null) focusTile(id);
            })
            .show();
    }

    private void rename(LauncherModel.Entry f) {
        EditText in = new EditText(this);
        in.setSingleLine(true);
        in.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        in.setText(folderName(f));
        in.setSelectAllOnFocus(true);
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle(R.string.lx_rename_title)
            .setView(in)
            .setPositiveButton(R.string.lx_save, (dlg, w) -> { model.rename(f.key, in.getText().toString()); save(); build(); focusTile(f.key); })
            .setNegativeButton(R.string.lx_cancel, null)
            .show();
    }

    // ------------------------------------------------------------- folder

    /** A folder opens over the page with its apps in the same 5-column grid. */
    private void showFolder(String id, String focusKey) {
        int fi = model.indexOfFolder(id);
        if (fi < 0) { closeLayers(); return; }
        LauncherModel.Entry f = model.entries.get(fi);
        if (folderLayer != null) root.removeView(folderLayer);
        openFolder = id;
        folderLayer = new FrameLayout(this);
        folderLayer.setBackgroundColor(0xF2101114);
        folderLayer.setClipChildren(false);
        ScrollView sv = new ScrollView(this);
        sv.setVerticalScrollBarEnabled(false);
        FrameLayout grid = new FrameLayout(this);
        grid.setClipChildren(false);
        sv.setClipChildren(false);
        sv.addView(grid);
        TextView title = Ui.text(this, folderName(f), 22, Ui.TEXT, Ui.REGULAR);
        place(grid, title, Spec.EDGE, 64, -2, -2);
        Tile first = null, want = null;
        for (int i = 0; i < f.apps.size(); i++) {
            String key = f.apps.get(i);
            Apps.App a = apps.get(key);
            if (a == null) continue;
            Tile t = new Tile(this);
            t.setId(View.generateViewId());
            t.bindApp(a);
            t.setOnClickListener(v -> launch(key));
            t.setOnLongClickListener(v -> { menu(t, id); return true; });
            place(grid, t, Spec.colX(i % Spec.COLS), Spec.GRID_TOP_SCROLLED + Spec.rowY(i / Spec.COLS), Spec.TILE_W, Spec.TILE_H + 40);
            if (first == null) first = t;
            if (key.equals(focusKey)) want = t;
        }
        View spacer = new View(this);
        place(grid, spacer, 0, Spec.GRID_TOP_SCROLLED + Spec.rowY(Spec.rows(f.apps.size())), 1, 40);
        folderLayer.addView(sv, new FrameLayout.LayoutParams(-1, -1));
        root.addView(folderLayer, new FrameLayout.LayoutParams(-1, -1));
        setPageFocusable(false);
        if (want != null) want.requestFocus(); else if (first != null) first.requestFocus();
    }

    // -------------------------------------------------------- quick panel

    /** The settings panel that slides in from the right, like Google TV's. */
    private void showPanel() {
        if (panel != null) return;
        panel = new FrameLayout(this);
        panel.setBackgroundColor(0x99000000);
        panel.setClickable(true);
        FrameLayout card = new FrameLayout(this);
        card.setBackground(Ui.round(Ui.PANEL, d(16)));
        FrameLayout.LayoutParams cl = new FrameLayout.LayoutParams(d(Spec.PANEL_W), -1, Gravity.END);
        cl.topMargin = d(16); cl.bottomMargin = d(18); cl.rightMargin = d(25);
        panel.addView(card, cl);

        Date now = new Date();
        TextView date = Ui.text(this, DateFormat.format("EEE, MMM d", now), 12, Ui.TEXT_DIM, Ui.REGULAR);
        place(card, date, 15, 26, -2, -2);
        TextView time = Ui.text(this, DateFormat.getTimeFormat(this).format(now), 20, Ui.TEXT, Ui.MEDIUM);
        place(card, time, 15, 46, -2, -2);
        Ui.RoundButton gear = Ui.roundButton(this, R.drawable.lx_settings, getString(R.string.lx_settings));
        gear.setOnClickListener(v -> settings(Settings.ACTION_SETTINGS));
        place(card, gear, Spec.PANEL_W - 15 - 32 - 8 - 28, 28, 32, 32);
        TextView gl = Ui.text(this, getString(R.string.lx_settings), 10, Ui.TEXT_DIM, Ui.REGULAR);
        gl.setGravity(Gravity.CENTER);
        place(card, gl, Spec.PANEL_W - 15 - 32 - 8 - 28 - 14, 64, 60, -2);
        TextView av = Ui.text(this, "V", 13, 0xFFFFFFFF, Ui.MEDIUM);
        av.setGravity(Gravity.CENTER);
        av.setBackground(Ui.oval(Ui.ACCENT));
        place(card, av, Spec.PANEL_W - 15 - 28, 30, 28, 28);

        Object[][] items = {
            {R.drawable.lx_photo, R.string.lx_screensaver, (Runnable) () -> settings(Settings.ACTION_DREAM_SETTINGS)},
            {R.drawable.lx_wifi, R.string.lx_wifi, (Runnable) () -> settings(Settings.ACTION_WIFI_SETTINGS)},
            {R.drawable.lx_accessibility, R.string.lx_accessibility, (Runnable) () -> settings(Settings.ACTION_ACCESSIBILITY_SETTINGS)},
            {R.drawable.lx_bluetooth, R.string.lx_bluetooth, (Runnable) () -> settings(Settings.ACTION_BLUETOOTH_SETTINGS)},
            {R.drawable.lx_input, R.string.lx_inputs, (Runnable) this::inputs},
            {R.drawable.lx_home, R.string.lx_make_default, (Runnable) () -> start(new Intent(this, DefaultsActivity.class))},
        };
        int tw = (Spec.PANEL_W - 30 - 8) / 2;
        for (int i = 0; i < items.length; i++) {
            View tile = panelTile((Integer) items[i][0], getString((Integer) items[i][1]), (Runnable) items[i][2]);
            place(card, tile, 15 + (i % 2) * (tw + 8), 101 + (i / 2) * 60, tw, 52);
        }
        View open = panelTile(R.drawable.lx_tv, getString(R.string.lx_open_app), this::openOurApp);
        place(card, open, 15, 101 + 3 * 60 + 8, Spec.PANEL_W - 30, 52);

        TextView brand = Ui.text(this, ourLabel(), 13, Ui.TEXT_DIM, Ui.MEDIUM);
        FrameLayout.LayoutParams bl = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.START);
        bl.leftMargin = d(15); bl.bottomMargin = d(16);
        card.addView(brand, bl);

        root.addView(panel, new FrameLayout.LayoutParams(-1, -1));
        setPageFocusable(false);
        card.setTranslationX(d(Spec.PANEL_W));
        card.animate().translationX(0).setDuration(200).start();
        gear.requestFocus();
    }

    private View panelTile(int icon, String text, Runnable act) {
        LinearLayout t = new LinearLayout(this);
        t.setOrientation(LinearLayout.HORIZONTAL);
        t.setGravity(Gravity.CENTER_VERTICAL);
        t.setFocusable(true);
        t.setPadding(d(14), 0, d(10), 0);
        float r = d(12);
        t.setBackground(Ui.focusBg(Ui.round(Ui.FOCUS, r), Ui.round(Ui.PANEL_TILE, r)));
        ImageView iv = Ui.icon(this, icon, 18, Ui.TEXT);
        t.addView(iv, new LinearLayout.LayoutParams(d(18), d(18)));
        TextView tv = Ui.text(this, text, 13, Ui.TEXT, Ui.REGULAR);
        tv.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1f);
        lp.leftMargin = d(10);
        t.addView(tv, lp);
        t.setOnFocusChangeListener((v, f) -> { int c = f ? Ui.TEXT_ON_LIGHT : Ui.TEXT; iv.setColorFilter(c); tv.setTextColor(c); });
        t.setOnClickListener(v -> act.run());
        return t;
    }

    /** ScrollView that only scrolls where we tell it (rows rest at fixed places). */
    private final class Scroller extends ScrollView {
        Scroller(Context c) { super(c); }
        @Override protected int computeScrollDeltaToGetChildRectOnScreen(android.graphics.Rect r) { return 0; }
        @Override protected void onScrollChanged(int l, int t, int ol, int ot) {
            super.onScrollChanged(l, t, ol, ot);
            if (this == scroll) onScrolled(t);
        }
    }
}
