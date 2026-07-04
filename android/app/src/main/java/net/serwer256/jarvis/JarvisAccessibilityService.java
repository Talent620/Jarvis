package net.serwer256.jarvis;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.os.Build;
import android.os.Bundle;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * Usługa Dostępności JARVIS-a — pozwala Szefowi REALNIE działać w telefonie:
 * wpisywać tekst w aktywne pole, dotykać ekranu (gest), oraz wykonywać akcje globalne
 * (wstecz / ekran główny / ostatnie / powiadomienia). Użytkownik włącza ją RAZ
 * w Ustawieniach → Dostępność (Android tak chroni te uprawnienia).
 */
public class JarvisAccessibilityService extends AccessibilityService {

    private static JarvisAccessibilityService instance;

    public static boolean isEnabled() { return instance != null; }
    public static JarvisAccessibilityService get() { return instance; }

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) { /* nasłuch nieużywany */ }

    @Override
    public void onInterrupt() { /* brak */ }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    /** Wpisz tekst w aktualnie aktywne (lub pierwsze edytowalne) pole. */
    public boolean typeText(String text) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        AccessibilityNodeInfo node = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (node == null) node = findEditable(root);
        if (node == null) return false;
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text == null ? "" : text);
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
    }

    private AccessibilityNodeInfo findEditable(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isEditable()) return node;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo r = findEditable(node.getChild(i));
            if (r != null) return r;
        }
        return null;
    }

    /** Dotknij ekranu w punkcie (px) — gest tap. Wymaga API 24+. */
    public boolean tap(float x, float y) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        try {
            Path p = new Path();
            p.moveTo(x, y);
            GestureDescription.Builder b = new GestureDescription.Builder();
            b.addStroke(new GestureDescription.StrokeDescription(p, 0, 60));
            return dispatchGesture(b.build(), null, null);
        } catch (Exception e) {
            return false;
        }
    }

    /** Akcja globalna: back | home | recents | notifications. */
    public boolean global(String action) {
        int a;
        if (action == null) action = "back";
        switch (action) {
            case "home": a = GLOBAL_ACTION_HOME; break;
            case "recents": a = GLOBAL_ACTION_RECENTS; break;
            case "notifications": a = GLOBAL_ACTION_NOTIFICATIONS; break;
            case "back":
            default: a = GLOBAL_ACTION_BACK; break;
        }
        return performGlobalAction(a);
    }
}
