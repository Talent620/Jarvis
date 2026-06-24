// === Inteligentne follow-upy — maszyna stanów oparta na zachowaniu odbiorcy ===
// Zamiast wysyłać „przypomnienie” na ślepo, decyzję podejmujemy na podstawie tego, co zrobił
// odbiorca: otworzył? kliknął? odpowiedział? odbiło się? wypisał? Rdzeń jest CZYSTY (zdarzenia →
// stan → następny krok), więc jest w pełni testowalny bez sieci i czasu rzeczywistego.
// Zdarzenia pochodzą z trackingu (pixel/IMAP/Gmail) — patrz tracking.ts; tu tylko logika decyzji.

export type FollowEventType =
  | "sent" | "delivered" | "opened" | "clicked" | "replied" | "bounced" | "unsubscribed";

export interface FollowEvent {
  type: FollowEventType;
  at: number; // ms epoch
}

export interface FollowState {
  sentAt: number | null;
  delivered: boolean;
  opens: number;
  clicks: number;
  replied: boolean;
  bounced: boolean;
  unsubscribed: boolean;
  lastEventAt: number | null;
  /** Ile follow-upów już wysłano (0,1,2…) — liczone z osobnego licznika, nie ze zdarzeń. */
  followUpsSent: number;
}

export type FollowAction =
  | "send_initial"   // jeszcze nic nie wyszło
  | "follow_up_a"    // otworzył, brak odpowiedzi → delikatne przypomnienie + wartość
  | "follow_up_b"    // nie otworzył → inny temat/kanał, druga próba
  | "follow_up_c"    // kliknął, brak odpowiedzi → mocny CTA / oferta czasowa
  | "wait"           // za wcześnie na kolejny krok
  | "stop"           // odpowiedział lub wypisał się — koniec
  | "blacklist";     // odbicie — adres na czarną listę, nie wysyłaj więcej

export interface FollowDecision {
  action: FollowAction;
  reason: string;
  /** Sugerowany odstęp do następnego kroku (ms) — dla „wait”. */
  waitMs?: number;
}

const DAY = 86_400_000;
// Odstępy między krokami sekwencji (eskalacja: szybciej, gdy jest zainteresowanie).
const GAP_AFTER_OPEN = 2 * DAY;   // otworzył → przypomnij po 2 dniach
const GAP_AFTER_CLICK = 1 * DAY;  // kliknął → kuj żelazo, 1 dzień
const GAP_NO_OPEN = 4 * DAY;      // cisza → druga próba po 4 dniach
const MAX_FOLLOWUPS = 3;          // po tylu krokach odpuszczamy (nie nękamy)

/** Pure: zredukuj listę zdarzeń trackingu do zwięzłego stanu odbiorcy. */
export function reduceEvents(events: FollowEvent[], followUpsSent = 0): FollowState {
  const st: FollowState = {
    sentAt: null, delivered: false, opens: 0, clicks: 0,
    replied: false, bounced: false, unsubscribed: false,
    lastEventAt: null, followUpsSent: Math.max(0, followUpsSent),
  };
  for (const e of (events || [])) {
    if (!e || typeof e.at !== "number") continue;
    if (st.lastEventAt == null || e.at > st.lastEventAt) st.lastEventAt = e.at;
    switch (e.type) {
      case "sent": if (st.sentAt == null || e.at < st.sentAt) st.sentAt = e.at; break;
      case "delivered": st.delivered = true; break;
      case "opened": st.opens++; break;
      case "clicked": st.clicks++; break;
      case "replied": st.replied = true; break;
      case "bounced": st.bounced = true; break;
      case "unsubscribed": st.unsubscribed = true; break;
    }
  }
  return st;
}

/** Pure: następny krok sekwencji na podstawie stanu i bieżącego czasu. */
export function nextFollowUp(st: FollowState, now: number): FollowDecision {
  // Stany terminalne mają pierwszeństwo — bezpieczeństwo reputacji i zgoda odbiorcy.
  if (st.bounced) return { action: "blacklist", reason: "Mail się odbił — adres na czarną listę." };
  if (st.unsubscribed) return { action: "stop", reason: "Odbiorca się wypisał — koniec kontaktu." };
  if (st.replied) return { action: "stop", reason: "Odbiorca odpowiedział — przejmuje człowiek." };
  if (st.sentAt == null) return { action: "send_initial", reason: "Jeszcze nic nie wysłano." };
  if (st.followUpsSent >= MAX_FOLLOWUPS) return { action: "stop", reason: "Wyczerpano sekwencję — nie nękamy." };

  const since = now - (st.lastEventAt ?? st.sentAt);

  // Kliknął, ale nie odpowiedział → najgorętszy lead, mocny CTA po krótkim odstępie.
  if (st.clicks > 0) {
    if (since < GAP_AFTER_CLICK) return { action: "wait", reason: "Kliknął niedawno — czekam.", waitMs: GAP_AFTER_CLICK - since };
    return { action: "follow_up_c", reason: "Kliknął, ale nie odpowiedział — mocny CTA / oferta czasowa." };
  }
  // Otworzył → jest zainteresowanie, delikatne przypomnienie z dodatkową wartością.
  if (st.opens > 0) {
    if (since < GAP_AFTER_OPEN) return { action: "wait", reason: "Otworzył niedawno — czekam.", waitMs: GAP_AFTER_OPEN - since };
    return { action: "follow_up_a", reason: "Otworzył, brak odpowiedzi — przypomnienie + wartość." };
  }
  // Cisza (brak otwarcia) → druga próba innym tematem po dłuższym odstępie.
  if (since < GAP_NO_OPEN) return { action: "wait", reason: "Brak otwarcia — czekam przed drugą próbą.", waitMs: GAP_NO_OPEN - since };
  return { action: "follow_up_b", reason: "Brak otwarcia — druga próba, inny temat / kanał." };
}

/** Pure skrót: zdarzenia + licznik → decyzja. */
export function decideFollowUp(events: FollowEvent[], followUpsSent: number, now: number): FollowDecision {
  return nextFollowUp(reduceEvents(events, followUpsSent), now);
}
