import { LIVE_CHANNEL, livePayloadSchema, type LivePayload } from "@growthmind/shared";
import { Client } from "pg";

export interface LiveSubscription {
  close(): Promise<void>;
}

export interface LiveSubscribeDeps {
  readonly connectionString: string;
  readonly onPayload: (payload: LivePayload) => void;
  readonly log: (message: string, fields?: Record<string, unknown>) => void;
}

export const LIVE_RECONNECT_MIN_MS = 500;

export const LIVE_RECONNECT_MAX_MS = 30_000;

export function nextBackoffMs(previous: number): number {
  return Math.min(previous === 0 ? LIVE_RECONNECT_MIN_MS : previous * 2, LIVE_RECONNECT_MAX_MS);
}

// A dedicated connection, never one from the pool: a pooled connection is handed back after
// each query and the LISTEN registration goes with it.
//
// The reconnect below is connection recovery, not a poll — it runs only after the socket has
// dropped, and stops the moment one is up. Nothing here asks the database whether anything
// happened.
export function subscribeLive(deps: LiveSubscribeDeps): LiveSubscription {
  let client: Client | null = null;
  let retryIn = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  function scheduleReconnect(): void {
    if (closed || retryTimer !== undefined) return;

    retryIn = nextBackoffMs(retryIn);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, retryIn);
  }

  async function connect(): Promise<void> {
    if (closed) return;

    const next = new Client({ connectionString: deps.connectionString });

    // Registered before connecting: a socket that drops during the LISTEN below still lands
    // here rather than as an unhandled rejection on the process.
    next.on("error", (error: Error) => {
      deps.log("live: the change feed's connection failed, reconnecting", {
        reason: error.message,
      });
      client = null;
      void next.end().catch(() => undefined);
      scheduleReconnect();
    });

    next.on("notification", (message) => {
      if (message.channel !== LIVE_CHANNEL || message.payload === undefined) return;

      let raw: unknown;
      try {
        raw = JSON.parse(message.payload);
      } catch {
        deps.log("live: a change arrived that could not be read as JSON");
        return;
      }

      const parsed = livePayloadSchema.safeParse(raw);
      if (!parsed.success) {
        deps.log("live: a change arrived in a shape this build does not know");
        return;
      }

      deps.onPayload(parsed.data);
    });

    try {
      await next.connect();
      await next.query(`LISTEN ${LIVE_CHANNEL}`);
    } catch (error) {
      deps.log("live: the change feed could not be opened, reconnecting", {
        reason: error instanceof Error ? error.message : String(error),
      });
      void next.end().catch(() => undefined);
      scheduleReconnect();
      return;
    }

    if (closed) {
      void next.end().catch(() => undefined);
      return;
    }

    client = next;
    retryIn = 0;
    deps.log("live: the change feed is open");
  }

  void connect();

  return {
    async close(): Promise<void> {
      closed = true;
      clearTimeout(retryTimer);
      retryTimer = undefined;

      const open = client;
      client = null;
      if (open !== null) {
        await open.end().catch(() => undefined);
      }
    },
  };
}
