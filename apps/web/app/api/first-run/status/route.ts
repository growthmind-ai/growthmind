// GET /api/first-run/status — THE ONE PAYLOAD THE WHOLE SURFACE RECONCILES
// AGAINST (O-008, AD-16, AD-18, AD-3, AD-6).
//
// ###########################################################################
// # THE PREAMBLE BELOW IS THE WHOLE TENANCY STORY, AND IT IS IDENTICAL ON ALL
// # EIGHT OF THESE ROUTES.
// #
// #   session -> `null` ⇒ 401
// #   strict parse of the body ⇒ 400 with a sentence from our table
// #   `ensureProject(db, ctx)` ⇒ the project id
// #   `createXRepo(db, ctx)` ⇒ every read, org-scoped by construction
// #
// # NO ROUTE ON THIS SURFACE ACCEPTS A `projectId` OR AN `organizationId`
// # (AD-16). Not in a body, not in a query string, not in a header. The input
// # schema is a `z.strictObject` that REFUSES one by name rather than a plain
// # `z.object` that would strip it and answer 200 (AD-16a) — and this route's
// # declared input is none, which is precisely where a non-strict schema would
// # accept anything at all.
// ###########################################################################
//
// ── AD-18: `limit: 1` IS ENFORCED IN THE CALL, NEVER IN A RENDERER ──────────
//
// `FirstRunStatus.finding` is `OnboardingFinding | null` — a SINGLE NULLABLE
// OBJECT, never an array. Deviation 1 ("the surface holds no history") does
// not die by somebody designing a history page; it dies by a well-meaning
// later edit turning a one-row renderer into a list, because a list is what
// every other product does. A renderer that receives one object cannot be
// mapped into one, and the `limit: 1` that guarantees it lives at the call
// site rather than in whatever renders the answer.
import { createFindingsRepo, createFirstRunStatusService, ensureProject } from "@growthmind/db";
import type { ScopedDb } from "@growthmind/db";
import { describeError, firstRunStatusInputSchema } from "@growthmind/shared";
import type { TenantContext } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import { buildFirstRunStatus } from "@/lib/first-run/status";

/** Answered per request: the answer depends on the session the request
 * carried, and a cached response on a tenant-scoped read is a cross-tenant
 * leak with a nice name. */
export const dynamic = "force-dynamic";

/** AD-16a. `z.strictObject({})` — empty AND strict, so a body carrying a
 * tenancy id is refused by name rather than silently dropped. */
export const inputSchema = firstRunStatusInputSchema;

/**
 * Does a finding row EXIST for this project, whether or not it can be read?
 *
 * ── WHY THIS SECOND, SHAPE-AGNOSTIC QUESTION IS ASKED AT ALL ────────────────
 * The status service already reads the newest row and maps it into
 * `OnboardingFinding` through the boundary parse, degrading to `null` with a
 * logged reason when a persisted shape does not satisfy the rendered one (D5 —
 * prod contains every shape ever written). That is the right behaviour and
 * this route does not repeat it: NOTHING HERE RE-PARSES.
 *
 * But one `null` then carries two genuinely different facts — "nothing has
 * been found yet", which is where a founder spends steps 1 to 4, and "we found
 * something and could not read our own row". Silent degradation is a bug
 * (EC-O5): a customer told nothing cannot act, and the payoff screen is the
 * worst place in this product for it to happen. So the two are separated here,
 * by asking whether a row exists at all.
 *
 * A THROW IS AN ANSWER, NOT A FAILURE. The repository parses both jsonb
 * columns on the way out and refuses a legacy shape rather than handing a
 * caller an `unknown` it will cast — so a throw here means a row exists and
 * cannot be read, which is exactly the state being detected. It is logged and
 * converted, never propagated: this route answers 200 with an honest absence,
 * never a 500.
 */
async function findingRowExists(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<boolean> {
  try {
    // AD-18, at the call site: ONE row, asked for as one row.
    const [row] = await createFindingsRepo(db, ctx).listForProject(projectId, { limit: 1 });
    return row !== undefined;
  } catch (error) {
    // `describeError` RATHER THAN THE CAUGHT VALUE. This was the only
    // unscrubbed error sink on the surface — every other log here prints reason
    // codes — and the shapes that reach it are not all Zod's. A `pg` driver
    // error carries `.query` and `.parameters`, so logging the object whole
    // writes the statement and its bound values into the log, and the values
    // bound on this surface are tenancy ids and whatever a row happened to
    // hold. The message is what a person debugging needs; the rest is the
    // row's own neighbourhood.
    console.error("onboarding status: a finding row exists for this project but cannot be read", {
      organizationId: ctx.organizationId,
      projectId,
      reason: describeError(error),
    });
    return true;
  }
}

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const { projectId } = await ensureProject(deps.db, gate.ctx);

  const facts = await createFirstRunStatusService(deps.db, gate.ctx).read(projectId);

  // Only when the service found nothing to render. A finding that IS rendered
  // is proof enough that the row behind it could be read, and the poll runs
  // every second or two — a second query per tick for an answer already known
  // would be paid on the one screen that must stay responsive.
  const findingUnavailable =
    facts.finding === null && (await findingRowExists(deps.db, gate.ctx, projectId));

  return Response.json(
    await buildFirstRunStatus({
      db: deps.db,
      ctx: gate.ctx,
      projectId,
      facts,
      findingUnavailable,
    }),
  );
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
