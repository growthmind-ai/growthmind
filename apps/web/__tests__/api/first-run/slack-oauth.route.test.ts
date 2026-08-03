import { eq, schema, slackCredentialAad } from "@growthmind/db";
import {
  decryptSecret,
  parseWebEnv,
  POST_FAILURE_MESSAGES,
  resolveCredentialKey,
  type CredentialKey,
  type CredentialKeyResolution,
  type DeliveryPoster,
  type PostRequest,
  type PostResult,
} from "@growthmind/shared";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { enumerateShapeKeys } from "../../../../../packages/shared/__tests__/onboarding/probes/strict-zod-fixtures";
import { channelAlreadyChosen, NO_WORKSPACE_CONNECTED } from "@/lib/first-run/refusals";
import { buildTestPostMessage } from "@/lib/first-run/slack-test-message";
import { buildTestTenantContext, createTestOrganization } from "../../tenancy/helpers/auth-fixture";
import {
  bodyOf,
  clockAt,
  collectStrings,
  createFirstRunTestBed,
  leaks,
  loadRouteHandler,
  loadRouteInputSchema,
  readRouteSource,
  routeById,
  routeRequest,
  tenantOf,
  TENANCY_KEYS,
  verifyRefusesUnknownKey,
  type FirstRunRouteDeps,
  type FirstRunRouteDescriptor,
  type FirstRunTestBed,
  type SeededMemberScope,
} from "./helpers/first-run-route-contract";

const CLOCK = clockAt(new Date("2026-08-01T10:00:00.000Z"));
const ORIGIN = "http://localhost:3000";

const OAUTH_START = routeById("slack-oauth-start");
const OAUTH_CALLBACK = routeById("slack-oauth-callback");
const CHANNELS = routeById("slack-channels");
const CHANNEL = routeById("slack-channel");
const CONNECT = routeById("slack-connect");

const NEW_SLACK_ROUTES: readonly FirstRunRouteDescriptor[] = Object.freeze([
  OAUTH_START,
  OAUTH_CALLBACK,
  CHANNELS,
  CHANNEL,
]);

const STATUS = routeById("status");

const BOT_TOKEN = "xoxb-oauth-fixture-token-never-real";
const AUTH_CODE = "fixture-authorization-code";
const CHOSEN_CHANNEL = "C01AB2CD3EF";
const OTHER_CHANNEL = "C09ZZ9ZZ9ZZ";

const APP_URL = "https://app.growthmind.test";
const SPOOFED_HOST = "evil.example";

const OK_POST: PostResult = { ok: true, messageRef: "1712345678.000100" };

let bed: FirstRunTestBed;
let credentialKey: CredentialKeyResolution;
let key: CredentialKey;
const priorEnv = new Map<string, string | undefined>();

/** A cold PGlite boot was measured at 5.4s; bun's 5s default would replace every named red in this file with one unnamed hook timeout. */
const COLD_BOOT_BUDGET_MS = 60_000;

beforeAll(async () => {
  bed = await createFirstRunTestBed("oauth");

  credentialKey = resolveCredentialKey(parseWebEnv(process.env));
  if (!credentialKey.ok) {
    throw new Error(
      `this suite cannot seal or open an envelope because the installation key did not resolve ` +
        `(${credentialKey.reason}). Every other suite in this directory depends on the same dev ` +
        `default, so this is a broken environment rather than a Wave 0 red.`,
    );
  }
  key = credentialKey.key;

  setEnv({
    SLACK_CLIENT_ID: "1234567890.0987654321",
    SLACK_CLIENT_SECRET: "fixture-client-secret-never-real",
    BETTER_AUTH_URL: APP_URL,
  });
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  restoreEnv();
  await bed?.close();
});

function setEnv(patch: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(patch)) {
    if (!priorEnv.has(name)) priorEnv.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function restoreEnv(): void {
  for (const [name, value] of priorEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  priorEnv.clear();
}

async function withEnv<T>(
  patch: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const restore = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(patch)) {
    restore.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of restore) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

interface OutboundCall {
  readonly url: string;
  readonly escaped: boolean;
}

const outbound: OutboundCall[] = [];

const slackApi = {
  botToken: BOT_TOKEN,
  teamId: "T0FIXTURE",
  teamName: "Fixture workspace" as string | undefined,
  channels: [] as { readonly id: string; readonly name: string }[],
};

beforeEach(() => {
  outbound.length = 0;
  slackApi.botToken = BOT_TOKEN;
  slackApi.teamId = "T0FIXTURE";
  slackApi.teamName = "Fixture workspace";
  slackApi.channels = [
    { id: CHOSEN_CHANNEL, name: "growth" },
    { id: OTHER_CHANNEL, name: "general" },
  ];
});

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const injectedFetch = (async (input: RequestInfo | URL): Promise<Response> => {
  const url = urlOf(input);
  outbound.push({ url, escaped: false });

  if (url.includes("oauth.v2.access")) {
    return Response.json({
      ok: true,
      access_token: slackApi.botToken,
      token_type: "bot",
      scope: "channels:read,groups:read,chat:write",
      bot_user_id: "U0FIXTUREBOT",
      team: { id: slackApi.teamId, name: slackApi.teamName },
    });
  }

  if (url.includes("conversations.list")) {
    return Response.json({
      ok: true,
      channels: slackApi.channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        is_channel: true,
        is_private: false,
        is_archived: false,
      })),
      response_metadata: { next_cursor: "" },
    });
  }

  return Response.json({ ok: false, error: "fixture_has_no_answer_for_this_endpoint" });
}) as unknown as typeof globalThis.fetch;

