// POST /api/settings/slack/channel — the route that MOVES a delivery address the
// first-run route only ever fills. It exists because the channel was frozen by design
// (moving forks the `(finding, channel)` dedup key and replays the backlog, D12) and is
// now movable only because the move stamps a cutover the delivery lane reads.
import { eq, schema } from "@growthmind/db";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// The deps types come from the shipped module, not from the contract helper's mirror: the
// mirror declares only the ports the first-run rows inject, and this route needs the
// channel lister. A real deps object still satisfies the mirror the handler is typed on.
import type { FirstRunChannelListing, FirstRunRouteDeps } from "../../../lib/first-run/deps";
import {
  bodyOf,
  clockAt,
  createFirstRunTestBed,
  loadRouteHandler,
  loadRouteInputSchema,
  routeById,
  routeRequest,
  tenantOf,
  verifyRefusesUnknownKey,
  type FirstRunRouteDescriptor,
  type FirstRunTestBed,
  type SeededMemberScope,
} from "../first-run/helpers/first-run-route-contract";

const CONNECT = routeById("slack-connect");
const CLOCK_AT = new Date("2026-08-03T10:00:00.000Z");
const CLOCK = clockAt(CLOCK_AT);

const BOT_TOKEN = "xoxb-settings-fixture-token-never-real";
const FIRST_CHANNEL = "C01AB2CD3EF";
const SECOND_CHANNEL = "C07MOVED002";
const UNLISTED_CHANNEL = "C09NEVER003";

// Declared here rather than in FIRST_RUN_ROUTES: this route is not part of that surface,
// and adding it there would put a settings write behind first-run's contract rows.
const MOVE: FirstRunRouteDescriptor = {
  id: "settings-slack-channel",
  path: "/api/settings/slack/channel",
  method: "POST",
  modulePath: "apps/web/app/api/settings/slack/channel/route",
  sourcePath: "apps/web/app/api/settings/slack/channel/route.ts",
  declaredKeys: ["channelId"],
  validBody: { channelId: SECOND_CHANNEL },
  ownedBy: "the post-setup control surface",
};

const LISTED: FirstRunChannelListing = {
  ok: true,
  channels: [
    { id: FIRST_CHANNEL, name: "growth" },
    { id: SECOND_CHANNEL, name: "product" },
  ],
};

let bed: FirstRunTestBed;

const COLD_BOOT_BUDGET_MS = 60_000;

