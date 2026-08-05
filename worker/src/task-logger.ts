import { describeDriverError } from "@growthmind/db";
import { logger as sharedLogger } from "@growthmind/shared";

export interface TaskLogger {
  info(message: string): void;

  // A condition a person should see and no run should be paged for.
  warn(message: string): void;
  error(message: string): void;
}

export function taskLoggerFor(source: typeof sharedLogger = sharedLogger): TaskLogger {
  return {
    info: (message) => {
      source.info(message);
    },
    warn: (message) => {
      source.warn(message);
    },
    error: (message) => {
      source.error(message);
    },
  };
}

// Never wrap the write that records a terminal completed/failed state — the UI reconciles
// against it, and swallowing it strands the run as running.
export async function isolated(
  logger: TaskLogger,
  sentence: string,
  work: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await work();
    return true;
  } catch (error) {
    logger.error(`${sentence} — ${describeDriverError(error)}`);
    return false;
  }
}
