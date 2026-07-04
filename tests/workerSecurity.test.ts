import { describe, it, expect, vi } from "vitest";
vi.mock("cloudflare:sockets", () => ({ connect: () => ({}) }));
import { blocksCloudMetadata, noCRLF, openaiHostAllowed, envKeyForHost, passthroughAllowed } from "../proxy/worker.js";

describe("worker passthroughAllowed — opt-in allowlista (zgodność wstecz)", () => {
  it("brak konfiguracji (puste) → wpuszcza wszystko (jak dotąd)", () => {
    expect(passthroughAllowed("home.local", "")).toBe(true);
    expect(passthroughAllowed("api.example.com", undefined)).toBe(true);
  });
  it("ustawione PASSTHROUGH_HOSTS → tylko host lub subdomena z listy", () => {
    const env = "home.local, fal.media";
    expect(passthroughAllowed("home.local", env)).toBe(true);
    expect(passthroughAllowed("cdn.fal.media", env)).toBe(true); // subdomena
    expect(passthroughAllowed("evil.com", env)).toBe(false);
    expect(passthroughAllowed("fal.media.evil.com", env)).toBe(false); // anty-podszywanie
  });
});

describe("worker blocksCloudMetadata — anty-SSRF (metadane chmury)", () => {
  it("blokuje link-local 169.254.x (AWS/GCP/Azure IMDS)", () => {
    expect(blocksCloudMetadata("http://169.254.169.254/latest/meta-data/")).toBe(true);
    expect(blocksCloudMetadata("https://169.254.1.1/")).toBe(true);
  });
  it("blokuje metadata.google.internal i Alibaba 100.100.100.200", () => {
    expect(blocksCloudMetadata("http://metadata.google.internal/")).toBe(true);
    expect(blocksCloudMetadata("http://100.100.100.200/")).toBe(true);
  });
  it("blokuje IPv6 fd00:ec2::254 (AWS IMDS v6)", () => {
    expect(blocksCloudMetadata("http://[fd00:ec2::254]/")).toBe(true);
  });
  it("PRZEPUSZCZA LAN (Home Assistant) i publiczne hosty", () => {
    expect(blocksCloudMetadata("http://192.168.0.10:8123/")).toBe(false);
    expect(blocksCloudMetadata("http://10.0.0.5/")).toBe(false);
    expect(blocksCloudMetadata("https://api.example.com/")).toBe(false);
  });
  it("nieparsowalny URL → blokuje (fail-safe)", () => {
    expect(blocksCloudMetadata("nie-jest-urlem")).toBe(true);
    expect(blocksCloudMetadata("")).toBe(true);
  });
});

describe("worker noCRLF — anty-injection nagłówków SMTP/MIME", () => {
  it("usuwa CR/LF i przycina", () => {
    expect(noCRLF("a\r\nBcc: ofiara@x.pl")).toBe("a Bcc: ofiara@x.pl");
    expect(noCRLF("  cześć\n")).toBe("cześć");
  });
  it("null/undefined → pusty string", () => {
    expect(noCRLF(null)).toBe("");
    expect(noCRLF(undefined)).toBe("");
  });
});

describe("worker openaiHostAllowed — ścisła biała lista hostów", () => {
  it("przepuszcza dokładne hosty z listy", () => {
    expect(openaiHostAllowed("api.groq.com")).toBe(true);
    expect(openaiHostAllowed("openrouter.ai")).toBe(true);
    expect(openaiHostAllowed("integrate.api.nvidia.com")).toBe(true);
    expect(openaiHostAllowed("models.github.ai")).toBe(true);
    expect(openaiHostAllowed("api.cohere.ai")).toBe(true); // nowy dostawca Cohere przez proxy
  });
  it("przepuszcza subdomeny dozwolonych hostów", () => {
    expect(openaiHostAllowed("eu.api.groq.com")).toBe(true);
  });
  it("ODRZUCA podszywanie się sufiksem (wyciek klucza Bearer)", () => {
    expect(openaiHostAllowed("api.groq.com.attacker.tld")).toBe(false);
    expect(openaiHostAllowed("openrouter.ai.evil.com")).toBe(false);
    expect(openaiHostAllowed("notgroq.com")).toBe(false);
    expect(openaiHostAllowed("evil.com")).toBe(false);
  });
});

describe("worker envKeyForHost — mapowanie host → sekret env", () => {
  const env = { GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o", NVIDIA_API_KEY: "n", GITHUB_MODELS_TOKEN: "gh" };
  it("dobiera właściwy klucz po hoście", () => {
    expect(envKeyForHost("api.groq.com", env)).toBe("g");
    expect(envKeyForHost("openrouter.ai", env)).toBe("o");
    expect(envKeyForHost("integrate.api.nvidia.com", env)).toBe("n");
    expect(envKeyForHost("models.github.ai", env)).toBe("gh");
  });
  it("nieznany host → undefined (spadnie na nagłówek authorization klienta)", () => {
    expect(envKeyForHost("api.example.com", env)).toBeUndefined();
  });
});
