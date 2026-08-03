interface DriverErrorFields {
  message?: unknown;
  code?: unknown;
  constraint?: unknown;
}

function readDriverFields(error: unknown): DriverErrorFields {
  const cause = (error as { cause?: unknown } | null | undefined)?.cause;
  const candidate = (cause ?? error) as DriverErrorFields | null | undefined;
  return candidate ?? {};
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export type WriteErrorFactory<E extends Error> = (
  message: string,
  code: string | null,
  constraint: string | null,
) => E;

export class RepoWriteError extends Error {
  readonly code: string | null;
  readonly constraint: string | null;

  constructor(message: string, code: string | null, constraint: string | null) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.constraint = constraint;
  }
}

// The driver puts bound parameters in the message, so a ciphertext or key id reaches the
// caller unless it is scrubbed here first.
export function rethrowScrubbed<E extends Error>(
  error: unknown,
  secrets: readonly string[],
  make: WriteErrorFactory<E>,
): never {
  const fields = readDriverFields(error);
  const driverMessage =
    asStringOrNull(fields.message) ??
    (error instanceof Error ? error.message : String(error)) ??
    "database write refused";

  let scrubbed = driverMessage;
  for (const secret of secrets) {
    if (secret.length > 0) {
      scrubbed = scrubbed.split(secret).join("[redacted]");
    }
  }

  throw make(scrubbed, asStringOrNull(fields.code), asStringOrNull(fields.constraint));
}
