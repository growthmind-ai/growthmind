// Service tests for `persistPullResult` — ADD §9 item 97, plus the exclusion
// stamping and partial-progress guarantees the counter and the future
// `exclusions.backfill` both rest on.
//
// The property under test is FR-14's: everything the classifier consumed is on
// the session row, so a stored stamp is reproducible from persisted data alone
// with ZERO source access. This suite therefore never constructs a source at
// all — it re-runs the real classifier over rows read back through the
// repository and asserts the stamps match.
//
// WAVE 0: `persistPullResult` is a typed stub that throws. Every test below
// MUST fail with "TYPED STUB (O-003 scaffold)" — never a compile error, a
// missing table, or a fixture collision.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  CURRENT_EXCLUSION_RULE_SET,
  EXCLUSION_RULE_SETS,
  EXCLUSION_RULE_SET_VERSION,
  SESSION_GROUPING_VERSION,
  URL_PATH_NORMALISATION_VERSION,
  classifyExclusion,
  normaliseUrlPath,
  type SessionFacts,
} from "@growthmind/shared";

import { createEventsRepo } from "../../src/repositories/events.repo";
import { createSessionsRepo } from "../../src/repositories/sessions.repo";
import { persistPullResult, type IntakeConnection } from "../../src/services/intake.service";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedConnection } from "../helpers/fixtures";
import { failedPull, sourceEvent, sourceSession, successfulPull } from "./fake-source";
import { seedWorkspace, type SeededWorkspace } from "./seed";

/** The internal domain stamped on the connection under test. Obviously fake. */
const INTERNAL_DOMAIN = "acme-internal-example.test";

/** An outside visitor's email domain — the kept case. */
const OUTSIDE_DOMAIN = "outside-example.test";

const HEADLESS_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36";

const HEADED_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

async function seedIntakeTarget(
  db: TestDb,
  label: string,
): Promise<{ ws: SeededWorkspace; connection: IntakeConnection }> {
  const ws = await seedWorkspace(db, label);
  const row = await seedConnection(db, {
    organizationId: ws.organizationId,
    projectId: ws.project.id,
    inferredInternalDomain: INTERNAL_DOMAIN,
  });

  return {
    ws,
    connection: {
      id: row.id,
      projectId: ws.project.id,
      inferredInternalDomain: INTERNAL_DOMAIN,
    },
  };
}

