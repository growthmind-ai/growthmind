import { type ScopedDb } from "@growthmind/db";
import { createTestDb, type TestDb, type TestDbHandle } from "@growthmind/db/testing";
import type { CredentialKeyResolution, DeliveryPoster, TenantContext } from "@growthmind/shared";

import {
  loadModuleUnderConstruction,
  readSourceUnderConstruction,
  underConstructionSpecifier,
} from "../../../../../../packages/shared/__tests__/onboarding/module-under-construction";
import {
  asSafeParsingSchema,
  type ParseErrorLike,
  type ParseIssueLike,
  type SafeParseOutcome,
  type SafeParsingSchema,
} from "../../../../../../packages/shared/__tests__/onboarding/probes/strict-zod-fixtures";
import {
  buildTestTenantContext,
  createTestOrganization,
  createTestAuth,
  signUpTestUser,
} from "../../../tenancy/helpers/auth-fixture";

export function webLaneNames(fileToken: string): {
  orgName: (label: string) => string;
  userName: (label: string) => string;
  email: (label: string) => string;
  projectName: (label: string) => string;
} {
  const base = `web-fr-${fileToken}`;
  return {
    orgName: (label) => `${base}-org-${label}`,
    userName: (label) => `${base}-user-${label}`,

    email: (label) => `${base}-${label}@example.com`,
    projectName: (label) => `${base}-project-${label}`,
  };
}

export interface FirstRunRouteDescriptor {
  readonly id: string;

  readonly path: string;
  readonly method: "GET" | "POST";

  readonly modulePath: string;

  readonly sourcePath: string;

  readonly declaredKeys: readonly string[];

  readonly validBody: Readonly<Record<string, unknown>>;

  readonly ownedBy: string;
}

const WAVE_6B = "ADD Wave 6b (the eight routes under apps/web/app/api/first-run/)";

export const FIRST_RUN_ROUTES: readonly FirstRunRouteDescriptor[] = Object.freeze([
  {
    id: "status",
    path: "/api/first-run/status",
    method: "GET",
    modulePath: "apps/web/app/api/first-run/status/route",
    sourcePath: "apps/web/app/api/first-run/status/route.ts",
    declaredKeys: [],
    validBody: {},
    ownedBy: WAVE_6B,
  },
  {
    id: "analytics-connect",
    path: "/api/first-run/analytics/connect",
    method: "POST",
    modulePath: "apps/web/app/api/first-run/analytics/connect/route",
    sourcePath: "apps/web/app/api/first-run/analytics/connect/route.ts",

    declaredKeys: ["host", "sourceProjectId", "personalApiKey"],
    validBody: {
      host: "https://eu.posthog.example.invalid",
      sourceProjectId: "00000",

      personalApiKey: "phx_fixture_not_a_real_key",
    },
    ownedBy: WAVE_6B,
  },
  {
    id: "analytics-disconnect",
    path: "/api/first-run/analytics/disconnect",
    method: "POST",
    modulePath: "apps/web/app/api/first-run/analytics/disconnect/route",
    sourcePath: "apps/web/app/api/first-run/analytics/disconnect/route.ts",
    declaredKeys: [],
    validBody: {},
    ownedBy: WAVE_6B,
  },
  {
    id: "slack-connect",
    path: "/api/first-run/slack/connect",
    method: "POST",
    modulePath: "apps/web/app/api/first-run/slack/connect/route",
    sourcePath: "apps/web/app/api/first-run/slack/connect/route.ts",
    declaredKeys: ["botToken", "channelId"],
    validBody: { botToken: "xoxb-fixture-not-a-real-token", channelId: "C01AB2CD3EF" },
    ownedBy: WAVE_6B,
  },
  {
    id: "slack-test",
    path: "/api/first-run/slack/test",
    method: "POST",
    modulePath: "apps/web/app/api/first-run/slack/test/route",
    sourcePath: "apps/web/app/api/first-run/slack/test/route.ts",
    declaredKeys: [],
    validBody: {},
    ownedBy: WAVE_6B,
  },
  {
    id: "slack-skip",
    path: "/api/first-run/slack/skip",
    method: "POST",
    modulePath: "apps/web/app/api/first-run/slack/skip/route",
    sourcePath: "apps/web/app/api/first-run/slack/skip/route.ts",
    declaredKeys: [],
    validBody: {},
    ownedBy: WAVE_6B,
  },
  {
    id: "arm",
    path: "/api/first-run/arm",
    method: "POST",
    modulePath: "apps/web/app/api/first-run/arm/route",
    sourcePath: "apps/web/app/api/first-run/arm/route.ts",
    declaredKeys: [],
    validBody: {},
    ownedBy: WAVE_6B,
  },
  {
    id: "dismiss",
    path: "/api/first-run/dismiss",
    method: "POST",
    modulePath: "apps/web/app/api/first-run/dismiss/route",
    sourcePath: "apps/web/app/api/first-run/dismiss/route.ts",
    declaredKeys: [],
    validBody: {},
    ownedBy: WAVE_6B,
  },
]);

export const TENANCY_KEYS = Object.freeze(["projectId", "organizationId"] as const);
export type TenancyKey = (typeof TENANCY_KEYS)[number];

