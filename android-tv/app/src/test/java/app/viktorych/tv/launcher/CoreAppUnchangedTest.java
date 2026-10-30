package app.viktorych.tv.launcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Scanner;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.Test;

/** Regression guard for the TV takeover work: the regular app (its entry
 *  activity, aliases, web screen, controller support, name screen, nearby
 *  chat and every resource) must stay exactly as it was. The launcher and
 *  each default are additions only. */
public class CoreAppUnchangedTest {
    private static String res(String name) throws Exception {
        try (InputStream in = CoreAppUnchangedTest.class.getClassLoader().getResourceAsStream(name)) {
            return new Scanner(in, "UTF-8").useDelimiter("\\A").next();
        }
    }

    private static String manifest() throws Exception {
        return new String(Files.readAllBytes(new File("src/main/AndroidManifest.xml").toPath()), StandardCharsets.UTF_8);
    }

    @Test
    public void everyExistingActivityAndAliasIsUnchanged() throws Exception {
        String m = manifest();
        String[] blocks = res("manifest-main-components.txt").split("\n=====\n");
        assertTrue(blocks.length >= 9);
        for (String b : blocks) assertTrue("changed or removed:\n" + b, m.contains(b));
    }

    @Test
    public void appEntryStaysTheOnlyHomeScreenTile() throws Exception {
        String m = manifest().replaceAll("(?s)<queries>.*?</queries>", "");
        // Only the existing aliases carry LEANBACK_LAUNCHER / LAUNCHER: the new screens add no extra tiles.
        int leanback = count(m, "android.intent.category.LEANBACK_LAUNCHER");
        String before = String.join("\n", res("manifest-main-components.txt").split("\n=====\n"));
        assertEquals(count(before, "android.intent.category.LEANBACK_LAUNCHER"), leanback);
        assertEquals(count(before, "android.intent.category.LAUNCHER\""), count(m, "android.intent.category.LAUNCHER\""));
    }

    @Test
    public void homeScreenIsOffUntilChosen() throws Exception {
        String m = manifest();
        Matcher a = Pattern.compile("<activity\\s[^>]*android:name=\"\\.launcher\\.HomeActivity\"[^>]*>(.*?)</activity>", Pattern.DOTALL).matcher(m);
        assertTrue(a.find());
        assertTrue(a.group(0).contains("android:enabled=\"false\""));
        assertTrue(a.group(1).contains("android.intent.category.HOME"));
        // HOME appears in exactly one activity (plus the <queries> lookup).
        int homeFilters = count(m.replaceAll("(?s)<queries>.*?</queries>", ""), "android.intent.category.HOME");
        assertEquals(1, homeFilters);
        assertFalse(a.group(1).contains("LEANBACK_LAUNCHER"));
    }

    @Test
    public void regularAppFilesAreByteForByteTheSame() throws Exception {
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        int checked = 0;
        for (String line : res("core-app-files.sha256").split("\n")) {
            if (line.isEmpty() || line.startsWith("#")) continue;
            String want = line.substring(0, 64);
            String path = line.substring(66);
            byte[] b = Files.readAllBytes(new File(path).toPath());
            StringBuilder hex = new StringBuilder();
            for (byte x : sha.digest(b)) hex.append(String.format("%02x", x));
            assertEquals("regular app file changed: " + path + " (if on purpose, run android-tv/tools/core-hashes.sh)", want, hex.toString());
            checked++;
        }
        assertTrue(checked > 20);
    }

    private static int count(String s, String needle) {
        int n = 0, i = 0;
        while ((i = s.indexOf(needle, i)) >= 0) { n++; i += needle.length(); }
        return n;
    }
}
