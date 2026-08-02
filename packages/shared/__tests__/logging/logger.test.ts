import { describe, expect, test } from "bun:test";

import {
  createLogger,
  jsonSink,
  loggerFromEnv,
  parseLogLevel,
  prettySink,
  serialiseFields,
  type LogRecord,
} from "../../src/logging";

const FROZEN = new Date("2026-08-02T10:30:00.000Z");

function capture(level?: "debug" | "info" | "warn" | "error"): {
  records: LogRecord[];
  logger: ReturnType<typeof createLogger>;
} {
  const records: LogRecord[] = [];
  const sink = (record: LogRecord): void => {
    records.push(record);
  };
  return {
    records,
    logger: createLogger(
      level === undefined ? { now: () => FROZEN, sink } : { level, now: () => FROZEN, sink },
    ),
  };
}

describe("createLogger", () => {
  test("writes one record per call carrying level, message, time and fields", () => {
    const { records, logger } = capture("debug");

    logger.info("finding delivered", { findingId: "f-1", organizationId: "org-1" });

    expect(records).toEqual([
      {
        level: "info",
        message: "finding delivered",
        time: "2026-08-02T10:30:00.000Z",
        fields: { findingId: "f-1", organizationId: "org-1" },
      },
    ]);
  });

  test("drops records below the configured level and keeps the rest", () => {
    const { records, logger } = capture("warn");

    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");

    expect(records.map((r) => r.level)).toEqual(["warn", "error"]);
  });

  test("defaults to info, so debug is silent unless asked for", () => {
    const { records, logger } = capture();

    logger.debug("invisible");
    logger.info("visible");

    expect(records.map((r) => r.message)).toEqual(["visible"]);
  });

  test("a call with no fields still produces an empty field bag, never undefined", () => {
    const { records, logger } = capture();

    logger.info("bare");

    expect(records[0]?.fields).toEqual({});
  });
});

describe("child loggers", () => {
  test("stamp their fields onto every record, and the parent is unaffected", () => {
    const records: LogRecord[] = [];
    const parent = createLogger({ now: () => FROZEN, sink: (r) => records.push(r) });
    const child = parent.child({ organizationId: "org-1", runId: "run-9" });

    child.info("lane opened");
    parent.info("tick finished");

    expect(records[0]?.fields).toEqual({ organizationId: "org-1", runId: "run-9" });
    expect(records[1]?.fields).toEqual({});
  });

  test("a call's own field wins over the child's when both name it", () => {
    const records: LogRecord[] = [];
    const child = createLogger({ now: () => FROZEN, sink: (r) => records.push(r) }).child({
      projectId: "p-1",
    });

    child.warn("switched project", { projectId: "p-2" });

    expect(records[0]?.fields).toEqual({ projectId: "p-2" });
  });

  test("nest, accumulating fields down the chain", () => {
    const records: LogRecord[] = [];
    const root = createLogger({ now: () => FROZEN, sink: (r) => records.push(r) });

    root.child({ organizationId: "org-1" }).child({ runId: "run-2" }).error("closed as failed");

    expect(records[0]?.fields).toEqual({ organizationId: "org-1", runId: "run-2" });
  });
});

describe("serialiseFields", () => {
  test("expands an Error into name, message and stack", () => {
    const error = new Error("PostHog unreachable");
    const fields = serialiseFields({ error });
    const serialised = fields.error as Record<string, unknown>;

    expect(serialised.name).toBe("Error");
    expect(serialised.message).toBe("PostHog unreachable");
    expect(typeof serialised.stack).toBe("string");
  });

  test("expands a cause chain, so the underlying failure survives", () => {
    const error = new Error("delivery failed", { cause: new Error("channel_not_found") });
    const serialised = serialiseFields({ error }).error as Record<string, unknown>;
    const cause = serialised.cause as Record<string, unknown>;

    expect(cause.message).toBe("channel_not_found");
  });

  test("leaves non-Error values alone, including null and nested objects", () => {
    expect(serialiseFields({ a: null, b: 0, c: { d: [1, 2] }, e: undefined })).toEqual({
      a: null,
      b: 0,
      c: { d: [1, 2] },
      e: undefined,
    });
  });

  test("an Error reaching a sink is readable rather than an empty object", () => {
    const lines: string[] = [];
    const logger = createLogger({ now: () => FROZEN, sink: jsonSink((l) => lines.push(l)) });

    logger.error("could not read the newest finding", { error: new Error("boom") });

    expect(lines[0]).toContain('"message":"boom"');
    expect(lines[0]).not.toContain('"error":{}');
  });
});

describe("sinks", () => {
  test("jsonSink emits one parseable line per record with the fields at the top level", () => {
    const lines: string[] = [];
    const logger = createLogger({ now: () => FROZEN, sink: jsonSink((l) => lines.push(l)) });

    logger.warn("slack post refused", { channelId: "C01" });

    expect(JSON.parse(lines[0] as string)).toEqual({
      level: "warn",
      time: "2026-08-02T10:30:00.000Z",
      message: "slack post refused",
      channelId: "C01",
    });
  });

  test("prettySink writes a single human-readable line and omits an empty field bag", () => {
    const lines: string[] = [];
    const logger = createLogger({ now: () => FROZEN, sink: prettySink((l) => lines.push(l)) });

    logger.info("worker booted");
    logger.info("lane opened", { projectId: "p-1" });

    expect(lines[0]).toBe("2026-08-02T10:30:00.000Z INFO  worker booted");
    expect(lines[1]).toBe('2026-08-02T10:30:00.000Z INFO  lane opened {"projectId":"p-1"}');
  });
});

describe("parseLogLevel", () => {
  test("accepts every declared level", () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      expect(parseLogLevel(level, "info")).toBe(level);
    }
  });

  test("falls back for an unknown, empty or absent value rather than throwing", () => {
    expect(parseLogLevel("verbose", "info")).toBe("info");
    expect(parseLogLevel("", "warn")).toBe("warn");
    expect(parseLogLevel(undefined, "error")).toBe("error");
  });
});

describe("loggerFromEnv", () => {
  test("is quiet below info in production and reaches debug in development", () => {
    expect(loggerFromEnv({ NODE_ENV: "production" })).toBeDefined();
    expect(loggerFromEnv({})).toBeDefined();
    expect(loggerFromEnv({ LOG_LEVEL: "error" })).toBeDefined();
  });
});
