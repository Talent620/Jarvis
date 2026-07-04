// === Warstwa możliwości kanałów (platformCapabilities) — testy ===
// Każdy zielony sukces = potwierdzony skutek. Brak uprawnień → export-only (nie fake success);
// PROCESSING nie jest LIVE; reklamy płatnej nie zastąpi zwykły post; wersja Meta z konfiguracji.
import { describe, it, expect } from "vitest";
import {
  resolveChannelCapability, interpretPublishState, isConfirmedLive, buildReceipt,
  resolveMetaGraphVersion, canRunPaidAd, DEFAULT_META_GRAPH_VERSION,
} from "../src/lib/platformCapabilities";

describe("platformCapabilities — stan kanału", () => {
  it("brak tokena, ale eksport dostępny → export_only", () => {
    const c = resolveChannelCapability({ channel: "linkedin", hasToken: false, supportsExport: true });
    expect(c.state).toBe("export_only");
    expect(c.canPublishApi).toBe(false);
  });

  it("brak uprawnień → export_only, NIE fałszywy sukces", () => {
    const c = resolveChannelCapability({ channel: "tiktok", hasToken: true, hasRequiredPermissions: false, supportsExport: true });
    expect(c.state).toBe("export_only");
    expect(c.canPublishApi).toBe(false);
  });

  it("aplikacja niezatwierdzona (TikTok/LinkedIn) → export_only", () => {
    const c = resolveChannelCapability({ channel: "tiktok", hasToken: true, hasRequiredPermissions: true, appApproved: false, supportsExport: true });
    expect(c.state).toBe("export_only");
  });

  it("pełne uprawnienia + zdrowe API → connected; niezdrowe → degraded", () => {
    expect(resolveChannelCapability({ channel: "meta", hasToken: true, hasRequiredPermissions: true, healthy: true }).state).toBe("connected");
    expect(resolveChannelCapability({ channel: "meta", hasToken: true, hasRequiredPermissions: true, healthy: false }).state).toBe("degraded");
  });
});

describe("platformCapabilities — stan publikacji (PROCESSING ≠ LIVE)", () => {
  it("mapuje surowe stany", () => {
    expect(interpretPublishState("LIVE")).toBe("LIVE");
    expect(interpretPublishState("PROCESSING")).toBe("PROCESSING");
    expect(interpretPublishState("REJECTED")).toBe("REJECTED");
    expect(interpretPublishState("cokolwiek")).toBe("UNKNOWN");
  });

  it("tylko LIVE jest potwierdzoną publikacją", () => {
    expect(isConfirmedLive("LIVE")).toBe(true);
    expect(isConfirmedLive("PROCESSING")).toBe(false);
  });

  it("receipt ustawia confirmedAt tylko dla LIVE", () => {
    const live = buildReceipt({ channel: "meta", externalId: "1", apiState: "LIVE", now: 100 });
    const proc = buildReceipt({ channel: "meta", externalId: "2", apiState: "PROCESSING", now: 100 });
    expect(live.confirmedAt).toBe(100);
    expect(proc.confirmedAt).toBeUndefined();
  });
});

describe("platformCapabilities — Meta wersja i reklamy płatne", () => {
  it("wersja Meta z konfiguracji, z bezpiecznym domyślnym", () => {
    expect(resolveMetaGraphVersion("v20.0")).toBe("v20.0");
    expect(resolveMetaGraphVersion("")).toBe(DEFAULT_META_GRAPH_VERSION);
    expect(resolveMetaGraphVersion("śmieci")).toBe(DEFAULT_META_GRAPH_VERSION);
  });

  it("reklamy płatnej nie zastąpi zwykły post (wymaga Ads API)", () => {
    const organicOnly = resolveChannelCapability({ channel: "meta", hasToken: true, hasRequiredPermissions: true, healthy: true, supportsPaidAds: false });
    expect(canRunPaidAd(organicOnly).ok).toBe(false);
    const adsReady = resolveChannelCapability({ channel: "meta", hasToken: true, hasRequiredPermissions: true, healthy: true, supportsPaidAds: true });
    expect(canRunPaidAd(adsReady).ok).toBe(true);
  });
});
