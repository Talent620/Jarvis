import { describe, it, expect } from "vitest";
import { LIVE_VOICE_PERSONA } from "../src/lib/voicePersona";

describe("LIVE_VOICE_PERSONA — kontrakt rozmowy na żywo", () => {
  it("jest niepustą instrukcją mowy", () => {
    expect(LIVE_VOICE_PERSONA.length).toBeGreaterThan(200);
    expect(LIVE_VOICE_PERSONA).toMatch(/ROZMOWA NA ŻYWO/);
  });
  it("wymusza krótkie, mówione odpowiedzi (bez markdownu/list)", () => {
    expect(LIVE_VOICE_PERSONA).toMatch(/1 do 3 zdań|1–3|jedna myśl/i);
    expect(LIVE_VOICE_PERSONA).toMatch(/markdown/i);
  });
  it("zawiera ton naturalny + szczerość (bez udawanej pewności)", () => {
    expect(LIVE_VOICE_PERSONA).toMatch(/naturaln/i);
    expect(LIVE_VOICE_PERSONA).toMatch(/nie udawaj pewności|szczer/i);
  });
});