/** Control - this recorder is what makes "zero outbound calls" able to fail: without it a route reaching for the global shows zero calls on the fake. */
const escapedFetch = (async (input: RequestInfo | URL): Promise<Response> => {
  const url = urlOf(input);
  outbound.push({ url, escaped: true });
  throw new Error(
    `this route called globalThis.fetch (${url}) instead of the injected deps.fetch. AD-5 and ` +
      `AD-7 both require the fetch to be injected: without it, "a mismatched state costs zero ` +
      `outbound calls" is unprovable, and a test that cannot fail is not a test.`,
  );
}) as unknown as typeof globalThis.fetch;

interface SlackRouteDeps extends FirstRunRouteDeps {
  readonly fetch?: typeof globalThis.fetch | undefined;
}

function depsFor(scope: SeededMemberScope | null, extra?: Partial<SlackRouteDeps>): SlackRouteDeps {
  return {
    db: bed.db,
    tenant: tenantOf(scope?.ctx ?? null),
    now: CLOCK,
    credentialKey,
    fetch: injectedFetch,
    ...extra,
  };
}

async function drive(
  route: FirstRunRouteDescriptor,
  request: Request,
  deps: SlackRouteDeps,
): Promise<Response> {
  // Loaded BEFORE the swap: a dynamic import runs module-level code, and taking that down with a guard meant for the handler produces a red naming the wrong thing.
  const handle = await loadRouteHandler(route);
  const real = globalThis.fetch;
  globalThis.fetch = escapedFetch;
  try {
    return await handle(request, deps);
  } finally {
    globalThis.fetch = real;
  }
}

interface SlackRequestInit {
  readonly search?: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly origin?: string;
}

function slackRequest(route: FirstRunRouteDescriptor, init?: SlackRequestInit): Request {
  const url = `${init?.origin ?? ORIGIN}${route.path}${init?.search ?? ""}`;
  const headers: Record<string, string> = { ...init?.headers };

  if (route.method === "GET" || init?.body === undefined) {
    return new Request(url, { method: route.method, headers });
  }

  headers["content-type"] = "application/json";
  return new Request(url, { method: route.method, headers, body: JSON.stringify(init.body) });
}

function setCookiesOf(response: Response): readonly string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single === null ? [] : [single];
}

function cookieHeaderFrom(response: Response): string {
  const cookies = setCookiesOf(response);
  if (cookies.length === 0) {
    throw new Error(
      `GET ${OAUTH_START.path} set no cookie, so there is no state for the callback to match ` +
        `against. AD-5 requires a signed cookie AND a state parameter, and a callback that can ` +
        `only check one of them is a callback an attacker's code can be redeemed through.`,
    );
  }
  return cookies
    .map((cookie) => cookie.split(";")[0]?.trim() ?? "")
    .filter((pair) => pair.length > 0)
    .join("; ");
}

function locationOf(response: Response): string {
  const location = response.headers.get("location");
  if (location === null) {
    throw new Error(
      `expected a redirect, got status ${response.status} with no Location header. ` +
        `A founder must never land on a JSON body.`,
    );
  }
  return location;
}

function stateParamOf(response: Response): string {
  const state = new URL(locationOf(response), ORIGIN).searchParams.get("state");
  if (state === null || state.length === 0) {
    throw new Error(
      `GET ${OAUTH_START.path} redirected without a \`state\` parameter, so the callback has ` +
        `nothing to match the cookie against (AD-5).`,
    );
  }
  return state;
}

interface StatePair {
  readonly cookie: string;
  readonly state: string;
}

async function beginOAuth(scope: SeededMemberScope): Promise<StatePair> {
  const response = await drive(OAUTH_START, slackRequest(OAUTH_START), depsFor(scope));
  return { cookie: cookieHeaderFrom(response), state: stateParamOf(response) };
}

function callbackRequest(pair: { cookie: string; state: string }, code = AUTH_CODE): Request {
  return slackRequest(OAUTH_CALLBACK, {
    search: `?code=${encodeURIComponent(code)}&state=${encodeURIComponent(pair.state)}`,
    headers: { cookie: pair.cookie },
  });
}

