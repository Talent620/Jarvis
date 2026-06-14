package net.serwer256.jarvis;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WakeWordPlugin.class);
        registerPlugin(NativeTtsPlugin.class);
        super.onCreate(savedInstanceState);
        // Okno na telefonie: domyślny układ Androida (fitsSystemWindows) sprawia, że
        // WebView jest renderowany PONIŻEJ paska stanu i NAD paskiem nawigacji —
        // nic nie chowa się pod paskami systemowymi. Kolory pasków: styles.xml +
        // StatusBar (overlay:false) po stronie web.
    }

    // Aktualizuj intencję, gdy aplikacja jest już otwarta (udostępnienia / skróty),
    // żeby wtyczka send-intent mogła ją odczytać.
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }
}
