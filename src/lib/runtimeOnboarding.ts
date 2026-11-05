import { hasUsableBrain } from "./brain";
import { desktop } from "./desktop";
import { store } from "./store";
import {
  displayedRuntimeState, normalizeRuntimeUrl, runtimeRequest, waitForRuntimeConnection,
  type RuntimeConnection, type RuntimeProfile, type RuntimeStatus,
} from "./localRuntimeClient";

interface RuntimeBridge {
  runtimeStart?(): Promise<{ ok: boolean; error?: string }>;
  runtimeConnection?(): Promise<RuntimeConnection | null>;
}
export interface RuntimeOnboardingResult {
  state: "preserved" | "configured" | "setup" | "unavailable" | "unsupported" | "cancelled";
  message?: string;
  model?: string;
  readiness?: string;
}

function configurationFingerprint(): string {
  const s = store.settings;
  return JSON.stringify({
    provider: s.provider, model: s.model, keys: s.keys, proxyUrl: s.proxyUrl,
    ollamaUrl: s.ollamaUrl, simple: s.ollamaModelSimple, complex: s.ollamaModelComplex,
    vision: s.ollamaModelVision, uncensored: s.ollamaModelUncensored,
    onDeviceOnly: s.onDeviceOnly, webllmEnabled: s.webllmEnabled, webllmModel: s.webllmModel,
  });
}

function localEndpoint(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const normalized = normalizeRuntimeUrl(raw);
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(normalized).hostname) ? normalized : null;
  } catch { return null; }
}

/** Bound even preload IPC promises, which do not support AbortSignal themselves. */
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Przerwano konfigurację lokalną.", "AbortError"));
    if (signal.aborted) { operation.catch(() => {}); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Configure an empty desktop chat from the active service profile; configuration is not readiness. */
export async function bootstrapDesktopRuntime(options: {
  bridge?: RuntimeBridge | null; signal?: AbortSignal; timeoutMs?: number; intervalMs?: number;
  shouldApply?: () => boolean;
} = {}): Promise<RuntimeOnboardingResult> {
  if (hasUsableBrain()) return { state: "preserved" };
  const bridge = options.bridge === undefined ? desktop() : options.bridge;
  if (!bridge?.runtimeConnection) return { state: "unsupported", message: "Otwórz serwer lokalny, aby połączyć model z czatem." };
  if (options.signal?.aborted) return { state: "cancelled" };
  const original = configurationFingerprint();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 10_000, 10_000));
  const deadline = Date.now() + timeoutMs;
  const timer = setTimeout(cancel, timeoutMs);
  let reachedService = false;
  let message = "Serwer lokalny jeszcze się uruchamia. Sprawdź jego stan w panelu.";
  try {
    if (bridge.runtimeStart) {
      const started = await abortable(bridge.runtimeStart(), controller.signal);
      if (!started.ok) return { state: "unavailable", message: "Nie udało się uruchomić serwera lokalnego. Otwórz panel, aby sprawdzić stan." };
    }
    const connection = await abortable(waitForRuntimeConnection(
      () => abortable(bridge.runtimeConnection!(), controller.signal),
      { signal: controller.signal, timeoutMs: Math.max(1, deadline - Date.now()), intervalMs: options.intervalMs },
    ), controller.signal);
    if (!connection) return { state: "unavailable", message };
    reachedService = true;
    while (!controller.signal.aborted && Date.now() < deadline) {
      try {
        const requestOptions = { signal: controller.signal, timeoutMs: Math.max(1, Math.min(1000, deadline - Date.now())) };
        const [profile, status] = await abortable(Promise.all([
          runtimeRequest<RuntimeProfile>(connection, "/v1/profile", requestOptions),
          runtimeRequest<RuntimeStatus>(connection, "/v1/status", requestOptions),
        ]), controller.signal);
        const endpoint = localEndpoint(profile.active?.ollamaUrl);
        const model = typeof profile.active?.model === "string" ? profile.active.model.trim() : "";
        if (model && endpoint && !/[\r\n\0]/.test(model)) {
          if (controller.signal.aborted) break;
          if (hasUsableBrain() || configurationFingerprint() !== original || options.shouldApply?.() === false) {
            return { state: "preserved" };
          }
          const s = store.settings;
          // Never replace a manually chosen local model, even when its URL is still empty.
          if ([s.ollamaModelSimple, s.ollamaModelComplex].some((choice) => choice?.trim() && choice.trim() !== model) ||
              (s.provider === "ollama" && s.model && s.model !== "auto" && s.model !== model)) {
            return { state: "preserved" };
          }
          store.setSettings({ ollamaUrl: endpoint, ollamaModelSimple: model, ollamaModelComplex: model });
          const readiness = status.profileVersion === profile.active.version ? displayedRuntimeState(status.readiness, true) : "SETUP";
          return {
            state: "configured", model, readiness,
            message: readiness === "READY"
              ? `Połączono czat z lokalnym modelem ${model}. Test serwera zakończył się poprawnie.`
              : `Połączono czat z lokalnym modelem ${model}. Gotowość odpowiedzi nie jest jeszcze potwierdzona.`,
          };
        }
        message = model && !endpoint
          ? "Profil serwera nie wskazuje poprawnego lokalnego adresu Ollamy. Sprawdź konfigurację w panelu."
          : "Serwer działa, ale nie wybrał jeszcze lokalnego modelu. Sprawdź dostępne modele w panelu.";
      } catch {
        if (controller.signal.aborted) break;
      }
      await abortable(new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(delay); controller.signal.removeEventListener("abort", finish); resolve(); };
        const delay = setTimeout(finish, Math.max(1, Math.min(options.intervalMs ?? 500, deadline - Date.now())));
        controller.signal.addEventListener("abort", finish, { once: true });
      }), controller.signal);
    }
  } catch { /* Timeout/start failure becomes an actionable panel, never a false READY. */ }
  finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
  if (options.signal?.aborted) return { state: "cancelled" };
  if (hasUsableBrain() || configurationFingerprint() !== original || options.shouldApply?.() === false) return { state: "preserved" };
  return { state: reachedService ? "setup" : "unavailable", message };
}
