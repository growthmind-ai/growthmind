import { describeError, logger as sharedLogger } from "@growthmind/shared";

// What Graphile Worker hands a task, narrowed to what a task may use. The runtime
// value is `helpers.logger`; `taskLoggerFor` adapts the shared logger for callers
// that have one instead.
export interface TaskLogger {
  info(message: string): void;
  error(message: string): void;
}

export function taskLoggerFor(source: typeof sharedLogger = sharedLogger): TaskLogger {
  return {
    info: (message) => {
      source.info(message);
    },
    error: (message) => {
      source.error(message);
    },
  };
}

// A side effect whose failure must not fail the flow that already succeeded. The
// caller passes the whole sentence — the consequence clause ("so this project waits
// for the hourly check") is what a person reads, so it cannot be reduced to a label.
// Never wrap a write that records a terminal completed/failed state: that is the
// signal the UI reconciles against, and swallowing it strands a run as running.
export async function isolated(
  logger: TaskLogger,
  sentence: string,
  work: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await work();
    return true;
  } catch (error) {
    logger.error(`${sentence} — ${describeError(error)}`);
    return false;
  }
}
