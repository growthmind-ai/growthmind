import { describeDriverError } from "@growthmind/db";
import { logger } from "@growthmind/shared";

export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

// `null` and `[]` are also the shapes of a healthy new workspace, so a reader whose view would
// otherwise say "nothing here yet" takes this one and says "we could not look" instead.
export async function tryRead<T>(
  read: () => Promise<T>,
  logLabel: string,
  logFields: Record<string, unknown>,
): Promise<Read<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    logger.error(logLabel, { ...logFields, reason: describeDriverError(error) });
    return { ok: false };
  }
}

// A section failing to read must not take the rest of the page down with it. Only for a
// fallback that makes no claim on screen; anything a reader would take as an absence wants
// `tryRead` and a state of its own.
export async function readOrFallback<T>(
  read: () => Promise<T>,
  fallback: T,
  logLabel: string,
  logFields: Record<string, unknown>,
): Promise<T> {
  const result = await tryRead(read, logLabel, logFields);
  return result.ok ? result.value : fallback;
}
