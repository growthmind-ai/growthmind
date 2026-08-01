// POST /api/first-run/analytics/disconnect — step two, undone (O-008, FR-O9,
// EC-O1, EC-O2, AD-16).
//
// ###########################################################################
// # THE D1 AUDIENCE QUESTION, ANSWERED OUT LOUD: THE EFFECT IS ORG-WIDE.
// #
// # The attachment belongs to the ORGANIZATION, not to whoever set it up. So
// # revocation is org-wide, and any member can perform it: org membership is
// # the whole floor here, matching the shipped member-vs-non-member boundary.
// # A role gate is a named future decision, deliberately not designed in.
// #
// # A route that deactivated "the actor's view" would pass every single-actor
// # test anybody ever wrote and leave a teammate reading a connection that is
// # gone. `disconnect deactivates for every member of the org, not the actor's
// # view` proves the opposite with a SECOND MEMBER'S READ, never the actor's.
// ###########################################################################
//
// ── AND IT SAYS WHAT HAPPENS TO THE DATA, IN THE RESPONSE ───────────────────
//
// A customer pressing disconnect is asking "do I lose what you already
// collected?", and the answer has to be in the response rather than in a doc.
// It is the shipped `CONNECTION_STATE_MESSAGES.disconnected` sentence,
// imported and never re-authored — "This project is no longer attached.
// Everything we already collected is still here." The repository deactivates
// rather than deletes, which is what makes that sentence true.
import { ensureProject } from "@growthmind/db";
import {
  CONNECTION_STATE_MESSAGES,
  firstRunAnalyticsDisconnectInputSchema,
} from "@growthmind/shared";

import { firstRunConnectionsService } from "@/lib/first-run/connections";
import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";

export const dynamic = "force-dynamic";

/** AD-16: no input. AD-16a: and STRICT, which is what makes "no input" mean
 * "nothing is accepted" rather than "anything is accepted and dropped". */
export const inputSchema = firstRunAnalyticsDisconnectInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const { projectId } = await ensureProject(deps.db, gate.ctx);

  const state = await firstRunConnectionsService(deps.db, gate.ctx, deps).disconnect(projectId);

  return Response.json({ state, message: CONNECTION_STATE_MESSAGES[state.status] });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
