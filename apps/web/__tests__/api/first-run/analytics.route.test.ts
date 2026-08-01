// POST /api/first-run/analytics/{connect,disconnect} — step two's front door.
// Wave 0f, task 0f.2. ADD §9, 10 rows (9 at taskgen + AD-16a's unknown-key row).
//
// ###########################################################################
// # WHAT THIS FILE IS AND IS NOT TESTING.
// #
// # `createConnectionsService` is SHIPPED and has its own suite
// # (`packages/db/__tests__/services/connections.service.test.ts`). This
// # sprint builds the FRONT DOOR to it and reimplements nothing. So every row
// # here is about the DOOR: what a customer can send through it (nothing
// # tenancy-shaped, AD-16), what comes back out of it (a sentence from our
// # table, never vendor text, never a credential), and who the effect reaches
// # (the ORG, not the actor — FR-O9's D1 answer, said out loud).
// #
// # THE ONE THING THAT WOULD BE INVISIBLE WITHOUT THESE ROWS: the refusal
// # boundary. `connections.service.ts:154-165` states why the source's own
// # `message` is DROPPED rather than scrubbed — "a leaky upstream can echo a
// # key back URL-encoded, JSON-escaped or truncated, three forms an exact-
// # string scrub misses. Only the CODE crosses this boundary." A route that
// # forwards `refusal.message` verbatim looks correct, passes a happy-path
// # test, and re-opens that hole the first time a vendor echoes the key.
// # `no vendor text reaches the response in any encoding` is that row, and it
// # plants a real vendor marker AND a real key in the failure to prove it.
// ###########################################################################
//
// Lane prefix `web-fr-analytics`.
import { schema } from "@growthmind/db";
import {
  CONNECTION_STATE_MESSAGES,
  CONNECT_REFUSAL_MESSAGES,
  connectRefusalCodeSchema,
  connectionStateSchema,
  type ConnectRefusalCode,
  type ConnectionStateStatus,
  type CredentialKeyResolution,
  type SessionSourcePullResult,
  type SessionSourceValidation,
  type SourceFailureCode,
} from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  seedEvent,
  seedPollRun,
  seedSession,
} from "../../../../../packages/db/__tests__/helpers/db-lane-fixtures";
import {
  bodyOf,
  clockAt,
  collectStrings,
  createFirstRunTestBed,
  leaks,
  loadRouteHandler,
  loadRouteInputSchema,
  routeById,
  routeRequest,
  tenantOf,
  verifyRefusesUnknownKey,
  type FirstRunRouteDeps,
  type FirstRunTestBed,
  type SeededMemberScope,
} from "./helpers/first-run-route-contract";

const CONNECT = routeById("analytics-connect");
const DISCONNECT = routeById("analytics-disconnect");
const STATUS = routeById("status");
const CLOCK = clockAt(new Date("2026-08-01T10:00:00.000Z"));

/** The healthy resolution: a real 32-byte key. Never a real secret — the
 *  bytes are constant and this repository is public. */
const HEALTHY_KEY: CredentialKeyResolution = {
  ok: true,
  key: { bytes: new Uint8Array(32).fill(7) },
};

/** The insecure-defaults refusal `resolveCredentialKey` produces in prod on a
 *  key nobody replaced. The gate is INHERITED, never re-derived here. */
const INSECURE_KEY: CredentialKeyResolution = { ok: false, reason: "insecure_default_key" };

const PERSONAL_API_KEY = "phx_onboarding_fixture_key_do_not_use_anywhere";

/**
 * Text only the VENDOR would ever produce, planted on every fake failure.
 *
 * Two markers, not one: a stack-shaped line and a vendor-branded sentence. The
 * shipped bar is that no vendor text reaches a customer surface, and a route
 * that scrubbed only the obvious brand name would still forward the trace.
 */
const VENDOR_TEXT = `PostHogApiError: 401 at /api/projects/00000/query — token ${PERSONAL_API_KEY}`;

let bed: FirstRunTestBed;
let owner: SeededMemberScope;
let teammate: SeededMemberScope;
let otherOrg: SeededMemberScope;

beforeAll(async () => {
  bed = await createFirstRunTestBed("analytics");
  owner = await bed.member("owner");
  // EC-O2 / FR-O9's D1 cell: the teammate who set nothing up, in the SAME org.
  teammate = await bed.member("mate", owner.organizationId);
  otherOrg = await bed.member("other");
});

