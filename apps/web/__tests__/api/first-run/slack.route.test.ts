// POST /api/first-run/slack/{connect,test,skip} — step three's front door.
// This sprint ships no in-app notification (AD-24), so the test message IS how
// the org learns who connected Slack. The degraded notice derives from the
// absence of an active connection, never from a flag. Lane `web-fr-slack`.
import { eq, schema } from "@growthmind/db";
import { POST_FAILURE_MESSAGES } from "@growthmind/shared";
import type { DeliveryPoster, PostRequest, PostResult } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

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

const CONNECT = routeById("slack-connect");
const TEST_POST = routeById("slack-test");
const SKIP = routeById("slack-skip");
const STATUS = routeById("status");
const DISCONNECT = routeById("analytics-disconnect");
const CLOCK = clockAt(new Date("2026-08-01T10:00:00.000Z"));

const BOT_TOKEN = "xoxb-onboarding-fixture-token-never-real";
const CHANNEL_ID = "C01AB2CD3EF";

const REPO_ROOT = path.join(import.meta.dir, "..", "..", "..", "..", "..");

let bed: FirstRunTestBed;
let owner: SeededMemberScope;
let teammate: SeededMemberScope;

/** For the boot, not the assertions: a cold PGlite plus two Better Auth signups
 *  measured ~5.4s, past bun's 5s default, and times out naming no route or
 *  owner. Same figure as the sibling first-run route suites. */
const COLD_BOOT_BUDGET_MS = 60_000;