export const FIRST_RUN_API_DIR = "apps/web/app/api/first-run";

export interface FirstRunRouteDeps {
  readonly db: ScopedDb;

  readonly tenant: () => Promise<TenantContext | null>;

  readonly now: () => Date;

  readonly createSource?: unknown | undefined;

  readonly credentialKey?: CredentialKeyResolution | undefined;

  readonly poster?: DeliveryPoster | undefined;
}

export type FirstRunRouteHandler = (request: Request, deps: FirstRunRouteDeps) => Promise<Response>;

export const ROUTE_SCHEMA_EXPORT = "inputSchema";
export const ROUTE_HANDLER_EXPORT = "handle";

export async function loadRouteModule(
  route: FirstRunRouteDescriptor,
): Promise<Record<string, unknown>> {
  return loadModuleUnderConstruction({
    modulePath: underConstructionSpecifier(route.modulePath),
    ownedBy: route.ownedBy,
  });
}

export async function loadRouteInputSchema(
  route: FirstRunRouteDescriptor,
): Promise<SafeParsingSchema> {
  const namespace = await loadRouteModule(route);
  const schema = asSafeParsingSchema(namespace[ROUTE_SCHEMA_EXPORT]);

  if (!schema) {
    throw new Error(
      `NOT IMPLEMENTED YET: ${route.modulePath} exports no zod \`${ROUTE_SCHEMA_EXPORT}\`. ` +
        `AD-16a requires every first-run route input schema to be a z.strictObject() exported ` +
        `under that name — including the six routes whose declared input is none, where ` +
        `z.strictObject({}) is what refuses a client-supplied projectId. ${route.ownedBy} owns it. ` +
        `Found: ${typeof namespace[ROUTE_SCHEMA_EXPORT]}.`,
    );
  }

  return schema;
}

export async function loadRouteHandler(
  route: FirstRunRouteDescriptor,
): Promise<FirstRunRouteHandler> {
  const namespace = await loadRouteModule(route);
  const handler = namespace[ROUTE_HANDLER_EXPORT];

  if (typeof handler !== "function") {
    throw new Error(
      `NOT IMPLEMENTED YET: ${route.modulePath} exports no callable \`${ROUTE_HANDLER_EXPORT}\`. ` +
        `AD-16 requires one uniform, deps-taking entry point per route so the eight share one ` +
        `preamble and the §9 rows can loop them. ${route.ownedBy} owns it. Found: ${typeof handler}.`,
    );
  }

  return handler as FirstRunRouteHandler;
}

export function readRouteSource(route: FirstRunRouteDescriptor): string {
  return readSourceUnderConstruction({
    repoRelativePath: route.sourcePath,
    ownedBy: route.ownedBy,
  });
}

export function routeById(id: string): FirstRunRouteDescriptor {
  const route = FIRST_RUN_ROUTES.find((candidate) => candidate.id === id);
  if (!route) {
    throw new Error(`first-run-route-contract: no route declared with id "${id}"`);
  }
  return route;
}

export type StrictnessVerdict =
  | { readonly ok: true; readonly keys: readonly string[] }
  | { readonly ok: false; readonly why: string };

export function verifyRefusesUnknownKey(
  schema: SafeParsingSchema,
  validBody: Readonly<Record<string, unknown>>,
  key: string,
): StrictnessVerdict {
  const body = { ...validBody, [key]: "value-a-client-should-never-be-able-to-send" };

  let result: SafeParseOutcome;
  try {
    result = schema.safeParse(body);
  } catch (error) {
    return {
      ok: false,
      why: `safeParse THREW on a body carrying "${key}" — a schema that refuses by throwing cannot produce a 400 with a sentence from our table: ${String(error)}`,
    };
  }

  if (result.success) {
    return {
      ok: false,
      why:
        `the schema ACCEPTED a body carrying "${key}" and returned success:true with ` +
        `${JSON.stringify(result.data)} — the client-supplied value was SILENTLY STRIPPED, ` +
        `which is a 200, not a 4xx. This is exactly the plain z.object() failure AD-16a names, ` +
        `and Object.keys(shape) is IDENTICAL for it and for z.strictObject().`,
    };
  }

  const issues = result.error.issues;
  if (issues.length !== 1) {
    return {
      ok: false,
      why: `expected ONE issue for one unknown key (measured trap 2: N unknown keys collapse into one issue), got ${issues.length}: ${JSON.stringify(issues)}`,
    };
  }

  const issue = issues[0];
  if (!issue || issue.code !== "unrecognized_keys") {
    return {
      ok: false,
      why: `the schema refused, but with code "${issue?.code ?? "none"}" rather than "unrecognized_keys" — a refusal for the wrong reason maps to the wrong sentence`,
    };
  }

  const keys = unrecognizedKeysOf(issue);
  if (!keys.includes(key)) {
    return {
      ok: false,
      why: `the refusal did not name "${key}" in issue.keys (measured trap 1: the names are in issue.keys, NOT issue.path, which is ${JSON.stringify(issue.path)}). Got: ${JSON.stringify(keys)}`,
    };
  }

  return { ok: true, keys };
}

