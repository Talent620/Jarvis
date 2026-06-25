// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { crc32, base64ToBytes, buildZip } from "../src/lib/zip";

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe("zip — crc32", () => {
  it("zgodny ze standardem (check value)", () => {
    expect(crc32(ascii("123456789")) >>> 0).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("zip — base64ToBytes", () => {
  it("dekoduje base64 do bajtów", () => {
    // "Hi" → "SGk="
    expect(Array.from(base64ToBytes("SGk="))).toEqual([72, 105]);
  });
});

describe("zip — buildZip", () => {
  it("tworzy poprawny nagłówek lokalny i stopkę central directory", () => {
    const zip = buildZip([{ name: "a.txt", data: ascii("hello") }, { name: "b.txt", data: ascii("xy") }]);
    // Sygnatura lokalnego nagłówka PK\x03\x04
    expect(Array.from(zip.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // Zawiera nazwy plików
    const text = new TextDecoder().decode(zip);
    expect(text).toContain("a.txt");
    expect(text).toContain("b.txt");
    // Kończy się sygnaturą End Of Central Directory PK\x05\x06
    const tail = zip.slice(zip.length - 22, zip.length - 18);
    expect(Array.from(tail)).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it("pusta lista → samo EOCD", () => {
    const zip = buildZip([]);
    expect(Array.from(zip.slice(0, 4))).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });
});
