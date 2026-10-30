package app.viktorych.tv.mesh;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import java.io.ByteArrayOutputStream;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Bluetooth LE side of the mesh, Bitchat-compatible: one GATT service with
 *  one characteristic. As a central we scan for the service, connect, ask for
 *  a 517-byte MTU, subscribe to notifications and write without response. As
 *  a peripheral (only when the chip can advertise) we host the same service
 *  so phones can connect to us. Many TV boxes cannot advertise; then we run
 *  as a central only and still reach every phone in range. */
@SuppressLint("MissingPermission") // MeshActivity asks for the permissions before start()
public final class BleMesh {
    public static final UUID SERVICE = UUID.fromString("F47B5E2D-4A9E-4C5A-9B3F-8E1D2C3A4B5C");
    public static final UUID CHAR = UUID.fromString("A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D");
    static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    static final int MAX_CLIENTS = 6;

    public enum Support { NONE, OFF, CENTRAL_ONLY, FULL }
    public interface Status { void onLinks(int links); void onAdvertising(boolean ok); }

    final Context ctx; final MeshCore core; final Status status;
    final Handler main = new Handler(Looper.getMainLooper());
    BluetoothAdapter adapter; BluetoothLeScanner scanner; BluetoothLeAdvertiser advertiser; BluetoothGattServer server;
    BluetoothGattCharacteristic serverChar;
    final Map<String, ClientLink> clients = Collections.synchronizedMap(new HashMap<String, ClientLink>());
    final Map<String, ServerLink> centrals = Collections.synchronizedMap(new HashMap<String, ServerLink>());
    final Map<String, ByteArrayOutputStream> prepared = new HashMap<>();
    final Map<String, Long> lastTry = new HashMap<>();
    volatile boolean running;

    public BleMesh(Context ctx, MeshCore core, Status status) { this.ctx = ctx.getApplicationContext(); this.core = core; this.status = status; }

    public static Support support(Context c) {
        if (!c.getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) return Support.NONE;
        BluetoothManager m = (BluetoothManager) c.getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter a = m == null ? null : m.getAdapter();
        if (a == null) return Support.NONE;
        if (!a.isEnabled()) return Support.OFF;
        // Peripheral mode: the chip must support LE advertising (often missing on TV boxes).
        return a.isMultipleAdvertisementSupported() && a.getBluetoothLeAdvertiser() != null ? Support.FULL : Support.CENTRAL_ONLY;
    }

