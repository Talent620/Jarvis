// === Lista unieważnionych kluczy OFFLINE (kill-switch) ===
// Klucz offline to token-OKAZICIEL podpisany ECDSA — działa bez serwera, więc nie da się go
// „cofnąć" zdalnie. Jedyny sposób, by ubić go PRZED wygaśnięciem, to wpisać go tutaj i WYDAĆ
// AKTUALIZACJĘ aplikacji — po update verifyLicense odrzuci taki klucz na każdym urządzeniu.
//
// Identyfikator blokady = `${nazwa}|${iat}` — oba pola są w PODPISANYM tokenie (decodeLicense),
// więc nie da się ich podmienić bez klucza prywatnego. ID skopiujesz z Panelu admina (🔎 Inspektor).
//
// UWAGA: dla NATYCHMIASTOWEJ, zdalnej kontroli (blokada bez aktualizacji) używaj kluczy ONLINE
// przez Worker (Panel admina → Licencje → Unieważnij). Ta lista to kill-switch dla trybu offline.

export const REVOKED_KEYS: string[] = [
  // Przykład (odkomentuj i wpisz prawdziwe ID, potem zbuduj nową wersję):
  // "tester młody|1719500000000",
];

/** Pure: zbuduj identyfikator blokady z pól podpisanego tokenu. */
export function revokeId(name: string | undefined, iat: number | undefined): string {
  return `${(name || "").trim()}|${iat ?? 0}`;
}

/** Pure (testowalne): czy klucz jest na podanej liście unieważnień. */
export function isRevokedIn(set: Set<string>, name: string | undefined, iat: number | undefined): boolean {
  return set.has(revokeId(name, iat));
}

const REVOKED_SET = new Set(REVOKED_KEYS.map((s) => s.trim()).filter(Boolean));

/** Czy dany klucz (po nazwie + iat z tokenu) jest unieważniony w tej wersji aplikacji. */
export function isRevoked(name: string | undefined, iat: number | undefined): boolean {
  return REVOKED_SET.size > 0 && isRevokedIn(REVOKED_SET, name, iat);
}
