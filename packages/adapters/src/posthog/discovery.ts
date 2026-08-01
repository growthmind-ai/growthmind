// Project discovery: the founder pastes a personal key, and we find the projects it can
// read. No region picked, no project number typed, no tab opened on PostHog's settings
// page to look one up.
//
// Everything below is built on what scripts/spikes/notes/posthog-projects-endpoint.md
// observed on 2026-08-01 against a live account, which corrected two assumptions the ADD
// had made. The four findings, and where each one lands:
//
//   1. `/api/projects/` IS served on the ingest origin, so `PROBE_ORIGINS` is the
//      `*.i.posthog.com` family and a discovered host is stored exactly as probed, with
//      no translation step in between to get wrong.
//   2. A key from the wrong region answers 401, not the 403 the ADD assumed. Both are
//      treated as "try the next origin" here, and the walk refuses only after every
//      origin has answered. A 404 joins them on the walk — and only on the walk — for a
//      reason the spike did NOT establish; see `WALK_FALLTHROUGH_STATUSES` below.
//   3. There is no event count on this endpoint at all. `ingested_event` is a boolean,
//      and it is the whole ordering signal. Nothing here derives a number from it.
//   4. Each result carries BOTH `id` and `project_id`, and they hold DIFFERENT values.
//      `sourceProjectId` comes from `id`. See `discoveredProjectSchema` below for why
//      the schema is the guard rather than a comment.
//
// This is not the poll path and must not borrow its patience. `client.ts` retries a 429
// up to `MAX_RATE_LIMIT_ATTEMPTS` times with exponential backoff because a poll running
// unattended should survive a throttle. Discovery runs while a human is looking at a
// form, so a 429 is an immediate named refusal, and `deps.sleep` is never called. A unit
// test asserts the recorded sleeps are exactly `[]`.
import type { SourceFailure } from "@growthmind/shared";
import { z } from "zod";

import { PROBE_ORIGINS, projectsUrl, REQUEST_TIMEOUT_MS } from "./constants";
import type { PostHogSourceDeps } from "./deps";
import { mapFailure, sourceFailure } from "./errors";
import { checkHost } from "./host-guard";
import { readJsonBody } from "./read-json-body";

/** One project the personal key can read, in our terms rather than the vendor's. */
export interface DiscoveredProject {
  /**
   * From the result's `id`. Never `project_id`.
   *
   * Opaque text, never a number: `eventsUrl` and `personsUrl` interpolate this into a
   * URL path, and the wire carries an integer (spike finding 4).
   */
  readonly sourceProjectId: string;
  readonly name: string;
  /**
   * The only thing this endpoint reports about volume, and it is a boolean (spike
   * finding 3). There is no count here and none is invented: a number on screen that
   * nothing measured is worse than no number.
   */
  readonly hasIngestedEvents: boolean;
}

export type DiscoveryResult =
  | { readonly ok: true; readonly host: string; readonly projects: readonly DiscoveredProject[] }
  | { readonly ok: false; readonly failure: SourceFailure };

export interface DiscoveryInput {
  readonly personalApiKey: string;
  /**
   * `null` for the cloud path — the common one, where the founder supplies nothing and
   * `PROBE_ORIGINS` is walked. Non-null is the self-host branch, and it is earned
   * disclosure: the field is only ever shown after both cloud probes refused.
   */
  readonly host: string | null;
}

/**
 * One result of the twelve-field wire shape, narrowed to the three fields we want.
 *
 * `project_id` is deliberately absent, and that absence is the guard. Zod's default
 * object parse strips unknown keys, so the mapper below is handed an object that does
 * not contain `project_id` at all — taking the wrong field is a compile error rather
 * than a silent wrong-project read. Spike finding 4 is the one that would otherwise have
 * shipped: both names are plausible, both are present, they differ, and `project_id`
 * builds a valid-looking url for a project that is not the founder's, with nothing
 * erroring anywhere downstream.
 *
 * `id` is accepted as a number (what the wire actually carries) or a string (what a
 * future vendor change might send), and normalised to text at the one place below.
 */
const discoveredProjectSchema = z.object({
  id: z.union([z.number().int(), z.string().min(1)]),
  name: z.string(),
  /** Tolerated absent or null: this is external data, and the safe default is "we have
   * not seen events here", which sorts the project down rather than up. */
  ingested_event: z.boolean().nullish(),
});

/**
 * The envelope, parsed only as far as `results`. Items are `unknown` so one malformed
 * project cannot refuse the whole list — see `mapProjects`.
 */
const projectListSchema = z.object({ results: z.array(z.unknown()) });

/** What one origin answered. */
type ProbeAnswer =
  | { readonly ok: true; readonly body: unknown }
  | {
      readonly ok: false;
      readonly failure: SourceFailure;
      /**
       * The status that produced the failure, or 0 for a transport fault where no
       * response exists at all.
       *
       * Carried as the raw status rather than as a "may we continue" boolean on purpose:
       * whether a failure is worth walking past is the CALLER's question, and only one
       * of the two callers has anywhere to walk to. See `WALK_FALLTHROUGH_STATUSES`.
       */
      readonly status: number;
    };

