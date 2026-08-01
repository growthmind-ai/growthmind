// Wave 0 (task 0.2). The contract for `discoverProjects` (ADD AD-1, AD-2, AD-3), written
// before the function existed and RED until wave 3 landed `discovery.ts`.
//
// The rows assert what the SPIKE observed, not what the ADD originally assumed —
// `scripts/spikes/notes/posthog-projects-endpoint.md`, run 2026-08-01 against a live
// account. Two of its four findings contradict the ADD's first draft:
//
//   - a wrong-region key answers 401, NOT 403. Both fall through to the next origin here,
//     but 401 is the one the live account actually produced;
//   - the list response carries no event count at all. `ingested_event` is a boolean, and
//     it is the whole ordering signal. Nothing below asserts a count, because asserting
//     one would pin a number the vendor does not report.
//
// The load-bearing row is "sourceProjectId comes from `id`". The result object carries
// BOTH `id` and `project_id`, they hold DIFFERENT values, and both are plausible names
// for the segment `eventsUrl` interpolates. Taking the wrong one builds a valid-looking
// url for somebody else's project and nothing anywhere errors.
//
// Public contract only: `DiscoveryResult`, the request count, and the recorded requests.
// No internal is reached for.
//
// Wave 0 loaded both subjects through `await import(<variable>)`, because a static import
// of a file that did not exist yet fails `bun run typecheck` — which would have stopped
// the task's own verify before a single assertion ran. Task 3.2 landed the subject, so
// they are ordinary static imports now, exactly as that comment promised. The types come
// from the subject too rather than being transcribed here: a locally-restated contract
// stays green while the real exported shape drifts away from it, which is the failure
// this file exists to prevent, one level up.
import { describe, expect, test } from "bun:test";

import { PROBE_ORIGINS } from "../../src/posthog/constants";
import { discoverProjects } from "../../src/posthog/discovery";
import { AD_FAKE_PERSONAL_KEY, AD_HOST, createFakeDeps, createFakeFetch } from "../helpers/fakes";

/**
 * What the spike verified `PROBE_ORIGINS` must be: the ingest-origin family, US before
 * EU. `/api/projects/` answered 200 on `eu.i.posthog.com` with a body identical to the
 * app origin's, so a discovered host needs no translation before the connect path stores
 * it. Task 1.3 adds the constant; the first row below pins it against this list.
 */
const EXPECTED_PROBE_ORIGINS = ["https://us.i.posthog.com", "https://eu.i.posthog.com"] as const;
const [US_PROBE_ORIGIN, EU_PROBE_ORIGIN] = EXPECTED_PROBE_ORIGINS;

/** The envelope a wrong-region key actually produced. Status 401, not 403. */
const AD_UNAUTHORIZED_BODY = {
  type: "authentication_error",
  code: "authentication_failed",
  detail: "Incorrect authentication credentials.",
  attr: null,
};

const AD_THROTTLED_BODY = {
  type: "throttled_error",
  code: "throttled",
  detail: "Request was throttled. Expected available in 59 seconds.",
  attr: null,
};

interface AdProjectOverrides {
  /** A number on the wire. PostHog reports project ids as integers. */
  readonly id?: number;
  /** Present, different from `id`, and never the field the mapper wants. */
  readonly project_id?: number;
  readonly name?: string;
  readonly ingested_event?: boolean;
}

/**
 * One result of the pinned wire shape: the twelve keys the spike observed, of which the
 * mapper wants three. `id` and `project_id` default to different values so a fixture can
 * never accidentally make the two indistinguishable.
 */
function adProject(overrides: AdProjectOverrides = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? 31_337,
    uuid: "0198f7a1-ad00-7000-8000-ad0000000001",
    organization: "0198f7a1-ad00-7000-8000-ad00000000ff",
    project_id: overrides.project_id ?? 90_210,
    api_token: "phc_ad-fake-not-a-real-token",
    name: overrides.name ?? "ad-fake project",
    completed_snippet_onboarding: true,
    has_completed_onboarding_for: { product_analytics: true },
    ingested_event: overrides.ingested_event ?? true,
    is_demo: false,
    timezone: "UTC",
    access_control: false,
  };
}

/** The envelope the spike recorded: `results[]`, and nothing this adapter reads besides. */
function adProjectsBody(results: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { results };
}

function discoveryInput(overrides: { host?: string | null; personalApiKey?: string } = {}): {
  readonly personalApiKey: string;
  readonly host: string | null;
} {
  return {
    personalApiKey: overrides.personalApiKey ?? AD_FAKE_PERSONAL_KEY,
    host: overrides.host === undefined ? null : overrides.host,
  };
}