afterAll(async () => {
  await bed?.close();
});

// ---------------------------------------------------------------------------
// The injected source — the ONLY impure thing in the connect flow
// ---------------------------------------------------------------------------

interface FakeSourceLog {
  /** Every config the route handed the factory. Empty ⇒ no request was made. */
  readonly configs: Record<string, unknown>[];
  /** How many times `validate()` actually ran. */
  validations: number;
}

/**
 * A source factory that fails validation with a chosen code AND a vendor
 * message. The log is what `a misconfigured installation makes no request and
 * writes no row` reads: a factory never called is a request never made.
 */
function fakeSource(code: SourceFailureCode | null, log: FakeSourceLog) {
  return (config: Record<string, unknown>) => {
    log.configs.push(config);
    return {
      validate: async (): Promise<SessionSourceValidation> => {
        log.validations += 1;
        return code === null
          ? { ok: true, checkedAt: CLOCK() }
          : { ok: false, checkedAt: CLOCK(), failure: { code, message: VENDOR_TEXT } };
      },
      pull: async (): Promise<SessionSourcePullResult> => ({
        ok: true,
        sessions: [],
        events: [],
        contiguous: true,
        resumeBefore: null,
        pagesFetched: 0,
        eventsReceived: 0,
        identityLookupsUsed: 0,
        newestObservedAt: null,
        droppedMalformed: 0,
      }),
    };
  };
}

function emptyLog(): FakeSourceLog {
  return { configs: [], validations: 0 };
}

function depsFor(
  scope: SeededMemberScope | null,
  extra?: Partial<FirstRunRouteDeps>,
): FirstRunRouteDeps {
  return {
    db: bed.db,
    tenant: tenantOf(scope?.ctx ?? null),
    now: CLOCK,
    // The healthy default: a real 32-byte key, resolved. Rows that need the
    // insecure-defaults refusal override it.
    credentialKey: HEALTHY_KEY,
    ...extra,
  };
}

/** The org's project id, AS THE ROUTE PROVISIONS IT (see status.route.test.ts's
 *  header on why a hand-seeded `projects` row would fork under AD-7). */
const provisioned = new Map<string, Promise<string>>();
function projectFor(scope: SeededMemberScope): Promise<string> {
  const existing = provisioned.get(scope.organizationId);
  if (existing) return existing;
  const pending = (async () => {
    const handle = await loadRouteHandler(STATUS);
    await handle(routeRequest(STATUS), depsFor(scope));
    const rows = await bed.db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, scope.organizationId));
    if (rows.length !== 1) {
      throw new Error(
        `expected the first-run routes to provision EXACTLY ONE project per org (FR-O1, AD-7), found ${rows.length}`,
      );
    }
    return rows[0]!.id;
  })();
  provisioned.set(scope.organizationId, pending);
  return pending;
}

/** A connection row in a chosen health, for the seven-state rows. */
async function seedConnectionRow(
  scope: SeededMemberScope,
  projectId: string,
  health: "validating" | "healthy" | "failing" | "disconnected",
  isActive = true,
): Promise<string> {
  const id = randomUUID();
  await bed.db.insert(schema.projectConnections).values({
    id,
    organizationId: scope.organizationId,
    projectId,
    sourceKind: "posthog",
    host: "https://eu.posthog.example.invalid",
    sourceProjectId: "00000",
    credentialCiphertext: "v1.00000000.aaaa.bbbb.cccc",
    credentialKeyId: "00000000",
    isActive,
    health,
    watermarkAt: null,
    nextPollAt: new Date(),
    pollIntervalSeconds: 60,
  });
  return id;
}

/** The `status` field of whatever connection state the status route reports. */
async function connectionStatusFor(scope: SeededMemberScope): Promise<ConnectionStateStatus> {
  const handle = await loadRouteHandler(STATUS);
  const body = await bodyOf(await handle(routeRequest(STATUS), depsFor(scope)));
  return findConnectionStatus(body);
}

/**
 * Finds the `ConnectionState` anywhere in a payload and returns its `status`.
 *
 * DELIBERATELY A SEARCH RATHER THAN A PATH. AD-3 fixes the counter view's
 * shape but the ADD never states where `FirstRunStatus` hangs it, and a row
 * that asserted a path would be asserting this test's guess. What the row
 * actually claims is that the SEVEN STATES ARE NEVER COLLAPSED — which the
 * discriminant answers wherever it sits.
 */
