import { useEffect, useRef, useState } from "react";
import { desktop, nativeSkillCommand, releaseNativeSkillTask, type NativeSkillRecord, type NativeSkillResponse } from "../lib/desktop";

/** The existing Integrations screen owns the UI; native dialogs own policy decisions. */
export function SkillsManager() {
  const [snapshot, setSnapshot] = useState<NativeSkillResponse | null>(null);
  const [candidates, setCandidates] = useState<Array<Record<string, unknown>> | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const activeSkillOperation = useRef<AbortController | null>(null);
  const browserEpoch = useRef(0);
  const [localRoot, setLocalRoot] = useState("");
  const [source, setSource] = useState("");
  const [codeKind, setCodeKind] = useState("instructions");
  const [permissions, setPermissions] = useState("");
  const [licenses, setLicenses] = useState("MIT, Apache-2.0");
  const [policyOpen, setPolicyOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  const [allowLocal, setAllowLocal] = useState(false);
  const [interact, setInteract] = useState(false);
  const [download, setDownload] = useState(false);
  const [browserState, setBrowserState] = useState<Record<string, unknown> | null>(null);
  const refresh = async () => setSnapshot(await nativeSkillCommand({ action: "list" }));
  useEffect(() => { if (desktop()?.skillCommand) void refresh().catch(error => setResult({ error: String(error) })); }, []);
  useEffect(() => () => { activeSkillOperation.current?.abort(); }, []);
  const run = async (request: Record<string, unknown>) => {
    const controller = new AbortController(); activeSkillOperation.current = controller;
    setBusy(true);
    try { const response = await nativeSkillCommand(request, controller.signal); setResult(response); if (response.candidates) setCandidates(response.candidates); await refresh(); }
    catch (error) { setResult({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
    finally { await releaseNativeSkillTask(controller.signal); activeSkillOperation.current = null; setBusy(false); }
  };
  const policyFor = (skill: NativeSkillRecord) => {
    setSource(skill.source.kind === "authored" ? "jarvis:self" : skill.source.repo || `local:${skill.source.localRoot}`);
    setCodeKind(skill.codeKind); setPermissions(skill.permissions.join(", ")); setLicenses(skill.license);
    setPolicyOpen(true);
  };
  const policy = async (enabled: boolean) => {
    setBusy(true);
    try {
      const parse = (value: string) => value.split(",").map(item => item.trim()).filter(Boolean);
      setResult(await desktop()?.skillPolicy?.({ source: source.trim(), codeKinds: [codeKind], permissions: parse(permissions), licenses: parse(licenses), enabled }));
      await refresh();
    } catch (error) { setResult({ error: String(error) }); }
    finally { setBusy(false); }
  };
  const browser = async (request: Record<string, unknown>) => {
    const epoch = ++browserEpoch.current;
    setBusy(true);
    try { const response = await desktop()?.browserCommand?.(request) || { ok: false, error: "Wymagana aplikacja desktopowa." }; if (epoch === browserEpoch.current) setBrowserState(response); }
    catch (error) { if (epoch === browserEpoch.current) setBrowserState({ ok: false, error: String(error) }); }
    finally { if (epoch === browserEpoch.current) setBusy(false); }
  };
  const grants = Array.isArray(browserState?.grants) ? browserState.grants as Array<{ origin: string; actions: string[] }> : [];
  return <>
    <details className="settings-section">
      <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>Umiejętności JARVIS</summary>
      <p>Przeglądaj źródło, wersję, licencję i test przed aktywacją. Instrukcje są procedurą dla agenta. Kod działa tylko po sprawdzeniu izolacji systemowej. Brak zgodnego środowiska blokuje wykonanie.</p>
      {!desktop()?.skillCommand && <p role="status">Menedżer wymaga aktualnej aplikacji desktopowej.</p>}
      <fieldset disabled={busy || !desktop()?.skillCommand} style={{ border: 0, padding: 0 }}>
        <label>Potrzebna możliwość<input value={query} onChange={event => setQuery(event.target.value)} placeholder="np. analiza arkusza" /></label>
        <button type="button" onClick={() => void run({ action: "search", query })}>Szukaj umiejętności</button>{" "}
        <button type="button" onClick={() => void run({ action: "search", query, refresh: true })}>Sprawdź nowe wersje</button>{" "}
        <button type="button" onClick={() => void run({ action: "list" })}>Odśwież stan</button>
        <p>Zapytanie służy do lokalnego rankingu katalogu. Repozytoria publiczne otrzymują tylko odczyt katalogu, bez treści rozmowy.</p>
        {(candidates || snapshot?.candidates || []).map(candidate => <article key={String(candidate.candidateId)} style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
          <strong>{String(candidate.publisher)}/{String(candidate.name)}</strong> · {String(candidate.version)} · {String(candidate.license)}
          <p>{String(candidate.description)}</p>
          <button type="button" onClick={() => void run({ action: "inspect", candidateId: candidate.candidateId })}>Zobacz instrukcje i licencję</button>{" "}
          <button type="button" onClick={() => void run({ action: "stage", candidateId: candidate.candidateId })}>Dodaj do kwarantanny</button>
        </article>)}
        {snapshot?.skills?.map(skill => <article key={skill.id} style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
          <strong>{skill.id}</strong> · {skill.state} · {skill.codeKind}
          <p>{skill.description}</p>
          <small>Źródło: {skill.source.kind === "authored" ? "jarvis:self" : skill.source.repo || skill.source.localRoot} · commit: {skill.source.commit || "lokalny"}<br />SHA-256: {skill.hash}<br />Licencja: {skill.license}<br />Uprawnienia: {skill.permissions.join(", ") || "brak"}</small>
          <p>Test: {skill.test && typeof skill.test === "object" ? String((skill.test as Record<string, unknown>).status || "sprawdź dowody") : "jeszcze niewykonany"}</p>
          {skill.test != null && <details><summary>Dowody i zakres testu</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(skill.test, null, 2)}</pre></details>}
          <button type="button" onClick={() => policyFor(skill)}>Ustaw zakres dla tego źródła</button>{" "}
          {(["test", "activate", "disable", "revoke", "remove"] as const).map((action, index) => <button key={action} type="button" onClick={() => void run({ action, id: skill.id })}>{["Testuj", "Aktywuj", "Wyłącz", "Cofnij zgodę wersji", "Usuń"][index]}</button>)}
          {snapshot.skills?.filter(previous => previous.id !== skill.id && previous.publisher === skill.publisher && previous.name === skill.name).map(previous => <button key={previous.id} type="button" onClick={() => void run({ action: "rollback", id: skill.id, targetId: previous.id })}>Wróć do {previous.version}</button>)}
        </article>)}
        <details open={policyOpen} onToggle={event => setPolicyOpen(event.currentTarget.open)}><summary>Polityka właściciela i lokalny projekt</summary>
          <p>Akceptacja jest zapamiętywana tylko dla wskazanego źródła, rodzaju kodu, licencji i uprawnień. Potwierdzisz ją w oknie systemowym.</p>
          <label>Źródło<input value={source} onChange={event => setSource(event.target.value)} placeholder="wydawca/repo, local:/pełna/ścieżka albo jarvis:self" /></label>
          <label>Rodzaj<select value={codeKind} onChange={event => setCodeKind(event.target.value)}><option value="instructions">Instrukcje</option><option value="executable">Kod wykonywalny</option></select></label>
          <label>Żądane uprawnienia, oddzielone przecinkami<input value={permissions} onChange={event => setPermissions(event.target.value)} /></label>
          <label>Akceptowane licencje<input value={licenses} onChange={event => setLicenses(event.target.value)} /></label>
          <button type="button" onClick={() => void policy(true)}>Zatwierdź zakres</button>{" "}<button type="button" onClick={() => void policy(false)}>Cofnij politykę źródła</button>
          <label>Katalog projektu z SKILL.md<input value={localRoot} onChange={event => setLocalRoot(event.target.value)} placeholder="/pełna/ścieżka" /></label>
          <button type="button" onClick={() => void run({ action: "scan", path: localRoot })}>Skanuj zatwierdzony katalog</button>
        </details>
      </fieldset>
      <button type="button" disabled={!activeSkillOperation.current} onClick={() => activeSkillOperation.current?.abort()}>Zatrzymaj operację umiejętności</button>
      {busy && <p role="status">Trwa operacja…</p>}
      {result != null && <pre aria-label="Wynik operacji umiejętności" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 360, overflow: "auto" }}>{JSON.stringify(result, null, 2)}</pre>}
    </details>
    <details className="settings-section">
      <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>Przeglądarka JARVIS</summary>
      <p>Oddzielny profil do pracy agenta. Wymaga istniejącego Chromium; aplikacja nie pobiera go automatycznie. Zgoda dotyczy konkretnego serwisu. Wysyłkę formularza zatwierdzasz osobno.</p>
      <fieldset disabled={busy || !desktop()?.browserGrant} style={{ border: 0, padding: 0 }}>
        <label>Serwis (origin)<input value={origin} onChange={event => setOrigin(event.target.value)} placeholder="https://example.org" /></label>
        <label><input type="checkbox" checked={interact} onChange={event => setInteract(event.target.checked)} /> Wypełnianie pól i klikanie</label>
        <label><input type="checkbox" checked={download} onChange={event => setDownload(event.target.checked)} /> Pobieranie do katalogu JARVIS</label>
        <label><input type="checkbox" checked={allowLocal} onChange={event => setAllowLocal(event.target.checked)} /> Dostęp do serwisu lokalnego</label>
        <button type="button" onClick={async () => { setBusy(true); try { setBrowserState(await desktop()?.browserGrant?.({ origin: origin.trim(), actions: ["read", ...(interact ? ["interact"] : []), ...(download ? ["download"] : [])], allowLocal }) || null); } catch (error) { setBrowserState({ error: String(error) }); } finally { setBusy(false); } }}>Zatwierdź zakres przeglądarki</button>{" "}
        <button type="button" onClick={() => void browser({ action: "status" })}>Sprawdź stan</button>{" "}
        {grants.map(grant => <p key={grant.origin}>{grant.origin}: {grant.actions.join(", ")} <button type="button" onClick={() => void browser({ action: "revoke", origin: grant.origin })}>Cofnij dostęp</button></p>)}
      </fieldset>
      <button type="button" disabled={!desktop()?.browserCommand} onClick={() => void browser({ action: "stop" })}>Zatrzymaj przeglądarkę</button>
      {browserState && <pre role="status" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 240, overflow: "auto" }}>{JSON.stringify(browserState, null, 2)}</pre>}
    </details>
  </>;
}