/**
 * The statuses that mean "not this origin — ask the next one", ON THE MULTI-ORIGIN WALK
 * AND NOWHERE ELSE. Read inside `discoverProjects`'s cloud loop only; the self-host
 * branch never consults it, because there is no next origin there — the customer named
 * that host, so every failure it returns is final.
 *
 * 401 is what the live account actually returned for an EU-issued key asked on US (spike
 * finding 2); 403 is what the ADD assumed and was never observed. Both fall through,
 * because refusing on one while walking past the other would strand whichever founders a
 * future PostHog change points at the other status.
 *
 * 404 is here for a different reason, and it is the one a future reader will query,
 * because a 404 refuses everywhere else in this adapter — `mapFailure` maps it to
 * `project_not_found`, which is right for `eventsUrl`/`personsUrl` and wrong here:
 *
 *   1. On THIS path a 404 cannot mean "your project does not exist". `projectsUrl`
 *      (constants.ts) is the LIST endpoint and carries no project id segment, so there is
 *      no project in the request to fail to find. The only thing a 404 can say to a
 *      request like this one is "this origin does not serve this path" — which is exactly
 *      "ask the next origin". The ambiguity that would make this reckless on any other
 *      path is structurally absent on this one.
 *
 *   2. It is load-bearing because `https://us.i.posthog.com` serving `/api/projects/` is
 *      INFERRED, NOT OBSERVED. `scripts/spikes/notes/posthog-projects-endpoint.md` only
 *      ever got a 200 from the EU family; the US ingest origin answered 401 to that
 *      account's EU-issued key. A 401 is consistent with BOTH "served here, wrong region
 *      for this key" AND "not served here at all". The evidence favours the first — the
 *      401 body was the standard DRF `{type, code, detail, attr}` envelope an EXISTING
 *      authenticated route returns, not what an unrouted path produces — but nobody has
 *      watched a US-issued key get a 200 from that origin. If the inference is wrong, US
 *      ingest answers 404 and, without this entry, EVERY US founder is refused at the
 *      first field of setup, told their projects could not be found rather than that we
 *      looked in the wrong place.
 *
 * The fail directions are not symmetric, which settles it: falling through wrongly costs
 * one extra request in a case that had already failed, and the walk still refuses once
 * every origin has answered. Refusing wrongly costs a whole region of founders their
 * setup. One live probe with a US-issued key would retire the inference; until then this
 * is the cheaper direction to be wrong in.
 */
const WALK_FALLTHROUGH_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

/**
 * One request to one origin. Never more: there is no retry here, and no branch that can
 * re-enter this function for the same origin.
 */
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
      // A 302 goes wherever the upstream points, carrying the personal key with it, and
      // would step outside the origin this walk chose. Treat a redirect as a response,
      // not as a hop — the same rule `client.ts` applies to the poll path.
      redirect: "manual",
      // Without this a host that accepts the connection and never answers leaves a
      // founder watching a form that will never resolve.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // A transport fault is not "wrong region". Probing on would spend a second wait to
    // reach the same answer, so the walk stops and says so. Status 0 is the "no response
    // exists" marker, and it is in no fallthrough set by construction.
    return { ok: false, failure: mapFailure(0, null, secrets), status: 0 };
  }

  const body = await readJsonBody(response);
  if (response.ok) {
    return { ok: true, body };
  }

  // The status is reported, not judged. What it means for the walk is decided by the one
  // caller that has a next origin to try (`WALK_FALLTHROUGH_STATUSES`).
  return {
    ok: false,
    failure: mapFailure(response.status, body, secrets),
    status: response.status,
  };
}

/**
 * Vendor output is external data, so nothing reaches a `DiscoveredProject` without
 * passing `discoveredProjectSchema` first.
 *
 * A result that fails the schema is dropped rather than refusing the whole list: an
 * entry with no readable `id` cannot have a url built for it, so offering it would put a
 * broken choice on screen. Dropping every entry collapses into the same
 * `project_not_found` refusal an empty list gets, so the fail direction is a named
 * refusal either way, never a silently short pick list presented as complete.
 */
