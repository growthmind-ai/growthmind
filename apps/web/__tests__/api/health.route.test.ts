import { describe, expect, test } from "bun:test";

import { createBareTestDb, createTestDb } from "../../../../packages/db/src/testing";
import { handle } from "../../app/api/health/route";

describe("GET /api/health", () => {
  test("reports ok when the schema is current", async () => {
    const { db, close } = await createTestDb();
    try {
      const response = await handle({ db });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok", database: "ok", schema: "ok" });
    } finally {
      await close();
    }
  });

  test("reports degraded with a remedy when migrations are pending", async () => {
    const { db, close } = await createBareTestDb();
    try {
      const response = await handle({ db });
      expect(response.status).toBe(503);
      const body = (await response.json()) as { schema: string; detail: string };
      expect(body.schema).toBe("behind");
      expect(body.detail).toContain("bun run db:migrate");
    } finally {
      await close();
    }
  });

  test("reports degraded when the database is unreachable", async () => {
    const { db, close } = await createBareTestDb();
    await close();

    const response = await handle({ db });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { database: string; schema: string };
    expect(body.database).toBe("unreachable");
    expect(body.schema).toBe("unknown");
  });

  test("a failing degraded-notification never breaks the health response", async () => {
    const { db, close } = await createBareTestDb();
    await close();

    const response = await handle({
      db,
      onDegraded: () => Promise.reject(new Error("posthog down")),
    });
    expect(response.status).toBe(503);
  });
});
