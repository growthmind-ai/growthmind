import { describeDriverError } from "@growthmind/db";
import { logger } from "@growthmind/shared";

// A settings/status section failing to read must not take the rest of the page down with
// it — every reader in this app degrades to a typed empty view and logs why, rather than
// throwing past a boundary that has no error page to catch it.
export async function readOrFallback<T>(
  read: () => Promise<T>,
  fallback: T,
  logLabel: string,
  logFields: Record<string, unknown>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    logger.error(logLabel, { ...logFields, reason: describeDriverError(error) });
    return fallback;
  }
}
