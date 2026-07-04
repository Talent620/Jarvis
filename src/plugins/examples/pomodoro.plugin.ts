import { createElement as h, type ReactNode } from "react";
import type { JarvisPlugin, PluginAPI } from "../PluginRegistry";
import { notify } from "../../lib/notifications";

// === Przykładowa wtyczka: Pomodoro ===
// Dokumentacja przez przykład — pokazuje pełne API: narzędzie agentowe,
// sekcję ustawień, toast i trwałą pamięć wtyczki. Powiedz JARVIS-owi
// „włącz pomodoro" albo „pomodoro na 15 minut" — model wywoła narzędzie.

let timer: ReturnType<typeof setTimeout> | null = null;
let endsAt = 0;

const pomodoroPlugin: JarvisPlugin = {
  id: "pomodoro",
  name: "Pomodoro — timer skupienia",
  version: "1.0.0",

  register(api: PluginAPI): void {
    api.registerTool(
      "start",
      "Włącz timer Pomodoro (sesja skupienia). Domyślnie 25 minut; użytkownik może podać inną długość.",
      { type: "object", properties: { minutes: { type: "number", description: "Długość sesji w minutach (1–120)" } }, required: [] },
      ({ minutes }) => {
        const def = Number(api.getMemory("default_minutes")) || 25;
        const mins = Math.min(120, Math.max(1, Number(minutes) || def));
        if (timer) clearTimeout(timer);
        endsAt = Date.now() + mins * 60_000;
        timer = setTimeout(() => {
          timer = null;
          api.sendToast("🍅 Pomodoro zakończone — czas na przerwę!");
          notify("JARVIS — Pomodoro", `Sesja ${mins} min zakończona. Zrób przerwę.`);
        }, mins * 60_000);
        return `🍅 Pomodoro włączone: ${mins} minut skupienia. Powiadomię, gdy czas minie.`;
      },
    );

    api.registerTool(
      "status",
      "Sprawdź, ile czasu zostało w bieżącej sesji Pomodoro.",
      { type: "object", properties: {}, required: [] },
      () => {
        if (!timer) return "Żadna sesja Pomodoro nie jest aktywna.";
        const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 60_000));
        return `🍅 Zostało około ${left} min skupienia.`;
      },
    );

    api.addSettingsSection("🍅 Pomodoro", (): ReactNode => {
      const current = Number(api.getMemory("default_minutes")) || 25;
      return h("div", { className: "field" }, [
        h("label", { key: "l" }, "Domyślna długość sesji (minuty)"),
        h("input", {
          key: "i",
          type: "number",
          defaultValue: current,
          min: 1,
          max: 120,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            const v = Math.min(120, Math.max(1, Number(e.target.value) || 25));
            api.setMemory("default_minutes", String(v));
          },
        }),
      ]);
    });
  },
};

export default pomodoroPlugin;
