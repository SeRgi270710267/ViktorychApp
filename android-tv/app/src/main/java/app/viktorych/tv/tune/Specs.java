package app.viktorych.tv.tune;

import android.app.ActivityManager;
import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.Configuration;
import android.hardware.display.DisplayManager;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.opengl.EGL14;
import android.opengl.EGLConfig;
import android.opengl.EGLContext;
import android.opengl.EGLDisplay;
import android.opengl.EGLSurface;
import android.opengl.GLES20;
import android.os.Build;
import android.os.StatFs;
import android.view.Display;
import android.view.InputDevice;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.FileReader;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/** Reads what this TV can do, on the TV only. Nothing here is sent anywhere:
 *  the JSON goes to the page in this app through the JS bridge, and the page
 *  keeps it in this device's local storage. Every probe is wrapped, so a TV
 *  that refuses one question still answers the rest. */
public final class Specs {
    private Specs() {}

    private static JSONObject cached;

    public static synchronized String json(Context c) {
        if (cached == null) cached = read(c.getApplicationContext());
        return cached.toString();
    }

    public static synchronized void forget() { cached = null; }

    static JSONObject read(Context c) {
        JSONObject o = new JSONObject();
        put(o, "v", 1);
        put(o, "source", "app");
        try { put(o, "device", device(c)); } catch (Throwable ignored) { }
        try { put(o, "display", display(c)); } catch (Throwable ignored) { }
        try { put(o, "memory", memory(c)); } catch (Throwable ignored) { }
        try { put(o, "cpu", cpu()); } catch (Throwable ignored) { }
        try { put(o, "gpu", gpu()); } catch (Throwable ignored) { }
        try { put(o, "storage", storage(c)); } catch (Throwable ignored) { }
        try { put(o, "codecs", codecs()); } catch (Throwable ignored) { }
        try { put(o, "audio", audio(c)); } catch (Throwable ignored) { }
        try { put(o, "network", network(c)); } catch (Throwable ignored) { }
        try { put(o, "input", input(c)); } catch (Throwable ignored) { }
        try { put(o, "features", features(c)); } catch (Throwable ignored) { }
        return o;
    }

    // ---------- Device ----------

