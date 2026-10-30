package app.viktorych.tv.player;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import app.viktorych.tv.BuildConfig;

/** YouTube and Twitch through their official embeds with their own
 *  controls hidden, so our controls drive them the same way as a file. */
final class WebEngine implements Engine {
    private final Context ctx;
    private final Links.Target target;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Listener listener;
    private boolean ready, playing, live;
    private long pos, dur;
    private int buf;
    private String title = "";
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (web == null) return;
            web.evaluateJavascript("typeof S==='function'?S():'{}'", WebEngine.this::onState);
            main.postDelayed(this, 400);
        }
    };

    WebEngine(Context c, Links.Target t) {
        ctx = c;
        target = t;
        web = new WebView(c);
        web.setFocusable(false);
        web.setFocusableInTouchMode(false);
        web.setBackgroundColor(Color.BLACK);
    }

    @Override public View view() { return web; }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override public void load(Listener l) {
        listener = l;
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override public Bitmap getDefaultVideoPoster() {
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }
        });
        web.addJavascriptInterface(new Bridge(), "A");
        String base = "https://" + BuildConfig.APP_HOST + "/";
        web.loadDataWithBaseURL(base, html(target, BuildConfig.APP_HOST), "text/html", "utf-8", null);
        main.postDelayed(poll, 600);
    }

    /** The page for one target. Ids are checked by Links before they get here. */
    static String html(Links.Target t, String host) {
        String head = "<!doctype html><html><head><meta name=viewport content=\"width=device-width,initial-scale=1\">"
            + "<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#p,#p iframe{position:absolute;left:0;top:0;width:100%;height:100%;border:0}</style>"
            + "</head><body><div id=p></div>";
        String safeId = t.id.replaceAll("[^A-Za-z0-9_-]", "");
        if (t.kind == Links.Kind.YOUTUBE) {
            return head + "<script>var P=null,R=false;"
                + "function onYouTubeIframeAPIReady(){P=new YT.Player('p',{videoId:'" + safeId + "',playerVars:{autoplay:1,controls:0,disablekb:1,fs:0,iv_load_policy:3,modestbranding:1,playsinline:1,rel:0,start:" + t.startSec + ",origin:'https://" + host + "'},"
                + "events:{onReady:function(e){R=true;e.target.playVideo();A.ready()},onStateChange:function(e){if(e.data===0)A.ended()},onError:function(e){A.error('yt '+e.data)}}})}"
                + "function S(){if(!R)return '{}';var s=P.getPlayerState(),v=P.getVideoData?P.getVideoData():{};"
                + "return JSON.stringify({p:s===1||s===3,t:P.getCurrentTime()*1000,d:P.getDuration()*1000,b:P.getVideoLoadedFraction()*100,l:!!v.isLive,n:v.title||''})}"
                + "function C(c,v){if(!R)return;if(c=='play')P.playVideo();else if(c=='pause')P.pauseVideo();else if(c=='seek')P.seekTo(v/1000,true);else if(c=='mute'){if(v)P.mute();else P.unMute()}}"
                + "</script><script src=\"https://www.youtube.com/iframe_api\"></script></body></html>";
        }
        String what = t.kind == Links.Kind.TWITCH_VIDEO ? "video:'v" + safeId + "'" : "channel:'" + safeId + "'";
        String time = t.startSec > 0 ? ",time:'" + t.startSec + "s'" : "";
        return head + "<script src=\"https://player.twitch.tv/js/embed/v1.js\"></script><script>var R=false;"
            + "var P=new Twitch.Player('p',{width:'100%',height:'100%'," + what + ",parent:['" + host + "'],autoplay:true,muted:false,controls:false" + time + "});"
            + "P.addEventListener(Twitch.Player.READY,function(){R=true;A.ready()});P.addEventListener(Twitch.Player.ENDED,function(){A.ended()});"
            + "function S(){if(!R)return '{}';var d=P.getDuration();return JSON.stringify({p:!P.isPaused(),t:P.getCurrentTime()*1000,d:(isFinite(d)?d:0)*1000,b:0,l:!P.getVideo()})}"
            + "function C(c,v){if(!R)return;if(c=='play')P.play();else if(c=='pause')P.pause();else if(c=='seek')P.seek(v/1000);else if(c=='mute')P.setMuted(!!v)}"
            + "</script></body></html>";
    }

    private void onState(String raw) {
        try {
            String s = raw;
            if (s != null && s.startsWith("\"")) s = new JSONObject("{\"v\":" + s + "}").getString("v");
            JSONObject o = new JSONObject(s == null ? "{}" : s);
            if (!o.has("t")) return;
            playing = o.optBoolean("p");
            pos = (long) o.optDouble("t", 0);
            dur = (long) o.optDouble("d", 0);
            buf = (int) o.optDouble("b", 0);
            live = o.optBoolean("l");
            title = o.optString("n", title);
        } catch (Exception ignored) { /* page still loading */ }
    }

    private void cmd(String c, long v) {
        playing = c.equals("play") || (playing && !c.equals("pause"));
        if (c.equals("seek")) pos = v;
        web.evaluateJavascript("typeof C==='function'&&C('" + c + "'," + v + ")", null);
    }

    @Override public void play() { cmd("play", 0); }
    @Override public void pause() { cmd("pause", 0); }
    @Override public boolean playing() { return playing; }
    @Override public long position() { return pos; }
    @Override public long duration() { return live ? 0 : dur; }
    @Override public int buffered() { return buf; }
    @Override public boolean live() { return live; }
    @Override public void seekTo(long ms) { cmd("seek", Math.max(0, dur > 0 ? Math.min(ms, dur - 500) : ms)); }
    @Override public void setMuted(boolean m) { cmd("mute", m ? 1 : 0); }

    String title() { return title; }

    @Override public void release() {
        main.removeCallbacksAndMessages(null);
        try {
            web.loadUrl("about:blank");
            web.destroy();
        } catch (RuntimeException ignored) { /* already gone */ }
    }

    private final class Bridge {
        @JavascriptInterface public void ready() { main.post(() -> { ready = true; if (listener != null) listener.onReady(); }); }
        @JavascriptInterface public void ended() { main.post(() -> { if (listener != null) listener.onEnded(); }); }
        @JavascriptInterface public void error(String why) { main.post(() -> { if (listener != null) listener.onError(why); }); }
    }
}
