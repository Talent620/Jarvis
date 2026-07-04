// Lekki toast (pojedynczy, bez biblioteki): krótki, nienachalny komunikat
// potwierdzający akcję (np. „Skopiowano ✓"). Sam znika; kolejny zastępuje
// poprzedni. Opcjonalny przycisk akcji (np. „Cofnij").
let el: HTMLDivElement | null = null;
let hideTimer = 0;

export interface ToastAction {
  label: string;
  onClick: () => void;
}

// Jeden styl potwierdzeń: sam toast JEST potwierdzeniem, więc usuwamy znaczniki „✓/✅/✔"
// (z początku i końca) — koniec chaosu „raz ✓ na końcu, raz ✅ na początku, raz wcale".
// Emoji semantyczne (📌 🔄 🎧 🗑 …) zostają — niosą znaczenie, nie tylko „sukces".
export function normalizeToastText(message: string): string {
  return (message || "")
    .trim()
    .replace(/^[✓✔✅]+\s*/, "")
    .replace(/\s*[✓✔✅]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function toast(message: string, action?: ToastAction): void {
  if (typeof document === "undefined") return;
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = normalizeToastText(message);
  if (action) {
    const btn = document.createElement("button");
    btn.className = "toast-action";
    btn.textContent = action.label;
    btn.onclick = () => {
      action.onClick();
      el?.classList.remove("show");
    };
    el.appendChild(btn);
  }
  el.classList.add("show");
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => el?.classList.remove("show"), action ? 6000 : 1600);
}

// Pomocnicy o jednolitym stylu (do stopniowej migracji wywołań):
/** Potwierdzenie sukcesu — bez znacznika (sam toast jest potwierdzeniem). */
export function toastOk(message: string, action?: ToastAction): void {
  toast(message, action);
}
/** Błąd/ostrzeżenie — jednolity marker „⚠" na początku (jeśli go brak). */
export function toastErr(message: string): void {
  const m = normalizeToastText(message);
  toast(/^⚠/.test(m) ? m : `⚠ ${m}`);
}
/** Informacja neutralna. */
export function toastInfo(message: string, action?: ToastAction): void {
  toast(message, action);
}

/** Skopiuj tekst — Clipboard API z fallbackiem na execCommand (starszy WebView/non-HTTPS). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* spadnij do fallbacku poniżej */
  }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Kopiuje tekst do schowka i potwierdza toastem (albo mówi wprost, że się nie udało). */
export async function copyWithToast(text: string, label = "Skopiowano ✓"): Promise<void> {
  toast((await copyText(text)) ? label : "Nie mogę skopiować — zaznacz tekst ręcznie.");
}

/**
 * Udostępnij tekst natywnie (Web Share); gdy brak wsparcia — skopiuj do schowka.
 * Anulowanie udostępniania przez użytkownika nie robi nic (bez mylącego komunikatu).
 */
export async function shareOrCopy(text: string, copyLabel = "Skopiowano — wklej w aplikacji ✓"): Promise<void> {
  const nav = typeof navigator !== "undefined" ? (navigator as { share?: (d: { text: string }) => Promise<void> }) : undefined;
  if (nav?.share) {
    try {
      await nav.share({ text });
      return;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return; // użytkownik anulował — nic nie rób
      /* inny błąd udostępniania → kopiujemy jako fallback */
    }
  }
  await copyWithToast(text, copyLabel);
}