function findConnectionStatus(value: unknown): ConnectionStateStatus {
  const found = searchForState(value);
  if (!found) {
    throw new Error(
      `no ConnectionState found anywhere in the payload — FR-O6 needs the seven states to reach ` +
        `the wire distinctly, and this response carries none: ${JSON.stringify(value).slice(0, 400)}`,
    );
  }
  return found;
}

function searchForState(value: unknown): ConnectionStateStatus | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = searchForState(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object" && value !== null) {
    const parsed = connectionStateSchema.safeParse(value);
    if (parsed.success) return parsed.data.status;
    for (const child of Object.values(value)) {
      const found = searchForState(child);
      if (found) return found;
    }
  }
  return null;
}

// ===========================================================================

describe("POST /api/first-run/analytics/connect (FR-O5, FR-O6, AD-16)", () => {
  // ------------------------------------------------------------------ row 1
  test("each connect refusal code renders its own distinct sentence", async () => {
    const handle = await loadRouteHandler(CONNECT);
    const rendered = new Map<ConnectRefusalCode, string>();

    // ALL SIX codes. `second_source` is the one no fake source can produce —
    // the partial unique index refuses it — so it is driven by connecting
    // twice, which is also the only honest way to reach it.
    for (const code of [
      "invalid_credentials",
      "project_not_found",
      "unreachable",
      "rate_limited",
      "misconfigured",
    ] as const) {
      const scope = await bed.member(`refusal-${code}`);
      const deps =
        code === "misconfigured"
          ? depsFor(scope, {
              createSource: fakeSource(null, emptyLog()),
              credentialKey: INSECURE_KEY,
            })
          : depsFor(scope, { createSource: fakeSource(code, emptyLog()) });

      const body = await bodyOf(await handle(routeRequest(CONNECT, CONNECT.validBody), deps));
      const sentence = collectStrings(body).find((value) =>
        Object.values(CONNECT_REFUSAL_MESSAGES).includes(value),
      );
      if (!sentence) {
        throw new Error(
          `${code}: the response carried no sentence from CONNECT_REFUSAL_MESSAGES — the code ` +
            `crosses the boundary, the sentence comes from our table: ${JSON.stringify(body)}`,
        );
      }
      rendered.set(code, sentence);
    }

    // The sixth: a second source for one project.
    const second = await bed.member("refusal-second");
    const okDeps = depsFor(second, { createSource: fakeSource(null, emptyLog()) });
    await handle(routeRequest(CONNECT, CONNECT.validBody), okDeps);
    const secondBody = await bodyOf(
      await handle(
        routeRequest(CONNECT, { ...CONNECT.validBody, sourceProjectId: "11111" }),
        okDeps,
      ),
    );
    const secondSentence = collectStrings(secondBody).find((value) =>
      value.includes("already attached"),
    );
    expect(secondSentence).toBeDefined();
    rendered.set("second_source", secondSentence!);

    // SIX CODES, SIX DISTINCT STRINGS. A route that collapsed two of them
    // would leave a customer with no way to tell "the key is wrong" from
    // "the project number is wrong" — two different things to go and fix.
    expect(rendered.size).toBe(connectRefusalCodeSchema.options.length);
    expect(new Set(rendered.values()).size).toBe(rendered.size);
  });

  // ------------------------------------------------------------------ row 2
  test("no vendor text reaches the response in any encoding", async () => {
    const handle = await loadRouteHandler(CONNECT);
    const scope = await bed.member("vendor");
    const response = await handle(
      routeRequest(CONNECT, CONNECT.validBody),
      depsFor(scope, { createSource: fakeSource("invalid_credentials", emptyLog()) }),
    );
    const raw = await response.text();

    // The CODE crosses the boundary; the SENTENCE comes from our table.
    expect(raw).toContain(CONNECT_REFUSAL_MESSAGES.invalid_credentials);

    // And the vendor's own text does not, in ANY encoding — the exact-string
    // scrub `connections.service.ts:154-165` says is insufficient is not what
    // this asserts, because it checks the encoded forms too.
    expect(leaks(raw, VENDOR_TEXT)).toBeNull();
    expect(raw).not.toContain("PostHogApiError");
    expect(raw).not.toContain("/api/projects/");
    expect(raw).not.toMatch(/:\d+:\d+/);
  });

  // ------------------------------------------------------------------ row 3
  test("a project id belonging to another org is refused, not served", async () => {
    const foreignProject = await projectFor(otherOrg);
    const handle = await loadRouteHandler(CONNECT);
    const log = emptyLog();

    // AD-16's strictly-stronger form: FR-O24 asked for a client-supplied
    // projectId to be resolved against the caller's org. This route does not
    // accept one at all, so the refusal happens at the SCHEMA — before any
    // query, and before the source factory is ever reached.
    const schemaUnderTest = await loadRouteInputSchema(CONNECT);
    const verdict = verifyRefusesUnknownKey(schemaUnderTest, CONNECT.validBody, "projectId");
    if (!verdict.ok) throw new Error(verdict.why);

    const response = await handle(
      routeRequest(CONNECT, { ...CONNECT.validBody, projectId: foreignProject }),
      depsFor(owner, { createSource: fakeSource(null, log) }),
    );

    expect(response.status).toBe(400);
    // REFUSED, NOT SERVED: no request was made and no row was written against
    // the other org's project.
    expect(log.validations).toBe(0);
    const rows = await bed.db
      .select({ id: schema.projectConnections.id })
      .from(schema.projectConnections)
      .where(eq(schema.projectConnections.projectId, foreignProject));
    expect(rows).toEqual([]);
  });

  // ------------------------------------------------------------------ row 8
  test("a misconfigured installation makes no request and writes no row", async () => {
    const handle = await loadRouteHandler(CONNECT);
    const scope = await bed.member("insecure");
    const log = emptyLog();

    // THE INHERITED GATE, NOT A REIMPLEMENTATION. A prior audit found a
    // CRITICAL bypass where a normalising gate compared the RAW value while
    // encryption used the NORMALISED one; nothing here re-derives the check,
    // it branches on `resolveCredentialKey`'s result — checked FIRST and
    // UNCONDITIONALLY, before the factory and before any write.
    const response = await handle(
      routeRequest(CONNECT, CONNECT.validBody),
      depsFor(scope, {
        createSource: fakeSource(null, log),
        credentialKey: INSECURE_KEY,
      }),
    );

    const raw = await response.text();
    expect(raw).toContain(CONNECT_REFUSAL_MESSAGES.misconfigured);

    // NO REQUEST: the factory was never even constructed.
    expect(log.configs).toEqual([]);
    expect(log.validations).toBe(0);

    // NO ROW: storing a customer's secret does not succeed when it cannot be
    // stored safely. Boot still works; this one operation does not.
    const projectId = await projectFor(scope);
    const rows = await bed.db
      .select({ id: schema.projectConnections.id })
      .from(schema.projectConnections)
      .where(eq(schema.projectConnections.projectId, projectId));
    expect(rows).toEqual([]);
  });

  // ------------------------------------------------------------------ row 9
  test("the personal api key never appears in the response, a log, or a thrown value", async () => {
    const handle = await loadRouteHandler(CONNECT);
    const scope = await bed.member("key-leak");
    const captured: string[] = [];

    // ALL THREE CONSOLE METHODS, captured through a key loop rather than three
    // named member expressions — the repo's lint forbids `console.log` even in
    // a restore, and a row that logged its way around that would be silencing
    // the very surface it exists to inspect.
    const consoleRef = console as unknown as Record<string, (...args: unknown[]) => void>;
    const METHODS = ["log", "warn", "error", "info", "debug"] as const;
    const originals = new Map<string, (...args: unknown[]) => void>();
    for (const method of METHODS) {
      originals.set(method, consoleRef[method]!);
      consoleRef[method] = (...args: unknown[]) => void captured.push(args.map(String).join(" "));
    }

    let thrown: unknown = null;
    let raw = "";
    try {
      const response = await handle(
        routeRequest(CONNECT, { ...CONNECT.validBody, personalApiKey: PERSONAL_API_KEY }),
        depsFor(scope, { createSource: fakeSource("invalid_credentials", emptyLog()) }),
      );
      raw = await response.text();
    } catch (error) {
      thrown = error;
    } finally {
      for (const method of METHODS) {
        consoleRef[method] = originals.get(method)!;
      }
    }

    // THREE SURFACES, ONE RULE (FR-7, inherited). A key on a thrown value is
    // the one people forget: it reaches an error reporter, not a screen, and
    // is invisible to a response-only assertion.
    expect(leaks(raw, PERSONAL_API_KEY)).toBeNull();
    expect(leaks(captured.join("\n"), PERSONAL_API_KEY)).toBeNull();
    expect(
      leaks(
        thrown === null ? "" : `${String(thrown)}\n${JSON.stringify(thrown)}`,
        PERSONAL_API_KEY,
      ),
    ).toBeNull();
  });

  // ----------------------------------------------------------------- row 10
  test("an unknown body key rejects with a 4xx, never a 500 and never a 200", async () => {
    // AD-16a ON A ROUTE THAT ACTUALLY PARSES A BODY. A body carrying
    // `projectId` BESIDE the real fields must return 400 — not a 200 with the
    // key quietly stripped, which is exactly what a plain `z.object()` does.
    const handle = await loadRouteHandler(CONNECT);
    const scope = await bed.member("unknown-key");
    const log = emptyLog();

    for (const route of [CONNECT, DISCONNECT]) {
      const response = await (
        await loadRouteHandler(route)
      )(
        routeRequest(route, { ...route.validBody, projectId: "someone-elses-project" }),
        depsFor(scope, { createSource: fakeSource(null, log) }),
      );
      expect(`${route.id}:${response.status}`).toBe(`${route.id}:400`);
    }

    // And the refusal is OUR sentence, never zod's.
    const body = await bodyOf(
      await handle(
        routeRequest(CONNECT, { ...CONNECT.validBody, projectId: "someone-elses-project" }),
        depsFor(scope, { createSource: fakeSource(null, log) }),
      ),
    );
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Unrecognized key");
    expect(serialized).not.toContain("ZodError");
    expect(serialized).not.toContain("invalid_type");
  });
});

