// Latency instrumentation (mission M5): timestamps per utterance for the moments that make a
// voice assistant feel fast or slow. Deltas are measured from the final transcript (or from the
// barge-in partial for the cancel), summarized as p50 / p95.

export type LatencyMark =
  | "speech_start" // VAD saw speech
  | "first_partial" // first partial transcript
  | "final" // final transcript
  | "intent" // routed (control, action, chat)
  | "cancel" // TTS cancelled by barge-in or stop
  | "action_start" // first micro-action started
  | "verified" // first action confirmed by read-back
  | "first_reply" // first text to speak for this utterance
  | "first_audio"; // first audio of that reply

export interface LatencySummary {
  count: number;
  p50: number;
  p95: number;
}

const DELTAS: [string, LatencyMark, LatencyMark][] = [
  ["final_to_intent", "final", "intent"],
  ["final_to_action_start", "final", "action_start"],
  ["final_to_verified", "final", "verified"],
  ["final_to_first_reply", "final", "first_reply"],
  ["final_to_first_audio", "final", "first_audio"],
  ["partial_to_cancel", "first_partial", "cancel"],
  ["speech_start_to_first_partial", "speech_start", "first_partial"],
];

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export class LatencyRecorder {
  private readonly marks = new Map<string, Partial<Record<LatencyMark, number>>>();
  constructor(private readonly max = 200) {}

  /** First value wins: a mark is the first time the moment happened for that utterance. */
  mark(utteranceId: string | undefined, name: LatencyMark, at: number): void {
    if (!utteranceId) return;
    let m = this.marks.get(utteranceId);
    if (!m) {
      m = {};
      this.marks.set(utteranceId, m);
      if (this.marks.size > this.max) this.marks.delete(this.marks.keys().next().value as string);
    }
    if (m[name] === undefined) m[name] = at;
  }

  timeline(utteranceId: string): Partial<Record<LatencyMark, number>> | undefined {
    const m = this.marks.get(utteranceId);
    return m ? { ...m } : undefined;
  }

  summary(): Record<string, LatencySummary> {
    const out: Record<string, LatencySummary> = {};
    for (const [name, from, to] of DELTAS) {
      const values: number[] = [];
      for (const m of this.marks.values()) {
        const a = m[from];
        const b = m[to];
        if (a !== undefined && b !== undefined && b >= a) values.push(b - a);
      }
      values.sort((x, y) => x - y);
      out[name] = { count: values.length, p50: percentile(values, 50), p95: percentile(values, 95) };
    }
    return out;
  }
}