function requestOrigins(urls: readonly { readonly url: string }[]): string[] {
  return urls.map((request) => new URL(request.url).origin);
}

describe("PROBE_ORIGINS", () => {
  // Pins task 1.3 against the spike rather than against the ADD's superseded text: the
  // list endpoint IS served on the ingest origin, so this is the same origin family the
  // connect path already stores.
  test("is the ordered US-then-EU ingest pair the spike verified", () => {
    expect(PROBE_ORIGINS).toEqual([...EXPECTED_PROBE_ORIGINS]);
  });
});

describe("discoverProjects walks the probe origins", () => {
  test("probes PROBE_ORIGINS in order and stops at the first 200", async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: adProjectsBody([adProject()]) }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

    // US answered, so EU is never contacted. A walk that probes both regardless would
    // double every founder's wait for nothing.
    expect(requestOrigins(fake.requests)).toEqual([US_PROBE_ORIGIN]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.host).toBe(US_PROBE_ORIGIN);
  });

  test("asks for the project LIST path, with no project id segment", async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: adProjectsBody([adProject()]) }));
    const { deps } = createFakeDeps(fake.fetch);

    await discoverProjects(discoveryInput(), deps);

    const first = fake.requests[0];
    expect(first).toBeDefined();
    expect(new URL(first?.url ?? "https://ad-fake.invalid").pathname).toBe("/api/projects/");
  });

  test("presents the personal key as a Bearer credential on the probe", async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: adProjectsBody([adProject()]) }));
    const { deps } = createFakeDeps(fake.fetch);

    await discoverProjects(discoveryInput(), deps);

    expect(fake.requests[0]?.authorization).toBe(`Bearer ${AD_FAKE_PERSONAL_KEY}`);
  });

  // The spike's fallthrough trigger, observed live: an EU-issued key answered 401 on US,
  // then 200 on EU. This is the row the whole ordered walk exists for.
  test("falls through to the second origin on a 401 — the status a wrong-region key returns", async () => {
    const fake = createFakeFetch((url) =>
      url.startsWith(US_PROBE_ORIGIN)
        ? { status: 401, body: AD_UNAUTHORIZED_BODY }
        : { status: 200, body: adProjectsBody([adProject()]) },
    );
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

    expect(requestOrigins(fake.requests)).toEqual([US_PROBE_ORIGIN, EU_PROBE_ORIGIN]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.host).toBe(EU_PROBE_ORIGIN);
  });

  // The ADD's original assumption. Never observed, still handled: both statuses mean
  // "try the next origin", and refusing on 403 while falling through on 401 would strand
  // whichever founders a future PostHog change points at the other one.
  test("falls through to the second origin on a 403 as well", async () => {
    const fake = createFakeFetch((url) =>
      url.startsWith(US_PROBE_ORIGIN)
        ? { status: 403, body: { type: "authentication_error", code: "permission_denied" } }
        : { status: 200, body: adProjectsBody([adProject()]) },
    );
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

    expect(requestOrigins(fake.requests)).toEqual([US_PROBE_ORIGIN, EU_PROBE_ORIGIN]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.host).toBe(EU_PROBE_ORIGIN);
  });

  // The row that catches a retry loop being added later. A human is staring at a form;
  // the client's five exponential sleeps belong to a poll that must survive a throttle,
  // never to this call.
  test("costs exactly one request per origin when every origin refuses, and never retries", async () => {
    const fake = createFakeFetch(() => ({ status: 401, body: AD_UNAUTHORIZED_BODY }));
    const { deps, sleeps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

    expect(requestOrigins(fake.requests)).toEqual([US_PROBE_ORIGIN, EU_PROBE_ORIGIN]);
    expect(sleeps).toEqual([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("invalid_credentials");
  });

  // AD-1: a 429 on discovery is an immediate, named refusal. The temptation to reuse the
  // client's backoff is exactly what this row forbids.
  test("refuses a 429 immediately, with no backoff sleep", async () => {
    const fake = createFakeFetch(() => ({
      status: 429,
      body: AD_THROTTLED_BODY,
      headers: { "retry-after": "59" },
    }));
    const { deps, sleeps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

    expect(sleeps).toEqual([]);
    expect(fake.requests.length).toBeLessThanOrEqual(EXPECTED_PROBE_ORIGINS.length);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("rate_limited");
  });
});

describe("discoverProjects maps the result list", () => {
  // THE ROW THAT CATCHES THE SILENT BUG. `id` and `project_id` are both present, both
  // plausible, and hold different values. `project_id` builds a valid-looking url for a
  // project that is not the founder's, and nothing errors — not the request, not the
  // parse, not the poll that follows.
  test("takes sourceProjectId from `id`, never from `project_id`", async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: adProjectsBody([adProject({ id: 31_337, project_id: 90_210 })]),
    }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projects[0]?.sourceProjectId).toBe("31337");
    expect(result.projects[0]?.sourceProjectId).not.toBe("90210");
  });

  // "Opaque text, never a number" — the wire carries an integer and every consumer
  // downstream interpolates a string into a url path.
  test("holds sourceProjectId as text, though the wire carries a number", async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: adProjectsBody([adProject({ id: 31_337 })]),
    }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.projects[0]?.sourceProjectId).toBe("string");
  });

  // AD-3. One project is the common case, and the caller auto-connects rather than
  // asking a founder to pick from a list of one.
  test("returns the single project so the caller can auto-select it", async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: adProjectsBody([adProject({ id: 31_337, name: "ad-fake solo" })]),
    }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projects).toEqual([
      { sourceProjectId: "31337", name: "ad-fake solo", hasIngestedEvents: true },
    ]);
  });

  // AD-3. Zero is a refusal, not a pick list of zero. An empty list rendered as a
  // chooser is a screen that asks a founder to choose nothing.
  test("refuses an empty results list as project_not_found, never an empty pick list", async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: adProjectsBody([]) }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("project_not_found");
  });

  // The whole ordering signal, and it is a boolean. Naive "sort by name" would give
  // alpha/bravo/charlie/zulu and no sort at all would give the input order, so this
  // fixture separates all three.
  test("orders projects with ingested events first, then by name", async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: adProjectsBody([
        adProject({ id: 1, project_id: 101, name: "alpha", ingested_event: false }),
        adProject({ id: 2, project_id: 102, name: "zulu", ingested_event: true }),
        adProject({ id: 3, project_id: 103, name: "bravo", ingested_event: true }),
        adProject({ id: 4, project_id: 104, name: "charlie", ingested_event: false }),
      ]),
    }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projects.map((project) => project.name)).toEqual([
      "bravo",
      "zulu",
      "alpha",
      "charlie",
    ]);
  });

  // There is no event count on this endpoint. A count on the screen that nothing
  // measured is worse than no count at all, so the mapped shape must not grow one.
  test("carries no event count, because the endpoint reports none", async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: adProjectsBody([adProject({ ingested_event: true })]),
    }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.projects[0];
    expect(project?.hasIngestedEvents).toBe(true);
    expect(Object.keys(project ?? {}).toSorted()).toEqual([
      "hasIngestedEvents",
      "name",
      "sourceProjectId",
    ]);
  });
});

