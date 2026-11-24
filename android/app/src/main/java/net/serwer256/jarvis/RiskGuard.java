package net.serwer256.jarvis;

import android.view.accessibility.AccessibilityNodeInfo;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Twarda zapora bezpieczeństwa (RiskGuard) dla Android "Phone Use" Agenta.
 * - Całkowity zakaz odczytu i wypełniania pól haseł (isPassword).
 * - Klasyfikacja akcji wysokiego ryzyka (money / security / delete / send)
 *   wymuszająca natywne okno potwierdzenia użytkownika przed wykonaniem.
 */
public final class RiskGuard {

    public static final String CAT_MONEY = "money";
    public static final String CAT_SECURITY = "security";
    public static final String CAT_DELETE = "delete";
    public static final String CAT_SEND = "send";

    private static final Pattern MONEY_RE = Pattern.compile(
        "(przelew|zap[łl]a[ćc]|p[łl]atno[śs][ćc]|kup\\b|kupuj|blik|karta|got[óo]wk|zam[óo]w|kasa|checkout|pay\\b|payment|transfer|purchase|buy\\b|order|wallet|bank|mbank|pko|ing\\b|revolut|pekao|santander|millennium)",
        Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );

    private static final Pattern SECURITY_RE = Pattern.compile(
        "(has[łl][oa]|password|passwd|pin\\b|cvv|cvc|otp|2fa|autoryz|uprawnieni|permission|dost[ęe]pno[śs][ćc]|accessibility|odinstaluj|uninstall|factory|reset|format|biometr|odcisk|klucz|certyfikat|root|admin)",
        Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );

    private static final Pattern DELETE_RE = Pattern.compile(
        "(usu[ńn]|skasuj|wyczy[śs][ćc]|opr[óo][żz]nij|kosz|wyloguj|delete|remove|erase|wipe|trash|destroy|clear all|sign out|log out)",
        Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );

    private static final Pattern SEND_RE = Pattern.compile(
        "(wy[śs]lij|opublikuj|udost[ęe]pnij|zadzwo[ńn]|odpowiedz|przeka[żz]|send\\b|publish|share\\b|post\\b|submit|call\\b|dial\\b|reply)",
        Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );

    private RiskGuard() { }

    /** Twardy zakaz: czy węzeł jest polem hasła (nigdy nie czytamy ani nie wpisujemy). */
    public static boolean isPasswordNode(AccessibilityNodeInfo node) {
        if (node == null) return false;
        if (node.isPassword()) return true;
        int inputType = node.getInputType();
        int variation = inputType & 0x00000FF0; // InputType.TYPE_MASK_VARIATION
        // TEXT_VARIATION_PASSWORD (0x80), TEXT_VARIATION_VISIBLE_PASSWORD (0x90),
        // TEXT_VARIATION_WEB_PASSWORD (0xE0), NUMBER_VARIATION_PASSWORD (0x10 with CLASS_NUMBER)
        if (variation == 0x80 || variation == 0x90 || variation == 0xE0) return true;
        if ((inputType & 0x0F) == 0x02 && variation == 0x10) return true;
        return false;
    }

    /** Sklasyfikuj ryzyko akcji na podstawie etykiety elementu, pakietu i ewentualnego tekstu. */
    public static String classify(String label, String packageName, String extraText) {
        String combined = ((label == null ? "" : label) + " "
            + (packageName == null ? "" : packageName) + " "
            + (extraText == null ? "" : extraText)).toLowerCase(Locale.ROOT);
        if (SECURITY_RE.matcher(combined).find()) return CAT_SECURITY;
        if (MONEY_RE.matcher(combined).find()) return CAT_MONEY;
        if (DELETE_RE.matcher(combined).find()) return CAT_DELETE;
        if (SEND_RE.matcher(combined).find()) return CAT_SEND;
        return null;
    }

    public static String describeCategory(String category) {
        if (CAT_MONEY.equals(category)) return "PŁATNOŚĆ / FINANSE (money)";
        if (CAT_SECURITY.equals(category)) return "BEZPIECZEŃSTWO / UPRAWNIENIA (security)";
        if (CAT_DELETE.equals(category)) return "USUWANIE DANYCH (delete)";
        if (CAT_SEND.equals(category)) return "WYSYŁKA / PUBLIKACJA (send)";
        return "AKCJA WYSOKIEGO RYZYKA";
    }
}
