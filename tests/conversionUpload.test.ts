// === Import konwersji offline (conversionUpload) — testy ===
// Osobny, zatwierdzany connector. Bez gclid → nie tworzymy konwersji. PII tylko za zgodą + hasher.
// Nic nie „uploaded" bez zatwierdzenia. Płatne API mockowane (żadnych realnych wysyłek).
import { describe, it, expect, vi } from "vitest";
import { prepareConversions, uploadConversions, type RoiConversion, type UploadFn } from "../src/lib/conversionUpload";

const conv = (over: Partial<RoiConversion>): RoiConversion => ({ conversionAction: "zakup", conversionDateTime: "2026-07-01T10:00:00Z", value: 5000, currency: "PLN", ...over });
const fakeHasher = (s: string) => `h(${s})`;

describe("conversionUpload — przygotowanie", () => {
  it("brak gclid → skipped_no_id (bez fałszywej atrybucji); z gclid → ready", () => {
    const ups = prepareConversions([conv({ gclid: "G1" }), conv({})], {});
    expect(ups[0].status).toBe("ready");
    expect(ups[1].status).toBe("skipped_no_id");
  });

  it("PII TYLKO za zgodą i z hasherem; bez zgody — pomijane", () => {
    const withConsent = prepareConversions([conv({ gclid: "G1", email: "  A@B.PL ", phone: "600 100 200" })], { consentPII: true, hasher: fakeHasher });
    expect(withConsent[0].userIdentifiers?.hashedEmail).toBe("h(a@b.pl)"); // znormalizowane + hashowane
    expect(withConsent[0].userIdentifiers?.hashedPhone).toBe("h(+600100200)");

    const noConsent = prepareConversions([conv({ gclid: "G1", email: "a@b.pl" })], { consentPII: false, hasher: fakeHasher });
    expect(noConsent[0].userIdentifiers).toBeUndefined();

    const noHasher = prepareConversions([conv({ gclid: "G1", email: "a@b.pl" })], { consentPII: true });
    expect(noHasher[0].userIdentifiers).toBeUndefined();
  });
});

describe("conversionUpload — wysyłka tylko po zatwierdzeniu", () => {
  const ready = prepareConversions([conv({ gclid: "G1" })], {});

  it("bez zatwierdzenia → prepared, uploadFn NIE wywołany (nic nie wysłano)", async () => {
    const uploadFn = vi.fn<UploadFn>(async () => ({ ok: true }));
    const r = await uploadConversions(ready, { approved: false, uploadFn });
    expect(r.state).toBe("prepared");
    expect(uploadFn).not.toHaveBeenCalled();
  });

  it("zatwierdzone + potwierdzenie platformy → uploaded_confirmed", async () => {
    const uploadFn = vi.fn<UploadFn>(async () => ({ ok: true }));
    const r = await uploadConversions(ready, { approved: true, uploadFn });
    expect(r.state).toBe("uploaded_confirmed");
    expect(r.count).toBe(1);
    expect(uploadFn).toHaveBeenCalledTimes(1);
  });

  it("zatwierdzone, ale platforma odrzuca → failed (nie udaje sukcesu)", async () => {
    const uploadFn = vi.fn<UploadFn>(async () => ({ ok: false, error: "invalid gclid" }));
    const r = await uploadConversions(ready, { approved: true, uploadFn });
    expect(r.state).toBe("failed");
  });

  it("zatwierdzone bez połączenia (brak uploadFn) → prepared, nie confirmed", async () => {
    const r = await uploadConversions(ready, { approved: true });
    expect(r.state).toBe("prepared");
  });

  it("nie ma czego wysłać (same skipped) → prepared, count 0", async () => {
    const onlySkipped = prepareConversions([conv({})], {});
    const r = await uploadConversions(onlySkipped, { approved: true, uploadFn: async () => ({ ok: true }) });
    expect(r.state).toBe("prepared");
    expect(r.count).toBe(0);
    expect(r.skipped).toBe(1);
  });
});
