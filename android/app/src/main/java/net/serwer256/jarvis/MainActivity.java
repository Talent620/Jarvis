package net.serwer256.jarvis;

import android.content.Intent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Aktualizuj intencję, gdy aplikacja jest już otwarta (udostępnienia / skróty),
    // żeby wtyczka send-intent mogła ją odczytać.
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }
}
