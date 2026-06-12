import { store } from "./store";

// Wysyłka e-maili WPROST z aplikacji (desktop/Windows): SMTP przez proces
// Electrona — jedno potwierdzenie i mail leci. Wymaga w ⚙ → Poczta adresu
// i HASŁA APLIKACJI (Gmail → Zarządzaj kontem → Bezpieczeństwo → Hasła aplikacji).
// Na telefonie wysyłka idzie przez aplikację pocztową (Gmail compose / mailto).

export const canSendMail = (): boolean => {
  const s = store.settings;
  return typeof window !== "undefined" && !!(window as any).jarvisDesktop?.sendMail && !!s.smtpUser?.trim() && !!s.smtpPass?.trim();
};

export const mailConfigured = (): boolean => !!store.settings.smtpUser?.trim() && !!store.settings.smtpPass?.trim();

/** Wyślij e-mail teraz (SMTP). Zwraca null = sukces albo treść błędu. */
export async function sendMailNow(to: string, subject: string, body: string): Promise<string | null> {
  const s = store.settings;
  const bridge = (window as any).jarvisDesktop;
  if (!bridge?.sendMail) return "Wysyłka wprost działa w aplikacji na Windows — na telefonie użyj przycisku Gmail.";
  if (!s.smtpUser?.trim() || !s.smtpPass?.trim()) return "Skonfiguruj pocztę w ⚙ → Poczta (adres + hasło aplikacji).";
  const r = await bridge.sendMail({
    host: s.smtpHost?.trim() || "smtp.gmail.com",
    port: Number(s.smtpPort) || 465,
    user: s.smtpUser.trim(),
    pass: s.smtpPass,
    to: to.trim(),
    subject,
    body,
  });
  return r === "ok" ? null : String(r).replace(/^err:/, "");
}
