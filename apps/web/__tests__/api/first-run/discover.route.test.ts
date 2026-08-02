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

const DISCOVER = routeById("analytics-discover");

/** The needle `leaks()` hunts for, read OFF the descriptor every row posts - so the posted body and the needle are the same string by construction. */
const PERSONAL_API_KEY = fixtureString(DISCOVER.validBody, "personalApiKey");

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

/** Two markers and a secret: the secret proves a scrub would have had something to find, and the markers are what tell DROPPING the vendor's message from SCRUBBING it. */
const VENDOR_TEXT = `PostHogApiError: 401 at /api/projects/ — token ${PERSONAL_API_KEY}`;

const DISCOVERED_HOST = "https://eu.i.posthog.example.invalid";

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

type DiscoverProjectsFn = (input: {
  readonly personalApiKey: string;
  readonly host: string | null;
}) => Promise<DiscoveryResult>;

interface DiscoverRouteDeps extends FirstRunRouteDeps {
  readonly discoverProjects?: DiscoverProjectsFn | undefined;
}

interface FakeDiscoveryLog {
  // Captured RAW rather than typed: a typed capture would coerce out of sight the very defect the "absent host reaches the port as null" row exists to catch.
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

/** A cold PGlite boot was measured at 5.4s here; bun's 5s default would replace twelve named Wave 0 reds with one unnamed hook timeout. */
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

// CONTROLS - they prove THIS FILE's strictness detector bites; without them an empty offender list means nothing. Repeated rather than referenced so the file proves itself alone.

describe("CONTROL — the strictness prober, run against real zod (AD-16a)", () => {
  test("CONTROL: a plain z.object() FAILS the prober — it accepts and strips a projectId", () => {
    const verdict = verifyRefusesUnknownKey(plainObjectControl(), CONTROL_VALID_BODY, "projectId");

    // The planted offender - if this ever reports ok:true, every strictness row below is vacuous and the route can ship non-strict unnoticed.
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
    const plain = enumerateShapeKeys(plainObjectControl());
    expect(plain).toEqual(["stepId"]);
    expect(enumerateShapeKeys(strictObjectControl())).toEqual(plain);
    expect(enumerateShapeKeys(dotStrictControl())).toEqual(plain);
  });
});

describe("POST /api/first-run/analytics/discover accepts no tenancy id (AD-16, AD-16a)", () => {
  test("the input schema declares personalApiKey and host, and neither tenancy key", async () => {
    // SHAPE ONLY - Object.keys(shape) is identical for z.object and z.strictObject, so a green here says nothing about refusal. It also pins `host` as OPTIONAL.
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
    // THE BEHAVIOURAL HALF - the parse has to happen BEFORE the port is reached, which is what the empty log.inputs proves.
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

describe("POST /api/first-run/analytics/discover requires a session (AD-16)", () => {
  test("a signed-out caller gets 401, never a project list and never a 500", async () => {
    const handle = await loadRouteHandler(DISCOVER);
    const log = emptyLog();

    const response = await handle(
      routeRequest(DISCOVER, DISCOVER.validBody),
      depsFor(null, { discoverProjects: fakeDiscovery(discovered(THREE_PROJECTS), log) }),
    );

    expect(response.status).toBe(401);

    // No probe on behalf of a session-less caller: an anonymous request must not spend somebody's key, nor learn which projects it can see.
    expect(log.inputs).toEqual([]);

    const body = await bodyOf(response);
    expect(Object.keys(body)).not.toContain("projects");
    expect(Object.keys(body)).not.toContain("host");
    expect(JSON.stringify(body)).not.toContain("stack");
    expect(JSON.stringify(body)).not.toMatch(/:\d+:\d+/);
  });
});

describe("a discovery refusal carries our sentence and the code, and nothing the vendor said", () => {
  test("each discovery refusal code renders its own distinct sentence from the shipped table", async () => {
    const handle = await loadRouteHandler(DISCOVER);
    const rendered = new Map<SourceFailureCode, string>();

    for (const code of sourceFailureCodeSchema.options) {
      const response = await handle(
        routeRequest(DISCOVER, DISCOVER.validBody),
        depsFor(owner, { discoverProjects: fakeDiscovery(refused(code), emptyLog()) }),
      );

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

    // Positive control on the scan: our sentence IS there, so the absences below cannot be green because the body is empty.
    expect(raw).toContain(CONNECT_REFUSAL_MESSAGES.invalid_credentials);

    // DROPPED - and not the key inside it in ANY encoding: an exact-string scrub misses the URL-encoded, JSON-escaped and truncated forms.
    expect(leaks(raw, VENDOR_TEXT)).toBeNull();
    expect(leaks(raw, PERSONAL_API_KEY)).toBeNull();

    // AND NOT SCRUBBED - a scrub removes the secret and FORWARDS THE REST, so these four absences are what tell dropping from scrubbing.
    expect(raw).not.toContain("PostHogApiError");
    expect(raw).not.toContain("/api/projects/");
    expect(raw).not.toContain(REDACTED_PLACEHOLDER);
    expect(raw).not.toMatch(/:\d+:\d+/);
  });
});

describe("the pasted personal key never leaves the request", () => {
  test("the personal api key appears in no response body, no log line and no thrown value", async () => {
    const handle = await loadRouteHandler(DISCOVER);
    const captured: string[] = [];

    // All five console methods, captured through a key loop rather than named member expressions - the repo's lint forbids console.log even in a restore.
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
      // BOTH OUTCOMES - a key echoed inside a success payload leaks as much as one inside a refusal, and the two take different code paths.
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

    // A key on a THROWN value reaches an error reporter rather than a screen, invisible to a response-only scan; both representations are read because String(unknown) would scan nothing.
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

    expect(body.host).toBe(DISCOVERED_HOST);

    // `sourceProjectId` round-trips verbatim: the vendor's result carries BOTH `id` and `project_id` with different values (AD-3's silent wrong-project bug).
    expect(body.projects).toEqual([...THREE_PROJECTS]);

    // Exactly one probe, with the pasted key.
    expect(log.inputs.length).toBe(1);
    expect(log.inputs[0]?.personalApiKey).toBe(PERSONAL_API_KEY);
  });

  test("a single project still answers as a one-element list, never a bare project", async () => {
    // AD-3's auto-select is THE SCREEN'S decision - the route's shape must not change with the arity.
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

describe("what the route hands the discovery port", () => {
  test("an absent host reaches the port as null, never undefined and never absent", async () => {
    // D11 - the port branches on `host === null`; `undefined` takes the customer-supplied branch instead, and `undefined` is what `parsed.data.host` IS on the common path.
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
    // The self-host branch, forwarded verbatim: a route that normalised it here would be guarding a different string than the one it requests.
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