async function connectWorkspace(
  scope: SeededMemberScope,
  extra?: Partial<SlackRouteDeps>,
): Promise<Response> {
  const pair = await beginOAuth(scope);
  return drive(OAUTH_CALLBACK, callbackRequest(pair), depsFor(scope, extra));
}

async function rawSlackRows(organizationId: string): Promise<Record<string, unknown>[]> {
  const result = (await bed.db.execute(
    `select * from slack_connections where organization_id = '${organizationId}'`,
  )) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

async function activeRow(organizationId: string): Promise<Record<string, unknown>> {
  const rows = (await rawSlackRows(organizationId)).filter((row) => row.is_active === true);
  if (rows.length !== 1) {
    throw new Error(
      `expected EXACTLY ONE active slack_connections row for ${organizationId}, found ${rows.length}. ` +
        `The partial unique index on (organization_id) WHERE is_active is unchanged by AD-4.`,
    );
  }
  return rows[0] as Record<string, unknown>;
}

function textColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  return typeof value === "string" ? value : "";
}

async function readUserName(userId: string): Promise<string> {
  const rows = await bed.db
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  const name = rows[0]?.name;
  if (!name) throw new Error(`no user row for ${userId}`);
  return name;
}

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

describe("the four new Slack routes accept no tenancy id (AD-16, AD-16a)", () => {
  test("each new route declares exactly its own input keys and neither tenancy key", async () => {
    // SHAPE ONLY - Object.keys(shape) is identical for z.object and z.strictObject, so a green here says nothing about refusal; the two rows below bite.
    for (const route of NEW_SLACK_ROUTES) {
      const schemaUnderTest = await loadRouteInputSchema(route);
      const keys = enumerateShapeKeys(schemaUnderTest);

      expect(`${route.id}:${keys === null ? "no-shape" : "has-shape"}`).toBe(
        `${route.id}:has-shape`,
      );
      expect(`${route.id}:${[...(keys ?? [])].toSorted().join(",")}`).toBe(
        `${route.id}:${[...route.declaredKeys].toSorted().join(",")}`,
      );
      for (const tenancyKey of TENANCY_KEYS) {
        expect(`${route.id}:${(keys ?? []).includes(tenancyKey)}`).toBe(`${route.id}:false`);
      }
    }
  });

  test("each new route schema refuses a client-supplied projectId or organizationId with unrecognized_keys, never by stripping it", async () => {
    for (const route of NEW_SLACK_ROUTES) {
      const schemaUnderTest = await loadRouteInputSchema(route);

      for (const tenancyKey of TENANCY_KEYS) {
        const verdict = verifyRefusesUnknownKey(schemaUnderTest, route.validBody, tenancyKey);
        if (!verdict.ok) {
          throw new Error(
            `${route.method} ${route.path} does not refuse a client-supplied "${tenancyKey}": ${verdict.why}`,
          );
        }
        expect(verdict.keys).toContain(tenancyKey);
      }
    }
  });

  test("each new route input schema is constructed strict", async () => {
    for (const route of NEW_SLACK_ROUTES) {
      const schemaUnderTest = await loadRouteInputSchema(route);
      const verdict = verifyRefusesUnknownKey(
        schemaUnderTest,
        route.validBody,
        "somethingNobodyDeclared",
      );
      if (!verdict.ok) {
        throw new Error(
          `${route.method} ${route.path} is not constructed with z.strictObject()/.strict(): ${verdict.why}`,
        );
      }
    }
  });

  test("POST slack/channel answers a body carrying a projectId with a 400, never a 200", async () => {
    const scope = await bed.member("strict");
    const response = await drive(
      CHANNEL,
      slackRequest(CHANNEL, {
        body: { channelId: CHOSEN_CHANNEL, projectId: "someone-elses-project" },
      }),
      depsFor(scope, { poster: recordingPoster(OK_POST) }),
    );

    expect(response.status).toBe(400);
  });

  test("slack/channel refuses a whitespace-only channelId at the wire", async () => {
    const schemaUnderTest = await loadRouteInputSchema(CHANNEL);

    for (const blank of ["", " ", "   ", "\t", "\n"]) {
      expect(
        `${JSON.stringify(blank)}:${schemaUnderTest.safeParse({ channelId: blank }).success}`,
      ).toBe(`${JSON.stringify(blank)}:false`);
    }
  });

  test("slack/channel accepts a real channel id, and stores a padded one trimmed", async () => {
    // Control - without it a schema that refused every channelId, breaking the pick entirely, would pass the row above.
    const schemaUnderTest = await loadRouteInputSchema(CHANNEL);

    const accepted = schemaUnderTest.safeParse({ channelId: CHOSEN_CHANNEL });
    expect(accepted.success).toBe(true);
    expect(accepted.success ? accepted.data : null).toEqual({ channelId: CHOSEN_CHANNEL });

    const padded = schemaUnderTest.safeParse({ channelId: `  ${CHOSEN_CHANNEL}  ` });
    expect(padded.success).toBe(true);
    expect(padded.success ? padded.data : null).toEqual({ channelId: CHOSEN_CHANNEL });
  });

  // The lesson above was learned on slack/channel and not on its sibling, which
  // still took a bare `.min(1)` — so the pasted-token path could persist "   "
  // as an address, and the delivery guard then refuses that row for good with
  // every screen saying a channel is chosen. There is no disconnect control.
  test("slack/connect refuses the same blank channelId its sibling refuses", async () => {
    const schemaUnderTest = await loadRouteInputSchema(CONNECT);

    for (const blank of ["", " ", "   ", "\t", "\n"]) {
      const body = { botToken: BOT_TOKEN, channelId: blank };
      expect(`${JSON.stringify(blank)}:${schemaUnderTest.safeParse(body).success}`).toBe(
        `${JSON.stringify(blank)}:false`,
      );
    }

    // Control - a schema that refused every body would pass the loop above.
    const accepted = schemaUnderTest.safeParse({
      botToken: BOT_TOKEN,
      channelId: `  ${CHOSEN_CHANNEL}  `,
    });
    expect(accepted.success).toBe(true);
    expect(accepted.success ? accepted.data : null).toEqual({
      botToken: BOT_TOKEN,
      channelId: CHOSEN_CHANNEL,
    });
  });
});

