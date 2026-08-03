interface DriverErrorFields {
  message?: unknown;
  code?: unknown;
  constraint?: unknown;
}

function readCauseFields(error: unknown): DriverErrorFields | null {
  const cause = (error as { cause?: unknown } | null | undefined)?.cause;
  return (cause as DriverErrorFields | null | undefined) ?? null;
}

function readDriverFields(error: unknown): DriverErrorFields {
  return readCauseFields(error) ?? (error as DriverErrorFields | null | undefined) ?? {};
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

const REFUSED_WITHOUT_A_READABLE_CAUSE = "the database refused the query";

// `DrizzleQueryError.message` is the statement and every bound parameter, so a read path
// that logs it writes tenancy ids and ciphertext into the log. The cause is the driver's
// own message, which names no value; anything still carrying `query`/`params` is refused
// a message rather than trusted.
export function describeDriverError(error: unknown): string {
  const fields = readDriverFields(error);
  const carriesStatement =
    typeof error === "object" &&
    error !== null &&
    ("query" in error || "params" in error || "parameters" in error);

  if (!carriesStatement) {
    return asStringOrNull(fields.message) ?? String(error);
  }

  return asStringOrNull(readCauseFields(error)?.message) ?? REFUSED_WITHOUT_A_READABLE_CAUSE;
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
