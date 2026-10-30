package app.viktorych.tv;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import app.viktorych.tv.tune.DisplayTune;
import app.viktorych.tv.tune.Specs;

/** Full-screen WebView for TVs without Chrome. Same site, plus:
 *  - window.ViktorychTVApp.setName(preset, title) for the home-screen name
 *  - APK links are downloaded and handed to the system installer (one press). */
public class TvWebActivity extends Activity {
    private static final String APK_TYPE = "application/vnd.android.package-archive";
    private WebView web;
    private long pending = -1;
    private String waitingUrl;
    private boolean fellBack;
    private DisplayTune tune;
    /** The page now showing is our site (kept for bridge calls off the UI thread). */
    private volatile boolean onSite;

    private final BroadcastReceiver done = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent intent) {
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            if (id != pending) return;
            pending = -1;
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            Uri file = dm.getUriForDownloadedFile(id);
            if (file == null) { toast(R.string.update_failed); return; }
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(file, APK_TYPE);
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            try { startActivity(install); } catch (ActivityNotFoundException e) { toast(R.string.update_failed); }
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        tune = new DisplayTune(this);
        tune.applyColor();
        web = new WebView(this);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " ViktorychTV/" + BuildConfig.VERSION_CODE);
        web.addJavascriptInterface(new Bridge(), "ViktorychTVApp");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return route(req.getUrl());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return route(Uri.parse(url));
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                onSite = url != null && siteHost(Uri.parse(url).getHost());
                if (!onSite) tune.reset();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req != null && req.isForMainFrame()) fallBack(req.getUrl());
            }

            @SuppressWarnings("deprecation")
            @Override
            public void onReceivedError(WebView view, int code, String description, String url) {
                if (Build.VERSION.SDK_INT < 23) fallBack(url == null ? null : Uri.parse(url));
            }
        });
        web.setDownloadListener((url, ua, disposition, mime, length) -> install(url));
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(done, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), Context.RECEIVER_EXPORTED);
        else registerReceiver(done, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
        Uri start = getIntent() != null ? getIntent().getData() : null;
        if (state != null) web.restoreState(state);
        else web.loadUrl(TvLauncherActivity.withAppInfo(this, start).toString());
        hideBars();
    }

    /** The short address did not load: open the same screen on GitHub Pages once. */
    private void fallBack(Uri failed) {
        if (fellBack || failed == null || !BuildConfig.APP_HOST.equals(failed.getHost())) return;
        fellBack = true;
        web.loadUrl(BuildConfig.FALLBACK_URL);
    }

    static boolean siteHost(String host) {
        return BuildConfig.APP_HOST.equals(host) || BuildConfig.FALLBACK_HOST.equals(host);
    }

    private boolean route(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme();
        if ("viktorychtv".equals(scheme) && "name".equals(uri.getHost())) {
            if (!ours()) return true;
            Names.apply(this, uri.getQueryParameter("preset"), uri.getQueryParameter("title"));
            toast(R.string.name_saved);
            return true;
        }
        if ("viktorychtv".equals(scheme) && "game".equals(uri.getHost())) {
            startActivity(new Intent(this, GameActivity.class).setData(uri));
            return true;
        }
        if ("viktorychtv".equals(scheme) && "mesh".equals(uri.getHost())) {
            startActivity(new Intent(this, MeshActivity.class));
            return true;
        }
        if ("intent".equals(scheme)) {
            try {
                Intent i = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                Uri data = i.getData();
                if (data != null && "viktorychtv".equals(data.getScheme())) return route(data);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                startActivity(i);
            } catch (Exception ignored) { /* nothing can open it */ }
            return true;
        }
        String path = uri.getPath() == null ? "" : uri.getPath();
        if (path.endsWith(".apk")) { install(uri.toString()); return true; }
        // A custom-name build, streamed by the accounts Worker with a short signed link.
        if ("https".equals(scheme) && path.startsWith("/v1/tv/build/") && path.endsWith("/apk")) { install(uri.toString()); return true; }
        if (("https".equals(scheme) || "http".equals(scheme)) && !siteHost(uri.getHost())) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return true;
            } catch (ActivityNotFoundException e) {
                return false; // no browser on this TV: open it here
            }
        }
        return false;
    }

    /** Downloads the APK and opens the system installer. Android asks once to
     *  allow installs from this app, then shows its Install button. */
    void install(String url) {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            waitingUrl = url;
            toast(R.string.allow_installs);
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
                return;
            } catch (ActivityNotFoundException ignored) { /* fall through and try anyway */ }
        }
        try {
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            r.setMimeType(APK_TYPE);
            r.setTitle(getString(R.string.update_title));
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            r.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "ViktorychTV-" + System.currentTimeMillis() + ".apk");
            pending = dm.enqueue(r);
            toast(R.string.update_downloading);
        } catch (RuntimeException e) {
            toast(R.string.update_failed);
        }
    }

    private void toast(int res) { Toast.makeText(this, res, Toast.LENGTH_LONG).show(); }

    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        hideBars();
        if (waitingUrl != null && (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls())) {
            String url = waitingUrl;
            waitingUrl = null;
            install(url);
        }
    }

    @Override
    protected void onPause() { tune.reset(); web.onPause(); super.onPause(); }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(done); } catch (RuntimeException ignored) { /* not registered */ }
        web.destroy();
        super.onDestroy();
    }

    private static final String BACK_JS = "(function(){var e=new KeyboardEvent('keydown',{key:'GoBack',bubbles:true,cancelable:true});"
        + "try{Object.defineProperty(e,'keyCode',{get:function(){return 4}})}catch(x){}"
        + "(document.activeElement||document.body).dispatchEvent(e);return e.defaultPrevented})()";

    @Override
    public void onBackPressed() {
        // The site handles Back itself (closes dialogs, goes back). Leave the
        // page or the app only when the site did not use the key.
        web.evaluateJavascript(BACK_JS, v -> {
            if ("true".equals(v)) return;
            if (web.canGoBack()) web.goBack();
            else finish();
        });
    }

    private boolean ours() {
        String url = web.getUrl();
        return url != null && siteHost(Uri.parse(url).getHost());
    }

    final class Bridge {
        @JavascriptInterface public int version() { return BuildConfig.VERSION_CODE; }
        @JavascriptInterface public boolean custom() { return BuildConfig.CUSTOM; }
        @JavascriptInterface public String preset() { return Names.preset(TvWebActivity.this); }
        @JavascriptInterface public void setName(final String preset, final String title) {
            runOnUiThread(() -> { if (!ours()) return; Names.apply(TvWebActivity.this, preset, title); Names.label(TvWebActivity.this); toast(R.string.name_saved); });
        }
        @JavascriptInterface public void install(final String url) {
            runOnUiThread(() -> { if (ours()) TvWebActivity.this.install(url); });
        }
        // TV tuning (first-time setup and Settings > TV). The specs are read
        // on this TV and only handed to the page; nothing is sent anywhere.
        @JavascriptInterface public String specs(boolean fresh) {
            if (!onSite) return "{}";
            if (fresh) Specs.forget();
            return Specs.json(TvWebActivity.this);
        }
        @JavascriptInterface public void setTune(final boolean frameMatch, final boolean hdr, final boolean passthrough, final boolean padHints) {
            runOnUiThread(() -> { if (ours()) tune.set(frameMatch, hdr, passthrough, padHints); });
        }
        @JavascriptInterface public void matchFrameRate(final double fps) {
            runOnUiThread(() -> { if (ours()) tune.match(fps); });
        }
        @JavascriptInterface public void resetFrameRate() {
            runOnUiThread(() -> tune.reset());
        }
    }
}
