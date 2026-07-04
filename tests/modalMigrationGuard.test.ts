// === Strażnik migracji modali (modalMigrationGuard) ===
// Nowe ekrany mają używać wspólnego <Modal> (dostępność, pułapka fokusu), a nie ręcznego .sheet/.panel.
// Ten strażnik trzyma listę ISTNIEJĄCYCH ręcznych modali (do stopniowej migracji) i BLOKUJE nowe:
// każdy nowy komponent z className="sheet" musi albo użyć Modal, albo świadomie trafić na whitelistę.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const DIR = "src/components";

// Infrastruktura renderująca .sheet (nie „ręczny" panel do migracji): kanoniczny Modal oraz
// lekki szkielet ładowania, który celowo naśladuje kształt arkusza.
const CANONICAL = new Set(["Modal.tsx", "ScreenSkeleton.tsx"]);

// Istniejące ręczne modale w chwili wprowadzenia strażnika (do migracji z czasem — NIE powiększać bez powodu).
const LEGACY_MANUAL = new Set([
  "AdStudio.tsx", "AdminPanel.tsx", "BargainHunter.tsx", "BrandKit.tsx", "Cards.tsx", "ChatHistory.tsx",
  "CostPanel.tsx", "FinancialDashboard.tsx", "Gadgets.tsx", "GoalStatusPanel.tsx", "GrowthDayPanel.tsx",
  "Guardian.tsx", "Help.tsx", "Journal.tsx", "LeadCandidatesPanel.tsx", "LeadDetail.tsx", "MailCompose.tsx",
  "MarketingWorkspace.tsx", "MoneyHub.tsx", "More.tsx", "Panels.tsx", "PermissionDialog.tsx", "Projects.tsx", "SalesCrm.tsx",
  "SalesDashboard.tsx", "SalesPlan.tsx", "Settings.tsx", "Studio.tsx", "TaskHub.tsx",
  "Transcribe.tsx", "Translator.tsx", "WebStudio.tsx", "WhereToBuy.tsx",
]);

const usesManualSheet = (src: string): boolean => /className="sheet"|className=\{`sheet/.test(src);

describe("modalMigrationGuard — brak NOWYCH ręcznych modali", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
  const manual = files.filter((f) => usesManualSheet(readFileSync(`${DIR}/${f}`, "utf8")));

  it("każdy komponent z ręcznym .sheet jest na whitelist (Modal lub legacy)", () => {
    const unexpected = manual.filter((f) => !CANONICAL.has(f) && !LEGACY_MANUAL.has(f));
    // Jeśli to Twój NOWY ekran — użyj <Modal> zamiast ręcznego .sheet (dostępność + pułapka fokusu).
    expect(unexpected).toEqual([]);
  });

  it("whitelist nie zawiera martwych wpisów (pilnuje sprzątania po migracji)", () => {
    const stale = [...LEGACY_MANUAL].filter((f) => !manual.includes(f));
    expect(stale).toEqual([]);
  });
});
