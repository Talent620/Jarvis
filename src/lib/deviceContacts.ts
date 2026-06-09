import { Capacitor } from "@capacitor/core";
import { Contacts } from "@capacitor-community/contacts";
import { call, sms } from "./deviceControl";

async function findNumber(name: string): Promise<string | null> {
  await Contacts.requestPermissions();
  const { contacts } = await Contacts.getContacts({ projection: { name: true, phones: true } });
  const q = name.toLowerCase().trim();
  const hit = contacts.find(
    (c) => (c.name?.display || "").toLowerCase().includes(q) && (c.phones?.length ?? 0) > 0,
  );
  return hit?.phones?.[0]?.number ?? null;
}

export async function callContact(name: string): Promise<string> {
  if (!Capacitor.isNativePlatform()) return "Dostęp do kontaktów działa tylko w aplikacji na telefonie.";
  try {
    const number = await findNumber(name);
    if (!number) return `Nie znalazłem kontaktu „${name}” z numerem telefonu.`;
    return call(number);
  } catch {
    return "Nie udało się odczytać kontaktów (brak uprawnień?).";
  }
}

export async function textContact(name: string, body?: string): Promise<string> {
  if (!Capacitor.isNativePlatform()) return "Dostęp do kontaktów działa tylko w aplikacji na telefonie.";
  try {
    const number = await findNumber(name);
    if (!number) return `Nie znalazłem kontaktu „${name}” z numerem telefonu.`;
    return sms(number, body);
  } catch {
    return "Nie udało się odczytać kontaktów (brak uprawnień?).";
  }
}
