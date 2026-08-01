// THE EIGHT FIRST-RUN ROUTES, DECLARED ONCE (AD-16, AD-16a, AD-17, AD-18).
//
// ###########################################################################
// # WHY THIS FILE EXISTS, AND WHY IT IS NOT AN APPEND TO
// # `packages/shared/__tests__/onboarding/contract-shapes.ts`.
// #
// # `apps/web/tsconfig.json` includes `**/*.ts` RELATIVE TO `apps/web`. It
// # does not include `packages/shared/__tests__`, so a route suite's contract
// # types cannot live there and be seen by this package's typecheck as a
// # first-class member of its own program. The three loaders in
// # `module-under-construction.ts` ARE imported across that boundary (waves
// # 0d and 0e established the pattern and it works — a file pulled in as a
// # dependency of an included file is checked), but a second package's
// # __tests__ tree is the wrong home for THIS package's route contract, and
// # wave 0g is appending to `contract-shapes.ts` in parallel on the same
// # branch. One index, two writers, no upside.
// #
// # NOTHING HERE IS A FORK. The onboarding view-model shapes stay in
// # `contract-shapes.ts` and are imported from there where a row needs them.
// # What lives here is the ROUTE surface: the eight modules, their deps seam,
// # and the strictness prober AD-16a requires.
// ###########################################################################
//
// ---------------------------------------------------------------------------
// THE ONE THING TO READ BEFORE EDITING ANY ROW THAT USES THIS FILE
// ---------------------------------------------------------------------------
//
// AD-16a, measured by Wave 0a against the installed zod 4.4.3:
//
//     z.object       + projectId -> success=true   data={"stepId":"…"}   200
//     z.strictObject + projectId -> success=false  code=unrecognized_keys 400
//     Object.keys(shape) — IDENTICAL for both: [ "stepId" ]
//
// So key enumeration CANNOT tell a schema that REFUSES a client-supplied
// tenancy id from one that SILENTLY STRIPS it and answers 200. The repo has
// ZERO uses of `.strict()` today; every shipped input schema is a plain
// `z.object()` (`packages/shared/src/mcp/types.ts:305,319,325`), and execution
// agents pattern-match on their neighbours. The default failure mode of AD-16
// as originally written is eight non-strict routes, a 200 for a client-supplied
// `projectId`, and every enumeration row green.
//
// THEREFORE: `verifyRefusesUnknownKey` below returns a VERDICT, never a
// boolean, and every §9 strictness row asserts on `issue.code ===
// "unrecognized_keys"` — never on `Object.keys(shape)` alone. That is a
// standing BANNED ROW rule (ADD §9). `strictness-control.test.ts`-style
// controls live inside `status.route.test.ts` and prove the prober BITES: a
// planted plain `z.object()` must fail it, a `z.strictObject()` must pass it.
// A detector nobody proved is a detector nobody has.
// ---------------------------------------------------------------------------
// A NOTE ON THE ONE IMPORT THAT IS NOT HERE: `zod`.
//
// `apps/web/package.json` declares NO `zod` dependency, and bun's isolated
// store means `apps/web/node_modules/zod` does not exist — `import { z } from
// "zod"` inside this package does not resolve, at runtime or at typecheck.
// That is a real, checkable fact about this tree, and it has a consequence for
// WAVE 6 that is worth stating here rather than discovering during
// implementation: **AD-16a's `z.strictObject()` cannot be written in an
// `apps/web` route file as the tree stands.** The route schemas must either be
// declared in `packages/shared/src/onboarding/` and re-exported by each route
// module (which is what AD-2 argues for anyway — "the routes and the
// components are on opposite sides of a serialization boundary and a shape
// defined on one side is a D11 wire waiting to be severed"), or `apps/web`
// gains a `zod` dependency. THE CONTRACT BELOW IS INDIFFERENT: it requires the
// route module's NAMESPACE to carry `inputSchema`, not that the schema is
// constructed in that file.
//
// So this file describes a parsing schema STRUCTURALLY, and the real-zod
// fixtures the strictness controls and the refusal-mapping traps need live in
// `packages/shared/__tests__/onboarding/probes/strict-zod-fixtures.ts`, where
// `zod` resolves. Same reason `module-under-construction.ts` lives there.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Suite-unique fixture naming (the O-002 retro's rule, lane prefix `web-`)
// ---------------------------------------------------------------------------

