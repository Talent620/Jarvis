// === Profil użytkownika — wbudowana, stała pamięć o Tobie ===
// Najlepszy wzorzec pamięci AI to warstwy: sesja (okno rozmowy) + semantyka
// (fakty) + PROFIL (curated, zawsze ładowany przy każdej rozmowie). Profil to
// rzeczy trwałe: kim jesteś, czym się zajmujesz, zainteresowania, cele,
// preferencje. JARVIS uwzględnia go w KAŻDEJ odpowiedzi. Edytowalny, lokalny.

export interface UserProfile {
  about: string;       // o mnie (krótko, własnymi słowami)
  occupation: string;  // czym się zajmuję / praca
  interests: string;   // zainteresowania
  goals: string;       // cele
  preferences: string; // preferencje / jak ze mną rozmawiać
}

export const emptyProfile: UserProfile = { about: "", occupation: "", interests: "", goals: "", preferences: "" };

const FIELD_CAP = 500;
const clip = (s: string) => (s || "").trim().slice(0, FIELD_CAP);

/** Czy profil ma jakąkolwiek treść. */
export function hasProfile(p?: Partial<UserProfile>): boolean {
  if (!p) return false;
  return [p.about, p.occupation, p.interests, p.goals, p.preferences].some((x) => !!(x || "").trim());
}

/**
 * Blok profilu do wstrzyknięcia w prompt systemowy. Pusty, gdy profil pusty.
 * Zwięzły i ograniczony — to stała pamięć, nie wypracowanie.
 */
export function buildProfileBlock(p?: Partial<UserProfile>): string {
  if (!hasProfile(p)) return "";
  const lines: string[] = [];
  if (p!.about?.trim()) lines.push(`O użytkowniku: ${clip(p!.about)}`);
  if (p!.occupation?.trim()) lines.push(`Zajęcie/praca: ${clip(p!.occupation)}`);
  if (p!.interests?.trim()) lines.push(`Zainteresowania: ${clip(p!.interests)}`);
  if (p!.goals?.trim()) lines.push(`Cele: ${clip(p!.goals)}`);
  if (p!.preferences?.trim()) lines.push(`Preferencje: ${clip(p!.preferences)}`);
  return (
    "\n\nProfil użytkownika (STAŁA PAMIĘĆ — uwzględniaj zawsze, dopasowuj odpowiedzi do tego, kim jest i czego chce):\n" +
    lines.map((l) => `- ${l}`).join("\n")
  );
}
