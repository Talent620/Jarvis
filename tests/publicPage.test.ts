import { createRequire } from "node:module";
import { createServer, get, type Server } from "node:http";
import { describe, it, expect, afterEach } from "vitest";
const require = createRequire(import.meta.url);
const { createPublicPageReader, isPublicIPv4 } = require("../electron/public-page.cjs");
const { extractPage } = require("../electron/page-extract.cjs");
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve())))); });
async function server(handler: Parameters<typeof createServer>[0]) {
  const instance = createServer(handler); servers.push(instance);
  await new Promise<void>((resolve, reject) => { instance.once("error", reject); instance.listen(0, "127.0.0.1", resolve); });
  return `http://127.0.0.1:${(instance.address() as { port: number }).port}`;
}

describe("bezpieczny odczyt publicznych stron", () => {
  it("odrzuca sieci prywatne, zastrzeżone i IPv6", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "172.16.0.1", "192.0.2.2", "::1"]) expect(isPublicIPv4(ip)).toBe(false);
    expect(isPublicIPv4("8.8.8.8")).toBe(true);
  });
  it("czyta prawdziwą stronę testową bez wykonywania skryptów i wyciąga tytuł, tekst, linki", async () => {
    const base = await server((_req, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end('<title>Test &amp; sklep</title><main><h1>Lampa 100 zł</h1><script>nie wykonuj()</script><p>Opis części</p><table><tr><th>Produkt</th><th>Cena</th></tr><tr><td>Lampa</td><td>100 zł</td></tr></table><a href="/produkt">Oferta</a><a href="javascript:alert(1)">atak</a></main>'); });
    const page = await createPublicPageReader({ allowLocal: true }).readPage(base + "/test");
    const result = extractPage(page);
    expect(result.title).toBe("Test & sklep");
    expect(result.text).toContain("Lampa 100 zł");
    expect(result.text).not.toContain("nie wykonuj");
    expect(result.links).toEqual([{ label: "Oferta", url: base + "/produkt" }]);
    expect(result.tableRows).toEqual([["Produkt", "Cena"], ["Lampa", "100 zł"]]);
  });
  it("odrzuca adresy lokalne i dane logowania w konfiguracji produkcyjnej", async () => {
    const base = await server((_req, res) => res.end("x"));
    await expect(createPublicPageReader().readPage(base)).rejects.toThrow(/port|lokalny|prywatny/);
    await expect(createPublicPageReader().readPage("http://localhost/")).rejects.toThrow(/lokalny|prywatny/);
    await expect(createPublicPageReader().readPage("http://169.254.169.254/")).rejects.toThrow(/lokalny|prywatny/);
    await expect(createPublicPageReader().readPage("http://user:pass@example.com/")).rejects.toThrow(/logowania/);
    await expect(createPublicPageReader().readPage("file:///tmp/example")).rejects.toThrow(/HTTP/);
  });
  it("blokuje przekierowanie publicznej strony do adresu prywatnego", async () => {
    const base = await server((_req, res) => { res.statusCode = 302; res.setHeader("location", "http://127.0.0.1/"); res.end(); });
    const lookup = async (host: string) => [{ address: host === "127.0.0.1" ? "127.0.0.1" : "8.8.8.8", family: 4 }];
    const transport = (_url: URL, options: { lookup: (h: string, o: object, cb: (e: null, addr: string, family: number) => void) => void }, cb: Parameters<typeof get>[1]) => {
      options.lookup("public.example", {}, (_e, addr) => expect(addr).toBe("8.8.8.8"));
      return get(base, cb);
    };
    const reader = createPublicPageReader({ lookup, get: transport });
    await expect(reader.readPage("http://public.example/")).rejects.toThrow(/lokalny|prywatny/);
  });
  it("weryfikuje każdy adres po przekierowaniu", async () => {
    const base = await server((_req, res) => { res.statusCode = 302; res.setHeader("location", "file:///etc/passwd"); res.end(); });
    await expect(createPublicPageReader({ allowLocal: true }).readPage(base)).rejects.toThrow(/HTTP/);
  });
  it("przerywa zbyt wolne odpowiedzi", async () => {
    const base = await server((_req, res) => { res.setHeader("content-type", "text/html"); res.write("a"); });
    await expect(createPublicPageReader({ allowLocal: true, timeoutMs: 100 }).readPage(base)).rejects.toThrow(/czas/);
  });
  it("odrzuca nieudane odpowiedzi i przekroczenie limitu rozmiaru", async () => {
    const base = await server((req, res) => { if (req.url === "/404") { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", "text/html"); res.end("x".repeat(1024)); });
    const reader = createPublicPageReader({ allowLocal: true, maxBytes: 64 });
    await expect(reader.readPage(base + "/404")).rejects.toThrow(/404/);
    await expect(reader.readPage(base)).rejects.toThrow(/limit/);
  });
});
