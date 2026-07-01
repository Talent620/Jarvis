import { useMemo, useState } from "react";
import type { GrowthContext } from "../lib/growthContext";
import { store, uid } from "../lib/store";
import { useStore } from "../hooks/useStore";
import { draftOffer } from "../lib/offer";
import { splitOffer } from "../lib/glinks";
import { canSendDirect, draftAndSendOffer, sentTodayCount, sendAllOffers } from "../lib/mailer";
import { findLeads, browserCity } from "../lib/leads";
import { buildDossiers, scoreLabel } from "../lib/leadIntel";
import { scoreLead, signalsFromLead, learnWeightsFromOutcome, DEFAULT_WEIGHTS, type IcpScore } from "../lib/leadScoring";
import { computeRoi } from "../lib/campaignRoi";
import { leadsToCsv, followUpsDue, callNowList, searchLeads, wasLeadEmailed } from "../lib/salesEngine";
import { importLeads } from "../lib/leadImport";
import { buildLoraCorpus, corpusToJsonl } from "../lib/loraExport";
import { openSalesOs, syncFromSalesOs, pushLeadsToSalesOs, flushSalesOsOutreach, getLastSnapshot, metricsToText } from "../lib/salesOs";
import { copyWithToast, toast } from "../lib/toast";
import type { Lead, LeadStatus } from "../types";
import { useEscape } from "../hooks/useEscape";
import LeadDetail from "./LeadDetail";
import SalesPlan from "./SalesPlan";
import { leadBucket, type CrmBucket } from "../lib/crmBuckets";
import { primaryContactAction } from "../lib/salesViewModel";
import { call as deviceCall, openCompose } from "../lib/deviceControl";

const STATUS: { id: LeadStatus; label: string; color: string }[] = [
  { id: "new", label: "Nowy", color: "var(--cyan)" },
  { id: "contacted", label: "Kontakt", color: "#9b8cff" },
  { id: "offer", label: "Oferta", color: "var(--gold)" },
  { id: "won", label: "Klient ✅", color: "var(--ok, #58e08a)" },
  { id: "lost", label: "Odrzucony", color: "var(--text-dim)" },
];

// Etykiety „najlepszej następnej akcji" (ICP bestNextAction) — po polsku.
const NEXT_ACTION_LABEL: Record<IcpScore["bestNextAction"], string> = {
  research: "dozbieraj dane",
  call: "zadzwoń",
  demo: "pokaż demo strony",
  offer: "wyślij ofertę",
  reject: "odpuść",
};

/** Otwórz URL leada tylko gdy to http/https — dane leada bywają z sieci (blokuj javascript:/data:). */
function openLeadUrl(raw?: string): void {
  if (!raw) return;
  try {
    const u = new URL(raw, window.location.origin);
    if (u.protocol === "http:" || u.protocol === "https:") window.open(u.toString(), "_blank", "noopener,noreferrer");
  } catch {
    /* nieprawidłowy URL — pomiń */
  }
}

