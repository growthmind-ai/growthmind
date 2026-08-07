import { setLogSink, type LogRecord } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { publishLive } from "../../src/live/publish";
import type { ScopedExecutor } from "../../src/repositories/types";

describe("publishLive when the notify itself fails", () => {
  // D8: telling a browser is never worth failing the write that had something to tell it.
  test("publishLive logs and never throws when pg_notify fails", async () => {
    const failing = {
      execute: () => Promise.reject(new Error("connection terminated unexpectedly")),
    } as unknown as ScopedExecutor;

    const logged: LogRecord[] = [];
    const restore = setLogSink((record) => {
      logged.push(record);
    });

    try {
      await publishLive(failing, { organizationId: "org-a", topic: "business_context" });
    } finally {
      restore();
    }

    const errors = logged.filter(
      (record) => record.level === "error" && /published/.test(record.message),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.fields["topic"]).toBe("business_context");
  });
});
