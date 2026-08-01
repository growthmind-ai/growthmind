// POST /api/first-run/dismiss — retiring the surface, for one person (O-008,
// AD-17, ESC-O2, AD-16, AD-16a).
//
// ###########################################################################
// # PER-USER DISMISSAL IS THE ONLY READING THAT SATISFIES BOTH REQUIREMENTS.
// #
// # FR-O19: a reload must still show the finding. FR-O21: nothing links back
// # once setup is done. Enumerate the alternatives and each breaks one:
// #
// #   a 404 after completion     -> breaks FR-O19 (no reload)
// #   an always-rendering page   -> breaks FR-O21 (it links back)
// #   an unconditional redirect  -> breaks FR-O19 (no reload)
// #   PER-USER DISMISSAL         -> satisfies both
// #
// # It also keeps a teammate out of a lockout. ESC-O2 is the NAMED shortfall
// # that once a user dismisses they have no disconnect path until a settings
// # surface ships — and a per-ORG dismissal would put every member of the
// # organization in that state at once, on an act none of them performed, on
// # the only surface this product currently has.
// #
// # So the grain is `(organization_id, user_id)`, the user id comes from the
// # SESSION and never from the body, and the schema is a `z.strictObject({})`
// # that refuses one sent anyway. A body-supplied user id would let one member
// # retire the product for another.
// ###########################################################################
//
// ── THE ANSWER IS ONE FACT, AND IT IS THE ONE THE CALLER ASKED FOR ──────────
//
// `{ dismissed: true }` — not a status payload. Everything else on this
// surface is about what is happening; this is the act that ends it, and
// echoing the state a caller is walking away from would invite a renderer to
// keep showing it. Dismissing twice is ONE fact: the write is an upsert
// against the grain's own key, so a second click settles rather than raising.
import { createFirstRunRepo, ensureProject } from "@growthmind/db";
import { firstRunDismissInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";

export const dynamic = "force-dynamic";

export const inputSchema = firstRunDismissInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  await ensureProject(deps.db, gate.ctx);

  // The user id is an EXPLICIT PARAMETER rather than read from `ctx` inside
  // the repository, so the `(organization_id, user_id)` grain is visible at
  // the call site. That is not redundancy: it is the difference between a
  // per-user fact and a per-actor side effect, and it is the property ESC-O2
  // rests on.
  await createFirstRunRepo(deps.db, gate.ctx).dismiss(gate.ctx.userId, deps.now());

  return Response.json({ dismissed: true });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
