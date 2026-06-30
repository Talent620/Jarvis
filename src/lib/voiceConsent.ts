// === Bezpieczne potwierdzenie głosowe (half-duplex) ===
// Problem: szerokie słowa („wyślij", „rób", „proszę") potrafiły SAME zatwierdzić akcję, a
// nasłuch startował, zanim JARVIS skończył mówić (mógł usłyszeć własne pytanie). Tu jest
// CZYSTY parser: akceptuje TYLKO jednoznaczne formy zgody/odmowy. S9-safe (bez /u, jawne
// klasy PL, proste tokeny).

export type ConsentSpeech = "yes" | "no" | "unclear";

// Jednoznaczne „tak". CELOWO bez słów-akcji (wyślij/rób/dzwoń/proszę/dawaj/śmiało) — one
// pojawiają się w mowie naturalnej i nie mogą same niczego zatwierdzać.
const YES = ["tak", "potwierdzam", "potwierdzem", "zgoda", "zgadzam", "wykonaj", "zezwalam", "zezwol", "okej", "ok", "jasne", "dobrze"];
const NO = ["nie", "odmawiam", "odmow", "odmów", "anuluj", "stop", "przerwij", "zostaw", "zaniechaj"];

/** Podziel na tokeny-słowa (litery PL + cyfry), małymi literami. Bez regex /u. */
function tokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .split(/[^a-z0-9ąćęłńóśźż]+/)
    .filter(Boolean);
}

/**
 * Pure: zinterpretuj wypowiedź jako zgodę/odmowę/niejasne.
 * Gdy padają i „tak", i „nie" → niejasne (nie działamy). Słowa-akcje NIE liczą się jako zgoda.
 */
export function parseVoiceConsent(transcript: string): ConsentSpeech {
  const t = tokens(transcript);
  const hasYes = t.some((w) => YES.includes(w));
  const hasNo = t.some((w) => NO.includes(w));
  if (hasYes && hasNo) return "unclear";
  if (hasYes) return "yes";
  if (hasNo) return "no";
  return "unclear";
}
