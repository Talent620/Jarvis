package net.serwer256.jarvis;

import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.Locale;
import java.util.Set;

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
        String voiceName = call.getString("voice", "");
        try {
            tts.setLanguage(Locale.forLanguageTag(lang));
        } catch (Exception ignored) {
        }
        // Wybór KONKRETNEGO głosu (gdy podano nazwę) — inaczej silnik bierze domyślny
        // głos systemowy, który bywa „translatorowy" i potrafi się zmieniać.
        if (voiceName != null && !voiceName.isEmpty()) {
            try {
                Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                    for (Voice v : voices) {
                        if (v != null && voiceName.equals(v.getName())) {
                            tts.setVoice(v);
                            break;
                        }
                    }
                }
            } catch (Exception ignored) {
            }
        }
        tts.setPitch(pitch == null ? 1f : pitch);
        tts.setSpeechRate(rate == null ? 1f : rate);
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "jarvis-utt");
        call.resolve();
    }

    /** Lista dostępnych głosów silnika (nazwa, język, jakość, czy wymaga sieci) —
     *  do wyboru jednego, stałego głosu w ustawieniach JARVISA. */
    @PluginMethod
    public void listVoices(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray arr = new JSArray();
        try {
            if (tts != null && ready) {
                Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                    for (Voice v : voices) {
                        if (v == null) continue;
                        try {
                            JSONObject o = new JSONObject();
                            o.put("name", v.getName());
                            Locale loc = v.getLocale();
                            o.put("lang", loc != null ? loc.toLanguageTag() : "");
                            o.put("quality", v.getQuality());
                            o.put("network", v.isNetworkConnectionRequired());
                            arr.put(o);
                        } catch (Exception ignored) {
                        }
                    }
                }
            }
        } catch (Exception ignored) {
        }
        ret.put("voices", arr);
        call.resolve(ret);
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
