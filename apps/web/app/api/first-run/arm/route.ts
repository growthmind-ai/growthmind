// POST /api/first-run/arm — the clock origin, and nothing else (O-008, AD-17,
// AD-16, AD-16a, storyboard T8).
//
// ###########################################################################
// # ARMING IS A CLOCK ORIGIN, NOT A GATE. THIS ROUTE WRITES NOTHING THE
// # PIPELINE READS, AND THAT IS THE WHOLE DESIGN.
// #
// # A founder whose product breaks BEFORE they press the button still gets
// # looked at — the hourly lane selects projects on its own terms and consults
// # no state this route writes. What the button decides is only where the
// # elapsed counter counts FROM. Coupling the two would make a missed press
// # look exactly like a broken product, which is the worst failure available
// # on the one screen this product exists for.
// #
// # So there is no job enqueued here, no lane named, no trigger fired, and no
// # marker written that any selection reads. One row, one column, one grain.
// # `apps/web/__tests__/api/first-run/lifecycle.route.test.ts` asserts that
// # structurally, in BOTH directions: this file names none of the pipeline's
// # symbols, and the two lane-selection sources name none of this table's.
// ###########################################################################
//
// ── "WATCH AGAIN" RESETS THE ORIGIN, IT DOES NOT APPEND ─────────────────────
//
// One row per organization+project, REPLACED. A second arming that appended
// would leave the surface counting from the first trigger, so a founder
// pressing the button again would watch a number that is already minutes old.
// The write is an upsert against the grain's own key — never a read-then-write
// (D6) — so two members arming at the same moment settle on one origin rather
// than racing each other.
//
// ── AND THE ORIGIN IS DURABLE BEFORE THE ANSWER RETURNS ─────────────────────
//
// The stamp is persisted, then the status is read back, then the response
// goes. A clock whose origin is not yet durable is a clock that resets on
// reload (storyboard T8), and a route that persisted after answering would
// pass a "did it eventually write" test and fail a founder who reloaded within
// the second. The stamp is the SERVER's, taken from the injected clock, so a
// client cannot decide when its own wait started.
import { createFirstRunRepo, ensureProject } from "@growthmind/db";
import { firstRunArmInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import { echoFirstRunStatus } from "@/lib/first-run/status";

export const dynamic = "force-dynamic";

export const inputSchema = firstRunArmInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const { projectId } = await ensureProject(deps.db, gate.ctx);

  await createFirstRunRepo(deps.db, gate.ctx).arm(projectId, deps.now());

  return Response.json(await echoFirstRunStatus(deps.db, gate.ctx, projectId));
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
