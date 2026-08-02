import { createLogger, levelFromEnv, sinkFromEnv } from "./logger";
import type { Logger, LogSink } from "./logger";

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env ?? { NODE_ENV: "development" };

let active: LogSink = sinkFromEnv(env);

/** Level and format are read once, at import. */
export const logger: Logger = createLogger({
  level: levelFromEnv(env),
  sink: (record) => {
    active(record);
  },
});

/** Redirects everything this logger and its children write. Returns the undo. */
export function setLogSink(next: LogSink): () => void {
  const previous = active;
  active = next;
  return () => {
    active = previous;
  };
}
