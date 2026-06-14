package net.serwer256.jarvis;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WakeWordPlugin.class);
        registerPlugin(NativeTtsPlugin.class);
        super.onCreate(savedInstanceState);
        applySafeAreaInsets();
    }

    // „Okno na telefonie", nie strona w przeglądarce: pełny edge-to-edge, a realne
    // wysokości pasków systemowych (stanu/nawigacji) podajemy do CSS jako zmienne
    // --sat/--sar/--sab/--sal. Na Androidzie env(safe-area-inset-*) nie obejmuje
    // pasków systemowych (tylko wcięcie ekranu), więc liczymy je tutaj natywnie.
    private void applySafeAreaInsets() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        final View root = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float d = getResources().getDisplayMetrics().density;
            final String js =
                "document.documentElement.style.setProperty('--sat','" + Math.round(bars.top / d) + "px');" +
                "document.documentElement.style.setProperty('--sar','" + Math.round(bars.right / d) + "px');" +
                "document.documentElement.style.setProperty('--sab','" + Math.round(bars.bottom / d) + "px');" +
                "document.documentElement.style.setProperty('--sal','" + Math.round(bars.left / d) + "px');";
            if (getBridge() != null && getBridge().getWebView() != null) {
                final View web = getBridge().getWebView();
                web.post(() -> getBridge().getWebView().evaluateJavascript(js, null));
            }
            return insets;
        });
    }

    // Aktualizuj intencję, gdy aplikacja jest już otwarta (udostępnienia / skróty),
    // żeby wtyczka send-intent mogła ją odczytać.
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }
}
