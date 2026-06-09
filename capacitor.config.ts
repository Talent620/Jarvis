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
  },
};

export default config;
