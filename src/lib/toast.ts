// Lekki toast (pojedynczy, bez biblioteki): krótki, nienachalny komunikat
// potwierdzający akcję (np. „Skopiowano ✓"). Sam znika; kolejny zastępuje poprzedni.
let el: HTMLDivElement | null = null;
let hideTimer = 0;

export function toast(message: string): void {
  if (typeof document === "undefined") return;
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => el?.classList.remove("show"), 1600);
}

/** Kopiuje tekst do schowka i potwierdza toastem (albo mówi wprost, że się nie udało). */
export async function copyWithToast(text: string, label = "Skopiowano ✓"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast("Nie mogę skopiować — zaznacz tekst ręcznie.");
  }
}
