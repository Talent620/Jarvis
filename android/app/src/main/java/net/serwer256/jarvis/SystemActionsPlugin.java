package net.serwer256.jarvis;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
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

/** Most JS → pełne sterowanie telefonem: pisanie/dotyk (przez usługę Dostępności),
 *  akcje globalne, otwieranie aplikacji i ekranów Ustawień. */
@CapacitorPlugin(name = "SystemActions")
public class SystemActionsPlugin extends Plugin {

    private void okResult(PluginCall call, boolean ok) {
        JSObject r = new JSObject();
        r.put("ok", ok);
        call.resolve(r);
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
    public void type(PluginCall call) {
        JarvisAccessibilityService s = JarvisAccessibilityService.get();
        String text = call.getString("text", "");
        okResult(call, s != null && s.typeText(text));
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

    // ------------------------------------------------------------------ semantic primitives (M9)

    private JarvisAccessibilityService serviceOrReject(PluginCall call) {
        JarvisAccessibilityService s = JarvisAccessibilityService.get();
        if (s == null) call.reject("accessibility service is off (Settings > Accessibility > JARVIS)", "NEEDS_PERMISSION");
        return s;
    }

    @PluginMethod
    public void focused(PluginCall call) {
        JarvisAccessibilityService s = serviceOrReject(call);
        if (s != null) call.resolve(s.describeFocused());
    }

    @PluginMethod
    public void activeWindow(PluginCall call) {
        JarvisAccessibilityService s = serviceOrReject(call);
        if (s != null) call.resolve(s.activeWindow());
    }

    @PluginMethod
    public void windows(PluginCall call) {
        JarvisAccessibilityService s = serviceOrReject(call);
        if (s == null) return;
        JSObject r = new JSObject();
        r.put("windows", s.windowList());
        call.resolve(r);
    }

    @PluginMethod
    public void select(PluginCall call) {
        JarvisAccessibilityService s = serviceOrReject(call);
        if (s == null) return;
        Integer start = call.getInt("start");
        Integer end = call.getInt("end");
        okResult(call, start != null && end != null && s.selectText(start, end));
    }

    @PluginMethod
    public void copy(PluginCall call) {
        JarvisAccessibilityService s = serviceOrReject(call);
        if (s != null) okResult(call, s.copySelection());
    }

    @PluginMethod
    public void appendText(PluginCall call) {
        JarvisAccessibilityService s = serviceOrReject(call);
        if (s != null) okResult(call, s.appendText(call.getString("text", "")));
    }

    @PluginMethod
    public void scroll(PluginCall call) {
        JarvisAccessibilityService s = serviceOrReject(call);
        if (s != null) okResult(call, s.scroll(call.getBoolean("forward", true)));
    }

    @PluginMethod
    public void tree(PluginCall call) {
        JarvisAccessibilityService s = serviceOrReject(call);
        if (s == null) return;
        JSObject r = new JSObject();
        r.put("nodes", s.tree(Math.max(1, Math.min(500, call.getInt("max", 150)))));
        call.resolve(r);
    }

    /** Android 10+ lets only the foreground app read the clipboard: a refusal is reported. */
    @PluginMethod
    public void getClipboard(PluginCall call) {
        JSObject r = new JSObject();
        try {
            ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = cm == null ? null : cm.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) {
                r.put("ok", false);
                r.put("error", "clipboard not readable now (Android allows it only for the app in the foreground)");
            } else {
                CharSequence t = clip.getItemAt(0).coerceToText(getContext());
                r.put("ok", true);
                r.put("text", t == null ? "" : t.toString());
            }
        } catch (Exception e) {
            r.put("ok", false);
            r.put("error", e.getMessage());
        }
        call.resolve(r);
    }

    @PluginMethod
    public void setClipboard(PluginCall call) {
        boolean ok = false;
        try {
            ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(ClipData.newPlainText("JARVIS", call.getString("text", "")));
                ok = true;
            }
        } catch (Exception ignored) { }
        okResult(call, ok);
    }

    @PluginMethod
    public void openApp(PluginCall call) {
        String name = call.getString("name", "");
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