    public void start() {
        BluetoothManager m = (BluetoothManager) ctx.getSystemService(Context.BLUETOOTH_SERVICE);
        adapter = m == null ? null : m.getAdapter();
        if (adapter == null || !adapter.isEnabled()) return;
        running = true;
        if (support(ctx) == Support.FULL) startPeripheral(m);
        else status.onAdvertising(false);
        scanner = adapter.getBluetoothLeScanner();
        if (scanner != null) {
            ScanSettings.Builder sb = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_BALANCED);
            scanner.startScan(Collections.singletonList(new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE)).build()), sb.build(), scan);
        }
    }

    public void stop() {
        running = false;
        try { if (scanner != null) scanner.stopScan(scan); } catch (RuntimeException ignored) { /* adapter off */ }
        try { if (advertiser != null) advertiser.stopAdvertising(adv); } catch (RuntimeException ignored) { /* adapter off */ }
        synchronized (clients) { for (ClientLink c : clients.values()) { core.removeLink(c); try { c.gatt.close(); } catch (RuntimeException ignored) { /* gone */ } } clients.clear(); }
        synchronized (centrals) { for (ServerLink s : centrals.values()) core.removeLink(s); centrals.clear(); }
        try { if (server != null) server.close(); } catch (RuntimeException ignored) { /* gone */ }
        server = null;
        status.onLinks(0);
    }

    void links() { status.onLinks(core.linkCount()); }

    /* ---------------- peripheral (others connect to us) ---------------- */
    void startPeripheral(BluetoothManager m) {
        server = m.openGattServer(ctx, serverCb);
        if (server == null) { status.onAdvertising(false); return; }
        BluetoothGattService svc = new BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        serverChar = new BluetoothGattCharacteristic(CHAR,
            BluetoothGattCharacteristic.PROPERTY_READ | BluetoothGattCharacteristic.PROPERTY_WRITE
                | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE | BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ | BluetoothGattCharacteristic.PERMISSION_WRITE);
        serverChar.addDescriptor(new BluetoothGattDescriptor(CCCD, BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE));
        svc.addCharacteristic(serverChar);
        server.addService(svc);
        advertiser = adapter.getBluetoothLeAdvertiser();
        AdvertiseSettings s = new AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM).setConnectable(true).build();
        AdvertiseData d = new AdvertiseData.Builder().addServiceUuid(new ParcelUuid(SERVICE)).setIncludeDeviceName(false).build();
        try { advertiser.startAdvertising(s, d, adv); } catch (RuntimeException e) { status.onAdvertising(false); }
    }

    final AdvertiseCallback adv = new AdvertiseCallback() {
        @Override public void onStartSuccess(AdvertiseSettings s) { status.onAdvertising(true); }
        @Override public void onStartFailure(int code) { status.onAdvertising(false); }
    };

    /** A phone connected to our GATT server; we talk back with notifications. */
    final class ServerLink implements MeshCore.Link {
        final BluetoothDevice dev; volatile int mtu = 23; final ArrayDeque<byte[]> q = new ArrayDeque<>(); boolean busy;
        ServerLink(BluetoothDevice d) { dev = d; }
        @Override public int maxWrite() { return mtu - 3; }
        @Override public void send(byte[] data) { synchronized (this) { if (q.size() < 200) q.add(data); } pump(); }
        void pump() {
            byte[] next;
            synchronized (this) { if (busy || q.isEmpty() || server == null) return; next = q.poll(); busy = true; }
            boolean ok;
            try {
                if (Build.VERSION.SDK_INT >= 33) ok = server.notifyCharacteristicChanged(dev, serverChar, false, next) == 0;
                else { serverChar.setValue(next); ok = server.notifyCharacteristicChanged(dev, serverChar, false); }
            } catch (RuntimeException e) { ok = false; }
            if (!ok) { synchronized (this) { busy = false; } main.postDelayed(this::pump, 50); }
        }
        void sent() { synchronized (this) { busy = false; } pump(); }
    }

    final BluetoothGattServerCallback serverCb = new BluetoothGattServerCallback() {
        @Override public void onConnectionStateChange(BluetoothDevice d, int st, int state) {
            if (state == BluetoothProfile.STATE_DISCONNECTED) {
                ServerLink l = centrals.remove(d.getAddress());
                if (l != null) { core.removeLink(l); links(); }
            }
        }
        @Override public void onMtuChanged(BluetoothDevice d, int mtu) { ServerLink l = centrals.get(d.getAddress()); if (l != null) l.mtu = mtu; else pendingMtu.put(d.getAddress(), mtu); }
        final Map<String, Integer> pendingMtu = Collections.synchronizedMap(new HashMap<String, Integer>());
        ServerLink link(BluetoothDevice d) {
            ServerLink l = centrals.get(d.getAddress());
            if (l == null) {
                l = new ServerLink(d); Integer m = pendingMtu.remove(d.getAddress()); if (m != null) l.mtu = m;
                centrals.put(d.getAddress(), l); core.addLink(l); links();
                main.postDelayed(core::announce, 300);
            }
            return l;
        }
        @Override public void onDescriptorWriteRequest(BluetoothDevice d, int id, BluetoothGattDescriptor desc, boolean prep, boolean resp, int off, byte[] v) {
            if (CCCD.equals(desc.getUuid()) && v != null && v.length > 0 && (v[0] & 1) == 1) link(d);
            if (resp && server != null) server.sendResponse(d, id, BluetoothGatt.GATT_SUCCESS, 0, v);
        }
        @Override public void onCharacteristicWriteRequest(BluetoothDevice d, int id, BluetoothGattCharacteristic c, boolean prep, boolean resp, int off, byte[] v) {
            if (prep) {
                synchronized (prepared) { ByteArrayOutputStream b = prepared.get(d.getAddress()); if (b == null) prepared.put(d.getAddress(), b = new ByteArrayOutputStream()); if (b.size() < 65536) b.write(v, 0, v.length); }
            } else if (v != null) core.onData(link(d), v);
            if (resp && server != null) server.sendResponse(d, id, BluetoothGatt.GATT_SUCCESS, off, v);
        }
        @Override public void onExecuteWrite(BluetoothDevice d, int id, boolean execute) {
            ByteArrayOutputStream b; synchronized (prepared) { b = prepared.remove(d.getAddress()); }
            if (execute && b != null) core.onData(link(d), b.toByteArray());
            if (server != null) server.sendResponse(d, id, BluetoothGatt.GATT_SUCCESS, 0, null);
        }
        @Override public void onCharacteristicReadRequest(BluetoothDevice d, int id, int off, BluetoothGattCharacteristic c) {
            if (server != null) server.sendResponse(d, id, BluetoothGatt.GATT_SUCCESS, 0, new byte[0]);
        }
        @Override public void onNotificationSent(BluetoothDevice d, int st) { ServerLink l = centrals.get(d.getAddress()); if (l != null) l.sent(); }
    };

    /* ---------------- central (we connect to phones) ---------------- */
    final ScanCallback scan = new ScanCallback() {
        @Override public void onScanResult(int type, ScanResult r) {
            if (!running) return;
            BluetoothDevice d = r.getDevice(); String a = d.getAddress();
            if (r.getRssi() < -95 || clients.containsKey(a) || centrals.containsKey(a) || clients.size() >= MAX_CLIENTS) return;
            long now = System.currentTimeMillis();
            synchronized (lastTry) { Long t = lastTry.get(a); if (t != null && now - t < 15_000) return; lastTry.put(a, now); }
            ClientLink l = new ClientLink();
            clients.put(a, l);
            l.gatt = Build.VERSION.SDK_INT >= 23 ? d.connectGatt(ctx, false, l, BluetoothDevice.TRANSPORT_LE) : d.connectGatt(ctx, false, l);
            if (l.gatt == null) clients.remove(a);
        }
    };

    final class ClientLink extends BluetoothGattCallback implements MeshCore.Link {
        BluetoothGatt gatt; BluetoothGattCharacteristic ch; volatile int mtu = 23; boolean ready, busy, added;
        final ArrayDeque<byte[]> q = new ArrayDeque<>();
        @Override public int maxWrite() { return mtu - 3; }
        @Override public void send(byte[] data) { synchronized (this) { if (q.size() < 200) q.add(data); } pump(); }
        void pump() {
            byte[] next;
            synchronized (this) { if (!ready || busy || q.isEmpty()) return; next = q.poll(); busy = true; }
            boolean ok;
            try {
                if (Build.VERSION.SDK_INT >= 33) ok = gatt.writeCharacteristic(ch, next, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) == 0;
                else { ch.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE); ch.setValue(next); ok = gatt.writeCharacteristic(ch); }
            } catch (RuntimeException e) { ok = false; }
            if (!ok) { synchronized (this) { busy = false; q.addFirst(next); } main.postDelayed(this::pump, 30); }
        }
        @Override public void onConnectionStateChange(BluetoothGatt g, int st, int state) {
            if (state == BluetoothProfile.STATE_CONNECTED && st == BluetoothGatt.GATT_SUCCESS) { if (!g.requestMtu(517)) g.discoverServices(); }
            else if (state == BluetoothProfile.STATE_DISCONNECTED || st != BluetoothGatt.GATT_SUCCESS) drop(g);
        }
        @Override public void onMtuChanged(BluetoothGatt g, int m, int st) { if (st == BluetoothGatt.GATT_SUCCESS) mtu = m; g.discoverServices(); }
        @Override public void onServicesDiscovered(BluetoothGatt g, int st) {
            BluetoothGattService s = g.getService(SERVICE);
            ch = s == null ? null : s.getCharacteristic(CHAR);
            if (ch == null) { drop(g); return; }
            g.setCharacteristicNotification(ch, true);
            BluetoothGattDescriptor d = ch.getDescriptor(CCCD);
            if (d == null) { up(); return; }
            if (Build.VERSION.SDK_INT >= 33) g.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            else { d.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE); g.writeDescriptor(d); }
        }
        @Override public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int st) { up(); }
        void up() {
            synchronized (this) { ready = true; if (added) return; added = true; }
            core.addLink(this); links(); pump();
            main.postDelayed(core::announce, 200);
        }
        @Override public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int st) { synchronized (this) { busy = false; } pump(); }
        @SuppressWarnings("deprecation")
        @Override public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) { if (Build.VERSION.SDK_INT < 33) core.onData(this, c.getValue()); }
        @Override public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] v) { core.onData(this, v); }
        void drop(BluetoothGatt g) {
            core.removeLink(this);
            clients.remove(g.getDevice().getAddress());
            try { g.close(); } catch (RuntimeException ignored) { /* gone */ }
            links();
        }
    }
}
