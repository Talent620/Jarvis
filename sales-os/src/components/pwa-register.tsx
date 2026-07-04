"use client";

import { useEffect } from "react";

/** Registers the service worker that powers the installable (PWA) build. */
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch((e) => {
        console.warn("[pwa] service worker registration failed:", e);
      });
    }
  }, []);
  return null;
}
