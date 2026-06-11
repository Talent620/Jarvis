// Pogoda przez Open-Meteo — darmowe, bez klucza API, działa z przeglądarki (CORS OK).

const CODES: Record<number, string> = {
  0: "bezchmurnie",
  1: "głównie słonecznie",
  2: "częściowe zachmurzenie",
  3: "pochmurno",
  45: "mgła",
  48: "marznąca mgła",
  51: "lekka mżawka",
  53: "mżawka",
  55: "gęsta mżawka",
  61: "lekki deszcz",
  63: "deszcz",
  65: "ulewny deszcz",
  71: "lekki śnieg",
  73: "śnieg",
  75: "intensywny śnieg",
  80: "przelotny deszcz",
  81: "przelotne opady",
  82: "gwałtowne ulewy",
  95: "burza",
  96: "burza z gradem",
  99: "silna burza z gradem",
};

interface Geo {
  lat: number;
  lon: number;
  name: string;
}

async function geocode(city: string): Promise<Geo | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    city,
  )}&count=1&language=pl&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const r = data?.results?.[0];
  return r ? { lat: r.latitude, lon: r.longitude, name: `${r.name}${r.country ? `, ${r.country}` : ""}` } : null;
}

function browserLocation(): Promise<Geo | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: "Twoja lokalizacja" }),
      () => resolve(null),
      { timeout: 6000 },
    );
  });
}

export async function getWeather(location?: string): Promise<string> {
  let geo: Geo | null = null;
  if (location && location.trim()) geo = await geocode(location.trim());
  else geo = (await browserLocation()) || (await geocode("Warszawa"));
  if (!geo) return "Nie udało się ustalić lokalizacji dla pogody.";

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) return "Serwis pogodowy jest chwilowo niedostępny.";
  const d = await res.json().catch(() => null);
  if (!d?.current || !d?.daily) return "Serwis pogodowy zwrócił niepełne dane — spróbuj za chwilę.";
  const c = d.current;
  const day = d.daily;
  const desc = CODES[c.weather_code] ?? "zmiennie";

  return (
    `Pogoda — ${geo.name}: ${Math.round(c.temperature_2m)}°C (odczuwalna ${Math.round(
      c.apparent_temperature,
    )}°C), ${desc}. ` +
    `Wilgotność ${c.relative_humidity_2m}%, wiatr ${Math.round(c.wind_speed_10m)} km/h. ` +
    `Dziś od ${Math.round(day.temperature_2m_min[0])}° do ${Math.round(day.temperature_2m_max[0])}°, ` +
    `szansa opadów ${day.precipitation_probability_max[0]}%.`
  );
}
