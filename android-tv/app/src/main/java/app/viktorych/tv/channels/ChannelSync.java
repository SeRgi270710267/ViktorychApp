package app.viktorych.tv.channels;

import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.media.tv.TvContract;
import android.net.Uri;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;

import app.viktorych.tv.R;

/** Writes our one channel and its guide into the TV's own channel list
 *  (TvProvider). Runs only when someone opens the setup screen or tunes the
 *  channel: there is no background job. */
public final class ChannelSync {
    private ChannelSync() {}

    public static String inputId(Context c) {
        return TvContract.buildInputId(new ComponentName(c, LoopInputService.class));
    }

    /** Our channel's id, or -1 when it has not been added yet. */
    public static long channelId(Context c) {
        Cursor cur = null;
        try {
            cur = c.getContentResolver().query(TvContract.buildChannelsUriForInput(inputId(c)),
                new String[] {TvContract.Channels._ID}, null, null, null);
            if (cur != null && cur.moveToFirst()) return cur.getLong(0);
        } catch (RuntimeException e) {
            // No TvProvider on this device, or no access: treat as not added.
        } finally {
            if (cur != null) cur.close();
        }
        return -1;
    }

    /** Adds or refreshes the channel, its logo and the next hours of guide.
     *  Returns the channel id. Call off the main thread. */
    public static long sync(Context c) {
        ContentResolver r = c.getContentResolver();
        ContentValues v = new ContentValues();
        v.put(TvContract.Channels.COLUMN_INPUT_ID, inputId(c));
        v.put(TvContract.Channels.COLUMN_DISPLAY_NUMBER, "1");
        v.put(TvContract.Channels.COLUMN_DISPLAY_NAME, c.getString(R.string.ch_station));
        v.put(TvContract.Channels.COLUMN_DESCRIPTION, c.getString(R.string.ch_station_desc));
        v.put(TvContract.Channels.COLUMN_TYPE, TvContract.Channels.TYPE_OTHER);
        v.put(TvContract.Channels.COLUMN_SERVICE_TYPE, TvContract.Channels.SERVICE_TYPE_AUDIO);
        v.put(TvContract.Channels.COLUMN_ORIGINAL_NETWORK_ID, 1);
        v.put(TvContract.Channels.COLUMN_SERVICE_ID, 1);
        v.put(TvContract.Channels.COLUMN_SEARCHABLE, 1);
        long id = channelId(c);
        if (id < 0) {
            Uri made = r.insert(TvContract.Channels.CONTENT_URI, v);
            if (made == null) throw new IllegalStateException("channel");
            id = Long.parseLong(made.getLastPathSegment());
        } else {
            r.update(TvContract.buildChannelUri(id), v, null, null);
        }
        writeLogo(c, id);
        guide(c, id, System.currentTimeMillis());
        return id;
    }

    /** Replaces our future guide entries with fresh hour blocks. */
    static void guide(Context c, long id, long now) {
        ContentResolver r = c.getContentResolver();
        r.delete(TvContract.buildProgramsUriForChannel(id),
            TvContract.Programs.COLUMN_END_TIME_UTC_MILLIS + ">?", new String[] {String.valueOf(now)});
        List<long[]> blocks = LoopModel.blocks(now);
        ContentValues[] rows = new ContentValues[blocks.size()];
        String genre = TvContract.Programs.Genres.encode(TvContract.Programs.Genres.MUSIC);
        for (int i = 0; i < rows.length; i++) {
            ContentValues p = new ContentValues();
            p.put(TvContract.Programs.COLUMN_CHANNEL_ID, id);
            p.put(TvContract.Programs.COLUMN_TITLE, c.getString(R.string.ch_program));
            p.put(TvContract.Programs.COLUMN_SHORT_DESCRIPTION, c.getString(R.string.ch_program_desc));
            p.put(TvContract.Programs.COLUMN_START_TIME_UTC_MILLIS, blocks.get(i)[0]);
            p.put(TvContract.Programs.COLUMN_END_TIME_UTC_MILLIS, blocks.get(i)[1]);
            p.put(TvContract.Programs.COLUMN_CANONICAL_GENRE, genre);
            rows[i] = p;
        }
        r.bulkInsert(TvContract.Programs.CONTENT_URI, rows);
    }

    private static void writeLogo(Context c, long id) {
        Bitmap b = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        cv.drawColor(0xFF1D9BF0);
        Drawable d = c.getDrawable(R.drawable.ch_radio);
        if (d != null) {
            d.setBounds(48, 48, 208, 208);
            d.draw(cv);
        }
        OutputStream out = null;
        try {
            out = c.getContentResolver().openOutputStream(TvContract.buildChannelLogoUri(id));
            if (out != null) b.compress(Bitmap.CompressFormat.PNG, 100, out);
        } catch (IOException | RuntimeException e) {
            // The guide shows the name without a logo.
        } finally {
            if (out != null) try { out.close(); } catch (IOException ignored) { }
            b.recycle();
        }
    }

    /** Removes our channel (and with it its guide) from the TV. */
    public static void clear(Context c) {
        try {
            c.getContentResolver().delete(TvContract.buildChannelsUriForInput(inputId(c)), null, null);
        } catch (RuntimeException e) {
            // Nothing to remove.
        }
    }

    /** Reads loop/current.json. Returns null when the station can't be reached. */
    public static LoopModel.Station station() {
        HttpURLConnection h = null;
        try {
            h = (HttpURLConnection) new URL(LoopModel.CURRENT + "?t=" + System.currentTimeMillis()).openConnection();
            h.setConnectTimeout(10000);
            h.setReadTimeout(10000);
            h.setUseCaches(false);
            h.setInstanceFollowRedirects(false);
            if (h.getResponseCode() != 200) return null;
            InputStream in = h.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int n;
            while ((n = in.read(chunk)) > 0) {
                buf.write(chunk, 0, n);
                if (buf.size() > 64 * 1024) return null;
            }
            return LoopModel.parse(buf.toString("UTF-8"));
        } catch (IOException | RuntimeException e) {
            return null;
        } finally {
            if (h != null) h.disconnect();
        }
    }
}
