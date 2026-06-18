// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { safeOpenExternal } from "../src/lib/glinks";
import { parseElement } from "../src/lib/leads";

describe("safeOpenExternal — tylko http/https", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("otwiera http i https", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    safeOpenExternal("https://example.com");
    safeOpenExternal("http://example.com/x");
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("blokuje javascript:, data: i puste", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    safeOpenExternal("javascript:alert(1)");
    safeOpenExternal("data:text/html,<script>1</script>");
    safeOpenExternal("");
    safeOpenExternal(undefined);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("parseElement — limity długości pól (niezaufane OSM)", () => {
  it("tnie zbyt długie pola", () => {
    const long = "x".repeat(5000);
    const lead = parseElement({ tags: { name: "Firma", website: "https://" + long, phone: long, "addr:street": long, "addr:city": "Kraków" } });
    expect(lead).not.toBeNull();
    expect(lead!.website!.length).toBeLessThanOrEqual(200);
    expect(lead!.phone!.length).toBeLessThanOrEqual(40);
    expect(lead!.address!.length).toBeLessThanOrEqual(160);
    expect(lead!.company).toBe("Firma");
  });
});
