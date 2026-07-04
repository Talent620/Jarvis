// === Parytet głos↔interfejs (voiceToolParity) — testy ===
// Głosem/narzędziami ma działać PEŁNY proces: podgląd → import → demo → treść → kampania → co dalej.
// Drafty NIE wymagają zgody outbound (są write/read, nie outbound). Publiczne find_leads pozostaje.
import { describe, it, expect } from "vitest";
import { toolDefs } from "../src/lib/tools";
import { riskOf } from "../src/lib/permissions";

const names = new Set(toolDefs.map((d) => d.name));

describe("voiceToolParity — nowe narzędzia procesu istnieją", () => {
  it("dodano sześć narzędzi pełnego przepływu", () => {
    for (const n of ["preview_lead_candidates", "import_lead_candidates", "prepare_lead_demo", "create_content_draft", "create_campaign_draft", "client_next_action"]) {
      expect(names.has(n)).toBe(true);
    }
  });

  it("publiczne find_leads pozostaje (kompatybilność)", () => {
    expect(names.has("find_leads")).toBe(true);
  });
});

describe("voiceToolParity — ryzyko: drafty bez zgody outbound", () => {
  it("podgląd i co-dalej tylko czytają", () => {
    expect(riskOf("preview_lead_candidates")).toBe("read");
    expect(riskOf("client_next_action")).toBe("read");
  });

  it("drafty zapisują lokalnie (write) — NIE outbound", () => {
    for (const n of ["import_lead_candidates", "prepare_lead_demo", "create_content_draft", "create_campaign_draft"]) {
      expect(riskOf(n)).toBe("write");
      expect(riskOf(n)).not.toBe("outbound");
    }
  });

  it("działania zewnętrzne nadal wymagają zgody (np. send_offer/wysyłka) — nieznane = outbound", () => {
    // Nieznane/niesklasyfikowane działanie domyślnie jest outbound (bezpiecznie: pyta o zgodę).
    expect(riskOf("some_unknown_publish_action")).toBe("outbound");
  });
});
