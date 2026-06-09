package net.serwer256.jarvis;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WakeWordPlugin.class);
        super.onCreate(savedInstanceState);
    }

    // Aktualizuj intencję, gdy aplikacja jest już otwarta (udostępnienia / skróty),
    // żeby wtyczka send-intent mogła ją odczytać.
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }
}
