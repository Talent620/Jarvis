package net.serwer256.jarvis;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.List;

/**
 * Usługa Dostępności JARVIS-a ("Phone Use" Agent):
 * - eksportuje skompresowane, ponumerowane drzewo aktywnego ekranu UI: [id] Role "Label" (x,y),
 * - realizuje akcje tapById, typeText, scroll, back z pętlą Check-then-Act
 *   (ponowna weryfikacja sygnatury ekranu i elementu przed działaniem),
 * - egzekwuje twardy zakaz odczytu i wpisywania pól haseł (RiskGuard.isPasswordNode).
 */
public class JarvisAccessibilityService extends AccessibilityService {

    private static final int MAX_DEPTH = 24;
    private static final int MAX_ELEMENTS = 120;

    private static JarvisAccessibilityService instance;
    private volatile UiSnapshot lastSnapshot = null;

    public static boolean isEnabled() { return instance != null; }
    public static JarvisAccessibilityService get() { return instance; }

    public static final class UiElement {
        public final int id;
        public final String role;
        public final String label;
        public final int x;
        public final int y;
        public final boolean clickable;
        public final boolean editable;
        public final boolean scrollable;
        public final boolean password;
        public final String packageName;
        public final Rect bounds;

        public UiElement(int id, String role, String label, int x, int y,
                         boolean clickable, boolean editable, boolean scrollable,
                         boolean password, String packageName, Rect bounds) {
            this.id = id;
            this.role = role;
            this.label = label;
            this.x = x;
            this.y = y;
            this.clickable = clickable;
            this.editable = editable;
            this.scrollable = scrollable;
            this.password = password;
            this.packageName = packageName;
            this.bounds = bounds;
        }
    }

    public static final class UiSnapshot {
        public final String packageName;
        public final String signature;
        public final String compactTree;
        public final List<UiElement> elements;

        public UiSnapshot(String packageName, String signature, String compactTree, List<UiElement> elements) {
            this.packageName = packageName;
            this.signature = signature;
            this.compactTree = compactTree;
            this.elements = elements;
        }

        public UiElement findById(int id) {
            for (UiElement el : elements) {
                if (el.id == id) return el;
            }
            return null;
        }
    }

    public static final class ActionResult {
        public final boolean ok;
        public final boolean aborted;
        public final boolean blocked;
        public final String detail;

        public ActionResult(boolean ok, boolean aborted, boolean blocked, String detail) {
            this.ok = ok;
            this.aborted = aborted;
            this.blocked = blocked;
            this.detail = detail;
        }