/**
 * Four suites in this directory boot their own PGlite and sign up their own
 * users. `db-lane-fixtures.ts` earned this convention the hard way: four
 * suites colliding on one reused `user.email` read as a correct red and was
 * not. Every org name, email and project name below carries the lane prefix
 * plus a per-file token plus the caller's label.
 */
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
    // example.com is IANA-reserved; nothing here addresses a real mailbox.
    email: (label) => `${base}-${label}@example.com`,
    projectName: (label) => `${base}-project-${label}`,
  };
}

// ---------------------------------------------------------------------------
// AD-16 — the eight routes, and nothing else may be under that tree
// ---------------------------------------------------------------------------

/**
 * One first-run route, as AD-16's own table declares it (lines 477-486).
 *
 * `declaredKeys` is the EXACT input-schema key set from that table. Two of the
 * eight take fields; six take none, and for those `declaredKeys` is `[]` —
 * which under AD-16a still means `z.strictObject({})`, NOT an absent schema
 * and NOT `z.object({})`. Those six are precisely the routes where a
 * non-strict schema accepts ANYTHING AT ALL, which is why §9 puts an
 * unknown-key row on each POST group rather than only on the GET.
 */
export interface FirstRunRouteDescriptor {
  /** Stable id used in test names and failure messages. */
  readonly id: string;
  /** The URL AD-16 assigns. Never retyped anywhere else in this suite. */
  readonly path: string;
  readonly method: "GET" | "POST";
  /** Repo-root-relative, extensionless — feeds `underConstructionSpecifier`. */
  readonly modulePath: string;
  /** Repo-root-relative WITH extension — feeds `readSourceUnderConstruction`. */
  readonly sourcePath: string;
  /** AD-16's declared input keys. Never contains a tenancy id, by decision. */
  readonly declaredKeys: readonly string[];
  /**
   * A body that SATISFIES `declaredKeys` — the baseline the strictness prober
   * adds one unknown key to. For the six no-input routes this is `{}`, which
   * is the ordinary body of a `POST` with nothing to say.
   */
  readonly validBody: Readonly<Record<string, unknown>>;
  /** The task that creates it. Lands in every red so it names its own owner. */
  readonly ownedBy: string;
}

const WAVE_6B = "ADD Wave 6b (the eight routes under apps/web/app/api/first-run/)";

