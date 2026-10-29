package app.viktorych.tv;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.Base64;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import app.viktorych.tv.mesh.BleMesh;
import app.viktorych.tv.mesh.Crypto;
import app.viktorych.tv.mesh.MeshCore;
import app.viktorych.tv.mesh.NostrRelay;
import app.viktorych.tv.mesh.NostrSign;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Nearby chat, compatible with Bitchat (public-domain protocol by
 *  permissionlesstech). A fallback: the site offers it only when every normal
 *  path is down, and nothing here runs unless this screen is open. Bluetooth
 *  is asked for only when the user presses Allow. */
public class MeshActivity extends Activity implements MeshCore.Listener, NostrRelay.Listener, BleMesh.Status {
    static final String PREFS = "mesh";
    static final int REQ_PERMS = 7, REQ_ENABLE = 8;

    SharedPreferences prefs;
    MeshCore core; BleMesh ble; NostrRelay nostr;
    TextView status, log; ScrollView logScroll; EditText input; Button target, allow;
    final List<String> lines = new ArrayList<>();
    final Map<String, String> pendingNames = new HashMap<>();
    String to = "mesh"; // "mesh", "area" or a peer id
    int links; boolean advertising; int relaysUp, relaysTotal;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        build();
    }

    /* ---------------- layout (all D-pad reachable) ---------------- */
    void build() {
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(16, 18, 22)); int pad = dp(28); root.setPadding(pad, dp(20), pad, dp(20));
        TextView title = text(getString(R.string.mesh_title), 24); root.addView(title);
        if (off()) {
            root.addView(text(getString(R.string.mesh_intro), 16));
            root.addView(text(getString(R.string.mesh_turned_off), 16));
            LinearLayout row = row(); root.addView(row);
            Button on = button(getString(R.string.mesh_on), v -> { prefs.edit().putString("mode", "auto").apply(); build(); startAll(); });
            row.addView(on); row.addView(button(getString(R.string.mesh_back), v -> finish()));
            setContentView(root); on.requestFocus(); return;
        }
        status = text("", 15); status.setTextColor(Color.rgb(170, 180, 190)); root.addView(status);
        HorizontalScrollView hs = new HorizontalScrollView(this); LinearLayout row = row(); hs.addView(row); root.addView(hs);
        allow = button(getString(R.string.mesh_allow), v -> askBluetooth()); row.addView(allow);
        target = button("", v -> pickTarget()); row.addView(target);
        row.addView(button(getString(R.string.mesh_name), v -> editName()));
        row.addView(button(getString(R.string.mesh_area), v -> editArea()));
        row.addView(button(getString(R.string.mesh_relays), v -> editRelays()));
        row.addView(button(getString(R.string.mesh_off), v -> { prefs.edit().putString("mode", "off").apply(); stopAll(); build(); }));
        row.addView(button(getString(R.string.mesh_wipe), v -> wipe()));
        logScroll = new ScrollView(this); logScroll.setFocusable(false);
        log = text(getString(R.string.mesh_intro), 17); log.setTextIsSelectable(false); logScroll.addView(log);
        root.addView(logScroll, new LinearLayout.LayoutParams(-1, 0, 1f));
        LinearLayout in = row(); root.addView(in);
        input = new EditText(this); input.setHint(R.string.mesh_hint); input.setTextColor(Color.WHITE); input.setHintTextColor(Color.GRAY);
        input.setSingleLine(true); input.setImeOptions(EditorInfo.IME_ACTION_SEND);
        input.setOnEditorActionListener((v, id, ev) -> { if (id == EditorInfo.IME_ACTION_SEND || (ev != null && ev.getKeyCode() == KeyEvent.KEYCODE_ENTER)) { send(); return true; } return false; });
        in.addView(input, new LinearLayout.LayoutParams(0, -2, 1f));
        in.addView(button(getString(R.string.mesh_send), v -> send()));
        setContentView(root);
        if (!lines.isEmpty()) log.setText(join());
        refresh(); input.requestFocus();
    }
    LinearLayout row() { LinearLayout r = new LinearLayout(this); r.setOrientation(LinearLayout.HORIZONTAL); r.setGravity(Gravity.CENTER_VERTICAL); return r; }
    TextView text(String s, int sp) { TextView t = new TextView(this); t.setText(s); t.setTextSize(sp); t.setTextColor(Color.WHITE); t.setPadding(0, dp(4), 0, dp(4)); return t; }
    Button button(String s, View.OnClickListener l) { Button b = new Button(this); b.setText(s); b.setAllCaps(false); b.setOnClickListener(l); return b; }
    int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    boolean off() { return "off".equals(prefs.getString("mode", "auto")); }

    /* ---------------- identity, kept only on this TV ---------------- */
    byte[] key(String name) {
        String s = prefs.getString(name, null);
        if (s != null) return Base64.decode(s, Base64.NO_WRAP);
        byte[] k = Crypto.random(32);
        prefs.edit().putString(name, Base64.encodeToString(k, Base64.NO_WRAP)).apply();
        return k;
    }
    String nick() { return prefs.getString("nick", ""); }
    void wipe() {
        stopAll();
        prefs.edit().remove("noise").remove("ed").remove("nostr").apply();
        lines.clear(); to = "mesh";
        toast(getString(R.string.mesh_wiped)); build(); startAll();
    }

    /* ---------------- lifecycle: idle unless this screen is open ---------------- */
    @Override protected void onStart() { super.onStart(); startAll(); }
    @Override protected void onStop() { stopAll(); super.onStop(); }

    void startAll() {
        if (off() || core != null) return;
        core = new MeshCore(key("noise"), key("ed"), "");
        if (nick().isEmpty()) prefs.edit().putString("nick", "tv" + core.myHex.substring(0, 4)).apply();
        core.setNickname(nick()); core.setListener(this);
        startBle(); startNostr(); refresh();
    }
    void stopAll() {
        if (ble != null) { if (core != null) core.leave(); ble.stop(); ble = null; }
        if (nostr != null) { nostr.stop(); nostr = null; }
        if (core != null) { core.shutdown(); core = null; }
        links = 0; relaysUp = 0;
    }
    void startBle() {
        if (core == null || ble != null || !granted()) return;
        BleMesh.Support s = BleMesh.support(this);
        if (s == BleMesh.Support.FULL || s == BleMesh.Support.CENTRAL_ONLY) {
            ble = new BleMesh(this, core, this); ble.start();
            core.announce(); scheduleAnnounce();
        }
    }
    final Runnable announcer = new Runnable() { @Override public void run() {
        if (core == null || ble == null) return;
        core.announce();
        // Often while alone, then slower once connected, to save power.
        status.postDelayed(this, links == 0 ? 5_000 : 20_000);
    } };
    void scheduleAnnounce() { status.removeCallbacks(announcer); status.postDelayed(announcer, 3_000); }
    void startNostr() {
        String g = prefs.getString("geohash", "");
        if (core == null || nostr != null || !NostrSign.isGeohash(g)) return;
        nostr = new NostrRelay(key("nostr"), g, relays(), this); nostr.start();
    }
    List<String> relays() {
        String s = prefs.getString("relays", null);
        if (s == null) return Arrays.asList(NostrRelay.DEFAULT_RELAYS);
        List<String> out = new ArrayList<>();
        for (String r : s.split("\\s+")) if (r.startsWith("wss://")) out.add(r);
        return out;
    }

    /* ---------------- permissions, asked only on demand ---------------- */
    String[] perms() {
        if (Build.VERSION.SDK_INT >= 31) return new String[] { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE };
        if (Build.VERSION.SDK_INT >= 23) return new String[] { Manifest.permission.ACCESS_FINE_LOCATION };
        return new String[0];
    }
    boolean granted() {
        if (Build.VERSION.SDK_INT < 23) return true;
        for (String p : perms()) {
            if (Manifest.permission.BLUETOOTH_ADVERTISE.equals(p)) continue; // optional: without it we run central-only
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }
    void askBluetooth() {
        BleMesh.Support s = BleMesh.support(this);
        if (s == BleMesh.Support.NONE) { toast(getString(R.string.mesh_no_ble)); return; }
        if (!granted() && Build.VERSION.SDK_INT >= 23) { requestPermissions(perms(), REQ_PERMS); return; }
        if (s == BleMesh.Support.OFF) {
            try { startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), REQ_ENABLE); }
            catch (RuntimeException e) { toast(getString(R.string.mesh_bt_off)); }
            return;
        }
        startBle(); refresh();
    }
    @Override public void onRequestPermissionsResult(int code, String[] p, int[] r) {
        if (code != REQ_PERMS) return;
        if (!granted()) { toast(getString(R.string.mesh_perm_denied)); refresh(); return; }
        if (Build.VERSION.SDK_INT < 31) addLine(getString(R.string.mesh_location_note));
        askBluetooth();
    }
    @Override protected void onActivityResult(int code, int result, Intent data) { if (code == REQ_ENABLE) { startBle(); refresh(); } }

    /* ---------------- status line ---------------- */
    void refresh() {
        if (status == null || off()) return;
        StringBuilder s = new StringBuilder();
        BleMesh.Support sup = BleMesh.support(this);
        if (sup == BleMesh.Support.NONE) s.append(getString(R.string.mesh_no_ble));
        else if (!granted()) s.append(getString(R.string.mesh_need_allow));
        else if (sup == BleMesh.Support.OFF) s.append(getString(R.string.mesh_bt_off));
        else {
            int nearby = core == null ? 0 : core.peers().size();
            s.append(getString(R.string.mesh_status, nearby, links));
            if (ble != null && !advertising) s.append('\n').append(getString(R.string.mesh_central_only));
        }
        s.append('\n').append(nostr == null ? getString(R.string.mesh_nostr_off) : getString(R.string.mesh_nostr_status, relaysUp, relaysTotal));
        status.setText(s);
        allow.setVisibility(ble == null && sup != BleMesh.Support.NONE ? View.VISIBLE : View.GONE);
        String g = prefs.getString("geohash", "");
        if ("area".equals(to) && nostr == null) to = "mesh";
        if ("mesh".equals(to)) target.setText(getString(R.string.mesh_public));
        else if ("area".equals(to)) target.setText(getString(R.string.mesh_area_chat, g));
        else target.setText(getString(R.string.mesh_private, name(to)));
    }
    String name(String peer) {
        if (core != null) for (MeshCore.Peer p : core.peers()) if (p.id.equals(peer)) return p.nickname;
        String n = pendingNames.get(peer); return n != null ? n : peer.substring(0, 6);
    }

    /* ---------------- sending ---------------- */
    void send() {
        String t = input.getText().toString().trim();
        if (t.isEmpty() || core == null) return;
        if (t.length() > 2000) t = t.substring(0, 2000);
        input.setText("");
        if ("area".equals(to) && nostr != null) { nostr.send(nick(), t); return; } // echoed back by the relays
        if ("mesh".equals(to)) {
            if (ble == null) { toast(getString(R.string.mesh_need_allow)); return; }
            core.sendPublic(t); addLine(stamp(System.currentTimeMillis()) + " " + nick() + ": " + t);
        } else {
            String id = core.sendPrivate(to, t);
            pendingNames.put(id, name(to));
            addLine(stamp(System.currentTimeMillis()) + " → " + name(to) + ": " + t);
        }
    }
    void pickTarget() {
        final List<String> ids = new ArrayList<>(); final List<String> labels = new ArrayList<>();
        ids.add("mesh"); labels.add(getString(R.string.mesh_public));
        if (nostr != null) { ids.add("area"); labels.add(getString(R.string.mesh_area_chat, prefs.getString("geohash", ""))); }
        if (core != null) for (MeshCore.Peer p : core.peers()) { ids.add(p.id); labels.add(getString(R.string.mesh_private, p.nickname)); }
        if (ids.size() == 1) toast(getString(R.string.mesh_no_people));
        new AlertDialog.Builder(this).setTitle(R.string.mesh_people)
            .setItems(labels.toArray(new String[0]), (d, i) -> { to = ids.get(i); refresh(); input.requestFocus(); }).show();
    }
    void editName() {
        prompt(getString(R.string.mesh_name_title), null, nick(), InputType.TYPE_CLASS_TEXT, v -> {
            v = v.trim(); if (v.isEmpty() || v.length() > 32) return;
            prefs.edit().putString("nick", v).apply();
            if (core != null) { core.setNickname(v); if (ble != null) core.announce(); }
        });
    }
    void editArea() {
        prompt(getString(R.string.mesh_area_title), getString(R.string.mesh_area_help), prefs.getString("geohash", ""), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, v -> {
            v = v.trim().toLowerCase(java.util.Locale.ROOT).replace("#", "");
            if (!v.isEmpty() && !NostrSign.isGeohash(v)) { toast(getString(R.string.mesh_bad_area)); return; }
            prefs.edit().putString("geohash", v).apply();
            if (nostr != null) { nostr.stop(); nostr = null; }
            relaysUp = 0; startNostr(); if (nostr != null) to = "area"; refresh();
        });
    }
    void editRelays() {
        StringBuilder cur = new StringBuilder(); for (String r : relays()) cur.append(r).append('\n');
        prompt(getString(R.string.mesh_relays_title), null, cur.toString().trim(), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_VARIATION_URI, v -> {
            prefs.edit().putString("relays", v.trim().isEmpty() ? null : v.trim()).apply();
            if (nostr != null) { nostr.stop(); nostr = null; }
            relaysUp = 0; startNostr(); refresh();
        });
    }
    interface Got { void got(String v); }
    void prompt(String title, String help, String value, int type, final Got got) {
        final EditText e = new EditText(this); e.setInputType(type); e.setText(value); e.setSelection(e.getText().length());
        AlertDialog.Builder b = new AlertDialog.Builder(this).setTitle(title).setView(e)
            .setPositiveButton(R.string.mesh_ok, (d, w) -> got.got(e.getText().toString()))
            .setNegativeButton(R.string.mesh_cancel, null);
        if (help != null) b.setMessage(help);
        b.show();
    }

    /* ---------------- incoming ---------------- */
    String stamp(long ts) { return DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(ts)); }
    void addLine(final String s) {
        runOnUiThread(() -> {
            if (lines.isEmpty() && log != null) log.setText("");
            lines.add(s); while (lines.size() > 300) lines.remove(0);
            if (log == null) return;
            log.setText(join());
            logScroll.post(() -> logScroll.fullScroll(View.FOCUS_DOWN));
        });
    }
    String join() { StringBuilder b = new StringBuilder(); for (String l : lines) b.append(l).append('\n'); return b.toString(); }
    static String clean(String s) { return s.replaceAll("[\\p{Cntrl}&&[^\n]]", "").trim(); }

    @Override public void onPublic(MeshCore.Peer from, String text, long ts, boolean verified) {
        addLine(stamp(ts) + " " + clean(from.nickname) + (verified ? "" : " (" + getString(R.string.mesh_unverified) + ")") + ": " + clean(text));
    }
    @Override public void onPrivate(MeshCore.Peer from, String id, String text, long ts) {
        addLine(stamp(ts) + " 🔒 " + clean(from.nickname) + ": " + clean(text));
    }
    @Override public void onDelivered(String id) {
        String n = pendingNames.remove(id);
        if (n != null) addLine("✓ " + getString(R.string.mesh_delivered, clean(n)));
    }
    @Override public void onPeersChanged() { runOnUiThread(this::refresh); }
    @Override public void onArea(String pubkey, String nickName, String text, long ts, boolean mine) {
        String who = nickName == null || nickName.isEmpty() ? "anon" : clean(nickName);
        addLine(stamp(ts) + " #" + prefs.getString("geohash", "") + " " + who + "#" + pubkey.substring(pubkey.length() - 4) + ": " + clean(text));
    }
    @Override public void onRelays(int up, int total) { relaysUp = up; relaysTotal = total; runOnUiThread(this::refresh); }
    @Override public void onLinks(int n) { links = n; runOnUiThread(this::refresh); }
    @Override public void onAdvertising(boolean ok) { advertising = ok; runOnUiThread(this::refresh); }

    void toast(String s) { Toast.makeText(this, s, Toast.LENGTH_LONG).show(); }
}