export function unrecognizedKeysOf(issue: ParseIssueLike): readonly string[] {
  const keys: unknown = issue.keys;
  return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : [];
}

export interface FirstRunRefusal {
  readonly code: "unrecognized_keys" | "invalid_body";

  readonly message: string;

  readonly status: 400;
}

export type DescribeBodyRefusal = (error: ParseErrorLike) => FirstRunRefusal;

export const REFUSAL_HELPER_MODULE = "apps/web/lib/first-run/refusals";
export const REFUSAL_HELPER_SOURCE = "apps/web/lib/first-run/refusals.ts";
export const WAVE_6A = "ADD Wave 6a, task 6a.2 (apps/web/lib/first-run/, AD-16 + AD-16a)";

export async function loadDescribeBodyRefusal(): Promise<DescribeBodyRefusal> {
  const namespace = await loadModuleUnderConstruction({
    modulePath: underConstructionSpecifier(REFUSAL_HELPER_MODULE),
    ownedBy: WAVE_6A,
  });
  const helper = namespace.describeBodyRefusal;

  if (typeof helper !== "function") {
    throw new Error(
      `NOT IMPLEMENTED YET: ${REFUSAL_HELPER_MODULE} exports no callable \`describeBodyRefusal\`. ` +
        `AD-16a's three measured shape traps live in this one mapping: issue.path is [] (the names ` +
        `are on issue.keys), N unknown keys collapse into ONE issue, and a null/array/string/number ` +
        `body refuses as invalid_type rather than unrecognized_keys. ${WAVE_6A} owns it. ` +
        `Found: ${typeof helper}.`,
    );
  }

  return helper as DescribeBodyRefusal;
}

const ORIGIN = "http://localhost:3000";

export function routeRequest(
  route: FirstRunRouteDescriptor,
  body?: unknown,
  init?: { readonly search?: string },
): Request {
  const url = `${ORIGIN}${route.path}${init?.search ?? ""}`;
  if (route.method === "GET" || body === undefined) {
    return new Request(url, { method: route.method });
  }
  return new Request(url, {
    method: route.method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `first-run route answered with a body that is not JSON (status ${response.status}): ${text.slice(0, 400)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`first-run route answered with a non-object body: ${text.slice(0, 400)}`);
  }
  return { ...(parsed as Record<string, unknown>) };
}

export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      out.push(key);
      collectStrings(child, out);
    }
    return out;
  }
  return out;
}

export function encodingsOf(secret: string): readonly string[] {
  const forms = new Set<string>([
    secret,
    encodeURIComponent(secret),
    Buffer.from(secret, "utf8").toString("base64"),
    Buffer.from(secret, "utf8").toString("base64url"),
    Buffer.from(secret, "utf8").toString("hex"),
    JSON.stringify(secret).slice(1, -1),
  ]);

  if (secret.length >= 12) forms.add(secret.slice(0, 12));
  return [...forms];
}

export function leaks(haystack: string, secret: string): string | null {
  for (const form of encodingsOf(secret)) {
    if (form.length > 0 && haystack.includes(form)) return form;
  }
  return null;
}

export interface SeededMemberScope {
  readonly userId: string;
  readonly organizationId: string;
  readonly ctx: TenantContext;
}

export interface FirstRunTestBed {
  readonly db: TestDb;
  readonly close: () => Promise<void>;

  readonly member: (label: string, organizationId?: string) => Promise<SeededMemberScope>;
}

export async function createFirstRunTestBed(fileToken: string): Promise<FirstRunTestBed> {
  const names = webLaneNames(fileToken);
  const handle: TestDbHandle = await createTestDb();
  const auth = createTestAuth(handle.db);
  let counter = 0;

  return {
    db: handle.db,
    close: handle.close,
    member: async (label, organizationId) => {
      counter += 1;
      const token = `${label}-${counter}`;
      const user = await signUpTestUser(auth, {
        name: names.userName(token),
        email: names.email(token),
        password: "correct-horse-battery-staple",
      });
      const orgId =
        organizationId ??
        (
          await createTestOrganization(handle.db, {
            name: names.orgName(token),
            ownerUserId: user.id,
          })
        ).id;

      if (organizationId) {
        await joinOrganization(handle.db, {
          userId: user.id,
          organizationId,
        });
      }

      const ctx = await buildTestTenantContext(handle.db, {
        userId: user.id,
        organizationId: orgId,
      });
      return { userId: user.id, organizationId: orgId, ctx };
    },
  };
}

async function joinOrganization(
  db: TestDb,
  input: { userId: string; organizationId: string },
): Promise<void> {
  const { schema } = await import("@growthmind/db");
  const { randomUUID } = await import("node:crypto");
  await db.insert(schema.member).values({
    id: `member-${randomUUID()}`,
    organizationId: input.organizationId,
    userId: input.userId,
    role: "member",
    createdAt: new Date(),
  });
}

export function tenantOf(ctx: TenantContext | null): () => Promise<TenantContext | null> {
  return async () => ctx;
}

export function clockAt(instant: Date): () => Date {
  return () => new Date(instant.getTime());
}
