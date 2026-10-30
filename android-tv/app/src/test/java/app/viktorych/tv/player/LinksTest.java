package app.viktorych.tv.player;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

public class LinksTest {
    private static String p(String url) { return Links.parse(url, null).toString(); }

    @Test public void youtube() {
        assertEquals("YOUTUBE:aqz-KE-bpKQ", p("https://www.youtube.com/watch?v=aqz-KE-bpKQ"));
        assertEquals("YOUTUBE:aqz-KE-bpKQ@90", p("https://youtu.be/aqz-KE-bpKQ?t=90"));
        assertEquals("YOUTUBE:aqz-KE-bpKQ@90", p("https://m.youtube.com/watch?feature=share&v=aqz-KE-bpKQ&t=1m30s"));
        assertEquals("YOUTUBE:aqz-KE-bpKQ", p("https://youtube.com/shorts/aqz-KE-bpKQ?si=x"));
        assertEquals("YOUTUBE:aqz-KE-bpKQ", p("https://www.youtube.com/live/aqz-KE-bpKQ"));
        assertEquals("YOUTUBE:aqz-KE-bpKQ music", p("https://music.youtube.com/watch?v=aqz-KE-bpKQ&list=RD"));
        assertEquals("NONE:", p("https://www.youtube.com/@somechannel"));
        assertEquals("NONE:", p("https://www.youtube.com/watch?v=short"));
        assertEquals("NONE:", p("https://youtube.com.evil.example/watch?v=aqz-KE-bpKQ"));
    }

    @Test public void x() {
        assertEquals("X_POST:1234567890123456789", p("https://x.com/someone/status/1234567890123456789"));
        assertEquals("X_POST:1234567890123456789", p("https://twitter.com/someone/status/1234567890123456789/video/1"));
        assertEquals("X_POST:1234567890123456789", p("https://mobile.twitter.com/i/web/status/1234567890123456789?s=20"));
        assertEquals("NONE:", p("https://x.com/someone"));
        assertEquals("NONE:", p("https://notx.com/a/status/1234567890123"));
    }

    @Test public void twitch() {
        assertEquals("TWITCH_CHANNEL:somestreamer", p("https://www.twitch.tv/SomeStreamer"));
        assertEquals("TWITCH_VIDEO:123456789@3723", p("https://www.twitch.tv/videos/123456789?t=1h2m3s"));
        assertEquals("NONE:", p("https://www.twitch.tv/directory"));
        assertEquals("NONE:", p("https://www.twitch.tv/"));
    }

    @Test public void media() {
        assertEquals("MEDIA:https://cdn.example.org/a/clip.mp4", p("https://cdn.example.org/a/clip.mp4"));
        assertEquals("MEDIA:https://cdn.example.org/live.m3u8?x=1", p("https://cdn.example.org/live.m3u8?x=1"));
        assertEquals("MEDIA:https://cdn.example.org/song.MP3 music", p("https://cdn.example.org/song.MP3"));
        assertEquals("MEDIA:content://media/external/video/7", Links.parse("content://media/external/video/7", "video/mp4").toString());
        assertEquals("MEDIA:content://media/external/audio/7 music", Links.parse("content://media/external/audio/7", "audio/mpeg").toString());
        assertEquals("MEDIA:https://example.org/stream", Links.parse("https://example.org/stream", "video/mp4").toString());
        assertEquals("NONE:", p("https://example.org/page.html"));
        assertEquals("NONE:", p("javascript:alert(1)"));
        assertEquals("NONE:", p(null));
    }

    @Test public void times() {
        assertEquals(0, Links.time(null));
        assertEquals(75, Links.time("75"));
        assertEquals(75, Links.time("1m15s"));
        assertEquals(3725, Links.time("1:02:05"));
        assertEquals(0, Links.time("abc"));
        assertEquals("0:00", Links.clock(0));
        assertEquals("1:15", Links.clock(75_000));
        assertEquals("1:02:05", Links.clock(3_725_000));
    }

    @Test public void pageEscaping() {
        // Ids come from Links, but the page builder strips anything odd anyway.
        String html = WebEngine.html(new Links.Target(Links.Kind.YOUTUBE, "a'b\"c<d>e", 5, false), "viktorychapp.pages.dev");
        assertFalse(html.contains("a'b"));
        assertTrue(html.contains("videoId:'abcde'"));
        assertTrue(html.contains("start:5"));
        String tw = WebEngine.html(new Links.Target(Links.Kind.TWITCH_CHANNEL, "somestreamer", 0, false), "viktorychapp.pages.dev");
        assertTrue(tw.contains("parent:['viktorychapp.pages.dev']"));
        assertTrue(tw.contains("channel:'somestreamer'"));
    }

    @Test public void bestVariant() {
        String[] urls = {"https://video.example/pl.m3u8", "https://video.example/320.mp4", "https://video.example/1280.mp4", "http://video.example/insecure.mp4"};
        String[] types = {"application/x-mpegURL", "video/mp4", "video/mp4", "video/mp4"};
        int[] rates = {-1, 632000, 2176000, 9000000};
        assertEquals("https://video.example/1280.mp4", XPost.pickVariant(urls, types, rates));
        assertEquals("https://video.example/pl.m3u8", XPost.pickVariant(new String[]{urls[0]}, new String[]{types[0]}, new int[]{-1}));
        assertEquals("Look at this", XPost.cleanText("Look at this https://t.co/AbC123"));
    }

    @Test public void playlist() {
        String raw = "i\thttps://img.example/a.jpg\tA Person\tHello\n"
            + "v\thttps://vid.example/b.mp4\t\tclip\n"
            + "i\thttp://img.example/insecure.jpg\tx\ty\n"
            + "x\thttps://img.example/c.jpg\tbad kind\t\n"
            + "i\tjavascript:alert(1)\t\t\n";
        List<Playlist.Item> items = Playlist.parse(raw);
        assertEquals(2, items.size());
        assertFalse(items.get(0).video);
        assertTrue(items.get(1).video);
        assertEquals("Hello", items.get(0).text);
        assertEquals(items.size(), Playlist.parse(Playlist.write(items)).size());
        StringBuilder big = new StringBuilder();
        for (int i = 0; i < 100; i++) big.append("i\thttps://img.example/").append(i).append(".jpg\t\t\n");
        assertEquals(Playlist.MAX, Playlist.parse(big.toString()).size());
        char[] longText = new char[400];
        Arrays.fill(longText, 'a');
        assertEquals(280, Playlist.parse("i\thttps://img.example/a.jpg\t\t" + new String(longText)).get(0).text.length());
    }
}
