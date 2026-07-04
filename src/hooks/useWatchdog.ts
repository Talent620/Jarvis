import { useEffect, useRef } from "react";
import { store } from "../lib/store";
import { toast } from "../lib/toast";
import { speak } from "../lib/voice";
import { healthIssues, topIssue, newIssues, alertText, applyAutoFixes } from "../lib/watchdog";

// 🩺 Watchdog Szefa — wydzielony z App.tsx. Po starcie (4,5 s) i co ~6 min:
//  1) SELF-HEAL: sam naprawia bezpieczne usterki ustawień i mówi o tym,
//  2) ALERT: powiadamia TYLKO o nowych problemach (nie dubluje tych samych).
// Zachowanie 1:1 z poprzednią wersją inline; `onOpenGuardian` otwiera ekran diagnozy.
export function useWatchdog(onOpenGuardian: () => void): void {
  const alertedRef = useRef<Set<string>>(new Set()); // nie alarmuj dwa razy o tym samym
  useEffect(() => {
    const alerted = alertedRef.current;
    const visibleVoice = () =>
      store.settings.speak && (typeof document === "undefined" || document.visibilityState !== "hidden");
    const check = () => {
      // 1) 🛠 SELF-HEAL: sam napraw bezpieczne usterki ustawień i powiedz o tym.
      const fixed = applyAutoFixes();
      if (fixed.length) {
        const m = `Naprawiłem: ${fixed[0]}${fixed.length > 1 ? ` i ${fixed.length - 1} więcej` : ""}.`;
        toast("🛠 " + m);
        if (visibleVoice()) void speak("Sam naprawiłem: " + fixed[0] + ".", store.settings).catch(() => {});
      }
      // 2) 🔔 ALERT o nowych problemach, których nie da się naprawić automatycznie.
      const fresh = newIssues(alerted, healthIssues());
      if (!fresh.length) return;
      fresh.forEach((i) => alerted.add(i.id));
      const top = topIssue(fresh);
      if (!top) return;
      if (top.severity === "warn" && store.settings.tips === false) return; // szanuj wyciszenie (błędy zawsze)
      toast(alertText(top), { label: "Sprawdź", onClick: () => onOpenGuardian() });
      // Głosowy alert Szefa — błędy mówi na głos i kieruje do naprawy.
      if (top.severity === "err" && visibleVoice())
        void speak(`Uwaga: ${top.title}. Wejdź w diagnozę, żeby to naprawić.`, store.settings).catch(() => {});
    };
    const first = setTimeout(check, 4500);
    const iv = setInterval(check, 6 * 60_000);
    return () => { clearTimeout(first); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
