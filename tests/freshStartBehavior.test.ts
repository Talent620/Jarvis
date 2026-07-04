// @vitest-environment jsdom
// === Test ZACHOWANIA „czystej karty" w panelach z trwałą sesją ===
// KLASA BŁĘDU (zgłoszona przez użytkownika jako „karygodna podstawa"): skoro szkice są
// trwałe (wracają po każdym wejściu), KAŻDY panel twórczy MUSI mieć jawną drogę do nowej
// pracy — inaczej użytkownik jest uwięziony w starym stanie na zawsze. Montujemy PRAWDZIWE
// komponenty (createRoot + kliknięcia), zasiewamy trwałe szkice i sprawdzamy: (1) szkic
// wraca po montażu, (2) przycisk 🆕 realnie czyści stan I trwały szkic.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ContentStudio from "../src/components/ContentStudio";
import AdStudio from "../src/components/AdStudio";
import { writeDraft, readDraft } from "../src/lib/draftStore";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(el: React.FunctionComponentElement<unknown>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(el); });
}
async function click(testid: string) {
  const el = container.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement | null;
  expect(el, `brak przycisku czystej karty: ${testid}`).toBeTruthy();
  await act(async () => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

beforeEach(() => { localStorage.clear(); });
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
});

describe("Maszynka do kontentu — 🆕 Nowy post", () => {
  it("trwały szkic wraca po montażu, a 🆕 czyści stan I szkic", async () => {
    writeDraft("content.topic", "stary temat promocji");
    writeDraft("content.out", "STARY WYGENEROWANY POST");
    await mount(createElement(ContentStudio, { onClose: () => {} }));
    // (1) sesja odtworzona — stary wynik i temat są widoczne
    expect(container.textContent).toContain("STARY WYGENEROWANY POST");
    const ta = container.querySelector("textarea, input[type=text]") as HTMLTextAreaElement | HTMLInputElement | null;
    expect(document.body.textContent || "").toContain("STARY WYGENEROWANY POST");
    expect(ta).toBeTruthy();
    // (2) czysta karta jednym kliknięciem — stan i TRWAŁY szkic wyczyszczone
    await click("content-fresh");
    expect(container.textContent).not.toContain("STARY WYGENEROWANY POST");
    expect(readDraft("content.topic", "")).toBe("");
    expect(readDraft("content.out", "")).toBe("");
    // przycisk znika, gdy nie ma czego czyścić (nie straszy na pustym panelu)
    expect(container.querySelector('[data-testid="content-fresh"]')).toBeNull();
  });
});

describe("Generator reklam — 🆕 Nowa kampania", () => {
  it("trwały szkic wraca po montażu, a 🆕 czyści formularz, wynik i UTM (szkice też)", async () => {
    writeDraft("ads.product", "stary produkt — kurs stolarki");
    writeDraft("ads.out", "STARE REKLAMY GOOGLE");
    writeDraft("ads.utmUrl", "https://stara.pl");
    await mount(createElement(AdStudio, { onClose: () => {} }));
    expect(container.textContent).toContain("STARE REKLAMY GOOGLE");
    await click("ads-fresh");
    expect(container.textContent).not.toContain("STARE REKLAMY GOOGLE");
    expect(readDraft("ads.product", "")).toBe("");
    expect(readDraft("ads.out", "")).toBe("");
    expect(readDraft("ads.utmUrl", "")).toBe("");
    expect(readDraft("ads.utmPreset", null)).toBeNull();
    expect(container.querySelector('[data-testid="ads-fresh"]')).toBeNull();
  });
});
