// Wspólne formatery — jedno źródło, by nie dublować ich po modułach.

/** Zaokrąglona kwota w złotych z polskim separatorem tysięcy, np. „12 000 zł". */
export const zl = (n: number): string => `${Math.round(n).toLocaleString("pl-PL")} zł`;
