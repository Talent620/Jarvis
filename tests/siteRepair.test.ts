// === Automatyczna naprawa uciętego demo (siteRepair) — testy ===
// Ucięta odpowiedź AI (limit tokenów) NIE może trafić do użytkownika jako gotowe demo. Wykrywamy
// trzy skutki ucięcia (brak </html>, urwany CSS, urwany JS), robimy JEDNĄ próbę dokończenia i ponawiamy
// walidację. Gdy nadal uszkodzone — nie wolno pobierać.
import { describe, it, expect } from "vitest";
import { validateSite } from "../src/lib/siteValidator";
import { mergeHtmlContinuation, repairTruncatedSite } from "../src/lib/webgen";

const HEAD = `<!DOCTYPE html><html><head><title>X</title>`;

describe("siteValidator — wykrycie ucięcia (3 warianty)", () => {
  it("brak </html> → krytyczne, nie do pobrania", () => {
    const v = validateSite(`${HEAD}</head><body><h1>Hej</h1></body>`);
    expect(v.truncated).toBe(true);
    expect(v.safeToDownload).toBe(false);
    expect(v.issues.some((i) => i.code === "truncated")).toBe(true);
  });

  it("urwany CSS (<style> bez </style>) → krytyczne", () => {
    const v = validateSite(`${HEAD}<style>body{color:red;`);
    expect(v.truncated).toBe(true);
    expect(v.issues.some((i) => i.code === "truncated_css")).toBe(true);
    expect(v.safeToDownload).toBe(false);
  });

  it("urwany JS (<script> bez </script>) → krytyczne", () => {
    const v = validateSite(`${HEAD}</head><body><script>function x(){`);
    expect(v.truncated).toBe(true);
    expect(v.issues.some((i) => i.code === "truncated_js")).toBe(true);
    expect(v.safeToDownload).toBe(false);
  });

  it("kompletny dokument z domkniętym CSS i JS → OK do pobrania", () => {
    const v = validateSite(`${HEAD}<style>body{color:red}</style></head><body><h1>Hej</h1><img src="a.jpg" alt="a"><script>var x=1;</script></body></html>`);
    expect(v.truncated).toBe(false);
    expect(v.safeToDownload).toBe(true);
  });
});

describe("webgen — mergeHtmlContinuation", () => {
  it("dokleja dalszy ciąg do urwanego dokumentu", () => {
    const merged = mergeHtmlContinuation(`${HEAD}<style>body{color:red;`, "}</style></head><body></body></html>");
    expect(merged).toMatch(/<\/html>\s*$/);
  });
  it("gdy kontynuacja to pełny plik od nowa — bierze ją w całości (bez dublowania początku)", () => {
    const full = `${HEAD}</head><body></body></html>`;
    expect(mergeHtmlContinuation("<!DOCTYPE html><html>urwane", full)).toBe(full);
  });
  it("obcina otoczkę ```", () => {
    const merged = mergeHtmlContinuation(`${HEAD}<body>`, "```html\n</body></html>\n```");
    expect(merged).toContain("</html>");
    expect(merged).not.toContain("```");
  });
});

describe("webgen — repairTruncatedSite (jedna próba)", () => {
  it("ucięte → jedna kontynuacja domyka dokument → repaired i safe", async () => {
    const partial = `${HEAD}<style>body{color:red;`;
    const r = await repairTruncatedSite(partial, async () => "}</style></head><body><h1>Hej</h1></body></html>");
    expect(r.repaired).toBe(true);
    expect(r.validation.truncated).toBe(false);
    expect(r.validation.safeToDownload).toBe(true);
  });

  it("kompletne wejście → bez próby naprawy (repaired=false)", async () => {
    let called = 0;
    const full = `${HEAD}</head><body><h1>Hej</h1></body></html>`;
    const r = await repairTruncatedSite(full, async () => { called++; return ""; });
    expect(called).toBe(0);
    expect(r.repaired).toBe(false);
  });

  it("kontynuacja nadal urwana → uczciwie repaired=false i nie do pobrania", async () => {
    const partial = `${HEAD}<script>function x(){`;
    const r = await repairTruncatedSite(partial, async () => "console.log('nadal urwane'");
    expect(r.repaired).toBe(false);
    expect(r.validation.safeToDownload).toBe(false);
  });

  it("kontynuacja rzuca wyjątek → oryginał zachowany, brak pobrania", async () => {
    const partial = `${HEAD}<style>a{`;
    const r = await repairTruncatedSite(partial, async () => { throw new Error("brak sieci"); });
    expect(r.repaired).toBe(false);
    expect(r.validation.truncated).toBe(true);
  });
});
