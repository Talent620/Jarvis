// @vitest-environment jsdom
// === Test ZACHOWANIA panelu Sztafety Misji: realne kliknięcia, realne silniki ===
// MissionsPanel montowany w jsdom przez createRoot; klik „Pokaz" faktycznie odpala
// runDemoMission (silnik + emulator), a wynik pojawia się w UI. Bez regexów na źródle.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import MissionsPanel from "../src/components/MissionsPanel";
import { clearMissionLog } from "../src/lib/horizon/missionLog";
import { resetDemoEmulator } from "../src/lib/horizon/demoMission";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(MissionsPanel)); });
}
async function click(testid: string) {
  const el = container.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement;
  if (!el) throw new Error("brak przycisku: " + testid);
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  // pozwól rozwiązać się async run() (setState po await)
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
const out = () => (container.querySelector('[data-testid="mp-output"]') as HTMLElement | null)?.textContent || "";

beforeEach(() => {
  clearMissionLog();
  resetDemoEmulator();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MissionsPanel — zachowanie z prawdziwymi silnikami", () => {
  it("na start pokazuje przyciski i pusty wynik; „Status” mówi o braku misji", async () => {
    await mount();
    expect(container.querySelector('[data-testid="mp-demo"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mp-output"]')).toBeNull(); // brak wyjścia dopóki nie klikniesz
    await click("mp-status");
    expect(out()).toMatch(/Brak misji/);
  });

  it("„Pokaz” uruchamia dwuaktową misję i pokazuje dowody (3/3, emulator)", async () => {
    await mount();
    await click("mp-demo");
    const t = out();
    expect(t).toMatch(/EMULATOR/i);
    expect(t).toMatch(/3\/3/);
    expect(t).toMatch(/urządzenie · set_state · CONFIRMED/);
  });

  it("po pokazie „Dlaczego?” wyjaśnia stan, a „Cofnij” wykonuje operację odwrotną", async () => {
    await mount();
    await click("mp-demo");
    await click("mp-why");
    expect(out()).toMatch(/potwierdzonych/);
    await click("mp-undo");
    expect(out()).toMatch(/Cofnięto|nic nie skasowałem/);
  });

  it("bez desktopu przycisk „Sprawdź węzeł EXE” nie jest renderowany (isDesktop=false w jsdom)", async () => {
    await mount();
    expect(container.querySelector('[data-testid="mp-exe"]')).toBeNull();
  });
});
