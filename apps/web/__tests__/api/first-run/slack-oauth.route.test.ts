// The four Slack routes that delete "go and find your channel id": oauth/start,
// oauth/callback, channels, channel. Wave 0, task 0.6. ADD AD-4, AD-5, AD-7.
//
// ###########################################################################
// # THE OUTBOUND CALL IS THE UNIT OF PROOF IN THIS FILE, SO IT IS COUNTED
// # TWICE.
// #
// # AD-5's whole argument is that a callback whose `state` does not match must
// # be refused BEFORE the code is redeemed — otherwise an attacker's `code`
// # becomes a bot token sealed into the victim's organization. "Refused before
// # the exchange" is not observable from a status code; it is observable only
// # from the ABSENCE of a request to Slack. So every handler call in this file
// # goes through `drive()`, which does two things at once:
// #
// #   1. hands the route a FAKE `deps.fetch` that records every call, and
// #   2. swaps `globalThis.fetch` for a recorder that ALSO records and then
// #      throws.
// #
// # Both push into ONE array. Without (2) a route that ignored the injected
// # fetch and reached for the global would show zero calls on the fake and pass
// # the row that exists to catch it — a green assertion measuring nothing. The
// # swap is restored in a `finally` and never leaves this file's own call
// # window; nothing global is patched to make anything pass, only to make one
// # row capable of failing.
// ###########################################################################
//
// ── WHY THE COOKIE NAME IS NOWHERE IN THIS FILE ─────────────────────────────
//
// The callback needs the cookie `start` set and the `state` `start` echoed.
// Both are read back OFF THE START RESPONSE rather than guessed, so this suite
// pins the WIRE (a value produced by one route and consumed by another) and not
// the wave's choice of cookie name. That is the D11 shape the ADD names on
// AD-6: a producer test and a consumer test both pass while the wire between
// them is severed, and only a row that drives both ends catches it.
//
// ── WHAT IS ASSERTED STRUCTURALLY, AND WHY IT HAS TO BE ─────────────────────
//
// Two claims have no behavioural form. "Refused BY THE CONSTRAINT, not by a
// prior read" (EC-O6, D6) and "the channel list is never stored" (AD-7) both
// describe code that is absent, and an absence of code is only visible in the
// source. Those two rows read the route file; every other row drives it.
//
// Lane prefix `web-fr-oauth`.
import { eq, schema, slackCredentialAad } from "@growthmind/db";
import {
  decryptSecret,
  parseServerEnv,
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
import { buildTestPostMessage } from "@/lib/first-run/slack-test-message";
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

/**
 * The four routes, declared HERE rather than appended to `FIRST_RUN_ROUTES`.
 *
 * That constant is AD-16's own table of the EIGHT routes O-008 shipped, and
 * `status.route.test.ts` asserts it matches the route files on disk exactly.
 * Wave 0f owns both. Task 0.5 is writing a fifth descriptor for the discovery
 * route on this same branch, and two Wave 0 agents editing one frozen array is
 * a merge conflict with nothing gained: every loader in the helper takes a
 * DESCRIPTOR, so a locally declared one drives the real machinery unchanged.
 *
 * A CONSEQUENCE WORTH STATING RATHER THAN DISCOVERING IN WAVE 5: the moment
 * these route files land, `every route file on disk is declared in
 * FIRST_RUN_ROUTES` goes red, because five new `route.ts` files will exist that
 * the eight-row table does not name. That row is doing its job — it is AD-16's
 * "that test also catches the next route somebody adds" firing on exactly the
 * next routes somebody added. Wave 5 must extend `FIRST_RUN_ROUTES` with these
 * five descriptors, at which point the three strictness rows in
 * `status.route.test.ts` cover them automatically and the local copies below
 * become redundant rather than wrong.
 */
const WAVE_5 = "ADD Wave 5, tasks 5.2-5.5 (the four Slack routes)";

const OAUTH_START: FirstRunRouteDescriptor = Object.freeze({
  id: "slack-oauth-start",
  path: "/api/first-run/slack/oauth/start",
  method: "GET",
  modulePath: "apps/web/app/api/first-run/slack/oauth/start/route",
  sourcePath: "apps/web/app/api/first-run/slack/oauth/start/route.ts",
  declaredKeys: [],
  validBody: {},
  ownedBy: WAVE_5,
});

const OAUTH_CALLBACK: FirstRunRouteDescriptor = Object.freeze({
  id: "slack-oauth-callback",
  path: "/api/first-run/slack/oauth/callback",
  method: "GET",
  modulePath: "apps/web/app/api/first-run/slack/oauth/callback/route",
  sourcePath: "apps/web/app/api/first-run/slack/oauth/callback/route.ts",
  declaredKeys: [],
  validBody: {},
  ownedBy: WAVE_5,
});

const CHANNELS: FirstRunRouteDescriptor = Object.freeze({
  id: "slack-channels",
  path: "/api/first-run/slack/channels",
  method: "GET",
  modulePath: "apps/web/app/api/first-run/slack/channels/route",
  sourcePath: "apps/web/app/api/first-run/slack/channels/route.ts",
  declaredKeys: [],
  validBody: {},
  ownedBy: WAVE_5,
});

const CHANNEL: FirstRunRouteDescriptor = Object.freeze({
  id: "slack-channel",
  path: "/api/first-run/slack/channel",
  method: "POST",
  modulePath: "apps/web/app/api/first-run/slack/channel/route",
  sourcePath: "apps/web/app/api/first-run/slack/channel/route.ts",
  // AD-7's contract block: `firstRunSlackChannelInputSchema` is
  // `z.strictObject({ channelId })`. NO tenancy key — the organization comes
  // from the session, and the row it attaches to comes from the organization.
  declaredKeys: ["channelId"],
  validBody: { channelId: "C01AB2CD3EF" },
  ownedBy: WAVE_5,
});

const NEW_SLACK_ROUTES: readonly FirstRunRouteDescriptor[] = Object.freeze([
  OAUTH_START,
  OAUTH_CALLBACK,
  CHANNELS,
  CHANNEL,
]);

const STATUS = routeById("status");

/** Fixture-shaped, never real key material — this repository is public. */
const BOT_TOKEN = "xoxb-oauth-fixture-token-never-real";
const AUTH_CODE = "fixture-authorization-code";
const CHOSEN_CHANNEL = "C01AB2CD3EF";
const OTHER_CHANNEL = "C09ZZ9ZZ9ZZ";

/** The app address the redirect URI must derive from, and a host a caller can
 *  spoof but must never reach. Deliberately unlike each other. */
const APP_URL = "https://app.growthmind.test";
const SPOOFED_HOST = "evil.example";

const OK_POST: PostResult = { ok: true, messageRef: "1712345678.000100" };

let bed: FirstRunTestBed;
let credentialKey: CredentialKeyResolution;
let key: CredentialKey;
const priorEnv = new Map<string, string | undefined>();

beforeAll(async () => {
  bed = await createFirstRunTestBed("oauth");

  // The envelope rows below decrypt what the route sealed, which needs THE SAME
  // key the route used. Injecting the resolution rather than letting the handler
  // resolve it is the seam `slack/connect/route.ts` already reads
  // (`deps.credentialKey ?? resolveCredentialKey(...)`), so nothing new is
  // invented here.
  credentialKey = resolveCredentialKey(parseServerEnv(process.env));
  if (!credentialKey.ok) {
    throw new Error(
      `this suite cannot seal or open an envelope because the installation key did not resolve ` +
        `(${credentialKey.reason}). Every other suite in this directory depends on the same dev ` +
        `default, so this is a broken environment rather than a Wave 0 red.`,
    );
  }
  key = credentialKey.key;

  // A configured Slack app and a known app address, so the misconfigured row is
  // the one that removes them rather than the ambient state of the machine.
  setEnv({
    SLACK_CLIENT_ID: "1234567890.0987654321",
    SLACK_CLIENT_SECRET: "fixture-client-secret-never-real",
    BETTER_AUTH_URL: APP_URL,
  });
});

afterAll(async () => {
  restoreEnv();
  await bed?.close();
});

// ---------------------------------------------------------------------------
// The environment, moved and put back
// ---------------------------------------------------------------------------

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

/** Runs `fn` with `patch` applied, and puts every touched variable back —
 *  including on a throw, so one red row cannot make the next one red too. */
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

// ---------------------------------------------------------------------------
// The outbound ledger — one array, two recorders
// ---------------------------------------------------------------------------

interface OutboundCall {
  readonly url: string;
  /** `true` when the route reached for `globalThis.fetch` rather than the
   *  injected port. Recorded rather than merely refused, so the failure message
   *  can say WHICH mistake was made. */
  readonly escaped: boolean;
}

const outbound: OutboundCall[] = [];

/** What the vendor answers, mutable so a row can change the world between two
 *  requests — which is how "listed live, never cached" is provable at all. */
const slackApi = {
  botToken: BOT_TOKEN,
  teamId: "T0FIXTURE",
  teamName: "Fixture workspace",
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

/**
 * Slack's own two endpoints, answering the shapes Slack documents.
 *
 * The match is on a SUBSTRING of the URL rather than on an exact address, so a
 * route that adds query parameters or posts a form body still reaches the right
 * answer — the contract being pinned is "which vendor method was called", not
 * how the wave chose to spell the request.
 */
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

/** The global, for the duration of one handler call. Records first so the
 *  ledger sees the escape, then refuses so the row cannot silently proceed. */
const escapedFetch = (async (input: RequestInfo | URL): Promise<Response> => {
  const url = urlOf(input);
  outbound.push({ url, escaped: true });
  throw new Error(
    `this route called globalThis.fetch (${url}) instead of the injected deps.fetch. AD-5 and ` +
      `AD-7 both require the fetch to be injected: without it, "a mismatched state costs zero ` +
      `outbound calls" is unprovable, and a test that cannot fail is not a test.`,
  );
}) as unknown as typeof globalThis.fetch;

// ---------------------------------------------------------------------------
// The deps seam, plus the one field this sprint adds to it
// ---------------------------------------------------------------------------

/**
 * `FirstRunRouteDeps` with the injected fetch these four routes need.
 *
 * ONE NEW FIELD, NOT THREE. The alternative was a port per vendor call
 * (`exchangeCode`, `listChannels`), which would have pinned the wave's internal
 * decomposition as well as its behaviour. The ADD already asks for exactly this
 * — `lib/slack/oauth.ts` "inject the clock and the fetch", `listChannels(token,
 * deps)` — and `resolveFirstRunDeps` already threads `globalThis.fetch` into
 * the PostHog source the same way. So the seam is the one the composition root
 * has, and how a route reaches Slack behind it stays the wave's choice.
 */
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

/**
 * Drives one route with the global fetch guarded.
 *
 * The module is loaded BEFORE the swap: a dynamic import runs module-level code,
 * and taking that down with a guard meant for the handler would produce a red
 * naming the wrong thing.
 */
async function drive(
  route: FirstRunRouteDescriptor,
  request: Request,
  deps: SlackRouteDeps,
): Promise<Response> {
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
  /** A different origin, for the open-redirect row. */
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

// ---------------------------------------------------------------------------
// Reading the two halves of the state pair back off the start response
// ---------------------------------------------------------------------------

function setCookiesOf(response: Response): readonly string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single === null ? [] : [single];
}

/** Every `Set-Cookie` from `start`, as the `Cookie` header a browser would send
 *  back. The NAME is never written down here — see this file's header. */
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

/** The whole consent round trip, as the founder walks it. */
async function connectWorkspace(
  scope: SeededMemberScope,
  extra?: Partial<SlackRouteDeps>,
): Promise<Response> {
  const pair = await beginOAuth(scope);
  return drive(OAUTH_CALLBACK, callbackRequest(pair), depsFor(scope, extra));
}

// ---------------------------------------------------------------------------
// The stored row, read raw — the point of several rows is what the COLUMNS hold
// ---------------------------------------------------------------------------

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
  // Read as a string only when it IS one: `String(unknown)` renders an object as
  // "[object Object]" and would quietly pass a scan that never inspected it.
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

/** Records and answers, NEVER throws — the shipped port does not throw, and a
 *  fake that did would let the D8 row pass by catching an exception the real
 *  poster will never raise. */
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

// ===========================================================================
// AD-16 / AD-16a — the four new schemas, on the same terms as the eight
// ===========================================================================

describe("the four new Slack routes accept no tenancy id (AD-16, AD-16a)", () => {
  test("each new route declares exactly its own input keys and neither tenancy key", async () => {
    // SHAPE ONLY, and it does not stand alone: Wave 0a measured that
    // `Object.keys(shape)` is identical for `z.object` and `z.strictObject`, so
    // a green here says nothing about refusal. The two rows below are the half
    // that bites. Kept because a DECLARED tenancy key is a louder defect than a
    // merely tolerated one.
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
    // The constructor, not the key list. Three of these four declare NO input,
    // which is where a plain `z.object({})` accepts anything at all — so the
    // probe uses a key that has nothing to do with tenancy.
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
    // The behavioural half, on the one new route that takes a body at all. A
    // schema row proves the schema; this proves the HANDLER runs it.
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
});

// ===========================================================================
// GET /api/first-run/slack/oauth/start (AD-5, AD-6)
// ===========================================================================

describe("GET /api/first-run/slack/oauth/start (AD-5)", () => {
  test("start sends the founder to Slack's consent screen and sets the state cookie httpOnly and SameSite=Lax", async () => {
    const scope = await bed.member("start");
    const response = await drive(OAUTH_START, slackRequest(OAUTH_START), depsFor(scope));

    // A REDIRECT, not a page and not a JSON body: the consent screen is Slack's,
    // and anything we render in front of it is a screen a founder has to get
    // past before the one that matters.
    expect(response.status).toBe(302);

    const location = new URL(locationOf(response), ORIGIN);
    expect(location.host).toBe("slack.com");
    expect(location.pathname).toContain("/oauth/v2/authorize");
    expect((location.searchParams.get("client_id") ?? "").length).toBeGreaterThan(0);
    expect((location.searchParams.get("scope") ?? "").length).toBeGreaterThan(0);
    expect((location.searchParams.get("state") ?? "").length).toBeGreaterThan(0);

    // THE COOKIE IS THE OTHER HALF OF THE PAIR (AD-5). httpOnly, or a script on
    // any page of this app can read the value that authorises a workspace to be
    // attached to this organization. SameSite=Lax, or a third-party page can
    // cause the round trip to be walked with the victim's cookie attached.
    const cookies = setCookiesOf(response);
    expect(cookies.length).toBeGreaterThan(0);
    const attributes = cookies.join("; ").toLowerCase();
    expect(attributes).toContain("httponly");
    expect(attributes).toContain("samesite=lax");
  });

  test("start refuses when the Slack app is not configured, and never redirects to a broken consent screen", async () => {
    // AD-6: absent env means the OAuth path does not render. A 302 into Slack's
    // consent screen with no client id is a dead end wearing a working feature's
    // clothes — the founder leaves the product, reads a Slack error page about
    // an app that does not exist, and has nowhere to go back to.
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

      // Named, in plain English, and never a link into the broken screen.
      const raw = await response.clone().text();
      expect(raw).not.toContain("slack.com/oauth");
      expect(raw).not.toContain("stack");
      expect(raw).not.toMatch(/:\d+:\d+/);
      const sentences = collectStrings(await bodyOf(response));
      expect(sentences.some((value) => value.length > 20)).toBe(true);
    }
  });

  test("the redirect URI derives from BETTER_AUTH_URL and never from a request header", async () => {
    // AN OPEN REDIRECT IS WHAT A HOST-DERIVED REDIRECT URI IS. If the callback
    // address is built from the Host (or X-Forwarded-Host) a caller can set,
    // then a request through an attacker-controlled hostname sends Slack's
    // authorization code to the attacker — and that code seals a bot token into
    // this organization. The URL, the Host header and the forwarded host are all
    // spoofed here, so a route reading ANY of the three fails.
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
    // THE REQUEST CHANGED NOTHING. Same value, both times.
    expect(spoofedUri).toBe(honestUri);
    expect(spoofedUri).not.toContain(SPOOFED_HOST);
    // And nothing else on the redirect carries the spoofed host either.
    expect(locationOf(spoofed)).not.toContain(SPOOFED_HOST);
  });

  test("a signed-out caller gets 401, and no state cookie is minted for them", async () => {
    const response = await drive(OAUTH_START, slackRequest(OAUTH_START), depsFor(null));

    expect(response.status).toBe(401);
    // A signed-out caller has no organization for a state to be bound to, so a
    // cookie handed out here would be a signed pair with nothing on the other
    // end of it.
    expect(setCookiesOf(response).length).toBe(0);
    expect(response.headers.get("location")).toBeNull();
  });
});

// ===========================================================================
// GET /api/first-run/slack/oauth/callback (AD-5, AD-4, AD-20)
// ===========================================================================

describe("GET /api/first-run/slack/oauth/callback (AD-5, AD-4)", () => {
  test("a state that does not match is refused at zero outbound calls, before the code is redeemed", async () => {
    // THE ROW AD-5 EXISTS FOR. A code redeemed under a mismatched state is an
    // attacker's workspace sealed into the victim's organization, and the only
    // observable difference between "refused after the exchange" and "refused
    // before it" is whether a request to Slack happened at all.
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
      // And nothing was written either: a refusal that still inserted a row
      // would have redeemed nothing and attached something.
      expect(`${label}:${(await rawSlackRows(scope.organizationId)).length}`).toBe(`${label}:0`);
    }
  });

  test("a valid callback seals the bot token under this organization's AAD and inserts with channel_id NULL", async () => {
    const scope = await bed.member("seal");
    const other = await bed.member("seal-other");

    await connectWorkspace(scope);

    const row = await activeRow(scope.organizationId);

    // AD-4: THE ROW IS HALF-CONNECTED ON PURPOSE. A workspace is attached and
    // nothing can be delivered yet, which is a state the schema must be able to
    // hold — the channel is chosen on the next screen, not typed on this one.
    expect(row.channel_id).toBeNull();
    expect(row.is_active).toBe(true);

    // AD-20's envelope shape, and the fingerprint rather than the key (D12).
    const stored = textColumn(row, "credential_ciphertext");
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored.split(".").length).toBe(5);
    expect(leaks(stored, BOT_TOKEN)).toBeNull();
    expect(textColumn(row, "credential_key_id")).toMatch(/^[0-9a-f]{8}$/);

    // THE AAD IS THE ASSERTION, NOT THE ENCRYPTION. An envelope sealed under the
    // wrong additional data writes perfectly and fails at DELIVERY time, per
    // customer, silently — which is why `slackCredentialAad(ctx)` has exactly one
    // producer. Opening it under this organization's AAD must give the token
    // back...
    const opened = decryptSecret(stored, key, slackCredentialAad(scope.ctx));
    expect(opened.ok).toBe(true);
    expect(opened.ok ? opened.value : null).toBe(BOT_TOKEN);

    // ...and opening it under ANOTHER organization's must not. Without this
    // control the row above would pass against an envelope sealed under a
    // constant.
    const lifted = decryptSecret(stored, key, slackCredentialAad(other.ctx));
    expect(lifted.ok).toBe(false);
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

    // Still exactly one active row — the second attempt attached nothing.
    expect((await rawSlackRows(scope.organizationId)).filter((row) => row.is_active).length).toBe(
      1,
    );

    // WHAT REACHES THE CUSTOMER IS A SENTENCE, NEVER THE DATABASE'S OWN WORDS.
    // A 23505 or an index name on a screen is a bug wearing a database's
    // clothes. The redirect target is included in the scan because the failure
    // travels back on the query string, not in a body.
    const carried = `${locationOf(second)} ${await second.clone().text()}`;
    expect(carried).not.toContain("23505");
    expect(carried).not.toContain("slack_connections_active_org_uidx");
    expect(carried.toLowerCase()).not.toContain("unique");
    expect(carried.toLowerCase()).not.toContain("duplicate key");
    expect(carried.toLowerCase()).not.toContain("constraint");
  });

  test("the second-workspace refusal is settled by the constraint, not by a prior read", async () => {
    // EC-O6 / D6, and it has no behavioural form: a read-then-write and a
    // constraint-settled write are indistinguishable from outside on a
    // serialized test database, and differ only when two members press the
    // button in the same second on a real one. So the absence of the read is
    // asserted where an absence is visible.
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

      // NEVER A JSON BODY. This is the one route in the sprint a browser lands
      // on directly rather than reaching from script, and a founder who sees
      // `{"ok":false}` has been dropped outside the product with no way back.
      expect(`${label}:${response.headers.get("content-type") ?? ""}`).not.toContain(
        "application/json",
      );
    }

    // And the failure says SOMETHING, so the page can render a sentence rather
    // than returning the founder to an unchanged screen that looks like nothing
    // happened. Silent degradation is a bug.
    expect(new URL(locationOf(failure), ORIGIN).search.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// GET /api/first-run/slack/channels (AD-7)
// ===========================================================================

describe("GET /api/first-run/slack/channels (AD-7)", () => {
  test("a channel created between two requests is in the second answer — the list is fetched live", async () => {
    // AD-7's whole claim: no table, no sync, no staleness, and "a channel
    // created a minute ago must be pickable". A cached list passes a
    // single-request row and fails a founder who made the channel first.
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
    // The other half of "listed live": a route that writes what it read has a
    // staleness problem the moment it is read again, and a table nobody reaps.
    const source = readRouteSource(CHANNELS);

    expect(source).not.toContain(".insert(");
    expect(source).not.toContain("insert(");
    expect(source).not.toContain("upsert");
  });

  test("no connection is a named refusal, never an empty list", async () => {
    // AN EMPTY LIST IS A LIE HERE. "[]" reads as "your workspace has no
    // channels", which sends a founder to Slack to create one they already have
    // — work that cannot help, caused by us.
    const scope = await bed.member("no-connection");

    const response = await drive(CHANNELS, slackRequest(CHANNELS), depsFor(scope));
    const body = await bodyOf(response);

    expect(response.status).not.toBe(200);
    expect(Object.keys(body)).not.toContain("channels");
    // Named, and in a sentence rather than a code.
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

// ===========================================================================
// POST /api/first-run/slack/channel (AD-7, D7, D8)
// ===========================================================================

describe("POST /api/first-run/slack/channel (D7, D8)", () => {
  test("attaching writes this organization's row and leaves another organization's untouched", async () => {
    // D7. The body carries a channel id and no organization, and the row it
    // reaches is chosen by the repository's own filter — so there is no value on
    // this request that could select somebody else's connection. Two orgs are
    // half-connected at once precisely so "it wrote the only row there was"
    // cannot be mistaken for "it wrote the right one".
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
    // THE OTHER ORGANIZATION IS STILL HALF-CONNECTED. If this is not null, the
    // attach was keyed on something a request can name.
    expect((await activeRow(theirs.organizationId)).channel_id).toBeNull();
  });

  test("an actor whose organization has no connection cannot attach to anyone else's", async () => {
    // The same D7 boundary from the other side: a caller with nothing of their
    // own must be refused rather than quietly landed on the nearest row.
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

    // ONE post, through the shipped port.
    expect(poster.sent.length).toBe(1);

    // AND IT IS THE SHIPPED MESSAGE, BYTE FOR BYTE. A deep equality against
    // `buildTestPostMessage`'s own output is what separates "reused the shipped
    // builder" from "wrote a second one that also mentions the channel" — and
    // the second one drifts from the first the first time the copy changes.
    // EC-O1: this post is how the rest of the workspace learns, so a message
    // that lost the connector's name is a regression nobody would see.
    const expected = buildTestPostMessage({
      channelId: CHOSEN_CHANNEL,
      workspaceName: scope.ctx.organizationName,
      connectedByName: await readUserName(scope.userId),
    });
    expect(poster.sent[0]).toEqual(expected);
  });

  test("a failing test post does not roll back the attach", async () => {
    // D8. THE CHANNEL IS CHOSEN; DELIVERY HEALTH IS A SEPARATE FACT. Undoing the
    // pick because the first message did not land would send the founder back to
    // a screen they already completed, to redo a choice that was correct.
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

    // THE ATTACH SURVIVED.
    expect((await activeRow(scope.organizationId)).channel_id).toBe(CHOSEN_CHANNEL);

    // And the answer is the shape `slack/test` already returns, so the form's
    // retryable logic keeps working without learning a second vocabulary.
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(collectStrings(body)).toContain(POST_FAILURE_MESSAGES.channel_unavailable);
    expect(Object.keys(body)).toContain("retryable");
    expect(Object.keys(body)).toContain("marksStepDone");
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

// ===========================================================================
// AD-4's producer, at the wire
// ===========================================================================

describe("the half-connected window is visible to the screen (AD-4)", () => {
  test("a workspace with no channel yet reads as attached and undelivered, not as unconnected", async () => {
    // THE WHOLE POINT OF THE NULLABLE COLUMN. Between the consent screen and the
    // channel pick there is a real state — a workspace is attached and nothing
    // can be delivered — and a status payload that cannot express it leaves the
    // page showing "Connect Slack" to a founder who just connected Slack.
    // `SetupFacts.workspaceAttached` has had no producer since the blocker chain
    // shipped; this is it.
    const scope = await bed.member("half");

    const before = await bodyOf(await drive(STATUS, routeRequest(STATUS), depsFor(scope)));
    await connectWorkspace(scope);
    const after = await bodyOf(await drive(STATUS, routeRequest(STATUS), depsFor(scope)));

    expect(before.slackWorkspaceAttached).toBe(false);
    expect(after.slackWorkspaceAttached).toBe(true);

    // AND NOTHING IS DELIVERABLE YET. A reader that treats a row's existence as
    // "connected" posts to a channel that is not there (AD-4's last row, the one
    // that ships silent corruption).
    expect(after.channelId).toBeNull();
    expect(after.slackNotice).not.toBeNull();
  });
});
