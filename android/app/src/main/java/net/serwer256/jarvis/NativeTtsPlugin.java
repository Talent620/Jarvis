package net.serwer256.jarvis;

import android.speech.tts.TextToSpeech;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

/** Natywny silnik mowy Androida — pewniejszy niż Web Speech w WebView. */
@CapacitorPlugin(name = "NativeTTS")
public class NativeTtsPlugin extends Plugin implements TextToSpeech.OnInitListener {

    private TextToSpeech tts;
    private boolean ready = false;

    @Override
    public void load() {
        try {
            tts = new TextToSpeech(getContext(), this);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onInit(int status) {
        ready = status == TextToSpeech.SUCCESS;
        if (ready) {
            try {
                tts.setLanguage(new Locale("pl", "PL"));
            } catch (Exception ignored) {
            }
        }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        if (tts == null || !ready) {
            call.reject("TTS niedostępny");
            return;
        }
        String text = call.getString("text", "");
        Float pitch = call.getFloat("pitch", 1f);
        Float rate = call.getFloat("rate", 1f);
        String lang = call.getString("lang", "pl-PL");
        try {
            tts.setLanguage(Locale.forLanguageTag(lang));
        } catch (Exception ignored) {
        }
        tts.setPitch(pitch == null ? 1f : pitch);
        tts.setSpeechRate(rate == null ? 1f : rate);
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "jarvis-utt");
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) {
            try {
                tts.stop();
            } catch (Exception ignored) {
            }
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            try {
                tts.shutdown();
            } catch (Exception ignored) {
            }
            tts = null;
        }
    }
}
