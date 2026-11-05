/** Request-scoped cancellation. It never authorizes an operation or proves its outcome. */
export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new DOMException("Zatrzymano wykonanie.", "AbortError");
}

/** Stop waiting even if an integration ignores AbortSignal. Callers must gate side effects too. */
export function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const stop = () => { cleanup(); reject(new DOMException("Zatrzymano wykonanie.", "AbortError")); };
    const cleanup = () => signal.removeEventListener("abort", stop);
    work.then(value => { cleanup(); if (signal.aborted) stop(); else resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
  });
}