describe("the seven connection states, never collapsed (FR-O6, UX §3)", () => {
  // ------------------------------------------------------------------ row 4
  test("not_connected, connected_never_polled and connected_no_events_yet render three different sentences", async () => {
    // THE THREE A NAIVE IMPLEMENTATION COLLAPSES. All three are a zero, and
    // they are three different answers to it: "nothing is attached", "we have
    // not looked yet", and "we looked and your product was quiet". Only one of
    // them is a reason to go and check the key.
    const none = await bed.member("state-none");
    const neverPolled = await bed.member("state-never");
    const noEvents = await bed.member("state-quiet");

    await seedConnectionRow(neverPolled, await projectFor(neverPolled), "healthy");

    const quietProject = await projectFor(noEvents);
    const quietConnection = await seedConnectionRow(noEvents, quietProject, "healthy");
    await seedPollRun(bed.db, {
      organizationId: noEvents.organizationId,
      projectId: quietProject,
      connectionId: quietConnection,
      status: "completed",
      eventsPersisted: 0,
    });

    const statuses = [
      await connectionStatusFor(none),
      await connectionStatusFor(neverPolled),
      await connectionStatusFor(noEvents),
    ];

    expect(statuses).toEqual([
      "not_connected",
      "connected_never_polled",
      "connected_no_events_yet",
    ]);

    // Three states, three sentences from the one home. NEVER COLLAPSED.
    const sentences = statuses.map((status) => CONNECTION_STATE_MESSAGES[status]);
    expect(new Set(sentences).size).toBe(3);
  });

  // ------------------------------------------------------------------ row 5
  test("all seven connection states render distinctly", async () => {
    const seen: ConnectionStateStatus[] = [];

    // 1. no row at all
    seen.push(await connectionStatusFor(await bed.member("s-not-connected")));

    // 2. validating / 3. failing / 4. disconnected — health drives all three,
    //    and deactivation wins over health (the order is the ONE order that
    //    makes the seven pairwise exclusive).
    for (const [label, health, isActive, expected] of [
      ["s-validating", "validating", true, "validating"],
      ["s-failing", "failing", true, "failing"],
      ["s-disconnected", "healthy", false, "disconnected"],
    ] as const) {
      const scope = await bed.member(label);
      await seedConnectionRow(scope, await projectFor(scope), health, isActive);
      const status = await connectionStatusFor(scope);
      expect(`${label}:${status}`).toBe(`${label}:${expected}`);
      seen.push(status);
    }

    // 5. healthy, no completed poll
    const never = await bed.member("s-never-polled");
    await seedConnectionRow(never, await projectFor(never), "healthy");
    seen.push(await connectionStatusFor(never));

    // 6. healthy, polled, no events
    const quiet = await bed.member("s-quiet");
    const quietProject = await projectFor(quiet);
    const quietConnection = await seedConnectionRow(quiet, quietProject, "healthy");
    await seedPollRun(bed.db, {
      organizationId: quiet.organizationId,
      projectId: quietProject,
      connectionId: quietConnection,
      status: "completed",
      eventsPersisted: 0,
    });
    seen.push(await connectionStatusFor(quiet));

    // 7. healthy, polled, events arriving
    const receiving = await bed.member("s-receiving");
    const receivingProject = await projectFor(receiving);
    const receivingConnection = await seedConnectionRow(receiving, receivingProject, "healthy");
    await seedPollRun(bed.db, {
      organizationId: receiving.organizationId,
      projectId: receivingProject,
      connectionId: receivingConnection,
      status: "completed",
      eventsPersisted: 1,
    });
    const session = await seedSession(bed.db, {
      organizationId: receiving.organizationId,
      projectId: receivingProject,
      connectionId: receivingConnection,
      sessionKey: `web-fr-analytics-${randomUUID()}`,
    });
    await seedEvent(bed.db, {
      organizationId: receiving.organizationId,
      projectId: receivingProject,
      connectionId: receivingConnection,
      sessionId: session.id,
      sourceEventId: `web-fr-analytics-${randomUUID()}`,
    });
    seen.push(await connectionStatusFor(receiving));

    // SEVEN SCENARIOS, SEVEN DISTINCT STATES, SEVEN DISTINCT SENTENCES. A
    // screen can never land in an "I don't know what this is" branch.
    expect(new Set(seen).size).toBe(7);
    expect(new Set(seen.map((status) => CONNECTION_STATE_MESSAGES[status])).size).toBe(7);
  });
});

