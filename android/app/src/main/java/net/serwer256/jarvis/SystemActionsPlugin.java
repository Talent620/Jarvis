package net.serwer256.jarvis;

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