beforeAll(async () => {
  bed = await createFirstRunTestBed("settings-channel");
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

function depsFor(
  scope: SeededMemberScope | null,
  extra?: Partial<FirstRunRouteDeps>,
): FirstRunRouteDeps {
  return {
    db: bed.db,
    tenant: tenantOf(scope?.ctx ?? null),
    now: CLOCK,
    channelsFor: () => Promise.resolve(LISTED),
    ...extra,
  };
}

async function connectWith(scope: SeededMemberScope, channelId: string | null): Promise<void> {
  const handle = await loadRouteHandler(CONNECT);
  const response = await handle(
    routeRequest(CONNECT, { botToken: BOT_TOKEN, channelId: channelId ?? "" }),
    depsFor(scope, { poster: { post: () => Promise.resolve({ ok: true, messageRef: "m1" }) } }),
  );
  expect(response.status).toBeLessThan(500);
}

async function storedRow(organizationId: string) {
  const [row] = await bed.db
    .select()
    .from(schema.slackConnections)
    .where(eq(schema.slackConnections.organizationId, organizationId));
  return row;
}

async function move(
  scope: SeededMemberScope | null,
  channelId: string,
  extra?: Partial<FirstRunRouteDeps>,
): Promise<Response> {
  const handle = await loadRouteHandler(MOVE);
  return handle(routeRequest(MOVE, { channelId }), depsFor(scope, extra));
}

describe("POST /api/settings/slack/channel", () => {
  test("the body schema is strict and names no tenancy key", async () => {
    const inputSchema = await loadRouteInputSchema(MOVE);

    // The organization comes from the session. A body naming one names somebody else's.
    for (const key of ["organizationId", "projectId", "connectionId", "cutoverAt"]) {
      expect(verifyRefusesUnknownKey(inputSchema, MOVE.validBody, key).ok).toBe(true);
    }
  });

  test("a signed-out caller moves nothing", async () => {
    const response = await move(null, SECOND_CHANNEL);

    expect(response.status).toBe(401);
  });

  test("an organization with no Slack workspace is refused, not silently moved", async () => {
    const scope = await bed.member("no-workspace");

    expect((await move(scope, SECOND_CHANNEL)).status).toBe(409);
  });

  test("a teammate who ran none of setup can move the channel", async () => {
    // D1/D2: the connection is org-scoped, so repairing it must not require the person who
    // connected it. `connected_by_user_id` is attribution, never a filter.
    const owner = await bed.member("teammate-owner");
    await connectWith(owner, FIRST_CHANNEL);
    const mate = await bed.member("teammate-mate", owner.organizationId);

    const response = await move(mate, SECOND_CHANNEL);
    expect(response.status).toBe(200);

    expect((await storedRow(owner.organizationId))?.channelId).toBe(SECOND_CHANNEL);
  });

  test("a move stamps the cutover, which is the whole reason the move is allowed", async () => {
    const scope = await bed.member("stamps");
    await connectWith(scope, FIRST_CHANNEL);

    const body = await bodyOf(await move(scope, SECOND_CHANNEL));
    expect((body as { moved?: unknown }).moved).toBe(true);

    const row = await storedRow(scope.organizationId);
    expect(row?.channelId).toBe(SECOND_CHANNEL);
    expect(row?.deliveryCutoverAt?.toISOString()).toBe(CLOCK_AT.toISOString());
  });

  test("re-picking the channel already set changes nothing and stamps no cutover", async () => {
    // A cutover stamped for a no-op move would silently suppress every finding still
    // waiting to be delivered — data loss behind a success message.
    const scope = await bed.member("same");
    await connectWith(scope, FIRST_CHANNEL);

    const response = await move(scope, FIRST_CHANNEL);
    expect(response.status).toBe(200);
    expect(((await bodyOf(response)) as { moved?: unknown }).moved).toBe(false);

    const row = await storedRow(scope.organizationId);
    expect(row?.channelId).toBe(FIRST_CHANNEL);
    expect(row?.deliveryCutoverAt).toBeNull();
  });

  test("a channel absent from the live list is refused before anything is stamped", async () => {
    // A picker left open on an archived channel would otherwise stamp an address that
    // refuses every post, and the failure surfaces later as silence.
    const scope = await bed.member("unlisted");
    await connectWith(scope, FIRST_CHANNEL);

    expect((await move(scope, UNLISTED_CHANNEL)).status).toBe(409);

    const row = await storedRow(scope.organizationId);
    expect(row?.channelId).toBe(FIRST_CHANNEL);
    expect(row?.deliveryCutoverAt).toBeNull();
  });

  test("a Slack listing that cannot be read refuses the move rather than guessing", async () => {
    // D8: the read failing must not leave the address changed to something unvalidated.
    const scope = await bed.member("listing-down");
    await connectWith(scope, FIRST_CHANNEL);

    const response = await move(scope, SECOND_CHANNEL, {
      channelsFor: () => Promise.resolve({ ok: false, code: "call_failed" }),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await storedRow(scope.organizationId))?.channelId).toBe(FIRST_CHANNEL);
  });

  test("one organization cannot move another organization's channel", async () => {
    // D7: the row is chosen by the repository's own org filter, and the body names no
    // connection — so there is no id an attacker could supply.
    const theirs = await bed.member("tenant-a");
    await connectWith(theirs, FIRST_CHANNEL);

    const outsider = await bed.member("tenant-b");
    expect((await move(outsider, SECOND_CHANNEL)).status).toBe(409);

    expect((await storedRow(theirs.organizationId))?.channelId).toBe(FIRST_CHANNEL);
  });

  test("moving twice to the same place is idempotent, so a retry is safe", async () => {
    // D4: the client refreshes on the answer, and a double submit must not stamp a second
    // cutover that suppresses everything found between the two presses.
    const scope = await bed.member("retry");
    await connectWith(scope, FIRST_CHANNEL);

    expect((await move(scope, SECOND_CHANNEL)).status).toBe(200);
    const first = (await storedRow(scope.organizationId))?.deliveryCutoverAt;

    expect(((await bodyOf(await move(scope, SECOND_CHANNEL))) as { moved?: unknown }).moved).toBe(
      false,
    );

    expect((await storedRow(scope.organizationId))?.deliveryCutoverAt?.toISOString()).toBe(
      first?.toISOString(),
    );
  });
});
