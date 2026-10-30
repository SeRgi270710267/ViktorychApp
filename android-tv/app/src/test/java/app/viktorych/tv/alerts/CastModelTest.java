package app.viktorych.tv.alerts;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class CastModelTest {
    private static final String START = "https://viktorychapp.pages.dev/?tv=1&src=tvapp&tvapp=11#/home";

    @Test
    public void readsTheServerAnswer() {
        CastModel.Item it = CastModel.item("{\"item\":{\"url\":\"https://youtu.be/dQw4w9WgXcQ\",\"title\":\"A\\nsong\",\"at\":5000000},\"interval\":4}");
        assertEquals("https://youtu.be/dQw4w9WgXcQ", it.url);
        assertEquals("A song", it.title);
        assertEquals(5000000L, it.at);
        assertNull(CastModel.item("{\"item\":null,\"interval\":4}"));
        assertNull(CastModel.item("not json"));
        assertNull(CastModel.item("{\"item\":{\"url\":\"\"}}"));
        assertEquals(4000, CastModel.intervalMs("{\"item\":null,\"interval\":4}"));
        assertEquals(3000, CastModel.intervalMs("{\"interval\":1}"));
        assertEquals(15000, CastModel.intervalMs("{\"interval\":600}"));
        assertEquals(4000, CastModel.intervalMs("oops"));
    }

    @Test
    public void opensOnlyWhatItKnows() {
        assertEquals(CastModel.Kind.SITE, CastModel.kind("https://viktorychapp.pages.dev/#/post/123", START));
        assertEquals(CastModel.Kind.SITE, CastModel.kind("HTTPS://ViktorychApp.pages.dev/?x=1", START));
        assertEquals(CastModel.Kind.PLAY, CastModel.kind("https://www.youtube.com/watch?v=dQw4w9WgXcQ", START));
        assertEquals(CastModel.Kind.PLAY, CastModel.kind("https://x.com/someone/status/1234567890", START));
        assertEquals(CastModel.Kind.PLAY, CastModel.kind("https://www.twitch.tv/videos/123456", START));
        assertEquals(CastModel.Kind.PLAY, CastModel.kind("https://cdn.example.com/a/movie.mp4", START));
        assertEquals(CastModel.Kind.NONE, CastModel.kind("https://example.com/page", START));
        assertEquals(CastModel.Kind.NONE, CastModel.kind("http://viktorychapp.pages.dev/", START));
        assertEquals(CastModel.Kind.NONE, CastModel.kind("https://viktorychapp.pages.dev@evil.example/", START));
        assertEquals(CastModel.Kind.NONE, CastModel.kind("https://user@viktorychapp.pages.dev/", START));
        assertEquals(CastModel.Kind.NONE, CastModel.kind("intent://x#Intent;end", START));
        assertEquals(CastModel.Kind.NONE, CastModel.kind("javascript:alert(1)", START));
        assertEquals(CastModel.Kind.NONE, CastModel.kind(null, START));
        assertEquals("viktorychapp.pages.dev", CastModel.host("https://viktorychapp.pages.dev:443/x"));
    }
}