describe("persistPullResult", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("stamps 'internal_domain' on a session whose email domain matches the connection's inferred domain", async () => {
    const { ws, connection } = await seedIntakeTarget(db, "stamp-internal");

    await persistPullResult(db, ws.ctx, {
      connection,
      result: successfulPull({
        sessions: [
          sourceSession({ sessionKey: "ph:internal-1", identityEmailDomain: INTERNAL_DOMAIN }),
        ],
        events: [sourceEvent({ sourceEventId: "evt-internal-1", sessionKey: "ph:internal-1" })],
      }),
    });

    const row = await createSessionsRepo(db, ws.ctx).findByKey(ws.project.id, "ph:internal-1");
    expect(row?.exclusionReason).toBe("internal_domain");
  });

  test("stamps 'automation_headless' on a headless user agent", async () => {
    const { ws, connection } = await seedIntakeTarget(db, "stamp-headless");

    await persistPullResult(db, ws.ctx, {
      connection,
      result: successfulPull({
        sessions: [sourceSession({ sessionKey: "ph:headless-1", userAgent: HEADLESS_UA })],
        events: [sourceEvent({ sourceEventId: "evt-headless-1", sessionKey: "ph:headless-1" })],
      }),
    });

    const row = await createSessionsRepo(db, ws.ctx).findByKey(ws.project.id, "ph:headless-1");
    expect(row?.exclusionReason).toBe("automation_headless");
  });

  test("stamps 'none' on an ordinary session with an outside email domain", async () => {
    const { ws, connection } = await seedIntakeTarget(db, "stamp-none");

    await persistPullResult(db, ws.ctx, {
      connection,
      result: successfulPull({
        sessions: [
          sourceSession({
            sessionKey: "ph:kept-1",
            identityEmailDomain: OUTSIDE_DOMAIN,
            userAgent: HEADED_UA,
          }),
        ],
        events: [sourceEvent({ sourceEventId: "evt-kept-1", sessionKey: "ph:kept-1" })],
      }),
    });

    const row = await createSessionsRepo(db, ws.ctx).findByKey(ws.project.id, "ph:kept-1");
    // "none" means CLASSIFIED AND KEPT — never "not classified".
    expect(row?.exclusionReason).toBe("none");
  });

  test("stamps 'none' on an unresolved identity — a session we could not check is still kept", async () => {
    const { ws, connection } = await seedIntakeTarget(db, "stamp-unresolved");

    await persistPullResult(db, ws.ctx, {
      connection,
      result: successfulPull({
        sessions: [
          sourceSession({
            sessionKey: "ph:unresolved-1",
            identityEmailDomain: null,
            identityResolution: "unresolved",
            userAgent: HEADED_UA,
          }),
        ],
        events: [sourceEvent({ sourceEventId: "evt-unresolved-1", sessionKey: "ph:unresolved-1" })],
      }),
    });

    const row = await createSessionsRepo(db, ws.ctx).findByKey(ws.project.id, "ph:unresolved-1");
    // F-8: fail open, and keep the gap visible via `identity_resolution`
    // rather than by excluding.
    expect(row?.exclusionReason).toBe("none");
    expect(row?.identityResolution).toBe("unresolved");
  });

  test("records the stamp's provenance and both versions on every session row", async () => {
    const { ws, connection } = await seedIntakeTarget(db, "stamp-provenance");

    await persistPullResult(db, ws.ctx, {
      connection,
      result: successfulPull({
        sessions: [sourceSession({ sessionKey: "ph:provenance-1" })],
        events: [sourceEvent({ sourceEventId: "evt-provenance-1", sessionKey: "ph:provenance-1" })],
      }),
    });

    const row = await createSessionsRepo(db, ws.ctx).findByKey(ws.project.id, "ph:provenance-1");

    // The provenance of the stamp — what the classifier SAW at stamp time,
    // not the project's current domain. Reproducing a stamp needs this.
    expect(row?.internalDomainAtStamp).toBe(INTERNAL_DOMAIN);
    expect(row?.exclusionRuleSetVersion).toBe(EXCLUSION_RULE_SET_VERSION);
    expect(row?.groupingVersion).toBe(SESSION_GROUPING_VERSION);
    expect(row?.origin).toBe("real");
  });

  test("never persists an email address — only its domain crosses into storage", async () => {
    const { ws, connection } = await seedIntakeTarget(db, "domain-only");

    await persistPullResult(db, ws.ctx, {
      connection,
      result: successfulPull({
        sessions: [
          sourceSession({ sessionKey: "ph:domain-only-1", identityEmailDomain: OUTSIDE_DOMAIN }),
        ],
        events: [
          sourceEvent({ sourceEventId: "evt-domain-only-1", sessionKey: "ph:domain-only-1" }),
        ],
      }),
    });

    const row = await createSessionsRepo(db, ws.ctx).findByKey(ws.project.id, "ph:domain-only-1");
    expect(row?.identityEmailDomain).toBe(OUTSIDE_DOMAIN);
    expect(JSON.stringify(row)).not.toContain("@");
  });

  // --- item 97 -------------------------------------------------------------

  test("re-running the classifier over persisted rows reproduces every stored stamp exactly, with no source access", async () => {
    const { ws, connection } = await seedIntakeTarget(db, "reproducible");

    await persistPullResult(db, ws.ctx, {
      connection,
      result: successfulPull({
        sessions: [
          sourceSession({
            sessionKey: "ph:repro-kept",
            identityEmailDomain: OUTSIDE_DOMAIN,
            userAgent: HEADED_UA,
          }),
          sourceSession({
            sessionKey: "ph:repro-internal",
            identityEmailDomain: INTERNAL_DOMAIN,
            userAgent: HEADED_UA,
          }),
          sourceSession({
            sessionKey: "ph:repro-headless",
            identityEmailDomain: null,
            identityResolution: "unresolved",
            userAgent: HEADLESS_UA,
          }),
        ],
        events: [
          sourceEvent({ sourceEventId: "evt-repro-1", sessionKey: "ph:repro-kept" }),
          sourceEvent({ sourceEventId: "evt-repro-2", sessionKey: "ph:repro-internal" }),
          sourceEvent({ sourceEventId: "evt-repro-3", sessionKey: "ph:repro-headless" }),
        ],
      }),
    });

    const rows = await createSessionsRepo(db, ws.ctx).listForProject(ws.project.id, { limit: 50 });
    expect(rows).toHaveLength(3);

    for (const row of rows) {
      const rules = EXCLUSION_RULE_SETS.get(row.exclusionRuleSetVersion);
      expect(rules).toBeDefined();
      if (!rules) throw new Error("unreachable");

      // Every input rebuilt from PERSISTED COLUMNS ONLY. Nothing is re-fetched
      // and no vendor client exists in this file — that is the whole property
      // the future backfill depends on.
      const facts: SessionFacts = {
        identityEmailDomain: row.identityEmailDomain,
        identityResolution: row.identityResolution,
        internalDomain: row.internalDomainAtStamp,
        userAgent: row.userAgent,
      };

      expect(classifyExclusion(facts, rules)).toBe(row.exclusionReason);
    }
  });

  test("the stamped rule-set version is resolvable, so a stamp can be reproduced under the rules that wrote it", async () => {
    const { ws, connection } = await seedIntakeTarget(db, "rules-resolvable");

    await persistPullResult(db, ws.ctx, {
      connection,
      result: successfulPull({
        sessions: [sourceSession({ sessionKey: "ph:rules-1" })],
        events: [sourceEvent({ sourceEventId: "evt-rules-1", sessionKey: "ph:rules-1" })],
      }),
    });

    const row = await createSessionsRepo(db, ws.ctx).findByKey(ws.project.id, "ph:rules-1");
    expect(row).not.toBeNull();
    if (!row) throw new Error("unreachable");

    expect(EXCLUSION_RULE_SETS.get(row.exclusionRuleSetVersion)).toBe(CURRENT_EXCLUSION_RULE_SET);
  });

  // --- the normalisation stamp asserts, it does not assume (M-1) -----------

  test("stamps the normalisation version only on a path that is already normalised, and null on one that is not", async () => {
    const { ws, connection } = await seedIntakeTarget(db, "normalisation-stamp");

    // An UN-NORMALISED path, in the exact shape the stamp exists to protect:
    // an identifier-shaped segment `normaliseUrlPath` would redact. The value
    // is an all-zero placeholder uuid — obviously fake, authenticates nothing,
    // and this repository is public. A second source adapter forwarding a raw
    // `$current_url` produces exactly this shape.
    const unnormalised = "/reset-password/00000000-0000-4000-8000-000000000000";

    // ANTI-VACUITY: if a later normalisation change made this fixture already
    // normalised, the assertion below would pass for the wrong reason. Pin the
    // premise rather than trusting it.
    expect(normaliseUrlPath(unnormalised, null)).not.toBe(unnormalised);

    await persistPullResult(db, ws.ctx, {
      connection,
      result: successfulPull({
        sessions: [sourceSession({ sessionKey: "ph:norm-1" })],
        events: [
          sourceEvent({
            sourceEventId: "evt-norm-raw",
            sessionKey: "ph:norm-1",
            urlPath: unnormalised,
          }),
          sourceEvent({
            sourceEventId: "evt-norm-clean",
            sessionKey: "ph:norm-1",
            urlPath: "/pricing",
          }),
          sourceEvent({ sourceEventId: "evt-norm-nopath", sessionKey: "ph:norm-1", urlPath: null }),
        ],
      }),
    });

    const rows = await createEventsRepo(db, ws.ctx).listForProject(ws.project.id, { limit: 50 });
    const byId = new Map(rows.map((row) => [row.sourceEventId, row]));
    expect(byId.size).toBe(3);

    // The whole point: `null` means "redaction status unknown, remediate me",
    // and IS selected by the §5 remediation query
    // (`WHERE url_path_normalisation_version IS NULL OR < N`). A version stamp
    // on this row would hide a live token from that query permanently.
    expect(byId.get("evt-norm-raw")?.urlPathNormalisationVersion).toBeNull();
    // FAIL DIRECTION: flagged, never dropped. Intake is a write path, so an
    // un-normalised path costs a remediation flag, not the event.
    expect(byId.get("evt-norm-raw")?.urlPath).toBe(unnormalised);

    // Its siblings in the SAME batch are unaffected — the stamp is per-value,
    // not per-write.
    expect(byId.get("evt-norm-clean")?.urlPathNormalisationVersion).toBe(
      URL_PATH_NORMALISATION_VERSION,
    );
    // A no-path row still carries the version (D-15): `NULL` in this column
    // must keep meaning exactly one thing.
    expect(byId.get("evt-norm-nopath")?.urlPath).toBeNull();
    expect(byId.get("evt-norm-nopath")?.urlPathNormalisationVersion).toBe(
      URL_PATH_NORMALISATION_VERSION,
    );
  });

  // --- partial progress ----------------------------------------------------

  test("a FAILED pull still persists its partial sessions and events", async () => {
    const { ws, connection } = await seedIntakeTarget(db, "partial-progress");

    const counts = await persistPullResult(db, ws.ctx, {
      connection,
      result: failedPull({
        failure: { code: "rate_limited", message: "We had to slow down and will try again." },
        partialSessions: [sourceSession({ sessionKey: "ph:partial-1" })],
        partialEvents: [
          sourceEvent({ sourceEventId: "evt-partial-1", sessionKey: "ph:partial-1" }),
          sourceEvent({ sourceEventId: "evt-partial-2", sessionKey: "ph:partial-1" }),
        ],
      }),
    });

    // The walk is newest-first, so a mid-walk failure has ALREADY retrieved
    // the newest events. Throwing them away would make FR-22's "partial
    // progress survives" a hope rather than a guarantee.
    expect(counts.eventsPersisted).toBe(2);
    expect(counts.sessionsTouched).toBe(1);

    const events = await createEventsRepo(db, ws.ctx).listForProject(ws.project.id, { limit: 50 });
    expect(events.map((e) => e.sourceEventId).toSorted()).toEqual([
      "evt-partial-1",
      "evt-partial-2",
    ]);
  });

  test("reports the malformed drop count it was handed rather than swallowing it", async () => {
    const { ws, connection } = await seedIntakeTarget(db, "dropped-count");

    const counts = await persistPullResult(db, ws.ctx, {
      connection,
      result: successfulPull({
        sessions: [sourceSession({ sessionKey: "ph:dropped-1" })],
        events: [sourceEvent({ sourceEventId: "evt-dropped-1", sessionKey: "ph:dropped-1" })],
        droppedMalformed: 3,
      }),
    });

    expect(counts.eventsDroppedMalformed).toBe(3);
    expect(counts.eventsReceived).toBe(1);
  });

  test("an empty pull is a clean no-op that still reports zeroed counts", async () => {
    const { ws, connection } = await seedIntakeTarget(db, "empty-pull");

    const counts = await persistPullResult(db, ws.ctx, {
      connection,
      result: successfulPull({ sessions: [], events: [] }),
    });

    expect(counts).toEqual({
      eventsReceived: 0,
      eventsPersisted: 0,
      sessionsTouched: 0,
      eventsDroppedMalformed: 0,
    });
  });
});
