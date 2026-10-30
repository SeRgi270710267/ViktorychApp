package app.viktorych.tv.ime;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognizerIntent;

import java.util.ArrayList;

/** Asks the TV's own speech recognizer for one phrase and hands the text to
 *  the keyboard. The recognizer owns the microphone, so this app never
 *  needs the microphone permission. */
public final class VoiceActivity extends Activity {
    static final String EXTRA_LANG = "lang";
    private static final int REQ = 1;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (b != null) return;
        String lang = getIntent().getStringExtra(EXTRA_LANG);
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        if (lang != null) i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag(lang));
        try {
            startActivityForResult(i, REQ);
        } catch (ActivityNotFoundException e) {
            finish();
        }
    }

    static String tag(String lang) {
        switch (lang) {
            case "es": return "es-ES";
            case "ru": return "ru-RU";
            case "hi": return "hi-IN";
            default: return "en-US";
        }
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        if (req == REQ && result == RESULT_OK && data != null) {
            ArrayList<String> heard = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (heard != null && !heard.isEmpty()) TvKeyboard.voiceResult(heard.get(0));
        }
        finish();
    }
}
