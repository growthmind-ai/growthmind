import { eq, schema } from "@growthmind/db";
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

const HEALTHY_KEY: CredentialKeyResolution = {
  ok: true,
  key: { bytes: new Uint8Array(32).fill(7) },
};

const INSECURE_KEY: CredentialKeyResolution = { ok: false, reason: "insecure_default_key" };

const PERSONAL_API_KEY = "phx_onboarding_fixture_key_do_not_use_anywhere";

const VENDOR_TEXT = `PostHogApiError: 401 at /api/projects/00000/query — token ${PERSONAL_API_KEY}`;

let bed: FirstRunTestBed;
let owner: SeededMemberScope;
let teammate: SeededMemberScope;
let otherOrg: SeededMemberScope;

beforeAll(async () => {
  bed = await createFirstRunTestBed("analytics");
  owner = await bed.member("owner");

  teammate = await bed.member("mate", owner.organizationId);
  otherOrg = await bed.member("other");
});

afterAll(async () => {
  await bed?.close();
});

interface FakeSourceLog {
  readonly configs: Record<string, unknown>[];

  validations: number;
}

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

    credentialKey: HEALTHY_KEY,
    ...extra,
  };
}

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

async function connectionStatusFor(scope: SeededMemberScope): Promise<ConnectionStateStatus> {
  const handle = await loadRouteHandler(STATUS);
  const body = await bodyOf(await handle(routeRequest(STATUS), depsFor(scope)));
  return findConnectionStatus(body);
}

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

describe("POST /api/first-run/analytics/connect (FR-O5, FR-O6, AD-16)", () => {
  test("each connect refusal code renders its own distinct sentence", async () => {
    const handle = await loadRouteHandler(CONNECT);
    const rendered = new Map<ConnectRefusalCode, string>();

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

    expect(rendered.size).toBe(connectRefusalCodeSchema.options.length);
    expect(new Set(rendered.values()).size).toBe(rendered.size);
  });

  test("no vendor text reaches the response in any encoding", async () => {
    const handle = await loadRouteHandler(CONNECT);
    const scope = await bed.member("vendor");
    const response = await handle(
      routeRequest(CONNECT, CONNECT.validBody),
      depsFor(scope, { createSource: fakeSource("invalid_credentials", emptyLog()) }),
    );
    const raw = await response.text();

    expect(raw).toContain(CONNECT_REFUSAL_MESSAGES.invalid_credentials);

    expect(leaks(raw, VENDOR_TEXT)).toBeNull();
    expect(raw).not.toContain("PostHogApiError");
    expect(raw).not.toContain("/api/projects/");
    expect(raw).not.toMatch(/:\d+:\d+/);
  });

  test("a project id belonging to another org is refused, not served", async () => {
    const foreignProject = await projectFor(otherOrg);
    const handle = await loadRouteHandler(CONNECT);
    const log = emptyLog();

    const schemaUnderTest = await loadRouteInputSchema(CONNECT);
    const verdict = verifyRefusesUnknownKey(schemaUnderTest, CONNECT.validBody, "projectId");
    if (!verdict.ok) throw new Error(verdict.why);

    const response = await handle(
      routeRequest(CONNECT, { ...CONNECT.validBody, projectId: foreignProject }),
      depsFor(owner, { createSource: fakeSource(null, log) }),
    );

    expect(response.status).toBe(400);

    expect(log.validations).toBe(0);
    const rows = await bed.db
      .select({ id: schema.projectConnections.id })
      .from(schema.projectConnections)
      .where(eq(schema.projectConnections.projectId, foreignProject));
    expect(rows).toEqual([]);
  });

  test("a misconfigured installation makes no request and writes no row", async () => {
    const handle = await loadRouteHandler(CONNECT);
    const scope = await bed.member("insecure");
    const log = emptyLog();

    const response = await handle(
      routeRequest(CONNECT, CONNECT.validBody),
      depsFor(scope, {
        createSource: fakeSource(null, log),
        credentialKey: INSECURE_KEY,
      }),
    );

    const raw = await response.text();
    expect(raw).toContain(CONNECT_REFUSAL_MESSAGES.misconfigured);

    expect(log.configs).toEqual([]);
    expect(log.validations).toBe(0);

    const projectId = await projectFor(scope);
    const rows = await bed.db
      .select({ id: schema.projectConnections.id })
      .from(schema.projectConnections)
      .where(eq(schema.projectConnections.projectId, projectId));
    expect(rows).toEqual([]);
  });

  test("the personal api key never appears in the response, a log, or a thrown value", async () => {
    const handle = await loadRouteHandler(CONNECT);
    const scope = await bed.member("key-leak");
    const captured: string[] = [];

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

    expect(leaks(raw, PERSONAL_API_KEY)).toBeNull();
    expect(leaks(captured.join("\n"), PERSONAL_API_KEY)).toBeNull();
    expect(
      leaks(
        thrown === null
          ? ""
          : `${thrown instanceof Error ? `${thrown.message}\n${thrown.stack ?? ""}` : ""}\n${JSON.stringify(thrown)}`,
        PERSONAL_API_KEY,
      ),
    ).toBeNull();
  });

  test("an unknown body key rejects with a 4xx, never a 500 and never a 200", async () => {
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
  test("not_connected, connected_never_polled and connected_no_events_yet render three different sentences", async () => {
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

    const sentences = statuses.map((status) => CONNECTION_STATE_MESSAGES[status]);
    expect(new Set(sentences).size).toBe(3);
  });

  test("all seven connection states render distinctly", async () => {
    const seen: ConnectionStateStatus[] = [];

    seen.push(await connectionStatusFor(await bed.member("s-not-connected")));

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

    const never = await bed.member("s-never-polled");
    await seedConnectionRow(never, await projectFor(never), "healthy");
    seen.push(await connectionStatusFor(never));

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

    expect(new Set(seen).size).toBe(7);
    expect(new Set(seen.map((status) => CONNECTION_STATE_MESSAGES[status])).size).toBe(7);
  });
});

describe("POST /api/first-run/analytics/disconnect (FR-O9, EC-O1, EC-O2)", () => {
  test("disconnect deactivates for every member of the org, not the actor's view", async () => {
    const projectId = await projectFor(owner);
    await seedConnectionRow(owner, projectId, "healthy");

    expect(await connectionStatusFor(teammate)).toBe("connected_never_polled");

    const disconnect = await loadRouteHandler(DISCONNECT);
    await disconnect(routeRequest(DISCONNECT, {}), depsFor(owner));

    expect(await connectionStatusFor(teammate)).toBe("disconnected");

    const rows = await bed.db
      .select({ isActive: schema.projectConnections.isActive })
      .from(schema.projectConnections)
      .where(eq(schema.projectConnections.projectId, projectId));
    expect(rows.map((row) => row.isActive)).toEqual([false]);

    expect(await connectionStatusFor(otherOrg)).toBe("not_connected");
  });

  test("disconnect states that everything already collected is kept", async () => {
    const scope = await bed.member("kept");
    await seedConnectionRow(scope, await projectFor(scope), "healthy");

    const disconnect = await loadRouteHandler(DISCONNECT);
    const response = await disconnect(routeRequest(DISCONNECT, {}), depsFor(scope));
    const raw = await response.text();

    expect(raw).toContain(CONNECTION_STATE_MESSAGES.disconnected);
    expect(CONNECTION_STATE_MESSAGES.disconnected).toContain("still here");
  });
});
