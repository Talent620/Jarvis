// === Studio Obrazów — OSOBNY PROGRAM (standalone) ===
// Renderuje WYŁĄCZNIE Studio Obrazów (ten sam komponent co w JARVISIE — zero duplikacji logiki),
// poza resztą aplikacji. Lekki shell z paskiem kluczy (fal.ai / lokalny SD), bo standalone nie ma
// ekranu Ustawień. Gemini (darmowy) wpisujesz w samym Studiu (🔑 Klucze Studia), Pollinations
// działa bez klucza. Dane (klucze, historia przeróbek) trzymane lokalnie w tym programie.

import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import Studio from "./components/Studio";
import { store } from "./lib/store";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles/index.css";

function KeyBar() {
  const [open, setOpen] = useState(false);
  const [fal, setFal] = useState(store.settings.falApiKey || "");
  const [sd, setSd] = useState(store.settings.sdUrl || "");
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 60, padding: "6px 10px", background: "rgba(4,7,15,.92)", borderBottom: "1px solid rgba(108,231,255,.2)", fontFamily: "system-ui, sans-serif" }}>
      <button className="chip" onClick={() => setOpen((o) => !o)} style={{ fontSize: 12 }}>
        🔑 Klucze (fal.ai / lokalny SD) {open ? "▲" : "▼"}
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, maxWidth: 560 }}>
          <input value={fal} placeholder="Klucz fal.ai (premium, opcjonalnie)" onChange={(e) => { setFal(e.target.value); store.setSettings({ falApiKey: e.target.value }); }} style={{ padding: "8px 10px" }} />
          <input value={sd} placeholder="Adres lokalnego Stable Diffusion (np. http://localhost:7860)" onChange={(e) => { setSd(e.target.value); store.setSettings({ sdUrl: e.target.value }); }} style={{ padding: "8px 10px" }} />
          <p style={{ fontSize: 11, opacity: 0.7, margin: 0 }}>Darmowy Gemini wpiszesz niżej w „🔑 Klucze Studia". Pollinations działa bez klucza.</p>
        </div>
      )}
    </div>
  );
}

function Shell() {
  // Studio jest pełnoekranowym arkuszem; onClose to no-op (to osobny program — nie zamykamy).
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-1, #04070f)" }}>
      {/* Scoped TYLKO dla standalone: zsuń arkusz Studia pod pasek kluczy (na desktopie panel sięga góry). */}
      <style>{`.sheet{align-items:flex-start;padding-top:52px}`}</style>
      <KeyBar />
      <Studio onClose={() => { /* osobny program — Studio zostaje otwarte */ }} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary label="Studia Obrazów">
      <Shell />
    </ErrorBoundary>
  </React.StrictMode>,
);
