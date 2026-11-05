/** Exact local controls, available even while the normal message queue is busy. */
export function isStopCommand(text: string): boolean {
  const q = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l")
    .replace(/[,.!?]+/g, " ").replace(/\s+/g, " ").trim().replace(/^jarvis\s+/, "");
  return /^(stop|zatrzymaj|zatrzymaj sie|zatrzymaj wszystko|przerwij|przerwij zadanie)$/.test(q);
}
