import { VoiceCapture } from "./voiceCapture";
import { buildProfile } from "./voiceprint";
import { store } from "./store";

// Nauka głosu właściciela: nagrywamy kilka krótkich próbek, z każdej liczymy
// embedding, a profil to ich uśrednienie. Im więcej/dłuższe próbki, tym pewniej.

/** Nagraj jedną próbkę głosu (mów przez `ms`). Zwraca embedding albo rzuca. */
export async function recordSample(ms = 3000): Promise<number[]> {
  const cap = new VoiceCapture();
  const ok = await cap.start({});
  if (!ok) {
    cap.stop();
    throw new Error("Brak dostępu do mikrofonu (lub zajęty).");
  }
  cap.resetUtterance();
  await new Promise((r) => setTimeout(r, ms));
  const emb = cap.recentEmbedding();
  cap.stop();
  if (!emb.length) throw new Error("Nie wykryłem głosu — mów wyraźnie do mikrofonu.");
  return emb;
}

/** Pełna nauka: kilka próbek → profil zapisany w ustawieniach. */
export async function enrollVoice(samples = 3, onStep?: (i: number, total: number) => void): Promise<{ ok: boolean; error?: string }> {
  try {
    const embeds: number[][] = [];
    for (let i = 0; i < samples; i++) {
      onStep?.(i + 1, samples);
      embeds.push(await recordSample());
      if (i < samples - 1) await new Promise((r) => setTimeout(r, 600));
    }
    const profile = buildProfile(embeds);
    if (!profile.length) return { ok: false, error: "Nie udało się zbudować profilu." };
    store.setSettings({ voiceProfile: profile, voiceLock: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const hasVoiceProfile = (): boolean => (store.settings.voiceProfile?.length || 0) > 0;
