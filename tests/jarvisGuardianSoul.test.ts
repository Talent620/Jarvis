import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  addDaysDateStr,
  addLifePromise,
  addProofVictory,
  addTimeCapsule,
  buildGuardianHomeWhisper,
  buildLifeCompassPromptBlock,
  CHARACTER_PILLARS,
  computeCharacterProfile,
  createDefaultLifeCompass,
  detectEmotionalWeather,
  loadLifeCompass,
  localDateStr,
  markPromiseToday,
  POLISH_CRISIS_HELPLINES,
  readyTimeCapsules,
  saveLifeCompass,
  upsertTodayRitual,
} from "../src/lib/lifeCompass";
import {
  buildSoulPromptBlock,
  detectPersonalityMode,
  parseVoicePersonalityCommand,
  resolvePersonalityMode,
} from "../src/lib/soulModes";
import { resolveScreen } from "../src/lib/navIntent";
import { allCenterIds, duplicateCenterIds } from "../src/lib/centerModel";
import { matchedGroups, selectToolsForIntent } from "../src/lib/toolSelector";
import { runTool, toolDefs } from "../src/lib/tools";
import { applyParsed, buildFullPayload, buildNormalPayload } from "../src/lib/backup";

function installMemoryStorage() {
  const prev = (globalThis as unknown as { localStorage?: Storage }).localStorage;
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Partial<Storage> }).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
  };
  return () => {
    if (prev === undefined) delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    else (globalThis as unknown as { localStorage?: Storage }).localStorage = prev;
  };
}

