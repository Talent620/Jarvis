package net.serwer256.jarvis;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.core.app.NotificationCompat;

import java.util.ArrayList;

/**
 * Nasłuch słowa-klucza "Jarvis" w tle (foreground service + SpeechRecognizer).
 * Po wykryciu uruchamia aplikację przez deep-link jarvis://wake.
 * To rozwiązanie eksperymentalne — działa, gdy dostępne jest rozpoznawanie mowy
 * Google i przyznano uprawnienie do mikrofonu.
 */
public class WakeWordService extends Service {

    private static final String CHANNEL = "jarvis_wake";
    private SpeechRecognizer recognizer;
    private Intent recognizerIntent;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean running = false;
    private boolean triggered = false;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!running) {
            running = true;
            startForegroundNotif();
            startListening();
        }
        return START_STICKY;
    }

    private void startForegroundNotif() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "JARVIS nasłuch", NotificationManager.IMPORTANCE_LOW);
            if (nm != null) nm.createNotificationChannel(ch);
        }
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
                .setContentTitle("JARVIS nasłuchuje")
                .setContentText("Powiedz \"Szef\" (agent) lub \"Jarvis\", aby uruchomić.")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(1, n);
        }
    }

    private void startListening() {
        handler.post(() -> {
            try {
                if (!SpeechRecognizer.isRecognitionAvailable(this)) {
                    return;
                }
                if (recognizer == null) {
                    recognizer = SpeechRecognizer.createSpeechRecognizer(this);
                    recognizerIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pl-PL");
                    recognizerIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                    recognizer.setRecognitionListener(listener);
                }
                recognizer.startListening(recognizerIntent);
            } catch (Exception e) {
                restart(1500);
            }
        });
    }

    private void restart(long delayMs) {
        handler.postDelayed(() -> {
            if (running) {
                try {
                    if (recognizer != null) recognizer.cancel();
                } catch (Exception ignored) {
                }
                startListening();
            }
        }, delayMs);
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override public void onResults(Bundle results) { handle(results); restart(500); }
        @Override public void onPartialResults(Bundle partialResults) { handle(partialResults); }
        @Override public void onError(int error) { restart(900); }
        @Override public void onReadyForSpeech(Bundle params) {}
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onEvent(int eventType, Bundle params) {}
    };

    private void handle(Bundle b) {
        ArrayList<String> list = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (list == null) return;
        for (String s : list) {
            if (s == null) continue;
            String t = s.toLowerCase();
            // „szef" → otwórz Tryb Szefa (centralny agent); „jarvis" → zwykły nasłuch.
            if (t.contains("szef")) {
                if (!triggered) {
                    triggered = true;
                    launchApp("jarvis://boss");
                    handler.postDelayed(() -> triggered = false, 4000);
                }
                return;
            }
            if (t.contains("jarvis")) {
                if (!triggered) {
                    triggered = true;
                    launchApp("jarvis://wake");
                    handler.postDelayed(() -> triggered = false, 4000);
                }
                return;
            }
        }
    }

    private void launchApp(String uri) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
            i.setPackage(getPackageName());
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(i);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        try {
            if (recognizer != null) {
                recognizer.destroy();
                recognizer = null;
            }
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }
}
