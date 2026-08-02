// POST /api/first-run/slack/{connect,test,skip} — step three's front door.
// Wave 0f, task 0f.3. ADD §9, 10 rows (8 at taskgen, AD-16a's unknown-key row,
// and AD-4's half-connected refusal — see row 10 on why a source scan could not
// stand in for it).
//
// ###########################################################################
// # THE TEST MESSAGE IS THE ANNOUNCEMENT, AND THAT IS A DECISION, NOT A GAP.
// #
// # EC-O1 asks how the REST OF THE ORG learns that somebody connected Slack.
// # AD-24 answers it by stating plainly that this sprint ships NO in-app
// # notification system — so the Slack post IS how the org learns. That is why
// # `connected_by_user_id` is on the table (AD-8 says so on the column), and
// # why `the test message names the workspace and who connected it` is a row
// # rather than a nicety: a message that says only "this works" leaves every
// # teammate unable to tell who wired their org up to a channel.
// #
// # AND THE DEGRADED NOTICE IS DERIVED, NEVER FLAGGED. FR-O14 lets a founder
// # skip step three, and the product must then say plainly that the onboarding
// # moment still works but nothing further arrives until Slack is connected.
// # Two mechanisms, deliberately: `slack_skipped_at` drives the STEP STATE
// # (`skipped`, distinguishable from `pending`), and THE ABSENCE OF AN ACTIVE
// # CONNECTION drives the NOTICE. That split is what makes the notice survive
// # a reload BY CONSTRUCTION — and it is why a `slackConnected` field on
// # `first_run_state` would be the D11 hand-passed wire the split exists to
// # avoid. SILENT DEGRADATION IS A BUG.
// ###########################################################################
//
// Lane prefix `web-fr-slack`.
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

/** The pasted bot token. AD-24: no Slack OAuth — a pasted token is the shipped
 *  mechanism. Fixture-shaped; this repository is public. */
const BOT_TOKEN = "xoxb-onboarding-fixture-token-never-real";
const CHANNEL_ID = "C01AB2CD3EF";

const REPO_ROOT = path.join(import.meta.dir, "..", "..", "..", "..", "..");

let bed: FirstRunTestBed;
let owner: SeededMemberScope;
let teammate: SeededMemberScope;

/**
 * Longer than bun's 5s default, and it is not a slow test being tolerated.
 *
 * THE BUDGET IS FOR THE BOOT, NOT FOR THE ASSERTIONS. This hook boots a real
 * PGlite, runs the migrations, and signs two members up through Better Auth
 * (whose password hashing is deliberately slow). Measured warm on this machine
 * it costs ~1.6s — comfortable-looking, and misleading: a COLD boot, where the
 * wasm image is decompressed rather than reused, was measured at ~5.4s and blew
 * straight through bun's 5s default. Two agents reproduced that independently
 * with their own files excluded.
 *
 * What makes it worth a named constant rather than a shrug: the failure is an
 * UNNAMED `a beforeEach/afterEach hook timed out`. It names no route, no
 * contract and no owner, and it collapses every named row in this file into one
 * piece of infrastructure noise that reads exactly like a product bug. Somebody
 * then spends an afternoon hunting one that does not exist.
 *
 * It also only bites when a single file is run — the batch run shares the warm
 * image and hides it — so it is invisible until the one moment it is expensive.
 *
 * Same figure and same reasoning as `discover.route.test.ts`,
 * `analytics.route.test.ts` and `lifecycle.route.test.ts`; keep them in
 * agreement.
 */
const COLD_BOOT_BUDGET_MS = 60_000;

