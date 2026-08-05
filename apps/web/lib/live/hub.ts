import { subscribeLive, type LiveSubscription } from "@growthmind/db";
import { logger, parseBaseEnv, type LivePayload, type LiveTopic } from "@growthmind/shared";

export type LiveListener = (topic: LiveTopic) => void;

interface Hub {
  readonly byOrganization: Map<string, Set<LiveListener>>;
  subscription: LiveSubscription | null;
}

const globalForLive = globalThis as unknown as { __growthmindLiveHub?: Hub };

// One LISTEN connection for the whole process, not one per reader: a connection per open tab
// would exhaust the database's connection limit long before it ran out of readers.
function hub(): Hub {
  globalForLive.__growthmindLiveHub ??= { byOrganization: new Map(), subscription: null };
  return globalForLive.__growthmindLiveHub;
}

// Addressed by organization, so every member of it hears about a change one of them made
// (D1) — and nobody outside it hears anything, because one channel carries every
// organization's changes and this is the only place they are separated again (D7).
export function fanOut(
  byOrganization: ReadonlyMap<string, ReadonlySet<LiveListener>>,
  payload: LivePayload,
  onListenerError: (error: unknown) => void,
): void {
  for (const listener of byOrganization.get(payload.organizationId) ?? []) {
    try {
      listener(payload.topic);
    } catch (error) {
      // One reader throwing must not cost the others the change (D8).
      onListenerError(error);
    }
  }
}

function deliver(payload: LivePayload): void {
  fanOut(hub().byOrganization, payload, (error) => {
    logger.error("live: a reader failed to take a change", {
      topic: payload.topic,
      reason: error instanceof Error ? error.message : String(error),
    });
  });
}

function ensureOpen(): void {
  const current = hub();
  if (current.subscription !== null) return;

  current.subscription = subscribeLive({
    connectionString: parseBaseEnv(process.env).DATABASE_URL,
    onPayload: deliver,
    log: (message, fields) => {
      logger.info(message, fields);
    },
  });
}

export function watchLive(organizationId: string, listener: LiveListener): () => void {
  ensureOpen();

  const current = hub();
  const listeners = current.byOrganization.get(organizationId) ?? new Set<LiveListener>();
  listeners.add(listener);
  current.byOrganization.set(organizationId, listeners);

  return () => {
    const held = current.byOrganization.get(organizationId);
    if (held === undefined) return;

    held.delete(listener);
    // The empty set goes with the last reader, or an organization that connected once holds
    // a key on this process until it restarts.
    if (held.size === 0) current.byOrganization.delete(organizationId);
  };
}

export function watcherCount(organizationId: string): number {
  return hub().byOrganization.get(organizationId)?.size ?? 0;
}
