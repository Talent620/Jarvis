import { Capacitor } from "@capacitor/core";
import { CapacitorCalendar } from "@ebarooni/capacitor-calendar";
import { store, uid } from "./store";

// Dodaje wydarzenie do kalendarza telefonu (natywnie) i lustrzanie do panelu w aplikacji.
// W przeglądarce zapisuje tylko do wewnętrznego magazynu.
export async function addEvent(
  title: string,
  start: string,
  end?: string,
  location?: string,
  notes?: string,
): Promise<string> {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : startMs + 3_600_000;
  const when = new Date(startMs).toLocaleString("pl-PL");

  store.setData((d) => d.calendar.unshift({ id: uid(), title, start, end, location, createdAt: Date.now() }));

  if (Capacitor.isNativePlatform()) {
    try {
      await CapacitorCalendar.requestAllPermissions().catch(() => {});
      await CapacitorCalendar.createEvent({
        title,
        startDate: startMs,
        endDate: endMs,
        location,
        notes,
        alertOffsetInMinutes: 30,
      });
      return `Dodano do kalendarza telefonu: „${title}” (${when}).`;
    } catch {
      return `Zapisałem wydarzenie „${title}” (${when}), ale nie udało się dopisać do kalendarza systemowego.`;
    }
  }
  return `Dodano wydarzenie: „${title}” (${when}).`;
}

// Lista wydarzeń z kalendarza telefonu na najbliższe dni.
export async function listUpcoming(days = 7): Promise<string> {
  if (!Capacitor.isNativePlatform()) {
    const events = [...store.data.calendar].sort((a, b) => a.start.localeCompare(b.start));
    return events.length
      ? events.map((e) => `• ${new Date(e.start).toLocaleString("pl-PL")} — ${e.title}`).join("\n")
      : "Kalendarz jest pusty.";
  }
  try {
    await CapacitorCalendar.requestAllPermissions().catch(() => {});
    const { result } = await CapacitorCalendar.listEventsInRange({
      startDate: Date.now(),
      endDate: Date.now() + days * 24 * 60 * 60 * 1000,
    });
    if (!result?.length) return "Brak wydarzeń w najbliższych dniach.";
    return result
      .map((e: any) => `• ${new Date(e.startDate).toLocaleString("pl-PL")} — ${e.title}`)
      .join("\n");
  } catch {
    return "Nie udało się odczytać kalendarza telefonu.";
  }
}
