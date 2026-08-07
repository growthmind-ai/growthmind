import { LIVE_CHANNEL, livePayloadSchema, type LivePayload } from "@growthmind/shared";
import { Param, SQL, StringChunk } from "drizzle-orm";

import type { TestDb } from "./db";

export interface LiveRecorder {
  readonly db: TestDb;
  readonly published: readonly LivePayload[];

  readonly malformed: readonly unknown[];
}

// The channel string and the already-stringified payload are adjacent bound parameters of
// `publishLive`'s one statement, so the payload is whatever follows the channel.
function payloadParamOf(statement: unknown): { readonly raw: unknown } | null {
  if (!(statement instanceof SQL)) {
    return null;
  }

  // A `sql` template holds its interpolated values raw until the dialect binds them, so a
  // chunk is a bound value unless it is literal SQL text.
  const bound = statement.queryChunks
    .filter((chunk) => !(chunk instanceof StringChunk))
    .map((chunk) => (chunk instanceof Param ? (chunk.value as unknown) : (chunk as unknown)));
  const channelAt = bound.indexOf(LIVE_CHANNEL);

  if (channelAt === -1 || channelAt + 1 >= bound.length) {
    return null;
  }

  return { raw: bound[channelAt + 1] };
}

function decode(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function recordPublishedTopics(realDb: TestDb): LiveRecorder {
  const published: LivePayload[] = [];
  const malformed: unknown[] = [];

  function record(statement: unknown): void {
    const param = payloadParamOf(statement);

    if (param === null) {
      return;
    }

    const value = decode(param.raw);
    const parsed = livePayloadSchema.safeParse(value);

    // `publishLive` catches everything it issues, so a throw here would be swallowed and read
    // as a correct zero-publish. The wrong shape is collected instead, where a test can see it.
    if (parsed.success) {
      published.push(parsed.data);
    } else {
      malformed.push(value);
    }
  }

  return { db: followingStatements(realDb, record), published, malformed };
}

// Recursive on purpose: a repository that wraps its write and its publish in one
// transaction issues the NOTIFY through the tx executor, not through the handle this
// recorder wrapped — so the callback's executor is wrapped too, or every in-transaction
// publish would read as a correct zero-publish (the O-051 emit seams are that shape).
function followingStatements<T extends object>(target: T, record: (statement: unknown) => void): T {
  return new Proxy(target, {
    get(inner, prop, receiver) {
      const value = Reflect.get(inner, prop, receiver);

      if (prop === "execute" && typeof value === "function") {
        return (...args: unknown[]) => {
          const result = (value as (...args: unknown[]) => unknown).apply(inner, args);
          record(args[0]);
          return result;
        };
      }

      if (prop === "transaction" && typeof value === "function") {
        return (...args: unknown[]) => {
          const [callback, ...rest] = args as [(tx: object) => unknown, ...unknown[]];
          return (value as (...args: unknown[]) => unknown).apply(inner, [
            (tx: object) => callback(followingStatements(tx, record)),
            ...rest,
          ]);
        };
      }

      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(inner)
        : value;
    },
  });
}
