// One person's bell, not the organization's: the body names a class and whether it is
// shown, and never a user or an organization — both come from the session.
import { createNotificationMutesRepo } from "@growthmind/db";
import { PAGES_SAVED, settingsNotificationBellInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";

export const dynamic = "force-dynamic";

export const inputSchema = settingsNotificationBellInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const mutes = createNotificationMutesRepo(deps.db, gate.ctx);

  if (parsed.data.shown) {
    await mutes.unmute(parsed.data.class);
  } else {
    await mutes.mute(parsed.data.class);
  }

  return Response.json({ saved: true, sentence: PAGES_SAVED });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
