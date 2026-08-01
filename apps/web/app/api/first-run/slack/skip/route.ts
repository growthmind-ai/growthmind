// POST /api/first-run/slack/skip — walking past step three (O-008, FR-O14,
// AD-16, AD-16a).
//
// ###########################################################################
// # TWO MECHANISMS, DELIBERATELY, AND THE SPLIT IS WHAT MAKES FR-O14 SURVIVE
// # A RELOAD BY CONSTRUCTION.
// #
// #   `slack_skipped_at`  -> the STEP STATE. It is what lets `skipped` be
// #                          distinguishable from `pending` after a reload,
// #                          which are two states a founder must be able to
// #                          tell apart.
// #   THE ABSENCE OF AN   -> the NOTICE. "You can still see the next part on
// #   ACTIVE CONNECTION      this screen. But nothing will arrive anywhere
// #                          after that until Slack is connected."
// #
// # A route that read the FLAG for the notice would show a connected
// # organization a degraded notice forever after one skip, and would show an
// # organization that connected and then disconnected nothing at all. A
// # `slackConnected` boolean cached onto `first_run_state` would be the
// # hand-passed wire this split exists to avoid — written by one path, read by
// # another, and stale the moment anybody else disconnects.
// #
// # SILENT DEGRADATION IS A BUG. The response says plainly that the onboarding
// # moment still works AND that nothing further arrives until Slack is
// # connected — the sentence is shipped and imported, never re-authored here.
// ###########################################################################
//
// ── SKIPPING IS NOT ARMING ──────────────────────────────────────────────────
//
// `skipSlack` touches `slack_skipped_at` alone: it is absent from both the
// insert values and the conflict `set` for `armed_at`, so pressing "skip for
// now" cannot start somebody's clock. An upsert against the grain's own key,
// never a read-then-write — skipping twice is one fact (D6).
import { createFirstRunRepo, ensureProject } from "@growthmind/db";
import { firstRunSlackSkipInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import { echoFirstRunStatus } from "@/lib/first-run/status";

export const dynamic = "force-dynamic";

export const inputSchema = firstRunSlackSkipInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const { projectId } = await ensureProject(deps.db, gate.ctx);

  // DURABLE BEFORE THE ANSWER. The stamp is persisted and only then is the
  // status read back, so a founder who reloads within the second sees
  // `skipped` rather than a step that quietly reverted to `pending`.
  await createFirstRunRepo(deps.db, gate.ctx).skipSlack(projectId, deps.now());

  return Response.json(await echoFirstRunStatus(deps.db, gate.ctx, projectId));
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