/**
 * AD-16's table, transcribed. The ORDER is the table's order.
 *
 * A ninth route added under `app/api/first-run/` without an entry here fails
 * `every first-run route on disk is declared here` — which is the mechanical
 * form of AD-16's "that test also catches the next route somebody adds".
 */
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
    // AD-16 line 480. NO `projectId` — the row this whole file exists for.
    declaredKeys: ["host", "sourceProjectId", "personalApiKey"],
    validBody: {
      host: "https://eu.posthog.example.invalid",
      sourceProjectId: "00000",
      // Fixture-shaped, never real key material — this repository is public.
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

/** The two keys AD-16 refuses at the wire. Written once; every row loops it. */
export const TENANCY_KEYS = Object.freeze(["projectId", "organizationId"] as const);
export type TenancyKey = (typeof TENANCY_KEYS)[number];

export const FIRST_RUN_API_DIR = "apps/web/app/api/first-run";

// ---------------------------------------------------------------------------
// The deps seam — the ONE thing every route takes besides its Request
// ---------------------------------------------------------------------------

/**
 * The injectable half of AD-16's preamble.
 *
 * UNDER-SPECIFIED BY THE ADD, DERIVED RATHER THAN GUESSED — and the derivation
 * has exactly one precedent, which this copies rather than improves on.
 * `apps/web/app/api/mcp/route.ts` exports `resolveMcpDeps(db = getDb())` and
 * puts the decision in `@/lib/mcp/server`'s `handleMcpRequest(request, deps)`,
 * "so the whole surface is driven end to end through its real entry point"
 * (that file's own header). `apps/web/__tests__/mcp/wiring.test.ts` then drives
 * the MOUNTED verb with a PGlite handle in `getDb()`'s stash. AD-16's eight
 * routes need the same seam for the same reason, plus one this surface has and
 * the machine surface does not: **tenancy comes from a SESSION, and
 * `getTenantContext()` reads `next/headers`, which throws outside a Next.js
 * request scope and is therefore permanently `null` in a bare test process**
 * (`apps/web/lib/tenant.ts` documents that throw; `redirects.test.ts` depends
 * on it). A signed-in route that cannot be handed a tenant context cannot be
 * behaviourally tested at all.
 *
 * WHAT IS DELIBERATELY ABSENT, AND IS THE WHOLE POINT: there is no
 * `projectId` and no `organizationId` on this type. `ensureProject(db, ctx)`
 * derives the project from the context, and the context comes from `tenant()`.
 * **A value that cannot arrive cannot be mis-scoped** (AD-16's rationale).
 * A field added here later re-opens exactly the hole AD-16 closed.
 *
 * The three optional ports are the effects only some handlers have; each is
 * the SHIPPED type, never a new port (AD-20, FR-O11's "no new poster").
 */
export interface FirstRunRouteDeps {
  readonly db: ScopedDb;
  /** THE ONLY TENANCY INPUT ON THIS SURFACE. `null` ⇒ 401, never data. */
  readonly tenant: () => Promise<TenantContext | null>;
  /** Injected so `armedAt` is assertable without sleeping on a real clock. */
  readonly now: () => Date;
  /** `analytics/connect` only — the SHIPPED `CreateSourceFn`. */
  readonly createSource?: unknown | undefined;
  /** The inherited insecure-defaults gate, checked FIRST and UNCONDITIONALLY. */
  readonly credentialKey?: CredentialKeyResolution | undefined;
  /** `slack/test` only — `createSlackDeliveryPoster`'s port, never a new one. */
  readonly poster?: DeliveryPoster | undefined;
}

/**
 * Every first-run route module exports this under this name.
 *
 * ONE NAME ACROSS ALL EIGHT is the point: AD-16 says "every handler's preamble
 * is identical and is the whole tenancy story", and a uniform entry point is
 * what lets the §9 rows LOOP over the eight rather than hand-listing them —
 * which is what makes them catch the ninth route somebody adds. Wave 6b may
 * implement the body in `apps/web/lib/first-run/` and re-export it here; the
 * contract is the route module's namespace, not where the code sits.
 */
export type FirstRunRouteHandler = (request: Request, deps: FirstRunRouteDeps) => Promise<Response>;

/**
 * Every first-run route module also exports its input schema under this name,
 * constructed with `z.strictObject()` (AD-16a). For the six no-input routes
 * that is `z.strictObject({})` — an EMPTY STRICT object, which still refuses
 * `{ projectId }` with `unrecognized_keys`. An absent schema, or a plain
 * `z.object({})`, accepts anything at all.
 */
export const ROUTE_SCHEMA_EXPORT = "inputSchema";
export const ROUTE_HANDLER_EXPORT = "handle";

// ---------------------------------------------------------------------------
// Loaders — every red names an absent BEHAVIOUR, never a bare TS2307/ENOENT
// ---------------------------------------------------------------------------

/** The route module's whole namespace, or the named Wave 0 diagnostic. */
export async function loadRouteModule(
  route: FirstRunRouteDescriptor,
): Promise<Record<string, unknown>> {
  return loadModuleUnderConstruction({
    modulePath: underConstructionSpecifier(route.modulePath),
    ownedBy: route.ownedBy,
  });
}

/**
 * The route's input schema, proven to BE a zod schema before any row parses
 * through it.
 *
 * The presence check is `safeParse`-shaped rather than `instanceof z.ZodType`:
 * `apps/web` and `packages/shared` resolve zod through bun's isolated store, and
 * an `instanceof` across two resolutions of one package is the kind of false
 * red `module-under-construction.ts`'s header exists to abolish.
 */
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

/** The route's handler, proven callable before any row drives it. */
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

/** The route's source, for the structural rows. Named diagnostic on absence. */
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

// ---------------------------------------------------------------------------
// AD-16a — the strictness prober. THE ROW THAT ENUMERATION CANNOT WRITE.
// ---------------------------------------------------------------------------

/**
 * What a probe of one schema against one unknown key found.
 *
 * A VERDICT, NOT A BOOLEAN, deliberately: `expect(probe(...)).toBe(true)` on a
 * failure prints `expected true, received false`, which tells a reader nothing
 * about WHICH of the three ways a schema can be wrong actually happened —
 * accepted-and-stripped, refused with the wrong code, or threw. The `why`
 * string carries the measured evidence into the failure message, so a red
 * reads as a diagnosis.
 */
export type StrictnessVerdict =
  | { readonly ok: true; readonly keys: readonly string[] }
  | { readonly ok: false; readonly why: string };

/**
 * Does this schema REFUSE `key` — or accept it and quietly drop it?
 *
 * THE ASSERTION IS `issue.code === "unrecognized_keys"`, NEVER
 * `Object.keys(shape)`. Wave 0a measured that enumeration is identical for
 * `z.object` and `z.strictObject` (probe-notes.md §"The gap this probe found"),
 * so an enumeration-only row is green against a route that answers 200 to a
 * client-supplied tenancy id. That is a standing BANNED ROW.
 *
 * The offending names are read from `issue.keys` and NOT from `issue.path` —
 * measured trap 1: `path` is `[]` on an `unrecognized_keys` issue. A prober
 * written against `path` reports "refused, but I cannot say what for" on every
 * correct schema, which is a detector that cannot fail informatively.
 */
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

/**
 * The offending names off an `unrecognized_keys` issue.
 *
 * MEASURED TRAP 1 IN ONE PLACE. zod 4.4.3 puts them on `issue.keys` and leaves
 * `issue.path` as `[]`; `z.flattenError` puts the message in `formErrors` with
 * `fieldErrors: {}`. A helper written against `path` — or a test expecting the
 * field under `fieldErrors` — produces an empty, uninformative refusal.
 */
export function unrecognizedKeysOf(issue: ParseIssueLike): readonly string[] {
  const keys: unknown = issue.keys;
  return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : [];
}

// ---------------------------------------------------------------------------
// AD-16a's refusal-to-sentence mapping — the Wave 6a boundary helper
// ---------------------------------------------------------------------------

/**
 * What the 400-body helper returns.
 *
 * UNDER-SPECIFIED, FLAGGED RATHER THAN GUESSED. AD-16 states the obligation
 * ("returns 400 on failure, with a sentence from our table and never a raw Zod
 * message") and §5 puts the helper under `apps/web/lib/first-run/`, but names
 * neither the export nor its shape. This mirrors `McpRefusal`
 * (`apps/web/lib/mcp/refusals.ts:73`) field for field — the one shipped
 * refusal shape in this app — so the wave that writes it copies a precedent
 * rather than inventing a second vocabulary for the same job.
 */
export interface FirstRunRefusal {
  /** Which of the two refusal SHAPES this was. Keys the sentence, not the copy. */
  readonly code: "unrecognized_keys" | "invalid_body";
  /** Plain English, from our table. NEVER a zod message. */
  readonly message: string;
  /** Always 400: an unknown key is a 4xx, never a 500 and never a 200. */
  readonly status: 400;
}

export type DescribeBodyRefusal = (error: ParseErrorLike) => FirstRunRefusal;

export const REFUSAL_HELPER_MODULE = "apps/web/lib/first-run/refusals";
export const REFUSAL_HELPER_SOURCE = "apps/web/lib/first-run/refusals.ts";
export const WAVE_6A = "ADD Wave 6a, task 6a.2 (apps/web/lib/first-run/, AD-16 + AD-16a)";

/** `describeBodyRefusal`, or the named Wave 0 diagnostic. */
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

// ---------------------------------------------------------------------------
// Driving a route: requests, responses, and the two deep scans
// ---------------------------------------------------------------------------

const ORIGIN = "http://localhost:3000";

/** A real `Request` for a route, with an optional JSON body. */
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

/** The parsed JSON body of a response, as a plain record. */
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

/**
 * Every string ANYWHERE in a value, at any depth, including object KEYS.
 *
 * The two scan rows — `the response carries no expectedLag anywhere` (AD-3 at
 * the wire) and `the response carries no credential in any encoding` — are
 * both "anywhere" claims, and a top-level key check answers neither. AD-3's
 * whole argument is that `expectedLag` reaches a customer as
 * "85 seconds… 280 seconds" through a nested counter object, and
 * `connections.service.ts:154-165` states why an exact-string scrub of a
 * top-level field misses a leaky upstream's URL-encoded echo.
 */
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

/**
 * The encodings a secret can reach a response in without appearing verbatim.
 *
 * FR-7's inherited bar is that no key material reaches a customer surface in
 * ANY encoding, and `connections.service.ts:154-165` names three forms an
 * exact-string scrub misses: URL-encoded, JSON-escaped, truncated. Base64 is
 * added because the ADD's own row says "the seeded token AND its base64 form".
 */
export function encodingsOf(secret: string): readonly string[] {
  const forms = new Set<string>([
    secret,
    encodeURIComponent(secret),
    Buffer.from(secret, "utf8").toString("base64"),
    Buffer.from(secret, "utf8").toString("base64url"),
    Buffer.from(secret, "utf8").toString("hex"),
    JSON.stringify(secret).slice(1, -1),
  ]);
  // A truncation long enough to be unmistakably this secret and not a coincidence.
  if (secret.length >= 12) forms.add(secret.slice(0, 12));
  return [...forms];
}

/** Does `haystack` carry `secret` in any of the encodings above? */
export function leaks(haystack: string, secret: string): string | null {
  for (const form of encodingsOf(secret)) {
    if (form.length > 0 && haystack.includes(form)) return form;
  }
  return null;
}

// ---------------------------------------------------------------------------
// A real org, a real member, a real tenant context — over a real PGlite
// ---------------------------------------------------------------------------

export interface SeededMemberScope {
  readonly userId: string;
  readonly organizationId: string;
  readonly ctx: TenantContext;
}

export interface FirstRunTestBed {
  readonly db: TestDb;
  readonly close: () => Promise<void>;
  /**
   * Signs up a real user through Better Auth and puts them in `organizationId`
   * (a fresh org when omitted), returning the real `TenantContext` the routes'
   * `tenant()` hands back. Two calls with one `organizationId` produce the
   * TEAMMATE the D1/EC-O2 rows need.
   */
  readonly member: (label: string, organizationId?: string) => Promise<SeededMemberScope>;
}

/**
 * One PGlite + one Better Auth instance for a suite.
 *
 * Uses the SHIPPED `apps/web/__tests__/tenancy/helpers/auth-fixture.ts` rather
 * than a second harness — that file was extracted for exactly this ("built once
 * so the parallel apps/web integration suites share one working harness instead
 * of each reinventing it"), and `buildTestTenantContext` assembles the context
 * from PERSISTED organization + member rows, so the ids a route scopes by are
 * real ids and not a fixture's opinion of one.
 */
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

/**
 * Adds an EXISTING user to an EXISTING organization as a plain member.
 *
 * `createTestOrganization` only ever mints an owner, and EC-O2/AC-O17's whole
 * claim is about the TEAMMATE WHO SET NOTHING UP — "org membership is the
 * whole floor, no role gate". A fixture that could only produce owners could
 * not express the actor the row is about.
 */
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

/** A tenant thunk over a fixed context — what `deps.tenant` is in every row. */
export function tenantOf(ctx: TenantContext | null): () => Promise<TenantContext | null> {
  return async () => ctx;
}

/** A frozen clock, so `armedAt` is assertable without sleeping. */
export function clockAt(instant: Date): () => Date {
  return () => new Date(instant.getTime());
}