/** Parsuj liczbę z inputu zachowując 0; puste/niepoprawne → undefined. */
function numOrUndef(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function SalesDashboard({ onClose, onWeb, onMoney, embedded, bucket }: { onClose: () => void; onWeb?: (ctx?: GrowthContext) => void; onMoney?: () => void; embedded?: boolean; bucket?: CrmBucket }) {
  useEscape(onClose);
  const { data } = useStore();
  const leads = useMemo(() => data.leads || [], [data.leads]);
  const [filter, setFilter] = useState<LeadStatus | "all" | "call" | "emailed">("all");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ company: "", contact: "", value: "" });
  const [drafting, setDrafting] = useState<string>("");
  const [sending, setSending] = useState<string>("");
  const [hunting, setHunting] = useState(false);
  const [huntMsg, setHuntMsg] = useState("");
  const [niche, setNiche] = useState(store.settings.prospectNiche || "");
  const [city, setCity] = useState(store.settings.prospectLocation || "");
  const [count, setCount] = useState(store.settings.prospectCount || 15);
  const [locating, setLocating] = useState(false);
  const [huntFilter, setHuntFilter] = useState<"all" | "noweb" | "email" | "phone">("all");
  const [useWeb, setUseWeb] = useState(false);
  const [enrichEmail, setEnrichEmail] = useState(false);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");
  const [bulking, setBulking] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [syncingOs, setSyncingOs] = useState(false);
  const [osInsight, setOsInsight] = useState(() => {
    const snap = getLastSnapshot();
    return snap?.metrics ? metricsToText(snap.metrics, snap.company?.name) : "";
  });

  const doImport = () => {
    if (!importText.trim()) return;
    const r = importLeads(importText);
    setImportText("");
    setShowImport(false);
    setFilter("all");
    toast(r.added ? `Zaimportowano ${r.added} z ${r.total} leadów ✓` : "Brak nowych — wszystkie już masz na liście.");
  };

  // Licznik działań na dziś (do plakietki na przycisku planu).
  const todoCount = callNowList(leads).length + followUpsDue(leads).length;

  // Eksport leadów do pliku CSV (Excel/Arkusze Google).
  const exportCsv = () => {
    if (!leads.length) { toast("Brak leadów do eksportu."); return; }
    const csv = "﻿" + leadsToCsv(leads); // BOM → polskie znaki w Excelu
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `leady-jarvis-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Wyeksportowano ${leads.length} leadów ✓`);
  };

  // Eksport ZANONIMIZOWANEGO korpusu treningowego LoRA „Twój głos" (z Twoich ofert).
  // Trening robi serwer z GPU (server/lora); klient tylko buduje dane bez PII.
  const exportLora = () => {
    const corpus = buildLoraCorpus(leads);
    if (!corpus.length) { toast("Brak ofert do eksportu — najpierw napisz kilka cold-maili do leadów."); return; }
    const url = URL.createObjectURL(new Blob([corpusToJsonl(corpus)], { type: "application/jsonl;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `jarvis-glos-${new Date().toISOString().slice(0, 10)}.jsonl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Korpus LoRA: ${corpus.length} przykładów (zanonimizowane) ✓`);
  };

  // Teczki dla wszystkich NOWYCH leadów naraz: audyt + analiza + e-mail + skrypt.
  const bulkDossiers = async () => {
    const fresh = (store.data.leads || []).filter((l) => l.status === "new" && !l.intel?.analysis).slice(0, 10);
    if (!fresh.length) { setBulkMsg("Brak nowych leadów bez teczki — wszystko już przygotowane."); return; }
    setBulking(true);
    const ok = await buildDossiers(fresh.map((l) => l.id), (done, total) => setBulkMsg(`🧠 Przygotowuję teczki… ${done}/${total}`));
    setBulking(false);
    setBulkMsg(`✅ Gotowe ${ok}/${fresh.length} teczek — każdy lead ma audyt, analizę, e-mail i skrypt rozmowy.`);
  };

  // Masowa wysyłka ofert: do wszystkich leadów z e-mailem, którzy nie byli mailowani.
  const sendAll = async () => {
    if (!canSendDirect()) { setBulkMsg("Najpierw skonfiguruj pocztę: ⚙ → Poczta (adres + hasło aplikacji). Bez tego użyj „📧 Napisz i otwórz pocztę” przy leadzie."); return; }
    const all = store.data.leads || [];
    const withEmail = all.filter((l) => leadEmail(l));
    const targets = withEmail.filter((l) => !wasLeadEmailed(l, store.data.sentMail || []));
    if (!all.length) { setBulkMsg("Pulpit jest pusty — najpierw znajdź leady (🔎 Znajdź leady)."); return; }
    if (!withEmail.length) { setBulkMsg(`Żaden z ${all.length} leadów nie ma adresu e-mail — dodaj kontakty (klik w leada) lub znajdź firmy z e-mailem.`); return; }
    if (!targets.length) { setBulkMsg(`Wszyscy leadzi z e-mailem (${withEmail.length}) są już zmailowani. Znajdź nowych, by wysłać kolejne.`); return; }
    const cap = Math.min(25, targets.length);
    if (!window.confirm(`Wysłać ofertę do ${cap} leadów (z e-mailem, jeszcze niemailowanych)?\n\nMaks. 25 na turę. Każdy dostanie spersonalizowaną ofertę.`)) return;
    setBulking(true);
    setBulkMsg(`📤 Wysyłam oferty… (do ${cap})`);
    const r = await sendAllOffers(cap, (done, total) => setBulkMsg(`📤 Wysyłam… ${done}/${total}`));
    setBulking(false);
    const parts = [`✅ Wysłano ${r.sent}.`];
    if (r.alreadyEmailed) parts.push(`pominięto ${r.alreadyEmailed} mailowanych`);
    if (r.noEmail) parts.push(`${r.noEmail} bez e-maila`);
    if (r.failed) parts.push(`⚠ nieudane ${r.failed}`);
    setBulkMsg(parts.join(" · ") + " — szczegóły w 📤 Skrzynce wysłanych.");
  };

  // „Znajdź leady" — od ręki, prosto z pulpitu. Darmowe (OpenStreetMap), z
  // telefonami. Nisza i miasto są OPCJONALNE (bez miasta użyje lokalizacji).
  // 📍 Wykryj miasto z lokalizacji — żeby szukać bez wpisywania nazwy miejscowości.
  const locate = async () => {
    setLocating(true);
    setHuntMsg("📍 Ustalam lokalizację…");
    const found = await browserCity().catch(() => null);
    setLocating(false);
    if (found) { setCity(found); store.setSettings({ prospectLocation: found }); setHuntMsg(`📍 Wykryto: ${found}. Klik „Znajdź leady”.`); }
    else setHuntMsg("Nie udało się ustalić lokalizacji — wpisz miasto albo zezwól na lokalizację w przeglądarce.");
  };

  const hunt = async () => {
    const n = Math.min(50, Math.max(3, count || 15));
    store.setSettings({ prospectNiche: niche.trim(), prospectCount: n, ...(city.trim() ? { prospectLocation: city.trim() } : {}) });
    setHunting(true);
    const fLabel = { all: "firm w okolicy", noweb: "firm BEZ strony", email: "firm z e-mailem", phone: "firm z telefonem" }[huntFilter];
    setHuntMsg(`🔎 Szukam ${n} ${fLabel}${useWeb ? " (+ sieć)" : ""}${enrichEmail ? " (+ e-maile ze stron)" : ""}…`);
    const r = await findLeads({
      niche: niche.trim() || undefined,
      location: city.trim() || undefined,
      count: n,
      onlyNoWebsite: huntFilter === "noweb",
      onlyWithEmail: huntFilter === "email",
      onlyWithPhone: huntFilter === "phone",
      useWeb,
      enrichEmail,
    });
    setHunting(false);
    if (r.error) {
      setHuntMsg(`⚙ ${r.error}`);
    } else if (r.added > 0) {
      setHuntMsg(`✅ Znalazłem ${r.found} firm w ${r.city} i dodałem ${r.added} nowych. Są na liście.`);
      setFilter("all");
    } else {
      setHuntMsg(`Znalazłem ${r.found} firm w ${r.city}, ale wszystkie już masz na liście.`);
    }
  };

  const writeOffer = async (l: Lead) => {
    setDrafting(l.id);
    try {
      const offer = await draftOffer(l);
      if (offer)
        store.setData((d) => {
          const x = d.leads.find((y) => y.id === l.id);
          if (x) { x.offer = offer; if (x.status === "new") x.status = "offer"; x.updatedAt = Date.now(); }
        });
      else toast("Nie udało się napisać oferty — sprawdź klucz AI (⚙ → AI) i spróbuj ponownie.");
    } finally {
      setDrafting(""); // zawsze odblokuj stan, nawet gdy draftOffer rzuci wyjątek
    }
  };
  // E-mail leada: najpierw dedykowane pole `email` (z OSM/strony), w razie braku — `contact`.
  // To naprawia „nie wysyła się z tego miejsca": adres bywał w `email`, a kod patrzył tylko na `contact`.
  const leadEmail = (l: Lead): string => {
    const e = (l.email || "").trim();
    if (e.includes("@")) return e;
    const c = (l.contact || "").trim();
    return c.includes("@") ? c : "";
  };

  // Gdy automatyczna wysyłka nie jest skonfigurowana — i tak da się wysłać: napisz ofertę
  // (jeśli brak) i otwórz gotową wiadomość w domyślnej poczcie (mailto). Zawsze działa.
  const writeAndOpenMail = async (l: Lead) => {
    const to = leadEmail(l);
    if (!to) { toast("Ten lead nie ma adresu e-mail — dodaj go w 🗂 Teczce."); return; }
    let offer = l.offer;
    if (!offer) {
      setDrafting(l.id);
      try {
        offer = await draftOffer(l);
      } finally {
        setDrafting(""); // zawsze odblokuj, nawet gdy draftOffer rzuci wyjątek
      }
      if (offer) store.setData((d) => { const x = d.leads.find((y) => y.id === l.id); if (x) { x.offer = offer; if (x.status === "new") x.status = "offer"; x.updatedAt = Date.now(); } });
    }
    const { subject, body } = splitOffer(offer || "", `Oferta dla ${l.company}`, store.settings.emailSignature);
    window.open(`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank");
  };

  // GŁÓWNA akcja kontaktowa zależna od danych: telefon → dzwoń, e-mail → napisz, brak → znajdź kontakt.
  const doPrimary = async (l: Lead) => {
    const a = primaryContactAction(l);
    if (a.kind === "call") { toast(await deviceCall(a.value)); }
    else if (a.kind === "email") { toast(await openCompose(a.value, `Współpraca — ${l.company}`, "Dzień dobry,\n\n")); }
    else { window.open(`https://www.google.com/search?q=${encodeURIComponent(`${l.company} kontakt telefon e-mail`)}`, "_blank", "noopener"); toast("🔎 Szukam kontaktu w sieci…"); }
  };

  const sendOffer = (l: Lead) => {
    const { subject, body } = splitOffer(l.offer || "", `Oferta dla ${l.company}`, store.settings.emailSignature);
    const to = leadEmail(l);
    window.open(`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank");
  };

  // „Napisz i wyślij" — jedno kliknięcie: JARVIS pisze ofertę (jeśli brak), dopisuje
  // podpis i wysyła sam (SMTP/Gmail). Użytkownik tylko potwierdza adresata.
  const writeAndSend = async (l: Lead) => {
    const to = leadEmail(l);
    if (!to) { toast("Ten lead nie ma adresu e-mail — dodaj go w 🗂 Teczce, żeby wysłać."); return; }
    setSending(l.id);
    const r = await draftAndSendOffer(l, to);
    setSending("");
    if (r.offer && r.offer !== l.offer) {
      store.setData((d) => {
        const x = d.leads.find((y) => y.id === l.id);
        if (x) { x.offer = r.offer; x.updatedAt = Date.now(); }
      });
    }
    if (!r.ok) { toast(`Nie wysłano: ${r.error}`); return; }
    toast(`✅ Mail wysłany do ${to} (${r.via}) — zapisano w 📤 Skrzynce wysłanych`);
    store.setData((d) => {
      const x = d.leads.find((y) => y.id === l.id);
      if (x) { if (x.status === "new" || x.status === "contacted") x.status = "offer"; x.updatedAt = Date.now(); }
    });
  };

  const setStatus = (id: string, status: LeadStatus) =>
    store.setData((d) => {
      const l = d.leads.find((x) => x.id === id);
      if (l) {
        // Uczymy wagi ICP WYŁĄCZNIE z potwierdzonych wyników (won/lost) — nigdy z domysłów.
        if ((status === "won" || status === "lost") && l.status !== status) {
          const signals = signalsFromLead(l, Date.now());
          d.scoringWeights = learnWeightsFromOutcome(d.scoringWeights ?? DEFAULT_WEIGHTS, signals, status === "won");
        }
        l.status = status;
        l.updatedAt = Date.now();
      }
    });
  const setField = (id: string, patch: Partial<Lead>) =>
    store.setData((d) => {
      const l = d.leads.find((x) => x.id === id);
      if (l) Object.assign(l, patch, { updatedAt: Date.now() });
    });
  const del = (id: string) => {
    if (!window.confirm("Usun\u0105\u0107 ten lead (razem z ofert\u0105)?")) return;
    store.setData((d) => { d.leads = d.leads.filter((x) => x.id !== id); });
  };

  const add = () => {
    const c = form.company.trim();
    if (!c) return;
    if (leads.some((l) => l.company.trim().toLowerCase() === c.toLowerCase())) {
      toast(`„${c}" jest już na liście.`);
      return;
    }
    store.setData((d) =>
      d.leads.unshift({ id: uid(), company: c, contact: form.contact.trim() || undefined, value: numOrUndef(form.value), status: "new", createdAt: Date.now(), updatedAt: Date.now() }),
    );
    setForm({ company: "", contact: "", value: "" });
    toast(`➕ Dodano: ${c}`);
  };

  const stats = useMemo(() => {
    const won = leads.filter((l) => l.status === "won");
    const pipeline = leads.filter((l) => l.status !== "lost" && l.status !== "won");
    return {
      total: leads.length,
      won: won.length,
      earned: won.reduce((s, l) => s + (l.value || 0), 0),
      potential: pipeline.reduce((s, l) => s + (l.value || 0), 0),
    };
  }, [leads]);

  // Gorące leady (wysoki score z teczki) na górze — wiesz, do kogo dzwonić najpierw.
  const sent = useMemo(() => data.sentMail || [], [data.sentMail]);
  // Liczniki CRM (pytania szefa): klienci / do dzwonienia / mailowani / odrzuceni.
  const crm = useMemo(() => ({
    call: leads.filter((l) => l.status === "new" || l.status === "contacted").length,
    emailed: leads.filter((l) => wasLeadEmailed(l, sent)).length,
    won: leads.filter((l) => l.status === "won").length,
    lost: leads.filter((l) => l.status === "lost").length,
  }), [leads, sent]);

  // Ilu leadów dostanie ofertę przy masowej wysyłce: z e-mailem i jeszcze niemailowanych.
  const mailTargets = useMemo(
    () => leads.filter((l) => leadEmail(l) && !wasLeadEmailed(l, sent)).length,
    [leads, sent],
  );

  // 🎯 Następny ruch — wyjaśnialna rekomendacja ICP: najlepszy aktywny lead + co z nim zrobić.
  // To produkcyjny konsument leadScoring: wpływa na to, co JARVIS podpowiada robić najpierw.
  const nextMove = useMemo(() => {
    const now = Date.now();
    let best: { l: Lead; icp: IcpScore } | null = null;
    for (const l of leads) {
      if (l.status === "won" || l.status === "lost") continue;
      const icp = scoreLead(signalsFromLead(l, now), data.scoringWeights);
      if (icp.bestNextAction === "reject") continue;
      if (!best || icp.score > best.icp.score) best = { l, icp };
    }
    return best;
  }, [leads, data.scoringWeights]);

  // 💸 ROI z realnego store: przychód wygranych leadów przypisany do kampanii (po wspólnym ID).
  // To produkcyjny konsument growthAttribution — liczy z prawdziwych kampanii i leadów, nie z liczby treści.
  const campaigns = useMemo(() => data.campaigns || [], [data.campaigns]);
  const roi = useMemo(() => computeRoi(campaigns, leads, Date.now()), [campaigns, leads]);

  const shown = useMemo(() => {
    // Zakładka CRM (kubełek) to filtr NADRZĘDNY: Do działania / Klienci / Archiwum.
    const inBucket = bucket ? leads.filter((l) => leadBucket(l) === bucket) : leads;
    const match = (l: Lead) =>
      filter === "all" ? true
      : filter === "call" ? (l.status === "new" || l.status === "contacted")
      : filter === "emailed" ? wasLeadEmailed(l, sent)
      : l.status === filter;
    const base = searchLeads(inBucket.filter(match), query);
    return [...base].sort((a, b) => (b.intel?.score ?? -1) - (a.intel?.score ?? -1));
  }, [leads, filter, query, sent, bucket]);
  const copy = (t?: string) => t && copyWithToast(t);

  const modals = (
    <>
      {openLead && <LeadDetail leadId={openLead} onClose={() => setOpenLead(null)} onWeb={onWeb} />}
      {showPlan && <SalesPlan onClose={() => setShowPlan(false)} onLead={(id) => { setShowPlan(false); setOpenLead(id); }} />}
    </>
  );

  const inner = (
    <>
        <div className="panel-body">
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontFamily: "Orbitron", color: "var(--gold)" }}>{stats.potential} zł</div>
              <div className="muted" style={{ fontSize: 11 }}>potencjał w toku</div>
            </div>
            <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontFamily: "Orbitron", color: "var(--ok, #58e08a)" }}>{stats.earned} zł</div>
              <div className="muted" style={{ fontSize: 11 }}>zarobione ({stats.won})</div>
            </div>
            <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontFamily: "Orbitron", color: "var(--cyan, #6ce7ff)" }}>{sentTodayCount(data.sentMail || [])}</div>
              <div className="muted" style={{ fontSize: 11 }}>✉ wysłane dziś</div>
            </div>
          </div>

          {/* 🎯 Następny ruch — wyjaśnialna rekomendacja ICP (score + powód + akcja). Klik → teczka. */}
          {nextMove && (
            <div
              onClick={() => setOpenLead(nextMove.l.id)}
              style={{ cursor: "pointer", marginBottom: 10, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--cyan, #6ce7ff)", background: "color-mix(in srgb, var(--cyan, #6ce7ff) 8%, transparent)" }}
              title={`Pewność ${Math.round(nextMove.icp.confidence * 100)}%${nextMove.icp.topReasons.length ? " · " + nextMove.icp.topReasons.join(", ") : ""}`}
            >
              <div style={{ fontSize: 13 }}>
                🎯 Następny ruch: <b>{NEXT_ACTION_LABEL[nextMove.icp.bestNextAction]}</b> — {nextMove.l.company}
                <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>ICP {nextMove.icp.score}/100</span>
              </div>
              {nextMove.icp.topReasons.length > 0 && (
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{nextMove.icp.topReasons.map((r) => "✓ " + r).join("  ")}</div>
              )}
            </div>
          )}

          {/* 💸 ROI kampanii — z realnego store: przychód wygranych leadów przypięty do kampanii. */}
          {campaigns.length > 0 && (
            <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--line, #2a2a2a)" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>💸 ROI kampanii ({campaigns.length})</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                Przypisany przychód: <b style={{ color: "var(--ok, #58e08a)" }}>{roi.attribution.total} zł</b>
                {roi.attribution.unattributed > 0 && <> · nieprzypisane: {roi.attribution.unattributed} zł</>}
              </div>
              {roi.byCampaignNamed.slice(0, 3).map((c) => (
                <div key={c.id} className="muted" style={{ fontSize: 11, marginTop: 2 }}>• {c.name}: {c.revenue} zł</div>
              ))}
              {roi.recommendation.variant && <div style={{ fontSize: 11, marginTop: 3, color: "var(--cyan, #6ce7ff)" }}>🏆 {roi.recommendation.reason}</div>}
            </div>
          )}

          {/* Szukanie leadów — wszystko z pulpitu, bez wchodzenia do ustawień. Na wąskich ekranach
              (Samsung S9) pola nisza/miasto układają się PIONOWO (klasa hunt-fields — bez poziomego ścisku). */}
          <div className="field hunt-fields">
            <input value={niche} placeholder="Nisza — opcjonalnie (np. fryzjer)" onChange={(e) => setNiche(e.target.value)} />
            <input value={city} placeholder="Miasto — opcjonalnie (📍 lub auto)" onChange={(e) => setCity(e.target.value)} />
            <button className="btn hunt-locate" style={{ width: "auto", marginTop: 0, padding: "0 12px" }} onClick={locate} disabled={locating} title="Użyj mojej lokalizacji">
              {locating ? "📍…" : "📍"}
            </button>
          </div>
          <div className="row" style={{ marginBottom: 8, gap: 8 }}>
            <span style={{ fontSize: 13, whiteSpace: "nowrap" }}>🔢 Ile na raz: <b>{count}</b></span>
            <input type="range" min={3} max={50} step={1} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ flex: 1 }} />
          </div>
          {/* Filtr kanałowy — pod sposób kontaktu (skuteczność kampanii) */}
          <div className="chips" style={{ flexWrap: "wrap", marginBottom: 6 }}>
            {([
              { id: "all", l: "Wszystkie" },
              { id: "noweb", l: "🌐 Bez strony" },
              { id: "email", l: "✉ Z e-mailem" },
              { id: "phone", l: "☎ Z telefonem" },
            ] as const).map((f) => (
              <button key={f.id} className={`chip ${huntFilter === f.id ? "on" : ""}`} onClick={() => setHuntFilter(f.id)} disabled={hunting}>{f.l}</button>
            ))}
          </div>
          <label className="row" style={{ cursor: "pointer", marginBottom: 6 }}>
            <span style={{ fontSize: 13 }}>🔎 Wzbogać o wyniki z <b>sieci</b> (łapie firmy spoza map; wymaga klucza Tavily)</span>
            <input type="checkbox" checked={useWeb} onChange={(e) => setUseWeb(e.target.checked)} />
          </label>
          <label className="row" style={{ cursor: "pointer", marginBottom: 8 }}>
            <span style={{ fontSize: 13 }}>✉ Wyłuskaj <b>e-mail ze strony</b> firmy (gdy ma www, brak maila) — pod cold-mailing</span>
            <input type="checkbox" checked={enrichEmail} onChange={(e) => setEnrichEmail(e.target.checked)} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={hunt} disabled={hunting}>
              {hunting ? "🔎 Szukam…" : "🔎 Znajdź leady"}
            </button>
            {onWeb && (
              <button className="btn" style={{ flex: 1 }} onClick={() => onWeb()}>🌐 Zbuduj demo</button>
            )}
          </div>
          {onMoney && (
            <button className="btn" style={{ marginTop: 8 }} onClick={onMoney}>💰 Centrum Zarabiania</button>
          )}
          {huntMsg && <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{huntMsg}</p>}

          {/* Masowa wysyłka jednym kliknięciem — od razu widoczna na górze Pulpitu. */}
          <button
            className="btn primary"
            style={{ width: "100%", marginTop: 8, borderColor: "var(--ok, #58e08a)" }}
            onClick={sendAll}
            disabled={bulking}
            title="Wyślij spersonalizowaną ofertę do wszystkich leadów z e-mailem, którzy nie byli jeszcze mailowani"
          >
            {bulking ? "📤 Wysyłam…" : `📨 Wyślij oferty do wszystkich${mailTargets ? ` (${mailTargets})` : ""}`}
          </button>
          {bulkMsg && <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{bulkMsg}</p>}

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={() => setShowPlan(true)}>
              🎯 Plan na dziś{todoCount ? ` (${todoCount})` : ""}
            </button>
            <button className="btn" onClick={() => setShowImport((v) => !v)} title="Wklej listę firm">📥 Import</button>
            <button className="btn" onClick={exportCsv} title="Eksport do Excela/Arkuszy">📤 CSV</button>
            <button className="btn" onClick={exportLora} title="Dane treningowe LoRA Twój głos (zanonimizowane)">🧠 Trening</button>
          </div>
          {(store.settings.salesOsUrl || "").trim() && (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => { if (!openSalesOs()) toast("Najpierw podaj adres AI Sales OS (⚙ → Integracje)."); }} title="Otwórz osobną aplikację AI Sales OS">
                🚀 Sales OS
              </button>
              <button
                className="btn"
                style={{ flex: 1 }}
                disabled={syncingOs}
                onClick={async () => { setSyncingOs(true); const r = await syncFromSalesOs(); setSyncingOs(false); toast(r.message); const snap = getLastSnapshot(); if (snap?.metrics) setOsInsight(metricsToText(snap.metrics, snap.company?.name)); if (r.added) setFilter("all"); }}
                title="Pobierz leady z AI Sales OS (read-only)"
              >
                {syncingOs ? "⏳ Sync…" : "⬇ Sync z Sales OS"}
              </button>
              <button
                className="btn"
                style={{ flex: 1 }}
                disabled={syncingOs}
                onClick={async () => { setSyncingOs(true); const r = await pushLeadsToSalesOs(); setSyncingOs(false); toast(r.message); }}
                title="Odeślij świeże leady do AI Sales OS (źródła prawdy)"
              >
                📤 Do Sales OS
              </button>
              <button
                className="btn"
                style={{ flex: 1 }}
                disabled={syncingOs}
                onClick={async () => { setSyncingOs(true); const r = await flushSalesOsOutreach(); setSyncingOs(false); toast(r.message); }}
                title="Sales OS pisze (AI) i auto-wysyła zaległe maile z kolejki"
              >
                ✉ Auto-wyślij maile
              </button>
            </div>
          )}
          {osInsight && (
            <div className="muted" style={{ marginTop: 8, fontSize: 13, padding: "6px 10px", border: "1px solid var(--line, #2a2a2a)", borderRadius: 8 }}>
              {osInsight}
            </div>
          )}
          {showImport && (
            <div style={{ marginTop: 8 }}>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={"Wklej listę firm — jedna na linię, albo z danymi:\nSalon Ola, 600100200, biuro@ola.pl, Kraków\nWarsztat Marek; 501502503; Wrocław"}
                className="ta" style={{ minHeight: "14vh", fontSize: 13 }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary" style={{ flex: 1 }} onClick={doImport}>✅ Importuj</button>
                <button className="btn" onClick={() => { setShowImport(false); setImportText(""); }}>Anuluj</button>
              </div>
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Rozpoznaję telefon, e-mail, stronę i miasto automatycznie. Obsługuję też CSV z nagłówkiem (Firma, Telefon, E-mail, Miasto).
              </p>
            </div>
          )}
          <button className="btn" style={{ marginTop: 8 }} onClick={bulkDossiers} disabled={bulking}>
            {bulking ? "🧠 Pracuję…" : "🧠 Teczki dla wszystkich nowych (audyt + analiza + e-maile)"}
          </button>

          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            <b>Kliknij firmę</b>, by otworzyć teczkę klienta: pełne dane, audyt strony, analizę AI
            słabych punktów, spersonalizowany e-mail i skrypt rozmowy. Gorące leady 🔥 lądują na górze.
          </p>

          {leads.length > 8 && (
            <input
              className="ta"
              style={{ minHeight: 0, padding: "8px 10px", margin: "4px 0 8px" }}
              placeholder="🔎 szukaj w leadach (firma, kontakt, miasto, notatka)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {/* CRM — szybkie kubełki (semantyczne przyciski, dostępne z klawiatury i czytnika ekranu) */}
          <div className="chips" style={{ flexWrap: "wrap", margin: "4px 0 4px" }}>
            {([
              { id: "all", label: `wszyscy (${leads.length})` },
              { id: "won", label: `✅ Klienci (${crm.won})` },
              { id: "call", label: `📞 Do dzwonienia (${crm.call})` },
              { id: "emailed", label: `✉ Mailowani (${crm.emailed})` },
              { id: "lost", label: `❌ Odrzucili (${crm.lost})` },
            ] as const).map((f) => (
              <button key={f.id} type="button" className={`chip ${filter === f.id ? "on" : ""}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
            ))}
          </div>
          {/* Pełne statusy (etap lejka) */}
          <div className="chips" style={{ flexWrap: "wrap", margin: "0 0 8px" }}>
            {STATUS.map((s) => (
              <button key={s.id} type="button" className={`chip ${filter === s.id ? "on" : ""}`} aria-pressed={filter === s.id} onClick={() => setFilter(s.id)} style={{ fontSize: 12 }}>
                {s.label} ({leads.filter((l) => l.status === s.id).length})
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="muted" style={{ textAlign: "center", padding: "16px 0" }}>Brak leadów do pokazania. Zmień filtr powyżej albo kliknij „🔎 Znajdź leady”, aby dodać firmy (za darmo, z OpenStreetMap).</p>
          ) : (
            shown.map((l) => (
              <div key={l.id} className="journal-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                  <b style={{ cursor: "pointer", minWidth: 0 }} onClick={() => setOpenLead(l.id)}>
                    {l.intel ? `${scoreLabel(l.intel.score).emoji} ` : ""}{l.company}
                    {l.origin === "salesos" && (
                      <span className="chip" style={{ marginLeft: 6, fontSize: 11, color: "var(--gold)", padding: "1px 8px" }} title="Zsynchronizowany z AI Sales OS">🔗 CRM</span>
                    )}
                    {wasLeadEmailed(l, data.sentMail || []) && (
                      <span className="chip" style={{ marginLeft: 6, fontSize: 11, color: "var(--ok, #58e08a)", padding: "1px 8px" }}>✉ wysłano</span>
                    )}
                  </b>
                  <button type="button" className="x" aria-label="Usuń leada" title="Usuń leada" style={{ cursor: "pointer", flexShrink: 0 }} onClick={() => del(l.id)}>✕</button>
                </div>
                {(l.niche || l.location) && <div className="muted" style={{ fontSize: 12 }}>{[l.niche, l.location].filter(Boolean).join(" · ")}{l.intel ? ` · szansa ${l.intel.score}/100` : ""}</div>}
                {l.note && <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>{l.note}</p>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, alignItems: "center" }}>
                  <select
                    value={l.status}
                    onChange={(e) => setStatus(l.id, e.target.value as LeadStatus)}
                    style={{ width: "auto", padding: "4px 8px", borderRadius: 8, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", fontSize: 13 }}
                  >
                    {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                  <input
                    type="number"
                    value={l.value ?? ""}
                    placeholder="zł"
                    onChange={(e) => setField(l.id, { value: numOrUndef(e.target.value) })}
                    style={{ width: 70, padding: "4px 8px", borderRadius: 8, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", fontSize: 13 }}
                  />
                  {campaigns.length > 0 && (
                    <select
                      value={l.campaignId || ""}
                      onChange={(e) => setField(l.id, { campaignId: e.target.value || undefined })}
                      title="Przypisz lead do kampanii — przychód wygranej trafi do ROI (bez przepisywania ID)"
                      style={{ width: "auto", padding: "4px 8px", borderRadius: 8, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", fontSize: 12 }}
                    >
                      <option value="">— kampania —</option>
                      {campaigns.map((c) => <option key={c.id} value={c.id}>{c.offer.slice(0, 24)}</option>)}
                    </select>
                  )}
                  {/* GŁÓWNA akcja kontaktowa (z danych) — wyróżniona; kopiowanie zostaje drugorzędne. */}
                  <button type="button" className="chip" style={{ borderColor: "var(--cyan, #6ce7ff)", fontWeight: 600 }} onClick={() => void doPrimary(l)}>{primaryContactAction(l).label}</button>
                  <button type="button" className="chip" onClick={() => setOpenLead(l.id)}>🗂 Szczegóły klienta</button>
                  {l.url && <button type="button" className="chip" onClick={() => openLeadUrl(l.url)}>🌐 WWW</button>}
                  {l.contact && <button type="button" className="chip" onClick={() => copy(l.contact)}>📋 Kopiuj kontakt</button>}
                  <button className="chip" onClick={() => writeOffer(l)} disabled={drafting === l.id}>
                    {drafting === l.id ? "✍ Piszę…" : l.offer ? "✍ Napisz ponownie" : "✍ Szkic oferty"}
                  </button>
                  {leadEmail(l) ? (
                    canSendDirect() ? (
                      <button
                        className="chip"
                        style={{ borderColor: "var(--ok, #58e08a)", fontWeight: 600 }}
                        onClick={() => writeAndSend(l)}
                        disabled={sending === l.id}
                      >
                        {sending === l.id ? "📨 Wysyłam…" : "📨 Napisz i wyślij"}
                      </button>
                    ) : (
                      <button
                        className="chip"
                        style={{ borderColor: "var(--gold)", fontWeight: 600 }}
                        onClick={() => writeAndOpenMail(l)}
                        disabled={drafting === l.id}
                        title="Automatyczna wysyłka nie jest skonfigurowana — otworzę gotową wiadomość w Twojej poczcie"
                      >
                        {drafting === l.id ? "✍ Piszę…" : "📧 Napisz i otwórz pocztę"}
                      </button>
                    )
                  ) : (
                    <button className="chip" onClick={() => toast("Ten lead nie ma adresu e-mail — dodaj go w 🗂 Teczce, żeby wysłać ofertę.")}>
                      📧 Brak e-maila
                    </button>
                  )}
                </div>
                {l.offer && (
                  <div style={{ marginTop: 8, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}>
                    <p className="muted" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 13 }}>{l.offer}</p>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <button className="chip" onClick={() => copy(l.offer)}>📋 Kopiuj ofertę</button>
                      <button className="chip" onClick={() => sendOffer(l)}>📧 Otwórz w poczcie</button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          <h3 style={{ marginTop: 14 }}>➕ Dodaj ręcznie</h3>
          <div className="field" style={{ display: "flex", gap: 8 }}>
            <input value={form.company} placeholder="Firma" onChange={(e) => setForm({ ...form, company: e.target.value })} style={{ flex: 2 }} />
            <input type="number" value={form.value} placeholder="zł" onChange={(e) => setForm({ ...form, value: e.target.value })} style={{ flex: 1 }} />
          </div>
          <div className="field"><input value={form.contact} placeholder="Kontakt (e-mail/tel.)" onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
          <button className="btn primary" onClick={add}>💾 Dodaj lead</button>
        </div>
    </>
  );

  // Osadzony w ekranie „Sprzedaż / CRM" (zakładki) — bez własnego sheet/nagłówka/stopki.
  if (embedded) return <>{inner}{modals}</>;

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>📈 Pulpit Sprzedaży</h2>
        </div>
        {inner}
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
      {modals}
    </div>
  );
}