beforeAll(async () => {
  bed = await createFirstRunTestBed("slack");
  owner = await bed.member("owner");
  // AC-O17 / EC-O2: the teammate who set nothing up. ORG MEMBERSHIP IS THE
  // WHOLE FLOOR — this member is a `member`, never an `owner`.
  teammate = await bed.member("mate", owner.organizationId);
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

// ---------------------------------------------------------------------------
// The recording poster — the SHIPPED port, never a new one
// ---------------------------------------------------------------------------

interface RecordingPoster extends DeliveryPoster {
  readonly sent: PostRequest[];
}

/**
 * A `DeliveryPoster` that records and answers. NEVER THROWS, because the
 * shipped port never does: "a port that throws makes [the D8 obligation] the
 * caller's problem to remember; a port that returns makes it the type
 * system's" (`packages/shared/src/delivery/poster.ts:96-99`). A fake that threw
 * would let a route pass `a failed test post does not fail the step` by
 * catching an exception the real poster will never raise.
 */
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

/** The org's project id, AS THE ROUTE PROVISIONS IT (AD-7; see
 *  status.route.test.ts's header on why a seeded row would fork). */
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

/** Every `slack_connections` row for an org, read RAW — the point of several
 *  rows is what the stored columns hold, which no summary type exposes. */
async function rawSlackRows(organizationId: string): Promise<Record<string, unknown>[]> {
  const result = (await bed.db.execute(
    `select * from slack_connections where organization_id = '${organizationId}'`,
  )) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

const bodyWithToken = { botToken: BOT_TOKEN, channelId: CHANNEL_ID };

/** Envelope-SHAPED and deliberately not openable. This repository is public and no
 *  fixture in it will ever carry usable key material. The row below is refused
 *  before anything tries to open it, so a real envelope would prove nothing extra. */
const HALF_CONNECTED_CIPHERTEXT = "v1.00000000.aaaa.bbbb.cccc";
const HALF_CONNECTED_KEY_ID = "00000000";

/**
 * The mid-OAuth row: a workspace attached, ACTIVE, and no channel chosen (AD-4).
 *
 * WRITTEN AS RAW SQL RATHER THAN THROUGH THE ROUTE THAT PRODUCES IT. The real
 * producer is `slack/oauth/callback`, which needs `SLACK_CLIENT_ID`,
 * `SLACK_CLIENT_SECRET` and an injected fetch — none of which this suite has, and
 * all of which are `slack-oauth.route.test.ts`'s subject rather than this one's.
 * Reaching for them here would make a row about the TEST-MESSAGE route fail for
 * reasons that live in a different route entirely. The column list matches what
 * the callback writes, so the state under test is the state production creates.
 */
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

// ===========================================================================

describe("POST /api/first-run/slack/connect (FR-O10, AD-20)", () => {
  // ------------------------------------------------------------------ row 1
  test("connecting stores an encrypted envelope and returns no credential", async () => {
    const handle = await loadRouteHandler(CONNECT);
    const response = await handle(routeRequest(CONNECT, bodyWithToken), depsFor(owner));
    const raw = await response.text();

    // NO CREDENTIAL IN ANY ENCODING. `project_connections` established the
    // pattern and it is copied rather than re-derived; the summary type omits
    // both credential columns and the read path never selects them.
    expect(leaks(raw, BOT_TOKEN)).toBeNull();
    expect(raw).not.toContain("credentialCiphertext");
    expect(raw).not.toContain("credential_ciphertext");
    expect(raw).not.toContain("credentialKeyId");

    // AND THE STORED VALUE IS AN ENVELOPE, not the token. AD-20 fixes the
    // shape: `v1.<keyId>.<iv>.<tag>.<ciphertext>`, with the AAD binding it to
    // its owning org so a lifted ciphertext fails authentication rather than
    // decrypting cross-tenant.
    const rows = await rawSlackRows(owner.organizationId);
    expect(rows.length).toBe(1);
    // Read as a string only when it IS one. These come off a raw SQL row, so
    // the column type is `unknown`; `String(unknown)` would render an object as
    // "[object Object]" and quietly pass the leak scan below against a value it
    // never actually inspected.
    const ciphertext = rows[0]?.credential_ciphertext;
    const stored = typeof ciphertext === "string" ? ciphertext : "";
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored.split(".").length).toBe(5);
    expect(leaks(stored, BOT_TOKEN)).toBeNull();
    // The key FINGERPRINT is stored, never the key (D12 — rotation is a
    // migratable event rather than a silent fork).
    const keyId = rows[0]?.credential_key_id;
    expect(typeof keyId === "string" ? keyId : "").toMatch(/^[0-9a-f]{8}$/);
  });

  // ------------------------------------------------------------------ row 2
  test("a second active connection for one org is refused with a named sentence", async () => {
    const scope = await bed.member("second");
    const handle = await loadRouteHandler(CONNECT);

    const first = await handle(routeRequest(CONNECT, bodyWithToken), depsFor(scope));
    expect(first.status).toBe(200);

    const second = await handle(
      routeRequest(CONNECT, { botToken: BOT_TOKEN, channelId: "C09ZZ9ZZ9ZZ" }),
      depsFor(scope),
    );

    // THE CONSTRAINT SURFACES AS A REFUSAL, NOT A 500. The partial unique
    // index `slack_connections_active_org_uidx` is what refuses it — no
    // read-then-write (EC-O6, D6) — and a 23505 that reaches the customer as
    // a server error is a bug wearing a database's clothes.
    expect(second.status).toBeLessThan(500);
    expect(second.status).not.toBe(200);

    const sentence = collectStrings(await bodyOf(second)).join(" ");
    expect(sentence.length).toBeGreaterThan(0);
    // NAMED, in plain English, with no error code and no constraint name.
    expect(sentence).not.toContain("23505");
    expect(sentence).not.toContain("slack_connections_active_org_uidx");
    expect(sentence).not.toContain("unique");

    // Still exactly one active row.
    const rows = await rawSlackRows(scope.organizationId);
    expect(rows.filter((row) => row.is_active === true).length).toBe(1);
  });

  // ------------------------------------------------------------------ row 9
  test("an unknown body key rejects with a 4xx, never a 500 and never a 200", async () => {
    // AD-16a on the connect and test-message bodies. `slack/test` and
    // `slack/skip` declare NO input, which is where a non-strict `z.object({})`
    // accepts anything at all.
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
  // ------------------------------------------------------------------ row 3
  test("the test message goes through the existing DeliveryPoster port", async () => {
    // NO NEW PORT, NO NEW DEPENDENCY. The structural half is checkable today
    // and is asserted first so a red here is unambiguous.
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

    // ONE post, through the injected port — which is the SHIPPED
    // `createSlackDeliveryPoster`'s type. A route that reached for Slack
    // directly would leave this empty.
    expect(poster.sent.length).toBe(1);

    // FR-O13: the channel comes from the STORED ROW, never from the caller.
    // The request body carried no channel, and the post still knows one.
    expect(poster.sent[0]?.channelId).toBe(CHANNEL_ID);
    // The fallback is never empty: a blocks-only message is silent in both a
    // notification preview and a screen reader.
    expect((poster.sent[0]?.fallbackText ?? "").length).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------ row 4
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

    // D8 / EC-O8: 200 WITH A FAILURE OUTCOME. The step is not done, and it is
    // also not an error state that blocks the sequence — "Skip for now" is
    // still there and still reaches step 5. UX Flow D: "IN ALL FOUR CASES:
    // setup is not broken."
    expect(response.status).toBe(200);
    const strings = collectStrings(await bodyOf(response));
    expect(strings).toContain(POST_FAILURE_MESSAGES.channel_unavailable);

    // The onboarding flow is intact: the connection row survives a failed post.
    const rows = await rawSlackRows(scope.organizationId);
    expect(rows.filter((row) => row.is_active === true).length).toBe(1);

    // And the status route still answers, rather than inheriting the failure.
    const status = await (
      await loadRouteHandler(STATUS)
    )(routeRequest(STATUS), depsFor(scope, { poster }));
    expect(status.status).toBe(200);
  });

  // ------------------------------------------------------------------ row 5
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

    // THE MESSAGE IS THE ANNOUNCEMENT (EC-O1, OQ-O6). This sprint ships no
    // in-app notification system (AD-24 STATES that rather than assuming it),
    // so a teammate's only way to learn who wired their org to a channel is
    // this post. `connected_by_user_id` exists on the table for exactly this.
    const [row] = await rawSlackRows(scope.organizationId);
    expect(row?.connected_by_user_id).toBe(scope.userId);

    // Named: the person, by something a human reads — not a raw id.
    const connectorName = await readUserName(scope.userId);
    expect(text).toContain(connectorName);

    // And the destination, so a reader knows which channel this landed in.
    expect(request.channelId).toBe(CHANNEL_ID);

    // Never the credential, in any encoding.
    expect(leaks(text, BOT_TOKEN)).toBeNull();
  });

  // ----------------------------------------------------------------- row 10
  //
  // #########################################################################
  // # AD-4 ROW 8, AS BEHAVIOUR. THE ROW THE SOURCE SCAN COULD NOT WRITE.
  // #
  // # `nullable-channel-readers.test.ts` asks this route's SOURCE to name
  // # `isDeliveryTarget`, which is the right shape for "every channel read
  // # goes through one guard" and is worth exactly nothing as a statement
  // # about behaviour: a file that imports the guard, ignores its answer, and
  // # posts to the null anyway contains the string and passes that row.
  // #
  // # This is the reader AD-4 calls the one a founder actually hits. Since
  // # the OAuth callback stores a bot token BEFORE a channel is chosen,
  // # `getActiveForOrg` returns a real connection for the whole mid-OAuth
  // # window — which is precisely when somebody presses "Send a test
  // # message". The refusal above it fires only on NO connection, so without
  // # the guard the address handed to the poster is a null that interpolates
  // # into the four characters "null", Slack answers with an ordinary error,
  // # and nothing anywhere throws.
  // #
  // # THE ZERO-POSTS ASSERTION IS THE LOAD-BEARING ONE and is made FIRST. A
  // # route that posted and then refused would answer 409 exactly like a
  // # correct one, so the status alone cannot tell the two apart — the only
  // # observable difference is whether a message left through the port.
  // #########################################################################
  test("a workspace attached with no channel chosen is refused before anything is posted", async () => {
    const scope = await bed.member("no-channel");
    const poster = recordingPoster(OK_POST);

    await attachWorkspaceWithNoChannel(scope);

    const handle = await loadRouteHandler(TEST_POST);
    const response = await handle(routeRequest(TEST_POST, {}), depsFor(scope, { poster }));

    // (b) NOTHING LEFT THROUGH THE PORT.
    expect(poster.sent).toEqual([]);

    // (a) 409, and the refusal that names the ONE remaining act. Pinned as
    // literals rather than read off the shipped constant: this is the wire
    // contract a client branches on, and an assertion derived from the same
    // source as the answer cannot notice the source changing.
    expect(response.status).toBe(409);
    const error = (await bodyOf(response)).error as Record<string, unknown> | undefined;
    expect(error?.code).toBe("no_channel_chosen");
    // AND NOT THE OTHER ONE. "Connect Slack first" sends a founder who just
    // completed consent back through a screen they already finished, and
    // leaves them exactly where they were.
    expect(error?.code).not.toBe("no_channel_connected");
    // `message` is read as a string rather than stringified: the refusal body
    // is `Record<string, unknown>`, so a non-string here would coerce to
    // "[object Object]" and still clear a length check — asserting the type is
    // what makes the length mean anything.
    const message = error?.message;
    expect(typeof message).toBe("string");
    expect((message as string).length).toBeGreaterThan(20);

    // THE CONTROL, ON THE SAME POSTER INSTANCE. Without it a fake that
    // recorded nothing — or a `depsFor` that never reached the route's poster
    // at all — would satisfy the empty-array assertion above while measuring
    // nothing. A properly connected org drives one post through this very
    // object, so the emptiness is about the null channel and not about the
    // fixture.
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
  // ------------------------------------------------------------------ row 6
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

    // RECORDED: the stamp is durable, so the step reads `skipped` rather than
    // `pending` after a reload — two states a founder must be able to tell
    // apart.
    const projectId = await projectFor(scope);
    const rows = (await bed.db.execute(
      `select slack_skipped_at from first_run_state where project_id = '${projectId}'`,
    )) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
    const stateRows = Array.isArray(rows) ? rows : (rows.rows ?? []);
    expect(stateRows.length).toBe(1);
    expect(stateRows[0]?.slack_skipped_at).not.toBeNull();

    // AND DEGRADED, STATED PLAINLY. Silent degradation is a bug: the response
    // must say the onboarding moment still works AND that nothing further
    // arrives until Slack is connected.
    expect(after).not.toEqual(before);
    const strings = collectStrings(after);
    expect(strings.some((value) => value.length > 20)).toBe(true);
  });

  // ------------------------------------------------------------------ row 7
  test("the degraded notice derives from the absence of an active connection, not from the skip flag", async () => {
    // FR-O14's RELOAD-SURVIVAL, MADE STRUCTURAL. Two mechanisms: the flag
    // drives the STEP STATE, the ABSENCE drives the NOTICE. A route that read
    // the flag for the notice would show a connected org a degraded notice
    // forever after one skip, and would show an org that connected-then-
    // disconnected nothing at all.
    const scope = await bed.member("derived");
    const status = await loadRouteHandler(STATUS);

    // (a) Skipped and NOT connected: the notice is present.
    await (
      await loadRouteHandler(SKIP)
    )(routeRequest(SKIP, {}), depsFor(scope));
    const skippedNotConnected = await bodyOf(await status(routeRequest(STATUS), depsFor(scope)));

    // (b) Skipped and THEN connected: the flag is unchanged, the notice goes.
    await (
      await loadRouteHandler(CONNECT)
    )(routeRequest(CONNECT, bodyWithToken), depsFor(scope, { poster: recordingPoster(OK_POST) }));
    const skippedAndConnected = await bodyOf(await status(routeRequest(STATUS), depsFor(scope)));

    // The skip stamp is STILL SET — so anything that changed between (a) and
    // (b) cannot have been derived from it.
    const projectId = await projectFor(scope);
    const rows = (await bed.db.execute(
      `select slack_skipped_at from first_run_state where project_id = '${projectId}'`,
    )) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
    const stateRows = Array.isArray(rows) ? rows : (rows.rows ?? []);
    expect(stateRows[0]?.slack_skipped_at).not.toBeNull();

    // And the payload DID change: the notice tracks the connection, not the flag.
    expect(skippedAndConnected).not.toEqual(skippedNotConnected);

    // The type-level half of the same argument: `first_run_state` carries the
    // two stamps and NOTHING connection-shaped. A `slackConnected` field there
    // would be the D11 hand-passed wire this split exists to avoid.
    const stateColumns = Object.keys(stateRows[0] ?? {});
    expect(stateColumns).not.toContain("slack_connected");
    expect(stateColumns).not.toContain("slack_channel_id");
  });
});

describe("org membership is the whole floor (EC-O2, AC-O17)", () => {
  // ------------------------------------------------------------------ row 8
  test("a teammate who set nothing up can read the connection state and can disconnect", async () => {
    // NO ROLE GATE. The teammate is a `member`, not an `owner`, and set
    // nothing up — the actor here is the person AD-24 and ESC-O2 are about.
    const poster = recordingPoster(OK_POST);
    await (
      await loadRouteHandler(CONNECT)
    )(routeRequest(CONNECT, bodyWithToken), depsFor(owner, { poster }));

    // READ: the teammate's own status call sees the org's connection.
    const asTeammate = await (
      await loadRouteHandler(STATUS)
    )(routeRequest(STATUS), depsFor(teammate));
    expect(asTeammate.status).toBe(200);
    const teammateBody = await bodyOf(asTeammate);
    expect(collectStrings(teammateBody)).toContain(CHANNEL_ID);

    // ACT: the teammate can disconnect the org's analytics attachment, which
    // is the shipped member-vs-non-member floor — a role gate is a named
    // future decision, deliberately not designed in.
    const disconnect = await (
      await loadRouteHandler(DISCONNECT)
    )(routeRequest(DISCONNECT, {}), depsFor(teammate));
    expect(disconnect.status).toBe(200);
    expect(disconnect.status).not.toBe(403);
  });
});
