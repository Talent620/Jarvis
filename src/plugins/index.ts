import { loadPlugins } from "./PluginRegistry";
import pomodoroPlugin from "./examples/pomodoro.plugin";

// Manifest wtyczek: instalacja = dopisz import + pozycję na liście.
// Szczegóły i pełne API: PLUGIN_API.md w katalogu głównym projektu.
export function initPlugins(): void {
  loadPlugins([pomodoroPlugin]);
}
