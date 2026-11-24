package net.serwer256.jarvis;

import android.media.AudioAttributes;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
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
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Natywny silnik mowy Androida — pewniejszy niż Web Speech w WebView.
 * Używa UtteranceProgressListener, dzięki czemu Promise speak() kończy się dopiero
 * po faktycznym wypowiedzeniu zdania (albo barge-in/stop), eliminując echo mikrofonu.
 */
@CapacitorPlugin(name = "NativeTTS")
public class NativeTtsPlugin extends Plugin implements TextToSpeech.OnInitListener {

    private TextToSpeech tts;
    private boolean ready = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicInteger seq = new AtomicInteger(0);
    private final Object lock = new Object();
    private PluginCall activeCall = null;
    private String activeUtteranceId = null;
    private Runnable safetyTimeout = null;

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
        if (ready && tts != null) {
            try {
                tts.setLanguage(new Locale("pl", "PL"));
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    tts.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANT)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build());
                }
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {}

                    @Override
                    public void onDone(String utteranceId) {
                        resolveIfMatches(utteranceId);
                    }

                    @Override
                    @SuppressWarnings("deprecation")
                    public void onError(String utteranceId) {
                        resolveIfMatches(utteranceId);
                    }

                    @Override
                    public void onError(String utteranceId, int errorCode) {
                        resolveIfMatches(utteranceId);
                    }

                    @Override
                    public void onStop(String utteranceId, boolean interrupted) {
                        resolveIfMatches(utteranceId);
                    }
                });
            } catch (Exception ignored) {
            }
        }
    }

    private void resolveIfMatches(String utteranceId) {
        PluginCall toResolve = null;
        synchronized (lock) {
            if (activeCall != null && (utteranceId == null || utteranceId.equals(activeUtteranceId))) {
                toResolve = activeCall;
                activeCall = null;
                activeUtteranceId = null;
                if (safetyTimeout != null) {
                    mainHandler.removeCallbacks(safetyTimeout);
                    safetyTimeout = null;
                }
            }
        }
        if (toResolve != null) {
            toResolve.resolve();
        }
    }

    private void resolveActiveNow() {
        resolveIfMatches(null);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        if (tts == null || !ready) {
            call.reject("TTS niedostępny");
            return;
        }
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            call.resolve();
            return;
        }
        Float pitch = call.getFloat("pitch", 1f);
        Float rate = call.getFloat("rate", 1f);
        String lang = call.getString("lang", "pl-PL");
        String voiceName = call.getString("voice", "");

        // Przerwij poprzednie wywołanie bez zostawiania wiszącej obietnicy w JS.
        resolveActiveNow();

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

        final String uttId = "jarvis-utt-" + seq.incrementAndGet();
        long maxWaitMs = Math.max(8000L, Math.min(120000L, text.length() * 140L + 6000L));
        synchronized (lock) {
            activeCall = call;
            activeUtteranceId = uttId;
            safetyTimeout = () -> resolveIfMatches(uttId);
            mainHandler.postDelayed(safetyTimeout, maxWaitMs);
        }

        int rc = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, uttId);
        if (rc == TextToSpeech.ERROR) {
            resolveIfMatches(uttId);
        }
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
        resolveActiveNow();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        resolveActiveNow();
        if (tts != null) {
            try {
                tts.shutdown();
            } catch (Exception ignored) {
            }
            tts = null;
        }
    }
}