describe("discoverProjects on the self-host branch", () => {
  // `host !== null` is the earned disclosure: it is only ever sent after both probes
  // refused. One request, to the host the founder gave, and the cloud origins are not
  // touched.
  test("makes one request to a customer-supplied host and never probes the cloud origins", async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: adProjectsBody([adProject()]) }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput({ host: AD_HOST }), deps);

    expect(requestOrigins(fake.requests)).toEqual([AD_HOST]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.host).toBe(AD_HOST);
  });

  // The ssrf gate, and the assertion that matters is the request COUNT. A refusal that
  // arrives after the request has already left has protected nothing: the packet reached
  // the metadata service, and the distinguishable refusal codes make the answer a
  // port-scanning oracle.
  test("refuses a blocked hostname without making any request at all", async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: adProjectsBody([adProject()]) }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(
      discoveryInput({ host: "https://169.254.169.254" }),
      deps,
    );

    expect(fake.requests).toEqual([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("misconfigured");
  });
});

describe("discoverProjects never leaks the credential", () => {
  // The vendor echoes the key back inside `detail`. Nothing of the response body reaches
  // a returned failure, and the key is threaded in as a scrubbed secret besides — so a
  // later edit that starts folding response content into a message is caught here rather
  // than in a customer's error log.
  test("keeps the personal key out of every returned failure", async () => {
    const fake = createFakeFetch(() => ({
      status: 401,
      body: {
        ...AD_UNAUTHORIZED_BODY,
        detail: `Personal API key ${AD_FAKE_PERSONAL_KEY} found in request Authorization header is invalid.`,
      },
    }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result)).not.toContain(AD_FAKE_PERSONAL_KEY);
    expect(result.failure.message.length).toBeGreaterThan(0);
  });
});
