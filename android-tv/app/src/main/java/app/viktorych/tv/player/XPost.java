package app.viktorych.tv.player;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** A public X post read from X's own embed data (the same data the
 *  official embedded post uses): its text, author name, and the best video
 *  file or photo. No account and no key. */
final class XPost {
    String author = "";
    String text = "";
    String videoUrl;   // best mp4, or an m3u8 when there is no mp4
    String photoUrl;
    String posterUrl;

    /** Blocking: call off the main thread. Returns null when the post can't be read. */
    static XPost fetch(String id) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("https://cdn.syndication.twimg.com/tweet-result?id=" + id + "&lang=en&token=a").openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(10000);
            c.setRequestProperty("Accept", "application/json");
            if (c.getResponseCode() != 200) return null;
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0 && out.size() < 2_000_000) out.write(b, 0, n);
            return parse(new JSONObject(out.toString("UTF-8")));
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    static XPost parse(JSONObject o) {
        XPost p = new XPost();
        JSONObject user = o.optJSONObject("user");
        if (user != null) p.author = user.optString("name", "");
        p.text = cleanText(o.optString("text", ""));
        JSONArray media = o.optJSONArray("mediaDetails");
        if (media == null) return p;
        for (int i = 0; i < media.length(); i++) {
            JSONObject m = media.optJSONObject(i);
            if (m == null) continue;
            String type = m.optString("type");
            if ((type.equals("video") || type.equals("animated_gif")) && p.videoUrl == null) {
                JSONObject info = m.optJSONObject("video_info");
                JSONArray vs = info == null ? null : info.optJSONArray("variants");
                if (vs != null) {
                    String[] urls = new String[vs.length()];
                    String[] types = new String[vs.length()];
                    int[] rates = new int[vs.length()];
                    for (int j = 0; j < vs.length(); j++) {
                        JSONObject v = vs.optJSONObject(j);
                        if (v == null) continue;
                        urls[j] = v.optString("url", null);
                        types[j] = v.optString("content_type", "");
                        rates[j] = v.optInt("bitrate", -1);
                    }
                    p.videoUrl = pickVariant(urls, types, rates);
                }
                p.posterUrl = m.optString("media_url_https", null);
            } else if (type.equals("photo") && p.photoUrl == null) {
                p.photoUrl = m.optString("media_url_https", null);
            }
        }
        return p;
    }

    /** The highest-bitrate mp4 up to about 1080p, else the HLS playlist. */
    static String pickVariant(String[] urls, String[] types, int[] rates) {
        String best = null, hls = null;
        int bestRate = -1;
        for (int i = 0; i < urls.length; i++) {
            String u = urls[i];
            if (u == null || !u.startsWith("https://")) continue;
            String t = types[i] == null ? "" : types[i];
            if (t.contains("mpegURL") || t.contains("mpegurl") || u.contains(".m3u8")) { if (hls == null) hls = u; continue; }
            if (!t.equals("video/mp4") && !u.contains(".mp4")) continue;
            if (rates[i] > 12_000_000) continue;
            if (rates[i] > bestRate) { bestRate = rates[i]; best = u; }
        }
        return best != null ? best : hls;
    }

    /** Drops the trailing t.co media link X adds to the text. */
    static String cleanText(String s) {
        return s == null ? "" : s.replaceAll("\\s*https://t\\.co/\\w+\\s*$", "").trim();
    }
}