describe("GET /api/first-run/slack/oauth/start (AD-5)", () => {
  test("start sends the founder to Slack's consent screen and sets the state cookie httpOnly and SameSite=Lax", async () => {
    const scope = await bed.member("start");
    const response = await drive(OAUTH_START, slackRequest(OAUTH_START), depsFor(scope));

    expect(response.status).toBe(302);

    const location = new URL(locationOf(response), ORIGIN);
    expect(location.host).toBe("slack.com");
    expect(location.pathname).toContain("/oauth/v2/authorize");
    expect((location.searchParams.get("client_id") ?? "").length).toBeGreaterThan(0);
    expect((location.searchParams.get("scope") ?? "").length).toBeGreaterThan(0);
    expect((location.searchParams.get("state") ?? "").length).toBeGreaterThan(0);

    const cookies = setCookiesOf(response);
    expect(cookies.length).toBeGreaterThan(0);
    const attributes = cookies.join("; ").toLowerCase();
    expect(attributes).toContain("httponly");
    expect(attributes).toContain("samesite=lax");
  });

  test("start refuses when the Slack app is not configured, and never redirects to a broken consent screen", async () => {
    const scope = await bed.member("unconfigured");

    for (const [label, patch] of [
      ["neither", { SLACK_CLIENT_ID: undefined, SLACK_CLIENT_SECRET: undefined }],
      ["only the id", { SLACK_CLIENT_SECRET: undefined }],
      ["only the secret", { SLACK_CLIENT_ID: undefined }],
    ] as const) {
      const response = await withEnv(patch, () =>
        drive(OAUTH_START, slackRequest(OAUTH_START), depsFor(scope)),
      );

      expect(`${label}:${response.status < 300 || response.status >= 400}`).toBe(`${label}:true`);
      expect(`${label}:${response.headers.get("location")}`).toBe(`${label}:null`);

      const raw = await response.clone().text();
      expect(raw).not.toContain("slack.com/oauth");
      expect(raw).not.toContain("stack");
      expect(raw).not.toMatch(/:\d+:\d+/);
      const sentences = collectStrings(await bodyOf(response));
      expect(sentences.some((value) => value.length > 20)).toBe(true);
    }
  });

  test("the redirect URI derives from BETTER_AUTH_URL and never from a request header", async () => {
    const scope = await bed.member("redirect-uri");

    const honest = await drive(OAUTH_START, slackRequest(OAUTH_START), depsFor(scope));
    const spoofed = await drive(
      OAUTH_START,
      slackRequest(OAUTH_START, {
        origin: `https://${SPOOFED_HOST}`,
        headers: {
          host: SPOOFED_HOST,
          "x-forwarded-host": SPOOFED_HOST,
          "x-forwarded-proto": "https",
          origin: `https://${SPOOFED_HOST}`,
        },
      }),
      depsFor(scope),
    );

    const honestUri = new URL(locationOf(honest), ORIGIN).searchParams.get("redirect_uri") ?? "";
    const spoofedUri = new URL(locationOf(spoofed), ORIGIN).searchParams.get("redirect_uri") ?? "";

    expect(honestUri.startsWith(APP_URL)).toBe(true);
    expect(honestUri).toContain("/api/first-run/slack/oauth/callback");
    expect(spoofedUri).toBe(honestUri);
    expect(spoofedUri).not.toContain(SPOOFED_HOST);
    expect(locationOf(spoofed)).not.toContain(SPOOFED_HOST);
  });

  test("a signed-out caller gets 401, and no state cookie is minted for them", async () => {
    const response = await drive(OAUTH_START, slackRequest(OAUTH_START), depsFor(null));

    expect(response.status).toBe(401);
    expect(setCookiesOf(response).length).toBe(0);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("GET /api/first-run/slack/oauth/callback (AD-5, AD-4)", () => {
  test("a state that does not match is refused at zero outbound calls, before the code is redeemed", async () => {
    const scope = await bed.member("mismatch");
    const pair = await beginOAuth(scope);

    const tampered: readonly { readonly label: string; readonly request: Request }[] = [
      {
        label: "a state parameter the cookie was not signed for",
        request: callbackRequest({ cookie: pair.cookie, state: `${pair.state}tampered` }),
      },
      {
        label: "no cookie at all",
        request: slackRequest(OAUTH_CALLBACK, {
          search: `?code=${AUTH_CODE}&state=${encodeURIComponent(pair.state)}`,
        }),
      },
    ];

    for (const { label, request } of tampered) {
      outbound.length = 0;
      await drive(OAUTH_CALLBACK, request, depsFor(scope));

      expect(`${label}:${outbound.map((call) => call.url).join(" ")}`).toBe(`${label}:`);
      expect(`${label}:${(await rawSlackRows(scope.organizationId)).length}`).toBe(`${label}:0`);
    }
  });

  test("a genuinely valid state signed in one organization is refused when the same founder redeems it in another, at zero outbound calls", async () => {
    // ONE founder in TWO organisations, not two people: two people are refused by the userId check, so the row would pass against a callback that never read the organization (D7).
    const founder = await bed.member("replay");

    const second = await createTestOrganization(bed.db, {
      name: "web-fr-oauth-org-replay-second",
      ownerUserId: founder.userId,
    });
    const inSecondOrg: SeededMemberScope = {
      userId: founder.userId,
      organizationId: second.id,
      ctx: await buildTestTenantContext(bed.db, {
        userId: founder.userId,
        organizationId: second.id,
      }),
    };

    const pair = await beginOAuth(founder);

    outbound.length = 0;
    const refused = await drive(OAUTH_CALLBACK, callbackRequest(pair), depsFor(inSecondOrg));

    expect(outbound.map((call) => call.url)).toEqual([]);
    expect(await rawSlackRows(second.id)).toEqual([]);
    expect(await rawSlackRows(founder.organizationId)).toEqual([]);

    expect(new URL(locationOf(refused), ORIGIN).pathname).toBe("/first-run");

    // Control - the very same pair, redeemed by the same founder acting in the organisation it was signed for, completes; without it the row passes against a callback that refuses everything.
    const accepted = await drive(OAUTH_CALLBACK, callbackRequest(pair), depsFor(founder));

    expect(outbound.length).toBeGreaterThan(0);
    expect((await activeRow(founder.organizationId)).channel_id).toBeNull();
    expect(await rawSlackRows(second.id)).toEqual([]);

    expect(locationOf(refused)).not.toBe(locationOf(accepted));
  });

  test("a valid callback seals the bot token under this organization's AAD and inserts with channel_id NULL", async () => {
    const scope = await bed.member("seal");
    const other = await bed.member("seal-other");

    await connectWorkspace(scope);

    const row = await activeRow(scope.organizationId);

    expect(row.channel_id).toBeNull();
    expect(row.is_active).toBe(true);

    const stored = textColumn(row, "credential_ciphertext");
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored.split(".").length).toBe(5);
    expect(leaks(stored, BOT_TOKEN)).toBeNull();
    expect(textColumn(row, "credential_key_id")).toMatch(/^[0-9a-f]{8}$/);

    const opened = decryptSecret(stored, key, slackCredentialAad(scope.ctx));
    expect(opened.ok).toBe(true);
    expect(opened.ok ? opened.value : null).toBe(BOT_TOKEN);

    // Control - without the other organization's AAD failing here, the row above passes against an envelope sealed under a constant.
    const lifted = decryptSecret(stored, key, slackCredentialAad(other.ctx));
    expect(lifted.ok).toBe(false);
  });

  test("the workspace name Slack returned is PERSISTED, not read and dropped", async () => {
    const scope = await bed.member("workspace-name");

    // A value nothing else in this suite writes: a route storing the org's own name, a constant or the team id would pass a row that only asserted "something is in the column".
    slackApi.teamName = "Fixture workspace named only here";

    await connectWorkspace(scope);

    expect(textColumn(await activeRow(scope.organizationId), "workspace_name")).toBe(
      "Fixture workspace named only here",
    );
  });

  test("a grant with no workspace name still connects — the credential is not traded for the caption", async () => {
    const scope = await bed.member("workspace-name-absent");
    slackApi.teamName = undefined;

    await connectWorkspace(scope);

    const row = await activeRow(scope.organizationId);
    expect(row.workspace_name).toBeNull();
    expect(row.channel_id).toBeNull();
  });

  test("the callback answers with no bot token in any encoding", async () => {
    const scope = await bed.member("no-token-out");
    const response = await connectWorkspace(scope);
    const raw = await response.clone().text();

    expect(leaks(`${raw} ${locationOf(response)}`, BOT_TOKEN)).toBeNull();
    expect(raw).not.toContain("credentialCiphertext");
    expect(raw).not.toContain("credential_ciphertext");
    expect(raw).not.toContain("credentialKeyId");
  });

  test("a second workspace for one organization is refused with no error code and no constraint name", async () => {
    const scope = await bed.member("second");

    await connectWorkspace(scope);
    slackApi.teamId = "T0SECOND";
    slackApi.teamName = "A second workspace";
    const second = await connectWorkspace(scope);

    expect((await rawSlackRows(scope.organizationId)).filter((row) => row.is_active).length).toBe(
      1,
    );

    const carried = `${locationOf(second)} ${await second.clone().text()}`;
    expect(carried).not.toContain("23505");
    expect(carried).not.toContain("slack_connections_active_org_uidx");
    expect(carried.toLowerCase()).not.toContain("unique");
    expect(carried.toLowerCase()).not.toContain("duplicate key");
    expect(carried.toLowerCase()).not.toContain("constraint");
  });

  test("a write failure that is NOT the second workspace lands too, and clears the cookie", async () => {
    const scope = await bed.member("write-failure");

    // A check that can never hold. NOT VALID so Postgres skips the back-check over rows earlier tests wrote, and still enforces on every INSERT.
    await bed.db.execute(
      `alter table slack_connections add constraint tmp_write_failure_probe check (false) not valid`,
    );

    let response: Response;
    try {
      response = await connectWorkspace(scope);
    } finally {
      await bed.db.execute(`alter table slack_connections drop constraint tmp_write_failure_probe`);
    }

    expect(outbound.length).toBeGreaterThan(0);

    expect(response.status).toBe(302);
    expect(new URL(locationOf(response), ORIGIN).pathname).toBe("/first-run");
    expect(new URL(locationOf(response), ORIGIN).searchParams.get("slack")).toBe("failed");
    expect(response.headers.get("set-cookie") ?? "").toContain("Max-Age=0");

    expect((await rawSlackRows(scope.organizationId)).length).toBe(0);
    const carried = `${locationOf(response)} ${await response.clone().text()}`;
    expect(carried.toLowerCase()).not.toContain("constraint");
    expect(carried.toLowerCase()).not.toContain("check");
  });

  test("the second-workspace refusal is settled by the constraint, not by a prior read", async () => {
    // EC-O6/D6 has no behavioural form - a read-then-write and a constraint-settled write differ only under concurrency, so the absent read is asserted in the source.
    const source = readRouteSource(OAUTH_CALLBACK);

    expect(source).toContain("insertActive");
    expect(source).not.toContain("getActiveForOrg");
  });

  test("the founder lands back on /first-run on both success and failure, never on a JSON body", async () => {
    const succeeding = await bed.member("land-ok");
    const failing = await bed.member("land-bad");

    const success = await connectWorkspace(succeeding);
    const pair = await beginOAuth(failing);
    const failure = await drive(
      OAUTH_CALLBACK,
      callbackRequest({ cookie: pair.cookie, state: `${pair.state}tampered` }),
      depsFor(failing),
    );

    for (const [label, response] of [
      ["success", success],
      ["failure", failure],
    ] as const) {
      const location = new URL(locationOf(response), ORIGIN);
      expect(`${label}:${location.pathname}`).toBe(`${label}:/first-run`);

      expect(`${label}:${response.headers.get("content-type") ?? ""}`).not.toContain(
        "application/json",
      );
    }

    expect(new URL(locationOf(failure), ORIGIN).search.length).toBeGreaterThan(0);
  });
});

describe("GET /api/first-run/slack/channels (AD-7)", () => {
  test("a channel created between two requests is in the second answer — the list is fetched live", async () => {
    const scope = await bed.member("live");
    await connectWorkspace(scope);

    slackApi.channels = [{ id: CHOSEN_CHANNEL, name: "growth" }];
    const first = await drive(CHANNELS, slackRequest(CHANNELS), depsFor(scope));
    expect(collectStrings(await bodyOf(first))).toContain("growth");

    slackApi.channels = [
      { id: CHOSEN_CHANNEL, name: "growth" },
      { id: OTHER_CHANNEL, name: "made-a-minute-ago" },
    ];
    const second = await drive(CHANNELS, slackRequest(CHANNELS), depsFor(scope));

    expect(collectStrings(await bodyOf(second))).toContain("made-a-minute-ago");
  });

  test("nothing about the channel list is stored", async () => {
    const source = readRouteSource(CHANNELS);

    expect(source).not.toContain(".insert(");
    expect(source).not.toContain("insert(");
    expect(source).not.toContain("upsert");
  });

  test("no connection is a named refusal, never an empty list", async () => {
    const scope = await bed.member("no-connection");

    const response = await drive(CHANNELS, slackRequest(CHANNELS), depsFor(scope));
    const body = await bodyOf(response);

    expect(response.status).not.toBe(200);
    expect(Object.keys(body)).not.toContain("channels");
    expect(collectStrings(body).some((value) => value.length > 20)).toBe(true);
  });

  test("the channels answer carries no bot token in any encoding", async () => {
    const scope = await bed.member("channels-token");
    await connectWorkspace(scope);

    const response = await drive(CHANNELS, slackRequest(CHANNELS), depsFor(scope));
    const raw = await response.clone().text();

    expect(leaks(raw, BOT_TOKEN)).toBeNull();
    expect(raw).not.toContain("access_token");
    expect(raw).not.toContain("credential_ciphertext");
  });
});

describe("POST /api/first-run/slack/channel (D7, D8)", () => {
  test("attaching writes this organization's row and leaves another organization's untouched", async () => {
    // D7 - two orgs are half-connected at once so "it wrote the only row there was" cannot be mistaken for "it wrote the right one".
    const mine = await bed.member("attach-mine");
    const theirs = await bed.member("attach-theirs");
    await connectWorkspace(mine);
    await connectWorkspace(theirs);

    const response = await drive(
      CHANNEL,
      slackRequest(CHANNEL, { body: { channelId: CHOSEN_CHANNEL } }),
      depsFor(mine, { poster: recordingPoster(OK_POST) }),
    );

    expect(response.status).toBe(200);
    expect((await activeRow(mine.organizationId)).channel_id).toBe(CHOSEN_CHANNEL);
    expect((await activeRow(theirs.organizationId)).channel_id).toBeNull();
  });

  // B-037's wire, end to end through the real route. The producer (the picker has the
  // name) and the consumer (a label renders it) each passed in isolation while nothing
  // carried the name between them — which is the pair D11 says proves nothing.
  test("the name the founder picked is stamped beside the address and named in the sentence", async () => {
    const scope = await bed.member("attach-names");
    await connectWorkspace(scope);

    const response = await drive(
      CHANNEL,
      slackRequest(CHANNEL, { body: { channelId: CHOSEN_CHANNEL } }),
      depsFor(scope, { poster: recordingPoster(OK_POST) }),
    );

    expect(response.status).toBe(200);

    const row = await activeRow(scope.organizationId);
    expect(row.channel_id).toBe(CHOSEN_CHANNEL);
    expect(row.channel_name).toBe("growth");

    // The sentence the founder reads names the channel, not the id.
    const sentence = String((await bodyOf(response)).sentence);
    expect(sentence).toContain("#growth");
    expect(sentence).not.toContain(CHOSEN_CHANNEL);
  });

  test("an actor whose organization has no connection cannot attach to anyone else's", async () => {
    const stranger = await bed.member("attach-stranger");
    const victim = await bed.member("attach-victim");
    await connectWorkspace(victim);

    const response = await drive(
      CHANNEL,
      slackRequest(CHANNEL, { body: { channelId: CHOSEN_CHANNEL } }),
      depsFor(stranger, { poster: recordingPoster(OK_POST) }),
    );

    expect(response.status).not.toBe(200);
    expect((await rawSlackRows(stranger.organizationId)).length).toBe(0);
    expect((await activeRow(victim.organizationId)).channel_id).toBeNull();
  });

  test("attaching triggers the shipped test post rather than a second implementation of it", async () => {
    const scope = await bed.member("attach-post");
    await connectWorkspace(scope);

    const poster = recordingPoster(OK_POST);
    await drive(
      CHANNEL,
      slackRequest(CHANNEL, { body: { channelId: CHOSEN_CHANNEL } }),
      depsFor(scope, { poster }),
    );

    expect(poster.sent.length).toBe(1);

    const expected = buildTestPostMessage({
      channelId: CHOSEN_CHANNEL,
      workspaceName: scope.ctx.organizationName,
      connectedByName: await readUserName(scope.userId),
    });
    expect(poster.sent[0]).toEqual(expected);
  });

  test("a failing test post does not roll back the attach", async () => {
    const scope = await bed.member("attach-post-fails");
    await connectWorkspace(scope);

    const poster = recordingPoster({
      ok: false,
      code: "channel_unavailable",
      message: POST_FAILURE_MESSAGES.channel_unavailable,
    });
    const response = await drive(
      CHANNEL,
      slackRequest(CHANNEL, { body: { channelId: CHOSEN_CHANNEL } }),
      depsFor(scope, { poster }),
    );

    expect((await activeRow(scope.organizationId)).channel_id).toBe(CHOSEN_CHANNEL);

    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(collectStrings(body)).toContain(POST_FAILURE_MESSAGES.channel_unavailable);
    expect(Object.keys(body)).toContain("retryable");
    expect(Object.keys(body)).toContain("marksStepDone");
  });

  test("a channel id that is not in the live list is refused, and nothing is stamped", async () => {
    const scope = await bed.member("unlisted");
    await connectWorkspace(scope);

    slackApi.channels = [{ id: CHOSEN_CHANNEL, name: "growth" }];

    const poster = recordingPoster(OK_POST);
    const response = await drive(
      CHANNEL,
      slackRequest(CHANNEL, { body: { channelId: OTHER_CHANNEL } }),
      depsFor(scope, { poster }),
    );

    expect(response.status).not.toBe(200);

    expect((await activeRow(scope.organizationId)).channel_id).toBeNull();

    expect(poster.sent.length).toBe(0);

    // The control lives in the first row of this group - a listed channel answers 200 and stamps, so this refusal is not a route that refuses everything.
    expect(collectStrings(await bodyOf(response)).some((value) => value.length > 20)).toBe(true);
  });

  test("a second attach is refused by name, changes nothing, and sends no post", async () => {
    // D12 - the delivery ledger's identity is (organization, finding, channel); moving the channel forks every recorded delivery and replays the backlog.
    const scope = await bed.member("attach-twice");
    await connectWorkspace(scope);

    const poster = recordingPoster(OK_POST);
    const first = await drive(
      CHANNEL,
      slackRequest(CHANNEL, { body: { channelId: CHOSEN_CHANNEL } }),
      depsFor(scope, { poster }),
    );

    // Control - the refusal below means nothing against a route that refuses every attach.
    expect(first.status).toBe(200);
    expect((await activeRow(scope.organizationId)).channel_id).toBe(CHOSEN_CHANNEL);
    expect(poster.sent.length).toBe(1);

    const second = await drive(
      CHANNEL,
      slackRequest(CHANNEL, { body: { channelId: OTHER_CHANNEL } }),
      depsFor(scope, { poster }),
    );

    expect(second.status).not.toBe(200);

    expect((await activeRow(scope.organizationId)).channel_id).toBe(CHOSEN_CHANNEL);

    expect(poster.sent.length).toBe(1);

    const body = await bodyOf(second);

    // The refusal names the channel the founder PICKED, not its id: this sentence read
    // "already sends what we find to #C01AB2CD3EF", which is B-037 on the very route
    // that fixes it (two tabs, a double submit, or a teammate a moment later).
    expect(collectStrings(body)).toContain(channelAlreadyChosen("growth").message);
    expect(collectStrings(body).join(" ")).toContain("#growth");
    expect(collectStrings(body).join(" ")).not.toContain(CHOSEN_CHANNEL);

    expect(second.status).toBe(409);
  });

  test("a teammate submitting the channel a moment later is told which one is set, not that nothing is connected", async () => {
    const owner = await bed.member("attach-race-owner");
    const teammate = await bed.member("attach-race-mate", owner.organizationId);
    await connectWorkspace(owner);

    const poster = recordingPoster(OK_POST);
    await drive(
      CHANNEL,
      slackRequest(CHANNEL, { body: { channelId: CHOSEN_CHANNEL } }),
      depsFor(owner, { poster }),
    );

    const second = await drive(
      CHANNEL,
      slackRequest(CHANNEL, { body: { channelId: OTHER_CHANNEL } }),
      depsFor(teammate, { poster }),
    );

    const said = collectStrings(await bodyOf(second)).join(" ");
    // Named, not identified: the teammate is told which channel is set in the words
    // the owner picked it by (B-037).
    expect(said).toContain(channelAlreadyChosen("growth").message);
    expect(said).not.toContain(NO_WORKSPACE_CONNECTED.message);
  });

  test("a signed-out caller cannot attach a channel", async () => {
    const response = await drive(
      CHANNEL,
      slackRequest(CHANNEL, { body: { channelId: CHOSEN_CHANNEL } }),
      depsFor(null, { poster: recordingPoster(OK_POST) }),
    );

    expect(response.status).toBe(401);
  });
});

describe("the half-connected window is visible to the screen (AD-4)", () => {
  test("a workspace with no channel yet reads as attached and undelivered, not as unconnected", async () => {
    const scope = await bed.member("half");

    const before = await bodyOf(await drive(STATUS, routeRequest(STATUS), depsFor(scope)));
    await connectWorkspace(scope);
    const after = await bodyOf(await drive(STATUS, routeRequest(STATUS), depsFor(scope)));

    expect(before.slackWorkspaceAttached).toBe(false);
    expect(after.slackWorkspaceAttached).toBe(true);

    expect(after.channelId).toBeNull();
    expect(after.slackNotice).not.toBeNull();
  });
});