    static JSONObject device(Context c) {
        JSONObject d = new JSONObject();
        put(d, "manufacturer", Build.MANUFACTURER);
        put(d, "brand", Build.BRAND);
        put(d, "model", Build.MODEL);
        put(d, "device", Build.DEVICE);
        put(d, "hardware", Build.HARDWARE);
        put(d, "android", Build.VERSION.RELEASE);
        put(d, "sdk", Build.VERSION.SDK_INT);
        if (Build.VERSION.SDK_INT >= 23) put(d, "patch", Build.VERSION.SECURITY_PATCH);
        if (Build.VERSION.SDK_INT >= 31) {
            put(d, "soc", (Build.SOC_MANUFACTURER + " " + Build.SOC_MODEL).trim());
        }
        PackageManager pm = c.getPackageManager();
        boolean leanback = pm.hasSystemFeature("android.software.leanback");
        UiModeManager ui = (UiModeManager) c.getSystemService(Context.UI_MODE_SERVICE);
        boolean tvMode = ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
        put(d, "tv", leanback || tvMode);
        // Google TV ships its own home app; plain Android TV the older one.
        String home = homePackage(pm);
        String ui2 = "android";
        if ("com.google.android.apps.tv.launcherx".equals(home) || pm.hasSystemFeature("com.google.android.feature.GOOGLE_EXPERIENCE") && leanback && installed(pm, "com.google.android.apps.tv.launcherx")) ui2 = "googletv";
        else if ("com.google.android.tvlauncher".equals(home) || installed(pm, "com.google.android.tvlauncher")) ui2 = "androidtv";
        else if (home != null && home.startsWith("com.amazon.")) ui2 = "firetv";
        else if (leanback || tvMode) ui2 = "androidtv";
        put(d, "platform", ui2);
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                android.content.pm.PackageInfo w = android.webkit.WebView.getCurrentWebViewPackage();
                if (w != null) put(d, "webview", w.versionName);
            }
        } catch (Throwable ignored) { }
        return d;
    }

    private static String homePackage(PackageManager pm) {
        try {
            ResolveInfo r = pm.resolveActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY);
            return r != null && r.activityInfo != null ? r.activityInfo.packageName : null;
        } catch (Throwable e) { return null; }
    }

    private static boolean installed(PackageManager pm, String pkg) {
        try { pm.getPackageInfo(pkg, 0); return true; } catch (Throwable e) { return false; }
    }

    // ---------- Display ----------

    static JSONObject display(Context c) {
        JSONObject o = new JSONObject();
        DisplayManager dm = (DisplayManager) c.getSystemService(Context.DISPLAY_SERVICE);
        Display d = dm.getDisplay(Display.DEFAULT_DISPLAY);
        if (d == null) return o;
        android.util.DisplayMetrics m = new android.util.DisplayMetrics();
        d.getRealMetrics(m);
        put(o, "dpi", m.densityDpi);
        put(o, "uiWidth", m.widthPixels);
        put(o, "uiHeight", m.heightPixels);
        put(o, "refresh", round(d.getRefreshRate()));
        if (Build.VERSION.SDK_INT >= 23) {
            Display.Mode cur = d.getMode();
            put(o, "width", cur.getPhysicalWidth());
            put(o, "height", cur.getPhysicalHeight());
            put(o, "refresh", round(cur.getRefreshRate()));
            JSONArray modes = new JSONArray();
            Set<String> rates = new LinkedHashSet<>();
            int maxW = 0, maxH = 0;
            for (Display.Mode mode : d.getSupportedModes()) {
                JSONObject j = new JSONObject();
                put(j, "id", mode.getModeId());
                put(j, "w", mode.getPhysicalWidth());
                put(j, "h", mode.getPhysicalHeight());
                put(j, "hz", round(mode.getRefreshRate()));
                modes.put(j);
                rates.add(String.valueOf(round(mode.getRefreshRate())));
                if ((long) mode.getPhysicalWidth() * mode.getPhysicalHeight() > (long) maxW * maxH) { maxW = mode.getPhysicalWidth(); maxH = mode.getPhysicalHeight(); }
            }
            put(o, "modes", modes);
            JSONArray r = new JSONArray();
            for (String s : rates) r.put((Object) Double.valueOf(s));
            put(o, "rates", r);
            put(o, "maxWidth", maxW);
            put(o, "maxHeight", maxH);
        } else {
            put(o, "width", m.widthPixels);
            put(o, "height", m.heightPixels);
        }
        JSONArray hdr = new JSONArray();
        if (Build.VERSION.SDK_INT >= 24) {
            Display.HdrCapabilities caps = d.getHdrCapabilities();
            if (caps != null) {
                for (int t : caps.getSupportedHdrTypes()) {
                    if (t == Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION) hdr.put("dolbyVision");
                    else if (t == Display.HdrCapabilities.HDR_TYPE_HDR10) hdr.put("hdr10");
                    else if (t == Display.HdrCapabilities.HDR_TYPE_HLG) hdr.put("hlg");
                    else if (Build.VERSION.SDK_INT >= 29 && t == Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS) hdr.put("hdr10plus");
                }
                if (caps.getDesiredMaxLuminance() > 0) put(o, "maxNits", round(caps.getDesiredMaxLuminance()));
            }
        }
        put(o, "hdr", hdr);
        if (Build.VERSION.SDK_INT >= 26) {
            put(o, "wideColor", d.isWideColorGamut());
            put(o, "isHdr", d.isHdr());
        }
        return o;
    }

    // ---------- Memory, CPU, GPU, storage ----------

    static JSONObject memory(Context c) {
        JSONObject o = new JSONObject();
        ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(mi);
        put(o, "totalMb", mi.totalMem / (1024 * 1024));
        put(o, "freeMb", mi.availMem / (1024 * 1024));
        put(o, "lowRam", am.isLowRamDevice());
        put(o, "appMb", am.getMemoryClass());
        put(o, "appLargeMb", am.getLargeMemoryClass());
        return o;
    }

    static JSONObject cpu() {
        JSONObject o = new JSONObject();
        put(o, "cores", Runtime.getRuntime().availableProcessors());
        JSONArray abis = new JSONArray();
        for (String a : Build.SUPPORTED_ABIS) abis.put(a);
        put(o, "abis", abis);
        put(o, "bits", Build.SUPPORTED_64_BIT_ABIS.length > 0 ? 64 : 32);
        long max = 0;
        for (int i = 0; i < 16; i++) {
            long f = readLong("/sys/devices/system/cpu/cpu" + i + "/cpufreq/cpuinfo_max_freq");
            if (f > max) max = f;
        }
        if (max > 0) put(o, "maxMhz", max / 1000);
        return o;
    }

    private static long readLong(String path) {
        try (BufferedReader r = new BufferedReader(new FileReader(path))) {
            String s = r.readLine();
            return s == null ? 0 : Long.parseLong(s.trim());
        } catch (Throwable e) { return 0; }
    }

    /** A 1x1 off-screen GL context, only to ask the GPU its name. */
    static JSONObject gpu() {
        JSONObject o = new JSONObject();
        EGLDisplay dpy = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
        if (dpy == EGL14.EGL_NO_DISPLAY) return o;
        int[] ver = new int[2];
        if (!EGL14.eglInitialize(dpy, ver, 0, ver, 1)) return o;
        EGLContext ctx = EGL14.EGL_NO_CONTEXT;
        EGLSurface surf = EGL14.EGL_NO_SURFACE;
        try {
            int[] attrs = { EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT, EGL14.EGL_NONE };
            EGLConfig[] cfg = new EGLConfig[1];
            int[] n = new int[1];
            if (!EGL14.eglChooseConfig(dpy, attrs, 0, cfg, 0, 1, n, 0) || n[0] == 0) return o;
            ctx = EGL14.eglCreateContext(dpy, cfg[0], EGL14.EGL_NO_CONTEXT, new int[] { EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE }, 0);
            surf = EGL14.eglCreatePbufferSurface(dpy, cfg[0], new int[] { EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE }, 0);
            if (ctx == EGL14.EGL_NO_CONTEXT || surf == EGL14.EGL_NO_SURFACE) return o;
            if (!EGL14.eglMakeCurrent(dpy, surf, surf, ctx)) return o;
            put(o, "renderer", GLES20.glGetString(GLES20.GL_RENDERER));
            put(o, "vendor", GLES20.glGetString(GLES20.GL_VENDOR));
            put(o, "gl", GLES20.glGetString(GLES20.GL_VERSION));
        } finally {
            EGL14.eglMakeCurrent(dpy, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
            if (surf != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(dpy, surf);
            if (ctx != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(dpy, ctx);
            EGL14.eglTerminate(dpy);
        }
        return o;
    }

    static JSONObject storage(Context c) {
        JSONObject o = new JSONObject();
        StatFs s = new StatFs(c.getFilesDir().getAbsolutePath());
        put(o, "freeMb", s.getAvailableBytes() / (1024 * 1024));
        put(o, "totalMb", s.getTotalBytes() / (1024 * 1024));
        return o;
    }

    // ---------- Video decoders ----------

    private static final String[][] CODECS = {
        { "av1", "video/av01" }, { "vp9", "video/x-vnd.on2.vp9" }, { "hevc", "video/hevc" },
        { "h264", "video/avc" }, { "dolbyVision", "video/dolby-vision" }
    };
    private static final int[][] SIZES = { { 7680, 4320 }, { 3840, 2160 }, { 2560, 1440 }, { 1920, 1080 }, { 1280, 720 }, { 854, 480 } };
    private static final int[] RATES = { 120, 60, 50, 30, 24 };

    static JSONObject codecs() {
        JSONObject out = new JSONObject();
        MediaCodecList list = new MediaCodecList(MediaCodecList.REGULAR_CODECS);
        MediaCodecInfo[] infos = list.getCodecInfos();
        for (String[] pair : CODECS) {
            JSONObject best = null;
            int bestScore = -1;
            for (MediaCodecInfo info : infos) {
                if (info.isEncoder()) continue;
                boolean match = false;
                for (String t : info.getSupportedTypes()) if (t.equalsIgnoreCase(pair[1])) match = true;
                if (!match) continue;
                JSONObject j = decoder(info, pair[1]);
                if (j == null) continue;
                int score = j.optInt("maxHeight") * 1000 + j.optInt("maxFps") + (j.optBoolean("hw") ? 10_000_000 : 0);
                if (score > bestScore) { bestScore = score; best = j; }
            }
            if (best != null) put(out, pair[0], best);
        }
        return out;
    }

    private static JSONObject decoder(MediaCodecInfo info, String mime) {
        MediaCodecInfo.CodecCapabilities caps;
        try { caps = info.getCapabilitiesForType(mime); } catch (Throwable e) { return null; }
        JSONObject j = new JSONObject();
        String name = info.getName();
        boolean hw;
        if (Build.VERSION.SDK_INT >= 29) hw = info.isHardwareAccelerated() && !info.isSoftwareOnly();
        else {
            String n = name.toLowerCase(Locale.ROOT);
            hw = !(n.startsWith("omx.google.") || n.startsWith("c2.android.") || n.contains(".sw.") || n.startsWith("omx.ffmpeg"));
        }
        put(j, "hw", hw);
        put(j, "secure", caps.isFeatureSupported(MediaCodecInfo.CodecCapabilities.FEATURE_SecurePlayback));
        put(j, "tunneled", Build.VERSION.SDK_INT >= 21 && caps.isFeatureSupported(MediaCodecInfo.CodecCapabilities.FEATURE_TunneledPlayback));
        MediaCodecInfo.VideoCapabilities v = caps.getVideoCapabilities();
        if (v != null) {
            outer:
            for (int[] s : SIZES) {
                for (int r : RATES) {
                    if (supports(v, s[0], s[1], r)) {
                        put(j, "maxWidth", s[0]);
                        put(j, "maxHeight", s[1]);
                        put(j, "maxFps", r);
                        break outer;
                    }
                }
            }
            // Highest frame rate at 1080p, for the frame-rate default.
            for (int r : RATES) if (supports(v, 1920, 1080, r)) { put(j, "fps1080", r); break; }
        }
        put(j, "hdr", hdrProfiles(mime, caps));
        return j;
    }

    private static boolean supports(MediaCodecInfo.VideoCapabilities v, int w, int h, int fps) {
        try {
            if (v.areSizeAndRateSupported(w, h, fps)) return true;
            // Portrait-only size tables on a few TV chips.
            return v.areSizeAndRateSupported(h, w, fps);
        } catch (Throwable e) { return false; }
    }

    private static boolean hdrProfiles(String mime, MediaCodecInfo.CodecCapabilities caps) {
        if ("video/dolby-vision".equals(mime)) return true;
        for (MediaCodecInfo.CodecProfileLevel p : caps.profileLevels) {
            if ("video/hevc".equals(mime) && (p.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10
                    || (Build.VERSION.SDK_INT >= 29 && p.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10Plus))) return true;
            if ("video/x-vnd.on2.vp9".equals(mime) && (p.profile == MediaCodecInfo.CodecProfileLevel.VP9Profile2HDR
                    || p.profile == MediaCodecInfo.CodecProfileLevel.VP9Profile3HDR
                    || (Build.VERSION.SDK_INT >= 29 && p.profile == MediaCodecInfo.CodecProfileLevel.VP9Profile2HDR10Plus))) return true;
            if (Build.VERSION.SDK_INT >= 29 && "video/av01".equals(mime) && (p.profile == MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10HDR10
                    || p.profile == MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10HDR10Plus)) return true;
        }
        return false;
    }

    // ---------- Audio ----------

    static JSONObject audio(Context c) {
        JSONObject o = new JSONObject();
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        Set<String> outs = new LinkedHashSet<>();
        Set<String> enc = new LinkedHashSet<>();
        int maxCh = 2;
        if (Build.VERSION.SDK_INT >= 23) {
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                String t = outName(d.getType());
                if (t != null) outs.add(t);
                for (int e : d.getEncodings()) { String n = encName(e); if (n != null) enc.add(n); }
                for (int ch : d.getChannelCounts()) if (ch > maxCh) maxCh = ch;
            }
        }
        if (Build.VERSION.SDK_INT >= 29) {
            android.media.AudioAttributes attr = new android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MOVIE).build();
            int[] probe = { AudioFormat.ENCODING_AC3, AudioFormat.ENCODING_E_AC3, AudioFormat.ENCODING_E_AC3_JOC,
                AudioFormat.ENCODING_DTS, AudioFormat.ENCODING_DTS_HD, AudioFormat.ENCODING_DOLBY_TRUEHD, AudioFormat.ENCODING_AC4 };
            for (int e : probe) {
                try {
                    AudioFormat f = new AudioFormat.Builder().setEncoding(e).setSampleRate(48000)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_5POINT1).build();
                    if (android.media.AudioTrack.isDirectPlaybackSupported(f, attr)) { String n = encName(e); if (n != null) enc.add(n); }
                } catch (Throwable ignored) { }
            }
        }
        put(o, "outputs", new JSONArray(outs));
        put(o, "passthrough", new JSONArray(enc));
        put(o, "maxChannels", maxCh);
        return o;
    }

    private static String outName(int t) {
        switch (t) {
            case AudioDeviceInfo.TYPE_HDMI: return "hdmi";
            case AudioDeviceInfo.TYPE_HDMI_ARC: return "arc";
            case 29 /* TYPE_HDMI_EARC */: return "earc";
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return "speaker";
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP: return "bluetooth";
            case AudioDeviceInfo.TYPE_USB_DEVICE:
            case AudioDeviceInfo.TYPE_USB_HEADSET: return "usb";
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_WIRED_HEADSET: return "headphones";
            case AudioDeviceInfo.TYPE_LINE_ANALOG:
            case AudioDeviceInfo.TYPE_LINE_DIGITAL: return "line";
            default: return null;
        }
    }

    private static String encName(int e) {
        switch (e) {
            case AudioFormat.ENCODING_AC3: return "ac3";
            case AudioFormat.ENCODING_E_AC3: return "eac3";
            case 18 /* E_AC3_JOC */: return "atmos";
            case AudioFormat.ENCODING_DTS: return "dts";
            case AudioFormat.ENCODING_DTS_HD: return "dtshd";
            case 14 /* DOLBY_TRUEHD */: return "truehd";
            case 17 /* AC4 */: return "ac4";
            default: return null;
        }
    }

    // ---------- Network, input, features ----------

    static JSONObject network(Context c) {
        JSONObject o = new JSONObject();
        ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return o;
        if (Build.VERSION.SDK_INT >= 23) {
            Network n = cm.getActiveNetwork();
            NetworkCapabilities nc = n == null ? null : cm.getNetworkCapabilities(n);
            if (nc == null) { put(o, "type", "none"); return o; }
            String type = nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ? "ethernet"
                : nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ? "wifi"
                : nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ? "cellular" : "other";
            put(o, "type", type);
            put(o, "downMbps", round(nc.getLinkDownstreamBandwidthKbps() / 1000f));
            put(o, "metered", !nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED));
        } else {
            @SuppressWarnings("deprecation") android.net.NetworkInfo ni = cm.getActiveNetworkInfo();
            put(o, "type", ni == null ? "none" : ni.getTypeName().toLowerCase(Locale.ROOT));
        }
        return o;
    }

    static JSONObject input(Context c) {
        JSONObject o = new JSONObject();
        int pads = 0;
        JSONArray names = new JSONArray();
        for (int id : InputDevice.getDeviceIds()) {
            InputDevice d = InputDevice.getDevice(id);
            if (d == null || d.isVirtual()) continue;
            int s = d.getSources();
            if ((s & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD || (s & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK) {
                pads++;
                names.put(d.getName());
            }
        }
        put(o, "gamepads", pads);
        put(o, "gamepadNames", names);
        PackageManager pm = c.getPackageManager();
        put(o, "bluetooth", pm.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH));
        put(o, "bluetoothLe", pm.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE));
        return o;
    }

    static JSONObject features(Context c) {
        JSONObject o = new JSONObject();
        PackageManager pm = c.getPackageManager();
        put(o, "leanback", pm.hasSystemFeature("android.software.leanback"));
        put(o, "touch", pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN));
        put(o, "liveTv", pm.hasSystemFeature("android.software.live_tv"));
        put(o, "pip", Build.VERSION.SDK_INT >= 24 && pm.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE));
        put(o, "hdmiCec", pm.hasSystemFeature("android.hardware.hdmi.cec"));
        put(o, "mic", pm.hasSystemFeature(PackageManager.FEATURE_MICROPHONE));
        return o;
    }

    // ---------- helpers ----------

    private static double round(float f) { return Math.round(f * 100) / 100.0; }

    private static void put(JSONObject o, String k, Object v) {
        try { o.put(k, v == null ? JSONObject.NULL : v); } catch (JSONException ignored) { }
    }
}