function mapProjects(results: readonly unknown[]): DiscoveredProject[] {
  const projects: DiscoveredProject[] = [];

  // Bounded by the parsed array's own length. Every loop in this package is explicitly
  // bounded (a structural test in client.test.ts asserts no unbounded form exists), and
  // the byte cap in `read-json-body.ts` is what bounds this length in turn.
  for (const result of results) {
    const parsed = discoveredProjectSchema.safeParse(result);
    if (!parsed.success) continue;

    projects.push({
      // `parsed.data` has no `project_id` on it to take by mistake. String() rather than
      // the raw value because every consumer interpolates this into a url path, and a
      // number must never reach one.
      sourceProjectId: String(parsed.data.id),
      name: parsed.data.name,
      hasIngestedEvents: parsed.data.ingested_event === true,
    });
  }

  // Projects that have seen events first, then by name. The boolean is the whole signal
  // the endpoint gives (spike finding 3); within each group the tiebreak is the name, so
  // the order a founder sees is stable across calls rather than whatever order the
  // vendor happened to return. `localeCompare` with an explicit locale, because this
  // list is read by a human and code-unit order would sort every capitalised name above
  // every lowercase one.
  return projects.toSorted((left, right) => {
    if (left.hasIngestedEvents !== right.hasIngestedEvents) {
      return left.hasIngestedEvents ? -1 : 1;
    }
    return left.name.localeCompare(right.name, "en");
  });
}

/** Turns one 200 body into the result, or into the refusal an unusable body earns. */
function resultFromBody(host: string, body: unknown, personalApiKey: string): DiscoveryResult {
  const secrets = [personalApiKey];

  const parsed = projectListSchema.safeParse(body);
  if (!parsed.success) {
    // A 200 whose body is not a project list means whatever answered is not the API we
    // asked for — a captive portal, a proxy's error page, or a self-hosted address that
    // is not PostHog. `unreachable` is the honest one: we got an answer, not the answer.
    return { ok: false, failure: sourceFailure("unreachable", secrets) };
  }

  const projects = mapProjects(parsed.data.results);
  if (projects.length === 0) {
    // Zero is a refusal, never a pick list of zero. A chooser rendered from an empty
    // list is a screen asking a founder to choose nothing, and it reads as our bug.
    return { ok: false, failure: sourceFailure("project_not_found", secrets) };
  }

  return { ok: true, host, projects };
}

/**
 * Finds the projects a personal API key can read.
 *
 * Two branches, and they are not symmetric. With no host the cloud origins are walked in
 * order and the first 200 wins, at most one request each. With a host the founder
 * supplied, `checkHost` runs BEFORE anything is sent, and exactly one request follows.
 */
export async function discoverProjects(
  input: DiscoveryInput,
  deps: PostHogSourceDeps,
): Promise<DiscoveryResult> {
  const secrets = [input.personalApiKey];

  if (input.host !== null) {
    // The ssrf gate, and it has to be first. A refusal that arrives after the request
    // has left has protected nothing: the packet already reached the metadata service,
    // and this adapter's deliberately distinguishable refusal codes then make the answer
    // a port-scanning oracle for the provider's own network (host-guard.ts). A unit test
    // asserts the request count is zero, not merely that the result is a refusal.
    //
    // `misconfigured` is the code session-source.ts:103-104 already uses for a host that
    // fails this same gate. Reused rather than newly invented, so one situation has one
    // code across the adapter.
    const checked = checkHost(input.host);
    if (!checked.ok) {
      return { ok: false, failure: sourceFailure("misconfigured", secrets) };
    }

    // `checked.origin` rather than the raw input: the canonical origin is what gets
    // stored on the connection, so what we probe and what we save are the same string.
    // Every failure here is final, `answer.status` is not consulted, and
    // `WALK_FALLTHROUGH_STATUSES` is deliberately not in scope of this branch's logic.
    // There is no next origin: the customer named this host, so a 404 means their host
    // does not serve the API rather than "look somewhere else", and refusing is the only
    // honest answer. The fallthrough that the walk below grants a 404 must never reach
    // here — a test asserts this branch makes exactly one request and stops.
    const answer = await probeOrigin(checked.origin, input.personalApiKey, deps);
    if (!answer.ok) {
      return { ok: false, failure: answer.failure };
    }
    return resultFromBody(checked.origin, answer.body, input.personalApiKey);
  }

  // The cloud walk. `PROBE_ORIGINS` is this package's own constant list, not customer
  // input, so it does not go through `checkHost` — that gate exists for a value a
  // customer typed, and running it over our own literals would be theatre.
  //
  // Bounded by the tuple's length: two origins, one request each, no retry and no
  // re-entry. The order is part of the contract (constants.ts), because it decides who
  // waits for two requests instead of one.
  let lastFailure: SourceFailure = sourceFailure("unreachable", secrets);
  for (const origin of PROBE_ORIGINS) {
    const answer = await probeOrigin(origin, input.personalApiKey, deps);
    if (answer.ok) {
      return resultFromBody(origin, answer.body, input.personalApiKey);
    }

    // Always the origin asked most recently. A 429 or a transport fault stops here and
    // that origin's failure is the one returned; a `WALK_FALLTHROUGH_STATUSES` answer
    // walks on, and if the last origin also refuses, its answer is the final word. One
    // rule for every shape — including a 404, which is not treated specially once every
    // origin has been asked.
    lastFailure = answer.failure;
    if (!WALK_FALLTHROUGH_STATUSES.has(answer.status)) {
      return { ok: false, failure: lastFailure };
    }
  }

  return { ok: false, failure: lastFailure };
}
