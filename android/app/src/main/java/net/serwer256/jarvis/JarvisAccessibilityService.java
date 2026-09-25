package net.serwer256.jarvis;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.os.Build;
import android.os.Bundle;
import android.graphics.Rect;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.util.ArrayDeque;
import java.util.List;

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

    // ------------------------------------------------------------------ semantic primitives (M9)
    // The JARVIS runtime reads these back to confirm every action; nothing here guesses pixels.

    /** The node with input focus, else accessibility focus, in the active window. */
    public AccessibilityNodeInfo focusedNode() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        AccessibilityNodeInfo n = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (n == null) n = root.findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY);
        return n;
    }

    private static String str(CharSequence c) { return c == null ? "" : c.toString(); }

    public JSObject describeFocused() {
        JSObject o = new JSObject();
        AccessibilityNodeInfo n = focusedNode();
        o.put("found", n != null);
        if (n == null) return o;
        n.refresh();
        CharSequence text = n.getText();
        o.put("text", text == null ? null : text.toString());
        o.put("role", str(n.getClassName()));
        o.put("app", str(n.getPackageName()));
        o.put("name", str(n.getContentDescription()));
        o.put("editable", n.isEditable());
        int s = n.getTextSelectionStart();
        int e = n.getTextSelectionEnd();
        o.put("selectionStart", s);
        o.put("selectionEnd", e);
        if (text != null && s >= 0 && e > s && e <= text.length()) o.put("selection", text.subSequence(s, e).toString());
        else o.put("selection", "");
        return o;
    }

    public JSObject activeWindow() {
        JSObject o = new JSObject();
        AccessibilityNodeInfo root = getRootInActiveWindow();
        o.put("found", root != null);
        if (root == null) return o;
        o.put("app", str(root.getPackageName()));
        o.put("id", String.valueOf(root.getWindowId()));
        String title = "";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            List<AccessibilityWindowInfo> ws = getWindows();
            for (AccessibilityWindowInfo w : ws) if (w.getId() == root.getWindowId()) title = str(w.getTitle());
        }
        o.put("title", title);
        return o;
    }

    public JSArray windowList() {
        JSArray arr = new JSArray();
        List<AccessibilityWindowInfo> ws = getWindows();
        for (AccessibilityWindowInfo w : ws) {
            JSObject o = new JSObject();
            o.put("id", String.valueOf(w.getId()));
            o.put("title", Build.VERSION.SDK_INT >= Build.VERSION_CODES.N ? str(w.getTitle()) : "");
            AccessibilityNodeInfo r = w.getRoot();
            o.put("app", r == null ? "" : str(r.getPackageName()));
            o.put("active", w.isActive());
            arr.put(o);
        }
        return arr;
    }

    /** Select [start, end) in the focused text node (ACTION_SET_SELECTION). */
    public boolean selectText(int start, int end) {
        AccessibilityNodeInfo n = focusedNode();
        if (n == null) return false;
        Bundle args = new Bundle();
        args.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, start);
        args.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, end);
        return n.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, args);
    }

    /** ACTION_COPY on the focused node (copies its selection). */
    public boolean copySelection() {
        AccessibilityNodeInfo n = focusedNode();
        return n != null && n.performAction(AccessibilityNodeInfo.ACTION_COPY);
    }

    /** Append to the focused editable node (ACTION_SET_TEXT with the old text plus the new). */
    public boolean appendText(String text) {
        AccessibilityNodeInfo n = focusedNode();
        if (n == null || !n.isEditable()) return false;
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, str(n.getText()) + (text == null ? "" : text));
        return n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
    }

    /** Scroll the first scrollable node of the active window. */
    public boolean scroll(boolean forward) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        ArrayDeque<AccessibilityNodeInfo> q = new ArrayDeque<>();
        q.add(root);
        int budget = 2000;
        while (!q.isEmpty() && budget-- > 0) {
            AccessibilityNodeInfo n = q.poll();
            if (n == null) continue;
            if (n.isScrollable()) return n.performAction(forward ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD);
            for (int i = 0; i < n.getChildCount(); i++) q.add(n.getChild(i));
        }
        return false;
    }

    /** A bounded breadth-first dump of the active window: class, text, description, id, flags. */
    public JSArray tree(int max) {
        JSArray arr = new JSArray();
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return arr;
        ArrayDeque<AccessibilityNodeInfo> q = new ArrayDeque<>();
        q.add(root);
        Rect b = new Rect();
        while (!q.isEmpty() && arr.length() < max) {
            AccessibilityNodeInfo n = q.poll();
            if (n == null) continue;
            JSObject o = new JSObject();
            o.put("cls", str(n.getClassName()));
            o.put("text", str(n.getText()));
            o.put("desc", str(n.getContentDescription()));
            o.put("id", n.getViewIdResourceName() == null ? "" : n.getViewIdResourceName());
            o.put("clickable", n.isClickable());
            o.put("editable", n.isEditable());
            o.put("scrollable", n.isScrollable());
            n.getBoundsInScreen(b);
            o.put("bounds", b.left + "," + b.top + "," + b.right + "," + b.bottom);
            arr.put(o);
            for (int i = 0; i < n.getChildCount(); i++) q.add(n.getChild(i));
        }
        return arr;
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
