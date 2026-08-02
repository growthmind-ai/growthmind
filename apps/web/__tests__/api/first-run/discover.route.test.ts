// POST /api/first-run/analytics/discover — the paste-a-key door (O-008 follow-on,
// AD-1, AD-2, AD-3, AD-16, AD-16a). Wave 0, task 0.5.
//
// ###########################################################################
// # THIS ROUTE IS A DOOR, NOT A FLOW — the same division `analytics/connect`
// # already draws. `discoverProjects` (AD-1, packages/adapters) owns the probe
// # order, the 401-falls-through-to-the-next-origin rule, the 0/1/n shapes and
// # the `id`-not-`project_id` mapping; those are task 0.2's rows and are not
// # repeated here.
// #
// # WHAT THE DOOR OWES, AND WHAT EVERY ROW BELOW IS ABOUT:
// #   1. The session is the only tenancy input. The body has no `projectId`
// #      and the schema REFUSES one by name (AD-16, AD-16a) — before any
// #      probe is made.
// #   2. ONLY THE CODE CROSSES THE BOUNDARY. A refusal renders the sentence
// #      our own table holds for that code. The source's `message` is DROPPED,
// #      not scrubbed, for the reason `connections.service.ts:154-165` states:
// #      a leaky upstream can echo a key back URL-encoded, JSON-escaped or
// #      truncated, three forms an exact-string scrub misses.
// #   3. The personal key is read off the parsed body, handed to the probe,
// #      and appears in no response, no log line and no thrown value.
// #   4. Success is `{ host, projects[] }` — a LIST, at every arity. The
// #      one-project auto-select of AD-3 is the screen's decision, so a route
// #      that collapsed n=1 into a different shape would sever it.
// ###########################################################################
//
// ── THE ROUTE DESCRIPTOR IS THE SHARED ONE, AND THAT IS THE END OF A STORY ──
//
// This file was written before `analytics/discover/route.ts` existed, and it
// declared a LOCAL descriptor for it — because `status.route.test.ts`'s
// `every route file on disk is declared in FIRST_RUN_ROUTES` row was green
// against the routes that existed, and declaring a route nobody had written
// would have turned it red in a file this task did not own. The local copy was
// written self-retiring for exactly this moment.
//
// The route landed, that row went red naming it, and `FIRST_RUN_ROUTES` now
// carries its descriptor. So this file reads the SHARED one: one table, no
// second copy to drift, and this route is inside the AD-16 tenancy block that
// loops every route on the surface rather than being asserted only here.
//
// ── THE ONE THING THE ADD DOES NOT NAME, DERIVED RATHER THAN GUESSED ────────
//
// The ADD gives `discoverProjects(input, deps)` in `packages/adapters` and it
// gives the route, but it never names the seam between them. `apps/web` cannot
// call the adapter directly in a test process without a real `fetch`, and this
// surface already has one answer to that: `FirstRunRouteDeps`, whose
// `createSource` is a port the composition root binds and a suite replaces.
//
// This file requires the same shape for discovery: an optional `discoverProjects`
// port on the deps, taking the input and returning the result, with its effects
// already bound — exactly as `CreateSourceFn` takes a config and returns a
// source with `fetch`/`sleep`/`now` already closed over. If the implementing
// wave picks a different name, IT MUST CHANGE THIS NAME HERE TOO rather than
// leave the rows red; a port nobody can inject is a route nobody can test.
//
// Lane prefix `web-fr-discover`.
import { REDACTED_PLACEHOLDER } from "@growthmind/adapters";
import {
  CONNECT_REFUSAL_MESSAGES,
  sourceFailureCodeSchema,
  type SourceFailureCode,
} from "@growthmind/shared";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  CONTROL_VALID_BODY,
  dotStrictControl,
  enumerateShapeKeys,
  plainObjectControl,
  strictObjectControl,
} from "../../../../../packages/shared/__tests__/onboarding/probes/strict-zod-fixtures";
import {
  TENANCY_KEYS,
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

const CLOCK = clockAt(new Date("2026-08-01T10:00:00.000Z"));

/** AD-16's table, from the one place it is declared. See the header. */
const DISCOVER = routeById("analytics-discover");

/**
 * Fixture-shaped, never real key material — this repository is public.
 *
 * READ OFF THE SHARED DESCRIPTOR rather than declared beside it. Every row
 * below posts `DISCOVER.validBody`, and this constant is the needle `leaks()`
 * hunts for in what those rows produce. A second literal here would be one edit
 * to the table away from a scan looking for a value nothing ever sent — green,
 * and measuring nothing. So the body and the needle are the same string by
 * construction, and the read below refuses rather than degrades if they stop
 * being.
 *
 * Long enough that `leaks()`'s 12-character truncation form is unmistakably
 * this value and not a coincidence of some other string in the payload.
 */
const PERSONAL_API_KEY = fixtureString(DISCOVER.validBody, "personalApiKey");

/**
 * One string field off a descriptor's `validBody`, or a named failure.
 *
 * NOT `String(body[key])`: that turns a missing field into the literal
 * `"undefined"` and hands `leaks()` a needle that is in no response — the
 * vacuous-scan failure this whole suite is written to avoid.
 */
function fixtureString(body: Readonly<Record<string, unknown>>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `first-run-route-contract: the analytics-discover descriptor's validBody carries no ` +
        `non-empty string \`${key}\`. Every row in this file posts that body and scans the ` +
        `response for its value, so a missing field is a suite that measures nothing. ` +
        `Found: ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

/**
 * Text only the VENDOR would ever produce, planted on every fake failure.
 *
 * TWO MARKERS AND A SECRET, deliberately. The secret proves a scrub would have
 * had something to find; `PostHogApiError` and the endpoint path prove the
 * difference between DROPPING the vendor's message and SCRUBBING it — a scrub
 * removes the key and forwards the rest, and the rest is a stack-shaped line in
 * front of a founder.
 */
const VENDOR_TEXT = `PostHogApiError: 401 at /api/projects/ — token ${PERSONAL_API_KEY}`;

/** The region the fake probe reports it found the key working on. */
const DISCOVERED_HOST = "https://eu.i.posthog.example.invalid";

// ---------------------------------------------------------------------------
// The contract, copied from the ADD's own block (Core Abstractions)
// ---------------------------------------------------------------------------
//
// DECLARED HERE RATHER THAN IMPORTED. `packages/adapters/src/posthog/discovery.ts`
// does not exist on this tree, so a static import is TS2307 and takes the whole
// typecheck gate down — `module-under-construction.ts`'s header states the rule
// and the remedy: the type surface a suite asserts against is declared IN THAT
// SUITE, copied from the ADD, so the shape claims are pinned by the ADD rather
// than inferred from an implementation nobody has written.

/** ADD Core Abstractions. NO `recentEventCount` — the spike found the vendor
 *  reports no count on this endpoint, and a number nothing measured is worse
 *  than no number. `hasIngestedEvents` is the whole ordering signal. */
interface DiscoveredProject {
  readonly sourceProjectId: string;
  readonly name: string;
  readonly hasIngestedEvents: boolean;
}

type DiscoveryResult =
  | { readonly ok: true; readonly host: string; readonly projects: readonly DiscoveredProject[] }
  | {
      readonly ok: false;
      readonly failure: { readonly code: SourceFailureCode; readonly message: string };
    };

/**
 * The port this route takes, with its effects already bound.
 *
 * `host: string | null` is the ADD's own signature, and the `null` is
 * load-bearing: `discoverProjects` branches on it to choose between walking
 * `PROBE_ORIGINS` and doing one guarded request against a customer-supplied
 * address. `undefined` is neither — see `an absent host reaches the port as
 * null` below, which is the D11 row for this wire.
 */
type DiscoverProjectsFn = (input: {
  readonly personalApiKey: string;
  readonly host: string | null;
}) => Promise<DiscoveryResult>;

/** `FirstRunRouteDeps` plus the one port this route needs. See the header. */
interface DiscoverRouteDeps extends FirstRunRouteDeps {
  readonly discoverProjects?: DiscoverProjectsFn | undefined;
}

// ---------------------------------------------------------------------------
// The fake probe — the ONLY impure thing in this flow
// ---------------------------------------------------------------------------

interface FakeDiscoveryLog {
  /**
   * Every input the route handed the port, captured RAW.
   *
   * A `Record<string, unknown>` rather than the typed input, on purpose: the
   * whole point of `an absent host reaches the port as null` is to catch a
   * value the contract's own type forbids, and a typed capture would coerce
   * the defect out of sight.
   */
  readonly inputs: Record<string, unknown>[];
}

function emptyLog(): FakeDiscoveryLog {
  return { inputs: [] };
}

function fakeDiscovery(result: DiscoveryResult, log: FakeDiscoveryLog): DiscoverProjectsFn {
  return (input) => {
    log.inputs.push({ ...(input as unknown as Record<string, unknown>) });
    return Promise.resolve(result);
  };
}

/** The three-project answer the success rows assert round-trips unchanged. */
const THREE_PROJECTS: readonly DiscoveredProject[] = Object.freeze([
  { sourceProjectId: "00000", name: "Checkout", hasIngestedEvents: true },
  { sourceProjectId: "11111", name: "Marketing site", hasIngestedEvents: true },
  { sourceProjectId: "22222", name: "Staging", hasIngestedEvents: false },
]);

function discovered(projects: readonly DiscoveredProject[]): DiscoveryResult {
  return { ok: true, host: DISCOVERED_HOST, projects };
}

function refused(code: SourceFailureCode): DiscoveryResult {
  return { ok: false, failure: { code, message: VENDOR_TEXT } };
}

let bed: FirstRunTestBed;
let owner: SeededMemberScope;

/**
 * Longer than bun's 5s default, and it is not a slow test being tolerated.
 *
 * A COLD PGlite BOOT — the first run on a machine, where the wasm image is
 * decompressed rather than reused — was MEASURED at 5.4s here and took the
 * whole file down with `a beforeEach/afterEach hook timed out`. That message
 * names no route, no contract and no owner, and it replaces twelve named Wave 0
 * reds with one piece of infrastructure noise. Which is precisely the
 * misleading red `module-under-construction.ts` exists to abolish, arriving
 * through the hook instead of through the import.
 */
const COLD_BOOT_BUDGET_MS = 60_000;

beforeAll(async () => {
  bed = await createFirstRunTestBed("discover");
  owner = await bed.member("owner");
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

function depsFor(
  scope: SeededMemberScope | null,
  extra?: Partial<DiscoverRouteDeps>,
): DiscoverRouteDeps {
  return {
    db: bed.db,
    tenant: tenantOf(scope?.ctx ?? null),
    now: CLOCK,
    ...extra,
  };
}

// ===========================================================================
// CONTROLS — not contract rows. These prove THIS FILE's strictness detector
// bites, and they are the only assertions here expected to PASS on the Wave 0
// tree. A suite that borrowed its proof from another file could be run alone
// and prove nothing, which is why they are repeated rather than referenced.
// ===========================================================================

describe("CONTROL — the strictness prober, run against real zod (AD-16a)", () => {
  test("CONTROL: a plain z.object() FAILS the prober — it accepts and strips a projectId", () => {
    const verdict = verifyRefusesUnknownKey(plainObjectControl(), CONTROL_VALID_BODY, "projectId");

    // THE PLANTED OFFENDER. If this ever reports `ok: true`, every strictness
    // row below is vacuous and the discover route can ship non-strict unnoticed.
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.why).toContain("ACCEPTED");
    expect(verdict.why).toContain("SILENTLY STRIPPED");
  });

  test("CONTROL: z.strictObject() and .strict() both PASS the prober, naming the offending key", () => {
    for (const [label, control] of [
      ["z.strictObject()", strictObjectControl()],
      [".strict()", dotStrictControl()],
    ] as const) {
      const verdict = verifyRefusesUnknownKey(control, CONTROL_VALID_BODY, "projectId");
      expect(`${label}:${verdict.ok}`).toBe(`${label}:true`);
      if (!verdict.ok) throw new Error(verdict.why);
      // Measured trap 1: the names are on `issue.keys`, never on `issue.path`.
      expect(verdict.keys).toEqual(["projectId"]);
    }
  });

  test("CONTROL: Object.keys(shape) is identical for all three — enumeration cannot enforce", () => {
    // The measured fact AD-16a rests on, and the reason the declared-keys row
    // below is labelled SHAPE ONLY rather than treated as the strictness proof.
    const plain = enumerateShapeKeys(plainObjectControl());
    expect(plain).toEqual(["stepId"]);
    expect(enumerateShapeKeys(strictObjectControl())).toEqual(plain);
    expect(enumerateShapeKeys(dotStrictControl())).toEqual(plain);
  });
});

// ===========================================================================
// AD-16 / AD-16a — no tenancy id on the wire, and it is REFUSED, not stripped
// ===========================================================================

describe("POST /api/first-run/analytics/discover accepts no tenancy id (AD-16, AD-16a)", () => {
  test("the input schema declares personalApiKey and host, and neither tenancy key", async () => {
    // SHAPE ONLY. This row DOES NOT STAND ALONE — the control above measured
    // that `Object.keys(shape)` is identical for `z.object` and
    // `z.strictObject`, so a green here says nothing about refusal. Kept
    // because a DECLARED tenancy key is a different, louder defect than a
    // merely-tolerated one, and because it pins `host` as OPTIONAL: a required
    // `host` would put the self-host address field back in front of every
    // founder, which is the whole thing AD-2 deletes.
    const schemaUnderTest = await loadRouteInputSchema(DISCOVER);
    const keys = enumerateShapeKeys(schemaUnderTest);

    expect(keys === null ? "no-shape" : "has-shape").toBe("has-shape");
    expect([...(keys ?? [])].toSorted()).toEqual(["host", "personalApiKey"]);

    for (const tenancyKey of TENANCY_KEYS) {
      expect(`${tenancyKey}:${(keys ?? []).includes(tenancyKey)}`).toBe(`${tenancyKey}:false`);
    }

    // OPTIONAL, not required: the common path sends the key and nothing else.
    const withoutHost = schemaUnderTest.safeParse({ personalApiKey: PERSONAL_API_KEY });
    expect(withoutHost.success).toBe(true);
  });

  test("a body carrying projectId or organizationId is refused BY NAME with unrecognized_keys, never stripped", async () => {
    // THE ROW THAT DETECTS A PLAIN z.object(). Enumeration cannot.
    const schemaUnderTest = await loadRouteInputSchema(DISCOVER);

    for (const tenancyKey of TENANCY_KEYS) {
      const verdict = verifyRefusesUnknownKey(schemaUnderTest, DISCOVER.validBody, tenancyKey);
      if (!verdict.ok) {
        throw new Error(
          `${DISCOVER.method} ${DISCOVER.path} does not refuse a client-supplied "${tenancyKey}": ${verdict.why}`,
        );
      }
      expect(verdict.keys).toContain(tenancyKey);
    }
  });

  test("the input schema is constructed strict, on a key that has nothing to do with tenancy", async () => {
    // AD-16a's rule directly: the defect is the CONSTRUCTOR, not the key list.
    // A schema whose declared keys are correct but which was built with
    // `z.object()` passes the row above's shape half and fails here.
    const schemaUnderTest = await loadRouteInputSchema(DISCOVER);
    const verdict = verifyRefusesUnknownKey(
      schemaUnderTest,
      DISCOVER.validBody,
      "somethingNobodyDeclared",
    );
    if (!verdict.ok) {
      throw new Error(
        `${DISCOVER.method} ${DISCOVER.path} is not constructed with z.strictObject()/.strict(): ${verdict.why}`,
      );
    }
  });

  test("a request carrying projectId is refused at the wire, and no probe is made", async () => {
    // THE BEHAVIOURAL HALF, at the route rather than at the schema. The parse
    // has to happen BEFORE the port is reached, which is the only reason this
    // row can claim that a rejected request contacted nobody's analytics
    // account with the pasted key.
    const handle = await loadRouteHandler(DISCOVER);
    const log = emptyLog();

    const response = await handle(
      routeRequest(DISCOVER, { ...DISCOVER.validBody, projectId: "someone-elses-project" }),
      depsFor(owner, { discoverProjects: fakeDiscovery(discovered(THREE_PROJECTS), log) }),
    );

    expect(response.status).toBe(400);
    expect(log.inputs).toEqual([]);

    // And the refusal is OUR sentence, never zod's.
    const serialized = JSON.stringify(await bodyOf(response));
    expect(serialized).not.toContain("Unrecognized key");
    expect(serialized).not.toContain("ZodError");
    expect(serialized).not.toContain("invalid_type");
  });
});

// ===========================================================================
// The session is the only tenancy input
// ===========================================================================

describe("POST /api/first-run/analytics/discover requires a session (AD-16)", () => {
  test("a signed-out caller gets 401, never a project list and never a 500", async () => {
    const handle = await loadRouteHandler(DISCOVER);
    const log = emptyLog();

    const response = await handle(
      routeRequest(DISCOVER, DISCOVER.validBody),
      depsFor(null, { discoverProjects: fakeDiscovery(discovered(THREE_PROJECTS), log) }),
    );

    expect(response.status).toBe(401);

    // NO DATA BEHIND THE 401, and no probe made on behalf of a caller with no
    // session: an anonymous request must not be able to spend somebody's key
    // against a vendor, nor learn which projects a key can see.
    expect(log.inputs).toEqual([]);

    const body = await bodyOf(response);
    expect(Object.keys(body)).not.toContain("projects");
    expect(Object.keys(body)).not.toContain("host");
    expect(JSON.stringify(body)).not.toContain("stack");
    expect(JSON.stringify(body)).not.toMatch(/:\d+:\d+/);
  });
});

// ===========================================================================
// The refusal boundary — the CODE crosses it, the vendor's message does not
// ===========================================================================

describe("a discovery refusal carries our sentence and the code, and nothing the vendor said", () => {
  test("each discovery refusal code renders its own distinct sentence from the shipped table", async () => {
    const handle = await loadRouteHandler(DISCOVER);
    const rendered = new Map<SourceFailureCode, string>();

    // ALL FIVE `SourceFailureCode`s. Every way a real call to a customer's
    // analytics account can fail has to be sayable to that customer, and each
    // sentence names a different thing to go and change — "the key is wrong"
    // and "the address is wrong" are not one answer.
    for (const code of sourceFailureCodeSchema.options) {
      const response = await handle(
        routeRequest(DISCOVER, DISCOVER.validBody),
        depsFor(owner, { discoverProjects: fakeDiscovery(refused(code), emptyLog()) }),
      );

      // A 4xx, never a 5xx: each of the five names something the customer can
      // act on, and a 500 would say the server is broken rather than that their
      // key is. (`analytics/connect` answers 400 to all six of its own.)
      expect(`${code}:${response.status >= 400 && response.status < 500}`).toBe(`${code}:true`);

      const body = await bodyOf(response);
      const strings = collectStrings(body);

      // THE CODE CROSSES THE BOUNDARY — a client branches on it.
      expect(`${code}:${strings.includes(code)}`).toBe(`${code}:true`);

      // THE SENTENCE COMES FROM OUR TABLE — a person reads it.
      const sentence = strings.find((value) =>
        Object.values(CONNECT_REFUSAL_MESSAGES).includes(value),
      );
      if (sentence === undefined) {
        throw new Error(
          `${code}: the response carried no sentence from CONNECT_REFUSAL_MESSAGES — the code ` +
            `crosses the boundary, the sentence comes from our table: ${JSON.stringify(body)}`,
        );
      }
      expect(`${code}:${sentence}`).toBe(`${code}:${CONNECT_REFUSAL_MESSAGES[code]}`);
      rendered.set(code, sentence);
    }

    expect(rendered.size).toBe(sourceFailureCodeSchema.options.length);
    expect(new Set(rendered.values()).size).toBe(rendered.size);
  });

  test("the vendor's own message is DROPPED, not scrubbed — no vendor text reaches the response in any encoding", async () => {
    const handle = await loadRouteHandler(DISCOVER);
    const response = await handle(
      routeRequest(DISCOVER, DISCOVER.validBody),
      depsFor(owner, {
        discoverProjects: fakeDiscovery(refused("invalid_credentials"), emptyLog()),
      }),
    );
    const raw = await response.text();

    // POSITIVE CONTROL on the scan: our sentence IS there, so the absences
    // below cannot be green because the body is empty.
    expect(raw).toContain(CONNECT_REFUSAL_MESSAGES.invalid_credentials);

    // DROPPED. Not the whole planted message, and not the key inside it in ANY
    // encoding — `connections.service.ts:154-165` names URL-encoded,
    // JSON-escaped and truncated as three forms an exact-string scrub misses,
    // and `leaks()` checks those plus base64/base64url/hex.
    expect(leaks(raw, VENDOR_TEXT)).toBeNull();
    expect(leaks(raw, PERSONAL_API_KEY)).toBeNull();

    // AND NOT SCRUBBED — this is the pair of assertions that tells the two
    // apart. A scrub removes the secret and FORWARDS THE REST, so the vendor's
    // exception name, the endpoint it was thrown from, and the redaction
    // placeholder standing in for the key would all still be in front of a
    // founder. Dropping leaves none of them.
    expect(raw).not.toContain("PostHogApiError");
    expect(raw).not.toContain("/api/projects/");
    expect(raw).not.toContain(REDACTED_PLACEHOLDER);
    expect(raw).not.toMatch(/:\d+:\d+/);
  });
});

// ===========================================================================
// The key: three surfaces, one rule (FR-7, inherited)
// ===========================================================================

describe("the pasted personal key never leaves the request", () => {
  test("the personal api key appears in no response body, no log line and no thrown value", async () => {
    const handle = await loadRouteHandler(DISCOVER);
    const captured: string[] = [];

    // ALL FIVE CONSOLE METHODS, captured through a key loop rather than five
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
    const bodies: string[] = [];
    try {
      // BOTH OUTCOMES. A key echoed back inside a success payload is just as
      // much a leak as one inside a refusal, and the two take different code
      // paths — the refusal one is where a "helpful" debug line gets added.
      for (const result of [discovered(THREE_PROJECTS), refused("invalid_credentials")]) {
        const response = await handle(
          routeRequest(DISCOVER, { personalApiKey: PERSONAL_API_KEY }),
          depsFor(owner, { discoverProjects: fakeDiscovery(result, emptyLog()) }),
        );
        bodies.push(await response.text());
      }
    } catch (error) {
      thrown = error;
    } finally {
      for (const method of METHODS) {
        consoleRef[method] = originals.get(method)!;
      }
    }

    expect(leaks(bodies.join("\n"), PERSONAL_API_KEY)).toBeNull();
    expect(leaks(captured.join("\n"), PERSONAL_API_KEY)).toBeNull();

    // A key on a THROWN value is the one people forget: it reaches an error
    // reporter rather than a screen, and is invisible to a response-only scan.
    // Both representations are read deliberately — `String(unknown)` flattens a
    // non-Error to "[object Object]" and would scan nothing.
    expect(
      leaks(
        thrown === null
          ? ""
          : `${thrown instanceof Error ? `${thrown.message}\n${thrown.stack ?? ""}` : ""}\n${JSON.stringify(thrown)}`,
        PERSONAL_API_KEY,
      ),
    ).toBeNull();
  });
});

// ===========================================================================
// Success — `{ host, projects[] }`, at every arity
// ===========================================================================

describe("a successful discovery answers { host, projects[] } (AD-2, AD-3)", () => {
  test("the response carries the host the probe settled on and the project list unchanged", async () => {
    const handle = await loadRouteHandler(DISCOVER);
    const log = emptyLog();

    const response = await handle(
      routeRequest(DISCOVER, DISCOVER.validBody),
      depsFor(owner, { discoverProjects: fakeDiscovery(discovered(THREE_PROJECTS), log) }),
    );

    expect(response.status).toBe(200);
    const body = await bodyOf(response);

    // THE HOST, because the client writes it straight into the connect call
    // that follows. A route that dropped it would leave the next step with
    // nothing to attach to, and the founder back at a region question.
    expect(body.host).toBe(DISCOVERED_HOST);

    // THE LIST, UNCHANGED. `sourceProjectId` in particular round-trips
    // verbatim: the spike found the vendor's result carries BOTH `id` and
    // `project_id` with different values, and a route that re-derived this
    // field instead of passing the mapped one through would rebuild exactly
    // the silent wrong-project bug AD-3 exists to prevent.
    expect(body.projects).toEqual([...THREE_PROJECTS]);

    // Exactly one probe, with the pasted key.
    expect(log.inputs.length).toBe(1);
    expect(log.inputs[0]?.personalApiKey).toBe(PERSONAL_API_KEY);
  });

  test("a single project still answers as a one-element list, never a bare project", async () => {
    // AD-3's auto-select is THE SCREEN'S decision — "connect immediately, and
    // the card states which project was chosen". The route's shape does not
    // change with the arity, so a client can read `projects` once and count it.
    // A route that special-cased n=1 into `{ project }` would sever that.
    const handle = await loadRouteHandler(DISCOVER);
    const only = THREE_PROJECTS[0]!;

    const body = await bodyOf(
      await handle(
        routeRequest(DISCOVER, DISCOVER.validBody),
        depsFor(owner, { discoverProjects: fakeDiscovery(discovered([only]), emptyLog()) }),
      ),
    );

    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.projects).toEqual([only]);
    expect(Object.keys(body)).not.toContain("project");
  });
});

// ===========================================================================
// The host wire — the value the route computes for the port (D11)
// ===========================================================================

describe("what the route hands the discovery port", () => {
  test("an absent host reaches the port as null, never undefined and never absent", async () => {
    // THE D11 ROW FOR THIS WIRE. `discoverProjects` branches on `host === null`
    // to choose between walking PROBE_ORIGINS and doing one guarded request at
    // a customer-supplied address. `undefined` is neither: it takes the
    // customer-supplied branch and hands `checkHost` a value that is not a
    // host. The schema makes `host` optional, so `undefined` is what
    // `parsed.data.host` IS on the common path — the translation is the route's
    // job, and forgetting it is invisible to a producer test and to a consumer
    // test alike.
    const handle = await loadRouteHandler(DISCOVER);
    const log = emptyLog();

    await handle(
      routeRequest(DISCOVER, { personalApiKey: PERSONAL_API_KEY }),
      depsFor(owner, { discoverProjects: fakeDiscovery(discovered(THREE_PROJECTS), log) }),
    );

    expect(log.inputs.length).toBe(1);
    const input = log.inputs[0]!;
    expect(Object.keys(input)).toContain("host");
    expect(input.host).toBeNull();
  });

  test("a customer-supplied host reaches the port unchanged", async () => {
    // The self-host branch, which AD-2 reveals only after both probes refused.
    // The route forwards it verbatim; `checkHost` inside the adapter is what
    // guards it, and a route that normalised or rewrote it here would be
    // guarding a different string than the one it went on to request.
    const handle = await loadRouteHandler(DISCOVER);
    const log = emptyLog();
    const selfHosted = "https://analytics.example.invalid";

    await handle(
      routeRequest(DISCOVER, { personalApiKey: PERSONAL_API_KEY, host: selfHosted }),
      depsFor(owner, { discoverProjects: fakeDiscovery(discovered(THREE_PROJECTS), log) }),
    );

    expect(log.inputs.length).toBe(1);
    expect(log.inputs[0]?.host).toBe(selfHosted);
  });
});
