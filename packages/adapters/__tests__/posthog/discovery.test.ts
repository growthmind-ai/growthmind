// The contract for `discoverProjects` (AD-1, AD-2, AD-3), asserted against what the live
// spike observed rather than what the ADD assumed.
import { describe, expect, test } from "bun:test";

import { PROBE_ORIGINS } from "../../src/posthog/constants";
import { discoverProjects } from "../../src/posthog/discovery";
import { AD_FAKE_PERSONAL_KEY, AD_HOST, createFakeDeps, createFakeFetch } from "../helpers/fakes";

const EXPECTED_PROBE_ORIGINS = ["https://us.i.posthog.com", "https://eu.i.posthog.com"] as const;
const [US_PROBE_ORIGIN, EU_PROBE_ORIGIN] = EXPECTED_PROBE_ORIGINS;

// The envelope a wrong-region key actually produced. Status 401, not 403.
const AD_UNAUTHORIZED_BODY = {
  type: "authentication_error",
  code: "authentication_failed",
  detail: "Incorrect authentication credentials.",
  attr: null,
};

const AD_NOT_FOUND_BODY = {
  type: "invalid_request",
  code: "not_found",
  detail: "Not found.",
  attr: null,
};

const AD_THROTTLED_BODY = {
  type: "throttled_error",
  code: "throttled",
  detail: "Request was throttled. Expected available in 59 seconds.",
  attr: null,
};

interface AdProjectOverrides {
  readonly id?: number;
  // Present, different from `id`, and never the field the mapper wants.
  readonly project_id?: number;
  readonly name?: string;
  readonly ingested_event?: boolean;
}

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
  test("is the ordered US-then-EU ingest pair the spike verified", () => {
    expect(PROBE_ORIGINS).toEqual([...EXPECTED_PROBE_ORIGINS]);
  });
});

describe("discoverProjects walks the probe origins", () => {
  test("probes PROBE_ORIGINS in order and stops at the first 200", async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: adProjectsBody([adProject()]) }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

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

  // 403 was the ADD's assumption and was never observed; 401 is what a live wrong-region
  // key returned. Both mean "try the next origin", so a change to either strands founders.
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

  test("falls through to the second origin on a 404 — the list path has no project id to be missing", async () => {
    const fake = createFakeFetch((url) =>
      url.startsWith(US_PROBE_ORIGIN)
        ? { status: 404, body: AD_NOT_FOUND_BODY }
        : { status: 200, body: adProjectsBody([adProject()]) },
    );
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

    expect(requestOrigins(fake.requests)).toEqual([US_PROBE_ORIGIN, EU_PROBE_ORIGIN]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.host).toBe(EU_PROBE_ORIGIN);
  });

  test("refuses with project_not_found when EVERY origin 404s, after asking both", async () => {
    const fake = createFakeFetch(() => ({ status: 404, body: AD_NOT_FOUND_BODY }));
    const { deps, sleeps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

    expect(requestOrigins(fake.requests)).toEqual([US_PROBE_ORIGIN, EU_PROBE_ORIGIN]);
    expect(sleeps).toEqual([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("project_not_found");
  });

  // Catches a retry loop being added later: a human is at a form, and the client's
  // exponential sleeps belong to the poll path, never to this call.
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
  // THE SILENT BUG: both keys are present with different values, and `project_id` builds
  // a valid-looking url for someone else's project with nothing erroring anywhere.
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

  test("refuses an empty results list as project_not_found, never an empty pick list", async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: adProjectsBody([]) }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput(), deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("project_not_found");
  });

  // The fixture separates all three orderings: input order, name-only, and this one.
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
  test("makes one request to a customer-supplied host and never probes the cloud origins", async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: adProjectsBody([adProject()]) }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput({ host: AD_HOST }), deps);

    expect(requestOrigins(fake.requests)).toEqual([AD_HOST]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.host).toBe(AD_HOST);
  });

  // Proves the walk's 404 fallthrough did not leak here: there is no next origin, so the
  // request COUNT is the assertion — a leak would send the key to a host nobody named.
  test("refuses a 404 on a customer-supplied host immediately, with no second request", async () => {
    const fake = createFakeFetch(() => ({
      status: 404,
      body: { type: "invalid_request", code: "not_found", detail: "Not found.", attr: null },
    }));
    const { deps } = createFakeDeps(fake.fetch);

    const result = await discoverProjects(discoveryInput({ host: AD_HOST }), deps);

    expect(fake.requests.length).toBe(1);
    expect(requestOrigins(fake.requests)).toEqual([AD_HOST]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("project_not_found");
  });

  // The ssrf gate: a blocked host must make ZERO requests. A refusal that arrives after
  // the packet has left protects nothing.
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
  // The vendor echoes the key back inside `detail`, and none of that body may reach a
  // returned failure.
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
