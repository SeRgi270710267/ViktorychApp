package app.viktorych.tv.launcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;

import org.junit.Test;

public class LauncherModelTest {
    private static final List<String> APPS = Arrays.asList("a/A", "b/B", "us/Main", "c/C", "d/D", "e/E");

    private static LauncherModel fresh() {
        LauncherModel m = new LauncherModel();
        m.reconcile(APPS, "us/Main");
        return m;
    }

    @Test public void freshPutsOurAppFirstThenSystemOrder() {
        assertEquals(Arrays.asList("us/Main", "a/A", "b/B", "c/C", "d/D", "e/E"), LauncherModel.keys(fresh().entries));
    }

    @Test public void reconcileDropsRemovedAndAppendsNew() {
        LauncherModel m = fresh();
        m.move(0, 3);
        m.reconcile(Arrays.asList("a/A", "us/Main", "c/C", "d/D", "e/E", "f/F"), "us/Main");
        assertEquals(Arrays.asList("a/A", "c/C", "us/Main", "d/D", "e/E", "f/F"), LauncherModel.keys(m.entries));
    }

    @Test public void moveClampsAndReports() {
        LauncherModel m = fresh();
        assertFalse(m.move(0, -3));
        assertTrue(m.move(0, 99));
        assertEquals("us/Main", m.entries.get(5).key);
    }

    @Test public void foldersGroupRenameUngroupAndSurviveSave() {
        LauncherModel m = fresh();
        String id = m.newFolder("b/B", "Kids | TV");
        assertTrue(m.addToFolder("d/D", id));
        assertEquals(5, m.entries.size());
        LauncherModel.Entry f = m.entries.get(m.indexOfFolder(id));
        assertEquals("Kids TV", f.name);
        assertEquals(Arrays.asList("b/B", "d/D"), f.apps);

        LauncherModel back = LauncherModel.load(m.save());
        assertEquals(m.save(), back.save());
        String id2 = back.newFolder("c/C", "");
        assertFalse(id.equals(id2));

        assertTrue(back.moveInFolder(id, 1, 0));
        assertEquals(Arrays.asList("d/D", "b/B"), back.entries.get(back.indexOfFolder(id)).apps);
        assertTrue(back.removeFromFolder(id, "d/D"));
        int fi = back.indexOfFolder(id);
        assertEquals("d/D", back.entries.get(fi + 1).key);
        assertTrue(back.removeFromFolder(id, "b/B"));
        assertEquals(-1, back.indexOfFolder(id)); // empty folder goes away
    }

    @Test public void uninstalledAppsLeaveFoldersAndEmptyFoldersVanish() {
        LauncherModel m = fresh();
        String id = m.newFolder("e/E", "x");
        m.reconcile(Arrays.asList("a/A", "b/B", "us/Main", "c/C", "d/D"), "us/Main");
        assertEquals(-1, m.indexOfFolder(id));
        assertEquals(5, m.entries.size());
    }

    @Test public void ungroupPutsAppsBackInPlace() {
        LauncherModel m = fresh();
        String id = m.newFolder("a/A", "");
        m.addToFolder("b/B", id);
        m.ungroup(id);
        assertEquals(Arrays.asList("us/Main", "a/A", "b/B", "c/C", "d/D", "e/E"), LauncherModel.keys(m.entries));
    }

    @Test public void loadIgnoresJunk() {
        LauncherModel m = LauncherModel.load("zzz\na|\nf||x|\na|ok/K\n");
        assertEquals(1, m.entries.size());
    }

    @Test public void appsOnlyGeometry() {
        // 5 banner tiles a row, 16:9, inside the 58 dp margins of a 960 dp wide TV screen.
        assertEquals(5, Spec.COLS);
        assertEquals(16.0 / 9.0, Spec.TILE_W / (double) Spec.TILE_H, 0.02);
        assertTrue(Spec.EDGE + Spec.gridWidth() <= Spec.SCREEN_W - Spec.EDGE + 6);
        assertEquals(Spec.EDGE + 4 * (Spec.TILE_W + Spec.GAP_X), Spec.colX(4));
        assertEquals(3, Spec.rows(11));
    }
}
