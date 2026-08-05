import type { SourceFailure } from "@growthmind/shared";
import { z } from "zod";

import { readJsonBody } from "../http/read-json-body";
import { PROBE_ORIGINS, projectsUrl, REQUEST_TIMEOUT_MS } from "./constants";
import type { PostHogSourceDeps } from "./deps";
import { mapFailure, sourceFailure } from "./errors";
import { checkHost } from "./host-guard";

export interface DiscoveredProject {
  readonly sourceProjectId: string;
  readonly name: string;
  readonly hasIngestedEvents: boolean;
}

export type DiscoveryResult =
  | { readonly ok: true; readonly host: string; readonly projects: readonly DiscoveredProject[] }
  | { readonly ok: false; readonly failure: SourceFailure };

export interface DiscoveryInput {
  readonly personalApiKey: string;
  readonly host: string | null;
}

// `sourceProjectId` comes from `id`, NEVER `project_id`: both are on the wire with
// DIFFERENT values, and the wrong one builds a valid-looking url for someone else's
// project. Absent here, so this parse strips it and the mapper cannot take it by mistake.
const discoveredProjectSchema = z.object({
  id: z.union([z.number().int(), z.string().min(1)]),
  name: z.string(),
  ingested_event: z.boolean().nullish(),
});

const projectListSchema = z.object({ results: z.array(z.unknown()) });

type ProbeAnswer =
  | { readonly ok: true; readonly body: unknown }
  | {
      readonly ok: false;
      readonly failure: SourceFailure;
      readonly status: number;
    };

// "Not this origin — ask the next one", on the multi-origin walk and nowhere else. 401 is
// what a wrong-region key actually returned live; 403 was only ever the ADD's assumption
// and sits beside 401 DELIBERATELY — both mean "ask the next origin", which is also why no
// separate permission-style sentence could be wired for 403: it would have to refuse at
// exactly the point this walk is designed to continue, so it was deleted instead. A 404 on
// the LIST path has no project id to be missing, so it too can only mean "not served here".
// 404 is in that set only because `us.i.posthog.com` serving this path is INFERRED from
// its 401 envelope shape, never observed (only EU answered 200); a US-key probe retires both.
const WALK_FALLTHROUGH_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

// One request to one origin, with NO RETRY LOOP. The poll client's exponential backoff
// exists so an unattended run survives a throttle; a human at a form must not be made to
// wait through those sleeps, so a 429 refuses immediately (a test asserts sleeps are []).
async function probeOrigin(
  origin: string,
  personalApiKey: string,
  deps: PostHogSourceDeps,
): Promise<ProbeAnswer> {
  const secrets = [personalApiKey];

  let response: Response;
  try {
    response = await deps.fetch(projectsUrl(origin), {
      headers: { authorization: `Bearer ${personalApiKey}`, accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, failure: mapFailure(0, null, secrets), status: 0 };
  }

  const body = await readJsonBody(response);
  if (response.ok) {
    return { ok: true, body };
  }

  return {
    ok: false,
    failure: mapFailure(response.status, body, secrets),
    status: response.status,
  };
}

function mapProjects(results: readonly unknown[]): DiscoveredProject[] {
  const projects: DiscoveredProject[] = [];

  for (const result of results) {
    const parsed = discoveredProjectSchema.safeParse(result);
    if (!parsed.success) continue;

    projects.push({
      sourceProjectId: String(parsed.data.id),
      name: parsed.data.name,
      hasIngestedEvents: parsed.data.ingested_event === true,
    });
  }

  return projects.toSorted((left, right) => {
    if (left.hasIngestedEvents !== right.hasIngestedEvents) {
      return left.hasIngestedEvents ? -1 : 1;
    }
    return left.name.localeCompare(right.name, "en");
  });
}

function resultFromBody(host: string, body: unknown, personalApiKey: string): DiscoveryResult {
  const secrets = [personalApiKey];

  const parsed = projectListSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, failure: sourceFailure("unreachable", secrets) };
  }

  const projects = mapProjects(parsed.data.results);
  if (projects.length === 0) {
    return { ok: false, failure: sourceFailure("project_not_found", secrets) };
  }

  return { ok: true, host, projects };
}

export async function discoverProjects(
  input: DiscoveryInput,
  deps: PostHogSourceDeps,
): Promise<DiscoveryResult> {
  const secrets = [input.personalApiKey];

  if (input.host !== null) {
    // The ssrf gate, and it has to run BEFORE anything is sent: a blocked host must make
    // ZERO requests, or the distinguishable refusal codes become a port-scanning oracle.
    const checked = checkHost(input.host);
    if (!checked.ok) {
      return { ok: false, failure: sourceFailure("misconfigured", secrets) };
    }

    const answer = await probeOrigin(checked.origin, input.personalApiKey, deps);
    if (!answer.ok) {
      return { ok: false, failure: answer.failure };
    }
    return resultFromBody(checked.origin, answer.body, input.personalApiKey);
  }

  let lastFailure: SourceFailure = sourceFailure("unreachable", secrets);
  for (const origin of PROBE_ORIGINS) {
    const answer = await probeOrigin(origin, input.personalApiKey, deps);
    if (answer.ok) {
      return resultFromBody(origin, answer.body, input.personalApiKey);
    }

    lastFailure = answer.failure;
    if (!WALK_FALLTHROUGH_STATUSES.has(answer.status)) {
      return { ok: false, failure: lastFailure };
    }
  }

  return { ok: false, failure: lastFailure };
}
