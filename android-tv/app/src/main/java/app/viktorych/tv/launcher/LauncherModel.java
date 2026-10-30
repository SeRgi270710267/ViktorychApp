package app.viktorych.tv.launcher;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** The order of the home screen's "Your apps" grid and its folders.
 *  Plain Java (no Android types) so the rules are unit tested. An app is a
 *  key "package/activity"; a folder holds app keys and is a tile of the same
 *  size as an app. Saved privately on the TV, never sent anywhere. */
public final class LauncherModel {
    public static final class Entry {
        public final boolean folder;
        public String key;          // app key, or folder id
        public String name;         // folder name
        public final List<String> apps = new ArrayList<>();

        Entry(boolean folder, String key, String name) { this.folder = folder; this.key = key; this.name = name; }
        public static Entry app(String key) { return new Entry(false, key, ""); }
        public static Entry folder(String id, String name) { return new Entry(true, id, name); }
    }

    public final List<Entry> entries = new ArrayList<>();
    private int nextFolder = 1;

    /** Drops apps that were uninstalled and adds new ones at the end, in the
     *  system's order. Folders keep their apps; an empty folder goes away. */
    public void reconcile(List<String> installed, String pinnedFirst) {
        Set<String> live = new LinkedHashSet<>(installed);
        Set<String> seen = new LinkedHashSet<>();
        for (int i = entries.size() - 1; i >= 0; i--) {
            Entry e = entries.get(i);
            if (e.folder) {
                for (int j = e.apps.size() - 1; j >= 0; j--) {
                    String k = e.apps.get(j);
                    if (!live.contains(k) || seen.contains(k)) e.apps.remove(j); else seen.add(k);
                }
                if (e.apps.isEmpty()) entries.remove(i);
            } else if (!live.contains(e.key) || seen.contains(e.key)) {
                entries.remove(i);
            } else {
                seen.add(e.key);
            }
        }
        boolean fresh = entries.isEmpty();
        for (String k : installed) {
            if (seen.contains(k)) continue;
            if (fresh && k.equals(pinnedFirst)) entries.add(0, Entry.app(k)); else entries.add(Entry.app(k));
            seen.add(k);
        }
    }

    /** Moves the tile at from to index to (Move mode on the remote). */
    public boolean move(int from, int to) {
        if (from < 0 || from >= entries.size()) return false;
        to = Math.max(0, Math.min(entries.size() - 1, to));
        if (from == to) return false;
        entries.add(to, entries.remove(from));
        return true;
    }

    public int indexOfApp(String key) {
        for (int i = 0; i < entries.size(); i++) if (!entries.get(i).folder && entries.get(i).key.equals(key)) return i;
        return -1;
    }

    public int indexOfFolder(String id) {
        for (int i = 0; i < entries.size(); i++) if (entries.get(i).folder && entries.get(i).key.equals(id)) return i;
        return -1;
    }

    public List<Entry> folders() {
        List<Entry> out = new ArrayList<>();
        for (Entry e : entries) if (e.folder) out.add(e);
        return out;
    }

    /** Makes a new folder where the app was, holding that app. Returns its id. */
    public String newFolder(String appKey, String name) {
        int at = indexOfApp(appKey);
        if (at < 0) return null;
        String id = "f" + (nextFolder++);
        while (indexOfFolder(id) >= 0) id = "f" + (nextFolder++);
        Entry f = Entry.folder(id, cleanName(name));
        f.apps.add(appKey);
        entries.set(at, f);
        return id;
    }

    /** Moves a top-level app into a folder (added last). */
    public boolean addToFolder(String appKey, String folderId) {
        int at = indexOfApp(appKey);
        int fi = indexOfFolder(folderId);
        if (at < 0 || fi < 0) return false;
        entries.get(fi).apps.add(appKey);
        entries.remove(at);
        return true;
    }

    /** Takes an app out of its folder; it goes right after the folder. */
    public boolean removeFromFolder(String folderId, String appKey) {
        int fi = indexOfFolder(folderId);
        if (fi < 0) return false;
        Entry f = entries.get(fi);
        if (!f.apps.remove(appKey)) return false;
        entries.add(fi + 1, Entry.app(appKey));
        if (f.apps.isEmpty()) entries.remove(fi);
        return true;
    }

    /** Moves an app inside its folder. */
    public boolean moveInFolder(String folderId, int from, int to) {
        int fi = indexOfFolder(folderId);
        if (fi < 0) return false;
        List<String> a = entries.get(fi).apps;
        if (from < 0 || from >= a.size()) return false;
        to = Math.max(0, Math.min(a.size() - 1, to));
        if (from == to) return false;
        a.add(to, a.remove(from));
        return true;
    }

    public void rename(String folderId, String name) {
        int fi = indexOfFolder(folderId);
        if (fi >= 0) entries.get(fi).name = cleanName(name);
    }

    /** Opens the folder back up: its apps go where it was. */
    public void ungroup(String folderId) {
        int fi = indexOfFolder(folderId);
        if (fi < 0) return;
        Entry f = entries.remove(fi);
        for (int i = f.apps.size() - 1; i >= 0; i--) entries.add(fi, Entry.app(f.apps.get(i)));
    }

    public static String cleanName(String raw) {
        String t = raw == null ? "" : raw.replaceAll("[\\p{Cc}\\p{Cf}\\t\\n|,]", " ").replaceAll("\\s+", " ").trim();
        if (t.codePointCount(0, t.length()) > 30) t = t.substring(0, t.offsetByCodePoints(0, 30)).trim();
        return t;
    }

    /** One line per tile: "a|key" or "f|id|name|key,key". */
    public String save() {
        StringBuilder b = new StringBuilder();
        for (Entry e : entries) {
            if (e.folder) {
                b.append("f|").append(e.key).append('|').append(cleanName(e.name)).append('|');
                for (int i = 0; i < e.apps.size(); i++) { if (i > 0) b.append(','); b.append(e.apps.get(i)); }
            } else {
                b.append("a|").append(e.key);
            }
            b.append('\n');
        }
        return b.toString();
    }

    public static LauncherModel load(String text) {
        LauncherModel m = new LauncherModel();
        if (text == null) return m;
        for (String line : text.split("\n")) {
            String[] p = line.split("\\|", -1);
            if (p.length >= 2 && "a".equals(p[0]) && !p[1].isEmpty()) {
                m.entries.add(Entry.app(p[1]));
            } else if (p.length >= 4 && "f".equals(p[0]) && !p[1].isEmpty()) {
                Entry f = Entry.folder(p[1], p[2]);
                for (String k : p[3].split(",")) if (!k.isEmpty()) f.apps.add(k);
                m.entries.add(f);
                try { m.nextFolder = Math.max(m.nextFolder, Integer.parseInt(p[1].substring(1)) + 1); } catch (RuntimeException ignored) { /* odd id */ }
            }
        }
        return m;
    }

    public static List<String> keys(Collection<Entry> es) {
        List<String> out = new ArrayList<>();
        for (Entry e : es) out.add(e.key);
        return out;
    }
}
