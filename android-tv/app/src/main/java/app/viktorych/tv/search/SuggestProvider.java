package app.viktorych.tv.search;

import android.app.SearchManager;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;

import java.util.List;

import app.viktorych.tv.R;

/** Suggestions for the search screen and for the TV's own search: "Search
 *  ViktorychApp for …" and matching recent searches. Read only, and it
 *  reads nothing but this app's own recent searches. */
public final class SuggestProvider extends ContentProvider {
    private static final String[] COLUMNS = {
        "_id",
        SearchManager.SUGGEST_COLUMN_TEXT_1,
        SearchManager.SUGGEST_COLUMN_TEXT_2,
        SearchManager.SUGGEST_COLUMN_ICON_1,
        SearchManager.SUGGEST_COLUMN_RESULT_CARD_IMAGE,
        SearchManager.SUGGEST_COLUMN_INTENT_ACTION,
        SearchManager.SUGGEST_COLUMN_QUERY,
        SearchManager.SUGGEST_COLUMN_INTENT_EXTRA_DATA,
    };

    @Override public boolean onCreate() { return true; }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        String typed = args != null && args.length > 0 ? args[0] : uri.getLastPathSegment();
        if (SearchManager.SUGGEST_URI_PATH_QUERY.equals(typed)) typed = "";
        typed = SearchLinks.clean(typed);
        MatrixCursor c = new MatrixCursor(COLUMNS);
        if (getContext() == null) return c;
        String icon = "android.resource://" + getContext().getPackageName() + "/" + R.drawable.kb_find;
        String card = "android.resource://" + getContext().getPackageName() + "/" + R.mipmap.ic_launcher;
        long id = 0;
        if (!typed.isEmpty()) {
            c.addRow(new Object[]{id++, getContext().getString(R.string.srch_for, typed),
                getContext().getString(R.string.srch_where), icon, card, Intent.ACTION_SEARCH, typed, typed});
        }
        List<String> recent = SearchLinks.matching(SearchDefaults.recent(getContext()), typed);
        for (String q : recent) {
            if (q.equalsIgnoreCase(typed)) continue;
            c.addRow(new Object[]{id++, q, getContext().getString(R.string.srch_recent), icon, card,
                Intent.ACTION_SEARCH, q, q});
            if (id >= 6) break;
        }
        return c;
    }

    @Override public String getType(Uri uri) { return SearchManager.SUGGEST_MIME_TYPE; }
    @Override public Uri insert(Uri uri, ContentValues v) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}
