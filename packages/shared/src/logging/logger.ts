export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Returns a logger that stamps `fields` onto every record it writes. */
  child(fields: LogFields): Logger;
}

export interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly time: string;
  readonly fields: LogFields;
}

/** Where a record goes. Swappable so tests assert on records, not on stdout. */
export type LogSink = (record: LogRecord) => void;

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly sink?: LogSink;
  readonly base?: LogFields;
  readonly now?: () => Date;
}

/**
 * An Error anywhere in the fields becomes `{name, message, stack}`. Without this a
 * caller's `{ error }` serialises to `{}` and the failure is unreadable.
 */
export function serialiseFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value instanceof Error ? serialiseError(value) : value;
  }
  return out;
}

function serialiseError(error: Error): LogFields {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(error.cause === undefined ? {} : { cause: describeCause(error.cause) }),
  };
}

function describeCause(cause: unknown): unknown {
  return cause instanceof Error ? serialiseError(cause) : cause;
}

export function jsonSink(write: (line: string) => void): LogSink {
  return (record) => {
    write(
      JSON.stringify({
        level: record.level,
        time: record.time,
        message: record.message,
        ...record.fields,
      }),
    );
  };
}

export function prettySink(write: (line: string) => void): LogSink {
  return (record) => {
    const rest = Object.keys(record.fields).length > 0 ? ` ${JSON.stringify(record.fields)}` : "";
    write(`${record.time} ${record.level.toUpperCase().padEnd(5)} ${record.message}${rest}`);
  };
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = LEVEL_RANK[options.level ?? "info"];
  // oxlint-disable-next-line no-console
  const sink = options.sink ?? prettySink((line) => console.log(line));
  const base = options.base ?? {};
  const now = options.now ?? ((): Date => new Date());

  const write = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVEL_RANK[level] < threshold) return;
    sink({
      level,
      message,
      time: now().toISOString(),
      fields: serialiseFields({ ...base, ...fields }),
    });
  };

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    child: (fields) => createLogger({ ...options, sink, base: { ...base, ...fields } }),
  };
}

export function parseLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value ?? "") ? (value as LogLevel) : fallback;
}

function writeLine(line: string): void {
  // oxlint-disable-next-line no-console
  console.log(line);
}

/** JSON in production, human-readable otherwise, overridable with LOG_FORMAT. */
export function sinkFromEnv(source: Record<string, string | undefined>): LogSink {
  const production = source.NODE_ENV === "production";
  const format = source.LOG_FORMAT ?? (production ? "json" : "pretty");
  return format === "json" ? jsonSink(writeLine) : prettySink(writeLine);
}

export function levelFromEnv(source: Record<string, string | undefined>): LogLevel {
  return parseLogLevel(source.LOG_LEVEL, source.NODE_ENV === "production" ? "info" : "debug");
}

export function loggerFromEnv(source: Record<string, string | undefined>): Logger {
  return createLogger({ level: levelFromEnv(source), sink: sinkFromEnv(source) });
}
