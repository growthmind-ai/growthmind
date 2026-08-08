import type { ConsoleErrorRecord } from "../protocol";

// Measured 2026-08-08 on /sign-in: 0 errors from the app's recorder alone, 0 from this harness's
// injection on a trivial page, exactly 2 from that injection on our sign-in DOM. See README.
export const KNOWN_HARNESS_SIGNATURES: readonly string[] = ["Maximum call stack size exceeded"];

export const MAX_HARNESS_OCCURRENCES_PER_SESSION = 2;

const SAMPLE_LIMIT = 8;
const MESSAGE_LIMIT = 160;

export class HarnessNoiseMovedError extends Error {
  constructor(sessionId: string, occurrences: number) {
    super(
      [
        `${sessionId} carries ${String(occurrences)} occurrences of a known harness console error`,
        `on the product's own origin, above the ${String(MAX_HARNESS_OCCURRENCES_PER_SESSION)} measured for it.`,
        "The artefact has moved, so the allowlist is now lying about what it covers and some of",
        "this may be the product's. Re-measure with the harness recorder detached before trusting",
        "the run. If the app's own recorder is running too, unset NEXT_PUBLIC_RRWEB_PUBLIC_KEY and",
        "restart the dev server, since NEXT_PUBLIC_* is inlined at compile time.",
      ].join(" "),
    );
    this.name = "HarnessNoiseMovedError";
  }
}

export function isKnownHarnessNoise(message: string): boolean {
  return KNOWN_HARNESS_SIGNATURES.some((signature) => message.includes(signature));
}

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function isOnAppOrigin(record: ConsoleErrorRecord, appOrigin: string): boolean {
  return originOf(record.url) === appOrigin;
}

export interface AttributedConsoleErrors {
  /** Evidence: on our origin and not the one known harness signature. */
  readonly app: readonly string[];

  /** Ours. Kept for the run output, never shown to the analyser. */
  readonly harness: readonly string[];

  /** Another company's site, reached by a persona. Never evidence about our product. */
  readonly offOrigin: readonly string[];
}

export function attributeConsoleErrors(
  errors: readonly ConsoleErrorRecord[],
  appOrigin: string,
): AttributedConsoleErrors {
  const app: string[] = [];
  const harness: string[] = [];
  const offOrigin: string[] = [];

  for (const record of errors) {
    const message = record.message.slice(0, MESSAGE_LIMIT);

    if (!isOnAppOrigin(record, appOrigin)) {
      offOrigin.push(message);
      continue;
    }
    if (isKnownHarnessNoise(message)) {
      harness.push(message);
      continue;
    }
    if (!app.includes(message)) app.push(message);
  }

  return { app: app.slice(0, SAMPLE_LIMIT), harness, offOrigin };
}

/**
 * Scoped to the product's own origin: the count scales with the page's DOM, so a persona sent to
 * an identity provider produces far more of it and says nothing about our own pages.
 */
export function assertHarnessNoiseUnchanged(
  sessionId: string,
  errors: readonly ConsoleErrorRecord[],
  appOrigin: string,
): void {
  const occurrences = errors.filter(
    (record) => isOnAppOrigin(record, appOrigin) && isKnownHarnessNoise(record.message),
  ).length;

  if (occurrences > MAX_HARNESS_OCCURRENCES_PER_SESSION) {
    throw new HarnessNoiseMovedError(sessionId, occurrences);
  }
}
