import type { MetadataRoute } from "next";

/**
 * PWA manifest — makes the app installable as a standalone window on
 * Windows/macOS (Edge/Chrome → "Install app") and on Android/iOS
 * ("Add to Home Screen"), all from this one codebase.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI Sales OS",
    short_name: "Sales OS",
    description:
      "Lead acquisition, calling queue, website audits, email outreach and social publishing — on autopilot.",
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#faf7f2",
    theme_color: "#25503c",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Calls — today's queue",
        url: "/calls",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Lead Finder",
        url: "/prospecting",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Approvals",
        url: "/approvals",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
