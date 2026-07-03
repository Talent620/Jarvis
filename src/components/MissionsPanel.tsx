import { useState } from "react";
import { runDemoMission, missionStatusReport, missionWhyReport, missionUndoLast } from "../lib/horizon/demoMission";
import { runExeProbe } from "../lib/horizon/exeNode";
import { horizonExeToken, isDesktop } from "../lib/desktop";
import { uid } from "../lib/store";

// 🛰 Sztafeta Misji (Project Horizon) — cienki panel: cała logika w src/lib/horizon.
// Pokaz dwuaktowy (usterka→pauza→wznowienie bez dubli), status z łańcuchem dowodów,
// „dlaczego?" (czarna skrzynka), „cofnij" (operacja odwrotna) i próba realnego węzła
// Windows EXE (tylko na desktopie). Każde CONFIRMED pochodzi z ODCZYTU ZWROTNEGO, nie
// deklaracji — panel tylko wyświetla to, co zwrócą silniki.
export default function MissionsPanel() {
  const [out, setOut] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => string | Promise<string>) {
    if (busy) return;
    setBusy(true);
    try {
      setOut(await fn());
    } catch (e) {
      setOut("Błąd: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="missions-panel">
      <h3 style={{ marginBottom: 4 }}>🛰 Sztafeta Misji <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(Project Horizon)</span></h3>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Jeden cel na wielu węzłach (telefon / komputer / urządzenie). „Zrobione" tylko z odczytu
        zwrotnego — nigdy z samej deklaracji. Urządzenie w pokazie to emulator (symulacja).
      </p>
      <div className="chips" style={{ flexWrap: "wrap", marginBottom: 8 }}>
        <button className="chip" data-testid="mp-demo" disabled={busy} onClick={() => run(() => runDemoMission("demo-" + uid(), Date.now()))}>▶ Pokaz</button>
        <button className="chip" data-testid="mp-status" disabled={busy} onClick={() => run(() => missionStatusReport())}>📋 Status</button>
        <button className="chip" data-testid="mp-why" disabled={busy} onClick={() => run(() => missionWhyReport(false))}>❓ Dlaczego?</button>
        <button className="chip" data-testid="mp-undo" disabled={busy} onClick={() => run(() => missionUndoLast(Date.now()))}>↩ Cofnij</button>
        {isDesktop() && (
          <button className="chip" data-testid="mp-exe" disabled={busy} onClick={() => run(async () => runExeProbe(await horizonExeToken(), Date.now(), uid))}>🖥 Sprawdź węzeł EXE</button>
        )}
      </div>
      {out && (
        <pre
          data-testid="mp-output"
          className="journal-card"
          style={{ padding: "8px 10px", marginBottom: 10, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 260, overflowY: "auto" }}
        >{out}</pre>
      )}
    </div>
  );
}
