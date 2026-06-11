// Lekki toast (pojedynczy, bez biblioteki): krótki, nienachalny komunikat
// potwierdzający akcję (np. „Skopiowano ✓"). Sam znika; kolejny zastępuje
// poprzedni. Opcjonalny przycisk akcji (np. „Cofnij").
let el: HTMLDivElement | null = null;
let hideTimer = 0;

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export function toast(message: string, action?: ToastAction): void {
  if (typeof document === "undefined") return;
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
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

/** Kopiuje tekst do schowka i potwierdza toastem (albo mówi wprost, że się nie udało). */
export async function copyWithToast(text: string, label = "Skopiowano ✓"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast("Nie mogę skopiować — zaznacz tekst ręcznie.");
  }
}