beforeAll(async () => {
  bed = await createFirstRunTestBed("slack");
  owner = await bed.member("owner");

  teammate = await bed.member("mate", owner.organizationId);
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

interface RecordingPoster extends DeliveryPoster {
  readonly sent: PostRequest[];
}

function recordingPoster(result: PostResult): RecordingPoster {
  const sent: PostRequest[] = [];
  return {
    sent,
    post: async (request: PostRequest): Promise<PostResult> => {
      sent.push(request);
      return result;
    },
  };
}

const OK_POST: PostResult = { ok: true, messageRef: "1712345678.000100" };

function depsFor(
  scope: SeededMemberScope | null,
  extra?: Partial<FirstRunRouteDeps>,
): FirstRunRouteDeps {
  return {
    db: bed.db,
    tenant: tenantOf(scope?.ctx ?? null),
    now: CLOCK,
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

async function rawSlackRows(organizationId: string): Promise<Record<string, unknown>[]> {
  const result = (await bed.db.execute(
    `select * from slack_connections where organization_id = '${organizationId}'`,
  )) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

const bodyWithToken = { botToken: BOT_TOKEN, channelId: CHANNEL_ID };

/** Envelope-shaped and deliberately not openable — this repo is public, and the
 *  row below is refused before anything tries to open it. */
const HALF_CONNECTED_CIPHERTEXT = "v1.00000000.aaaa.bbbb.cccc";
const HALF_CONNECTED_KEY_ID = "00000000";

/** The mid-OAuth row: workspace attached, active, no channel chosen (AD-4).
 *  Raw SQL because the real producer is `slack/oauth/callback`, whose config and
 *  fetch seam belong to another suite; the column list matches what it writes. */
async function attachWorkspaceWithNoChannel(scope: SeededMemberScope): Promise<void> {
  await bed.db.execute(
    `insert into slack_connections
       (id, organization_id, channel_id, credential_ciphertext, credential_key_id,
        is_active, connected_by_user_id, connected_at)
     values ('${randomUUID()}', '${scope.organizationId}', NULL,
             '${HALF_CONNECTED_CIPHERTEXT}', '${HALF_CONNECTED_KEY_ID}',
             true, '${scope.userId}', '2026-08-01T09:00:00.000Z')`,
  );
}

describe("POST /api/first-run/slack/connect (FR-O10, AD-20)", () => {
  test("connecting stores an encrypted envelope and returns no credential", async () => {
    const handle = await loadRouteHandler(CONNECT);
    const response = await handle(routeRequest(CONNECT, bodyWithToken), depsFor(owner));
    const raw = await response.text();

    expect(leaks(raw, BOT_TOKEN)).toBeNull();
    expect(raw).not.toContain("credentialCiphertext");
    expect(raw).not.toContain("credential_ciphertext");
    expect(raw).not.toContain("credentialKeyId");

    const rows = await rawSlackRows(owner.organizationId);
    expect(rows.length).toBe(1);

    const ciphertext = rows[0]?.credential_ciphertext;
    const stored = typeof ciphertext === "string" ? ciphertext : "";
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored.split(".").length).toBe(5);
    expect(leaks(stored, BOT_TOKEN)).toBeNull();

    const keyId = rows[0]?.credential_key_id;
    expect(typeof keyId === "string" ? keyId : "").toMatch(/^[0-9a-f]{8}$/);
  });

  test("a second active connection for one org is refused with a named sentence", async () => {
    const scope = await bed.member("second");
    const handle = await loadRouteHandler(CONNECT);

    const first = await handle(routeRequest(CONNECT, bodyWithToken), depsFor(scope));
    expect(first.status).toBe(200);

    const second = await handle(
      routeRequest(CONNECT, { botToken: BOT_TOKEN, channelId: "C09ZZ9ZZ9ZZ" }),
      depsFor(scope),
    );

    expect(second.status).toBeLessThan(500);
    expect(second.status).not.toBe(200);

    const sentence = collectStrings(await bodyOf(second)).join(" ");
    expect(sentence.length).toBeGreaterThan(0);

    expect(sentence).not.toContain("23505");
    expect(sentence).not.toContain("slack_connections_active_org_uidx");
    expect(sentence).not.toContain("unique");

    const rows = await rawSlackRows(scope.organizationId);
    expect(rows.filter((row) => row.is_active === true).length).toBe(1);
  });

  test("an unknown body key rejects with a 4xx, never a 500 and never a 200", async () => {
    for (const route of [CONNECT, TEST_POST, SKIP]) {
      const schemaUnderTest = await loadRouteInputSchema(route);
      const verdict = verifyRefusesUnknownKey(schemaUnderTest, route.validBody, "projectId");
      if (!verdict.ok) throw new Error(`${route.path}: ${verdict.why}`);

      const response = await (
        await loadRouteHandler(route)
      )(
        routeRequest(route, { ...route.validBody, projectId: "someone-elses-project" }),
        depsFor(owner, { poster: recordingPoster(OK_POST) }),
      );
      expect(`${route.id}:${response.status}`).toBe(`${route.id}:400`);
    }
  });
});

describe("POST /api/first-run/slack/test (FR-O11, EC-O1, D8)", () => {
  test("the test message goes through the existing DeliveryPoster port", async () => {
    for (const manifest of ["package.json", "apps/web/package.json", "worker/package.json"]) {
      const contents = readFileSync(path.join(REPO_ROOT, manifest), "utf8");
      expect(`${manifest}:${contents.includes("@slack/web-api")}`).toBe(`${manifest}:false`);
      expect(`${manifest}:${contents.includes("@slack/bolt")}`).toBe(`${manifest}:false`);
    }

    const scope = await bed.member("port");
    const poster = recordingPoster(OK_POST);
    await (
      await loadRouteHandler(CONNECT)
    )(routeRequest(CONNECT, bodyWithToken), depsFor(scope, { poster }));

    const handle = await loadRouteHandler(TEST_POST);
    await handle(routeRequest(TEST_POST, {}), depsFor(scope, { poster }));

    expect(poster.sent.length).toBe(1);

    expect(poster.sent[0]?.channelId).toBe(CHANNEL_ID);

    expect((poster.sent[0]?.fallbackText ?? "").length).toBeGreaterThan(0);
  });

  test("a failed test post does not fail the step or the onboarding flow", async () => {
    const scope = await bed.member("post-fail");
    const poster = recordingPoster({
      ok: false,
      code: "channel_unavailable",
      message: POST_FAILURE_MESSAGES.channel_unavailable,
    });

    await (
      await loadRouteHandler(CONNECT)
    )(routeRequest(CONNECT, bodyWithToken), depsFor(scope, { poster }));

    const handle = await loadRouteHandler(TEST_POST);
    const response = await handle(routeRequest(TEST_POST, {}), depsFor(scope, { poster }));

    expect(response.status).toBe(200);
    const strings = collectStrings(await bodyOf(response));
    expect(strings).toContain(POST_FAILURE_MESSAGES.channel_unavailable);

    const rows = await rawSlackRows(scope.organizationId);
    expect(rows.filter((row) => row.is_active === true).length).toBe(1);

    const status = await (
      await loadRouteHandler(STATUS)
    )(routeRequest(STATUS), depsFor(scope, { poster }));
    expect(status.status).toBe(200);
  });

  test("the test message names the workspace and who connected it", async () => {
    const scope = await bed.member("announce");
    const poster = recordingPoster(OK_POST);

    await (
      await loadRouteHandler(CONNECT)
    )(routeRequest(CONNECT, bodyWithToken), depsFor(scope, { poster }));
    await (
      await loadRouteHandler(TEST_POST)
    )(routeRequest(TEST_POST, {}), depsFor(scope, { poster }));

    const request = poster.sent[0];
    if (!request) throw new Error("no message was posted at all");
    const text = `${request.fallbackText}\n${JSON.stringify(request.blocks)}`;

    const [row] = await rawSlackRows(scope.organizationId);
    expect(row?.connected_by_user_id).toBe(scope.userId);

    const connectorName = await readUserName(scope.userId);
    expect(text).toContain(connectorName);

    expect(request.channelId).toBe(CHANNEL_ID);

    expect(leaks(text, BOT_TOKEN)).toBeNull();
  });

  // AD-4 as behaviour, which the source scan for `isDeliveryTarget` cannot be:
  // a route that imports the guard, ignores it and posts to the null still
  // contains the string. The zero-posts assertion is the load-bearing one and
  // is made first — a route that posted and then refused answers 409 too.
  test("a workspace attached with no channel chosen is refused before anything is posted", async () => {
    const scope = await bed.member("no-channel");
    const poster = recordingPoster(OK_POST);

    await attachWorkspaceWithNoChannel(scope);

    const handle = await loadRouteHandler(TEST_POST);
    const response = await handle(routeRequest(TEST_POST, {}), depsFor(scope, { poster }));

    // Nothing left through the port.
    expect(poster.sent).toEqual([]);

    // Literals, not the shipped constant: an assertion derived from the same
    // source as the answer cannot notice the source changing.
    expect(response.status).toBe(409);
    const error = (await bodyOf(response)).error as Record<string, unknown> | undefined;
    expect(error?.code).toBe("no_channel_chosen");
    // Not the other one, which would send a founder back through consent.
    expect(error?.code).not.toBe("no_channel_connected");
    // Typed before measured: a non-string would coerce and clear the length.
    const message = error?.message;
    expect(typeof message).toBe("string");
    expect((message as string).length).toBeGreaterThan(20);

    // The control, on the SAME poster instance: a fake that recorded nothing,
    // or deps that never reached the route's poster, would satisfy the empty
    // array above while measuring nothing.
    const connected = await bed.member("no-channel-control");
    await (
      await loadRouteHandler(CONNECT)
    )(routeRequest(CONNECT, bodyWithToken), depsFor(connected, { poster }));
    await handle(routeRequest(TEST_POST, {}), depsFor(connected, { poster }));

    expect(poster.sent.length).toBe(1);
    expect(poster.sent[0]?.channelId).toBe(CHANNEL_ID);
  });
});

async function readUserName(userId: string): Promise<string> {
  const rows = await bed.db
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  const name = rows[0]?.name;
  if (!name) throw new Error(`no user row for ${userId}`);
  return name;
}

describe("POST /api/first-run/slack/skip (FR-O14)", () => {
  test("skipping records the skip and returns the degraded status", async () => {
    const scope = await bed.member("skip");
    const handle = await loadRouteHandler(SKIP);

    const before = await bodyOf(
      await (
        await loadRouteHandler(STATUS)
      )(routeRequest(STATUS), depsFor(scope)),
    );
    const response = await handle(routeRequest(SKIP, {}), depsFor(scope));

    expect(response.status).toBe(200);
    const after = await bodyOf(response);

    const projectId = await projectFor(scope);
    const rows = (await bed.db.execute(
      `select slack_skipped_at from first_run_state where project_id = '${projectId}'`,
    )) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
    const stateRows = Array.isArray(rows) ? rows : (rows.rows ?? []);
    expect(stateRows.length).toBe(1);
    expect(stateRows[0]?.slack_skipped_at).not.toBeNull();

    expect(after).not.toEqual(before);
    const strings = collectStrings(after);
    expect(strings.some((value) => value.length > 20)).toBe(true);
  });

  test("the degraded notice derives from the absence of an active connection, not from the skip flag", async () => {
    const scope = await bed.member("derived");
    const status = await loadRouteHandler(STATUS);

    await (
      await loadRouteHandler(SKIP)
    )(routeRequest(SKIP, {}), depsFor(scope));
    const skippedNotConnected = await bodyOf(await status(routeRequest(STATUS), depsFor(scope)));

    await (
      await loadRouteHandler(CONNECT)
    )(routeRequest(CONNECT, bodyWithToken), depsFor(scope, { poster: recordingPoster(OK_POST) }));
    const skippedAndConnected = await bodyOf(await status(routeRequest(STATUS), depsFor(scope)));

    const projectId = await projectFor(scope);
    const rows = (await bed.db.execute(
      `select slack_skipped_at from first_run_state where project_id = '${projectId}'`,
    )) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
    const stateRows = Array.isArray(rows) ? rows : (rows.rows ?? []);
    expect(stateRows[0]?.slack_skipped_at).not.toBeNull();

    expect(skippedAndConnected).not.toEqual(skippedNotConnected);

    const stateColumns = Object.keys(stateRows[0] ?? {});
    expect(stateColumns).not.toContain("slack_connected");
    expect(stateColumns).not.toContain("slack_channel_id");
  });
});

describe("org membership is the whole floor (EC-O2, AC-O17)", () => {
  test("a teammate who set nothing up can read the connection state and can disconnect", async () => {
    const poster = recordingPoster(OK_POST);
    await (
      await loadRouteHandler(CONNECT)
    )(routeRequest(CONNECT, bodyWithToken), depsFor(owner, { poster }));

    const asTeammate = await (
      await loadRouteHandler(STATUS)
    )(routeRequest(STATUS), depsFor(teammate));
    expect(asTeammate.status).toBe(200);
    const teammateBody = await bodyOf(asTeammate);
    expect(collectStrings(teammateBody)).toContain(CHANNEL_ID);

    const disconnect = await (
      await loadRouteHandler(DISCONNECT)
    )(routeRequest(DISCONNECT, {}), depsFor(teammate));
    expect(disconnect.status).toBe(200);
    expect(disconnect.status).not.toBe(403);
  });
});
