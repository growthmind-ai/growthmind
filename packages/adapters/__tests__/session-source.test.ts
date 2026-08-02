import { describe, expect, test } from "bun:test";

import { sessionSourcePullResultSchema, sessionSourceValidationSchema } from "@growthmind/shared";

import { POSTHOG_SOURCE_KIND } from "../src/posthog/constants";
import { createPostHogSessionSource } from "../src/posthog/session-source";
import type { SessionSource } from "../src/session-source";
import { AD_CONFIG, createFakeDeps, createFakeFetch } from "./helpers/fakes";
import { readAdapterSources } from "./helpers/source-scan";

describe("the SessionSource port", () => {
  test("exactly one SessionSource implementation is referenced, by name — no registry, factory map, or dynamic lookup", () => {
    const files = readAdapterSources();

    const implementations = files
      .filter((file) => /\)\s*:\s*SessionSource\s*\{/.test(file.code))
      .map((file) => file.path);
    expect(implementations).toEqual(["posthog/session-source.ts"]);

    const barrel = files.find((file) => file.path === "index.ts");
    expect(barrel).toBeDefined();
    expect(barrel?.code).toContain("createPostHogSessionSource");

    const offenders: string[] = [];
    for (const file of files) {
      if (/registr/i.test(file.code)) offenders.push(`${file.path}: registry`);
      if (/factor(y|ies)/i.test(file.code)) offenders.push(`${file.path}: factory table`);
      if (/Record\s*<\s*SessionSourceKind/.test(file.code)) {
        offenders.push(`${file.path}: kind-keyed lookup map`);
      }
      if (/Map\s*<\s*SessionSourceKind/.test(file.code)) {
        offenders.push(`${file.path}: kind-keyed lookup map`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the port is exercisable against a fake with no network", async () => {
    const checkedAt = new Date("2026-07-30T18:00:00.000Z");
    const fakeSource: SessionSource = {
      kind: POSTHOG_SOURCE_KIND,
      validate: async () => ({ ok: true, checkedAt }),
      pull: async () => ({
        ok: true,
        sessions: [],
        events: [],
        newestObservedAt: null,
        contiguous: true,
        resumeBefore: null,
        pagesFetched: 0,
        droppedMalformed: 0,
        identityLookupsUsed: 0,
        eventsReceived: 0,
      }),
    };

    expect(sessionSourceValidationSchema.parse(await fakeSource.validate()).ok).toBe(true);
    const fakePull = sessionSourcePullResultSchema.parse(
      await fakeSource.pull({ watermarkAt: null, backfillBefore: null, maxPages: 25 }),
    );
    expect(fakePull.ok).toBe(true);

    const fake = createFakeFetch(() => ({
      status: 200,
      body: { next: null, results: [] },
    }));
    const { deps } = createFakeDeps(fake.fetch);
    const source = createPostHogSessionSource(AD_CONFIG, deps);

    expect(source.kind).toBe(POSTHOG_SOURCE_KIND);
    expect(typeof source.validate).toBe("function");
    expect(typeof source.pull).toBe("function");
  });
});
