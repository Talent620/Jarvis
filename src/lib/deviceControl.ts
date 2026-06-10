import { AppLauncher } from "@capacitor/app-launcher";
import { store } from "./store";

// Otwieranie aplikacji i usług zewnętrznych. Na Androidzie/iOS używa AppLauncher,
// w przeglądarce robi fallback na window.open.

async function open(url: string): Promise<boolean> {
  try {
    const { value } = await AppLauncher.canOpenUrl({ url }).catch(() => ({ value: false }));
    if (value) {
      await AppLauncher.openUrl({ url });
      return true;
    }
  } catch {
    /* fallthrough do przeglądarki */
  }
  try {
    window.open(url, "_blank", "noopener");
    return true;
  } catch {
    return false;
  }
}

const q = (s: string) => encodeURIComponent(s.trim());

/** Znane usługi -> budowanie URL (preferujemy deep-linki, fallback to web). */
export async function openService(service: string, query?: string): Promise<string> {
  const s = service.toLowerCase().trim();
  const Q = query ? q(query) : "";

  const map: Record<string, string> = {
    spotify: query ? `https://open.spotify.com/search/${Q}` : "https://open.spotify.com",
    youtube: query ? `https://www.youtube.com/results?search_query=${Q}` : "https://www.youtube.com",
    netflix: "https://www.netflix.com",
    maps: query ? `https://www.google.com/maps/search/${Q}` : "https://www.google.com/maps",
    google: query ? `https://www.google.com/search?q=${Q}` : "https://www.google.com",
    gmail: "https://mail.google.com",
    whatsapp: query ? `https://wa.me/?text=${Q}` : "https://web.whatsapp.com",
    messenger: "https://www.messenger.com",
    instagram: "https://www.instagram.com",
    facebook: "https://www.facebook.com",
    tiktok: "https://www.tiktok.com",
    allegro: query ? `https://allegro.pl/listing?string=${Q}` : "https://allegro.pl",
    olx: query ? `https://www.olx.pl/oferty/q-${Q}/` : "https://www.olx.pl",
    twitter: "https://twitter.com",
    x: "https://twitter.com",
  };

  const url = map[s];
  if (!url) return `Nie znam usługi „${service}”. Spróbuj: spotify, youtube, maps, gmail, whatsapp, allegro…`;
  const ok = await open(url);
  return ok ? `Otwieram ${service}${query ? ` — „${query}”` : ""}.` : `Nie udało się otworzyć ${service}.`;
}

export async function openUrl(url: string): Promise<string> {
  const u = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
  const ok = await open(u);
  return ok ? `Otwieram: ${u}.` : `Nie udało się otworzyć: ${u}.`;
}

export async function call(number: string): Promise<string> {
  const ok = await open(`tel:${number.replace(/\s/g, "")}`);
  return ok ? `Dzwonię pod ${number}.` : "Nie udało się rozpocząć połączenia.";
}

export async function sms(number: string, body?: string): Promise<string> {
  const url = `sms:${number.replace(/\s/g, "")}${body ? `?body=${q(body)}` : ""}`;
  const ok = await open(url);
  return ok ? `Przygotowuję SMS do ${number}.` : "Nie udało się otworzyć wiadomości.";
}

export async function navigate(destination: string): Promise<string> {
  const ok = await open(`https://www.google.com/maps/dir/?api=1&destination=${q(destination)}`);
  return ok ? `Wyznaczam trasę do: ${destination}.` : "Nie udało się otworzyć nawigacji.";
}

// Sterowanie smart home przez REST API Home Assistant.
// entityId np. "light.salon", "switch.czajnik", "climate.sypialnia".
export async function smartHome(
  entityId: string,
  action: "on" | "off" | "toggle",
): Promise<string> {
  const { homeAssistantUrl, homeAssistantToken, proxyUrl } = store.settings;
  if (!homeAssistantUrl || !homeAssistantToken) {
    return "Home Assistant nie jest skonfigurowany. Dodaj adres i token w ⚙ Ustawienia.";
  }
  const domain = entityId.split(".")[0] || "homeassistant";
  const service = action === "on" ? "turn_on" : action === "off" ? "turn_off" : "toggle";
  const base = homeAssistantUrl.replace(/\/$/, "");
  const target = `${base}/api/services/${domain}/${service}`;
  const url = proxyUrl ? `${proxyUrl}/passthrough?u=${encodeURIComponent(target)}` : target;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${homeAssistantToken}`,
      },
      body: JSON.stringify({ entity_id: entityId }),
    });
    if (!res.ok) return `Home Assistant odrzucił żądanie (${res.status}).`;
    const label = action === "on" ? "włączone" : action === "off" ? "wyłączone" : "przełączone";
    return `Gotowe — ${entityId} ${label}.`;
  } catch (e) {
    return `Nie udało się połączyć z Home Assistant: ${e instanceof Error ? e.message : String(e)}`;
  }
}
