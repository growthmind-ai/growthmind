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

function carriesStatement(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    ("query" in value || "params" in value || "parameters" in value)
  );
}

// `DrizzleQueryError.message` is the statement and every bound parameter, so a read path
// that logs it writes tenancy ids and ciphertext into the log. The cause names no value.
// The CAUSE is tested too: reading only the top level meant one
// `throw new Error(msg, { cause: queryError })` handed the statement straight back.
export function describeDriverError(error: unknown): string {
  const cause = readCauseFields(error);

  if (!carriesStatement(error) && !carriesStatement(cause)) {
    return asStringOrNull(readDriverFields(error).message) ?? String(error);
  }

  // The code was read either way and names no bound value, so refusing without it left
  // an operator a sentence they could do nothing with.
  const refused = [REFUSED_WITHOUT_A_READABLE_CAUSE, asStringOrNull(cause?.code)]
    .filter((part) => part !== null)
    .join(" ");

  return carriesStatement(cause) ? refused : (asStringOrNull(cause?.message) ?? refused);
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
