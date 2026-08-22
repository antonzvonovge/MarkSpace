type Pending<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function abortError(message: string): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

/**
 * UI can answer before execute() starts (stream shows the card first),
 * and Gemini recovery can wait on the same toolCallId as a live execute.
 */
export function createToolWait<T>(label: string) {
  const pending = new Map<string, Pending<T>>();
  const early = new Map<string, T>();

  function wait(toolCallId: string, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(abortError(`${label} cancelled`));
    }
    const queued = early.get(toolCallId);
    if (queued !== undefined) {
      early.delete(toolCallId);
      return Promise.resolve(queued);
    }
    if (early.size === 1) {
      const only = early.values().next().value as T;
      early.clear();
      return Promise.resolve(only);
    }
    const existing = pending.get(toolCallId);
    if (existing) return existing.promise;
    if (pending.size === 1) {
      return pending.values().next().value!.promise;
    }

    let settle: Pending<T>["resolve"] = () => undefined;
    let fail: Pending<T>["reject"] = () => undefined;
    const promise = new Promise<T>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });

    const cleanup = () => {
      pending.delete(toolCallId);
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      const entry = pending.get(toolCallId);
      cleanup();
      entry?.reject(abortError(`${label} cancelled`));
    };

    pending.set(toolCallId, {
      promise,
      resolve: (value) => {
        cleanup();
        settle(value);
      },
      reject: (error) => {
        cleanup();
        fail(error);
      },
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    return promise;
  }

  function resolve(toolCallId: string, value: T): boolean {
    const entry = pending.get(toolCallId) ?? (pending.size === 1 ? pending.values().next().value : undefined);
    if (entry) {
      entry.resolve(value);
      return true;
    }
    early.set(toolCallId, value);
    return true;
  }

  function cancel(toolCallId: string, reason?: string): boolean {
    early.delete(toolCallId);
    const entry = pending.get(toolCallId);
    if (!entry) return false;
    entry.reject(abortError(reason ?? `${label} cancelled`));
    return true;
  }

  function cancelAll(reason?: string): void {
    early.clear();
    for (const id of [...pending.keys()]) cancel(id, reason);
  }

  function has(toolCallId?: string): boolean {
    if (toolCallId) {
      return pending.has(toolCallId) || early.has(toolCallId);
    }
    return pending.size > 0 || early.size > 0;
  }

  return { wait, resolve, cancel, cancelAll, has };
}
