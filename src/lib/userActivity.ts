import { notifyUserActivity } from "./vaultApi";

/**
 * Tell the embeddings sidecar that the user is busy so it stops indexing.
 *
 * Heartbeat only: there is no matching "idle" call. The sidecar expires the
 * signal on its own after a few seconds, so a crashed or wedged renderer can
 * never wedge indexing along with it.
 */
const PING_INTERVAL_MS = 1_000;

let lastPingAt = Number.NEGATIVE_INFINITY;
let send: () => void = () => {
  void notifyUserActivity().catch(() => {
    /* indexing is optional; a dropped heartbeat costs one tick */
  });
};

export function pingUserActivity(now: number = Date.now()): void {
  if (now - lastPingAt < PING_INTERVAL_MS) return;
  lastPingAt = now;
  try {
    send();
  } catch {
    /* never let a heartbeat break typing or streaming */
  }
}

/** Test seam: swap the transport and reset the throttle window. */
export function __setUserActivityTransportForTests(fn: () => void): void {
  send = fn;
  lastPingAt = Number.NEGATIVE_INFINITY;
}
