package net.serwer256.jarvis;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Most JS → Android "Phone Use" Agent:
 * - eksport skompresowanego drzewa ekranu UI ([id] Role "Label" (x,y)),
 * - akcje tapById, typeText, scroll, back, openApp w pętli Check-then-Act,
 * - twardy RiskGuard: natywne okno potwierdzenia AlertDialog dla money/security/delete/send
 *   oraz całkowity zakaz odczytu/wpisywania pól haseł.
 */
@CapacitorPlugin(name = "SystemActions")
public class SystemActionsPlugin extends Plugin {

    private void okResult(PluginCall call, boolean ok) {
        JSObject r = new JSObject();
        r.put("ok", ok);
        call.resolve(r);
    }

    private void resolveActionResult(PluginCall call, JarvisAccessibilityService.ActionResult res) {
        JSObject r = new JSObject();
        r.put("ok", res.ok);
        r.put("aborted", res.aborted);
        r.put("blocked", res.blocked);
        r.put("detail", res.detail);
        call.resolve(r);
    }

    /**
     * Wymusza natywne okno potwierdzenia AlertDialog dla akcji sklasyfikowanej przez RiskGuard.
     * Fail-closed: brak aktywności → odmawia wykonania zamiast przepuszczać po cichu.
     */
    private void confirmWithRiskGuard(PluginCall call, String riskCategory, String summary, Runnable onApproved) {
        Activity act = getActivity();
        if (act == null || act.isFinishing()) {
            JSObject r = new JSObject();
            r.put("ok", false);
            r.put("blocked", true);
            r.put("riskCategory", riskCategory);
            r.put("detail", "RiskGuard (" + riskCategory + "): brak okna aplikacji do potwierdzenia — przerwano (fail-closed).");
            call.resolve(r);
            return;
        }
        act.runOnUiThread(() -> {
            try {
                new AlertDialog.Builder(act)
                    .setTitle("🛡 RiskGuard — " + RiskGuard.describeCategory(riskCategory))
                    .setMessage(summary + "\n\nCzy na pewno zezwalasz JARVIS-owi na wykonanie tej akcji?")
                    .setCancelable(false)
                    .setPositiveButton("Zezwól", (d, w) -> onApproved.run())
                    .setNegativeButton("Anuluj", (d, w) -> {
                        JSObject r = new JSObject();
                        r.put("ok", false);
                        r.put("blocked", true);
                        r.put("riskCategory", riskCategory);
                        r.put("detail", "Użytkownik odrzucił akcję RiskGuard (" + riskCategory + ").");
                        call.resolve(r);
                    })
                    .show();
            } catch (Exception e) {
                JSObject r = new JSObject();
                r.put("ok", false);
                r.put("blocked", true);
                r.put("riskCategory", riskCategory);
                r.put("detail", "RiskGuard: błąd okna potwierdzenia — przerwano.");
                call.resolve(r);
            }
        });
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", JarvisAccessibilityService.isEnabled());
        call.resolve(ret);
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception ignored) { }
        call.resolve();
    }

    @PluginMethod
    public void getUiTree(PluginCall call) {
        JarvisAccessibilityService s = JarvisAccessibilityService.get();
        JSObject r = new JSObject();
        if (s == null) {
            r.put("ok", false);
            r.put("detail", "Usługa Dostępności JARVIS jest wyłączona.");
            call.resolve(r);
            return;
        }
        JarvisAccessibilityService.UiSnapshot snap = s.captureUiTree();
        if (snap == null) {
            r.put("ok", false);
            r.put("detail", "Brak aktywnego okna do odczytu.");
            call.resolve(r);
            return;
        }
        r.put("ok", true);
        r.put("packageName", snap.packageName);
        r.put("signature", snap.signature);
        r.put("count", snap.elements.size());
        r.put("tree", snap.compactTree);
        call.resolve(r);
    }

    @PluginMethod
    public void tapById(PluginCall call) {
        JarvisAccessibilityService s = JarvisAccessibilityService.get();
        if (s == null) {
            resolveActionResult(call, JarvisAccessibilityService.ActionResult.fail("Usługa Dostępności wyłączona."));
            return;
        }
        Integer id = call.getInt("id");
        if (id == null || id <= 0) {
            resolveActionResult(call, JarvisAccessibilityService.ActionResult.fail("Brak poprawnego id elementu."));
            return;
        }
        String expectedSignature = call.getString("expectedSignature", "");
        String expectedLabel = call.getString("expectedLabel", "");

        // Wstępny odczyt do klasyfikacji RiskGuard PRZED wykonaniem akcji.
        JarvisAccessibilityService.UiSnapshot snap = s.captureUiTree();
        if (snap == null) {
            resolveActionResult(call, JarvisAccessibilityService.ActionResult.fail("Brak aktywnego ekranu."));
            return;
        }
        JarvisAccessibilityService.UiElement el = snap.findById(id);
        if (el == null) {
            resolveActionResult(call, JarvisAccessibilityService.ActionResult.abort("Element [" + id + "] nie istnieje na ekranie."));
            return;
        }
        if (el.password) {
            resolveActionResult(call, JarvisAccessibilityService.ActionResult.block("Zablokowano przez RiskGuard: pole hasła."));
            return;
        }
        String riskCat = RiskGuard.classify(el.label, el.packageName, expectedLabel);
        if (riskCat != null) {
            confirmWithRiskGuard(
                call,
                riskCat,
                "Kliknięcie elementu [" + id + "] " + el.role + " \"" + el.label + "\" w aplikacji " + el.packageName,
                () -> resolveActionResult(call, s.tapById(id, expectedSignature, expectedLabel))
            );
            return;
        }
        resolveActionResult(call, s.tapById(id, expectedSignature, expectedLabel));
    }

    @PluginMethod
    public void type(PluginCall call) {
        JarvisAccessibilityService s = JarvisAccessibilityService.get();
        if (s == null) {
            resolveActionResult(call, JarvisAccessibilityService.ActionResult.fail("Usługa Dostępności wyłączona."));
            return;
        }
        String text = call.getString("text", "");
        Integer id = call.getInt("id");
        String expectedSignature = call.getString("expectedSignature", "");

        JarvisAccessibilityService.UiSnapshot snap = s.captureUiTree();
        String pkg = snap != null ? snap.packageName : "";
        String lbl = (snap != null && id != null && snap.findById(id) != null) ? snap.findById(id).label : "";
        String riskCat = RiskGuard.classify(lbl, pkg, "");
        if (RiskGuard.CAT_MONEY.equals(riskCat) || RiskGuard.CAT_SECURITY.equals(riskCat)) {
            confirmWithRiskGuard(
                call,
                riskCat,
                "Wpisanie tekstu w aplikacji " + pkg + (lbl.isEmpty() ? "" : " (pole: \"" + lbl + "\")"),
                () -> resolveActionResult(call, s.typeTextVerified(text, id, expectedSignature))
            );
            return;
        }
        resolveActionResult(call, s.typeTextVerified(text, id, expectedSignature));
    }

    @PluginMethod
    public void scroll(PluginCall call) {
        JarvisAccessibilityService s = JarvisAccessibilityService.get();
        if (s == null) {
            resolveActionResult(call, JarvisAccessibilityService.ActionResult.fail("Usługa Dostępności wyłączona."));
            return;
        }
        String direction = call.getString("direction", "down");
        Integer id = call.getInt("id");
        String expectedSignature = call.getString("expectedSignature", "");
        resolveActionResult(call, s.scroll(direction, id, expectedSignature));
    }

    @PluginMethod
    public void back(PluginCall call) {
        JarvisAccessibilityService s = JarvisAccessibilityService.get();
        okResult(call, s != null && s.back());
    }

    @PluginMethod
    public void tap(PluginCall call) {
        JarvisAccessibilityService s = JarvisAccessibilityService.get();
        Double x = call.getDouble("x");
        Double y = call.getDouble("y");
        okResult(call, s != null && x != null && y != null && s.tap(x.floatValue(), y.floatValue()));
    }

    @PluginMethod
    public void global(PluginCall call) {
        JarvisAccessibilityService s = JarvisAccessibilityService.get();
        String action = call.getString("action", "back");
        okResult(call, s != null && s.global(action));
    }

    @PluginMethod
    public void openApp(PluginCall call) {
        String name = call.getString("name", "");
        String riskCat = RiskGuard.classify(name, "", "");
        if (RiskGuard.CAT_MONEY.equals(riskCat) || RiskGuard.CAT_SECURITY.equals(riskCat)) {
            confirmWithRiskGuard(
                call,
                riskCat,
                "Otwarcie aplikacji wysokiego ryzyka: \"" + name + "\"",
                () -> doOpenApp(call, name)
            );
            return;
        }
        doOpenApp(call, name);
    }

    private void doOpenApp(PluginCall call, String name) {
        JSObject r = new JSObject();
        try {
            PackageManager pm = getContext().getPackageManager();
            String pkg = resolvePackage(pm, name == null ? "" : name);
            if (pkg == null) { r.put("ok", false); r.put("detail", "Nie znalazłem aplikacji: " + name); call.resolve(r); return; }
            Intent launch = pm.getLaunchIntentForPackage(pkg);
            if (launch == null) { r.put("ok", false); r.put("detail", "Nie można otworzyć: " + name); call.resolve(r); return; }
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(launch);
            r.put("ok", true);
        } catch (Exception e) {
            r.put("ok", false);
            r.put("detail", e.getMessage());
        }
        call.resolve(r);
    }

    private String resolvePackage(PackageManager pm, String name) {
        String q = name.toLowerCase().trim();
        if (q.isEmpty()) return null;
        String fallback = null;
        for (ApplicationInfo ai : pm.getInstalledApplications(0)) {
            CharSequence label = pm.getApplicationLabel(ai);
            String lbl = label == null ? "" : label.toString().toLowerCase();
            if (lbl.equals(q)) return ai.packageName;
            if (fallback == null && (lbl.contains(q) || ai.packageName.toLowerCase().contains(q))) fallback = ai.packageName;
        }
        return fallback;
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String section = call.getString("section", "");
        String action = Settings.ACTION_SETTINGS;
        if (section != null) {
            switch (section.toLowerCase()) {
                case "wifi": action = Settings.ACTION_WIFI_SETTINGS; break;
                case "bluetooth": action = Settings.ACTION_BLUETOOTH_SETTINGS; break;
                case "sound": action = Settings.ACTION_SOUND_SETTINGS; break;
                case "display": action = Settings.ACTION_DISPLAY_SETTINGS; break;
                case "location": action = Settings.ACTION_LOCATION_SOURCE_SETTINGS; break;
                case "battery": action = Settings.ACTION_BATTERY_SAVER_SETTINGS; break;
                case "apps": action = Settings.ACTION_APPLICATION_SETTINGS; break;
                default: action = Settings.ACTION_SETTINGS; break;
            }
        }
        boolean ok = true;
        try {
            Intent i = new Intent(action);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) { ok = false; }
        okResult(call, ok);
    }

    @PluginMethod
    public void launch(PluginCall call) {
        String uri = call.getString("uri", "");
        boolean ok = true;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) { ok = false; }
        okResult(call, ok);
    }
}
