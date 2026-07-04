import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "net.serwer256.jarvis",
  appName: "JARVIS",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    // Natywne zapytania HTTP — omija CORS w WebView (koniec "Failed to fetch").
    CapacitorHttp: {
      enabled: true,
    },
    // Aktualizacje OTA (sam web-bundle ~1–2 MB, nie cały APK). autoUpdate=false → NIE łączymy się
    // z chmurą Capgo; sami sprawdzamy/pobieramy paczkę z GitHub Releases (lib/liveUpdate.ts).
    CapacitorUpdater: {
      autoUpdate: false,
    },
  },
};

export default config;
