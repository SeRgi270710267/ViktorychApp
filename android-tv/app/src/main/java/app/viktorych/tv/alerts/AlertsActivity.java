package app.viktorych.tv.alerts;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.TextUtils;
import android.text.style.StyleSpan;
import android.util.LruCache;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.graphics.drawable.StateListDrawable;
import android.widget.TextView;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import app.viktorych.tv.BuildConfig;
import app.viktorych.tv.R;
import app.viktorych.tv.launcher.Ui;

/** Alerts: DMs, mentions and Live alerts from the account linked to this TV.
 *  It only talks to the server while it is on screen (a check when it opens, then
 *  once a minute until you leave). OK on an alert opens it in the app. */
public class AlertsActivity extends Activity {
    private static final long REFRESH_MS = 60_000;
    private static final ExecutorService NET = Executors.newSingleThreadExecutor();
    private static final ExecutorService PICS = Executors.newFixedThreadPool(2);
    private static final LruCache<String, Bitmap> AVATARS = new LruCache<>(80);

    protected final Handler main = new Handler(Looper.getMainLooper());
    protected FrameLayout root;
    protected boolean visible;
    protected int gen;

    // Linking.
    private String pollSecret, code;
    private long pollEvery = 4000, codeUntil;

    // The list.
    private List<AlertModel.Note> all = new ArrayList<>();
    private List<AlertModel.Note> shown = new ArrayList<>();
    private AlertModel.Tab tab = AlertModel.Tab.ALL;
    private LinearLayout tabs;
    private ListView list;
    private TextView empty, status;
    private Adapter adapter;