describe("JARVIS v6.1 — Anioł Stróż & Kompas Życia (Guardian Soul OS)", () => {
  let restoreStorage: (() => void) | null = null;

  beforeEach(() => {
    restoreStorage = installMemoryStorage();
    saveLifeCompass(createDefaultLifeCompass());
  });

  afterEach(() => {
    restoreStorage?.();
    restoreStorage = null;
  });

  it("exposes 7 timeless pillars of character and computes honest scores from real promises, comebacks, proofs, and rituals", () => {
    expect(CHARACTER_PILLARS).toHaveLength(7);
    const now = Date.UTC(2026, 10, 28, 9, 0, 0);
    let state = addLifePromise("30 min bez telefonu rano", "spokoj", "Spokojny start");
    const oathId = state.promises[0].id;
    state = markPromiseToday(oathId, "kept", now);
    state = markPromiseToday(oathId, "comeback", now - 86_400_000);
    state = addProofVictory("Nie odpowiedziałem w złości, wyszedłem na spacer", "spokoj", "user");
    state = upsertTodayRitual(
      { morningIntention: "Prawda i spokój", morningPillar: "spokoj", kindnessAct: "Telefon do mamy" },
      now,
    );

    const prof = computeCharacterProfile(state, { flowMinutes: 45, completedTasks: 3, journalEntries: 2 });
    expect(prof.points).toHaveLength(7);
    expect(prof.keptTotal).toBe(1);
    expect(prof.comebacksTotal).toBe(1);
    expect(prof.proofCount).toBe(1);
    expect(prof.strongest.id).toBe("spokoj");
    expect(prof.overallScore).toBeGreaterThanOrEqual(25);
  });

  it("detects emotional weather accurately and triggers hard Polish Crisis Safety Shield on severe distress", () => {
    const crisis = detectEmotionalWeather("Nie chcę już żyć, wszystko straciło sens");
    expect(crisis.weather).toBe("crisis");
    expect(crisis.needsGuardian).toBe(true);
    expect(crisis.crisisSupport).toContain("116 123");
    expect(crisis.crisisSupport).toContain("800 70 2222");
    expect(POLISH_CRISIS_HELPLINES).toContain("112");

    const storm = detectEmotionalWeather("Nie daję rady, jestem do niczego i wszystko się wali");
    expect(storm.weather).toBe("storm");
    expect(storm.needsGuardian).toBe(true);

    const crossroads = detectEmotionalWeather("Chcę stawać się lepszym człowiekiem, ale mam dylemat jak postąpić");
    expect(crossroads.weather).toBe("crossroads");
    expect(crossroads.needsGuardian).toBe(true);

    const gratitude = detectEmotionalWeather("Udało mi się przełamać i jestem wdzięczny za ten dzień");
    expect(gratitude.weather).toBe("gratitude");
  });

  it("injects Proof Vault victories, North Star, and Crisis helplines into Guardian system prompt", () => {
    const now = Date.UTC(2026, 10, 28, 12, 0, 0);
    saveLifeCompass({
      ...createDefaultLifeCompass(),
      northStar: "Spokojny, uczciwy człowiek o mocnym kręgosłupie",
    });
    addProofVictory("Przetrwałem najtrudniejszy miesiąc i nie poddałem się", "odwaga", "user");
    const state = loadLifeCompass();

    const stormPrompt = buildLifeCompassPromptBlock(state, "Nie daję rady, wszystko się wali", now);
    expect(stormPrompt).toContain("Spokojny, uczciwy człowiek");
    expect(stormPrompt).toContain("Przetrwałem najtrudniejszy miesiąc");
    expect(stormPrompt).toContain("Burza emocji");

    const crisisPrompt = buildLifeCompassPromptBlock(state, "Nie chcę już żyć", now);
    expect(crisisPrompt).toContain("116 123");
    expect(crisisPrompt).toContain("800 70 2222");
  });

  it("seals and unlocks Time-Capsules strictly by unlockDate and prioritizes them on home whisper", () => {
    const now = Date.UTC(2026, 10, 28, 10, 0, 0);
    const today = localDateStr(now);
    const future = addDaysDateStr(30, now);
    addTimeCapsule("List z przyszłości", "Jeszcze zablokowany", future);
    addTimeCapsule("List na dziś", "Pamiętaj po co zacząłeś!", today);

    const state = loadLifeCompass();
    const ready = readyTimeCapsules(state, now);
    expect(ready).toHaveLength(1);
    expect(ready[0].title).toBe("List na dziś");

    const whisper = buildGuardianHomeWhisper(state, now);
    expect(whisper.kind).toBe("capsule");
    expect(whisper.title).toBe("List na dziś");
  });

  it("activates ANIOL_STROZ in soulModes via AUTO emotional detection, manual selection, and voice command", () => {
    expect(detectPersonalityMode("Miałem ciężki dzień, brakuje mi sił, pogadaj ze mną")).toBe("ANIOL_STROZ");
    expect(resolvePersonalityMode("ANIOL_STROZ", "Siema")).toBe("ANIOL_STROZ");
    expect(parseVoicePersonalityCommand("Włącz tryb anioła stróża")).toBe("ANIOL_STROZ");
    expect(parseVoicePersonalityCommand("Przełącz na opiekuna")).toBe("ANIOL_STROZ");

    const block = buildSoulPromptBlock({ mode: "ANIOL_STROZ", voiceMode: false });
    expect(block.mode).toBe("ANIOL_STROZ");
    expect(block.block).toContain("ANIOŁ STRÓŻ");
    expect(block.block).toContain("ZERO lizusostwa");
  });

  it("wires Life Compass tools (save_life_victory, save_life_promise, life_compass_checkin), navIntent, centerModel, and backup round-trip", async () => {
    expect(resolveScreen("anioł stróż")?.id).toBe("soul");
    expect(resolveScreen("kompas życia")?.id).toBe("soul");
    expect(duplicateCenterIds()).toEqual([]);
    expect(allCenterIds()).toContain("soul");

    expect(matchedGroups("zapisz moje zwycięstwo w skarbcu i kompasie")).toContain("life");
    const selectedNames = selectToolsForIntent("obiecuję sobie codziennie ruch i kompas", toolDefs).map((d) => d.name);
    expect(selectedNames).toContain("save_life_promise");
    expect(selectedNames).toContain("save_life_victory");
    expect(selectedNames).toContain("life_compass_checkin");

    const r1 = await runTool("save_life_promise", { title: "20 min spaceru codziennie", pillar: "energia" });
    expect(r1).toContain("Przymierza ze Sobą");
    const r2 = await runTool("save_life_victory", { text: "Zrobiłem trudny telefon", pillar: "odwaga" });
    expect(r2).toContain("Skarbcu Zwycięstw");
    const r3 = await runTool("life_compass_checkin", {});
    expect(r3).toContain("Kompas Życia");

    // Round-trip przez zwykły i pełny backup (przenoszenie między Android / Ubuntu / Windows)
    const normal = buildNormalPayload();
    const full = buildFullPayload();
    expect((normal.lifeCompass as { promises: unknown[] }).promises).toHaveLength(1);
    expect((full.lifeCompass as { proofVault: unknown[] }).proofVault).toHaveLength(1);

    saveLifeCompass(createDefaultLifeCompass());
    expect(loadLifeCompass().promises).toHaveLength(0);
    applyParsed(normal);
    expect(loadLifeCompass().promises).toHaveLength(1);
    expect(loadLifeCompass().proofVault).toHaveLength(1);
  });
});
