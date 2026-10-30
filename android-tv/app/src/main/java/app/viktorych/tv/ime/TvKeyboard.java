package app.viktorych.tv.ime;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.inputmethodservice.InputMethodService;
import android.speech.RecognizerIntent;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;

import app.viktorych.tv.R;

/** A keyboard made for the remote: the arrows move, OK types. Letters in
 *  English, Spanish, Russian and Hindi, symbols, emoji, and voice typing
 *  through the TV's own speech recognizer. Nothing typed leaves the TV. */
public final class TvKeyboard extends InputMethodService {
    static final String PREFS = "viktorych_tv_keyboard";
    private static TvKeyboard live;
    private static String pendingVoice;

    private KeyboardView view;
    private String lang = "en";
    private KeyLayout.Mode mode = KeyLayout.Mode.LETTERS;
    private boolean shift, capsLock;
    private int emojiPage;
    private boolean voice;

    @Override
    public void onCreate() {
        super.onCreate();
        live = this;
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        lang = p.getString("lang", defaultLang());
        voice = !getPackageManager().queryIntentActivities(
                new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH), PackageManager.MATCH_DEFAULT_ONLY).isEmpty();
    }

    @Override
    public void onDestroy() {
        if (live == this) live = null;
        super.onDestroy();
    }

    private String defaultLang() {
        String l = getResources().getConfiguration().locale.getLanguage();
        for (String s : KeyLayout.LANGS) if (s.equals(l)) return s;
        return "en";
    }

    @Override
    public boolean onEvaluateFullscreenMode() { return false; }

    @Override
    public View onCreateInputView() {
        view = new KeyboardView(this);
        rebuild();
        return view;
    }

    @Override
    public void onStartInputView(EditorInfo info, boolean restarting) {
        super.onStartInputView(info, restarting);
        int cls = info.inputType & InputType.TYPE_MASK_CLASS;
        mode = cls == InputType.TYPE_CLASS_NUMBER || cls == InputType.TYPE_CLASS_PHONE
                ? KeyLayout.Mode.SYMBOLS : KeyLayout.Mode.LETTERS;
        capsLock = false;
        shift = (info.inputType & InputType.TYPE_TEXT_FLAG_CAP_SENTENCES) != 0 && atSentenceStart();
        if (view != null) {
            view.setEnterLabel(enterLabel(info));
            rebuild();
            // Start on a letter in the middle, where Gboard starts.
            view.select(1, Math.min(4, view.rows().get(1).size() - 1));
        }
        if (pendingVoice != null) {
            commit(pendingVoice);
            pendingVoice = null;
        }
    }

    private String enterLabel(EditorInfo info) {
        switch (info.imeOptions & EditorInfo.IME_MASK_ACTION) {
            case EditorInfo.IME_ACTION_SEARCH: return getString(R.string.kb_search);
            case EditorInfo.IME_ACTION_GO: return getString(R.string.kb_go);
            case EditorInfo.IME_ACTION_SEND: return getString(R.string.kb_send);
            case EditorInfo.IME_ACTION_NEXT: return getString(R.string.kb_next);
            case EditorInfo.IME_ACTION_DONE: return getString(R.string.kb_done);
            default: return "";
        }
    }

    private boolean atSentenceStart() {
        InputConnection ic = getCurrentInputConnection();
        if (ic == null) return true;
        CharSequence before = ic.getTextBeforeCursor(2, 0);
        if (before == null || before.length() == 0) return true;
        String t = before.toString().trim();
        return t.isEmpty() || t.endsWith(".") || t.endsWith("!") || t.endsWith("?") || t.endsWith("।");
    }

    private void rebuild() {
        if (view == null) return;
        view.setRows(KeyLayout.build(lang, mode, shift || capsLock, emojiPage, voice), shift || capsLock);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (view == null || !isInputViewShown()) return super.onKeyDown(keyCode, event);
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_LEFT: return move(0, -1);
            case KeyEvent.KEYCODE_DPAD_RIGHT: return move(0, 1);
            case KeyEvent.KEYCODE_DPAD_UP: return move(-1, 0);
            case KeyEvent.KEYCODE_DPAD_DOWN: return move(1, 0);
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                if (event.getRepeatCount() == 0) event.startTracking();
                else if (view.current().code == KeyLayout.Code.DELETE) press(view.current());
                return true;
            default:
                return super.onKeyDown(keyCode, event);
        }
    }

    @Override
    public boolean onKeyLongPress(int keyCode, KeyEvent event) {
        // Holding OK on a letter types it in capitals once.
        KeyLayout.Key k = view == null ? null : view.current();
        if (k != null && k.code == KeyLayout.Code.TEXT) {
            commit(k.text.toUpperCase());
            longPressed = true;
            return true;
        }
        if (k != null && k.code == KeyLayout.Code.SHIFT) {
            capsLock = !capsLock;
            shift = false;
            rebuild();
            longPressed = true;
            return true;
        }
        return super.onKeyLongPress(keyCode, event);
    }

    private boolean longPressed;

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (view == null || !isInputViewShown()) return super.onKeyUp(keyCode, event);
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER
                || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER) {
            if (longPressed) { longPressed = false; return true; }
            boolean held = (event.getFlags() & KeyEvent.FLAG_CANCELED_LONG_PRESS) != 0;
            if (!event.isCanceled() && !held) press(view.current());
            return true;
        }
        if (keyCode >= KeyEvent.KEYCODE_DPAD_UP && keyCode <= KeyEvent.KEYCODE_DPAD_RIGHT) return true;
        return super.onKeyUp(keyCode, event);
    }

    private boolean move(int dRow, int dCol) {
        int[] rc = KeyLayout.move(view.rows(), view.row(), view.col(), dRow, dCol);
        view.select(rc[0], rc[1]);
        return true;
    }

    private void press(KeyLayout.Key k) {
        switch (k.code) {
            case TEXT:
                commit(k.text);
                if (shift && !capsLock) { shift = false; rebuild(); }
                break;
            case SPACE:
                commit(" ");
                break;
            case DELETE:
                sendDownUpKeyEvents(KeyEvent.KEYCODE_DEL);
                break;
            case SHIFT:
                if (capsLock) { capsLock = false; shift = false; } else shift = !shift;
                rebuild();
                break;
            case SYMBOLS:
                mode = KeyLayout.Mode.SYMBOLS; rebuild();
                break;
            case LETTERS:
                mode = KeyLayout.Mode.LETTERS; rebuild();
                break;
            case EMOJI:
                mode = KeyLayout.Mode.EMOJI; rebuild();
                break;
            case PAGE_PREV:
                emojiPage--; rebuild();
                break;
            case PAGE_NEXT:
                emojiPage++; rebuild();
                break;
            case LANGUAGE:
                lang = KeyLayout.nextLang(lang);
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("lang", lang).apply();
                rebuild();
                break;
            case VOICE:
                startVoice();
                break;
            case ENTER:
                enter();
                break;
        }
    }

    private void commit(String s) {
        InputConnection ic = getCurrentInputConnection();
        if (ic != null) ic.commitText(s, 1);
    }

    private void enter() {
        EditorInfo info = getCurrentInputEditorInfo();
        int action = info == null ? EditorInfo.IME_ACTION_NONE : info.imeOptions & EditorInfo.IME_MASK_ACTION;
        boolean multiLine = info != null && (info.inputType & InputType.TYPE_TEXT_FLAG_MULTI_LINE) != 0;
        InputConnection ic = getCurrentInputConnection();
        if (ic == null) return;
        if (!multiLine && action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED
                && (info.imeOptions & EditorInfo.IME_FLAG_NO_ENTER_ACTION) == 0) {
            ic.performEditorAction(action);
        } else {
            sendDownUpKeyEvents(KeyEvent.KEYCODE_ENTER);
        }
    }

    private void startVoice() {
        Intent i = new Intent(this, VoiceActivity.class)
                .putExtra(VoiceActivity.EXTRA_LANG, lang)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_HISTORY);
        try { startActivity(i); } catch (RuntimeException ignored) { }
    }

    /** Called by VoiceActivity with what the recognizer heard. If the field
     *  is not back yet, the text waits for it. */
    static void voiceResult(String text) {
        if (text == null || text.isEmpty()) return;
        TvKeyboard k = live;
        InputConnection ic = k == null ? null : k.getCurrentInputConnection();
        if (ic != null && k.isInputViewShown()) ic.commitText(text, 1);
        else pendingVoice = text;
    }
}