    protected int d(float v) { return Ui.dp(this, v); }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        gen++;
        if (Session.linked(this)) showLinked(); else showLink();
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Nothing keeps checking once the panel is off screen.
        visible = false;
        gen++;
        main.removeCallbacksAndMessages(null);
    }

    // ------------------------------------------------------------------ linking

    /** What a linked TV shows. The Cast screen (CastActivity) shares the linking. */
    protected void showLinked() { showList(); }

    protected int linkIcon() { return R.drawable.al_bell; }
    protected int linkTitle() { return R.string.al_link_title; }
    protected int linkNote() { return R.string.al_link_note; }

    protected void showLink() {
        root.removeAllViews();
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(d(80), d(56), d(80), d(32));
        col.addView(Ui.icon(this, linkIcon(), 40, Ui.TEXT), new LinearLayout.LayoutParams(d(40), d(40)));
        TextView title = Ui.text(this, getString(linkTitle()), 28, Ui.TEXT, Ui.REGULAR);
        title.setPadding(0, d(16), 0, 0);
        col.addView(title);
        TextView steps = Ui.text(this, getString(R.string.al_link_steps), 16, Ui.TEXT_DIM, Ui.REGULAR);
        steps.setSingleLine(false);
        steps.setPadding(0, d(12), 0, 0);
        col.addView(steps);
        TextView address = Ui.text(this, AlertModel.pairAddress(code), 30, Ui.TEXT, Ui.MEDIUM);
        address.setPadding(0, d(28), 0, 0);
        col.addView(address);
        TextView codeView = Ui.text(this, code == null ? getString(R.string.al_link_wait) : getString(R.string.al_link_code, AlertModel.showCode(code)), 18, Ui.TEXT_DIM, Ui.REGULAR);
        codeView.setPadding(0, d(10), 0, 0);
        col.addView(codeView);
        TextView or = Ui.text(this, getString(R.string.al_link_or), 15, Ui.TEXT_DIM, Ui.REGULAR);
        or.setSingleLine(false);
        or.setPadding(0, d(18), 0, 0);
        col.addView(or);
        status = Ui.text(this, "", 14, 0xFF8AB4F8, Ui.REGULAR);
        status.setSingleLine(false);
        status.setPadding(0, d(20), 0, 0);
        col.addView(status);
        TextView note = Ui.text(this, getString(linkNote()), 13, Ui.TEXT_DIM, Ui.REGULAR);
        note.setSingleLine(false);
        note.setPadding(0, d(24), 0, 0);
        col.addView(note);
        TextView again = Ui.pill(this, getString(R.string.al_new_code), false);
        again.setOnClickListener(v -> { code = null; pollSecret = null; showLink(); });
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(-2, d(40));
        ap.topMargin = d(20);
        col.addView(again, ap);
        root.addView(col, new FrameLayout.LayoutParams(-1, -1));
        again.requestFocus();
        if (code == null || System.currentTimeMillis() > codeUntil) newCode(); else schedulePoll();
    }

    private void newCode() {
        final int g = gen;
        NET.execute(() -> {
            String c = null, secret = null;
            long every = 4000, until = 0;
            boolean busy = false;
            try {
                Session.Reply r = Session.start(this);
                if (r.status == 200) {
                    Map<String, Object> m = Json.obj(Json.parse(r.body));
                    c = AlertModel.cleanCode(Json.str(m, "code"));
                    secret = Json.str(m, "poll");
                    every = Math.max(3, Json.num(m, "interval")) * 1000L;
                    until = System.currentTimeMillis() + Math.max(60, Json.num(m, "expiresIn")) * 1000L;
                } else busy = r.status == 429;
            } catch (IOException | RuntimeException e) { /* shown below */ }
            final String fc = c, fs = secret;
            final long fe = every, fu = until;
            final boolean fb = busy;
            main.post(() -> {
                if (g != gen || !visible) return;
                if (fc == null || fc.isEmpty() || fs == null || fs.isEmpty()) {
                    status.setText(fb ? R.string.al_busy : R.string.al_offline);
                    main.postDelayed(() -> { if (g == gen) newCode(); }, 15000);
                    return;
                }
                code = fc; pollSecret = fs; pollEvery = fe; codeUntil = fu;
                showLink();
            });
        });
    }

    private void schedulePoll() {
        final int g = gen;
        main.postDelayed(() -> { if (g == gen && visible) poll(); }, pollEvery);
    }

    private void poll() {
        final int g = gen;
        final String secret = pollSecret;
        if (secret == null) return;
        NET.execute(() -> {
            int st = -1;
            String token = "", name = "";
            try {
                Session.Reply r = Session.poll(this, secret);
                st = r.status;
                if (st == 200) {
                    Map<String, Object> m = Json.obj(Json.parse(r.body));
                    token = Json.str(m, "token");
                    Map<String, Object> acc = Json.obj(m.get("account"));
                    name = Json.str(acc, "displayName");
                    if (name.isEmpty()) name = Json.str(acc, "handle");
                }
            } catch (IOException | RuntimeException e) { st = -1; }
            final int fst = st;
            final String ft = token, fn = name;
            main.post(() -> {
                if (g != gen || !visible) return;
                if (fst == 200 && !ft.isEmpty()) {
                    Session.save(this, ft, fn);
                    code = null; pollSecret = null;
                    showLinked();
                } else if (fst == 403) {
                    code = null; pollSecret = null;
                    showLink();
                    status.setText(R.string.al_denied);
                } else if (fst == 410) {
                    code = null; pollSecret = null;
                    showLink();
                } else {
                    if (fst == -1) status.setText(R.string.al_offline);
                    schedulePoll();
                }
            });
        });
    }

    // ------------------------------------------------------------------ list

    private void showList() {
        root.removeAllViews();
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(d(48), d(32), d(48), 0);

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);
        head.addView(Ui.text(this, getString(R.string.al_title), 28, Ui.TEXT, Ui.REGULAR));
        String who = Session.accountName(this);
        TextView acct = Ui.text(this, who, 15, Ui.TEXT_DIM, Ui.REGULAR);
        acct.setPadding(d(16), 0, 0, 0);
        head.addView(acct, new LinearLayout.LayoutParams(0, -2, 1f));
        TextView read = Ui.pill(this, getString(R.string.al_mark_read), false);
        read.setOnClickListener(v -> markAllRead());
        head.addView(read, new LinearLayout.LayoutParams(-2, d(40)));
        TextView refresh = Ui.pill(this, getString(R.string.al_refresh), false);
        refresh.setOnClickListener(v -> load(true));
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(-2, d(40));
        rp.leftMargin = d(10);
        head.addView(refresh, rp);
        col.addView(head);

        tabs = new LinearLayout(this);
        tabs.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-2, -2);
        tp.topMargin = d(18);
        col.addView(tabs, tp);

        status = Ui.text(this, "", 13, Ui.TEXT_DIM, Ui.REGULAR);
        status.setPadding(0, d(8), 0, 0);
        col.addView(status);
        empty = Ui.text(this, getString(R.string.al_loading), 16, Ui.TEXT_DIM, Ui.REGULAR);
        empty.setSingleLine(false);
        empty.setPadding(0, d(24), 0, 0);
        col.addView(empty);

        list = new ListView(this);
        list.setDivider(null);
        list.setDividerHeight(d(4));
        list.setSelector(new StateListDrawable());
        list.setClipToPadding(false);
        list.setPadding(0, d(6), 0, d(24));
        adapter = new Adapter();
        list.setAdapter(adapter);
        list.setOnItemClickListener((p, v, pos, id) -> openNote(shown.get(pos)));
        list.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) { adapter.notifyDataSetChanged(); }
            @Override public void onNothingSelected(AdapterView<?> p) { adapter.notifyDataSetChanged(); }
        });
        list.setOnFocusChangeListener((v, f) -> adapter.notifyDataSetChanged());
        col.addView(list, new LinearLayout.LayoutParams(-1, 0, 1f));
        root.addView(col, new FrameLayout.LayoutParams(-1, -1));
        paintTabs();
        render();
        load(false);
    }

    private void paintTabs() {
        View had = getCurrentFocus();
        boolean refocus = had != null && had.getParent() == tabs;
        tabs.removeAllViews();
        int[] names = {R.string.al_tab_all, R.string.al_tab_messages, R.string.al_tab_mentions, R.string.al_tab_live};
        AlertModel.Tab[] ts = AlertModel.Tab.values();
        for (int k = 0; k < ts.length; k++) {
            AlertModel.Tab t = ts[k];
            int n = AlertModel.unreadIn(all, t);
            String label = getString(names[k]) + (n > 0 ? "  " + (n > 99 ? "99+" : n) : "");
            TextView p = Ui.pill(this, label, t == tab);
            p.setOnClickListener(v -> { tab = t; paintTabs(); render(); });
            p.setOnFocusChangeListener((v, f) -> {
                p.setTextColor(f ? Ui.TEXT_ON_LIGHT : Ui.TEXT);
                if (f && tab != t) { tab = t; render(); repaintTabSelection(); }
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, d(40));
            lp.rightMargin = d(10);
            tabs.addView(p, lp);
            if (refocus && t == tab) p.requestFocus();
        }
    }

    private void repaintTabSelection() {
        AlertModel.Tab[] ts = AlertModel.Tab.values();
        for (int k = 0; k < tabs.getChildCount() && k < ts.length; k++) {
            float r = d(20);
            tabs.getChildAt(k).setBackground(Ui.focusBg(Ui.round(Ui.FOCUS, r), Ui.round(ts[k] == tab ? Ui.PILL_SELECTED : 0, r)));
        }
    }

    private void render() {
        shown = AlertModel.filter(all, tab);
        adapter.notifyDataSetChanged();
        if (!loaded) return;
        empty.setText(tab == AlertModel.Tab.ALL ? R.string.al_empty : R.string.al_empty_tab);
        empty.setVisibility(shown.isEmpty() ? View.VISIBLE : View.GONE);
    }

    private boolean loaded;

    private void load(boolean byHand) {
        final int g = gen;
        main.removeCallbacksAndMessages(null);
        if (byHand) status.setText(R.string.al_loading);
        NET.execute(() -> {
            AlertModel.View view = null;
            int st = -1;
            try {
                Session.Reply r = Session.notes(this);
                st = r.status;
                if (st == 200) view = AlertModel.parse(r.body);
            } catch (IOException | RuntimeException e) { st = -1; }
            final AlertModel.View fv = view;
            final int fst = st;
            main.post(() -> {
                if (g != gen || !visible) return;
                if (fst == 401) { showLink(); return; }
                if (fv != null) {
                    all = fv.notes;
                    loaded = true;
                    status.setText("");
                    paintTabs();
                    render();
                    if (getCurrentFocus() == null || getCurrentFocus() == list) list.requestFocus();
                    if (getCurrentFocus() == null && tabs.getChildCount() > 0) tabs.getChildAt(0).requestFocus();
                } else {
                    status.setText(fst == 429 ? R.string.al_busy : R.string.al_offline);
                    if (!loaded) { empty.setText(R.string.al_offline); empty.setVisibility(View.VISIBLE); }
                    if (getCurrentFocus() == null && tabs.getChildCount() > 0) tabs.getChildAt(0).requestFocus();
                }
                main.postDelayed(() -> { if (g == gen && visible) load(false); }, REFRESH_MS);
            });
        });
    }

    private void markAllRead() {
        final int g = gen;
        for (int k = 0; k < all.size(); k++) {
            AlertModel.Note n = all.get(k);
            if (!n.read) all.set(k, new AlertModel.Note(n.id, n.kind, n.name, n.handle, n.text, n.avatar, n.hash, n.at, true, n.others));
        }
        paintTabs();
        render();
        NET.execute(() -> {
            try { Session.markAllRead(this); } catch (IOException | RuntimeException ignored) { }
            main.post(() -> { if (g == gen && visible) load(false); });
        });
    }

    private void openNote(AlertModel.Note n) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(AlertModel.siteUrl(BuildConfig.START_URL, n.hash)))
            .setClassName(this, "app.viktorych.tv.TvLauncherActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(i);
    }

    private CharSequence sentence(AlertModel.Note n) {
        String who = n.who().isEmpty() ? getString(R.string.al_someone) : n.who();
        String s;
        switch (AlertModel.line(n.kind, n.others)) {
            case LIKE: s = getString(R.string.al_k_like, who); break;
            case LIKE_MANY: s = getString(R.string.al_k_like_many, who, n.others); break;
            case REPOST: s = getString(R.string.al_k_repost, who); break;
            case REPOST_MANY: s = getString(R.string.al_k_repost_many, who, n.others); break;
            case QUOTE: s = getString(R.string.al_k_quote, who); break;
            case REPLY: s = getString(R.string.al_k_reply, who); break;
            case MENTION: s = getString(R.string.al_k_mention, who); break;
            case DM: s = getString(R.string.al_k_dm, who); break;
            case DISCORD: s = getString(R.string.al_k_discord); break;
            case FOLLOW: s = getString(R.string.al_k_follow, who); break;
            case FOLLOW_REQUEST: s = getString(R.string.al_k_follow_request, who); break;
            case FOLLOW_ACCEPT: s = getString(R.string.al_k_follow_accept, who); break;
            case FRIEND_REQUEST: s = getString(R.string.al_k_friend_request, who); break;
            case FRIEND_ACCEPT: s = getString(R.string.al_k_friend_accept, who); break;
            case LIVE: s = getString(R.string.al_k_live, who); break;
            case BIRTHDAY: s = getString(R.string.al_k_birthday, who); break;
            case POST: s = getString(R.string.al_k_post, who); break;
            default: s = getString(R.string.al_k_other, who); break;
        }
        SpannableStringBuilder b = new SpannableStringBuilder(s);
        int at = s.indexOf(who);
        if (at >= 0 && !n.who().isEmpty()) b.setSpan(new StyleSpan(Typeface.BOLD), at, at + who.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return b;
    }

    private String ago(long at) {
        long[] a = AlertModel.ago(System.currentTimeMillis(), at);
        switch ((int) a[1]) {
            case 0: return getString(R.string.al_now);
            case 1: return getString(R.string.al_min, a[0]);
            case 2: return getString(R.string.al_hour, a[0]);
            case 3: return getString(R.string.al_day, a[0]);
            default: return getString(R.string.al_week, a[0]);
        }
    }

    private int iconFor(String kind) {
        switch (AlertModel.tab(kind)) {
            case MESSAGES: return R.drawable.al_mail;
            case MENTIONS: return R.drawable.al_at;
            case LIVE: return R.drawable.al_live;
            default: return R.drawable.al_bell;
        }
    }

    private void avatar(ImageView v, AlertModel.Note n) {
        v.setTag(n.avatar);
        Bitmap hit = n.avatar.isEmpty() ? null : AVATARS.get(n.avatar);
        if (hit != null) { v.setImageBitmap(hit); v.setPadding(0, 0, 0, 0); v.setColorFilter(null); return; }
        int pad = d(10);
        v.setPadding(pad, pad, pad, pad);
        v.setImageResource(iconFor(n.kind));
        v.setColorFilter(Ui.TEXT);
        if (n.avatar.isEmpty()) return;
        final String url = n.avatar;
        PICS.execute(() -> {
            Bitmap bm = fetch(url);
            if (bm == null) return;
            AVATARS.put(url, bm);
            main.post(() -> {
                if (!url.equals(v.getTag())) return;
                v.setPadding(0, 0, 0, 0);
                v.setColorFilter(null);
                v.setImageBitmap(bm);
            });
        });
    }

    private static Bitmap fetch(String url) {
        HttpURLConnection h = null;
        try {
            h = (HttpURLConnection) new URL(url).openConnection();
            h.setConnectTimeout(8000);
            h.setReadTimeout(10000);
            if (h.getResponseCode() != 200 || h.getContentLength() > 2 * 1024 * 1024) return null;
            try (InputStream in = h.getInputStream()) {
                BitmapFactory.Options o = new BitmapFactory.Options();
                o.inPreferredConfig = Bitmap.Config.RGB_565;
                Bitmap full = BitmapFactory.decodeStream(in, null, o);
                if (full == null) return null;
                int side = 96;
                return full.getWidth() <= side ? full : Bitmap.createScaledBitmap(full, side, side * full.getHeight() / full.getWidth(), true);
            }
        } catch (IOException | RuntimeException e) {
            return null;
        } finally {
            if (h != null) h.disconnect();
        }
    }

    private final class Adapter extends BaseAdapter {
        @Override public int getCount() { return shown.size(); }
        @Override public Object getItem(int p) { return shown.get(p); }
        @Override public long getItemId(int p) { return p; }

        @Override
        public View getView(int pos, View convert, ViewGroup parent) {
            LinearLayout row = (LinearLayout) convert;
            if (row == null) {
                row = new LinearLayout(AlertsActivity.this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setGravity(Gravity.CENTER_VERTICAL);
                row.setPadding(d(14), d(10), d(18), d(10));
                row.setLayoutParams(new ListView.LayoutParams(-1, -2));
                ImageView pic = new ImageView(AlertsActivity.this);
                pic.setScaleType(ImageView.ScaleType.CENTER_CROP);
                pic.setBackground(Ui.oval(0xFF2B2E33));
                pic.setClipToOutline(true);
                row.addView(pic, new LinearLayout.LayoutParams(d(44), d(44)));
                LinearLayout texts = new LinearLayout(AlertsActivity.this);
                texts.setOrientation(LinearLayout.VERTICAL);
                TextView line = Ui.text(AlertsActivity.this, "", 16, Ui.TEXT, Ui.REGULAR);
                line.setSingleLine(true);
                line.setEllipsize(TextUtils.TruncateAt.END);
                texts.addView(line);
                TextView body = Ui.text(AlertsActivity.this, "", 14, Ui.TEXT_DIM, Ui.REGULAR);
                body.setMaxLines(2);
                body.setSingleLine(false);
                body.setEllipsize(TextUtils.TruncateAt.END);
                texts.addView(body);
                LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(0, -2, 1f);
                tl.leftMargin = d(16);
                row.addView(texts, tl);
                TextView when = Ui.text(AlertsActivity.this, "", 13, Ui.TEXT_DIM, Ui.REGULAR);
                LinearLayout.LayoutParams wl = new LinearLayout.LayoutParams(-2, -2);
                wl.leftMargin = d(16);
                row.addView(when, wl);
                View dot = new View(AlertsActivity.this);
                dot.setBackground(Ui.oval(0xFF1D9BF0));
                LinearLayout.LayoutParams dl = new LinearLayout.LayoutParams(d(10), d(10));
                dl.leftMargin = d(12);
                row.addView(dot, dl);
            }
            AlertModel.Note n = shown.get(pos);
            boolean sel = list.hasFocus() && list.getSelectedItemPosition() == pos;
            row.setBackground(Ui.round(sel ? 0xFFE8EAED : 0x00000000, d(14)));
            avatar((ImageView) row.getChildAt(0), n);
            LinearLayout texts = (LinearLayout) row.getChildAt(1);
            TextView line = (TextView) texts.getChildAt(0), body = (TextView) texts.getChildAt(1);
            line.setText(sentence(n));
            line.setTextColor(sel ? Ui.TEXT_ON_LIGHT : Ui.TEXT);
            body.setText(n.text);
            body.setVisibility(n.text.isEmpty() ? View.GONE : View.VISIBLE);
            body.setTextColor(sel ? 0xB3202124 : Ui.TEXT_DIM);
            TextView when = (TextView) row.getChildAt(2);
            when.setText(n.at > 0 ? ago(n.at) : "");
            when.setTextColor(sel ? 0xB3202124 : Ui.TEXT_DIM);
            row.getChildAt(3).setVisibility(n.read ? View.INVISIBLE : View.VISIBLE);
            return row;
        }
    }
}
