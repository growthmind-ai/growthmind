// items 61 and 63. The port itself.
//
// Two methods, not three. Health is persisted state on the connection row, derived by
// the service from the last validate/pull result. A `health` method would create a
// second source of truth for something the database owns and would reintroduce the
// failure of gating on a transient signal.
import { describe, expect, test } from "bun:test";

import { sessionSourcePullResultSchema, sessionSourceValidationSchema } from "@growthmind/shared";

import { POSTHOG_SOURCE_KIND } from "../src/posthog/constants";
import { createPostHogSessionSource } from "../src/posthog/session-source";
import type { SessionSource } from "../src/session-source";
import { AD_CONFIG, createFakeDeps, createFakeFetch } from "./helpers/fakes";
import { readAdapterSources } from "./helpers/source-scan";

describe("the SessionSource port", () => {
  // Item 61. The vendor name must not leak past the composition root, and a second
  // adapter must be a compile error (an unhandled branch of the one-member union),
  // never a silent fallthrough in a lookup table.
  test("exactly one SessionSource implementation is referenced, by name — no registry, factory map, or dynamic lookup", () => {
    const files = readAdapterSources();

    //  Exactly one function in the package returns a `SessionSource`.
    const implementations = files
      .filter((file) => /\)\s*:\s*SessionSource\s*\{/.test(file.code))
      .map((file) => file.path);
    expect(implementations).toEqual(["posthog/session-source.ts"]);

    //  The barrel names it, so the composition root imports a symbol rather than
    // resolving a string.
    const barrel = files.find((file) => file.path === "index.ts");
    expect(barrel).toBeDefined();
    expect(barrel?.code).toContain("createPostHogSessionSource");

    //  No registry, factory table, or dynamic lookup anywhere.
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

  // Item 63 —. The port must be drivable with no network at all: by a hand-written
  // fake, and by the real implementation through injected deps.
  test("the port is exercisable against a fake with no network", async () => {
    //  A fake with no network satisfies the port and returns port-valid shapes. This
    // is the substitutability guarantee `packages/db`'s connection service depends on.
    // It injects a source factory precisely so it can be tested against this.
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

    //  The real implementation is constructed from injected effects only. A fetch
    // that would fail loudly if the port needed a live connection just to be built, and
    // a `sleep` that never waits.
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
