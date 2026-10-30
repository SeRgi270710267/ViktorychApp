package app.viktorych.tv.channels;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.List;

import org.junit.Test;

public class LoopModelTest {
    static final String H = "https://pub-bf9b5e3ebb2b421aa49e7af484f3c22d.r2.dev/loop/v1/";

    static String doc(String extra) {
        return "{\"live\": true, \"station\": \"ViktorychMusic\", \"codec\": \"flac\", \"url\": \"" + H + "index.m3u8\", "
            + "\"duration\": 100.5, \"epoch\": 1000, \"version\": \"v1\"" + extra + "}";
    }

    @Test
    public void picksThePlaylistEveryTvPlays() {
        LoopModel.Station s = LoopModel.parse(doc(", \"fallback\": \"" + H + "aac/index.m3u8\""));
        assertNotNull(s);
        assertEquals(H + "aac/index.m3u8", s.url);
        assertEquals("v1", s.version);
        LoopModel.Station main = LoopModel.parse(doc(""));
        assertEquals(H + "index.m3u8", main.url);
        // A fallback somewhere else is ignored, not followed.
        LoopModel.Station off = LoopModel.parse(doc(", \"fallback\": \"https://example.com/aac/index.m3u8\""));
        assertEquals(H + "index.m3u8", off.url);
    }

    @Test
    public void refusesWhatItCannotPlay() {
        assertNull(LoopModel.parse(""));
        assertNull(LoopModel.parse("{\"live\": false}"));
        assertNull(LoopModel.parse(doc("").replace("\"live\": true", "\"live\": false")));
        assertNull(LoopModel.parse(doc("").replace("100.5", "0")));
        assertNull(LoopModel.parse(doc("").replace(H + "index.m3u8", "http://pub-bf9b5e3ebb2b421aa49e7af484f3c22d.r2.dev/loop/v1/index.m3u8")));
        assertFalse(LoopModel.playlist("https://pub-bf9b5e3ebb2b421aa49e7af484f3c22d.r2.dev/loop/../x.m3u8"));
        assertFalse(LoopModel.playlist("https://pub-bf9b5e3ebb2b421aa49e7af484f3c22d.r2.dev.evil.com/a.m3u8"));
        assertFalse(LoopModel.playlist(H + "index.mp4"));
        assertTrue(LoopModel.playlist(H + "aac/index.m3u8"));
    }

    @Test
    public void playsTheSameMomentAsTheSite() {
        LoopModel.Station s = LoopModel.parse(doc(""));
        assertEquals(0, s.position(1000_000L), 1e-9);
        assertEquals(10, s.position(1010_000L), 1e-9);
        assertEquals(9.5, s.position(1110_000L), 1e-9);    // 110 s in, wrapped once at 100.5
        assertEquals(90.5, s.position(990_000L), 1e-9);       // before the epoch wraps backwards
        assertEquals(0, s.position(1100_200L), 1e-9);       // the last half second restarts
    }

    @Test
    public void guideBlocksStartOnTheHour() {
        long now = 1_800_000_000_000L + 25 * 60_000L;
        List<long[]> b = LoopModel.blocks(now);
        assertEquals(LoopModel.BLOCKS_AHEAD, b.size());
        assertEquals(0, b.get(0)[0] % LoopModel.BLOCK_MS);
        assertTrue(b.get(0)[0] <= now && now < b.get(0)[1]);
        for (int i = 1; i < b.size(); i++) assertEquals(b.get(i - 1)[1], b.get(i)[0]);
        assertEquals("0:05", LoopModel.clock(5.9));
        assertEquals("36:48", LoopModel.clock(2208.5));
        assertEquals("1:00:01", LoopModel.clock(3601));
    }
}
