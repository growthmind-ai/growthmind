import { describeError, logger as sharedLogger } from "@growthmind/shared";

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

// Never wrap a write that records a terminal completed/failed state: that is what the
// UI reconciles against, and swallowing it strands a run as running. `sentence` carries
// its own consequence clause because that is the part a person reads.
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