        public static ActionResult success(String detail) { return new ActionResult(true, false, false, detail); }
        public static ActionResult fail(String detail) { return new ActionResult(false, false, false, detail); }
        public static ActionResult abort(String detail) { return new ActionResult(false, true, false, detail); }
        public static ActionResult block(String detail) { return new ActionResult(false, false, true, detail); }
    }

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) { /* odczyt na żądanie */ }

    @Override
    public void onInterrupt() { /* brak */ }

    @Override
    public void onDestroy() {
        instance = null;
        lastSnapshot = null;
        super.onDestroy();
    }

    /** Zbuduj skompresowane, ponumerowane drzewo aktywnego okna UI (z blokadą pól haseł). */
    public UiSnapshot captureUiTree() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;

        String pkg = root.getPackageName() != null ? root.getPackageName().toString() : "";
        List<UiElement> elements = new ArrayList<>();
        StringBuilder tree = new StringBuilder();
        StringBuilder sigSeed = new StringBuilder(pkg).append("|");

        collectNodes(root, pkg, 0, elements, tree, sigSeed);

        String signature = pkg + "#" + elements.size() + "#" + Integer.toHexString(sigSeed.toString().hashCode());
        UiSnapshot snap = new UiSnapshot(pkg, signature, tree.toString().trim(), elements);
        lastSnapshot = snap;
        return snap;
    }

    public UiSnapshot getLastSnapshot() {
        return lastSnapshot;
    }

    private void collectNodes(AccessibilityNodeInfo node, String pkg, int depth,
                              List<UiElement> out, StringBuilder tree, StringBuilder sigSeed) {
        if (node == null || depth > MAX_DEPTH || out.size() >= MAX_ELEMENTS) return;

        boolean visible = node.isVisibleToUser();
        boolean isPwd = RiskGuard.isPasswordNode(node);
        boolean clickable = node.isClickable();
        boolean editable = node.isEditable();
        boolean scrollable = node.isScrollable();

        // Twarda blokada RiskGuard: NIGDY nie odczytuj wartości pól haseł!
        String rawLabel;
        if (isPwd) {
            rawLabel = "[PASSWORD_BLOCKED]";
        } else {
            CharSequence txt = node.getText();
            CharSequence desc = node.getContentDescription();
            CharSequence hint = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? node.getHintText() : null;
            rawLabel = firstNonEmpty(txt, desc, hint);
        }

        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        boolean hasSize = bounds.width() > 0 && bounds.height() > 0;

        if (visible && hasSize && (clickable || editable || scrollable || isPwd || !rawLabel.isEmpty())) {
            int id = out.size() + 1;
            String role = simplifyRole(node.getClassName(), editable, clickable, scrollable);
            String cleanLabel = sanitizeLabel(rawLabel);
            int cx = bounds.centerX();
            int cy = bounds.centerY();

            UiElement el = new UiElement(id, role, cleanLabel, cx, cy, clickable, editable, scrollable, isPwd, pkg, bounds);
            out.add(el);

            tree.append("[").append(id).append("] ")
                .append(role)
                .append(" \"").append(cleanLabel).append("\" ")
                .append("(").append(cx).append(",").append(cy).append(")\n");

            if (out.size() <= 16) {
                sigSeed.append(role).append(":").append(cleanLabel).append(";");
            }
        }

        int childCount = node.getChildCount();
        for (int i = 0; i < childCount && out.size() < MAX_ELEMENTS; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectNodes(child, pkg, depth + 1, out, tree, sigSeed);
            }
        }
    }

    private String firstNonEmpty(CharSequence... vals) {
        for (CharSequence c : vals) {
            if (c != null) {
                String s = c.toString().trim();
                if (!s.isEmpty()) return s;
            }
        }
        return "";
    }

    private String sanitizeLabel(String s) {
        if (s == null) return "";
        String oneLine = s.replace("\r", " ").replace("\n", " ").replace("\"", "'").trim();
        return oneLine.length() > 80 ? oneLine.substring(0, 80) : oneLine;
    }

    private String simplifyRole(CharSequence cls, boolean editable, boolean clickable, boolean scrollable) {
        if (editable) return "Input";
        String c = cls == null ? "" : cls.toString();
        int dot = c.lastIndexOf('.');
        String simple = dot >= 0 ? c.substring(dot + 1) : c;
        if (simple.contains("Button") || simple.contains("ImageButton")) return "Button";
        if (simple.contains("EditText")) return "Input";
        if (simple.contains("CheckBox")) return "CheckBox";
        if (simple.contains("Switch") || simple.contains("Toggle")) return "Switch";
        if (simple.contains("TextView")) return clickable ? "Link" : "Text";
        if (simple.contains("ImageView")) return clickable ? "IconButton" : "Image";
        if (scrollable || simple.contains("RecyclerView") || simple.contains("ScrollView") || simple.contains("ListView")) {
            return "Scroll";
        }
        return simple.isEmpty() ? (clickable ? "Control" : "View") : simple;
    }

    /** Check-then-Act: ponowna weryfikacja sygnatury ekranu i elementu przed kliknięciem. */
    public ActionResult tapById(int id, String expectedSignature, String expectedLabel) {
        UiSnapshot live = captureUiTree();
        if (live == null) return ActionResult.fail("Brak aktywnego okna ekranu.");

        if (expectedSignature != null && !expectedSignature.trim().isEmpty()
            && !expectedSignature.trim().equals(live.signature)) {
            return ActionResult.abort("Ekran zmienił się przed kliknięciem (Check-then-Act) — pobierz nowe drzewo UI.");
        }

        UiElement el = live.findById(id);
        if (el == null) {
            return ActionResult.abort("Element [" + id + "] nie istnieje już na ekranie (Check-then-Act).");
        }
        if (el.password) {
            return ActionResult.block("Zablokowano przez RiskGuard: całkowity zakaz interakcji z polem hasła.");
        }
        if (expectedLabel != null && !expectedLabel.trim().isEmpty()
            && !el.label.equalsIgnoreCase(expectedLabel.trim())) {
            return ActionResult.abort("Etykieta elementu [" + id + "] zmieniła się („" + el.label + "”) — przerwano.");
        }

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root != null) {
            AccessibilityNodeInfo target = findNodeAtPoint(root, el.x, el.y, true);
            if (target != null && !RiskGuard.isPasswordNode(target)) {
                if (target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                    return ActionResult.success("Kliknięto [" + id + "] " + el.role + " \"" + el.label + "\" (" + el.x + "," + el.y + ").");
                }
            }
        }
        boolean tapped = tap(el.x, el.y);
        return tapped
            ? ActionResult.success("Dotknięto [" + id + "] " + el.role + " \"" + el.label + "\" (" + el.x + "," + el.y + ").")
            : ActionResult.fail("Nie udało się kliknąć elementu [" + id + "].");
    }

    /** Wpisz tekst (wstecznie zgodne przeciążenie) z twardą blokadą pól haseł. */
    public boolean typeText(String text) {
        return typeTextVerified(text, null, null).ok;
    }

    /** Check-then-Act: wpisz tekst w aktywne lub wskazane [id] pole, z twardą blokadą pól haseł. */
    public ActionResult typeTextVerified(String text, Integer targetId, String expectedSignature) {
        UiSnapshot live = captureUiTree();
        if (live == null) return ActionResult.fail("Brak aktywnego okna ekranu.");

        if (expectedSignature != null && !expectedSignature.trim().isEmpty()
            && !expectedSignature.trim().equals(live.signature)) {
            return ActionResult.abort("Ekran zmienił się przed wpisaniem tekstu (Check-then-Act).");
        }

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return ActionResult.fail("Brak aktywnego okna ekranu.");

        AccessibilityNodeInfo node = null;
        if (targetId != null && targetId > 0) {
            UiElement el = live.findById(targetId);
            if (el == null) return ActionResult.abort("Pole [" + targetId + "] zniknęło z ekranu.");
            if (el.password) return ActionResult.block("Zablokowano przez RiskGuard: całkowity zakaz wypełniania pól haseł.");
            node = findNodeAtPoint(root, el.x, el.y, false);
            if (node != null && !node.isEditable()) {
                node = findEditableNear(node);
            }
        }
        if (node == null) node = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (node == null) node = findEditable(root);
        if (node == null) return ActionResult.fail("Nie znaleziono edytowalnego pola na ekranie.");

        // TWARDY ZAKAZ RiskGuard: nigdy nie wpisuj do pola hasła.
        if (RiskGuard.isPasswordNode(node)) {
            return ActionResult.block("Zablokowano przez RiskGuard: całkowity zakaz wypełniania pól haseł.");
        }

        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text == null ? "" : text);
        boolean ok = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        return ok ? ActionResult.success("Wpisano tekst.") : ActionResult.fail("Nie udało się wpisać tekstu.");
    }

    /** Check-then-Act: przewijanie ekranu (down | up | left | right). */
    public ActionResult scroll(String direction, Integer targetId, String expectedSignature) {
        UiSnapshot live = captureUiTree();
        if (live == null) return ActionResult.fail("Brak aktywnego okna ekranu.");

        if (expectedSignature != null && !expectedSignature.trim().isEmpty()
            && !expectedSignature.trim().equals(live.signature)) {
            return ActionResult.abort("Ekran zmienił się przed przewinięciem (Check-then-Act).");
        }

        String dir = direction == null ? "down" : direction.trim().toLowerCase();
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root != null && ("down".equals(dir) || "up".equals(dir))) {
            AccessibilityNodeInfo scrollable = null;
            if (targetId != null && targetId > 0) {
                UiElement el = live.findById(targetId);
                if (el != null) scrollable = findNodeAtPoint(root, el.x, el.y, false);
            }
            if (scrollable == null || !scrollable.isScrollable()) {
                scrollable = findScrollable(root);
            }
            if (scrollable != null) {
                int act = "down".equals(dir)
                    ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                    : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;
                if (scrollable.performAction(act)) {
                    return ActionResult.success("Przewinięto: " + dir + ".");
                }
            }
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return ActionResult.fail("Gest przewijania wymaga Android 7+.");
        }
        DisplayMetrics dm = getResources().getDisplayMetrics();
        float cx = dm.widthPixels * 0.5f;
        float cy = dm.heightPixels * 0.5f;
        float x1 = cx, y1 = cy, x2 = cx, y2 = cy;
        switch (dir) {
            case "up":
                y1 = dm.heightPixels * 0.30f; y2 = dm.heightPixels * 0.75f; break;
            case "left":
                x1 = dm.widthPixels * 0.80f; x2 = dm.widthPixels * 0.20f; break;
            case "right":
                x1 = dm.widthPixels * 0.20f; x2 = dm.widthPixels * 0.80f; break;
            case "down":
            default:
                y1 = dm.heightPixels * 0.75f; y2 = dm.heightPixels * 0.30f; break;
        }
        boolean ok = swipe(x1, y1, x2, y2, 260);
        return ok ? ActionResult.success("Przewinięto gestem: " + dir + ".") : ActionResult.fail("Nie udało się przewinąć.");
    }

    public boolean back() {
        return performGlobalAction(GLOBAL_ACTION_BACK);
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

    private AccessibilityNodeInfo findEditableNear(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo cur = node;
        for (int i = 0; i < 3 && cur != null; i++) {
            if (cur.isEditable()) return cur;
            cur = cur.getParent();
        }
        return findEditable(node);
    }

    private AccessibilityNodeInfo findScrollable(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isScrollable()) return node;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo r = findScrollable(node.getChild(i));
            if (r != null) return r;
        }
        return null;
    }

    private AccessibilityNodeInfo findNodeAtPoint(AccessibilityNodeInfo node, int x, int y, boolean preferClickable) {
        if (node == null) return null;
        Rect r = new Rect();
        node.getBoundsInScreen(r);
        if (!r.contains(x, y)) return null;
        for (int i = node.getChildCount() - 1; i >= 0; i--) {
            AccessibilityNodeInfo child = findNodeAtPoint(node.getChild(i), x, y, preferClickable);
            if (child != null) return child;
        }
        if (!preferClickable || node.isClickable()) return node;
        AccessibilityNodeInfo p = node.getParent();
        while (p != null) {
            if (p.isClickable()) return p;
            p = p.getParent();
        }
        return node;
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

    private boolean swipe(float x1, float y1, float x2, float y2, long durationMs) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        try {
            Path p = new Path();
            p.moveTo(x1, y1);
            p.lineTo(x2, y2);
            GestureDescription.Builder b = new GestureDescription.Builder();
            b.addStroke(new GestureDescription.StrokeDescription(p, 0, durationMs));
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