describe("POST /api/first-run/analytics/disconnect (FR-O9, EC-O1, EC-O2)", () => {
  // ------------------------------------------------------------------ row 6
  test("disconnect deactivates for every member of the org, not the actor's view", async () => {
    // THE D1 AUDIENCE QUESTION, ANSWERED OUT LOUD. The resource is ORG-scoped,
    // so revocation is ORG-WIDE — and the proof is a SECOND MEMBER'S READ,
    // never the actor's own. A route that deactivated "the actor's view"
    // would pass every single-actor test ever written.
    const projectId = await projectFor(owner);
    await seedConnectionRow(owner, projectId, "healthy");

    expect(await connectionStatusFor(teammate)).toBe("connected_never_polled");

    const disconnect = await loadRouteHandler(DISCONNECT);
    await disconnect(routeRequest(DISCONNECT, {}), depsFor(owner));

    // The teammate who did not act, and did not set anything up, sees it.
    expect(await connectionStatusFor(teammate)).toBe("disconnected");

    // And the row itself is deactivated, not deleted.
    const rows = await bed.db
      .select({ isActive: schema.projectConnections.isActive })
      .from(schema.projectConnections)
      .where(eq(schema.projectConnections.projectId, projectId));
    expect(rows.map((row) => row.isActive)).toEqual([false]);

    // D7: another org's connection is untouched by any of this.
    expect(await connectionStatusFor(otherOrg)).toBe("not_connected");
  });

  // ------------------------------------------------------------------ row 7
  test("disconnect states that everything already collected is kept", async () => {
    const scope = await bed.member("kept");
    await seedConnectionRow(scope, await projectFor(scope), "healthy");

    const disconnect = await loadRouteHandler(DISCONNECT);
    const response = await disconnect(routeRequest(DISCONNECT, {}), depsFor(scope));
    const raw = await response.text();

    // THE SHIPPED SENTENCE, verbatim and entire. A customer pressing disconnect
    // is asking "do I lose my data?" and the answer has to be in the response,
    // not in a doc — the sentence already exists and is imported, not rewritten.
    expect(raw).toContain(CONNECTION_STATE_MESSAGES.disconnected);
    expect(CONNECTION_STATE_MESSAGES.disconnected).toContain("still here");
  });
});
